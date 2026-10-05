const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');

function load(file, mocks = {}, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, Request, Response, Headers, AbortSignal,
    TextDecoder, TextEncoder, Uint8Array, process: { env: {} }, ...globals,
    require: (name) => name in mocks ? mocks[name] : require(name) });
  return mod.exports;
}
const config = load('lib/oracleConfig.ts');
const env = { ORACLE_ENABLED: 'true', ORACLE_FREE_PLAN_CONFIRMED: 'true', GROQ_API_KEY: 'fake-key-only-for-tests' };
function server(fetch = () => { throw Error('unexpected network'); }, settings = env) {
  return load('lib/oracleServer.ts', { '@/lib/oracleConfig': config }, { fetch, process: { env: settings } });
}
function request(body) { return new Request('https://example.test/api/oracle', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}); }
const input = () => ({ question: 'Wygram dzisiaj?', requestId: randomUUID() });
const ready = { available: true, reason: 'ready', model: config.ORACLE_MODELS[0] };
function api(options = {}) {
  const events = [];
  const route = load('app/api/oracle/route.ts', {
    '@/lib/oracleConfig': config,
    '@/lib/oracleServer': { ...server(), oracleConfigured: () => options.enabled !== false,
      askGroq: async () => { events.push('provider'); return { answer: 'Masz szansę.', tokens: 400, blockSeconds: 0 }; } },
    '@/app/api/admin/_auth': { readAuthContext: async () => options.auth ?? ({ ok: true, ctx: { userId: 'user', isMainAdmin: true } }) },
    '@/lib/rateLimit': { clientIp: () => 'test', rateLimit: () => ({ ok: true }) },
    '@/lib/supabaseServer': { supabaseServer: { rpc: async (name, args) => {
      events.push([name, args]);
      if (options.dbError) return { error: { message: 'private-database-details' }, data: null };
      if (name === 'oracle_finish') return { error: options.finishError ? {} : null };
      return { data: options.gate ?? ready, error: null };
    } } },
  });
  return { ...route, events };
}

test('server is disabled unless every opt-in and secret is present', () => {
  for (const key of Object.keys(env)) assert.equal(server(undefined, { ...env, [key]: '' }).oracleConfigured(), false);
  assert.equal(server().oracleConfigured(), true);
});
test('input rejects long/blank questions, custom endpoints, token overrides and non-UUID identifiers', async () => {
  const s = server();
  for (const body of [{ ...input(), question: ' ' }, { ...input(), question: 'x'.repeat(181) },
    { ...input(), max_tokens: 9999 }, { ...input(), url: 'https://other.test' }, { ...input(), model: 'paid-model' },
    { ...input(), requestId: 'replay' }]) assert.throws(() => s.parseOracleQuestion(body));
  await assert.rejects(s.readSmallJson(request({ question: 'x'.repeat(3000) })), /invalid_body/);
  assert.equal(s.parseOracleQuestion(input()).question, 'Wygram dzisiaj?');
});
test('provider uses fixed endpoint and limits, no tools, no redirects, no reasoning/emoji in answer', async () => {
  const calls = [];
  const s = server(async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '<think>hidden</think>Tak. \u{1F525}', reasoning: 'private' } }], usage: { total_tokens: 432 } });
  });
  for (const model of config.ORACLE_MODELS) {
    const result = await s.askGroq('Wygram?', model);
    assert.equal(result.answer, 'Tak.'); assert.equal(result.tokens, 432);
  }
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.body.max_completion_tokens, 768);
    assert.equal(call.body.messages.length, 2); assert.equal(call.body.tools, undefined);
  }
  assert.equal(calls[0].body.reasoning_effort, 'none');
  assert.equal(calls[1].body.include_reasoning, false);
});
test('429 follows the longest exhausted window and defaults to a full day when unknown', () => {
  const s = server();
  assert.equal(s.providerBlockSeconds(new Response('', { status: 429 })), 86401);
  assert.equal(s.providerBlockSeconds(new Response('', { status: 429, headers: {
    'retry-after': '2', 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '2h3m4s',
    'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '7.66s',
  } })), 7385);
  assert.equal(s.providerBlockSeconds(new Response('', { headers: {
    'x-ratelimit-remaining-tokens': '1000', 'x-ratelimit-reset-tokens': '7.66s',
  } })), 9);
});
test('timeouts and provider failures never retry, refund requests or expose error payloads', async () => {
  for (const response of [() => { throw Error('secret provider detail'); }, () => new Response('secret-key', { status: 401 }),
    () => Response.json({ choices: [{ finish_reason: 'length', message: { content: 'unfinished' } }] })]) {
    let count = 0;
    const result = await server(async () => { count++; return response(); }).askGroq('Test?', config.ORACLE_MODELS[0]);
    assert.equal(count, 1); assert.equal(result.answer, null); assert.equal(result.tokens, null); assert.ok(result.blockSeconds > 0);
  }
});
test('disabled, unauthorized, quota exhausted, malformed and database failures never call AI', async () => {
  for (const options of [{ enabled: false }, { auth: { ok: false, status: 401 } }, { dbError: true },
    { gate: { available: false, reason: 'global_limit' } }, { gate: { available: false, reason: 'duplicate' } }]) {
    const a = api(options); const response = await a.POST(request(input()));
    assert.ok(response.status >= 400); assert.ok(!a.events.includes('provider'));
    assert.ok(!(await response.text()).includes('private-database-details'));
  }
  const a = api(); await a.POST(request({ ...input(), max_tokens: 9000 }));
  assert.equal(a.events.length, 0);
});
test('status endpoint never calls AI or reserves; ordinary players cannot choose models', async () => {
  const a = api(); const response = await a.GET(new Request('https://example.test/api/oracle'));
  assert.equal(response.status, 200); assert.equal(a.events.length, 1); assert.equal(a.events[0][1].p_request, null);
  assert.equal((await response.json()).model, undefined);
  const player = api({ auth: { ok: true, ctx: { userId: 'player', isMainAdmin: false } } });
  assert.equal((await player.POST(request({ ...input(), model: config.ORACLE_MODELS[0] }))).status, 403);
  assert.equal(player.events.length, 0);
});
test('reservation happens before provider and finish before availability recheck; failed finish hides button', async () => {
  const a = api(); const response = await a.POST(request(input()));
  assert.equal(response.status, 200);
  assert.deepEqual(a.events.map(x => typeof x === 'string' ? x : x[0]), ['oracle_gate', 'provider', 'oracle_finish', 'oracle_gate']);
  const broken = api({ finishError: true });
  const json = await (await broken.POST(request(input()))).json();
  assert.equal(json.answer, 'Masz szansę.'); assert.equal(json.status.available, false);
});
