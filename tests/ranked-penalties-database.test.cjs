const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('penalty migration preserves old match policy and atomically persists official deductions', {
  skip: !process.env.PENALTIES_PGLITE_PATH,
}, async t => {
  const { PGlite } = require(process.env.PENALTIES_PGLITE_PATH);
  const db = new PGlite(); t.after(() => db.close());
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const admin=id(1), player=id(2), other=id(3), penalty=id(10);
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table players(id uuid primary key,mmr numeric default 10,prestige_points integer default 30,is_main_admin boolean default false,
      performance_bonus_until timestamptz,ranked_hit_remainder integer default 0);
    create table tournament_matches(id uuid primary key,status text);
    create table ranked_replay_revision(id integer primary key,revision bigint not null);
    insert into ranked_replay_revision values(1,1);
    create table player_mmr_history(id uuid primary key default gen_random_uuid(),player_id uuid references players,
      tournament_id uuid,match_id uuid,created_at timestamptz,reason text check(reason in ('match_win','match_loss','tournament_win','performance_bonus','hit_bonus','admin_set_mmr','admin_reset_mmr')),
      delta numeric,mmr numeric check(mmr between 0 and 10),prestige_points integer);
    create table player_hit_rewards(player_id uuid,points integer);
    -- Established inner RPC contract: unknown history reasons are not deleted.
    create function persist_ranked_replay_with_hit_rewards(expected_revision bigint,player_updates jsonb,history_rows jsonb,hit_rewards jsonb)
      returns boolean language plpgsql as $$ begin
      if (select revision from ranked_replay_revision where id=1 for update) <> expected_revision then return false; end if;
      update players p set mmr=u.mmr,prestige_points=u.prestige_points,ranked_hit_remainder=u.ranked_hit_remainder
        from jsonb_to_recordset(player_updates) as u(id uuid,mmr numeric,prestige_points integer,ranked_hit_remainder integer) where p.id=u.id;
      delete from player_mmr_history where player_id in (select (u->>'id')::uuid from jsonb_array_elements(player_updates) u)
        and reason in ('match_win','match_loss','tournament_win','performance_bonus','hit_bonus');
      insert into player_mmr_history(player_id,tournament_id,match_id,created_at,reason,delta,mmr,prestige_points)
        select player_id,tournament_id,match_id,created_at,reason,delta,mmr,prestige_points from jsonb_to_recordset(history_rows)
        as h(player_id uuid,tournament_id uuid,match_id uuid,created_at timestamptz,reason text,delta numeric,mmr numeric,prestige_points integer);
      delete from player_hit_rewards where player_id in (select (u->>'id')::uuid from jsonb_array_elements(player_updates) u);
      insert into player_hit_rewards select player_id,points from jsonb_to_recordset(hit_rewards) as h(player_id uuid,points integer);
      return true;
    end $$;
  `);
  await db.query('insert into players(id,is_main_admin) values ($1,true),($2,false),($3,false)',[admin,player,other]);
  await db.query("insert into tournament_matches values ($1,'finished'),($2,'pending')",[id(20),id(21)]);
  const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261110_ranked_penalties.sql'),'utf8');
  await db.exec(migration); await db.exec(migration);
  const revision=async()=>Number((await db.query('select revision from ranked_replay_revision')).rows[0].revision);
  const grant=(key=penalty,actor=admin,points=6,note='Krok przy rzucie')=>db.query('select grant_ranked_penalty($1,$2,$3,$4,$5)',[key,player,actor,points,note]);
  const updates=[{id:player,mmr:10,prestige_points:25,ranked_hit_remainder:2}];
  const hitRewards=[{player_id:player,points:1}];
  let history;
  const persist=(rev,u=updates,h=history,r=hitRewards)=>db.query('select persist_ranked_replay_with_penalties($1,$2::jsonb,$3::jsonb,$4::jsonb) ok',
    [rev,JSON.stringify(u),JSON.stringify(h),JSON.stringify(r)]);
  await t.test('finished matches retain 9, new results get 6; corrections/reset/repeated migration cannot change policy',async()=>{
    const policy=async n=>(await db.query('select ranked_prestige_loss_points p from tournament_matches where id=$1',[id(n)])).rows[0].p;
    assert.equal(await policy(20),9); assert.equal(await policy(21),null);
    await db.query("update tournament_matches set status='finished' where id=$1",[id(21)]);
    assert.equal(await policy(21),6);
    await db.query("update tournament_matches set status='pending',ranked_prestige_loss_points=6 where id=$1",[id(20)]);
    assert.equal(await policy(20),9);
    await db.query("update tournament_matches set status='finished',ranked_prestige_loss_points=null where id=$1",[id(20)]);
    assert.equal(await policy(20),9);
    await db.query("insert into tournament_matches(id,status) values($1,'finished')",[id(22)]);
    await db.exec(migration);
    assert.equal(await policy(21),6); assert.equal(await policy(22),6); assert.equal(await policy(20),9);
  });
  await t.test('public clients cannot read penalties or call RPCs; local admin cannot grant them',async()=>{
    for(const role of ['anon','authenticated']){
      await db.exec(`set role ${role}`);
      try {
        await assert.rejects(grant(),/permission denied/);
        await assert.rejects(db.query('select * from player_ranked_penalties'),/permission denied/);
        await assert.rejects(persist(1,[],[],[]),/permission denied/);
      } finally {await db.exec('reset role');}
    }
    await assert.rejects(grant(penalty,player),/forbidden_main_admin_only/);
    for(const points of [0,101]) await assert.rejects(grant(penalty,admin,points),/invalid_penalty/);
    await assert.rejects(grant(penalty,admin,6,'  '),/invalid_penalty/);
    assert.equal((await db.query('select * from player_ranked_penalties')).rows.length,0);
  });
  await t.test('grant is idempotent, invalidates stale replay, preserves medals and records no duplicate on retry',async()=>{
    const rev=await revision();
    await db.exec('set role service_role');
    try {await grant(); await grant();} finally {await db.exec('reset role');}
    assert.equal(await revision(),rev+1);
    await assert.rejects(grant(penalty,admin,7),/penalty_id_conflict/);
    const rows=(await db.query('select *,created_at::text as at from player_ranked_penalties')).rows;
    assert.equal(rows.length,1); assert.equal(rows[0].points,6);
    const p=(await db.query('select * from players where id=$1',[player])).rows[0];
    assert.equal(p.ranked_penalty_applied,true); assert.equal(p.performance_bonus_until,null);
    history=[{player_id:player,reason:'hit_bonus',created_at:'2026-11-01T12:00:00Z',delta:0.1,mmr:10,prestige_points:31},
      {player_id:player,reason:'admin_penalty',created_at:rows[0].at,delta:-0.6,mmr:10,prestige_points:25}];
    assert.equal((await persist(rev)).rows[0].ok,false);
    assert.equal((await db.query('select * from player_mmr_history')).rows.length,0);
  });
  await t.test('replays replace exactly one penalty and retain hit rewards, pools and other players',async()=>{
    await db.query("insert into player_mmr_history(player_id,reason,created_at,delta,mmr,prestige_points) values($1,'admin_set_mmr',now(),0,5,0)",[other]);
    for(let i=0;i<2;i++) assert.equal((await persist(await revision())).rows[0].ok,true);
    const p=(await db.query('select * from players where id=$1',[player])).rows[0];
    assert.equal(p.prestige_points,25); assert.equal(p.ranked_hit_remainder,2);
    assert.equal((await db.query("select * from player_mmr_history where reason='admin_penalty'")).rows.length,1);
    assert.equal((await db.query('select * from player_mmr_history where player_id=$1',[other])).rows.length,1);
    assert.equal((await db.query('select * from player_hit_rewards')).rows.length,1);
  });
  await t.test('missing, duplicated or forged penalties fail; failed history insert rolls back the entire replay',async()=>{
    const rev=await revision();
    await assert.rejects(persist(rev,updates,history.slice(0,1)),/penalty_history_mismatch/);
    await assert.rejects(persist(rev,updates,[...history,history[1]]),/penalty_history_mismatch/);
    await assert.rejects(persist(rev,updates,[history[0],{...history[1],delta:-0.7}]),/penalty_history_mismatch/);
    await assert.rejects(persist(rev,updates,[history[0],{...history[1],player_id:other}]),/penalty_player_mismatch/);
    await assert.rejects(persist(rev,[{...updates[0],prestige_points:999}],[history[0],{...history[1],mmr:99}],[]),/check constraint/);
    assert.equal((await db.query('select prestige_points from players where id=$1',[player])).rows[0].prestige_points,25);
    assert.equal((await db.query("select * from player_mmr_history where reason='admin_penalty'")).rows.length,1);
    assert.equal((await db.query('select * from player_hit_rewards')).rows.length,1);
  });
});
