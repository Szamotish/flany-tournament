const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ts = require('typescript');

test('profile chart zoom, touch gestures, details and persisted customization', {
  skip: !process.env.PROFILE_PLAYWRIGHT_PATH || !process.env.PROFILE_CHROME_PATH,
}, async t => {
  const { chromium } = require(process.env.PROFILE_PLAYWRIGHT_PATH);
  const modules = {};
  for (const [name, pkg, file] of [
    ['react', 'react', 'react.production.js'], ['react/jsx-runtime', 'react', 'react-jsx-runtime.production.js'],
    ['react-dom', 'react-dom', 'react-dom.production.js'], ['react-dom/client', 'react-dom', 'react-dom-client.production.js'],
    ['scheduler', 'scheduler', 'scheduler.production.js'],
  ]) modules[name] = fs.readFileSync(path.join(path.dirname(require.resolve(pkg)), 'cjs', file), 'utf8');
  for (const file of ['app/components/ProfileMmrChart.tsx', 'app/components/ProfileRankPanel.tsx', 'app/players/[id]/ProfileSettingsButton.tsx',
    'lib/profileHistory.ts', 'lib/profilePreferences.ts', 'lib/playerRank.ts', 'lib/ranked.ts', 'lib/beers.ts', 'lib/ui/playerProfile.ts']) {
    modules[`@/${file.replace(/\.tsx?$/, '')}`] = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
  }
  modules['@/lib/authClient'] = 'exports.authedFetch = (url, options) => fetch(url, options);';
  modules['next/navigation'] = 'exports.useRouter = () => ({ refresh: () => window.location.reload() });';
  const bundle = `const process={env:{NODE_ENV:'production'}}; const modules={${Object.entries(modules).map(([name, code]) => `${JSON.stringify(name)}:function(require,module,exports){\n${code}\n}`).join(',')}};
    const cache={}; function require(name){if(cache[name])return cache[name].exports;const mod=cache[name]={exports:{}};modules[name](require,mod,mod.exports);return mod.exports;}
    const h=require('react').createElement, prefs=window.initialPreferences;
    const points=Array.from({length:100},(_,i)=>({id:String(i),mmr:5+Math.sin(i/5)/2,prestigePoints:0,playedAt:new Date(Date.UTC(2026,6,1+i)).toISOString(),tournamentName:'FL #fixture'+i}));
    const panel=require('@/app/components/ProfileRankPanel').default;
    require('react-dom/client').createRoot(document.getElementById('root')).render(h('article',{className:'profile-card profile-hero'},
      h(require('@/app/players/[id]/ProfileSettingsButton').default,{playerId:'p',currentRank:'platinum',initialPreferences:prefs,initialRankFrameEnabled:true,initialProfileColor:null,initialFavoriteBeer:null}),
      h('h1',{},'Profil gracza'),h(panel,{rank:prefs.rank_panel||'platinum'},h('div',{className:'profile-rating-layout'},h('div',{className:'profile-rating-head'},
        h('div',{},h('p',{},'Rating'),h('strong',{},'9.6 /10')),
        h(require('@/app/components/ProfileMmrChart').default,{points,from:prefs.chart_from,to:prefs.chart_to}))))));`;
  let preferences = { chart_from: null, chart_to: null, rank_panel: null };
  let writes = 0;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/bundle.js') { res.setHeader('content-type', 'application/javascript'); res.end(bundle); }
    else if (req.url === '/styles.css') {
      res.setHeader('content-type', 'text/css'); res.end(fs.readFileSync(path.join(__dirname, '../app/globals.css'), 'utf8').replace(/@import[^;]+;/g, '')
        + '\n* {box-sizing:border-box} body{margin:0;font-family:Arial;padding:16px} #root{max-width:820px;margin:0 auto} .profile-card{position:relative}');
    } else if (/^\/panel\/(platyna|gold|unranked|silver|bronze)\.png$/.test(req.url)) {
      res.setHeader('content-type', 'image/png'); res.end(fs.readFileSync(path.join(__dirname, '../public', req.url.slice(1))));
    } else if (req.url === '/api/auth/me') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ player: { id: 'p' }, isMainAdmin: false })); }
    else if (req.url === '/api/public/players/p/profile' && req.method === 'PATCH') {
      let input = ''; for await (const chunk of req) input += chunk;
      const body = JSON.parse(input); writes++;
      preferences = { chart_from: body.chartFrom, chart_to: body.chartTo, rank_panel: body.rankPanel };
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ player: body }));
    } else if (req.url === '/') res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>window.initialPreferences=${JSON.stringify(preferences)}</script><script src="/bundle.js"></script>`);
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.PROFILE_CHROME_PATH, headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 }, hasTouch: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const plot = page.locator('.profile-chart-viewport');
  await plot.waitFor();
  const dots = page.locator('.profile-mmr-chart-dot');
  assert.equal(await dots.count(), 100);
  await plot.hover(); await page.mouse.wheel(0, -500);
  await page.waitForFunction(() => document.querySelectorAll('.profile-mmr-chart-dot').length < 100);
  const zoomed = await dots.count();
  assert.ok(zoomed < 100 && zoomed > 3);
  const dates = await page.locator('.profile-chart-dates').innerText();
  const box = await plot.boundingBox();
  await page.mouse.move(box.x + box.width * .6, box.y + 40); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .2, box.y + 40, { steps: 5 }); await page.mouse.up();
  assert.notEqual(await page.locator('.profile-chart-dates').innerText(), dates);
  await plot.click();
  assert.match(await page.locator('.profile-chart-detail').innerText(), /MMR.*PP.*FL #fixture/);
  await page.getByRole('button', { name: 'Pokaż cały wybrany okres' }).click();
  assert.equal(await dots.count(), 100);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBox = await plot.boundingBox();
  const client = await page.context().newCDPSession(page);
  const cx = mobileBox.x + mobileBox.width / 2, cy = mobileBox.y + mobileBox.height / 2;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy - 10, id: 1 }, { x: cx, y: cy + 10, id: 2 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - 40, id: 1 }, { x: cx, y: cy + 40, id: 2 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => document.querySelectorAll('.profile-mmr-chart-dot').length < 100);
  assert.ok(await dots.count() < 50, 'vertical pinch must also zoom');
  await plot.focus(); await page.keyboard.press('Home');
  assert.equal(await dots.count(), 100);
  await page.keyboard.press('ArrowRight');
  assert.match(await page.locator('.profile-chart-detail').innerText(), /MMR/);
  if (process.env.PROFILE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.PROFILE_SCREENSHOT_DIR, 'profile-chart-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Ustawienia profilu' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  const choices = await page.locator('#profile-rank-panel option').allTextContents();
  assert.ok(choices.includes('Platyna') && choices.includes('Gold') && !choices.includes('Master'));
  await page.getByLabel('Od', { exact: true }).fill('2026-08-01');
  await page.getByLabel('Do', { exact: true }).fill('2026-08-31');
  await page.getByLabel('Wygląd panelu rankingowego').selectOption('gold');
  if (process.env.PROFILE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.PROFILE_SCREENSHOT_DIR, 'profile-settings-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Zapisz ustawienia' }).click();
  await page.waitForFunction(() => window.initialPreferences.chart_from === '2026-08-01');
  await plot.waitFor();
  assert.equal(writes, 1);
  assert.equal(await dots.count(), 31);
  assert.match(await page.locator('.profile-rating-box').getAttribute('style'), /gold.png/);
  await page.getByRole('button', { name: 'Ustawienia profilu' }).click();
  assert.equal(await page.getByLabel('Od', { exact: true }).inputValue(), '2026-08-01');
  await page.getByRole('button', { name: 'Cała historia', exact: true }).click();
  await page.getByLabel('Wygląd panelu rankingowego').selectOption('');
  await page.getByRole('button', { name: 'Zapisz ustawienia' }).click();
  await page.waitForFunction(() => window.initialPreferences.chart_from === null);
  await plot.waitFor();
  assert.equal(await dots.count(), 100);
  assert.deepEqual(errors, []);
});
