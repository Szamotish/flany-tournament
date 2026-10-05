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
    TextDecoder, TextEncoder, Uint8Array, Error, process: { env: {} }, ...globals,
    require: (name) => name in mocks ? mocks[name] : require(name) });
  return mod.exports;
}
const config = load('lib/oracleConfig.ts');
const prompt = load('lib/oraclePrompt.ts');
const ranking = load('lib/ranking.ts');
const league = load('lib/oracleLeague.ts', {
  '@/lib/rating': load('lib/rating.ts'), '@/lib/playerRank': load('lib/playerRank.ts'), '@/lib/ranking': ranking,
});
const sampleRules = '1. Do rzutów używamy gumowego kurczaka.\n2. Ranking gramy na asfalcie, co najmniej 20 stóp.';
const preparedPrompt = prompt.buildOracleSystemPrompt(sampleRules);
const env = { ORACLE_ENABLED: 'true', ORACLE_FREE_PLAN_CONFIRMED: 'true', GROQ_API_KEY: 'fake-key-only-for-tests' };
function server(fetch = () => { throw Error('unexpected network'); }, settings = env, readRules = async () => sampleRules,
  readFacts = async () => ['Pytający="Tester".', '"Tester": MMR5 PP0.']) {
  return load('lib/oracleServer.ts', {
    '@/lib/oracleConfig': config, '@/lib/oraclePrompt': prompt,
    '@/lib/tournamentRules': { readDefaultRules: readRules },
    '@/lib/oracleLeague': league, '@/lib/oracleLeagueServer': { readOracleLeagueFacts: readFacts },
  }, { fetch, process: { env: settings } });
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
      prepareOraclePrompt: async (question, playerId) => {
        events.push(['prompt', question, playerId]);
        if (options.promptError) throw new Error(options.promptError);
        return preparedPrompt;
      },
      askGroq: async (_question, _model, systemPrompt) => {
        assert.equal(systemPrompt, preparedPrompt);
        events.push('provider'); return { answer: 'Masz szansę.', tokens: 400, blockSeconds: 0 };
      } },
    '@/app/api/admin/_auth': { readAuthContext: async () => options.auth ?? ({ ok: true, ctx: { userId: 'user', playerId: 'verified-player', isMainAdmin: true } }) },
    '@/lib/rateLimit': { clientIp: () => 'test', rateLimit: () => ({ ok: true }) },
    '@/lib/supabaseServer': { supabaseServer: { rpc: async (name, args) => {
      events.push([name, args]);
      if (options.dbError) return { error: { message: 'private-database-details' }, data: null };
      if (name === 'oracle_finish') return { error: options.finishError ? {} : null };
      if (args.p_request && options.reservationGate) return { data: options.reservationGate, error: null };
      return { data: options.gate ?? ready, error: null };
    } } },
  });
  return { ...route, events };
}

