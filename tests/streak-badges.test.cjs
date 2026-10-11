const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.join(__dirname, '..');
const styles = Object.fromEntries(['badge', 'artwork', 'count', 'winstreak', 'losestreak'].map(key => [key, `streak-test-${key}`]));
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports: mod.exports, module: mod, require: name => {
    if (name === 'next/image') return { default: props => React.createElement('img', props) };
    if (name.endsWith('.module.css')) return { default: styles };
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
    if (name.startsWith('./')) return load(path.posix.join(path.posix.dirname(file), name) + '.tsx');
    return require(name);
  } });
  cache.set(file, mod.exports);
  return mod.exports;
}
function badge(kind, count, duelWins = 0) {
  const name = kind === 'win' ? 'WinstreakBadge' : 'LosestreakBadge';
  const component = load(`app/components/${name}.tsx`).default;
  return renderToStaticMarkup(React.createElement(component, kind === 'win' ? { wins: count, duelWins } : { losses: count }));
}

test('streak artwork switches exactly at the existing thresholds and retains descriptions', () => {
  for (const count of [0, 1]) assert.equal(badge('win', count), '');
  for (const count of [2, 3, 4, 6]) assert.match(badge('win', count), /winstreak-low\.png/);
  for (const count of [7, 8, 100]) assert.match(badge('win', count), /winstreak-high\.png/);
  for (const count of [0, 1, 2]) assert.equal(badge('loss', count), '');
  for (const count of [3, 5]) assert.match(badge('loss', count), /losestreak-low\.png/);
  for (const count of [6, 7, 100]) assert.match(badge('loss', count), /losestreak-high\.png/);
  assert.match(badge('win', 7, 2), /Limit 1v1/);
  assert.match(badge('loss', 6), /Bez dodatkowych strat MMR i PP/);
  assert.match(badge('win', 7), /role="img" aria-label="7 /);
  assert.match(badge('win', 7), />7<\/strong>/);
  for (const kind of ['winstreak', 'losestreak']) for (const tier of ['low', 'high']) {
    const png = fs.readFileSync(path.join(root, 'public/streaks', `${kind}-${tier}.png`));
    assert.equal(png.readUInt32BE(16) / png.readUInt32BE(20), 3);
  }
});

test('streak artwork fits player rows and profiles at mobile/desktop sizes', {
  skip: !process.env.PROFILE_PLAYWRIGHT_PATH || !process.env.PROFILE_CHROME_PATH,
}, async t => {
  const { chromium } = require(process.env.PROFILE_PLAYWRIGHT_PATH);
  const css = fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8').replace(/@import[^;]+;/g, '') +
    fs.readFileSync(path.join(root, 'app/components/StreakBadge.module.css'), 'utf8').replace(/\.([a-z]+)/g, (all, key) => styles[key] ? `.${styles[key]}` : all);
  const fixtures = [['win', 4], ['win', 7], ['loss', 3], ['loss', 6], ['win', 100]];
  const html = fixtures.map(([kind, count]) => `<div class="player-rank-card"><div class="player-rank-main">Tomek</div><div class="player-rank-right">${badge(kind, count)}<span>aktywny</span><span class="player-rank-pp">MMR 10.0</span></div></div>`).join('') +
    `<div class="profile-rating-meta">${badge('win', 7)}${badge('loss', 6)}</div>`;
  const server = http.createServer((req, res) => {
    if (/^\/streaks\/(win|lose)streak-(low|high)\.png$/.test(req.url)) {
      res.setHeader('content-type', 'image/png');
      res.end(fs.readFileSync(path.join(root, 'public', req.url)));
    } else res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\n*{box-sizing:border-box}body{margin:0;padding:16px;background:#c6e6d4;font-family:Arial}.player-rank-card{margin-bottom:12px}.profile-rating-meta{display:flex;flex-wrap:wrap;gap:12px}</style>${html}`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ executablePath: process.env.PROFILE_CHROME_PATH, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px overflow`);
    for (const img of await page.locator(`.${styles.artwork}`).all()) {
      assert.equal(await img.evaluate(el => el.complete && el.naturalWidth > 0), true);
      const box = await img.boundingBox();
      assert.ok(Math.abs(box.width / box.height - 3) < 0.02);
    }
    if (process.env.PROFILE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.PROFILE_SCREENSHOT_DIR, `streak-badges-${width}.png`), fullPage: true });
  }
});
