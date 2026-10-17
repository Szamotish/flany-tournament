const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ts = require('typescript');

test('notebook UI records bonus hits, finishes, rotations, offline drafts and conflicts without mobile overflow', {
  skip: !process.env.PROFILE_PLAYWRIGHT_PATH || !process.env.PROFILE_CHROME_PATH,
}, async t => {
  const { chromium } = require(process.env.PROFILE_PLAYWRIGHT_PATH);
  const modules = {};
  for (const [name, pkg, file] of [
    ['react','react','react.production.js'], ['react/jsx-runtime','react','react-jsx-runtime.production.js'],
    ['react-dom','react-dom','react-dom.production.js'], ['react-dom/client','react-dom','react-dom-client.production.js'], ['scheduler','scheduler','scheduler.production.js'],
  ]) modules[name] = fs.readFileSync(path.join(path.dirname(require.resolve(pkg)), 'cjs', file), 'utf8');
  const folder = 'app/tournaments/[id]/admin/notebook';
  const css = fs.readFileSync(path.join(__dirname, '..', folder, 'Notebook.module.css'), 'utf8');
  const styles = Object.fromEntries([...css.matchAll(/\.([a-zA-Z]+)/g)].map(m => [m[1], 'notebook-' + m[1]]));
  for (const file of [`${folder}/NotebookClient.tsx`, `${folder}/useNotebook.ts`, 'lib/notebook.ts', 'lib/beers.ts']) {
    const name = '@/' + file.replace(/\.tsx?$/, '');
    modules[name] = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText.replace(/require\("(\.[^"]+)"\)/g, (_, rel) => `require(${JSON.stringify(path.posix.join(path.posix.dirname(name), rel))})`);
  }
  modules[`@/${folder}/Notebook.module.css`] = `exports.default=${JSON.stringify(styles)};`;
  modules['@/app/components/BackNavButton'] = 'exports.default=()=>null;';
  modules['@/lib/authClient'] = 'exports.authedFetch=(url,init)=>fetch(url,init);';
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const catalog = { viewerId: id(90), teams: [{ id: id(10), name: 'Pierwsza' }, { id: id(20), name: 'Druga' }],
    matches: [{ id: id(100), bo: 3, round_no: 1, match_no: 1, status: 'pending', team_a_id: id(10), team_b_id: id(20) }],
    players: [{ id: id(1), name: 'Maciek', teamId: id(10) }, { id: id(2), name: 'Franek', teamId: id(10) }, { id: id(3), name: 'Kasia', teamId: id(20) }] };
  const bundle = `const process={env:{NODE_ENV:'production'}};const modules={${Object.entries(modules).map(([name, code]) => `${JSON.stringify(name)}:function(require,module,exports){\n${code}\n}`).join(',')}};
    const cache={};function require(name){if(cache[name])return cache[name].exports;const mod=cache[name]={exports:{}};modules[name](require,mod,mod.exports);return mod.exports;}
    require('react-dom/client').createRoot(document.querySelector('#root')).render(require('react').createElement(require('@/${folder}/NotebookClient').default,{tournamentId:${JSON.stringify(id(200))},initialMatch:''}));`;
  const records = new Map();
  let puts = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/bundle.js') { res.setHeader('content-type', 'application/javascript'); res.end(bundle); return; }
    if (url.pathname.includes('/api/admin/')) {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'PUT') {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw); puts++;
        const stored = records.get(body.game);
        if ((stored?.revision ?? 0) !== body.revision) { res.statusCode = 409; res.end(JSON.stringify({ error: 'revision_conflict' })); return; }
        records.set(body.game, { document: body.document, revision: body.revision + 1 });
        res.end(JSON.stringify({ revision: body.revision + 1 })); return;
      }
      res.end(JSON.stringify(url.searchParams.has('matchId') ? records.get(Number(url.searchParams.get('game'))) ?? { document: null, revision: 0 } : catalog)); return;
    }
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      *{box-sizing:border-box}body{font-family:Arial;margin:0;padding:12px;background:#c6e8dd}.tour-shell{max-width:1100px;margin:auto}.glass-card{background:#ffffff80;border-radius:14px}
      ${css.replace(/\.([a-zA-Z]+)/g, (all, key) => styles[key] ? '.' + styles[key] : all)}</style><div id="root"></div><script src="/bundle.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ executablePath: process.env.PROFILE_CHROME_PATH, headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 390, height: 850 }, hasTouch: true });
  const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByLabel('Maciek, rzut, Puszka przeciwnika', { exact: true }).check();
  assert.equal(await page.getByLabel('Maciek, rzut, Rzucił', { exact: true }).isChecked(), true);
  await page.getByLabel('Maciek, bonus 1, Środek', { exact: true }).check();
  await page.getByLabel('Franek, rzut, Środek', { exact: true }).check();
  await page.getByLabel('Maciek, skończył przy trafieniu', { exact: true }).selectOption({ index: 2 });
  const finishId = await page.getByLabel('Maciek, skończył przy trafieniu', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Następna', exact: true }).click();
  assert.equal(await page.getByLabel('Maciek, rzut, Rzucił', { exact: true }).isChecked(), false);
  assert.equal(await page.getByLabel('Maciek, skończył przy trafieniu', { exact: true }).inputValue(), finishId);
  await page.getByLabel('Franek, rzut, Środek', { exact: true }).check();
  await page.getByLabel('Franek, skończył przy trafieniu', { exact: true }).selectOption({ index: 3 });
  await page.getByRole('button', { name: 'Zapisz teraz', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^Zapisane$/ }).waitFor();
  assert.equal(records.get(1).document.rotations.length, 2);
  await context.setOffline(true);
  await page.getByLabel('Kasia, rzut, Środek', { exact: true }).check();
  await page.getByRole('status').filter({ hasText: 'Brak połączenia' }).waitFor();
  const dirtyKey = await page.evaluate(() => Object.keys(localStorage).find(k => k.startsWith('flanki-notebook:')));
  assert.equal(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).dirty, dirtyKey), true);
  await context.setOffline(false);
  await page.reload();
  await page.getByRole('status').filter({ hasText: /^Zapisane$/ }).waitFor();
  await page.getByLabel('Rotacja', { exact: true }).selectOption({ value: '1' });
  await page.waitForFunction(() => document.querySelector('[aria-label="Kasia, rzut, Środek"]')?.checked);
  assert.equal(await page.getByLabel('Kasia, rzut, Środek', { exact: true }).isChecked(), true);
  await page.getByLabel('Gra', { exact: true }).selectOption('2');
  assert.equal(await page.getByLabel('Maciek, skończył przy trafieniu', { exact: true }).inputValue(), '');
  await page.getByLabel('Gra', { exact: true }).selectOption('1');
  await page.getByLabel('Maciek, bonus 1, Środek', { exact: true }).waitFor();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px overflow`);
    if (process.env.PROFILE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.PROFILE_SCREENSHOT_DIR, `notebook-${width}.png`), fullPage: true });
  }
  const before = puts;
  records.get(1).revision++;
  await page.getByRole('button', { name: 'Maciek, więcej oszustw', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Inny administrator' }).waitFor();
  assert.equal(await page.getByLabel('Maciek, rzut, Rzucił', { exact: true }).isDisabled(), true);
  assert.equal(puts, before + 1);
  assert.equal(records.get(1).document.rotations[0].entries[id(1)].cheats, 0);
  assert.equal(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).document.rotations[0].entries['00000000-0000-4000-8000-000000000001'].cheats, dirtyKey), 1);
  assert.deepEqual(errors, []);
});
