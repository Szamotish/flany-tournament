const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('lose streak migration and atomic persistence', { skip: !process.env.LOSE_STREAK_PGLITE_PATH }, async (t) => {
  const { PGlite } = require(process.env.LOSE_STREAK_PGLITE_PATH);
  const db = new PGlite();
  t.after(() => db.close());
  // Minimal contract of the existing winstreak schema; test only the new migration.
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table players (id uuid primary key, mmr numeric default 5, prestige_points integer default 0,
      ranked_win_streak integer not null default 0, ranked_duel_wins integer not null default 0);
    create table ranked_replay_revision (id integer primary key, revision bigint not null default 0);
    insert into ranked_replay_revision values (1, 0);
    create table player_mmr_history (id uuid primary key default gen_random_uuid(), player_id uuid references players,
      tournament_id uuid, match_id uuid, created_at timestamptz, reason text, delta numeric, mmr numeric, prestige_points integer);
  `);
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260920_ranked_loss_streak.sql'), 'utf8');
  await db.exec(migration);
  const player = '10000000-0000-4000-8000-000000000001';
  const other = '10000000-0000-4000-8000-000000000002';
  await db.query('insert into players (id) values ($1), ($2)', [player, other]);
  const update = { id: player, mmr: 4.1, prestige_points: 0, ranked_win_streak: 0, ranked_duel_wins: 0, ranked_loss_streak: 3 };
  const history = [{ player_id: player, created_at: new Date().toISOString(), reason: 'match_loss', delta: -0.3, mmr: 4.1, prestige_points: 0 }];
  const persist = (row = update, revision = 0) => db.query('select persist_ranked_replay($1, $2::jsonb, $3::jsonb) as ok', [revision, JSON.stringify([row]), JSON.stringify(history)]);
  const readPlayer = async (id = player) => (await db.query('select * from players where id = $1', [id])).rows[0];

  await t.test('existing players start with zero losses', async () => {
    assert.equal((await readPlayer()).ranked_loss_streak, 0);
  });
  await t.test('persists losses, rank and history together without changing another player', async () => {
    assert.equal((await persist()).rows[0].ok, true);
    assert.equal((await readPlayer()).ranked_loss_streak, 3);
    assert.equal(Number((await readPlayer()).mmr), 4.1);
    assert.equal((await readPlayer(other)).ranked_loss_streak, 0);
  });
  await t.test('repeating migration and replay preserves the streak without duplicating history', async () => {
    await db.exec(migration);
    await persist();
    assert.equal((await readPlayer()).ranked_loss_streak, 3);
    assert.equal((await db.query('select * from player_mmr_history')).rows.length, 1);
  });
  await t.test('old application payload preserves losses during rollout', async () => {
    const { ranked_loss_streak, ...legacy } = update;
    assert.equal(ranked_loss_streak, 3);
    await persist(legacy);
    assert.equal((await readPlayer()).ranked_loss_streak, 3);
  });
  await t.test('stale snapshot cannot overwrite losses', async () => {
    assert.equal((await persist({ ...update, ranked_loss_streak: 6 }, -1)).rows[0].ok, false);
    assert.equal((await readPlayer()).ranked_loss_streak, 3);
  });
  await t.test('invalid counter rolls back history and points too', async () => {
    const before = (await db.query('select * from player_mmr_history')).rows;
    await assert.rejects(persist({ ...update, mmr: 1, ranked_loss_streak: -1 }), /check constraint/);
    assert.equal((await readPlayer()).ranked_loss_streak, 3);
    assert.equal(Number((await readPlayer()).mmr), 4.1);
    assert.deepEqual((await db.query('select * from player_mmr_history')).rows, before);
  });
  await t.test('zero explicitly resets a former lose streak', async () => {
    await persist({ ...update, ranked_loss_streak: 0 });
    assert.equal((await readPlayer()).ranked_loss_streak, 0);
  });
  await t.test('ordinary authenticated clients cannot invoke the replay RPC', async () => {
    await db.exec('set role authenticated');
    try { await assert.rejects(persist(), /permission denied/); }
    finally { await db.exec('reset role'); }
  });
});
