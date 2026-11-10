const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  module._compile(source, filename);
};
const { replayRanked } = require('../lib/rankedReplay.ts');
const { applyRankedDelta, applyRankedPenalty } = require('../lib/ranked.ts');
const { lossStreakTier } = require('../lib/rankedStreak.ts');
const at = (i) => new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
const baseline = () => new Map([['p', { mmr: 5, prestigePoints: 0 }], ['q', { mmr: 5, prestigePoints: 0 }]]);
const match = (i, { duel = false, won = true, tournamentId = `t${i}` } = {}) => ({
  kind: 'match', id: `m${i}`, at: at(i), tournamentId, order: i,
  winners: [won ? 'p' : 'q'], losers: [won ? 'q' : 'p'], oneVsOne: duel,
});
const champion = (i, tournamentId = `t${i}`) => ({ kind: 'champion', id: tournamentId, at: at(i), tournamentId, players: ['p'] });
const wins = (n) => Array.from({ length: n }, (_, i) => [match(i), champion(i)]).flat();
const playerHistory = (r) => r.history.filter((h) => h.player_id === 'p');
const performance = (i, delta = 0.2) => ({ kind: 'performance', id: `b${i}`, at: at(i), playerId: 'p', delta });

test('first 3 tournament wins are normal; wins 4–6 give +0.1 to both rewards; win 7 gives +0.2', () => {
  const r = replayRanked(baseline(), wins(7));
  assert.deepEqual(playerHistory(r).map((h) => h.delta), [0.1, 0.3, 0.1, 0.3, 0.1, 0.3, 0.2, 0.4, 0.2, 0.4, 0.2, 0.4, 0.3, 0.5]);
  assert.equal(r.states.get('p').mmr, 8.8);
  assert.equal(r.streaks.get('p').wins, 7);
});

test('several rounds count as exactly one tournament; bonus applies to every positive round reward', () => {
  const r = replayRanked(baseline(), [...wins(3), match(4, { tournamentId: 'multi' }), match(5, { tournamentId: 'multi' }), champion(5, 'multi')]);
  assert.equal(r.streaks.get('p').wins, 4);
  assert.deepEqual(playerHistory(r).slice(-3).map((h) => h.delta), [0.2, 0.2, 0.4]);
  const unfinished = replayRanked(baseline(), [match(0), match(1)]);
  assert.equal(unfinished.streaks.get('p').wins, 0);
});

test('first ranked round loss resets streak immediately, even before tournament ends', () => {
  const r = replayRanked(baseline(), [...wins(4), match(5, { won: false }), match(6), champion(6)]);
  assert.equal(r.streaks.get('p').wins, 1);
  assert.deepEqual(playerHistory(r).slice(-3).map((h) => h.delta), [-0.3, 0.1, 0.3]);
});

test('only first two duels count; later duels get normal points with no streak bonus', () => {
  const initial = baseline();
  initial.set('q', { mmr: 7, prestigePoints: 0 });
  const r = replayRanked(initial, [...wins(3), match(4, { duel: true }), match(5, { duel: true }), match(6, { duel: true }), match(7, { duel: true })]);
  assert.deepEqual(r.streaks.get('p'), { wins: 5, duelWins: 2 });
  assert.deepEqual(playerHistory(r).slice(-4).map((h) => h.delta), [0.2, 0.2, 0.1, 0.1]);
});

test('a multiplayer round does not unlock duels; winning its tournament does', () => {
  const r = replayRanked(baseline(), [match(0, { duel: true }), match(1, { duel: true }), match(2), match(3, { duel: true }), champion(4, 't2'), match(5, { duel: true }), match(6, { duel: true }), match(7, { duel: true })]);
  assert.deepEqual(r.streaks.get('p'), { wins: 5, duelWins: 2 });
});

test('even a blocked duel loss resets the streak and duel allowance', () => {
  const r = replayRanked(baseline(), [match(0, { duel: true }), match(1, { duel: true }), match(2, { duel: true, won: false })]);
  assert.deepEqual(r.streaks.get('p'), { wins: 0, duelWins: 0 });
});

test('favored 1v1 win with zero base reward cannot farm bonus points', () => {
  const initial = baseline();
  initial.set('q', { mmr: 0, prestigePoints: 0 });
  const r = replayRanked(initial, [...wins(3), match(4, { duel: true })]);
  assert.equal(playerHistory(r).at(-1).delta, 0);
  assert.equal(r.streaks.get('p').wins, 4);
});

test('performance grants survive replay, do not increase streak, and work without matches', () => {
  const events = [performance(1), performance(2, 0.3)];
  const first = replayRanked(baseline(), events);
  const second = replayRanked(baseline(), events);
  assert.deepEqual(first, second);
  assert.equal(first.states.get('p').mmr, 5.5);
  assert.equal(first.streaks.size, 0);
});

