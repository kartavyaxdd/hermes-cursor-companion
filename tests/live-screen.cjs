// Run with Electron. Captures only in memory; no image or credentials are logged.
const { app, screen } = require('electron');
const { ScreenSampler } = require('../dist-electron/capture');
const { checkHermes, askHermes } = require('../dist-electron/hermes');
app.whenReady().then(async () => {
  try {
    const sampler = new ScreenSampler();
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const screenshot = await sampler.capture(display.id);
    if (!screenshot?.dataUrl.startsWith('data:image/jpeg;base64,')) throw new Error('Live screen capture failed.');
    console.log(`Screen capture: ready on display ${display.id}`);
    const connection = await checkHermes();
    if (!connection.ok) throw new Error(connection.detail);
    const reply = await askHermes('Reply only with "Screen received" if you can see the screenshot. Do not describe private contents or suggest actions.', screenshot, `cursor-qa-${require('crypto').randomUUID()}`);
    if (!reply.answer) throw new Error('Vision reply is empty.');
    console.log('Hermes vision: returned a valid answer with ' + reply.points.length + ' validated points.');
    sampler.clear();
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  app.exit(process.exitCode || 0);
});
