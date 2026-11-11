const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function fixture({ main = false, authenticated = true, started = false, fullDuel = false } = {}) {
  const reads = [], writes = [], audits = [], notices = [];
  const auth = authenticated ? { ok:true, ctx:{ userId:'user',playerId:'admin',isMainAdmin:main } }
    : { ok:false,error:'unauthorized',status:401 };
  const server = { from(table) {
    reads.push(table);
    const query = {
      select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
      maybeSingle() { return this; }, single() { return this; },
      upsert(value) { writes.push({table,operation:'upsert',value}); return this; },
      update(value) { writes.push({table,operation:'update',value}); return this; },
      then(resolve,reject) {
        const data = table === 'players' ? {id:'target',active:true} : table === 'tournaments' ? {format:fullDuel?'one_vs_one':'single_elim',name:'FL #test'}
          : table === 'tournament_join_requests' ? {id:'request',player_id:'request-owner',status:'pending'}
          : table === 'tournament_admins' ? {player_id:'admin'} : null;
        return Promise.resolve({ data,error:null,count:table==='tournament_matches'?(started?1:0):fullDuel?2:0 }).then(resolve,reject);
      },
    };
    return query;
  } };
  const mocks = {
    'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
    '@/app/api/admin/_auth':{readAuthContext:async()=>auth},
    '@/app/api/admin/tournaments/_auth':{assertTournamentAdmin:async()=>auth},
    '@/lib/supabaseServer':{supabaseServer:server},
    '@/lib/auditLog':{writeAuditLog:async entry=>audits.push(entry)},
    '@/lib/tournamentFormat':{isOneVsOneFormat:format=>format==='one_vs_one',ONE_V_ONE_PLAYER_LIMIT:2},
    '@/lib/rateLimit':{clientIp:()=> 'local',rateLimit:()=>({ok:true})},
    '@/lib/emailNotifications':{notifyJoinRequestDecision:async entry=>notices.push(entry)},
  };
  function load(file) {
    const mod={exports:{}};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
    }).outputText,{module:mod,exports:mod.exports,require:name=>{assert.ok(name in mocks,name);return mocks[name];}});
    return mod.exports;
  }
  const params={params:Promise.resolve({id:'tournament'})};
  return {reads,writes,audits,notices,
    add:body=>load('app/api/admin/tournaments/[id]/players/route.ts').POST(new Request('https://local.test',{method:'POST',body:JSON.stringify(body)}),params),
    membership:()=>load('app/api/public/tournaments/[id]/membership/route.ts').GET(new Request('https://local.test'),params),
    accept:body=>load('app/api/admin/tournaments/[id]/requests/route.ts').PATCH(new Request('https://local.test',{method:'PATCH',body:JSON.stringify(body)}),params),
  };
}

test('local admin cannot directly add players or forge main-admin permission in the request',async()=>{
  for(const body of [{playerId:'target'},{playerId:'target',isMainAdmin:true,canDirectAddPlayers:true}]) {
    const f=fixture();const response=await f.add(body);
    assert.equal(response.status,403);
    assert.equal((await response.json()).error,'forbidden_main_admin_only');
    assert.deepEqual(f.reads,[]);assert.deepEqual(f.writes,[]);assert.deepEqual(f.audits,[]);
  }
  const guest=fixture({authenticated:false});assert.equal((await guest.add({playerId:'target'})).status,401);
  assert.deepEqual(guest.writes,[]);
});

test('main admin can directly add players while started-match and duel limits remain enforced',async()=>{
  const f=fixture({main:true});assert.equal((await f.add({playerId:'target'})).status,200);
  const write=f.writes.find(w=>w.table==='tournament_players' && w.operation==='upsert');
  assert.equal(write.value.player_id,'target');assert.equal(write.value.tournament_id,'tournament');
  assert.equal(f.audits[0].action,'tournament_player_add');
  for(const options of [{started:true},{fullDuel:true}]) {
    const limited=fixture({main:true,...options});assert.equal((await limited.add({playerId:'target'})).status,400);
    assert.deepEqual(limited.writes,[]);
  }
});

test('membership exposes direct-add capability only for main admin',async()=>{
  for(const main of [false,true]) {
    const result=await (await fixture({main}).membership()).json();
    assert.equal(result.isTournamentAdmin,true);
    assert.equal(result.canDirectAddPlayers,main);
  }
  const guest=await (await fixture({authenticated:false}).membership()).json();
  assert.equal(guest.canDirectAddPlayers,false);
});

test('local admin can still accept a player-initiated request, not an arbitrary substituted player',async()=>{
  const f=fixture();
  const response=await f.accept({requestId:'request',action:'accept',playerId:'forged-player'});
  assert.equal(response.status,200);
  const write=f.writes.find(w=>w.table==='tournament_players' && w.operation==='upsert');
  assert.equal(write.value.player_id,'request-owner');
  assert.equal(f.notices[0].playerId,'request-owner');
});
