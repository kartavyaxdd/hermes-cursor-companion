// Disposable fixture: actual screen → Hermes → validated proposal → native input.
const { app, BrowserWindow, screen } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ScreenSampler } = require('../dist-electron/capture');
const { askCompanion } = require('../dist-electron/companion');
const { checkHermes, speakText, transcribeAudio, closeDashboard } = require('../dist-electron/hermes');
const { inspectDesktopTarget, runDesktopAction, startDesktopHelper, closeDesktopHelper, requestDesktopSpeech } = require('../dist-electron/desktop');
const { warmLocalStt, closeLocalStt } = require('../dist-electron/localStt');
const results = [];
let fixture;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function check(name, operation) {
  const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  const start = Date.now();
  try { const detail = await operation(); results.push({name,passed:true,ms:Date.now()-start,detail}); console.log('PASS ' + name + ': ' + detail); }
  catch(error) { results.push({name,passed:false,ms:Date.now()-start,detail:error.message}); console.error('FAIL ' + name + ': ' + error.message); }
}
app.whenReady().then(async () => {
  try {
    const display = screen.getPrimaryDisplay();
    fixture = new BrowserWindow({x:display.bounds.x+80,y:display.bounds.y+80,width:900,height:550,show:false,alwaysOnTop:true,webPreferences:{sandbox:true}});
    await fixture.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<html><head><title>Hermes disposable feature QA</title><style>body{font:22px Segoe UI;padding:32px;background:#f4f6fa;color:#172032}input,button{font:20px Segoe UI;margin:16px 0;padding:12px;display:block}input{width:650px}button{background:#167252;color:white;border:0;border-radius:8px}</style></head><body><h1>Hermes disposable feature QA</h1><p id="sentence">The purple robot found 37 marbles.</p><input id="editor" aria-label="Scratch text field" placeholder="Empty scratch text field"><button id="button" onclick="document.querySelector(\'#count\').textContent=String(Number(document.querySelector(\'#count\').textContent)+1)">Harmless click</button><p>Clicks: <span id="count">0</span></p><script>document.querySelector("#editor").onkeydown=e=>document.body.dataset.key=e.key;</script></body></html>'));
    fixture.setAlwaysOnTop(true, 'screen-saver');
    fixture.show(); fixture.hide(); fixture.show(); fixture.focus(); await wait(1000);
    if (process.argv.includes('--fixture-only')) { await wait(90000); return; }
    const sampler = new ScreenSampler();
    const session = 'cursor-feature-qa-' + require('crypto').randomUUID();
    let screenshot;
    await check('Capture + empty executable toolsets', async () => {
      assert.equal((await checkHermes()).ok,true); screenshot=await sampler.capture(display.id); assert.ok(screenshot); return 'monitor JPEG captured in memory; API toolsets empty';
    });
    async function ask(input) {
      assert.ok(fixture.isVisible() && !fixture.isMinimized(), 'Disposable QA window was hidden or minimized during the test');
      fixture.moveTop();
      screenshot = await sampler.capture(display.id);
      let first = 0; const start=Date.now();
      const reply = await askCompanion(input,screenshot,session,new AbortController().signal,()=>{first ||= Date.now()-start});
      return {reply,first,total:Date.now()-start};
    }
    await check('Screen text understanding + streaming', async () => {
      const {reply,first,total}=await ask('Read the sentence about the purple robot exactly. Do not perform an action.');
      assert.match(reply.answer,/purple robot.*37 marbles/i); assert.equal(reply.proposal,undefined); assert.ok(first>0); return `correct text; first text ${first}ms, complete ${total}ms`;
    });
    await check('Point placement', async () => {
      const {reply}=await ask('Point to the Harmless click button. Do not click it.');
      assert.equal(reply.proposal,undefined); assert.ok(reply.points.length);
      const rect=await fixture.webContents.executeJavaScript('(()=>{const r=document.querySelector("#button").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()');
      const bounds=fixture.getContentBounds();
      assert.ok(reply.points.some(p=>{const x=p.x*display.bounds.width+display.bounds.x,y=p.y*display.bounds.height+display.bounds.y;return x>=bounds.x+rect.x-12&&x<=bounds.x+rect.x+rect.width+12&&y>=bounds.y+rect.y-12&&y<=bounds.y+rect.y+rect.height+12}),'point missed the actual button');
      return 'normalized point lands inside the real button';
    });
    await check('Conversation memory', async () => {
      await ask('For this test, remember my project name: Mango. Just acknowledge.');
      const {reply}=await ask('What did I name my test project?'); assert.match(reply.answer,/Mango/i); return 'same conversation recalled Mango';
    });
    for (const [name,prompt,verify] of [
      ['Unified click action','Click the Harmless click button once.',async()=>assert.equal(await fixture.webContents.executeJavaScript('document.querySelector("#count").textContent'),'1')],
      ['Unified typing action','Type exactly Hello from my cursor companion. into the empty scratch text field.',async()=>assert.equal(await fixture.webContents.executeJavaScript('document.querySelector("#editor").value'),'Hello from my cursor companion.')],
      ['Unified key action','Press Enter once in the scratch text field.',async()=>assert.equal(await fixture.webContents.executeJavaScript('document.body.dataset.key'),'Enter')],
    ]) {
      await check(name, async()=>{
        fixture.show(); fixture.focus();
        const {reply}=await ask(prompt); assert.ok(reply.proposal?.action,'no action proposed: '+reply.answer);
        const action=reply.proposal.action;
        const target=await inspectDesktopTarget(action,display.id);
        assert.equal(target.handle,String(fixture.getNativeWindowHandle().readBigInt64LE()),'action target is outside disposable QA window');
        if (name.includes('click')) {
          const content=fixture.getContentBounds();
          const x=action.x*display.bounds.width+display.bounds.x-content.x;
          const y=action.y*display.bounds.height+display.bounds.y-content.y;
          const at=await fixture.webContents.executeJavaScript(`document.elementFromPoint(${x},${y})?.id || 'none'`);
          console.log('Click proposal fixture hit: '+JSON.stringify({action,element:at}));
          assert.equal(at,'button','model point missed the clickable button');
        }
        await runDesktopAction(action,display.id,target.handle); await wait(120); await verify(); return `model proposed ${action.kind}; native input verified in disposable fixture`;
      });
    }
    await check('Native speech + warm local transcription',async()=>{
      await warmLocalStt();
      const start=Date.now(); const audio=await speakText('Hello Hermes. This is a speech test.'); const speechMs=Date.now()-start;
      assert.ok(audio.startsWith('data:audio/wav;base64,'));
      const sttStart=Date.now(); const transcript=await transcribeAudio(audio); assert.match(transcript,/Hello Hermes.*speech test/i); return `speech ${speechMs}ms; transcription ${Date.now()-sttStart}ms; correct phrase`;
    });
    await check('Warm desktop inspection',async()=>{
      const bounds=fixture.getBounds();
      const point={kind:'click',x:(bounds.x+100)/display.bounds.width,y:(bounds.y+100)/display.bounds.height};
      const start=Date.now(); for(let i=0;i<5;i++)await inspectDesktopTarget(point,display.id); return `${Math.round((Date.now()-start)/5)}ms average across five checks`;
    });
  } finally {
    fixture?.destroy(); closeDashboard(); closeDesktopHelper(); closeLocalStt();
    const reportPath=path.join(__dirname,'../FEATURE-TEST-RESULTS.json');
    let report=results;
    if(process.argv.some(arg=>arg.startsWith('--only='))) {
      const old=JSON.parse(fs.readFileSync(reportPath,'utf8'));
      report=old.map(item=>results.find(r=>r.name===item.name)||item);
    }
    if(!process.argv.includes('--fixture-only')) fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
    app.exit(results.some(r=>!r.passed)?1:0);
  }
});
