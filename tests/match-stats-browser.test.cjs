const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ts = require('typescript');

test('statistics panels fit the beer tile, switch by controls/touch, autoplay and expose match details', {
  skip: !process.env.PROFILE_PLAYWRIGHT_PATH || !process.env.PROFILE_CHROME_PATH,
}, async t => {
  const { chromium } = require(process.env.PROFILE_PLAYWRIGHT_PATH);
  const modules = {};
  for (const [name, pkg, file] of [
    ['react','react','react.production.js'], ['react/jsx-runtime','react','react-jsx-runtime.production.js'],
    ['react-dom','react-dom','react-dom.production.js'], ['react-dom/client','react-dom','react-dom-client.production.js'], ['scheduler','scheduler','scheduler.production.js'],
  ]) modules[name] = fs.readFileSync(path.join(path.dirname(require.resolve(pkg)), 'cjs', file), 'utf8');
  const folder = 'app/components/stats';
  const css = fs.readFileSync(path.join(__dirname, '..', folder, 'Stats.module.css'), 'utf8');
  const styles = Object.fromEntries([...css.matchAll(/\.([a-zA-Z]+)/g)].map(m => [m[1], 'stats-' + m[1]]));
  for (const file of [...['StatsCarousel','StatsValues','StatsAwards','HomeStatsCarousel','PlayerMatchStats','TournamentMatchStats'].map(n => `${folder}/${n}.tsx`),
    'app/components/BestPerformance.tsx', 'lib/matchStats.ts', 'lib/notebook.ts', 'lib/beers.ts', 'lib/playerRank.ts']) {
    const name = '@/' + file.replace(/\.tsx?$/, '');
    modules[name] = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText.replace(/require\("(\.[^"]+)"\)/g, (_, rel) => `require(${JSON.stringify(path.posix.join(path.posix.dirname(name), rel))})`);
  }
  modules[`@/${folder}/Stats.module.css`] = `exports.default=${JSON.stringify(styles)};`;
  modules['next/link'] = 'exports.default=props=>require("react").createElement("a",props);';
  modules['next/image'] = 'exports.default=props=>require("react").createElement("img",props);';
  modules['@/lib/authClient'] = 'exports.authedFetch=(url,init)=>fetch(url,init);';
  const summary = { matches: 2, expectedMatches: 10, games: 3, expectedGames: 20, throws: 12, hits: 7, opponentHits: 2, penaltyHits: 1, cheats: 3, accuracy: 7/12*100, finishAverage: 2.5, finishes: 2, beers: [{ name: 'Tatra', count: 3 }] };
  const leader = { playerId: 'p1', name: 'Maciek', avatarUrl: null, rank: 'master', summary };
  const awards = [{ category: 'accuracy', value: summary.accuracy, leaders: [leader] }, { category: 'drinking', value: 2.5, leaders: [leader] }];
  const data = { views: { last: { ...summary, matches: 1, expectedMatches: 1, throws: 4 }, recent: summary, all: { ...summary, throws: 20 } }, last: { name: 'FL #1010261', href: '/tournaments/public' } };
  const tournament = { awards, matches: [{ id: 'm1', label: 'R1 · Mecz 1', expectedGames: 3, players: [{ playerId: 'p1', name: 'Maciek', summary,
    games: [{ game: 1, throws: 4, hits: 2, opponentHits: 1, penaltyHits: 1, cheats: 1, finish: 2, beer: 'Tatra' }] }] }] };
  const performance = { leaders: [], tournaments: [] };
  const bundle = `const process={env:{NODE_ENV:'production'}};const modules={${Object.entries(modules).map(([name, code]) => `${JSON.stringify(name)}:function(require,module,exports){\n${code}\n}`).join(',')}};
    const cache={};function require(name){if(cache[name])return cache[name].exports;const mod=cache[name]={exports:{}};modules[name](require,mod,mod.exports);return mod.exports;}
    const h=require('react').createElement;
    require('react-dom/client').createRoot(document.querySelector('#root')).render(h('div',{},
      h('div',{className:'home-fixture'},h(require('@/${folder}/HomeStatsCarousel').default,{performance:${JSON.stringify(performance)},stats:${JSON.stringify({ count: 10, awards })}})),
      h('div',{className:'player-grid'},h('article',{className:'profile-card profile-hero'},'Profil'),h('article',{className:'profile-card profile-trophies'},'Puchary'),
        h('article',{className:'profile-card profile-history'},'Historia'),h('article',{className:'profile-card profile-rate'},'Oceny'),
        h(require('@/${folder}/PlayerMatchStats').default,{data:${JSON.stringify(data)},initial:'all',totalBeers:29})),
      h(require('@/${folder}/TournamentMatchStats').default,{tournamentId:'t1'})));`;
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url);
    if (url === '/bundle.js') { res.setHeader('content-type','application/javascript'); res.end(bundle); }
    else if (url === '/styles.css') { res.setHeader('content-type','text/css'); res.end(fs.readFileSync(path.join(__dirname,'../app/globals.css'),'utf8').replace(/@import[^;]+;/g,'') + '\n' + css.replace(/\.([a-zA-Z]+)/g, (all,key) => styles[key] ? '.'+styles[key] : all)
      + '\n*{box-sizing:border-box}body{margin:0;padding:16px;font-family:Arial;background:#bce4df}h2,p,dl,dd{margin:0}button{font:inherit;color:inherit}#root{max-width:1250px;margin:auto}.home-fixture{max-width:740px;margin-bottom:24px}.player-grid{margin-top:24px}.stats-dots button{background:none;border:0}'); }
    else if (url.startsWith('/api/')) { res.setHeader('content-type','application/json'); res.end(JSON.stringify(tournament)); }
    else if (url === '/ramki/master.png') { res.setHeader('content-type','image/png'); res.end(fs.readFileSync(path.join(__dirname,'../public/ramki/master.png'))); }
    else if (url === '/') res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script src="/bundle.js"></script>');
    else { res.statusCode=404; res.end(); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser = await chromium.launch({ executablePath: process.env.PROFILE_CHROME_PATH, headless:true }); t.after(()=>browser.close());
  const context = await browser.newContext({viewport:{width:1440,height:1000},hasTouch:true});
  const page = await context.newPage(); const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.clock.install();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const home = page.getByRole('region',{name:'Wyróżnienia ligi'}), profile = page.getByRole('region',{name:'Statystyki gry'});
  await profile.getByText('Wszystkie mecze',{exact:false}).first().waitFor();
  assert.match(await profile.innerText(), /Wypite piwa · łącznie/);
  await page.clock.runFor(8100);
  await home.getByRole('heading',{name:'Najcelniejsi'}).waitFor();
  await home.getByRole('button',{name:'Wstrzymaj zmianę paneli'}).click();
  await page.clock.runFor(9000);
  assert.equal(await home.getByRole('heading',{name:'Najcelniejsi'}).isVisible(),true);
  await profile.getByRole('button',{name:'Następny panel'}).click();
  await profile.getByRole('link',{name:'FL #1010261'}).waitFor();
  await profile.getByRole('button',{name:'Pokaż: Ostatnie 10 meczów'}).click();
  assert.match(await profile.innerText(), /Rzuty \/ mecz/);
  await page.getByText('R1 · Mecz 1 · Statystyki graczy',{exact:true}).click();
  await page.getByText('Poszczególne gry i piwa',{exact:true}).click();
  assert.equal(await page.getByRole('cell',{name:'Tatra',exact:true}).count(),1);
  for (const width of [1440,390,320]) {
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true,`${width}px overflow`);
    const position = await profile.evaluate(e=>getComputedStyle(e).gridArea);
    if(width===1440) assert.equal(position,'beers');
    if(process.env.PROFILE_SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.PROFILE_SCREENSHOT_DIR,`match-stats-${width}.png`),fullPage:true});
  }
  await profile.scrollIntoViewIfNeeded();
  await profile.evaluate(e => {
    e.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[new Touch({identifier:1,target:e,clientX:250,clientY:200})]}));
    e.dispatchEvent(new TouchEvent('touchend',{bubbles:true,changedTouches:[new Touch({identifier:1,target:e,clientX:80,clientY:205})]}));
  });
  await profile.getByRole('button',{name:'Pokaż: Wszystkie mecze'}).evaluate(e=>{if(e.getAttribute('aria-current')!=='true') throw new Error('swipe failed');});
  assert.deepEqual(errors,[]);
});
