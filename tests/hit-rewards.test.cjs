const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const notebook = require('../lib/notebook.ts');
const { buildHitRewards } = require('../lib/hitRewards.ts');
const { replayRanked } = require('../lib/rankedReplay.ts');
const { playerStats } = require('../lib/matchStats.ts');
const { buildProfileHistory } = require('../lib/profileHistory.ts');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const roster = [{ id: id(1), name: 'A', teamId: id(10) }, { id: id(2), name: 'B', teamId: id(20) }];
const at = '2026-11-06T12:00:00Z';
function document(hits) {
  let doc = notebook.newNotebook(roster);
  for (let i = 0; i < hits; i++) {
    if (i) doc.rotations.push(notebook.newRotation(roster));
    doc = notebook.editThrow(doc, i, id(1), 0, 'center', true);
  }
  return doc;
}
function fixture() {
  const tournaments = [{ id: id(100), name: 'T', mode: 'ranked', event_at: at, started_at: at, created_at: at, name_day_number: 1, is_private: false }];
  const matches = [{ id: id(101), tournament_id: id(100), status: 'finished', team_a_id: id(10), team_b_id: id(20),
    winner_team_id: id(20), score_a: 2, score_b: 3, round_no: 1, match_no: 1, created_at: at, ranked_finished_at: at }];
  const notes = [2, 1, 9, 3, 0].map((hits, i) => ({ match_id: id(101), tournament_id: id(100), game_no: i + 1, document: document(hits), roster }));
  return { tournaments, matches, notes };
}

test('BO5 has five independent caps; partial pools carry, extra hits expire and losers qualify', () => {
  const f = fixture(); const plan = buildHitRewards(f.tournaments, f.matches, f.notes);
  assert.deepEqual(plan.entries.map(e => [e.game_no, e.credited_hits, e.points]), [[1,2,0],[2,1,1],[3,3,1],[4,3,1]]);
  assert.equal(plan.remainder.get(id(1)), 0);
  assert.deepEqual(buildHitRewards(f.tournaments, f.matches, f.notes.slice().reverse()).entries, plan.entries);
  assert.equal(notebook.playerNotebookTotals(f.notes[2].document, id(1)).hits, 9, 'cap changes rewards, not recorded statistics');
});

test('opponent can and successful penalty both count, under one shared cap', () => {
  const f = fixture();
  let doc = notebook.editThrow(document(0), 0, id(1), 0, 'opponent', true);
  doc = notebook.editThrow(doc, 0, id(1), 1, 'center', true);
  let plan = buildHitRewards(f.tournaments, f.matches, [{ ...f.notes[0], document: doc }]);
  assert.equal(plan.entries[0].credited_hits, 2);
  assert.equal(plan.remainder.get(id(1)), 2);
  doc.rotations.push(notebook.newRotation(roster));
  doc = notebook.editThrow(doc, 1, id(1), 0, 'opponent', true);
  doc = notebook.editThrow(doc, 1, id(1), 1, 'center', true);
  plan = buildHitRewards(f.tournaments, f.matches, [{ ...f.notes[0], document: doc }]);
  assert.equal(plan.entries[0].credited_hits, 3);
  assert.equal(plan.entries[0].points, 1);
  assert.equal(plan.remainder.get(id(1)), 0);
});

test('pending/casual/BYE/unplayed games are excluded; corrections, reset and retries rebuild awards', () => {
  const f = fixture();
  assert.equal(buildHitRewards([{ ...f.tournaments[0], mode: 'normal' }], f.matches, f.notes).entries.length, 0);
  assert.equal(buildHitRewards(f.tournaments, [{ ...f.matches[0], status: 'pending' }], f.notes).entries.length, 0);
  assert.equal(buildHitRewards(f.tournaments, [{ ...f.matches[0], team_b_id: null }], f.notes).entries.length, 0);
  assert.equal(buildHitRewards(f.tournaments, [], f.notes).entries.length, 0);
  const shorter = [{ ...f.matches[0], score_a: 0, score_b: 1 }];
  assert.equal(buildHitRewards(f.tournaments, shorter, f.notes).remainder.get(id(1)), 2);
  f.notes[0].document = document(0);
  assert.equal(buildHitRewards(f.tournaments, f.matches, f.notes).entries.reduce((s, e) => s + e.points, 0), 2);
  assert.throws(() => buildHitRewards(f.tournaments, f.matches, [f.notes[1], f.notes[1]]), /duplicate/);
});

