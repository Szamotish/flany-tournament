const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Optional PostgreSQL/WASM integration suite; no connection to a real Supabase project.
// RANKED_PGLITE_PATH points at an installed @electric-sql/pglite package.
test('ranking database migration and transactions', { skip: !process.env.RANKED_PGLITE_PATH }, async (t) => {
  const { PGlite } = require(process.env.RANKED_PGLITE_PATH);
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table players (id uuid primary key, mmr numeric default 5, prestige_points integer default 0,
      rating_override numeric, mmr_manual_override boolean default false, is_main_admin boolean default false);
    create table tournaments (id uuid primary key);
    create table tournament_matches (id uuid primary key, tournament_id uuid references tournaments,
      status text, team_a_id uuid, team_b_id uuid, created_at timestamptz default now(), updated_at timestamptz default now());
    create table tournament_results (tournament_id uuid references tournaments, team_id uuid, placement integer);
    create table team_members (team_id uuid, player_id uuid references players);
    create table ratings (id uuid primary key);
    create table player_mmr_history (id uuid primary key default gen_random_uuid(),
      player_id uuid references players, tournament_id uuid references tournaments, match_id uuid references tournament_matches,
      created_at timestamptz default now(), reason text check (reason in ('match_win', 'match_loss', 'tournament_win', 'admin_set_mmr', 'admin_reset_mmr')),
      delta numeric, mmr numeric, prestige_points integer);
  `);
  await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260918_performance_bonus_and_winstreak.sql'), 'utf8'));
  const admin = '10000000-0000-4000-8000-000000000001';
  const player = '10000000-0000-4000-8000-000000000002';
  const bonus = '10000000-0000-4000-8000-000000000003';
  await db.query('insert into players (id, is_main_admin) values ($1, true), ($2, false)', [admin, player]);
  const revision = async () => Number((await db.query('select revision from ranked_replay_revision')).rows[0].revision);
  const grant = (id = bonus, actor = admin, delta = 0.2) => db.query('select grant_performance_bonus($1, $2, $3, $4, $5)', [id, player, actor, delta, 'MVP']);
  const update = [{ id: player, mmr: 5.2, prestige_points: 0, ranked_win_streak: 4, ranked_duel_wins: 2 }];
  const history = [{ player_id: player, tournament_id: null, match_id: null, created_at: new Date().toISOString(),
    reason: 'performance_bonus', delta: 0.2, mmr: 5.2, prestige_points: 0 }];
  const persist = (rev, rows = history) => db.query('select persist_ranked_replay($1, $2::jsonb, $3::jsonb) as ok', [rev, JSON.stringify(update), JSON.stringify(rows)]);

  await t.test('only main admin may grant a bonus', async () => {
    await assert.rejects(grant(bonus, player), /forbidden_main_admin_only/);
    assert.equal((await db.query('select * from player_performance_bonuses')).rows.length, 0);
  });
  await t.test('RPC is inaccessible to public/authenticated clients', async () => {
    await db.exec('set role authenticated');
    try { await assert.rejects(grant(), /permission denied/); }
    finally { await db.exec('reset role'); }
  });
  await t.test('grant stores permanent event and seven-day emblem; retry is idempotent', async () => {
    await grant();
    const first = (await db.query('select * from player_performance_bonuses')).rows[0];
    await grant();
    const rows = (await db.query('select * from player_performance_bonuses')).rows;
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].delta), 0.2);
    assert.equal(new Date(rows[0].emblem_expires_at).getTime() - new Date(rows[0].created_at).getTime(), 7 * 86400000);
    assert.deepEqual(rows[0].emblem_expires_at, first.emblem_expires_at);
    assert.deepEqual((await db.query('select performance_bonus_until from players where id = $1', [player])).rows[0].performance_bonus_until, first.emblem_expires_at);
  });
  await t.test('same request id cannot be reused with different points', async () => {
    await assert.rejects(grant(bonus, admin, 0.3), /bonus_id_conflict/);
    await assert.rejects(grant(bonus, admin, 0.25), /invalid_bonus_delta/);
    assert.equal(Number((await db.query('select delta from player_performance_bonuses')).rows[0].delta), 0.2);
  });
  await t.test('stale replay cannot overwrite a newly awarded bonus', async () => {
    const before = await revision();
    await grant();
    assert.equal((await persist(before)).rows[0].ok, false);
    assert.equal(Number((await db.query('select mmr from players where id = $1', [player])).rows[0].mmr), 5);
  });
  await t.test('repeated replay replaces history without duplicating points or events', async () => {
    assert.equal((await persist(await revision())).rows[0].ok, true);
    assert.equal((await persist(await revision())).rows[0].ok, true);
    const row = (await db.query('select * from players where id = $1', [player])).rows[0];
    assert.equal(Number(row.mmr), 5.2);
    assert.equal(row.ranked_win_streak, 4);
    assert.equal(row.ranked_duel_wins, 2);
    assert.equal((await db.query('select * from player_mmr_history')).rows.length, 1);
    assert.equal((await db.query('select * from player_performance_bonuses')).rows.length, 1);
  });
  await t.test('failed history insertion rolls the entire replay back', async () => {
    await assert.rejects(persist(await revision(), [{ ...history[0], reason: 'invalid' }]), /check constraint/);
    assert.equal((await db.query('select * from player_mmr_history')).rows.length, 1);
    assert.equal(Number((await db.query('select mmr from players where id = $1', [player])).rows[0].mmr), 5.2);
  });
  await t.test('score edits preserve match completion order', async () => {
    const id = '10000000-0000-4000-8000-000000000004';
    await db.query('insert into tournament_matches(id,status,team_a_id,team_b_id) values ($1, $2, $3, $4)', [id, 'finished', admin, player]);
    const before = (await db.query('select ranked_finished_at from tournament_matches where id = $1', [id])).rows[0].ranked_finished_at;
    await db.query("update tournament_matches set updated_at = now() + interval '1 day' where id = $1", [id]);
    assert.deepEqual((await db.query('select ranked_finished_at from tournament_matches where id = $1', [id])).rows[0].ranked_finished_at, before);
  });
});
