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
  vm.runInNewContext(code, { module: mod, exports: mod.exports, AbortSignal,
    require: name => name in mocks ? mocks[name] : require(name) });
  return mod.exports;
}
const rules = load('lib/bestPerformance.ts');
const ranks = load('lib/playerRank.ts');
const tournament = (id, day, overrides = {}) => ({ id, name: `Turniej ${id}`, mode: 'ranked', format: 'single_elim',
  event_at: `2026-10-${String(day).padStart(2,'0')}T18:00:00Z`, created_at: '2026-10-20T18:00:00Z',
  started_at: null, is_private: false, name_day_number: 1, ...overrides });
const winner = (id, team) => ({ tournament_id: id, team_id: team, placement: 1 });
const match = (id, a, b, status = 'finished') => ({ tournament_id: id, team_a_id: a, team_b_id: b, status });
const member = (team, player) => ({ team_id: team, player_id: player });

test('last ten finished ranked tournaments include duels/private games and use actual dates', () => {
  const tournaments = Array.from({ length: 12 }, (_, i) => tournament(String(i + 1), i + 1));
  tournaments[10].format = 'one_vs_one'; tournaments[11].is_private = true;
  tournaments.push(tournament('normal', 22, { mode: 'normal' }), tournament('pending', 23));
  const results = tournaments.filter(t => t.id !== 'pending').map(t => winner(t.id, t.id));
  const window = rules.selectPerformanceWindow(tournaments, results);
  assert.equal(window.map(t => t.id).join(','), '3,4,5,6,7,8,9,10,11,12');
  assert.equal(window.length, 10);
  assert.equal(window[8].format, 'one_vs_one');
  assert.equal(window[9].is_private, true);
});
test('missing event dates fall back to start/creation and same-time tournaments use daily sequence', () => {
  const a = tournament('a', 1, { name_day_number: 2 });
  const b = tournament('b', 1, { name_day_number: 1 });
  const c = tournament('c', 1, { event_at: null, started_at: '2026-10-02T20:00:00Z' });
  const d = tournament('d', 1, { event_at: null, started_at: null });
  assert.equal(rules.selectPerformanceWindow([a,b,c,d], [a,b,c,d].map(t => winner(t.id, t.id))).map(t => t.id).join(','), 'b,a,c,d');
});
test('whole tournament wins count once; earlier round wins and missing podium rows are losses', () => {
  const window = [tournament('a',1), tournament('b',2), tournament('c',3)];
  const members = [member('a1','p'),member('a1','p'),member('a1','q'),member('a2','r'),member('a3','s'),member('b1','r'),member('b2','p'),member('c1','p'),member('c2','r')];
  const results = [winner('a','a1'),winner('b','b1'),winner('c','c1')];
  const matches = [match('a','a1','a2'),match('a','a1','a3'),match('a','a1','a2'),match('b','b1','b2'),match('c','c1','c2')];
  const leaders = rules.scoreBestPerformance(window, results, matches, members);
  assert.equal(leaders.length, 1);
  assert.equal(leaders[0].playerId, 'p');
  assert.equal(leaders[0].wins, 2);
  assert.equal(leaders[0].played, 3);
  assert.equal(leaders[0].outcomes.join(','), 'win,loss,win');
  // Every winning teammate is counted, including when team sizes differ.
  const single = rules.scoreBestPerformance(window.slice(0,1), results, matches, members);
  assert.equal(single.map(p => p.playerId).sort().join(','), 'p,q');
});
test('ties are retained regardless of appearance count and BYEs are not participation', () => {
  const window = [tournament('a',1),tournament('b',2),tournament('c',3)];
  const results = [winner('a','a1'),winner('b','b1'),winner('c','c1')];
  const members = [member('a1','p'),member('a2','r'),member('b1','q'),member('b2','p'),member('c1','r'),member('c2','p'),member('bye','q')];
  const scores = rules.scoreBestPerformance(window, results, [match('a','a1','a2'),match('b','b1','b2'),match('c','c1','c2'),match('a','bye',null),match('c','bye','c1','pending')], members);
  assert.equal(scores.length, 3);
  assert.equal(scores.find(s => s.playerId === 'q').outcomes.join(','), 'absent,win,absent');
  assert.equal(scores.find(s => s.playerId === 'p').played, 3);
});
test('reopening/resetting finals removes them from the window; fewer than ten works', () => {
  const ts = [tournament('a',1), tournament('b',2)];
  assert.equal(rules.selectPerformanceWindow(ts, [winner('a','a')]).length, 1);
  assert.equal(rules.selectPerformanceWindow(ts, []).length, 0);
  assert.equal(rules.scoreBestPerformance([], [], [], []).length, 0);
});
test('private marker data includes neither identifiers, real names nor format/link', () => {
  const markers = rules.performanceMarkers([tournament('SECRET_ID',1, { name: 'SECRET_NAME', is_private: true }), tournament('public',2)]);
  assert.equal(markers[0].name, 'Turniej prywatny');
  assert.equal(markers[0].href, null);
  assert.equal(markers[0].format, null);
  assert.ok(!JSON.stringify(markers).includes('SECRET'));
  assert.equal(markers[1].href, '/tournaments/public');
});

