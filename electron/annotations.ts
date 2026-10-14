import { BrowserWindow, type Display } from 'electron';
import type { Reply } from './types';

/** Deliver annotations only after React has installed its IPC listeners. */
export function createAnnotationWindow(display: Display, url: string, preload: string, reply: Reply,
  cursor: { x: number; y: number }, isCurrent: () => boolean, onShown: () => void,
  protect = true): BrowserWindow {
  const win = new BrowserWindow({
    ...display.bounds, transparent: true, frame: false, resizable: false, focusable: false, show: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, backgroundColor: '#00000000',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.setIgnoreMouseEvents(true);
  win.setContentProtection(protect);
  win.setAlwaysOnTop(true, 'screen-saver');
  let delivered = false;
  win.webContents.on('ipc-message', (_event, channel) => {
    if (channel !== 'overlay:ready' || delivered || win.isDestroyed() || !isCurrent()) return;
    delivered = true;
    win.webContents.send('cursor:update', { x: cursor.x - display.bounds.x, y: cursor.y - display.bounds.y,
      visible: true, recording: false, busy: false });
    win.webContents.send('markers:update', reply.points);
    if (reply.answer) win.webContents.send('bubble:show', reply.answer.slice(0, 180));
    win.showInactive();
    onShown();
  });
  void win.loadURL(url);
  return win;
}
