#!/usr/bin/env node
// Category entry check for PeekPanda. Node 18+, no dependencies. Read-only (scope context:read):
//   GET /v1/market/leaderboard?country=..&categoryId=..&chartType=..   (MCP get_market action leaderboard)
// One call per category. Reading never starts collection.
import { readFile, writeFile } from 'node:fs/promises';
import { SHELVES, CHART_TYPES, parseCategory, categoryReport, trim, buildReport, toMarkdown, toCsv, toChat } from './entry.js';

const HELP = `Usage:
  PEEKPANDA_TOKEN=... node cli.js --categories "Health & Fitness,Productivity,6023"   one call per category
  node cli.js --file run.json [opts]                                                 re-render a saved run
  node cli.js --list                                                                 the 27 category shelves (no call)

Options:
  --categories <list>    comma-separated category names or IDs (2-8 is the useful range; "all" adds Overall)
  --country <cc>         App Store storefront, two letters (default us)
  --chart grossing|free|paid   chart to read (default grossing)
  --top <n>              chart rows to read per category, 1-100 (default 50)
  --young-months <n>     "young app" = released within this many months of the chart day (default 24)
  --save <path>          save the trimmed answers (chart + signals of its apps, no credentials) for --file or the browser page
  --format md|csv|json   output format (default md)
  --webhook <url>        also POST a short summary to a Slack or Discord incoming webhook
  --tenancy <selector>   send x-genviral-tenancy (a workspace id). Left out by default: a key pinned to a workspace
                         reads that workspace, and naming one it cannot reach answers 403 workspace_not_accessible.
  --api <url>            API base (default https://api.peekpanda.com)

Every call counts toward your plan's daily API and MCP allowance (see https://peekpanda.com/docs/plans-and-refreshes).`;

const FLAGS = new Set(['--help', '-h', '--list']);
function parse(argv) {
  const o = { format: 'md', api: 'https://api.peekpanda.com', country: 'us', chart: 'grossing', top: '50', 'young-months': '24' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (FLAGS.has(a)) o[a.replace(/^-+/, '') === 'h' ? 'help' : a.replace(/^-+/, '')] = true;
    else if (a.startsWith('--')) {
      const v = argv[++i];
      if (v == null) throw new Error(`${a} needs a value. See --help.`);
      o[a.slice(2)] = v;
    } else throw new Error(`Unexpected argument "${a}". See --help.`);
  }
  if (!/^[a-z]{2}$/.test(o.country)) throw new Error('--country takes two lowercase letters, e.g. us.');
  if (!CHART_TYPES.includes(o.chart)) throw new Error('--chart is grossing, free or paid.');
  o.top = Number(o.top); o.youngMonths = Number(o['young-months']);
  if (!Number.isInteger(o.top) || o.top < 1 || o.top > 100) throw new Error('--top is 1-100.');
  if (!(o.youngMonths > 0)) throw new Error('--young-months must be a positive number.');
  return o;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class StopError extends Error {}

async function call(o, path, retried = false) {
  const token = process.env.PEEKPANDA_TOKEN;
  if (!token) throw new StopError('Set PEEKPANDA_TOKEN to a PeekPanda API key (Account → API keys). Never commit it.');
  const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` };
  if (o.tenancy) headers['x-genviral-tenancy'] = o.tenancy;
  const res = await fetch(new URL(path, o.api), { headers });
  if (res.ok) return res.json();
  const body = await res.json().catch(() => null);
  const code = body?.error?.code ?? '';
  const retry = Number(res.headers.get('retry-after') ?? body?.error?.retryAfterSeconds);
  if ((code === 'rate_limited' || res.status === 503) && !retried && retry > 0 && retry <= 70) {
    await sleep(retry * 1000);
    return call(o, path, true);
  }
  const msg = `${res.status} ${code}`.trim();
  if (code === 'daily_call_limit') throw new StopError(`PeekPanda API ${msg}: the daily API and MCP allowance is used until 00:00 UTC; stopping.`);
  if ([401, 402, 403].includes(res.status)) {
    const hint = { workspace_not_accessible: ' The key cannot reach that tenancy; leave out --tenancy.', authorization_required: ' Check the key scopes (context:read).', subscription_required: ' These reads need a plan with API access.', authentication_required: ' Check PEEKPANDA_TOKEN: the key is missing, mistyped or revoked.' }[code] ?? '';
    throw new StopError(`PeekPanda API ${msg} (GET ${path.split('?')[0]}): ${String(body?.error?.message ?? res.statusText).replace(/\.$/, '')}.${hint}`);
  }
  return { error: `${msg}${body?.error?.message ? ` ${String(body.error.message).replace(/\.$/, '')}` : ''}` };
}

async function main() {
  const o = parse(process.argv.slice(2));
  if (o.help) return console.log(HELP);
  if (o.list) return console.log(['all  Overall', ...Object.entries(SHELVES).map(([id, n]) => `${id} ${n}`)].join('\n'));
  const runs = [], unresolved = [];
  let stopped = null;
  if (o.file) {
    const saved = JSON.parse(await readFile(o.file, 'utf8'));
    runs.push(...(Array.isArray(saved) ? saved : [saved]).map((x) => ({ raw: x.raw ?? x, label: x.label ?? null })));
  } else {
    if (!o.categories) throw new Error('Give --categories, --file or --list. See --help.');
    const wanted = [...new Map(o.categories.split(',').map((s) => s.trim()).filter(Boolean).map(parseCategory).map((c) => [c.categoryId, c])).values()];
    if (wanted.length > 12) throw new Error('At most 12 categories per run (one API call each).');
    for (const c of wanted) {
      const qs = new URLSearchParams({ country: o.country, categoryId: c.categoryId, chartType: o.chart });
      try {
        const r = await call(o, `/v1/market/leaderboard?${qs}`);
        if (r.error) unresolved.push({ input: c.name, why: r.error }); else runs.push({ category: c.categoryId, raw: trim(r, o.chart) });
      } catch (e) {
        if (!(e instanceof StopError)) throw e;
        stopped = e.message; break;
      }
    }
  }
  if (stopped && !runs.length) throw new Error(stopped);
  if (!runs.length) throw new Error('No category could be read.\n' + unresolved.map((u) => `- ${u.input}: ${u.why}`).join('\n'));
  const rep = buildReport(runs.map((x) => categoryReport(x.raw, { chartType: o.chart, top: o.top, youngMonths: o.youngMonths, label: x.label })));
  if (o.save) await writeFile(o.save, '[\n' + runs.map((x) => JSON.stringify(x)).join(',\n') + '\n]\n');
  const text = o.format === 'json' ? JSON.stringify({ ...rep, unresolved }, null, 2) : o.format === 'csv' ? toCsv(rep) : toMarkdown(rep, unresolved);
  console.log(text);
  if (o.webhook) {
    const isDiscord = /discord(app)?\.com\/api\/webhooks/.test(o.webhook);
    const msg = toChat(rep, unresolved) + (stopped ? `\n${stopped}` : '');
    const res = await fetch(o.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(isDiscord ? { content: msg.slice(0, 1900) } : { text: msg }) });
    if (!res.ok) console.error(`webhook answered ${res.status}`);
  }
  if (stopped) { console.error(stopped); process.exit(2); }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
