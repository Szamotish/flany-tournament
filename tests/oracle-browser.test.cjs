const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ts = require('typescript');

test('oracle hides/reappears on quota updates and preserves the last answer', {
  skip: !process.env.ORACLE_PLAYWRIGHT_PATH || !process.env.ORACLE_CHROME_PATH,
}, async (t) => {
  const { chromium } = require(process.env.ORACLE_PLAYWRIGHT_PATH);
  const modules = {};
  const addPackage = (name, packageName, file) => {
    modules[name] = fs.readFileSync(path.join(path.dirname(require.resolve(packageName)), 'cjs', file), 'utf8');
  };
  addPackage('react', 'react', 'react.production.js');
  addPackage('react/jsx-runtime', 'react', 'react-jsx-runtime.production.js');
  addPackage('react-dom', 'react-dom', 'react-dom.production.js');
  addPackage('react-dom/client', 'react-dom', 'react-dom-client.production.js');
  addPackage('scheduler', 'scheduler', 'scheduler.production.js');
  for (const file of ['app/components/MagicOracle.tsx', 'app/components/useOracle.ts', 'app/components/useOracleMotion.ts', 'lib/oracleConfig.ts']) {
    modules[`@/${file.replace(/\.tsx?$/, '')}`] = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
  }
  modules['@/lib/authClient'] = `exports.authedFetch = (url, options) => window.fetch(url, options);`;
  modules['next/image'] = `exports.default = props => require('react').createElement('img', props);`;
  modules['@/lib/supabaseBrowser'] = `exports.getSupabaseBrowserClient = () => ({
    auth: { onAuthStateChange(cb) { window.authEvent = cb; queueMicrotask(() => cb('INITIAL_SESSION', {user:{id:'admin'}}));
      return {data:{subscription:{unsubscribe(){}}}}; } },
    channel() { return { on(event, options, cb) { window.realtime = cb; return this; }, subscribe() { return this; } }; },
    removeChannel() {}
  });`;
  const bundle = `const process={env:{NODE_ENV:'production'}}; const modules={${Object.entries(modules).map(([name, code]) =>
    `${JSON.stringify(name)}:function(require,module,exports){\n${code}\n}`).join(',')}};
    const cache={}; function require(name){if(cache[name]) return cache[name].exports;
      const module=cache[name]={exports:{}};modules[name](require,module,module.exports);return module.exports;}
    require('react-dom/client').createRoot(document.getElementById('root')).render(
      require('react').createElement(require('@/app/components/MagicOracle').default));`;
  let state = { available: false, reason: 'disabled' };
  let posts = 0, holdPost = false, releasePost;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/oracle') {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST') {
        posts++;
        if (holdPost) await new Promise(resolve => { releasePost = resolve; });
        state = { available: false, reason: 'global_limit', retryAt: new Date(Date.now() + 1000).toISOString() };
        res.end(JSON.stringify({ answer: 'Dziś stawiam na Ciebie.', status: state }));
      } else res.end(JSON.stringify(state));
    } else if (req.url === '/bundle.js') { res.setHeader('content-type', 'application/javascript'); res.end(bundle); }
    else if (req.url === '/styles.css') {
      res.setHeader('content-type', 'text/css');
      res.end(fs.readFileSync(path.join(__dirname, '..', 'app/globals.css'), 'utf8').replace(/@import[^;]+;/g, '') + '\n* { box-sizing: border-box; } body { margin: 0; }');
    } else if (['/8ballcover.png', '/8ball-clean.png', '/title.png'].includes(req.url)) {
      res.setHeader('content-type', 'image/png');
      res.end(fs.readFileSync(path.join(__dirname, '..', 'public', req.url.slice(1))));
    } else if (req.url === '/') res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="stylesheet" href="/styles.css"><main class="landing-root"><div class="landing-shell"><section class="landing-grid">
      <article class="glass-card landing-main"><div id="root"></div><h1 class="landing-title"><img class="landing-title-image" src="/title.png" alt="Flanki League"></h1>
      <div class="landing-link-list"><a class="landing-link-card">Turnieje</a><a class="landing-link-card">Zawodnicy</a><a class="landing-link-card">Ranking</a></div></article>
      <article class="glass-card landing-beer">Piwo dnia</article></section></div></main><script src="/bundle.js"></script>`);
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.ORACLE_CHROME_PATH, headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => typeof window.realtime === 'function');
  const launcher = page.getByRole('button', { name: 'Otwórz magiczną kulę' });
  assert.equal(await launcher.count(), 0);
  assert.equal(posts, 0);

  state = { available: true, reason: 'ready' };
  await page.evaluate(() => window.realtime());
  await launcher.waitFor();
  for (const width of [1440, 980, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const button = await launcher.boundingBox();
    const card = await page.locator('.landing-main').boundingBox();
    const logo = await page.locator('.landing-title').boundingBox();
    assert.ok(button.width >= 44 && button.height >= 44, 'touch target');
    assert.ok(button.x + button.width <= card.x + card.width && button.y >= card.y, 'button stays inside card');
    assert.ok(card.x + card.width - button.x - button.width < 20 && button.y - card.y < 20, 'button in top right');
    assert.ok(button.x >= logo.x + logo.width || button.y + button.height <= logo.y, 'button does not overlap logo');
    await launcher.click();
    const dialog = page.getByRole('dialog');
    assert.equal(await dialog.evaluate(el => el.parentElement === document.body), true, 'modal escapes glass card clipping');
    assert.deepEqual(await dialog.boundingBox(), { x: 0, y: 0, width, height: 900 });
    await page.getByRole('button', { name: 'Zamknij', exact: true }).last().click();
    if (process.env.ORACLE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.ORACLE_SCREENSHOT_DIR, `oracle-home-${width}.png`) });
  }
  await launcher.click();
  await page.getByRole('textbox').fill('Wygram?');
  holdPost = true;
  await page.getByRole('button', { name: 'Zapytaj', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('input').disabled);
  await page.getByRole('textbox').press('Enter');
  assert.equal(posts, 1, 'repeated submit while loading must not send another request');
  releasePost();
  await page.getByText('Dziś stawiam na Ciebie.', { exact: true }).waitFor();
  assert.equal(await launcher.count(), 0);
  assert.equal(await page.getByRole('textbox').isDisabled(), true);

  // The reset timer must perform only a status request and restore the entry point.
  state = { available: true, reason: 'ready' };
  await launcher.waitFor({ timeout: 4000 });
  assert.equal(posts, 1);
  assert.equal(await page.getByText('Dziś stawiam na Ciebie.', { exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Zamknij', exact: true }).last().click();

  state = { available: false, reason: 'personal_limit' };
  await page.evaluate(() => window.realtime());
  await launcher.waitFor({ state: 'detached' });
  assert.equal(posts, 1);
  state = { available: true, reason: 'ready' };
  await page.evaluate(() => window.realtime()); await launcher.waitFor();
  await page.evaluate(() => window.authEvent('SIGNED_OUT', null));
  await launcher.waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);

  holdPost = false;
  // Exercise motion permissions and real React event handling without using AI quota.
  for (const permission of ['granted', 'automatic', 'denied', 'error', 'unsupported']) {
    await t.test(`phone motion: ${permission}`, async () => {
      state = { available: true, reason: 'ready' };
      const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
      const phoneErrors = [];
      phone.on('pageerror', error => phoneErrors.push(error.message));
      await phone.addInitScript(permission => {
        window.permissionCalls = 0;
        if (permission === 'unsupported') {
          Object.defineProperty(window, 'DeviceMotionEvent', { value: undefined });
        } else if (permission === 'automatic') {
          Object.defineProperty(window.DeviceMotionEvent, 'requestPermission', { value: undefined });
        } else if (permission !== 'automatic') {
          window.DeviceMotionEvent.requestPermission = async () => {
            window.permissionCalls++;
            if (permission === 'error') throw new Error('sensor blocked');
            return permission;
          };
        }
        window.shakePhone = async (strength = 14, axis = 'x', gravity = false) => {
          for (let i = 0; i < 9; i++) {
            const values = { x: 0, y: 0, z: gravity ? 9.81 : 0, [axis]: (i % 2 ? -1 : 1) * strength };
            window.dispatchEvent(new DeviceMotionEvent('devicemotion', {
              [gravity ? 'accelerationIncludingGravity' : 'acceleration']: values,
            }));
            await new Promise(resolve => setTimeout(resolve, 110));
          }
        };
      }, permission);
      await phone.goto(`http://127.0.0.1:${server.address().port}`);
      await phone.getByRole('button', { name: 'Otwórz magiczną kulę' }).click();
      const startPosts = posts;
      assert.equal(await phone.evaluate(() => window.permissionCalls), 0, 'opening must not ask for permission');
      if (permission !== 'automatic' && permission !== 'unsupported') {
        await phone.getByRole('button', { name: 'Włącz potrząsanie telefonem' }).click();
        assert.equal(await phone.evaluate(() => window.permissionCalls), 1);
      }
      if (permission === 'denied' || permission === 'error') {
        await phone.getByText('Brak dostępu do czujnika ruchu.', { exact: false }).waitFor();
        await phone.getByRole('textbox').fill('Wygram?');
        await phone.evaluate(() => window.shakePhone());
        assert.equal(posts, startPosts);
        assert.equal(await phone.getByRole('button', { name: 'Zapytaj', exact: true }).isEnabled(), true);
      } else if (permission === 'unsupported') {
        assert.equal(await phone.getByRole('button', { name: 'Włącz potrząsanie telefonem' }).count(), 0);
        await phone.getByRole('textbox').fill('Wygram?');
        assert.equal(await phone.getByRole('button', { name: 'Zapytaj', exact: true }).isEnabled(), true);
      } else {
        await phone.getByText('Wpisz pytanie i potrząśnij telefonem', { exact: false }).waitFor();
        await phone.evaluate(() => window.shakePhone());
        assert.equal(posts, startPosts, 'no question, no request');
        await phone.getByRole('textbox').fill('Wygram?');
        await phone.waitForTimeout(450);
        await phone.evaluate(() => window.shakePhone(1));
        assert.equal(posts, startPosts, 'small movements must not ask');
        await phone.evaluate(() => window.shakePhone(0, 'x', true));
        assert.equal(posts, startPosts, 'stationary gravity must not ask');
        // Portrait linear acceleration and landscape gravity-only fallback.
        await phone.evaluate(gravity => window.shakePhone(14, gravity ? 'y' : 'x', gravity), permission === 'automatic');
        await phone.getByText('Dziś stawiam na Ciebie.', { exact: true }).waitFor();
        assert.equal(posts, startPosts + 1, 'one gesture sends one question');
        state = { available: true, reason: 'ready' };
        await phone.evaluate(() => window.realtime());
        await phone.getByRole('button', { name: 'Otwórz magiczną kulę' }).waitFor();
        await phone.evaluate(() => window.shakePhone());
        assert.equal(posts, startPosts + 1, 'continued shaking must preserve the answer');
        // A fresh question is armed, but closing must detach the sensor listener.
        await phone.getByRole('textbox').fill('A jutro?');
        await phone.getByRole('button', { name: 'Zamknij', exact: true }).last().click();
        await phone.evaluate(() => window.shakePhone());
        assert.equal(posts, startPosts + 1, 'closed ball must not ask');
      }
      assert.deepEqual(phoneErrors, []);
      await phone.close();
    });
  }
});