test('performance and streak bonuses convert at 10 PP/MMR, including crossing Master threshold', () => {
  assert.deepEqual(applyRankedDelta({ mmr: 9.9, prestigePoints: 0 }, 0.2), { mmr: 10, prestigePoints: 1 });
  assert.deepEqual(applyRankedDelta({ mmr: 10, prestigePoints: 23 }, 0.2), { mmr: 10, prestigePoints: 25 });
  const initial = baseline();
  initial.set('p', { mmr: 10, prestigePoints: 0 });
  const r = replayRanked(initial, wins(7));
  assert.equal(r.states.get('p').prestigePoints, 38);
});

test('performance grants replay at their original time, before later prestige losses', () => {
  const initial = baseline();
  initial.set('p', { mmr: 10, prestigePoints: 0 });
  const r = replayRanked(initial, [match(2, { won: false }), performance(1)]);
  assert.deepEqual(r.states.get('p'), { mmr: 10, prestigePoints: 0 });
});

test('removing/resetting results rebuilds streak and keeps performance awards', () => {
  const events = [...wins(4), performance(5)];
  const r = replayRanked(baseline(), events.filter((e) => e.tournamentId !== 't3'));
  assert.equal(r.streaks.get('p').wins, 3);
  assert.equal(r.states.get('p').mmr, 6.4);
  const empty = replayRanked(baseline(), [performance(5)]);
  assert.equal(empty.states.get('p').mmr, 5.2);
  assert.equal(empty.streaks.size, 0);
});

test('out-of-order input replays deterministically and does not mutate baseline', () => {
  const initial = baseline();
  assert.deepEqual(replayRanked(initial, wins(7)), replayRanked(initial, wins(7).reverse()));
  assert.equal(initial.get('p').mmr, 5);
});

test('manual rank edits are retained on subsequent automatic recalculations', () => {
  const events = [...wins(3), { kind: 'manual', id: 'manual', at: at(4), playerId: 'p', state: { mmr: 9, prestigePoints: 0 } }, performance(5)];
  assert.equal(replayRanked(baseline(), events).states.get('p').mmr, 9.2);
});

test('lose streak counts each lost round, including several rounds in one tournament, without extra penalties', () => {
  const events = Array.from({ length: 6 }, (_, i) => match(i, { won: false, tournamentId: 'multi' }));
  const r = replayRanked(baseline(), events);
  assert.equal(r.lossStreaks.get('p'), 6);
  assert.equal(r.states.get('p').mmr, 3.2);
  assert.deepEqual(playerHistory(r).map((h) => h.delta), Array(6).fill(-0.3));
  assert.equal(r.streaks.get('p').wins, 0);
});

test('a ranked round win resets lose streak before the tournament finishes', () => {
  const losses = Array.from({ length: 3 }, (_, i) => match(i, { won: false }));
  const r = replayRanked(baseline(), [...losses, match(4)]);
  assert.equal(r.lossStreaks.get('p'), 0);
  assert.equal(r.streaks.get('p').wins, 0);
  assert.equal(replayRanked(baseline(), [...losses, match(4), match(5, { won: false })]).lossStreaks.get('p'), 1);
});

test('ranked 1v1 losses have no streak cap and retain their normal penalties', () => {
  const r = replayRanked(baseline(), Array.from({ length: 8 }, (_, i) => match(i, { won: false, duel: true })));
  assert.equal(r.lossStreaks.get('p'), 8);
  assert.equal(r.states.get('p').mmr, 4.2);
  assert.deepEqual(playerHistory(r).map((h) => h.delta), Array(8).fill(-0.1));
});

test('a favored zero-point duel win still breaks lose streak', () => {
  const initial = baseline();
  initial.set('p', { mmr: 10, prestigePoints: 0 });
  initial.set('q', { mmr: 0, prestigePoints: 0 });
  const losses = Array.from({ length: 3 }, (_, i) => match(i, { won: false }));
  const r = replayRanked(initial, [...losses, match(4, { duel: true })]);
  assert.equal(playerHistory(r).at(-1).delta, 0);
  assert.equal(r.lossStreaks.get('p'), 0);
});

test('performance and manual points do not clear losses or add extra PP penalties', () => {
  const initial = baseline();
  initial.set('p', { mmr: 10, prestigePoints: 100 });
  const losses = Array.from({ length: 6 }, (_, i) => match(i, { won: false }));
  const r = replayRanked(initial, [...losses, performance(7)]);
  assert.equal(r.lossStreaks.get('p'), 6);
  assert.deepEqual(r.states.get('p'), { mmr: 10, prestigePoints: 66 });
  const manual = { kind: 'manual', id: 'edit', at: at(8), playerId: 'p', state: { mmr: 9, prestigePoints: 0 } };
  assert.equal(replayRanked(initial, [...losses, manual]).lossStreaks.get('p'), 6);
});

