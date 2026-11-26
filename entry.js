// Pure helpers for category-entry-check. Works in Node and in the browser (index.html imports it).
// Input: one GET /v1/market/leaderboard response per App Store category (same storefront and chart type).
// Output: one comparison of what it takes to chart in each category, Markdown, CSV, chat text.

// The 27 App Store category shelves the leaderboards carry besides Overall (Apple's public genre IDs).
export const SHELVES = {
  6000: 'Business', 6001: 'Weather', 6002: 'Utilities', 6003: 'Travel', 6004: 'Sports', 6005: 'Social Networking',
  6006: 'Reference', 6007: 'Productivity', 6008: 'Photo & Video', 6009: 'News', 6010: 'Navigation', 6011: 'Music',
  6012: 'Lifestyle', 6013: 'Health & Fitness', 6014: 'Games', 6015: 'Finance', 6016: 'Entertainment', 6017: 'Education',
  6018: 'Books', 6020: 'Medical', 6021: 'Magazines & Newspapers', 6022: 'Catalogs', 6023: 'Food & Drink', 6024: 'Shopping',
  6025: 'Stickers', 6026: 'Developer Tools', 6027: 'Graphics & Design',
};
export const CHART_TYPES = ['free', 'paid', 'grossing'];
export const BAR_RANKS = [10, 25, 50];

const norm = (s) => String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

// "6013", "Health & Fitness", "health and fitness", "all" -> { categoryId, name }
export function parseCategory(input) {
  const s = String(input ?? '').trim();
  if (!s) throw new Error('Empty category.');
  if (/^(all|overall)$/i.test(s)) return { categoryId: 'all', name: 'Overall' };
  if (/^\d+$/.test(s)) {
    if (!SHELVES[s]) throw new Error(`${s} is not one of the 27 App Store category shelves. Run with --list.`);
    return { categoryId: s, name: SHELVES[s] };
  }
  const hit = Object.entries(SHELVES).find(([, n]) => norm(n) === norm(s));
  if (!hit) throw new Error(`Unknown category "${s}". Use an ID or a name from --list.`);
  return { categoryId: hit[0], name: hit[1] };
}

export function compact(n) {
  if (n == null || !Number.isFinite(n)) return '';
  const a = Math.abs(n);
  const t = (x) => (Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 10) / 10).toString();
  if (a >= 1e9) return t(n / 1e9) + 'B';
  if (a >= 1e6) return t(n / 1e6) + 'M';
  if (a >= 1e3) return t(n / 1e3) + 'k';
  return String(Math.round(n));
}

// A monthly estimate is a range, below_floor (under a ceiling) or missing. Missing stays missing, never zero.
export function estimate(e) {
  if (e?.kind === 'range' && e.range) return { kind: 'range', low: e.range.low ?? null, mid: e.range.mid ?? null, high: e.range.high ?? null };
  if (e?.kind === 'below_floor') return { kind: 'below_floor', ceiling: e.ceiling ?? null };
  return { kind: null };
}
export function estimateText(e, prefix = '') {
  if (!e || !e.kind) return 'no estimate';
  if (e.kind === 'range') return `${prefix}${compact(e.low)}–${prefix}${compact(e.high)}`;
  return e.ceiling != null ? `< ${prefix}${compact(e.ceiling)}` : 'below floor';
}

const num = (v) => (Number.isFinite(v) ? v : null);
const median = (xs) => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const monthsBetween = (from, to) => {
  const a = new Date(from), b = new Date(to);
  if (Number.isNaN(+a) || Number.isNaN(+b)) return null;
  return (b - a) / (1000 * 60 * 60 * 24 * 30.44);
};

// The chart a response is about: viewChart for a category, charts[chartType] for Overall (viewChart is null there).
export function pickChart(raw, chartType) {
  if (raw?.viewChart) return raw.viewChart;
  const c = raw?.charts?.[chartType ?? 'grossing'];
  if (!c) throw new Error('No chart in this response. Expected a GET /v1/market/leaderboard response.');
  return c;
}

// Keep only what this tool reads, so a saved run stays small: the chosen chart and the signals of its apps.
export function trim(raw, chartType) {
  const chart = pickChart(raw, chartType);
  const ids = new Set((chart.data ?? []).map((r) => String(r.storeId)));
  return {
    projection: raw.projection ?? null,
    viewChart: chart,
    signals: { ...(raw.signals ?? {}), apps: (raw.signals?.apps ?? []).filter((a) => ids.has(String(a.storeId))) },
  };
}

