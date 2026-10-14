// Actual chat form -> main controller -> repeated native actions -> completion.
const {app,BrowserWindow,screen}=require('electron');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
app.setPath('userData',path.join(app.getPath('temp'),'hermes-full-auto-qa'));
app.setAppPath(path.resolve(__dirname,'..'));
require('../dist-electron/main');
const {runDesktopAction}=require('../dist-electron/desktop');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
  let fixture;
  try{
    let chat;
    for(let i=0;i<100;i++){
      await wait(100);
      chat=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=chat'));
      if(chat&&await chat.webContents.executeJavaScript('window.companion?.getStatus().then(s=>s.connection==="online")').catch(()=>false))break;
    }
    assert.ok(chat,'chat window available');
    const display=screen.getPrimaryDisplay();
    fixture=new BrowserWindow({x:display.bounds.x+80,y:display.bounds.y+80,width:900,height:550,show:false,webPreferences:{sandbox:true}});
    await fixture.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<html><head><title>Hermes full automatic QA</title><style>body{font:24px Segoe UI;padding:30px;background:#f4f6fa}button{display:block;margin:30px;padding:20px;font-size:24px}button[hidden]{display:none}</style></head><body><h1>Disposable automatic task</h1><button id="first" onclick="this.disabled=true;document.querySelector('#second').hidden=false;document.body.dataset.first='1'">First step</button><button id="second" hidden onclick="this.disabled=true;document.body.dataset.second='1'">Second step</button></body></html>`));
    fixture.setAlwaysOnTop(true,'screen-saver');fixture.show();fixture.hide();fixture.show();fixture.focus();await wait(300);
    const x=(display.bounds.x+180-display.bounds.x)/display.bounds.width,y=(display.bounds.y+130-display.bounds.y)/display.bounds.height;
    const handle=fixture.getNativeWindowHandle();
    const expected=handle.length===8?handle.readBigUInt64LE().toString():String(handle.readUInt32LE());
    await runDesktopAction({kind:'click',x,y},display.id,expected); // owned harmless heading establishes capture target
    chat.show();chat.focus();
    await chat.webContents.executeJavaScript(`new Promise(resolve=>{
      const input=document.querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Click First step, then click Second step.');
      input.dispatchEvent(new Event('input',{bubbles:true}));
      setTimeout(()=>{document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));resolve();},100);
    })`);
    let state;
    for(let i=0;i<600;i++){
      await wait(100);
      state=await fixture.webContents.executeJavaScript('({...document.body.dataset})');
      if(state.second==='1')break;
    }
    assert.equal(state.first,'1');assert.equal(state.second,'1');
    let done=false;
    for(let i=0;i<300;i++){
      await wait(100);done=await chat.webContents.executeJavaScript('Boolean(document.querySelector(".done-note"))');if(done)break;
    }
    assert.equal(done,true,'chat reached verified completion');
    fs.writeFileSync(path.join(__dirname,'../AUTO-APP-TEST-RESULT.json'),JSON.stringify({passed:true,firstClicked:true,secondClicked:true,chatDone:true},null,2));
  }catch(error){fs.writeFileSync(path.join(__dirname,'../AUTO-APP-TEST-RESULT.json'),JSON.stringify({passed:false,error:error.stack},null,2));process.exitCode=1;}
  finally{fixture?.destroy();app.quit();}
});
