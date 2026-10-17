const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: mod, exports: mod.exports, structuredClone, crypto, Request, Response, Headers, URL,
    require: name => name in mocks ? mocks[name] : require(name) });
  return mod.exports;
}
const notebook = load('lib/notebook.ts', { './beers': load('lib/beers.ts') });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const roster = [{ id: id(1), name: 'Maciek', teamId: id(10) }, { id: id(2), name: 'Franek', teamId: id(10) }, { id: id(3), name: 'Kasia', teamId: id(20) }];
const shot = (doc, player, field, checked = true, index = 0, rotation = 0) => notebook.editThrow(doc, rotation, id(player), index, field, checked);

test('opponent hit grants a separate bonus; penalty success counts in total throws, total hits and penalty hits', () => {
  let doc = notebook.newNotebook(roster);
  doc = shot(doc, 1, 'opponent');
  assert.equal(doc.rotations[0].entries[id(1)].throws.length, 2);
  assert.equal(notebook.notebookHits(doc, roster).length, 0);
  doc = shot(doc, 1, 'center', true, 1);
  const totals = notebook.playerNotebookTotals(doc, id(1));
  assert.equal(totals.throws, 2);
  assert.equal(totals.hits, 1);
  assert.equal(totals.opponentHits, 1);
  assert.equal(totals.penaltyHits, 1);
  assert.equal(notebook.notebookHits(doc, roster)[0].number, 1);
  assert.ok(notebook.parseNotebook(doc, roster));
});

test('bonus misses count as throws; another opponent hit can grant another bonus', () => {
  let doc = shot(notebook.newNotebook(roster), 1, 'opponent');
  doc = shot(doc, 1, 'opponent', true, 1);
  doc = shot(doc, 1, 'thrown', true, 2);
  const totals = notebook.playerNotebookTotals(doc, id(1));
  assert.equal(totals.throws, 3);
  assert.equal(totals.opponentHits, 2);
  assert.equal(totals.hits, 0);
  assert.equal(totals.penaltyHits, 0);
  assert.ok(notebook.parseNotebook(doc, roster));
});

test('team hit numbers continue across rotations, separate teams, and reference the exact finish hit', () => {
  let doc = shot(notebook.newNotebook(roster), 1, 'center');
  doc = shot(doc, 3, 'center');
  doc = shot(doc, 2, 'center');
  const secondHit = doc.rotations[0].entries[id(2)].throws[0].id;
  doc.players[id(1)].finishedAt = secondHit;
  doc.players[id(1)].beer = 'Żywiec Białe';
  doc.rotations.push(notebook.newRotation(roster));
  doc = shot(doc, 1, 'center', true, 0, 1);
  doc.players[id(2)].finishedAt = doc.rotations[1].entries[id(1)].throws[0].id;
  assert.deepEqual(Array.from(notebook.notebookHits(doc, roster), h => h.number), [1, 1, 2, 3]);
  assert.equal(doc.players[id(1)].finishedAt, secondHit);
  assert.equal(doc.players[id(1)].beer, 'Żywiec Białe');
  assert.equal(notebook.playerNotebookTotals(doc, id(2)).throws, 1);
  assert.ok(notebook.parseNotebook(doc, roster));
});

test('corrections remove dependent bonuses and finishes, preserve unrelated events and do not mutate original', () => {
  let doc = shot(notebook.newNotebook(roster), 1, 'opponent');
  doc = shot(doc, 1, 'center', true, 1);
  doc = shot(doc, 2, 'center');
  doc.players[id(1)].finishedAt = doc.rotations[0].entries[id(1)].throws[1].id;
  const corrected = shot(doc, 1, 'opponent', false);
  assert.equal(corrected.rotations[0].entries[id(1)].throws.length, 1);
  assert.equal(corrected.players[id(1)].finishedAt, null);
  assert.equal(notebook.notebookHits(corrected, roster).length, 1);
  assert.equal(notebook.notebookHits(corrected, roster)[0].playerId, id(2));
  assert.equal(doc.rotations[0].entries[id(1)].throws.length, 2);
  assert.ok(notebook.parseNotebook(corrected, roster));
});

test('reordering hits updates their numbers without losing finish attribution', () => {
  let doc = shot(notebook.newNotebook(roster), 1, 'center');
  doc = shot(doc, 2, 'center');
  const [first, second] = doc.rotations[0].hits;
  doc.players[id(1)].finishedAt = second;
  doc = notebook.moveNotebookHit(doc, 0, second, first);
  assert.equal(notebook.notebookHits(doc, roster).find(h => h.id === second).number, 1);
  assert.equal(doc.players[id(1)].finishedAt, second);
});

