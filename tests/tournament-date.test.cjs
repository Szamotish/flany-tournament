const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { parseTournamentDateTime, tournamentDateTimeInput } = require('../lib/tournamentDate.ts');

test('midnight tournament uses the entered Polish date, not server UTC', () => {
  assert.equal(parseTournamentDateTime('2026-10-02T00:30').toISOString(), '2026-10-01T22:30:00.000Z');
  assert.equal(tournamentDateTimeInput('2026-10-01T22:30:00Z'), '2026-10-02T00:30');
});
test('both summer and winter times round-trip when editing a tournament', () => {
  for (const input of ['2026-01-02T01:00', '2026-07-02T01:00', '2026-10-02T23:59', '2026-12-31T23:59']) {
    assert.equal(tournamentDateTimeInput(parseTournamentDateTime(input).toISOString()), input);
  }
  assert.equal(parseTournamentDateTime('2026-01-02T01:00').toISOString(), '2026-01-02T00:00:00.000Z');
});
test('invalid days and nonexistent DST spring hours are rejected', () => {
  for (const input of ['2026-02-29T12:00', '2026-02-31T12:00', '2026-10-02T24:30', '2026-03-29T02:30', 'garbage']) {
    assert.ok(Number.isNaN(parseTournamentDateTime(input).getTime()), input);
  }
  assert.equal(tournamentDateTimeInput('garbage'), '');
  assert.equal(tournamentDateTimeInput(null), '');
});
test('ambiguous autumn hour resolves consistently and leap days are supported', () => {
  assert.equal(parseTournamentDateTime('2026-10-25T02:30').toISOString(), '2026-10-25T00:30:00.000Z');
  assert.equal(parseTournamentDateTime('2028-02-29T12:00').toISOString(), '2028-02-29T11:00:00.000Z');
});
test('explicit ISO offsets remain supported for API clients', () => {
  assert.equal(parseTournamentDateTime('2026-10-02T00:30:00+02:00').toISOString(), '2026-10-01T22:30:00.000Z');
  assert.equal(parseTournamentDateTime('2026-10-01T22:30:00Z').toISOString(), '2026-10-01T22:30:00.000Z');
});