test('private/backfilled games contribute chronologically and window statistics sum awarded points, not averages', () => {
  const f = fixture();
  f.tournaments.push({ ...f.tournaments[0], id: id(200), name: 'PRIVATE', is_private: true, event_at: '2026-11-05T12:00:00Z' });
  f.matches.push({ ...f.matches[0], id: id(201), tournament_id: id(200), score_a: 0, score_b: 1 });
  f.matches[0] = { ...f.matches[0], score_a: 0, score_b: 1 };
  const notes = [{ ...f.notes[0], document: document(1) }, { ...f.notes[0], tournament_id: id(200), match_id: id(201), document: document(2) }];
  const plan = buildHitRewards(f.tournaments, f.matches, notes);
  assert.equal(plan.entries[1].match_id, id(101));
  assert.equal(plan.entries[1].points, 1);
  const snapshot = { ...f, notebooks: notes, hitRewards: plan.entries, members: roster.map(p => ({ team_id: p.teamId, player_id: p.id })),
    players: roster.map(p => ({ ...p, avatar_url: null, ranked_hit_remainder: plan.remainder.get(p.id) ?? 0 })) };
  const stats = playerStats(snapshot, id(1));
  assert.equal(stats.views.last.hitPoints, 1);
  assert.equal(stats.views.recent.hitPoints, 1);
  assert.equal(stats.views.all.hitPoints, 1);
  assert.equal(stats.hitProgress, 0);
  assert.equal(JSON.stringify(stats).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(stats).includes(id(201)), false);
});

test('replay awards hits after champion, without streak multipliers, and chart preserves a distinct following point', () => {
  const initial = new Map([[id(1), { mmr: 10, prestigePoints: 10 }], [id(2), { mmr: 10, prestigePoints: 10 }]]);
  const events = [
    { kind: 'hits', id: 'hits', at, tournamentId: id(100), playerId: id(1), points: 3 },
    { kind: 'match', id: id(101), at, tournamentId: id(100), winners: [id(1)], losers: [id(2)], order: 1, oneVsOne: false },
    { kind: 'champion', id: id(100), at, tournamentId: id(100), players: [id(1)] },
  ];
  const replay = replayRanked(initial, events);
  const rows = replay.history.filter(r => r.player_id === id(1)).map((r, i) => ({ ...r, id: String(9 - i) }));
  assert.deepEqual(rows.map(r => r.reason), ['match_win','tournament_win','hit_bonus']);
  assert.equal(replay.states.get(id(1)).prestigePoints, 17);
  assert.equal(replay.streaks.get(id(1)).wins, 1);
  assert.equal(replayRanked(initial, events).states.get(id(1)).prestigePoints, 17);
  assert.equal(replayRanked(initial, events.slice(1)).states.get(id(1)).prestigePoints, 14);
  const points = buildProfileHistory(rows, fixture().tournaments, { baseline: initial.get(id(1)), current: replay.states.get(id(1)) });
  assert.deepEqual(points.map(p => p.prestigePoints), [14,17]);
  assert.equal(points[1].eventLabel, 'Premia za trafienia');
  assert.equal(points[0].playedAt, points[1].playedAt);
  const below = replayRanked(new Map([[id(1), { mmr: 9.9, prestigePoints: 0 }]]), [events[0]]);
  assert.deepEqual(below.states.get(id(1)), { mmr: 10, prestigePoints: 2 });
});

test('ranking service persists per-game ledger and pool atomically and retries stale revisions', async () => {
  const f = fixture(); const calls = [];
  const baselines = new Map(roster.map(p => [p.id, { playerId: p.id, mmr: 5, prestigePoints: 0 }]));
  const tables = { players: roster.map(p => ({ id: p.id, mmr: 5, prestige_points: 0 })), tournaments: f.tournaments,
    tournament_matches: f.matches, team_members: roster.map(p => ({ player_id: p.id, team_id: p.teamId })),
    tournament_results: [], player_performance_bonuses: [], ratings: [], player_mmr_history: [], match_notebooks: f.notes };
  const server = { from(table) { return { select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; },
    single() { return { data: { revision: calls.length }, error: null }; }, range(a,b) { return { data: tables[table].slice(a,b+1), error: null }; } }; },
    rpc(name, payload) { calls.push(payload); assert.equal(name, 'persist_ranked_replay_with_hit_rewards'); return { data: calls.length > 1, error: null }; } };
  const mocks = { '@/lib/supabaseServer': { supabaseServer: server }, '@/lib/rating': { trimmedMean: () => 5 },
    '@/lib/tournamentFormat': { isOneVsOneFormat: () => false }, '@/lib/rankedReplay': { replayRanked },
    '@/lib/hitRewards': { buildHitRewards }, '@/lib/matchStatsServer': { invalidateMatchStatsCache() {} },
    '@/lib/rankedBaseline': { loadRankedBaselines: async () => baselines, inferRankedBaselinesFromHistory: async () => new Map(), ensureRankedBaselines: async () => baselines } };
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/rankedRecalculate.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: mod.exports, module: mod, require: name => { assert.ok(name in mocks, name); return mocks[name]; } });
  await mod.exports.recalculateRankedMmr();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].hit_rewards.reduce((s,e) => s + e.points, 0), 3);
  assert.equal(calls[1].history_rows.filter(r => r.reason === 'hit_bonus').length, 1);
  assert.equal(calls[1].player_updates.find(p => p.id === id(1)).ranked_hit_remainder, 0);
  tables.players = tables.players.filter(p => p.id !== id(1));
  baselines.delete(id(1));
  await mod.exports.recalculateRankedMmr();
  assert.equal(calls[2].hit_rewards.length, 0, 'deleted players retained in notebook snapshots cannot break league recalculation');
});
