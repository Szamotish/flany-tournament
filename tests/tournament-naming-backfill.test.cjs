const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('historical tournament naming in PostgreSQL', { skip: !process.env.TOURNAMENT_NAMING_PGLITE_PATH }, async (t) => {
  const { PGlite } = require(process.env.TOURNAMENT_NAMING_PGLITE_PATH);
  const db = new PGlite();
  t.after(() => db.close());
  const migration = (file) => fs.readFileSync(path.join(__dirname, '../supabase/migrations', file), 'utf8');
  const backfill = migration('20261003_backfill_tournament_names.sql');
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table tournaments (id uuid primary key default gen_random_uuid(), name text not null,
      event_at timestamptz, created_at timestamptz not null default now(), event_location text,
      mode text default 'ranked', format text default 'single_elim', status text default 'finished');
    create table results (tournament_id uuid references tournaments(id), player text, points numeric);
    insert into tournaments(name, event_at, created_at, event_location) values
      ('Late', '2026-10-01T18:00:00+02', '2026-09-01T10:00:00Z', 'Sarbsk'),
      ('Tie B', '2026-10-01T12:00:00+02', '2026-09-02T10:00:00Z', ''),
      ('Early', '2026-10-01T10:00:00+02', '2026-09-01T10:00:00Z', null),
      ('Tie A', '2026-10-01T12:00:00+02', '2026-09-01T10:00:00Z', '   '),
      ('Midnight', null, '2026-10-01T22:30:00Z', null),
      ('FL #0210262', '2026-10-02T10:00:00+02', '2026-09-01T10:00:00Z', null);
    insert into tournaments(name, event_at, created_at)
      select 'Old ' || n, '2026-10-03T00:00:00Z'::timestamptz + n * interval '1 hour',
        '2026-09-01T00:00:00Z' from generate_series(12, 1, -1) n;
    insert into results select id, 'Winner', 0.7 from tournaments;
  `);
  const original = (await db.query('select * from tournaments order by id')).rows;
  const resultsBefore = (await db.query('select * from results order by tournament_id')).rows;
  await db.exec(migration('20261002_automatic_tournament_names.sql'));
  const automatic = (await db.query("insert into tournaments(event_at, event_location) values ('2026-10-01T20:00:00+02', 'Already automatic') returning *")).rows[0];
  await db.exec("insert into tournaments(event_at) values ('2026-10-03T20:00:00+02'); delete from tournaments where name='FL #03102613';");

  await t.test('failure rolls back every rename and restores the naming trigger', async () => {
    await db.exec(`
      create function reject_backfill() returns trigger language plpgsql as $$
      begin if old.name = 'Late' then raise exception 'test rejection'; end if; return new; end $$;
      create trigger reject_backfill before update on tournaments for each row execute function reject_backfill();
    `);
    await assert.rejects(db.exec(backfill), /test rejection/);
    await db.exec('rollback');
    assert.equal((await db.query('select count(*)::integer as n from tournaments where name_date is null')).rows[0].n, original.length);
    assert.equal((await db.query("select tgenabled from pg_trigger where tgname='assign_tournament_name'")).rows[0].tgenabled, 'O');
    await db.exec('drop trigger reject_backfill on tournaments; drop function reject_backfill();');
  });

  await db.exec(backfill);
  const migrated = (await db.query('select * from tournaments order by id')).rows;
  const byOldName = (name) => migrated.find((row) => row.id === original.find((row) => row.name === name).id);

  await t.test('legacy tournaments use chronological order, with creation time breaking ties', () => {
    assert.equal(byOldName('Early').name, 'FL #0110261');
    assert.equal(byOldName('Tie A').name, 'FL #0110262');
    assert.equal(byOldName('Tie B').name, 'FL #0110263');
    assert.equal(byOldName('Late').name, 'FL #0110264');
    assert.equal(migrated.find((row) => row.id === automatic.id).name, automatic.name);
    assert.equal(migrated.filter((row) => row.name_date === null).length, 0);
  });
  await t.test('old names populate only empty locations', () => {
    for (const name of ['Early', 'Tie A', 'Tie B', 'Midnight', 'FL #0210262']) {
      assert.equal(byOldName(name).event_location, name);
    }
    assert.equal(byOldName('Late').event_location, 'Sarbsk');
  });
  await t.test('fallback creation dates use Warsaw time and numbering supports more than nine events', () => {
    assert.equal(byOldName('Midnight').name, 'FL #0210261');
    assert.equal(byOldName('FL #0210262').name, 'FL #0210262');
    for (let n = 1; n <= 12; n++) assert.equal(byOldName(`Old ${n}`).name, `FL #031026${n}`);
  });
  await t.test('IDs, dates, modes, status and referenced results stay unchanged', async () => {
    for (const old of original) {
      const row = migrated.find((entry) => entry.id === old.id);
      for (const key of ['id', 'event_at', 'created_at', 'mode', 'format', 'status']) {
        assert.deepEqual(row[key], old[key]);
      }
    }
    assert.deepEqual((await db.query('select * from results order by tournament_id')).rows, resultsBefore);
  });
  await t.test('re-running the migration preserves names, locations and counters', async () => {
    const countersBefore = (await db.query('select * from tournament_daily_counters order by day')).rows;
    await db.exec(backfill);
    assert.deepEqual((await db.query('select * from tournaments order by id')).rows, migrated);
    assert.deepEqual((await db.query('select * from tournament_daily_counters order by day')).rows, countersBefore);
  });
  await t.test('new events continue the counter without reusing a deleted number', async () => {
    const row = (await db.query("insert into tournaments(event_at) values ('2026-10-03T21:00:00+02') returning name")).rows[0];
    assert.equal(row.name, 'FL #03102614');
    assert.equal((await db.query("insert into tournaments(event_at) values ('2026-10-01T21:00:00+02') returning name")).rows[0].name, 'FL #0110266');
  });
  await t.test('converted tournaments retain normal automatic naming on later edits', async () => {
    const id = byOldName('Early').id;
    assert.equal((await db.query("update tournaments set name='manual overwrite', event_location='New location' where id=$1 returning name", [id])).rows[0].name, 'FL #0110261');
    assert.equal((await db.query("update tournaments set event_at='2026-10-04T12:00:00+02' where id=$1 returning name", [id])).rows[0].name, 'FL #0410261');
  });
});
