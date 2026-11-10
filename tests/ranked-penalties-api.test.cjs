const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

function fixture() {
  const calls=[], audit=[];
  let authorized=true, limited=false, failReplay=0, recalculations=0, rpcError=null;
  const mocks={
    'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
    '@/app/api/admin/_auth':{assertMainAdmin:async()=>authorized?{ok:true,ctx:{userId:'u',playerId:id(1)}}:{ok:false,status:403,error:'forbidden_main_admin_only'}},
    '@/lib/supabaseServer':{supabaseServer:{rpc:async(name,params)=>{calls.push({name,params});return {error:rpcError?{message:rpcError}:null};}}},
    '@/lib/rankedRecalculate':{recalculateRankedMmrForPlayer:async player=>{assert.equal(player,id(2));recalculations++;if(recalculations===failReplay)throw new Error('ranked_commit_failed');}},
    '@/lib/rateLimit':{rateLimit:()=>({ok:!limited}),rateLimitResponse:()=>Response.json({error:'rate_limited'},{status:429})},
    '@/lib/auditLog':{writeAuditLog:async entry=>audit.push(entry)},
  };
  const mod={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/admin/players/[id]/penalty/route.ts','utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,{module:mod,exports:mod.exports,require:name=>mocks[name]});
  return {calls,audit,setAuthorized:v=>authorized=v,setLimited:v=>limited=v,failReplayAt:n=>failReplay=n,setRpcError:v=>rpcError=v,
    post:body=>mod.exports.POST(new Request('https://local.test',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({id:id(2)})})};
}
const payload={penaltyId:id(10),points:6,note:' Krok przy rzucie '};

test('penalty endpoint authorizes main admin and validates every input before writes',async()=>{
  const f=fixture();f.setAuthorized(false);
  assert.equal((await f.post(payload)).status,403);f.setAuthorized(true);f.setLimited(true);
  assert.equal((await f.post(payload)).status,429);f.setLimited(false);
  for(const body of [null,{...payload,points:-6},{...payload,points:1.5},{...payload,points:101},
    {...payload,points:'6'},{...payload,penaltyId:'oops'},{...payload,note:''},{...payload,note:'x'.repeat(501)}]) {
    assert.equal((await f.post(body)).status,400);
  }
  assert.equal(f.calls.length,0);
});

test('penalty endpoint freezes baseline, logs actor/reason and safely retries a saved but unapplied penalty',async()=>{
  const f=fixture();f.failReplayAt(2);
  const first=await f.post(payload);assert.equal(first.status,503);
  assert.equal((await first.json()).penaltySaved,true);
  const retry=await f.post(payload);assert.equal(retry.status,200);
  assert.equal(f.calls.length,2);assert.deepEqual(f.calls[0],f.calls[1]);
  assert.equal(f.calls[1].name,'grant_ranked_penalty');
  assert.equal(f.calls[1].params.penalty_points,6);
  assert.equal(f.calls[1].params.actor_player_id,id(1));
  assert.equal(f.calls[1].params.penalty_note,'Krok przy rzucie');
  assert.equal(f.audit.length,1);assert.equal(f.audit[0].action,'player_ranked_penalty');
});

test('penalty endpoint does not claim saved after failed baseline or conflicting request',async()=>{
  const f=fixture();f.failReplayAt(1);
  const result=await f.post(payload);assert.equal(result.status,503);
  assert.equal((await result.json()).penaltySaved,false);assert.equal(f.calls.length,0);
  f.setRpcError('penalty_id_conflict');
  assert.equal((await f.post(payload)).status,409);
  f.setRpcError('player_not_found');
  assert.equal((await f.post(payload)).status,404);
});