// One category: the evidence a maker reads before entering it. `top` = how many chart rows to read (1-100).
export function categoryReport(raw, { chartType = 'grossing', top = 50, youngMonths = 24, label = null } = {}) {
  const chart = pickChart(raw, chartType);
  const q = chart.query ?? {};
  const categoryId = String(q.categoryId ?? 'all');
  const name = label ?? (categoryId === 'all' ? 'Overall' : SHELVES[categoryId] ?? chart.data?.[0]?.categoryName ?? categoryId);
  const chartDay = chart.snapshot?.day ?? null;
  const sig = new Map((raw.signals?.apps ?? []).map((a) => [String(a.storeId), a]));
  const rows = (chart.data ?? [])
    .filter((r) => Number.isFinite(r.rank) && r.rank <= top)
    .sort((a, b) => a.rank - b.rank)
    .map((r) => {
      const s = sig.get(String(r.storeId));
      const est = r.estimates ?? {};
      return {
        rank: r.rank, storeId: String(r.storeId), name: r.name ?? '(no name)', developer: r.developer ?? '',
        releaseDate: r.releaseDate ?? null, rating: num(r.rating), ratingCount: num(r.ratingCount),
        revenue: estimate(est.monthlyRevenue), installs: estimate(est.monthlyInstalls),
        // A missing paid/organic/keywords block means "not collected", never zero.
        liveAds: num(s?.paid?.liveAds), started7d: num(s?.paid?.startedLast7Days),
        organicPosts: num(s?.organic?.matchedPosts), postsOverMillion: num(s?.organic?.postsOverMillion),
        top10: num(s?.keywords?.top10),
      };
    });

  const at = (rank) => rows.find((r) => r.rank === rank) ?? null;
  const bar = BAR_RANKS.filter((k) => k <= top).map((k) => {
    const r = at(k);
    return { rank: k, name: r?.name ?? null, revenue: r?.revenue ?? { kind: null }, installs: r?.installs ?? { kind: null }, ratingCount: r?.ratingCount ?? null };
  });

  const ranged = rows.filter((r) => r.revenue.kind === 'range' && Number.isFinite(r.revenue.mid));
  const total = ranged.reduce((s, r) => s + r.revenue.mid, 0);
  const top3 = ranged.slice(0, 3).reduce((s, r) => s + r.revenue.mid, 0);
  const concentration = ranged.length >= 5 && total > 0 ? { top3Share: top3 / total, rangedApps: ranged.length, top3: ranged.slice(0, 3).map((r) => r.name) } : null;

  const young = chartDay ? rows.filter((r) => r.releaseDate && monthsBetween(r.releaseDate, chartDay) <= youngMonths) : [];
  const top25 = rows.filter((r) => r.rank <= 25 && r.ratingCount != null);
  const smallest = top25.length ? top25.reduce((m, r) => (r.ratingCount < m.ratingCount ? r : m)) : null;

  const devs = new Map();
  for (const r of rows) if (r.developer) devs.set(r.developer, (devs.get(r.developer) ?? 0) + 1);
  const busiest = [...devs].sort((a, b) => b[1] - a[1])[0] ?? null;

  const paidKnown = rows.filter((r) => r.liveAds != null);
  const orgKnown = rows.filter((r) => r.organicPosts != null);
  const kwKnown = rows.filter((r) => r.top10 != null);
  const s = chart.summary ?? {};

  return {
    categoryId, name, chartType: q.chartType ?? chartType, country: q.country ?? null,
    chartDay, previousDay: chart.snapshot?.previousDay ?? null, stale: Boolean(chart.snapshot?.stale),
    rowsRead: rows.length, top,
    bar, concentration,
    revenueKinds: { range: ranged.length, belowFloor: rows.filter((r) => r.revenue.kind === 'below_floor').length, none: rows.filter((r) => !r.revenue.kind).length },
    young: { months: youngMonths, count: chartDay ? young.length : null, best: young[0] ? { rank: young[0].rank, name: young[0].name, releaseDate: young[0].releaseDate } : null },
    reviews: { medianTop10: median(rows.filter((r) => r.rank <= 10).map((r) => r.ratingCount)), smallestTop25: smallest ? { rank: smallest.rank, name: smallest.name, ratingCount: smallest.ratingCount } : null },
    developers: { distinct: devs.size, busiest: busiest && busiest[1] > 1 ? { name: busiest[0], apps: busiest[1] } : null },
    paid: { collected: paidKnown.length, buying: paidKnown.filter((r) => r.liveAds > 0).length, liveAds: paidKnown.reduce((t, r) => t + r.liveAds, 0), started7d: paidKnown.reduce((t, r) => t + (r.started7d ?? 0), 0) },
    organic: { collected: orgKnown.length, withPosts: orgKnown.filter((r) => r.organicPosts > 0).length, postsOverMillion: orgKnown.reduce((t, r) => t + (r.postsOverMillion ?? 0), 0) },
    search: { collected: kwKnown.length, withTop10: kwKnown.filter((r) => r.top10 > 0).length, medianTop10: median(kwKnown.map((r) => r.top10)) },
    churn: { gainers: num(s.gainers), losers: num(s.losers), newEntrants: num(s.newEntrants), newReleases: num(s.newReleases) },
  };
}

