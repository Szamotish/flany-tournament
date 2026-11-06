const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('hit reward migration, atomic replay, permissions and stale notebook protection', { skip: !process.env.HIT_REWARDS_PGLITE_PATH }, async t => {
  const { PGlite } = require(process.env.HIT_REWARDS_PGLITE_PATH);
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table players(id uuid primary key,mmr numeric,prestige_points integer);
    create table tournaments(id uuid primary key,event_at timestamptz,started_at timestamptz,name_day_number integer,mode text);
    create table tournament_matches(id uuid primary key,tournament_id uuid references tournaments on delete cascade);
    create table match_notebooks(match_id uuid references tournament_matches on delete cascade,game_no integer,document jsonb,primary key(match_id,game_no));
    create table player_mmr_history(id uuid primary key default gen_random_uuid(),player_id uuid references players,tournament_id uuid references tournaments,
      match_id uuid references tournament_matches,created_at timestamptz,reason text check(reason in ('match_win','match_loss','tournament_win','performance_bonus','admin_set_mmr','admin_reset_mmr')),
      delta numeric,mmr numeric,prestige_points integer);
    create table ranked_replay_revision(id integer primary key,revision bigint not null);
    insert into ranked_replay_revision values(1,1);
    create function persist_ranked_replay(expected_revision bigint,player_updates jsonb,history_rows jsonb) returns boolean
      language plpgsql as $$ begin
      if (select revision from ranked_replay_revision where id=1 for update) <> expected_revision then return false; end if;
      update players p set mmr=u.mmr,prestige_points=u.prestige_points from jsonb_to_recordset(player_updates) as u(id uuid,mmr numeric,prestige_points integer) where p.id=u.id;
      delete from player_mmr_history where player_id in (select (p->>'id')::uuid from jsonb_array_elements(player_updates) p)
        and reason in ('match_win','match_loss','tournament_win','performance_bonus');
      insert into player_mmr_history(player_id,tournament_id,match_id,created_at,reason,delta,mmr,prestige_points)
        select player_id,tournament_id,match_id,created_at,reason,delta,mmr,prestige_points from jsonb_to_recordset(history_rows)
        as h(player_id uuid,tournament_id uuid,match_id uuid,created_at timestamptz,reason text,delta numeric,mmr numeric,prestige_points integer);
      return true;
    end $$;
  `);
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261106_hit_rewards.sql'), 'utf8');
  await db.exec(migration); await db.exec(migration);
  const p = '00000000-0000-4000-8000-000000000001', q = '00000000-0000-4000-8000-000000000002';
  const tour = '00000000-0000-4000-8000-000000000010', match = '00000000-0000-4000-8000-000000000100';
  await db.query('insert into players(id,mmr,prestige_points) values ($1,10,0),($2,5,0)', [p,q]);
  await db.query('insert into tournaments(id) values ($1)', [tour]);
  await db.query('insert into tournament_matches values ($1,$2)', [match,tour]);
  const revision = async () => Number((await db.query('select revision from ranked_replay_revision')).rows[0].revision);
  const update = [{ id:p, mmr:10, prestige_points:1, ranked_hit_remainder:2 }];
  const reward = [{ player_id:p, tournament_id:tour, match_id:match, game_no:1, credited_hits:3, points:1 },
    { player_id:p, tournament_id:tour, match_id:match, game_no:2, credited_hits:2, points:0 }];
  const history = [{ player_id:p, tournament_id:tour, match_id:null, reason:'hit_bonus', created_at:'2026-11-06T12:00:00Z', delta:0.1,mmr:10,prestige_points:1 }];
  const persist = (rev,u=update,h=history,r=reward) => db.query('select persist_ranked_replay_with_hit_rewards($1,$2::jsonb,$3::jsonb,$4::jsonb) ok', [rev,JSON.stringify(u),JSON.stringify(h),JSON.stringify(r)]);

  await t.test('public roles cannot read reward ledger or invoke persistence', async () => {
    for (const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        await assert.rejects(db.query('select * from player_hit_rewards'), /permission denied/);
        await assert.rejects(persist(1), /permission denied/);
      } finally { await db.exec('reset role'); }
    }
  });
  await t.test('same replay never duplicates rewards or history and does not touch other players', async () => {
    assert.equal((await persist(await revision())).rows[0].ok,true);
    assert.equal((await persist(await revision())).rows[0].ok,true);
    assert.equal((await db.query('select * from player_hit_rewards')).rows.length,2);
    assert.equal((await db.query('select * from player_mmr_history')).rows.length,1);
    const row=(await db.query('select prestige_points,ranked_hit_remainder from players where id=$1',[p])).rows[0];
    assert.equal(row.prestige_points,1); assert.equal(row.ranked_hit_remainder,2);
    assert.equal(Number((await db.query('select mmr from players where id=$1',[q])).rows[0].mmr),5);
  });
  await t.test('notebook edits and tournament date edits invalidate an in-flight replay', async () => {
    const rev=await revision();
    await db.query("insert into match_notebooks values ($1,1,'{}')",[match]);
    assert.equal(await revision(),rev+1);
    assert.equal((await persist(rev)).rows[0].ok,false);
    const next=await revision();
    await db.query("update tournaments set event_at='2026-11-01' where id=$1",[tour]);
    assert.equal((await persist(next)).rows[0].ok,false);
    assert.equal((await db.query('select * from player_hit_rewards')).rows.length,2);
  });
  await t.test('bad ledger rolls back player totals and history, and mismatched awards are rejected', async () => {
    await assert.rejects(persist(await revision(),[{...update[0],prestige_points:999}],history,[{...reward[0],credited_hits:4}]), /check constraint/);
    assert.equal((await db.query('select prestige_points from players where id=$1',[p])).rows[0].prestige_points,1);
    assert.equal((await db.query('select * from player_mmr_history')).rows.length,1);
    await assert.rejects(persist(await revision(),update,[],reward), /history_mismatch/);
    await assert.rejects(persist(await revision(),update,history,[{...reward[0],player_id:q}]), /player_mismatch/);
  });
  await t.test('corrected data can remove bonuses and rebuild the partial pool; migration keeps existing rewards', async () => {
    await db.exec(migration);
    assert.equal((await db.query('select * from player_hit_rewards')).rows.length,2);
    assert.equal((await persist(await revision(),[{...update[0],prestige_points:0,ranked_hit_remainder:1}],[],[{...reward[0],credited_hits:1,points:0}])).rows[0].ok,true);
    assert.equal((await db.query('select * from player_mmr_history')).rows.length,0);
    assert.equal((await db.query('select ranked_hit_remainder from players where id=$1',[p])).rows[0].ranked_hit_remainder,1);
    await db.query('delete from tournament_matches where id=$1',[match]);
    assert.equal((await db.query('select * from player_hit_rewards')).rows.length,0);
    assert.equal((await persist(await revision(),[{...update[0],prestige_points:0,ranked_hit_remainder:0}],[],[])).rows[0].ok,true);
  });
});
