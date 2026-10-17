const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, Request, Response, Headers,
    require: name => name in mocks ? mocks[name] : require(name) });
  return mod.exports;
}
const rank = load('lib/playerRank.ts');
const prefs = load('lib/profilePreferences.ts');
const history = load('lib/profileHistory.ts');
const row = (id, tournament, created = '2026-10-11T18:00:00Z') => ({ id, tournament_id: tournament, mmr: 5, prestige_points: 0, created_at: created });

test('chart uses the scheduled event date and chronological order for backfilled games', () => {
  const rows = [row('a', 'late'), row('b', 'early'), row('bonus', null)];
  const points = history.buildProfileHistory(rows, [
    { id: 'late', name: 'FL #0910261', event_at: '2026-10-09T18:00:00Z', started_at: '2026-10-11T18:00:00Z', created_at: '2026-10-11T17:00:00Z' },
    { id: 'early', name: 'FL #0110261', event_at: '2026-10-01T18:00:00Z', started_at: null, created_at: '2026-10-11T17:00:00Z' },
  ]);
  assert.equal(points.map(p => p.id).join(','), 'b,a,bonus');
  assert.equal(points[0].playedAt, '2026-10-01T18:00:00Z');
  assert.equal(points[2].playedAt, rows[2].created_at);
  assert.equal(points[0].mmr, rows[1].mmr, 'display dates must not recalculate MMR');
});
test('missing tournament date uses started_at, then creation, then original entry time', () => {
  const t = { id: 't', name: 'T', event_at: null, started_at: '2026-10-05T18:00:00Z', created_at: '2026-10-04T18:00:00Z' };
  assert.equal(history.buildProfileHistory([row('a', 't')], [t])[0].playedAt, t.started_at);
  assert.equal(history.buildProfileHistory([row('a', 't')], [{ ...t, started_at: null }])[0].playedAt, t.created_at);
  assert.equal(history.buildProfileHistory([row('a', 'deleted')], [])[0].playedAt, row('a', 'deleted').created_at);
});
test('date bounds are inclusive Polish calendar days, including open-ended and empty ranges', () => {
  const points = ['2026-10-01T21:59:59Z', '2026-10-01T22:00:00Z', '2026-10-02T21:59:59Z', '2026-10-02T22:00:00Z'].map((playedAt, i) => ({ id: i, playedAt }));
  assert.equal(history.filterProfileHistory(points, '2026-10-02', '2026-10-02').map(p => p.id).join(','), '1,2');
  assert.equal(history.filterProfileHistory(points, '2026-10-02', null).length, 3);
  assert.equal(history.filterProfileHistory(points, null, null).length, 4);
  assert.equal(history.filterProfileHistory(points, '2027-01-01', null).length, 0);
  assert.equal(prefs.validChartRange('2026-02-30', null), false);
  assert.equal(prefs.validChartRange('2026-10-03', '2026-10-02'), false);
  assert.equal(prefs.validChartRange('2028-02-29', null), true);
});
test('panel eligibility includes own and lower ranks, with automatic fallback after demotion', () => {
  assert.equal(prefs.availablePanels('platinum').join(','), 'unranked,bronze,silver,gold,platinum');
  assert.equal(prefs.resolvePanelRank('gold', 'platinum'), 'gold');
  assert.equal(prefs.resolvePanelRank('master', 'platinum'), 'platinum');
  assert.equal(prefs.resolvePanelRank(null, 'master'), 'master');
  assert.equal(prefs.availablePanels('unranked').join(','), 'unranked');
});
test('zoom is anchored and bounded; panning cannot escape history', () => {
  const zoom = history.zoomChartWindow({ start: 0, span: 99 }, 100, 0.5, 0.75);
  assert.equal(zoom.start + zoom.span * 0.75, 99 * 0.75);
  assert.equal(history.zoomChartWindow(zoom, 100, 0.00001).span, 2);
  assert.equal(history.clampChartWindow({ start: 999, span: 10 }, 100).start, 89);
  assert.equal(history.clampChartWindow({ start: -10, span: 10 }, 100).start, 0);
});
test('history loader reads beyond both 80 entries and the database page limit', async () => {
  const all = Array.from({ length: 1201 }, (_, i) => row(String(i), 't'));
  const ranges = [];
  const { readProfileHistory } = load('lib/profileHistoryServer.ts', {
    '@/lib/profileHistory': history, '@/lib/profilePreferences': prefs,
    '@/lib/supabaseServer': { supabaseServer: { from(table) {
      const query = { select() { return this; }, eq() { return this; }, order() { return this; },
        range(start, end) { ranges.push(start); return { data: all.slice(start, end + 1), error: null }; },
        in() { assert.equal(table, 'tournaments'); return { data: [{ id: 't', event_at: '2026-09-01T12:00:00Z', name: 'T' }], error: null }; } };
      return query;
    } } },
  });
  const points = await readProfileHistory('player');
  assert.equal(points.length, 1201);
  assert.deepEqual(ranges, [0, 500, 1000]);
  assert.equal(points[1200].playedAt, '2026-09-01T12:00:00Z');
});