const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const of = (a, b) => (b ? `${a}/${b}` : 'not collected');

// Plain, relative observations across the compared categories. No score and no verdict: the reader decides.
export function callouts(cats) {
  if (cats.length < 2) return [];
  const out = [];
  const pick = (f, dir, fmt, text) => {
    const xs = cats.map((c) => ({ c, v: f(c) })).filter((x) => x.v != null);
    if (xs.length < 2) return;
    xs.sort((a, b) => (dir === 'min' ? a.v - b.v : b.v - a.v));
    if (xs[0].v === xs[1].v) return;
    out.push(`${text}: ${xs[0].c.name} (${fmt(xs[0].v, xs[0].c)}).`);
  };
  const midAt = (k) => (c) => { const b = c.bar.find((x) => x.rank === k); return b?.revenue.kind === 'range' ? b.revenue.mid : null; };
  pick(midAt(25), 'min', (v) => `#25 revenue mid ~$${compact(v)}/mo`, 'Lowest revenue estimate at #25');
  pick((c) => c.concentration?.top3Share ?? null, 'min', (v) => `top 3 hold ${pct(v)} of summed revenue mids`, 'Least concentrated at the top');
  pick((c) => c.young.count, 'max', (v, c) => `${v} of ${c.rowsRead} released in the last ${c.young.months} months`, 'Most young apps on the chart');
  pick((c) => c.reviews.smallestTop25?.ratingCount ?? null, 'min', (v, c) => `${c.reviews.smallestTop25.name} at #${c.reviews.smallestTop25.rank} with ${compact(v)} ratings`, 'Smallest review base inside the top 25');
  pick((c) => (c.paid.collected ? c.paid.buying / c.paid.collected : null), 'min', (v, c) => `${c.paid.buying} of ${c.paid.collected} collected apps running ads`, 'Least paid-ad pressure');
  pick((c) => c.churn.newEntrants, 'max', (v) => `${v} new entrants on the latest chart day`, 'Most new chart entrants');
  return out;
}

