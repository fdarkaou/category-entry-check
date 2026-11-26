import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCategory, categoryReport, trim, buildReport, toMarkdown, toCsv, toChat, estimateText } from '../entry.js';

const json = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));
const example = async (opts = {}) => buildReport((await json('../examples/run.json')).map((x) => categoryReport(x.raw, opts)));

test('parseCategory takes ids, names and all', () => {
  assert.deepEqual(parseCategory('6013'), { categoryId: '6013', name: 'Health & Fitness' });
  assert.deepEqual(parseCategory('health and fitness'), { categoryId: '6013', name: 'Health & Fitness' });
  assert.deepEqual(parseCategory('Photo & Video'), { categoryId: '6008', name: 'Photo & Video' });
  assert.equal(parseCategory('overall').categoryId, 'all');
  assert.throws(() => parseCategory('6019'));
  assert.throws(() => parseCategory('Gaming'));
});

test('the documented example response reads without guessing', async () => {
  const raw = await json('./docs-example.json');
  const c = categoryReport(raw, { chartType: 'free' });
  assert.equal(c.categoryId, '6013');
  assert.equal(c.name, 'Health & Fitness');
  assert.equal(c.chartDay, '2026-09-06');
  assert.equal(c.rowsRead, 1);
  assert.equal(c.revenueKinds.belowFloor, 1);
  assert.equal(c.concentration, null); // fewer than 5 ranged apps
  assert.equal(c.paid.collected, 0); // its signals do not cover this app: not collected, not zero
  assert.match(toMarkdown(buildReport([c])), /not collected/);
  // Overall: viewChart is null, the chart is charts[chartType]
  const all = categoryReport({ ...raw, viewChart: null }, { chartType: 'free' });
  assert.equal(all.categoryId, 'all');
  assert.equal(all.name, 'Overall');
});

test('trim keeps the chart and only its apps\' signals', async () => {
  const raw = await json('./docs-example.json');
  const t = trim(raw, 'free');
  assert.equal(t.viewChart.query.categoryId, '6013');
  assert.equal(t.overview, undefined);
  assert.ok(t.signals.apps.every((a) => t.viewChart.data.some((r) => r.storeId === a.storeId)));
});

test('example comparison: entry bar, concentration, callouts', async () => {
  const rep = await example();
  const [hf, prod, food] = rep.categories;
  assert.equal(rep.chartType, 'grossing');
  assert.equal(hf.rowsRead, 50);
  assert.equal(hf.bar.find((b) => b.rank === 25).revenue.kind, null); // missing estimate stays missing
  assert.equal(food.bar.find((b) => b.rank === 50).revenue.kind, 'below_floor');
  assert.ok(prod.concentration.top3Share > 0 && prod.concentration.top3Share < 1);
  assert.ok(rep.callouts.some((l) => /^Lowest revenue estimate at #25: Food & Drink/.test(l)));
  assert.ok(rep.callouts.every((l) => !/should|best category|recommend/i.test(l)));
  assert.equal(estimateText({ kind: null }), 'no estimate');
});

test('top narrows rows and the bar', async () => {
  const rep = await example({ top: 10 });
  assert.equal(rep.categories[0].rowsRead, 10);
  assert.deepEqual(rep.categories[0].bar.map((b) => b.rank), [10]);
});

test('csv and chat render', async () => {
  const rep = await example();
  const csv = toCsv(rep).split('\n');
  assert.equal(csv.length, 4);
  assert.match(csv[0], /^category_id,category,country,chart,chart_day/);
  assert.match(csv[1], /^6013,Health & Fitness,us,grossing,2026-11-24,50/);
  const chat = toChat(rep, [{ input: 'Books', why: '400 invalid_request' }]);
  assert.match(chat, /Health & Fitness: #25 has no revenue estimate/);
  assert.match(chat, /! Books: 400 invalid_request/);
});

test('cli: one call per category, no tenancy header by default, saved run re-renders', async () => {
  const raw = await json('./docs-example.json');
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization, tenancy: req.headers['x-genviral-tenancy'] });
    const u = new URL(req.url, 'http://x');
    if (u.searchParams.get('categoryId') === '6018') { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"error":{"code":"invalid_request","message":"Unknown category."}}'); }
    const body = structuredClone(raw);
    body.viewChart.query.categoryId = u.searchParams.get('categoryId');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, r));
  const dir = await mkdtemp(join(tmpdir(), 'entry-'));
  const run = (args) => new Promise((resolve) => execFile(process.execPath, [new URL('../cli.js', import.meta.url).pathname, ...args], { env: { ...process.env, PEEKPANDA_TOKEN: 'test-token' } }, (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr })));
  try {
    const r = await run(['--api', `http://127.0.0.1:${server.address().port}`, '--categories', 'Health & Fitness,Books', '--chart', 'free', '--save', join(dir, 'run.json')]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(seen.length, 2);
    assert.match(seen[0].url, /^\/v1\/market\/leaderboard\?country=us&categoryId=6013&chartType=free$/);
    assert.equal(seen[0].auth, 'Bearer test-token');
    assert.equal(seen[0].tenancy, undefined);
    assert.match(r.stdout, /Books: 400 invalid_request/);
    const saved = await readFile(join(dir, 'run.json'), 'utf8');
    assert.ok(!saved.includes('test-token'));
    const again = await run(['--file', join(dir, 'run.json'), '--format', 'json', '--chart', 'free']);
    assert.equal(JSON.parse(again.stdout).categories[0].categoryId, '6013');
  } finally { server.close(); }
});
