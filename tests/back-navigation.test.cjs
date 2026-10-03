const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../app/components/BackNavButton.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function browser(start, navigationApi = true) {
  const entries = [start];
  let index = 0;
  const router = {
    back() { if (index > 0) index--; },
    push(url) { entries.splice(++index, entries.length, url); },
    replace(url) { entries[index] = url; },
  };
  const window = {
    history: { get length() { return entries.length; } },
    ...(navigationApi ? { navigation: { get canGoBack() { return index > 0; } } } : {}),
  };
  const mod = { exports: {} };
  vm.runInNewContext(code, {
    module: mod, exports: mod.exports, window,
    require(name) { return name === 'next/navigation' ? { useRouter: () => router } : require(name); },
  });
  return {
    visit: router.push,
    back(fallbackHref) { mod.exports.default({ fallbackHref }).props.onClick(); },
    get url() { return entries[index]; },
    get length() { return entries.length; },
  };
}

for (const entry of ['/tournaments', '/players/winner']) {
  for (const section of ['teams', 'matches', 'rules', 'admin']) {
    test(`${entry} -> tournament -> ${section} -> Back -> Back returns to its entry`, () => {
      const b = browser(entry);
      b.visit('/tournaments/cup');
      b.visit(`/tournaments/cup/${section}`);
      b.back('/tournaments/cup');
      assert.equal(b.url, '/tournaments/cup');
      b.back('/tournaments');
      assert.equal(b.url, entry);
      assert.equal(b.length, 3, 'Back must not add a new history entry');
    });
  }
}

test('nested match administration unwinds back to the player profile', () => {
  const b = browser('/players/winner');
  for (const url of ['/tournaments/cup', '/tournaments/cup/matches', '/tournaments/cup/admin-matches']) b.visit(url);
  for (const target of ['/tournaments/cup/matches', '/tournaments/cup', '/players/winner']) {
    b.back(target);
    assert.equal(b.url, target);
  }
});

test('direct entry uses replacement for fallback and does not create a loop', () => {
  const b = browser('/tournaments/cup/teams');
  b.back('/tournaments/cup');
  assert.equal(b.url, '/tournaments/cup');
  b.back('/tournaments');
  assert.equal(b.url, '/tournaments');
  assert.equal(b.length, 1);
});

test('forward entries are not mistaken for a previous page', () => {
  const b = browser('/tournaments/cup');
  b.visit('/tournaments/cup/teams');
  b.back('/tournaments/cup');
  assert.equal(b.length, 2);
  b.back('/tournaments');
  assert.equal(b.url, '/tournaments');
});

test('browsers without the Navigation API still return along the normal visit path', () => {
  const b = browser('/players/winner', false);
  b.visit('/tournaments/cup');
  b.visit('/tournaments/cup/teams');
  b.back('/tournaments/cup');
  b.back('/tournaments');
  assert.equal(b.url, '/players/winner');
  const direct = browser('/tournaments/cup/teams', false);
  direct.back('/tournaments/cup');
  direct.back('/tournaments');
  assert.equal(direct.url, '/tournaments');
  assert.equal(direct.length, 1);
});
