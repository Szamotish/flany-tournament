const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ts = require('typescript');

test('main admin defaults, self-admin choice, edit preservation and bounded tournament list', {
  skip: !process.env.PROFILE_PLAYWRIGHT_PATH || !process.env.PROFILE_CHROME_PATH,
}, async t => {
  const {chromium}=require(process.env.PROFILE_PLAYWRIGHT_PATH);
  const modules={};
  for(const [name,pkg,file] of [
    ['react','react','react.production.js'],['react/jsx-runtime','react','react-jsx-runtime.production.js'],
    ['react-dom','react-dom','react-dom.production.js'],['react-dom/client','react-dom','react-dom-client.production.js'],['scheduler','scheduler','scheduler.production.js'],
  ]) modules[name]=fs.readFileSync(path.join(path.dirname(require.resolve(pkg)),'cjs',file),'utf8');
  for(const file of ['app/admin/tournaments/page.tsx','lib/tournamentDate.ts']) {
    modules['@/'+file.replace(/\.tsx?$/,'')]=ts.transpileModule(fs.readFileSync(file,'utf8'),{
      compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},
    }).outputText;
  }
  modules['@/lib/authClient']='exports.authedFetch=(url,init)=>fetch(url,init);';
  modules['next/link']='exports.default=props=>require("react").createElement("a",props);';
  modules['@/lib/beers']='exports.BEER_LIST=[{name:"Tatra"}];';
  modules['@/lib/tournamentFormat']='exports.ONE_V_ONE_PLAYER_LIMIT=2;';
  modules['./PerformanceBonusDialog']=modules['./RankedPenaltyDialog']='exports.default=()=>null;';
  const bundle=`const process={env:{NODE_ENV:'production'}};const modules={${Object.entries(modules).map(([name,code])=>`${JSON.stringify(name)}:function(require,module,exports){\n${code}\n}`).join(',')}};
    const cache={};function require(name){if(cache[name])return cache[name].exports;const mod=cache[name]={exports:{}};modules[name](require,mod,mod.exports);return mod.exports;}
    require('react-dom/client').createRoot(document.getElementById('root')).render(require('react').createElement(require('@/app/admin/tournaments/page').default));`;
  const players=[{id:'self',name:'Tomek',active:true,has_account:true},{id:'other',name:'Maciek',active:true,has_account:true}];
  const tournaments=Array.from({length:60},(_,i)=>({id:'t'+i,name:'FL #test'+i,format:'double_elim',mode:'normal',bo_default:3,bo_finals:5,gf_reset_enabled:true}));
  const writes=[];
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/bundle.js'){res.setHeader('content-type','application/javascript');res.end(bundle);return;}
    if(url.pathname==='/style.css'){
      res.setHeader('content-type','text/css');res.end(fs.readFileSync('app/globals.css','utf8').replace(/@import[^;]+;/g,'')+
        '*{box-sizing:border-box}body{font-family:Arial;margin:0}.mt-4{margin-top:1rem}.mt-3{margin-top:.75rem}');return;
    }
    if(url.pathname==='/'){res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script>');return;}
    res.setHeader('content-type','application/json');
    if(url.pathname==='/api/auth/me')res.end(JSON.stringify({authenticated:true,isMainAdmin:true,player:players[0]}));
    else if(url.pathname==='/api/public/players/search')res.end(JSON.stringify({players:players.filter(p=>p.name.toLowerCase().includes((url.searchParams.get('q')||'').toLowerCase()))}));
    else if(url.pathname==='/api/public/tournaments')res.end(JSON.stringify({tournaments}));
    else if(url.pathname==='/api/public/background')res.end(JSON.stringify({background:'finn_bmo'}));
    else if(url.pathname==='/api/public/beer-of-day')res.end(JSON.stringify({beerOfDay:null}));
    else if(url.pathname==='/api/admin/tournaments/create'){
      let body='';for await(const part of req)body+=part;writes.push(JSON.parse(body));res.end(JSON.stringify({name:'FL #new'}));
    }else if(url.pathname==='/api/admin/tournaments/t0')res.end(JSON.stringify({tournament:tournaments[0],started:false,playerIds:['self','other'],localAdminPlayerIds:['other']}));
    else {res.statusCode=404;res.end('{}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:process.env.PROFILE_CHROME_PATH,headless:true});
  t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByLabel('Format',{exact:true}).waitFor();
  const defaults=async()=>{
    for(const [label,value] of [['Format','single_elim'],['Tryb','ranked'],['BO domyslne','1'],['BO finalu','1'],['Grand final reset','no_reset']])
      assert.equal(await page.getByLabel(label,{exact:true}).inputValue(),value);
  };
  await defaults();
  const participant=name=>page.locator('.tour-admin-player-row').filter({hasText:name}).getByRole('checkbox');
  await participant('Tomek').check();await participant('Maciek').check();
  assert.equal(await page.getByLabel('Tomek',{exact:true}).isChecked(),true);
  assert.equal(await page.getByLabel('Maciek',{exact:true}).isChecked(),false);
  await page.getByPlaceholder('np. mac').fill('Maciek');await page.getByRole('button',{name:'Szukaj',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.tour-admin-player-row').length===1);
  assert.equal(await page.getByLabel('Tomek',{exact:true}).isChecked(),true,'search must not remove the selected admin');
  await page.getByLabel('Tomek',{exact:true}).uncheck();await page.getByLabel('Maciek',{exact:true}).check();
  await page.getByRole('button',{name:'Utworz turniej',exact:true}).click();
  await page.waitForFunction(()=>document.body.textContent.includes('Utworzono turniej FL #new'));
  assert.deepEqual(writes[0].localAdminPlayerIds,['other']);
  assert.equal(writes[0].format,'single_elim');assert.equal(writes[0].mode,'ranked');
  assert.equal(writes[0].boDefault,1);assert.equal(writes[0].boFinals,1);assert.equal(writes[0].gfResetEnabled,false);
  await defaults();
  await page.getByPlaceholder('np. mac').fill('');await page.getByRole('button',{name:'Szukaj',exact:true}).click();
  await participant('Tomek').check();assert.equal(await page.getByLabel('Tomek',{exact:true}).isChecked(),true,'new form restores self-admin default');
  const list=page.getByRole('region',{name:'Lista turniejów'});
  await list.locator('article').first().click();
  await page.waitForFunction(()=>document.querySelector('#tournament-format').value==='double_elim');
  assert.equal(await page.getByLabel('BO finalu',{exact:true}).inputValue(),'5');
  assert.equal(await page.getByLabel('Tomek',{exact:true}).isChecked(),false,'editing preserves saved admins');
  assert.equal(await page.getByLabel('Maciek',{exact:true}).isChecked(),true);
  await page.getByRole('button',{name:'Nowy turniej',exact:true}).click();await defaults();
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    assert.ok(await list.evaluate(el=>el.scrollHeight>el.clientHeight && el.clientHeight<=700));
    await list.evaluate(el=>{el.scrollTop=el.scrollHeight;});
    assert.ok(await list.evaluate(el=>el.scrollTop>0));
    const split=await page.locator('.tour-admin-split').boundingBox();
    const settings=await page.locator('section').filter({has:page.getByText('Ustawienia glowne',{exact:true})}).boundingBox();
    assert.ok(settings.y>=split.y+split.height,'settings follow both tournament panels');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no horizontal page overflow');
  }
  assert.deepEqual(errors,[]);
});
