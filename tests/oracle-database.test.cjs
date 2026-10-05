const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

test('oracle quotas and permissions in PostgreSQL', { skip: !process.env.ORACLE_PGLITE_PATH }, async (t) => {
  const { PGlite } = require(process.env.ORACLE_PGLITE_PATH);
  const db = new PGlite();
  t.after(() => db.close());
  const admin = randomUUID(), player = randomUUID(), inactive = randomUUID();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table players (auth_user_id uuid primary key, active boolean, is_main_admin boolean);`);
  await db.query('insert into players values ($1,true,true), ($2,true,false), ($3,false,false)', [admin, player, inactive]);
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261005_oracle_ai.sql'), 'utf8');
  await db.exec(migration);
  const gate = async (user = admin, id = null) => (await db.query('select oracle_gate($1,$2) as result', [user, id])).rows[0].result;
  const finish = (id, tokens = null, block = 0) => db.query('select oracle_finish($1,$2,$3)', [id, tokens, block]);
  const config = (user, mode, model = 'qwen/qwen3.8-27b') => db.query('select oracle_config($1,$2,$3)', [user, mode, model]);
  const reset = async () => {
    await db.exec("truncate oracle_requests; update oracle_settings set mode='public', active_request=null, blocked_until=null;");
  };
  const fill = (count, user = player, tokens = 100) => db.query(`insert into oracle_requests(id,user_id,created_at,tokens,finished)
    select gen_random_uuid(), $1, clock_timestamp()-interval '2 hours', $3, true from generate_series(1,$2::integer)`, [user, count, tokens]);

  await t.test('disabled by default, main admin pilot and active player restriction', async () => {
    assert.equal((await gate()).reason, 'disabled');
    await config(admin, 'admin');
    assert.equal((await gate()).available, true);
    assert.equal((await gate(player)).available, false);
    await config(admin, 'public');
    assert.equal((await gate(player)).available, true);
    assert.equal((await gate(inactive)).available, false);
    assert.equal((await gate(randomUUID())).available, false);
    await assert.rejects(config(player, 'off'), /main_admin_required/);
  });
  await t.test('status never consumes quota, grants one reservation, rejects duplicate replay', async () => {
    await reset();
    await gate(); await gate();
    assert.equal((await db.query('select count(*)::int n from oracle_requests')).rows[0].n, 0);
    const id = randomUUID();
    assert.equal((await gate(admin, id)).available, true);
    assert.equal((await gate(admin, id)).reason, 'duplicate');
    assert.equal((await gate(player, randomUUID())).reason, 'busy');
    await finish(id, 450);
    assert.equal((await gate(admin, id)).reason, 'duplicate');
    assert.equal((await gate()).reason, 'cooldown');
    assert.equal((await gate(player)).available, true);
  });
  await t.test('two simultaneous requests for last global slot cannot both proceed', async () => {
    await reset(); await fill(99);
    const results = await Promise.all([gate(admin, randomUUID()), gate(admin, randomUUID())]);
    assert.equal(results.filter(x => x.available).length, 1);
    assert.equal(results.find(x => !x.available).reason, 'global_limit');
    assert.equal((await gate()).available, false);
    assert.equal((await db.query('select count(*)::int n from oracle_requests')).rows[0].n, 100);
  });
  await t.test('personal limit has a reset time and expiry restores eligibility', async () => {
    await reset(); await fill(10, admin);
    const status = await gate();
    assert.equal(status.reason, 'personal_limit');
    assert.ok(Date.parse(status.retryAt) > Date.now());
    assert.equal((await gate(player)).available, true);
    await db.exec("update oracle_requests set created_at=clock_timestamp()-interval '25 hours'");
    assert.equal((await gate()).available, true);
  });
  await t.test('failed/uncertain calls retain quota and crash stays closed after lease timeout', async () => {
    await reset(); const id = randomUUID();
    await gate(admin, id);
    await db.exec("update oracle_requests set created_at=clock_timestamp()-interval '40 seconds'");
    assert.equal((await gate(player)).reason, 'uncertain');
    await finish(id, null, 60);
    assert.equal((await gate(player)).reason, 'provider_limit');
    assert.equal((await db.query('select tokens from oracle_requests')).rows[0].tokens, 4096);
    await finish(id, 1, 0); // A repeated completion cannot refund the first result.
    assert.equal((await db.query('select tokens from oracle_requests')).rows[0].tokens, 4096);
  });
  await t.test('minute token budget, request budget and daily token budget apply across models', async () => {
    await reset(); await fill(1, player, 3000);
    await db.exec('update oracle_requests set created_at=clock_timestamp()');
    assert.equal((await gate()).reason, 'minute_limit');
    await reset(); await fill(4);
    await db.exec('update oracle_requests set created_at=clock_timestamp()');
    assert.equal((await gate()).reason, 'minute_limit');
    await reset(); await fill(24, player, 4096);
    assert.equal((await gate()).reason, 'global_limit');
    await config(admin, 'admin', 'openai/gpt-oss-120b');
    assert.equal((await gate()).reason, 'global_limit');
  });
  await t.test('kill switch and switching back cannot clear a provider block', async () => {
    await reset(); const id = randomUUID(); await gate(admin, id); await finish(id, null, 3600);
    await config(admin, 'off'); assert.equal((await gate()).reason, 'disabled');
    await config(admin, 'public'); assert.equal((await gate()).reason, 'provider_limit');
    await db.exec("update oracle_settings set blocked_until=clock_timestamp()-interval '1 second'; update oracle_requests set created_at=clock_timestamp()-interval '2 minutes'");
    assert.equal((await gate()).available, true);
  });
  await t.test('migration rerun preserves settings and counters; old history is bounded', async () => {
    await reset(); await fill(2); await config(admin, 'admin'); await db.exec(migration);
    assert.equal((await gate()).remainingGlobal, 98);
    assert.equal((await gate(player)).reason, 'disabled');
    await db.exec("update oracle_requests set created_at=clock_timestamp()-interval '32 days'");
    await gate(admin, randomUUID());
    assert.equal((await db.query('select count(*)::int n from oracle_requests')).rows[0].n, 1);
  });
  await t.test('clients cannot read counters, change config, reserve or finish calls', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        await assert.rejects(gate(), /permission denied/);
        await assert.rejects(finish(randomUUID()), /permission denied/);
        await assert.rejects(config(admin, 'public'), /permission denied/);
        await assert.rejects(db.query('select * from oracle_requests'), /permission denied/);
        await assert.rejects(db.query("update oracle_settings set mode='public'"), /permission denied/);
        if (role === 'authenticated') assert.equal((await db.query('select * from oracle_availability')).rows.length, 1);
      } finally { await db.exec('reset role'); }
    }
    await reset();
    await db.exec('set role service_role');
    try { assert.equal((await gate()).available, true); }
    finally { await db.exec('reset role'); }
  });
});