test('correcting or resetting matches rebuilds lose streak deterministically', () => {
  const losses = Array.from({ length: 6 }, (_, i) => match(i, { won: false }));
  assert.deepEqual(replayRanked(baseline(), losses), replayRanked(baseline(), [...losses].reverse()));
  const corrected = [...losses.slice(0, 3), match(3), ...losses.slice(4)];
  assert.equal(replayRanked(baseline(), corrected).lossStreaks.get('p'), 2);
  assert.equal(replayRanked(baseline(), losses.slice(0, 2)).lossStreaks.get('p'), 2);
  assert.equal(replayRanked(baseline(), []).lossStreaks.get('p') ?? 0, 0);
});

test('losestreak is hidden below 3, frosted at 3–5 and frozen from 6', () => {
  assert.deepEqual([0, 1, 2, 3, 5, 6, 12].map(lossStreakTier), ['none', 'none', 'none', 'frost', 'frost', 'frozen', 'frozen']);
});

test('all ordinary losses cost -6 PP even with legacy snapshots; duels and MMR losses keep their rules', () => {
  const initial = new Map([['p', { mmr: 10, prestigePoints: 100 }], ['q', { mmr: 10, prestigePoints: 100 }]]);
  const old = { ...match(1, { won: false }), prestigeLossPoints: 9 };
  const current = { ...match(2, { won: false }), prestigeLossPoints: 6 };
  const events = [old, current, { ...match(3, { won: false, duel: true }), prestigeLossPoints: 6 }];
  const result = replayRanked(initial, events);
  assert.deepEqual(playerHistory(result).map(h => h.prestige_points), [94,88,85]);
  assert.deepEqual(result, replayRanked(initial, events.slice().reverse()));
  assert.equal(replayRanked(initial, [old]).states.get('p').prestigePoints, 94);
  assert.equal(replayRanked(initial, [match(0, { won: false })]).states.get('p').prestigePoints, 94);
  assert.equal(replayRanked(baseline(), [current]).states.get('p').mmr, 4.7);
  initial.set('p', { mmr: 10, prestigePoints: 2 });
  assert.deepEqual(replayRanked(initial, [current]).states.get('p'), { mmr: 10, prestigePoints: 0 });
  initial.set('p', { mmr: 10, prestigePoints: 0 });
  assert.deepEqual(replayRanked(initial, [current]).states.get('p'), { mmr: 9.7, prestigePoints: 0 });
});

test('official penalties subtract exact points across PP/MMR, cap at zero and never get loss multipliers', () => {
  assert.deepEqual(applyRankedPenalty({ mmr: 10, prestigePoints: 50 }, 6), { mmr: 10, prestigePoints: 44 });
  assert.deepEqual(applyRankedPenalty({ mmr: 10, prestigePoints: 2 }, 6), { mmr: 9.6, prestigePoints: 0 });
  assert.deepEqual(applyRankedPenalty({ mmr: 5, prestigePoints: 0 }, 6), { mmr: 4.4, prestigePoints: 0 });
  assert.deepEqual(applyRankedPenalty({ mmr: 0.2, prestigePoints: 0 }, 6), { mmr: 0, prestigePoints: 0 });
  for (const points of [0,-1,1.1,101,NaN,Infinity]) assert.throws(() => applyRankedPenalty({mmr:5,prestigePoints:0},points));
});

test('official penalties survive replay and do not touch win/loss streaks or other players', () => {
  const penalty = { kind: 'penalty', id: 'penalty', at: at(4), playerId: 'p', points: 6 };
  const events = [...wins(3), performance(4), penalty];
  const result = replayRanked(baseline(), events);
  assert.equal(result.states.get('p').mmr, 5.8);
  assert.equal(result.streaks.get('p').wins, 3);
  assert.deepEqual(result.states.get('q'), replayRanked(baseline(), events.slice(0,-1)).states.get('q'));
  assert.deepEqual(result, replayRanked(baseline(), events.slice().reverse()));
  assert.deepEqual(playerHistory(result).slice(-2).map(h => h.reason), ['performance_bonus','admin_penalty']);
  const row = playerHistory(result).at(-1);
  assert.equal(row.tournament_id, null); assert.equal(row.match_id, null); assert.equal(row.delta, -0.6);
  const lost = replayRanked(baseline(), [match(1, { won: false }), penalty]);
  assert.equal(lost.lossStreaks.get('p'), 1);
  assert.equal(replayRanked(baseline(), [penalty]).states.get('p').mmr, 4.4, 'penalties remain after match resets');
});