test('validation rejects invented players, bonus throws, duplicate IDs, wrong-team finishes and invalid counters/beers', () => {
  const base = shot(notebook.newNotebook(roster), 3, 'center');
  for (const change of [
    d => { d.players[id(99)] = { beer: null, finishedAt: null }; },
    d => { d.rotations[0].entries[id(1)].throws.push({ ...d.rotations[0].entries[id(1)].throws[0], id: crypto.randomUUID() }); },
    d => { d.rotations[0].entries[id(2)].throws[0].id = d.rotations[0].entries[id(1)].throws[0].id; },
    d => { d.players[id(1)].finishedAt = d.rotations[0].hits[0]; },
    d => { d.rotations[0].entries[id(1)].cheats = -1; },
    d => { d.rotations[0].entries[id(1)].cheats = 1.5; },
    d => { d.players[id(1)].beer = 'invented'; },
    d => { d.rotations[0].hits = []; },
    d => { d.rotations[0].entries[id(1)].throws[0].center = true; },
  ]) {
    const invalid = structuredClone(base); change(invalid);
    assert.equal(notebook.parseNotebook(invalid, roster), null);
  }
  assert.ok(notebook.parseNotebook(base, roster));
});

function api(options = {}) {
  let stored = options.stored ?? null, writes = 0;
  const server = { from() {
    let kind = 'read', values;
    const filters = {};
    const query = { select() { return this; }, eq(k, v) { filters[k] = v; return this; }, update(v) { kind = 'update'; values = v; return this; },
      insert(v) { kind = 'insert'; values = v; return this; }, single() { return this.maybeSingle(); }, maybeSingle() {
        if (kind === 'read') return { data: stored, error: options.schemaMissing ? { code: 'PGRST205' } : null };
        writes++;
        if (options.race) return kind === 'insert' ? { error: { code: '23505' }, data: null } : { error: null, data: null };
        if (kind === 'update') assert.equal(filters.revision, stored.revision);
        stored = values; return { data: { revision: values.revision }, error: null };
      } };
    return query;
  } };
  const domain = load('lib/notebookServer.ts', { './supabaseServer': { supabaseServer: {} } });
  const catalog = { matches: [{ id: id(100), bo: 3, team_a_id: id(10), team_b_id: id(20) }], players: roster };
  const route = load('app/api/admin/tournaments/[id]/notebook/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/app/api/admin/tournaments/_auth': { assertTournamentAdmin: async () => options.auth ?? { ok: true, ctx: { userId: id(90) } } },
    '@/lib/supabaseServer': { supabaseServer: server }, '@/lib/notebook': notebook,
    '@/lib/notebookServer': { ...domain, readNotebookCatalog: async () => catalog },
    '@/lib/rateLimit': { rateLimit: () => ({ ok: true }), rateLimitResponse: () => Response.json({}, { status: 429 }) },
  });
  return { stored: () => stored, writes: () => writes,
    get: () => route.GET(new Request(`https://example.test/notebook?matchId=${id(100)}&game=1`), { params: Promise.resolve({ id: id(200) }) }),
    put: body => route.PUT(new Request('https://example.test/notebook', { method: 'PUT', body: JSON.stringify({ matchId: id(100), game: 1, revision: 0, document: notebook.newNotebook(roster), ...body }) }), { params: Promise.resolve({ id: id(200) }) }),
  };
}

test('API authorizes read/write, validates match/game/roster and stores bonus provenance without accepting totals', async () => {
  for (const status of [401, 403]) {
    const service = api({ auth: { ok: false, status, error: 'forbidden' } });
    assert.equal((await service.get()).status, status);
    assert.equal((await service.put({})).status, status);
    assert.equal(service.writes(), 0);
  }
  const service = api();
  assert.equal((await service.put({ game: 4 })).status, 400);
  assert.equal((await service.put({ matchId: id(999) })).status, 404);
  const document = shot(shot(notebook.newNotebook(roster), 1, 'opponent'), 1, 'center', true, 1);
  document.totals = { penaltyHits: 999 };
  assert.equal((await service.put({ document })).status, 200);
  assert.equal(service.stored().document.totals, undefined);
  assert.equal(notebook.playerNotebookTotals(service.stored().document, id(1)).penaltyHits, 1);
});

test('optimistic saves reject stale/racing updates, accept lost-response retries and report missing migrations', async () => {
  const document = shot(notebook.newNotebook(roster), 1, 'center');
  const stored = { document, roster, revision: 5 };
  const service = api({ stored });
  assert.equal((await service.put({ document, revision: 4 })).status, 200);
  assert.equal(service.writes(), 0);
  const newer = shot(document, 2, 'center');
  assert.equal((await service.put({ document: newer, revision: 4 })).status, 409);
  assert.equal((await service.put({ document: newer, revision: 5 })).status, 200);
  assert.equal(service.stored().revision, 6);
  assert.equal((await api({ stored, race: true }).put({ document: newer, revision: 5 })).status, 409);
  assert.equal((await api({ race: true }).put({})).status, 409);
  assert.equal((await api({ schemaMissing: true }).get()).status, 503);
  assert.equal((await api({ stored: { ...stored, roster: [] } }).get()).status, 409);
});
