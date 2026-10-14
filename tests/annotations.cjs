// Real hidden Electron renderer: listeners ready -> SVG and caption painted.
const { app, screen } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createAnnotationWindow } = require('../dist-electron/annotations');
const fs = require('node:fs');
const report = path.join(__dirname, '../ANNOTATION-TEST-RESULT.json');
app.setPath('userData', path.join(app.getPath('temp'), 'hermes-annotation-qa'));
app.on('window-all-closed', () => {});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const windows = [];
  try {
    const display = screen.getPrimaryDisplay();
    const url = pathToFileURL(path.join(__dirname, '../dist/index.html')).href + '?view=overlay';
    const preload = path.join(__dirname, '../dist-electron/preload.js');
    let shown = 0;
    const reply = { answer: 'Drawing test', mode:'guide', points: [{ x: .4, y: .4, label: 'First control', step:1 }, { x:.65, y:.65, label:'Second control', step:2 }], displayId: display.id };
    const win = createAnnotationWindow(display, url, preload, reply, screen.getCursorScreenPoint(), () => true, () => shown++, false);
    windows.push(win);
    for (let i = 0; i < 80; i++) {
      await wait(100);
      if (shown && await win.webContents.executeJavaScript('document.querySelectorAll(".point-label").length === 2')) break;
    }
    const painted = await win.webContents.executeJavaScript(`(() => {
      const arrow = document.querySelector('.draw-layer > path');
      const label = document.querySelector('.point-label');
      return { path: arrow?.getAttribute('d'), color: arrow && getComputedStyle(arrow).stroke,
        label: label?.textContent, badges:[...document.querySelectorAll('.step-badge')].map(el=>el.textContent), arrows:document.querySelectorAll('.draw-layer > path').length, caption: document.querySelector('.screen-caption')?.textContent };
    })()`);
    assert.equal(shown, 1); assert.ok(win.isVisible());
    assert.match(painted.path, /^M .* C /); assert.equal(painted.label, '1First control'); assert.equal(painted.arrows, 2); assert.deepEqual(painted.badges,['1','2']);
    assert.equal(painted.caption, 'Drawing test'); assert.notEqual(painted.color, 'none');
    // Duplicate readiness cannot resend/extend the drawing.
    await win.webContents.executeJavaScript('window.companion.overlayReady()'); await wait(100);
    assert.equal(shown, 1);
    win.destroy();
    const canceled = createAnnotationWindow(display, url, preload, reply, {x:0,y:0}, () => false, () => shown++, false);
    windows.push(canceled); await wait(1500);
    assert.equal(canceled.isVisible(), false); assert.equal(shown, 1);
    fs.writeFileSync(report, JSON.stringify({passed:true, painted, canceledHidden:true, duplicateReadyIgnored:true}, null, 2));
    console.log('PASS: real renderer painted arrow, label and caption; duplicate and canceled readiness handled.');
  } catch (error) { fs.writeFileSync(report, JSON.stringify({passed:false,error:error.stack}, null, 2)); console.error(error); process.exitCode = 1; }
  finally { for (const win of windows) if (!win.isDestroyed()) win.destroy(); app.exit(process.exitCode || 0); }
});
