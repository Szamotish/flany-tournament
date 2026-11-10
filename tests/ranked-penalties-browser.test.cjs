const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ts = require('typescript');

test('admin penalty form previews exact deductions and retries the same request on desktop/mobile', {
  skip: !process.env.PROFILE_PLAYWRIGHT_PATH || !process.env.PROFILE_CHROME_PATH,
}, async t => {
  const {chromium}=require(process.env.PROFILE_PLAYWRIGHT_PATH);
  const modules={};
  for(const [name,pkg,file] of [
    ['react','react','react.production.js'],['react/jsx-runtime','react','react-jsx-runtime.production.js'],
    ['react-dom','react-dom','react-dom.production.js'],['react-dom/client','react-dom','react-dom-client.production.js'],['scheduler','scheduler','scheduler.production.js'],
  ]) modules[name]=fs.readFileSync(path.join(path.dirname(require.resolve(pkg)),'cjs',file),'utf8');
  for(const file of ['app/admin/tournaments/RankedPenaltyDialog.tsx','lib/ranked.ts','app/components/ProfileMmrChart.tsx','lib/profileHistory.ts']) {
    modules['@/'+file.replace(/\.tsx?$/,'')]=ts.transpileModule(fs.readFileSync(file,'utf8'),{
      compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},
    }).outputText;
  }
  modules['@/lib/authClient']='exports.authedFetch=(url,init)=>fetch(url,init);';
  modules['next/link']='exports.default=props=>require("react").createElement("a",props);';
  const bundle=`const process={env:{NODE_ENV:'production'}};const modules={${Object.entries(modules).map(([name,code])=>`${JSON.stringify(name)}:function(require,module,exports){\n${code}\n}`).join(',')}};
    const cache={};function require(name){if(cache[name])return cache[name].exports;const mod=cache[name]={exports:{}};modules[name](require,mod,mod.exports);return mod.exports;}
    const React=require('react'),h=React.createElement;
    function App(){const [open,setOpen]=React.useState(true);return h('div',{},open?h(require('@/app/admin/tournaments/RankedPenaltyDialog').default,{
      player:{id:'p',name:'Tomek',mmr:10,prestige_points:2},onClose:()=>setOpen(false),onSaved:()=>setOpen(false)}):h('p',{},'Kara zapisana'),
      h(require('@/app/components/ProfileMmrChart').default,{points:[
        {id:'old',mmr:10,prestigePoints:2,playedAt:'2026-11-01T12:00:00Z',tournamentName:'FL #0111261'},
        {id:'penalty',mmr:9.6,prestigePoints:0,playedAt:'2026-11-10T12:00:00Z',tournamentName:null,eventLabel:'Kara punktowa',changeLabel:'-0,4 MMR / -2 PP'}
      ]}));}
    require('react-dom/client').createRoot(document.getElementById('root')).render(h(App));`;
  const writes=[];
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/bundle.js'){res.setHeader('content-type','application/javascript');res.end(bundle);}
    else if(req.url==='/style.css'){
      res.setHeader('content-type','text/css');res.end(fs.readFileSync('app/globals.css','utf8').replace(/@import[^;]+;/g,'')+
        '*{box-sizing:border-box}body{font-family:Arial;margin:16px}label{display:block;margin:16px 0}input,textarea{display:block;width:100%}');
    }else if(req.url==='/api/admin/players/p/penalty'){
      let body='';for await(const part of req)body+=part;writes.push(JSON.parse(body));
      res.setHeader('content-type','application/json');res.statusCode=writes.length%2?503:200;
      res.end(JSON.stringify(res.statusCode===503?{penaltySaved:true}:{ok:true}));
    }else res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:process.env.PROFILE_CHROME_PATH,headless:true});
  t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const width of [1280,390,320]){
    await page.setViewportSize({width,height:850});await page.goto(`http://127.0.0.1:${server.address().port}`);
    const dialog=page.getByRole('dialog');await dialog.waitFor();
    await page.getByLabel('Punkty do odjęcia').fill('6');
    assert.match(await dialog.innerText(),/9,6 MMR · 0 PP/);
    await page.getByLabel('Uzasadnienie').fill('Krok przy rzucie');
    const box=await dialog.boundingBox();assert.ok(box.x>=0 && box.x+box.width<=width+1);
    await page.getByRole('button',{name:'Nałóż karę'}).click();
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(),/Kara zapisana/);
    assert.equal(await page.getByLabel('Punkty do odjęcia').isDisabled(),true);
    await page.getByRole('button',{name:'Ponów zapis'}).click();await dialog.waitFor({state:'detached'});
    assert.deepEqual(writes.at(-1),writes.at(-2));
    const plot=page.locator('.profile-chart-viewport');const p=await plot.boundingBox();
    await plot.click({position:{x:p.width-2,y:40}});
    assert.match(await page.locator('.profile-chart-detail').innerText(),/Kara punktowa.*-0,4 MMR \/ -2 PP/);
  }
  assert.deepEqual(errors,[]);
});
