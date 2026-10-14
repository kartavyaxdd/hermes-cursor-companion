const {app,BrowserWindow}=require('electron');
app.whenReady().then(async()=>{
  const win=new BrowserWindow({x:80,y:80,width:900,height:550,show:false,alwaysOnTop:true,webPreferences:{sandbox:true}});
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<title>Unified conversation QA</title><style>body{font:22px Segoe UI;padding:32px;background:#f4f6fa}input{font:22px Segoe UI;width:650px;padding:14px;margin-top:25px}</style><h1>Unified conversation QA</h1><p>This is a disposable scratch window.</p><input id="scratch" aria-label="Scratch field" placeholder="Type Unified cursor test. here">'));
  win.setAlwaysOnTop(true,'screen-saver'); win.show();win.hide();win.show();win.focus();
  let passAt=0;
  const start=Date.now();
  const timer=setInterval(async()=>{
    if(win.isDestroyed()){clearInterval(timer);app.exit(passAt?0:1);return;}
    const value=await win.webContents.executeJavaScript('document.querySelector("#scratch").value');
    if(value==='Unified cursor test.'&&!passAt){passAt=Date.now();console.log('PASS actual panel → approved step → native typing: Unified cursor test.');}
    if((passAt&&Date.now()-passAt>20000)||Date.now()-start>600000){clearInterval(timer);win.destroy();app.exit(passAt?0:1);}
  },500);
});
