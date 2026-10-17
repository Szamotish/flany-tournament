const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('notebook migration is repeatable, private, versioned, and follows match deletion', { skip: !process.env.NOTEBOOK_PGLITE_PATH }, async t => {
  const { PGlite } = require(process.env.NOTEBOOK_PGLITE_PATH);
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table tournaments(id uuid primary key);
    create table tournament_matches(id uuid primary key);
    insert into tournaments values ('00000000-0000-4000-8000-000000000001');
    insert into tournament_matches values ('00000000-0000-4000-8000-000000000002');`);
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261017_match_notebooks.sql'), 'utf8');
  await db.exec(migration); await db.exec(migration);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from match_notebooks'), /permission denied/);
    await assert.rejects(db.query('delete from match_notebooks'), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  await db.exec(`insert into match_notebooks(match_id,game_no,tournament_id,document,roster,updated_by)
    values ('00000000-0000-4000-8000-000000000002',1,'00000000-0000-4000-8000-000000000001',
      '{"schema":1}', '[]','00000000-0000-4000-8000-000000000003')`);
  const winner = await db.query('update match_notebooks set revision=2 where revision=1 returning revision');
  const stale = await db.query('update match_notebooks set revision=2 where revision=1 returning revision');
  assert.equal(winner.rows.length, 1); assert.equal(stale.rows.length, 0);
  await assert.rejects(db.query('update match_notebooks set game_no=0'), /check constraint/);
  await assert.rejects(db.query("update match_notebooks set document='[]'"), /check constraint/);
  await db.exec('reset role');
  await db.exec("delete from tournament_matches where id='00000000-0000-4000-8000-000000000002'");
  assert.equal((await db.query('select * from match_notebooks')).rows.length, 0);
});
