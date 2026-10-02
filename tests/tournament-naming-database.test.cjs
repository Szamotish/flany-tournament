const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('automatic tournament naming in PostgreSQL', { skip: !process.env.TOURNAMENT_NAMING_PGLITE_PATH }, async (t) => {
  const { PGlite } = require(process.env.TOURNAMENT_NAMING_PGLITE_PATH);
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table tournaments (id uuid primary key default gen_random_uuid(), name text not null,
      event_at timestamptz, created_at timestamptz not null default now(), event_location text,
      mode text default 'normal', format text default 'single_elim');
    insert into tournaments(name, event_at) values
      ('Schodki', '2026-10-01T12:00:00+02'), ('U Tomka', '2026-10-01T15:00:00+02'),
      ('FL #0310262', '2026-10-03T12:00:00+02');
  `);
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261002_automatic_tournament_names.sql'), 'utf8');
  await db.exec(migration);
  const create = async (eventAt, name = null, mode = 'normal', format = 'single_elim') => (await db.query(
    'insert into tournaments(event_at, name, mode, format) values ($1, $2, $3, $4) returning *', [eventAt, name, mode, format]
  )).rows[0];

  await t.test('format is DDMMYY followed by daily number; midnight is in Warsaw', async () => {
    const row = await create('2026-10-01T22:30:00Z', 'ignored manual name');
    assert.equal(row.name, 'FL #0210261');
    assert.equal(row.name_day_number, 1);
  });
  await t.test('normal/ranked and 1v1 share one daily counter, including double-digit numbers', async () => {
    const rows = await Promise.all(Array.from({ length: 11 }, (_, i) => create('2026-10-02T18:00:00+02', null,
      i % 2 ? 'ranked' : 'normal', i % 2 ? 'one_vs_one' : 'single_elim')));
    assert.deepEqual(rows.map((row) => row.name_day_number).sort((a,b) => a-b), [2,3,4,5,6,7,8,9,10,11,12]);
    assert.ok(rows.some((row) => row.name === 'FL #02102610'));
    assert.equal(new Set(rows.map((row) => row.name)).size, 11);
  });
  await t.test('existing historical tournaments keep names and count toward that day', async () => {
    const row = await create('2026-10-01T18:00:00+02');
    assert.equal(row.name, 'FL #0110263');
    const legacy = await db.query("update tournaments set event_location='Schodki', name='overwrite attempt' where name='Schodki' returning name");
    assert.equal(legacy.rows[0].name, 'Schodki');
  });
  await t.test('legacy names matching the new format cannot collide', async () => {
    assert.equal((await create('2026-10-03T18:00:00+02')).name, 'FL #0310263');
  });
  await t.test('deleting a tournament never reuses its number', async () => {
    const row = await create('2026-10-04T18:00:00+02');
    await db.query('delete from tournaments where id=$1', [row.id]);
    assert.equal((await create('2026-10-04T20:00:00+02')).name, 'FL #0410262');
  });
  await t.test('no date uses the Polish creation day', async () => {
    const row = (await db.query("insert into tournaments(created_at) values ('2026-12-31T23:30:00Z') returning name")).rows[0];
    assert.equal(row.name, 'FL #0101271');
  });
  await t.test('editing location or time within the day retains the name and prevents manual renaming', async () => {
    const row = await create('2026-10-05T18:00:00+02');
    const changed = (await db.query("update tournaments set event_location='Sarbsk', event_at='2026-10-05T21:00:00+02', name='bad', name_day_number=999 where id=$1 returning *", [row.id])).rows[0];
    assert.equal(changed.name, row.name);
    assert.equal(changed.event_location, 'Sarbsk');
    assert.equal(changed.name_day_number, 1);
  });
  await t.test('moving the event to another date allocates a number for the new day without changing its id', async () => {
    const row = await create('2026-10-06T18:00:00+02');
    await create('2026-10-07T18:00:00+02');
    const moved = (await db.query("update tournaments set event_at='2026-10-07T19:00:00+02' where id=$1 returning *", [row.id])).rows[0];
    assert.equal(moved.id, row.id);
    assert.equal(moved.name, 'FL #0710262');
  });
  await t.test('transaction rollback does not consume a daily number', async () => {
    await db.exec('begin');
    await create('2026-10-08T18:00:00+02');
    await db.exec('rollback');
    assert.equal((await create('2026-10-08T18:00:00+02')).name, 'FL #0810261');
  });
  await t.test('re-running the migration does not rename records or rewind counters', async () => {
    await db.exec(migration);
    assert.equal((await create('2026-10-04T20:00:00+02')).name, 'FL #0410263');
    assert.equal((await db.query("select name from tournaments where name='U Tomka'")).rows.length, 1);
  });
  await t.test('ordinary clients cannot modify the daily counter', async () => {
    await db.exec('set role authenticated');
    try { await assert.rejects(db.exec('update tournament_daily_counters set last_number=1'), /permission denied/); }
    finally { await db.exec('reset role'); }
  });
});