export function buildReport(cats, meta = {}) {
  const days = [...new Set(cats.map((c) => c.chartDay).filter(Boolean))].sort();
  return { kind: 'peekpanda-category-entry-check', country: cats[0]?.country ?? meta.country ?? null, chartType: cats[0]?.chartType ?? meta.chartType ?? 'grossing', chartDays: days, categories: cats, callouts: callouts(cats) };
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|');

export function toMarkdown(rep, unresolved = []) {
  const L = [];
  const cats = rep.categories;
  L.push(`## Category entry check: ${rep.chartType} chart, ${String(rep.country ?? '').toUpperCase()}`);
  L.push('');
  L.push(`Chart day${rep.chartDays.length > 1 ? 's' : ''} ${rep.chartDays.join(', ') || 'unknown'}. Top ${cats[0]?.top ?? ''} rows read per category. Download and revenue figures are PeekPanda estimates (worldwide, USD), not measured results.`);
  const stale = cats.filter((c) => c.stale).map((c) => c.name);
  if (stale.length) L.push(`\nMarked stale by the source: ${stale.join(', ')}.`);
  if (rep.callouts.length) { L.push('', '**Side by side**', ''); for (const c of rep.callouts) L.push(`- ${c}`); }
  L.push('', `| | ${cats.map((c) => cell(c.name)).join(' | ')} |`, `| --- |${cats.map(() => ' --- |').join('')}`);
  const row = (label, f) => L.push(`| ${label} | ${cats.map((c) => cell(f(c))).join(' | ')} |`);
  for (const k of BAR_RANKS) if (cats.some((c) => c.bar.some((b) => b.rank === k))) {
    row(`Revenue / mo at #${k}`, (c) => { const b = c.bar.find((x) => x.rank === k); return b ? (b.name ? estimateText(b.revenue, '$') : 'no row') : ''; });
  }
  for (const k of BAR_RANKS) if (cats.some((c) => c.bar.some((b) => b.rank === k))) {
    row(`Downloads / mo at #${k}`, (c) => { const b = c.bar.find((x) => x.rank === k); return b ? (b.name ? estimateText(b.installs) : 'no row') : ''; });
  }
  row('Top 3 share of revenue mids', (c) => (c.concentration ? `${pct(c.concentration.top3Share)} (${c.concentration.rangedApps} ranged)` : 'too few ranges'));
  row('Revenue estimates: range / below floor / none', (c) => `${c.revenueKinds.range} / ${c.revenueKinds.belowFloor} / ${c.revenueKinds.none}`);
  row(`Released in last ${cats[0]?.young.months ?? 24} months`, (c) => (c.young.count == null ? 'unknown' : `${c.young.count}${c.young.best ? ` (best #${c.young.best.rank})` : ''}`));
  row('Median ratings, top 10', (c) => compact(c.reviews.medianTop10) || '–');
  row('Smallest review base, top 25', (c) => (c.reviews.smallestTop25 ? `${compact(c.reviews.smallestTop25.ratingCount)} (#${c.reviews.smallestTop25.rank})` : '–'));
  row('Distinct developers', (c) => `${c.developers.distinct}${c.developers.busiest ? ` (${c.developers.busiest.name}: ${c.developers.busiest.apps})` : ''}`);
  row('Apps running paid ads', (c) => of(c.paid.buying, c.paid.collected));
  row('Live ads (started 7d)', (c) => (c.paid.collected ? `${compact(c.paid.liveAds)} (${compact(c.paid.started7d)})` : '–'));
  row('Apps with organic posts', (c) => of(c.organic.withPosts, c.organic.collected));
  row('Apps top 10 for a search', (c) => of(c.search.withTop10, c.search.collected));
  row('Chart day: gainers / losers / new', (c) => [c.churn.gainers, c.churn.losers, c.churn.newEntrants].map((v) => v ?? '–').join(' / '));
  L.push('', '"not collected" means PeekPanda holds no evidence of that kind for those apps yet, not zero. A chart rank says where an app was on that day, not why.');
  if (unresolved.length) { L.push(''); for (const u of unresolved) L.push(`- ${u.input}: ${u.why}`); }
  return L.join('\n');
}

const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function toCsv(rep) {
  const head = ['category_id', 'category', 'country', 'chart', 'chart_day', 'rows_read'];
  for (const k of BAR_RANKS) head.push(`rev_low_${k}`, `rev_high_${k}`, `rev_kind_${k}`, `dl_low_${k}`, `dl_high_${k}`);
  head.push('top3_share', 'ranged', 'below_floor', 'no_estimate', 'young_apps', 'young_months', 'median_ratings_top10', 'smallest_ratings_top25', 'developers', 'paid_collected', 'paid_buying', 'live_ads', 'ads_started_7d', 'organic_collected', 'organic_with_posts', 'search_collected', 'search_with_top10', 'gainers', 'losers', 'new_entrants');
  const lines = [head.join(',')];
  for (const c of rep.categories) {
    const r = [c.categoryId, c.name, c.country, c.chartType, c.chartDay, c.rowsRead];
    for (const k of BAR_RANKS) { const b = c.bar.find((x) => x.rank === k); r.push(b?.revenue.low ?? '', b?.revenue.high ?? '', b?.revenue.kind ?? '', b?.installs.low ?? '', b?.installs.high ?? ''); }
    r.push(c.concentration ? c.concentration.top3Share.toFixed(3) : '', c.revenueKinds.range, c.revenueKinds.belowFloor, c.revenueKinds.none, c.young.count ?? '', c.young.months, c.reviews.medianTop10 ?? '', c.reviews.smallestTop25?.ratingCount ?? '', c.developers.distinct, c.paid.collected, c.paid.buying, c.paid.liveAds, c.paid.started7d, c.organic.collected, c.organic.withPosts, c.search.collected, c.search.withTop10, c.churn.gainers ?? '', c.churn.losers ?? '', c.churn.newEntrants ?? '');
    lines.push(r.map(csvCell).join(','));
  }
  return lines.join('\n');
}

export function toChat(rep, unresolved = []) {
  const L = [`Category entry check (${rep.chartType}, ${String(rep.country ?? '').toUpperCase()}, ${rep.chartDays.join(', ')}): ${rep.categories.map((c) => c.name).join(', ')}`];
  for (const c of rep.categories) {
    const b = c.bar.find((x) => x.rank === 25) ?? c.bar[c.bar.length - 1];
    L.push(`• ${c.name}: #${b?.rank} ${b?.revenue?.kind ? `≈ ${estimateText(b.revenue, '$')}/mo` : 'has no revenue estimate'}, top 3 ${pct(c.concentration?.top3Share)}, ${c.young.count ?? '?'} young apps, ads ${of(c.paid.buying, c.paid.collected)}`);
  }
  for (const x of rep.callouts) L.push(`- ${x}`);
  for (const u of unresolved) L.push(`! ${u.input}: ${u.why}`);
  return L.join('\n');
}
