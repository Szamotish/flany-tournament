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

test('penalties are separate dated points with actual deductions and deterministic same-time order', () => {
  const at = '2026-11-10T12:00:00Z';
  const rows = [
    {...row('b',null,at),reason:'admin_penalty',mmr:10,prestige_points:12},
    {...row('a',null,at),reason:'admin_penalty',mmr:10,prestige_points:6},
    {...row('bonus',null,at),reason:'performance_bonus',mmr:10,prestige_points:18},
  ];
  const options = {baseline:{mmr:10,prestigePoints:10},current:{mmr:10,prestigePoints:6}};
  const points = history.buildProfileHistory(rows,[],options);
  assert.equal(points.filter(p=>p.eventLabel==='Kara punktowa').length,2);
  assert.ok(points.filter(p=>p.eventLabel==='Kara punktowa').every(p=>p.changeLabel==='-6 PP' && p.playedAt===at));
  assert.equal(JSON.stringify(history.buildProfileHistory(rows.slice().reverse(),[],options)),JSON.stringify(points));
  assert.equal(points.at(-1).prestigePoints,6);
});

test('chart uses the scheduled event date and chronological order for backfilled games', () => {
  const rows = [row('a', 'late'), row('b', 'early'), row('bonus', null)];
  const points = history.buildProfileHistory(rows, [
    { id: 'late', name: 'FL #0910261', event_at: '2026-10-09T18:00:00Z', started_at: '2026-10-11T18:00:00Z', created_at: '2026-10-11T17:00:00Z' },
    { id: 'early', name: 'FL #0110261', event_at: '2026-10-01T18:00:00Z', started_at: null, created_at: '2026-10-11T17:00:00Z' },
  ]);
  assert.equal(points.map(p => p.id).join(','), 'tournament:early,tournament:late,bonus');
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

test('backfilled November tournament shares its date with history while a separate bonus keeps its own date and label', () => {
  const t = { id: 't', name: 'FL #0111263', event_at: '2026-11-01T14:50:00+00:00', started_at: '2026-11-04T14:55:20+00:00', created_at: '2026-11-04T14:51:09+00:00' };
  const points = history.buildProfileHistory([
    { ...row('match', 't', '2026-11-04T15:00:56Z'), reason: 'match_win' },
    { ...row('bonus', null, '2026-11-04T14:53:35Z'), reason: 'performance_bonus' },
  ], [t]);
  assert.equal(history.tournamentHistoryDate(t), t.event_at);
  assert.equal(history.profileHistoryDay(points[0].playedAt), '2026-11-01');
  assert.equal(points[0].tournamentName, t.name);
  assert.equal(history.profileHistoryDay(points[1].playedAt), '2026-11-04');
  assert.equal(points[1].eventLabel, 'Premia za performance');
  assert.equal(points[1].tournamentName, null);
});

test('backfilled wins and same-time champion rewards form a chronological ledger ending at the actual 33 PP', () => {
  const tournament = (id, date, number) => ({ id, name: id, event_at: date, started_at: date, created_at: date, name_day_number: number });
  const tournaments = [tournament('FL #3110261', '2026-10-31T19:23:50Z', 1), tournament('FL #3110262', '2026-10-31T20:01:04Z', 2),
    tournament('FL #0111262', '2026-11-01T02:30:15Z', 2), tournament('FL #0111263', '2026-11-01T14:50:00Z', 3)];
  const entry = (id, tournament_id, reason, pp, at) => ({ id, tournament_id, reason, mmr: 10, prestige_points: pp, created_at: at });
  const rows = [
    entry('a-champion', tournaments[0].id, 'tournament_win', 27, '2026-10-31T19:55:34Z'),
    entry('z-match', tournaments[0].id, 'match_win', 24, '2026-10-31T19:55:34Z'),
    entry('match2', tournaments[1].id, 'match_win', 28, '2026-10-31T20:12:58Z'),
    entry('champion2', tournaments[1].id, 'tournament_win', 31, '2026-10-31T20:12:58Z'),
    entry('loss', tournaments[2].id, 'match_loss', 22, '2026-11-04T14:49:30Z'),
    entry('bonus', null, 'performance_bonus', 29, '2026-11-04T14:53:35Z'),
    entry('a-champion3', tournaments[3].id, 'tournament_win', 33, '2026-11-04T15:00:56Z'),
    entry('z-match3', tournaments[3].id, 'match_win', 30, '2026-11-04T15:00:56Z'),
  ];
  const options = { baseline: { mmr: 10, prestigePoints: 23 }, current: { mmr: 10, prestigePoints: 33 } };
  const points = history.buildProfileHistory(rows, tournaments, options);
  assert.equal(points.length, 5, 'match + champion must be one point per tournament');
  assert.equal(points.map(p => p.prestigePoints).join(','), '27,31,22,26,33');
  assert.equal(points[0].changeLabel, '+4 PP (mecze +1 PP, wygrana turnieju +3 PP)');
  assert.equal(points[1].changeLabel, points[0].changeLabel);
  assert.equal(points[2].changeLabel, '-9 PP');
  assert.equal(points[3].changeLabel, points[0].changeLabel);
  assert.equal(points[4].changeLabel, '+7 PP');
  assert.equal(points[4].eventLabel, 'Premia za performance');
  assert.equal(history.profileHistoryDay(points[3].playedAt), '2026-11-01');
  assert.equal(history.profileHistoryDay(points[4].playedAt), '2026-11-04');
  assert.equal(history.filterProfileHistory(points, '2026-11-01', null)[0].prestigePoints, 22, 'date filtering must not reset the balance');
  assert.equal(JSON.stringify(history.buildProfileHistory(rows.slice().reverse(), tournaments, options)), JSON.stringify(points));
  assert.equal(rows[0].prestige_points, 27, 'building a chart never changes stored awards');
  assert.throws(() => history.buildProfileHistory(rows, tournaments, { ...options, current: { mmr: 10, prestigePoints: 34 } }), /current_mismatch/);
});

test('actual movements preserve cap transitions, clipped prestige losses, and manual changes', () => {
  const rows = [
    { ...row('win', 't', '2026-10-01T12:00:00Z'), reason: 'match_win', mmr: 10, prestige_points: 1 },
    { ...row('loss', 'u', '2026-10-02T12:00:00Z'), reason: 'match_loss', mmr: 10, prestige_points: 0 },
    { ...row('manual', null, '2026-10-03T12:00:00Z'), reason: 'admin_set_mmr', mmr: 8, prestige_points: 0 },
    { ...row('bonus', null, '2026-10-04T12:00:00Z'), reason: 'performance_bonus', mmr: 8.5, prestige_points: 0 },
  ];
  const points = history.buildProfileHistory(rows, [], { baseline: { mmr: 9.9, prestigePoints: 0 }, current: { mmr: 8.5, prestigePoints: 0 } });
  assert.equal(points.map(p => `${p.mmr}:${p.prestigePoints}`).join(','), '10:1,10:0,8:0,8.5:0');
  assert.equal(points[1].changeLabel, '-1 PP', 'use the one point actually lost, not the nominal -9 PP penalty');
  assert.equal(points[2].eventLabel, 'Ręczna zmiana MMR');
});

test('same-time rounds follow match order, and equal event dates use the daily tournament number', () => {
  const at = '2026-10-05T12:00:00Z';
  const rows = [
    { ...row('a', 'second', at), match_id: 'a-match', reason: 'match_loss', mmr: 10, prestige_points: 2 },
    { ...row('z', 'first', at), match_id: 'z-match', reason: 'match_win', mmr: 10, prestige_points: 11 },
  ];
  const tournaments = ['second', 'first'].map((id, i) => ({ id, name: id, event_at: at, name_day_number: 2 - i }));
  const points = history.buildProfileHistory(rows, tournaments, { baseline: { mmr: 10, prestigePoints: 10 },
    matches: [{ id: 'z-match', round_no: 1, match_no: 1 }, { id: 'a-match', round_no: 2, match_no: 1 }] });
  assert.equal(points.map(p => p.tournamentName).join(','), 'first,second');
  assert.equal(points.map(p => p.changeLabel).join(','), '+1 PP,-9 PP');
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
  const all = Array.from({ length: 1201 }, (_, i) => ({ ...row(String(i), 't', new Date(Date.UTC(2026, 9, 11, 0, 0, i)).toISOString()),
    reason: 'match_win', mmr: 10, prestige_points: i + 1 }));
  const ranges = [];
  const { readProfileHistory } = load('lib/profileHistoryServer.ts', {
    '@/lib/profileHistory': history, '@/lib/profilePreferences': prefs,
    '@/lib/supabaseServer': { supabaseServer: { from(table) {
      const query = { select() { return this; }, eq() { return this; }, order() { return this; },
        maybeSingle() { assert.equal(table, 'player_ranked_baselines'); return { data: { baseline_mmr: 10, baseline_prestige_points: 0 }, error: null }; },
        range(start, end) { ranges.push(start); return { data: all.slice(start, end + 1), error: null }; },
        in() { assert.equal(table, 'tournaments'); return { data: [{ id: 't', event_at: '2026-09-01T12:00:00Z', name: 'T' }], error: null }; } };
      return query;
    } } },
  });
  const points = await readProfileHistory('player');
  assert.equal(points.length, 1);
  assert.deepEqual(ranges, [0, 500, 1000]);
  assert.equal(points[0].playedAt, '2026-09-01T12:00:00Z');
  assert.equal(points[0].prestigePoints, 1201);
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
