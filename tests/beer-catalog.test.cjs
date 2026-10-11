const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/beers.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject });
const { BEER_LIST, beerLabelPath, beerOfTheDay, isKnownBeerName } = exportsObject;

test('every selectable beer has a unique name and an existing PNG label', () => {
  assert.equal(new Set(BEER_LIST.map(beer => beer.name)).size, BEER_LIST.length);
  for (const beer of BEER_LIST) {
    assert.equal(isKnownBeerName(beer.name), true);
    const label = path.join(__dirname, '../public', decodeURIComponent(beerLabelPath(beer.name)));
    assert.equal(fs.readFileSync(label).subarray(1, 4).toString(), 'PNG', beer.name);
  }
});

test('white Zywiec keeps its own label and legacy names still resolve', () => {
  assert.equal(beerLabelPath('Żywiec Białe'), '/models/etykiety clean/zywiec%20biale.png');
  assert.equal(beerLabelPath('Żywiec'), '/models/etykiety clean/zywiec.png');
  assert.equal(beerLabelPath('  ZYWIEC BIALE  '), beerLabelPath('Żywiec Białe'));
  assert.equal(beerLabelPath('Łomża'), beerLabelPath('omza'));
  assert.equal(beerLabelPath('Perła'), beerLabelPath('pera'));
  assert.equal(beerLabelPath('Namysłów'), beerLabelPath('namysow'));
  assert.equal(beerLabelPath('Beck’s'), beerLabelPath("Beck's"));
  assert.equal(beerLabelPath('unknown'), null);
});

test('daily selection remains deterministic and can select every beer', () => {
  const selected = new Set();
  for (let day = 0; day < 366; day++) {
    const key = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
    const beer = beerOfTheDay(key);
    assert.equal(beer.name, beerOfTheDay(key).name);
    assert.equal(isKnownBeerName(beer.name), true);
    selected.add(beer.name);
  }
  assert.equal(selected.size, BEER_LIST.length);
});