function api(options = {}) {
  let saved;
  const route = load('app/api/public/players/[id]/profile/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/supabaseServer': { supabaseServer: { from() { return {
      select() { return this; }, eq() { return this; }, maybeSingle() { return { data: { id: 'p' }, error: null }; },
      update(value) { saved = value; return this; }, single() { return { data: { id: 'p', ...saved }, error: null }; },
    }; } } },
    '@/lib/rating': {}, '@/lib/beers': { isKnownBeerName: () => true }, '@/lib/ui/playerProfile': { normalizeProfileColor: x => x },
    '@/app/api/admin/_auth': { readAuthContext: async () => options.auth ?? { ok: true, ctx: { playerId: 'p', isMainAdmin: false } } },
    '@/lib/profilePreferences': prefs, '@/lib/playerRank': rank,
    '@/lib/matchStats': { isStatView: v => ['last', 'recent', 'all'].includes(v) },
    '@/lib/profileHistoryServer': { readProfilePreferences: async () => ({ chart_from: null, chart_to: '2026-10-10', rank_panel: null }) },
    '@/lib/playerPerformance': { loadPlayerPerformance: async () => new Map([['p', { hasFinishedMatch: true, mmrManualOverride: false, effectiveMmr: 5.5, prestigePoints: 0 }]]) },
  });
  return { saved: () => saved, patch: body => route.PATCH(new Request('https://example.test/profile', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'p' }) }) };
}
test('profile API authorizes owner/admin and rejects forged higher panel without saving', async () => {
  for (const auth of [{ ok: false, error: 'unauthorized', status: 401 }, { ok: true, ctx: { playerId: 'other', isMainAdmin: false } }]) {
    const route = api({ auth });
    assert.ok([401, 403].includes((await route.patch({ rankPanel: 'gold' })).status));
    assert.equal(route.saved(), undefined);
  }
  const route = api();
  assert.equal((await route.patch({ rankPanel: 'master' })).status, 400);
  assert.equal(route.saved(), undefined);
  assert.equal((await route.patch({ rankPanel: 'gold' })).status, 200);
  assert.equal(route.saved().rank_panel, 'gold');
});
test('profile API merges partial date updates before validation and supports clearing settings', async () => {
  const route = api();
  assert.equal((await route.patch({ chartFrom: '2026-10-11' })).status, 400);
  assert.equal(route.saved(), undefined);
  assert.equal((await route.patch({ chartFrom: '2026-09-01', chartTo: null, rankPanel: null })).status, 200);
  assert.equal(route.saved().chart_from, '2026-09-01');
  assert.equal(route.saved().chart_to, null);
  assert.equal(route.saved().rank_panel, null);
});
test('profile statistics default is validated and saved only by owner or main admin', async () => {
  const route = api();
  assert.equal((await route.patch({ statsView: 'all' })).status, 200);
  assert.equal(route.saved().stats_view, 'all');
  assert.equal((await route.patch({ statsView: 'forged' })).status, 400);
  const other = api({ auth: { ok: true, ctx: { playerId: 'other', isMainAdmin: false } } });
  assert.equal((await other.patch({ statsView: 'recent' })).status, 403);
  assert.equal(other.saved(), undefined);
});
test('profile preferences SQL constraints and idempotent migration', { skip: !process.env.PROFILE_PGLITE_PATH }, async t => {
  const { PGlite } = require(process.env.PROFILE_PGLITE_PATH);
  const db = new PGlite(); t.after(() => db.close());
  await db.exec('create table players(id int primary key); insert into players values (1)');
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261011_profile_chart_preferences.sql'), 'utf8');
  await db.exec(migration);
  await db.exec("update players set chart_from='2026-09-01', rank_panel='gold' where id=1");
  await db.exec(migration);
  assert.equal((await db.query('select rank_panel from players')).rows[0].rank_panel, 'gold');
  await assert.rejects(db.exec("update players set chart_to='2026-08-01'"), /players_chart_date_range/);
  await assert.rejects(db.exec("update players set rank_panel='bogus'"), /players_rank_panel_value/);
});
