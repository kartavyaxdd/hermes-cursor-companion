const { app, BrowserWindow, screen } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ScreenSampler } = require('../dist-electron/capture');
const { askCompanion } = require('../dist-electron/companion');
const { runActionSequence } = require('../dist-electron/actionFlow');
const { inspectDesktopTarget,runDesktopAction,closeDesktopHelper } = require('../dist-electron/desktop');
app.setPath('userData',path.join(app.getPath('temp'),'hermes-routing-qa'));
app.on('window-all-closed',()=>{});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let fixture;
app.whenReady().then(async()=>{
  const results=[];
  try {
    const display=screen.getPrimaryDisplay();
    fixture=new BrowserWindow({x:display.bounds.x+80,y:display.bounds.y+80,width:900,height:600,show:false,webPreferences:{sandbox:true}});
    await fixture.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<html><head><title>Hermes routing QA</title><style>body{font:24px Segoe UI;padding:30px;background:#f4f6fa}button{display:block;margin:30px;padding:20px;font-size:24px}</style></head><body><h1>Disposable routing test</h1><p>Guidance controls:</p><button id="alpha">Alpha control</button><button id="beta">Beta control</button><button id="first" onclick="this.disabled=true;document.querySelector('#second').hidden=false;document.body.dataset.first='1'">First step</button><button id="second" hidden onclick="this.disabled=true;document.body.dataset.second='1'">Second step</button><style>button[hidden]{display:none}</style></body></html>`));
    fixture.setAlwaysOnTop(true,'screen-saver');fixture.show();fixture.hide();fixture.show();fixture.focus();await wait(600);
    const sampler=new ScreenSampler();
    const session='cursor-routing-qa-'+require('crypto').randomUUID();
    async function ask(text,allow){ fixture.moveTop();sampler.clear();const shot=await sampler.capture(display.id);assert.ok(shot);return askCompanion(text,shot,session,new AbortController().signal,undefined,allow); }
    const guide=await ask('How do I use Alpha control and then Beta control? Show both steps.');
    assert.equal(guide.mode,'guide');assert.equal(guide.proposal,undefined);assert.ok(guide.points.length>=2);
    assert.deepEqual(guide.points.slice(0,2).map(p=>p.step),[1,2]);
    results.push({name:'Automatic numbered guidance',passed:true,points:guide.points.length});
    const task='Click First step, then click Second step.';
    const initial=await ask(task);
    assert.equal(initial.proposal?.automatic,true);
    let actions=0;
    const final=await runActionSequence(initial.proposal,async id=>{
      assert.equal(id,pending.id);
      const target=await inspectDesktopTarget(pending.action,display.id);
      const content=fixture.getNativeWindowHandle();
      const expected=content.length===8?content.readBigUInt64LE().toString():String(content.readUInt32LE());
      assert.equal(String(target.handle),expected,'proposal must target the owned fixture');
      await runDesktopAction(pending.action,display.id,target.handle);actions++;await wait(250);
      const reply=await ask(`Perform the remaining steps of this task: ${task}. ${actions} actions executed. Verify the screenshot and return action=null when both steps are done.`,true);
      pending=reply.proposal||{id:'done',action:null,done:true,explanation:reply.answer};return pending;
    },()=>true,proposal=>{pending=proposal});
    assert.equal(final.done,true);assert.equal(actions,2);
    const state=await fixture.webContents.executeJavaScript('({...document.body.dataset})');
    assert.equal(state.first,'1');assert.equal(state.second,'1');
    results.push({name:'Automatic sequential actions with fresh screen',passed:true,actions});
    fs.writeFileSync(path.join(__dirname,'../ROUTING-TEST-RESULT.json'),JSON.stringify({passed:true,results},null,2));
  }catch(error){fs.writeFileSync(path.join(__dirname,'../ROUTING-TEST-RESULT.json'),JSON.stringify({passed:false,results,error:error.stack},null,2));process.exitCode=1;}
  finally{fixture?.destroy();closeDesktopHelper();app.exit(process.exitCode||0);}
});
let pending;
