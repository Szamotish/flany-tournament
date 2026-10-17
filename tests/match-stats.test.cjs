const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: mod, exports: mod.exports, structuredClone, crypto, Request, Response, Headers, URL, AbortSignal, Date,
    require: name => name in mocks ? mocks[name] : require(name) });
  return mod.exports;
}
const notebook = load('lib/notebook.ts', { './beers': load('lib/beers.ts') });
const stats = load('lib/matchStats.ts', { './notebook': notebook });
const tournamentStats = load('lib/tournamentStats.ts', { './matchStats': stats });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const roster = [{ id: id(1), name: 'Maciek', teamId: id(10) }, { id: id(2), name: 'Franek', teamId: id(20) }];
function fixture() {
  const t = (n, date, privateGame = false) => ({ id: id(n), name: privateGame ? 'SECRET PARTY' : `Turniej ${n}`, mode: 'ranked',
    is_private: privateGame, event_at: date, started_at: null, created_at: '2026-10-17T12:00:00Z', name_day_number: 1, tournament_results: [{ placement: 1 }] });
  const m = (n, tournament) => ({ id: id(n), tournament_id: id(tournament), status: 'finished', team_a_id: id(10), team_b_id: id(20), score_a: 2, score_b: 1, round_no: 1, match_no: 1, created_at: '2026-10-17T12:00:00Z' });
  let doc = notebook.editThrow(notebook.newNotebook(roster), 0, id(1), 0, 'opponent', true);
  doc = notebook.editThrow(doc, 0, id(1), 1, 'center', true);
  doc.players[id(1)].finishedAt = doc.rotations[0].hits[0];
  doc.players[id(1)].beer = 'Tatra';
  return { tournaments: [t(100, '2026-10-10T12:00:00Z'), t(200, '2026-10-16T12:00:00Z', true)],
    matches: [m(101, 100), m(201, 200)], notebooks: [{ match_id: id(101), tournament_id: id(100), game_no: 1, document: doc, roster }],
    players: roster.map(p => ({ id: p.id, name: p.name, avatar_url: null })), members: roster.map(p => ({ player_id: p.id, team_id: p.teamId })) };
}
test('BO games aggregate once per match; penalty hits are included, beer finishes are separate samples', () => {
  const s = fixture();
  s.notebooks.push({ ...s.notebooks[0], game_no: 2, document: structuredClone(s.notebooks[0].document) });
  const summary = stats.playerStats(s, id(1)).views.all;
  assert.equal(summary.matches, 1); assert.equal(summary.expectedMatches, 2);
  assert.equal(summary.games, 2); assert.equal(summary.expectedGames, 6);
  assert.equal(summary.throws, 4); assert.equal(summary.hits, 2); assert.equal(summary.penaltyHits, 2);
  assert.equal(summary.accuracy, 50); assert.equal(summary.finishAverage, 1); assert.equal(summary.finishes, 2);
  assert.equal(summary.beers[0].count, 2);
  const last = stats.playerStats(s, id(1)).views.last;
  assert.equal(last.games, 0, 'latest unrecorded match must not fall back silently to older stats');
  assert.equal(last.accuracy, null); assert.equal(last.finishAverage, null);
});
test('unfinished matches, unplayed BO games and untouched rows are not zero results', () => {
  const s = fixture();
  assert.equal(stats.playerStats(s, id(2)).views.all.games, 0);
  s.notebooks.push({ ...s.notebooks[0], game_no: 4 });
  assert.equal(stats.buildGameStats(s).length, 1);
  s.matches[0].status = 'pending';
  assert.equal(stats.buildGameStats(s).length, 0);
});
test('last ten uses actual event date and retains missing coverage; accuracy is weighted by attempts', () => {
  const s = fixture();
  for (let n = 0; n < 11; n++) {
    s.tournaments.push({ ...s.tournaments[0], id: id(300+n), event_at: `2026-10-${String(n+1).padStart(2,'0')}T10:00:00Z` });
    s.matches.push({ ...s.matches[0], id: id(400+n), tournament_id: id(300+n) });
  }
  assert.equal(stats.playerStats(s, id(1)).views.recent.expectedMatches, 10);
  assert.equal(stats.orderedStatsMatches(s)[0].id, id(201));
  const game = stats.buildGameStats(s)[0];
  const summary = stats.summarizeStats([game, { ...game, game: 2, throws: 8, hits: 1, finish: null, penaltyHits: 0 }], [s.matches[0]]);
  assert.equal(summary.accuracy, 20); assert.equal(summary.finishes, 1);
});
test('private statistics contribute without serializing tournament IDs, names, dates or rosters', () => {
  const s = fixture();
  s.notebooks[0].match_id = id(201); s.notebooks[0].tournament_id = id(200);
  const profile = stats.playerStats(s, id(1));
  assert.equal(profile.views.last.hits, 1); assert.equal(profile.last, null);
  const home = stats.recentStatsAwards(s);
  assert.equal(home.awards.find(a => a.category === 'penalty').value, 1);
  const text = JSON.stringify([profile, home]);
  for (const secret of ['SECRET PARTY', id(201), id(200), id(20), '2026-10-16']) assert.equal(text.includes(secret), false);
});
test('leaders preserve ties and enforce accuracy sample; penalty award appears only after a hit', () => {
  const s = fixture(); const games = stats.buildGameStats(s);
  const base = { ...games[0], throws: 5, hits: 3, penaltyHits: 0 };
  const awards = stats.statsAwards(s, s.matches, [base, { ...base, playerId: id(2) }]);
  assert.equal(awards.find(a => a.category === 'accuracy').leaders.length, 2);
  assert.equal(awards.some(a => a.category === 'penalty'), false);
  assert.equal(stats.statsAwards(s, s.matches, games).some(a => a.category === 'accuracy'), false);
});
test('tournament detail separates games and keeps players without entries explicit', () => {
  const data = tournamentStats.tournamentStats(fixture(), id(100));
  assert.equal(data.matches.length, 1); assert.equal(data.matches[0].players.length, 2);
  assert.equal(data.matches[0].players.find(p => p.playerId === id(1)).games[0].penaltyHits, 1);
  assert.equal(data.matches[0].players.find(p => p.playerId === id(2)).summary.games, 0);
});
test('private tournament endpoint checks authorization before loading any statistics', async () => {
  for (const allowed of [false, true]) {
    let reads = 0;
    const route = load('app/api/public/tournaments/[id]/stats/route.ts', {
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
      '@/lib/notebook': notebook, '@/lib/tournamentStats': tournamentStats,
      '@/lib/matchStatsServer': { readMatchStatsSnapshot: async () => { reads++; return fixture(); } },
      '@/app/api/admin/_auth': { readAuthContext: async () => ({ ok: true, ctx: { isMainAdmin: false, playerId: id(1) } }) },
      '@/lib/supabaseServer': { supabaseServer: { from(table) { const result = { data: table === 'tournaments' ? { id: id(200), is_private: true } : allowed && table === 'tournament_players' ? { player_id: id(1) } : null, error: null }; return {
        select() { return this; }, eq() { return this; }, maybeSingle() { return result; }, limit() { return { data: [], error: null }; },
      }; } } },
    });
    const res = await route.GET(new Request('https://example.test/stats'), { params: Promise.resolve({ id: id(200) }) });
    assert.equal(res.status, allowed ? 200 : 403); assert.equal(reads, allowed ? 1 : 0);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
  }
});
test('oracle receives compact aggregate stats with no private event facts', () => {
  const s = fixture(); s.notebooks[0].match_id = id(201); s.notebooks[0].tournament_id = id(200);
  const oracle = load('lib/oracleMatchStats.ts', { './matchStats': stats, './oracleLeague': { resolveOraclePlayers: () => ({ players: [] }) } });
  const text = oracle.oracleMatchStatsFacts(s, 'Jak trafiam i piję?', id(1)).join('\n');
  assert.match(text, /karne 1/); assert.match(text, /celność 50%/); assert.match(text, /nie sekundy/);
  assert.equal(text.includes('SECRET PARTY'), false); assert.equal(text.includes(id(200)), false);
});
test('stats reader paginates notebooks, shares concurrent loads and rejects read failures', async () => {
  const s = fixture();
  const tables = { tournaments: s.tournaments, tournament_matches: s.matches, players: s.players, team_members: s.members,
    match_notebooks: Array.from({length:251}, () => s.notebooks[0]) };
  const reads=[];
  const reader = load('lib/matchStatsServer.ts', {
    './matchStats': stats, './playerPerformance': {}, './playerRank': {},
    './supabaseServer': { supabaseServer: { from(table) { let start=0,end=249; return {
      select(columns) { assert.ok(!columns.includes('*')); return this; }, order() { return this; },
      range(a,b) {start=a;end=b;return this;}, async abortSignal() { reads.push([table,start]);return { data:tables[table].slice(start,end+1),error:null }; },
    }; } } },
  });
  const [a,b]=await Promise.all([reader.readMatchStatsSnapshot(),reader.readMatchStatsSnapshot()]);
  assert.equal(a,b);assert.equal(a.notebooks.length,251);assert.equal(reads.length,6);
  await reader.readMatchStatsSnapshot();assert.equal(reads.length,6);
  const failing = load('lib/matchStatsServer.ts', {
    './matchStats': stats, './playerPerformance': {}, './playerRank': {},
    './supabaseServer': { supabaseServer: { from() { return {select(){return this;},order(){return this;},range(){return this;},abortSignal(){return {data:null,error:{code:'42P01'}};}}; } } },
  });
  await assert.rejects(failing.readMatchStatsSnapshot(),/match_stats_unavailable/);
});
test('stats preference migration is repeatable and rejects invalid views', { skip: !process.env.NOTEBOOK_PGLITE_PATH }, async t => {
  const { PGlite } = require(process.env.NOTEBOOK_PGLITE_PATH); const db = new PGlite(); t.after(() => db.close());
  await db.exec('create table players(id int primary key); insert into players values (1)');
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261017_stats_view.sql'), 'utf8');
  await db.exec(sql); await db.exec("update players set stats_view='all' where id=1"); await db.exec(sql);
  assert.equal((await db.query('select stats_view from players')).rows[0].stats_view, 'all');
  await assert.rejects(db.exec("update players set stats_view='forged'"), /players_stats_view_value/);
});
