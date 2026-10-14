const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canAutomaticallyAct, runActionSequence } = require('../dist-electron/actionFlow');
const { parseCompanionReply } = require('../dist-electron/companion');
test('task requests authorize automatic actions while questions and drawing do not', () => {
  for (const text of ['Fill this field and press Enter', 'Could you click Save?', 'Please open Settings']) assert.equal(canAutomaticallyAct(text), true);
  for (const text of ['How do I save?', 'Show me how to click Save', 'Draw arrows to these buttons', "Click Save without actually clicking", "Don't click anything", 'What does this button do?']) assert.equal(canAutomaticallyAct(text), false);
});
test('guidance preserves six ordered visible arrows and cannot contain actions', () => {
  const points = Array.from({length:7}, (_,i)=>({x:.1*i,y:.4,label:`Control ${i}`}));
  const guide = parseCompanionReply(JSON.stringify({answer:'Follow these steps',mode:'guide',points,action:null}),1);
  assert.deepEqual(guide.points.map(p=>p.step),[1,2,3,4,5,6]);
  assert.throws(()=>parseCompanionReply(JSON.stringify({answer:'Help',mode:'guide',action:{kind:'click',x:.5,y:.5}}),1));
});
test('automatic tasks execute refreshed steps in order and stop when complete', async () => {
  const first={id:'first',automatic:true,action:{kind:'click'},done:false}; const executed=[];
  const final=await runActionSequence(first,async id=>{executed.push(id);return id==='first'?{...first,id:'second'}:{id:'done',automatic:false,action:null,done:true}},()=>true,()=>{});
  assert.deepEqual(executed,['first','second']); assert.equal(final.done,true);
});
test('Stop prevents the next action and runaway tasks are bounded', async () => {
  const initial={id:'first',automatic:true,action:{kind:'click'},done:false}; let current=true,calls=0;
  await assert.rejects(runActionSequence(initial,async()=>{calls++;current=false;return initial},()=>current,()=>{}),/stopped/);
  assert.equal(calls,1);calls=0;
  await assert.rejects(runActionSequence(initial,async()=>{calls++;return initial},()=>true,()=>{}),/eight steps/);
  assert.equal(calls,8);
});