test('server paginates completed tournaments, limits roster reads to window and returns real ranks', async () => {
  const tournaments = Array.from({ length: 502 }, (_, i) => ({ ...tournament(String(i), 1),
    event_at: new Date(Date.UTC(2024,0,i+1)).toISOString(), tournament_results: [winner(String(i),'team'+i)] }));
  tournaments[501].is_private = true; tournaments[501].name = 'SECRET_TITLE';
  const reads = [];
  const db = { from(table) {
    let filter;
    const query = {
      select(columns) { reads.push({ table, columns }); return this; },
      in(column, values) { filter = { column, values }; return this; },
      eq(column, value) { reads.push({ column, value }); return this; }, order() { return this; },
      range(start, end) {
        reads.push({ table, start, filter });
        return { abortSignal() {
          let data;
          if (table === 'tournaments') data = tournaments;
          else if (table === 'tournament_matches') data = filter.values.map(id => match(id, 'team'+id, 'loser'+id));
          else if (table === 'team_members') data = filter.values.map(id => member(id,id.startsWith('team') ? 'p' : 'q'));
          else if (table === 'players') data = [{ id: 'p', name: 'Gracz', avatar_url: null }];
          return { data: data.slice(start,end+1), error: null };
        } };
      },
    };
    return query;
  } };
  const server = load('lib/bestPerformanceServer.ts', {
    '@/lib/supabaseServer': { supabaseServer: db }, '@/lib/bestPerformance': rules, '@/lib/playerRank': ranks,
    '@/lib/playerPerformance': { loadPlayerPerformance: async () => new Map([['p',{ hasFinishedMatch:true, mmrManualOverride:false, effectiveMmr:10, prestigePoints:125 }]]) },
  });
  const data = await server.readBestPerformance();
  assert.equal(data.leaders[0].wins, 10);
  assert.equal(data.leaders[0].rank, 'grandmaster');
  assert.equal(data.tournaments.length, 10);
  assert.equal(data.tournaments.at(-1).name, 'Turniej prywatny');
  assert.ok(!JSON.stringify(data).includes('SECRET_TITLE'));
  assert.ok(reads.some(r => r.table === 'tournaments' && r.start === 500));
  assert.equal(reads.find(r => r.table === 'tournament_matches' && r.filter).filter.values.length, 10);
  assert.ok(reads.some(r => r.column === 'tournament_results.placement' && r.value === 1));
});
test('database errors fail explicitly rather than awarding a partial result', async () => {
  const query = { select(){return this}, eq(){return this}, order(){return this}, range(){return this}, abortSignal(){return {data:null,error:{message:'failure'}}} };
  const server = load('lib/bestPerformanceServer.ts', {
    '@/lib/supabaseServer': { supabaseServer: { from: () => query } }, '@/lib/bestPerformance': rules, '@/lib/playerRank': ranks,
    '@/lib/playerPerformance': {},
  });
  await assert.rejects(server.readBestPerformance(), /unavailable/);
});
