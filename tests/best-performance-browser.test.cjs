const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ts = require('typescript');

test('Best Performance fits desktop/mobile, exposes marker details and includes all co-leaders', {
  skip: !process.env.PROFILE_PLAYWRIGHT_PATH || !process.env.PROFILE_CHROME_PATH,
}, async t => {
  const { chromium } = require(process.env.PROFILE_PLAYWRIGHT_PATH);
  const modules = {};
  for (const [name,pkg,file] of [
    ['react','react','react.production.js'],['react/jsx-runtime','react','react-jsx-runtime.production.js'],
    ['react-dom','react-dom','react-dom.production.js'],['react-dom/client','react-dom','react-dom-client.production.js'],['scheduler','scheduler','scheduler.production.js'],
  ]) modules[name] = fs.readFileSync(path.join(path.dirname(require.resolve(pkg)), 'cjs', file), 'utf8');
  for (const file of ['app/components/BestPerformance.tsx','lib/playerRank.ts']) {
    modules[`@/${file.replace(/\.tsx?$/, '')}`] = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..',file),'utf8'), {
      compilerOptions: {module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},
    }).outputText;
  }
  modules['next/image'] = `exports.default=props=>require('react').createElement('img',props);`;
  modules['next/link'] = `exports.default=props=>require('react').createElement('a',props);`;
  const bundle = `const process={env:{NODE_ENV:'production'}};const modules={${Object.entries(modules).map(([name,code])=>`${JSON.stringify(name)}:function(require,module,exports){\n${code}\n}`).join(',')}};
    const cache={};function require(name){if(cache[name])return cache[name].exports;const mod=cache[name]={exports:{}};modules[name](require,mod,mod.exports);return mod.exports;}
    const h=require('react').createElement,root=require('react-dom/client').createRoot(document.querySelector('#root'));
    window.showLeaders=count=>{
      const tournaments=Array.from({length:10},(_,i)=>({name:i===9?'Turniej prywatny':'FL #'+(i+1)+'10261',href:i===9?null:'/tournaments/'+i,playedAt:new Date(Date.UTC(2026,9,i+1)).toISOString(),format:i===9?null:'one_vs_one'}));
      const leaders=Array.from({length:count},(_,i)=>({playerId:'p'+i,name:['Tomek','ziełu','Gracz z bardzo długim pseudonimem','Kornio','Lef'][i],rank:'master',avatarUrl:null,wins:6,played:8,outcomes:['win','win','loss','absent','win','win','absent','loss','win','win']}));
      root.render(h(require('@/app/components/BestPerformance').default,{key:count,data:count<0?null:{tournaments:count===0?[]:tournaments,leaders}}));
    };window.showLeaders(1);`;
  const allowed = new Set(['/Green checkmark.png','/Red X.png','/Beige dash.png','/ramki/master.png','/title.png']);
  const server=http.createServer((req,res)=>{
    const url=decodeURIComponent(req.url);
    if(url==='/bundle.js'){res.setHeader('content-type','application/javascript');res.end(bundle);}
    else if(url==='/styles.css'){res.setHeader('content-type','text/css');res.end(fs.readFileSync(path.join(__dirname,'../app/globals.css'),'utf8').replace(/@import[^;]+;/g,'')+'\n*{box-sizing:border-box}body{margin:0;font-family:Arial}h1,h2,p{margin:0}#root{display:contents}');}
    else if(allowed.has(url)){res.setHeader('content-type','image/png');res.end(fs.readFileSync(path.join(__dirname,'../public',url.slice(1))));}
    else if(url==='/')res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css">
      <main class="landing-root"><div class="landing-shell"><section class="landing-grid">
      <article class="glass-card landing-main"><h1 class="landing-title"><img src="/title.png" class="landing-title-image" alt="Flanki League"></h1><div class="landing-link-list"><a class="landing-link-card"><span class="landing-link-title">Turnieje</span></a><a class="landing-link-card"><span class="landing-link-title">Zawodnicy</span></a><a class="landing-link-card"><span class="landing-link-title">Ranking</span></a></div></article>
      <article class="glass-card landing-beer">Piwo dnia</article><article class="glass-card landing-compass">Kompas Alkoholowy</article>
      <article class="glass-card landing-stats"><div class="card-head"><h2>Statystyki ligi</h2></div><div class="stats-grid"><div><p class="metric-value">29</p><p class="metric-label">Rozegrane turnieje</p></div><div><p class="metric-value">141</p><p class="metric-label">Wypite piwa</p></div><div><p class="metric-value">24</p><p class="metric-label">Aktywni zawodnicy</p></div></div></article>
      <div id="root"></div><article class="glass-card landing-weather">Pogoda Sarbsk</article></section></div></main><script src="/bundle.js"></script>`);
    else {res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:process.env.PROFILE_CHROME_PATH,headless:true});
  t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
  const page=await browser.newPage({viewport:{width:1440,height:1000},hasTouch:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('.best-performance-player').waitFor();
  assert.equal(await page.locator('.best-performance-markers button').count(),10);
  assert.equal(await page.locator('.best-performance-identity').getAttribute('href'),'/players/p0');
  const panel=await page.locator('.landing-performance').boundingBox(), stats=await page.locator('.landing-stats').boundingBox();
  assert.ok(panel.x>stats.x+stats.width && Math.abs(panel.y-stats.y)<2,'panel must be next to league stats');
  for (const count of [1,2,3,5]) {
    await page.evaluate(count=>window.showLeaders(count),count);
    await page.waitForFunction(count=>document.querySelectorAll('.best-performance-player').length===Math.min(count,3),count);
    for (const width of [1440,1000,768,390,320]) {
      await page.setViewportSize({width,height:1000});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow');
      assert.ok(await page.locator('.best-performance-player').evaluateAll(cards=>cards.every(card=>card.scrollWidth<=card.clientWidth+1)),'long names must not overflow');
      if(process.env.PROFILE_SCREENSHOT_DIR && [1440,390].includes(width) && [1,3].includes(count)) {
        await page.locator('.landing-performance').scrollIntoViewIfNeeded();
        await page.locator('.landing-performance').screenshot({path:path.join(process.env.PROFILE_SCREENSHOT_DIR,`best-performance-panel-${count}-${width}.png`)});
      }
    }
    if(count===5){
      await page.getByRole('button',{name:'Pozostali współliderzy (2)'}).click();
      assert.equal(await page.locator('.best-performance-player').count(),5);
      await page.getByRole('button',{name:'Pokaż mniej'}).click();
      assert.equal(await page.locator('.best-performance-player').count(),3);
    }
  }
  await page.evaluate(()=>window.showLeaders(1));
  await page.waitForFunction(()=>document.querySelectorAll('.best-performance-player').length===1);
  await page.locator('.best-performance-markers button').first().tap();
  assert.match(await page.getByRole('status').innerText(),/Wygrana.*1\.10\.2026/);
  assert.equal(await page.getByRole('status').getByRole('link').getAttribute('href'),'/tournaments/0');
  await page.locator('.best-performance-markers button').nth(2).tap();
  assert.match(await page.getByRole('status').innerText(),/Udział bez zwycięstwa/);
  await page.locator('.best-performance-markers button').nth(3).focus();await page.keyboard.press('Enter');
  assert.match(await page.getByRole('status').innerText(),/Brak udziału/);
  await page.locator('.best-performance-markers button').last().tap();
  assert.match(await page.getByRole('status').innerText(),/Turniej prywatny/);
  assert.equal(await page.getByRole('status').getByRole('link').count(),0);
  await page.evaluate(()=>window.showLeaders(0));
  await page.getByText('Wyróżnienie pojawi się po zakończeniu turnieju rankingowego.').waitFor();
  await page.evaluate(()=>window.showLeaders(-1));
  await page.getByText('Nie udało się wczytać wyników.').waitFor();
  assert.deepEqual(errors,[]);
});