test('server is disabled unless every opt-in and secret is present', () => {
  for (const key of Object.keys(env)) assert.equal(server(undefined, { ...env, [key]: '' }).oracleConfigured(), false);
  assert.equal(server().oracleConfigured(), true);
});
test('configuration identifies missing and invalid flags without exposing their values', () => {
  const settings = { ORACLE_ENABLED: 'false', ORACLE_FREE_PLAN_CONFIRMED: 'secret-accidentally-pasted-as-flag', GROQ_API_KEY: 'private-key-value' };
  const status = server(undefined, settings).oracleConfiguration();
  assert.equal(status.configured, false);
  assert.equal(status.configurationIssues.length, 2);
  assert.equal(status.configurationIssues[0].variable, 'ORACLE_ENABLED');
  assert.equal(status.configurationIssues[0].reason, 'not_true');
  assert.equal(status.configurationIssues[1].variable, 'ORACLE_FREE_PLAN_CONFIRMED');
  assert.ok(!JSON.stringify(status).includes('private-key-value'));
  assert.ok(!JSON.stringify(status).includes('secret-accidentally-pasted-as-flag'));
  const missing = server(undefined, {}).oracleConfiguration();
  assert.equal(missing.configurationIssues.length, 3);
  assert.ok(missing.configurationIssues.every(issue => issue.reason === 'missing'));
});
test('copy/paste whitespace is tolerated but false, quoted true and arbitrary values cannot enable AI', () => {
  assert.equal(server(undefined, { ...env, ORACLE_ENABLED: 'true\n', ORACLE_FREE_PLAN_CONFIRMED: ' true ' }).oracleConfigured(), true);
  for (const variable of ['ORACLE_ENABLED', 'ORACLE_FREE_PLAN_CONFIRMED']) {
    for (const value of ['false', '"true"', '1', 'TRUE', ' ', `${variable}=true`])
      assert.equal(server(undefined, { ...env, [variable]: value }).oracleConfigured(), false);
  }
});
test('only main admin can access configuration diagnostics; GET and PATCH never return a secret', async () => {
  for (const allowed of [false, true]) {
    let calls = 0;
    const route = load('app/api/admin/oracle/route.ts', {
      '@/lib/oracleConfig': config,
      '@/lib/oracleServer': server(undefined, { ...env, ORACLE_ENABLED: 'false' }),
      '@/app/api/admin/_auth': { assertMainAdmin: async () => allowed ? { ok: true, ctx: { userId: 'admin' } } : { ok: false, status: 403 } },
      '@/lib/supabaseServer': { supabaseServer: { rpc: async () => { calls++; return { data: { mode: 'admin', model: config.ORACLE_MODELS[0] } }; } } },
    });
    for (const method of ['GET', 'PATCH']) {
      const response = await route[method](method === 'GET' ? new Request('https://example.test/api/admin/oracle') : request({ mode: 'admin', model: config.ORACLE_MODELS[0] }));
      assert.equal(response.status, allowed ? 200 : 403);
      const json = await response.json();
      if (allowed) {
        assert.equal(json.configured, false);
        assert.equal(json.configurationIssues[0].variable, 'ORACLE_ENABLED');
      } else assert.equal(json.configurationIssues, undefined);
      assert.ok(!JSON.stringify(json).includes(env.GROQ_API_KEY));
    }
    assert.equal(calls, allowed ? 2 : 0);
  }
});
test('input rejects long/blank questions, custom endpoints, token overrides and non-UUID identifiers', async () => {
  const s = server();
  for (const body of [{ ...input(), question: ' ' }, { ...input(), question: 'x'.repeat(181) },
    { ...input(), max_tokens: 9999 }, { ...input(), url: 'https://other.test' }, { ...input(), model: 'paid-model' },
    { ...input(), requestId: 'replay' }, { ...input(), playerId: 'impersonated-player' },
    { ...input(), context: 'Invented rank #1' }]) assert.throws(() => s.parseOracleQuestion(body));
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
    const result = await s.askGroq('Wygram?', model, preparedPrompt);
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
test('expanded instructions fit the existing reservation with every maximum-length question encoding', async () => {
  const questions = ['x'.repeat(180), 'ą'.repeat(180), '界'.repeat(180), '\u{1F680}'.repeat(90)];
  let calls = 0;
  const s = server(async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    const bytes = Buffer.byteLength(body.messages.map(message => message.content).join(''), 'utf8');
    assert.ok(bytes + body.max_completion_tokens + 256 <= s.RESERVED_TOKENS,
      `prompt plus response reservation exceeded: ${bytes + body.max_completion_tokens + 256}`);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'Traf najpierw w puszkę.' } }], usage: { total_tokens: 900 } });
  });
  for (const question of questions) {
    assert.equal(question.length, config.ORACLE_QUESTION_LENGTH);
    const result = await s.askGroq(question, config.ORACLE_MODELS[1], preparedPrompt);
    assert.equal(result.answer, 'Traf najpierw w puszkę.');
  }
  assert.equal(calls, questions.length);
});

test('each prompt uses current full app rules and passes them unchanged to the provider', async () => {
  let rules = sampleRules;
  let calls = 0;
  const s = server(async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    assert.ok(body.messages[0].content.endsWith(rules));
    assert.equal(body.messages[1].content, 'Czym rzucamy?');
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'Kurczakiem.' } }] });
  }, env, async (options) => { assert.equal(options.strict, true); return rules; });
  for (const nextRules of [sampleRules, sampleRules + '\n3. Zmieniona zasada właściciela.']) {
    rules = nextRules;
    const systemPrompt = await s.prepareOraclePrompt('Czym rzucamy?');
    assert.equal(systemPrompt, prompt.buildOracleSystemPrompt(rules));
    await s.askGroq('Czym rzucamy?', config.ORACLE_MODELS[1], systemPrompt);
  }
  assert.equal(calls, 2);
});

