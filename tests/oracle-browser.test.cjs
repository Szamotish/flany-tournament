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
  for (const file of ['app/components/MagicOracle.tsx', 'app/components/useOracle.ts', 'lib/oracleConfig.ts']) {
    modules[`@/${file.replace(/\.tsx?$/, '')}`] = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
  }
  modules['@/lib/authClient'] = `exports.authedFetch = (url, options) => window.fetch(url, options);`;
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
    else if (req.url === '/') res.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/bundle.js"></script>');
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.ORACLE_CHROME_PATH, headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => typeof window.realtime === 'function');
  const launcher = page.getByRole('button', { name: 'Otworz magiczna kule' });
  assert.equal(await launcher.count(), 0);
  assert.equal(posts, 0);

  state = { available: true, reason: 'ready' };
  await page.evaluate(() => window.realtime());
  await launcher.waitFor();
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
});