test('unreadable or oversized rules fail before any reservation or provider call', async () => {
  for (const error of ['rules_unavailable', 'prompt_budget_exceeded', 'context_unavailable']) {
    const a = api({ promptError: error });
    const get = await (await a.GET(new Request('https://example.test/api/oracle'))).json();
    assert.equal(get.available, false); assert.equal(get.reason, error);
    const post = await a.POST(request(input()));
    assert.equal(post.status, 503); assert.equal((await post.json()).status.reason, error);
    assert.ok(!a.events.includes('provider'));
    assert.ok(!a.events.some(event => Array.isArray(event) && event[0] === 'oracle_gate' && event[1].p_request));
  }
  const s = server(undefined, env, async () => 'Reguła. '.repeat(2000));
  await assert.rejects(s.prepareOraclePrompt('Test?'), /prompt_budget_exceeded/);
});

test('final reservation rechecks quota after loading the rules', async () => {
  const a = api({ reservationGate: { available: false, reason: 'global_limit' } });
  assert.equal((await a.POST(request(input()))).status, 429);
  assert.ok(!a.events.includes('provider'));
  assert.equal(a.events.filter(event => Array.isArray(event) && event[0] === 'oracle_gate').length, 2);
});

test('strict rules reader refuses errors, missing and placeholder rules while existing pages retain fallback', async () => {
  let row = { data: { content: sampleRules }, error: null };
  const reader = load('lib/tournamentRules.ts', {
    '@/lib/supabaseServer': { supabaseServer: { from(table) {
      assert.equal(table, 'rule_templates');
      return { select() { return this; }, eq(key, value) {
        assert.equal(key, 'id'); assert.equal(value, 'default'); return this;
      }, async maybeSingle() { return row; } };
    } } },
  });
  assert.equal(await reader.readDefaultRules({ strict: true }), sampleRules);
  for (const invalid of [null, '', ' ', reader.DEFAULT_RULES_TEXT]) {
    row = { data: invalid === null ? null : { content: invalid }, error: null };
    await assert.rejects(reader.readDefaultRules({ strict: true }), /rules_unavailable/);
  }
  row = { data: null, error: { message: 'private DB error' } };
  await assert.rejects(reader.readDefaultRules({ strict: true }), /rules_unavailable/);
  assert.equal(await reader.readDefaultRules(), reader.DEFAULT_RULES_TEXT);
});

test('complete published rules fit the edited prompt for a normal question', {
  skip: !process.env.ORACLE_RULES_FIXTURE,
}, async () => {
  const rules = fs.readFileSync(process.env.ORACLE_RULES_FIXTURE, 'utf8');
  const s = server(undefined, env, async () => rules);
  const systemPrompt = await s.prepareOraclePrompt('Czy wygram dzisiaj we flanki?');
  assert.ok(systemPrompt.endsWith(rules));
  const withContext = await s.prepareOraclePrompt('Czy wygram dzisiaj we flanki?', 'verified-player');
  assert.ok(withContext.includes(rules));
  assert.ok(withContext.includes('Pytający="Tester".'));
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
    const result = await server(async () => { count++; return response(); }).askGroq('Test?', config.ORACLE_MODELS[0], preparedPrompt);
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
  assert.equal(response.status, 200); assert.equal(a.events.length, 2); assert.equal(a.events[0][1].p_request, null);
  assert.equal(a.events[1][0], 'prompt');
  assert.equal(a.events[1][2], undefined, 'availability polling must not read player context');
  assert.equal((await response.json()).model, undefined);
  const player = api({ auth: { ok: true, ctx: { userId: 'player', isMainAdmin: false } } });
  assert.equal((await player.POST(request({ ...input(), model: config.ORACLE_MODELS[0] }))).status, 403);
  assert.equal(player.events.length, 0);
});
test('reservation happens before provider and finish before availability recheck; failed finish hides button', async () => {
  const a = api(); const response = await a.POST(request(input()));
  assert.equal(response.status, 200);
  assert.deepEqual(a.events.map(x => typeof x === 'string' ? x : x[0]), ['oracle_gate', 'prompt', 'oracle_gate', 'provider', 'oracle_finish', 'oracle_gate']);
  assert.equal(a.events[1][2], 'verified-player', 'identity must come from authentication, not the request');
  const broken = api({ finishError: true });
  const json = await (await broken.POST(request(input()))).json();
  assert.equal(json.answer, 'Masz szansę.'); assert.equal(json.status.available, false);
});
