import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, screen, Tray, type Display } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ScreenSampler, type Foreground } from './capture';
import { CursorDot } from './cursorDot';
import { checkHermes, closeDashboard, configureHermes, speakText, transcribeAudio } from './hermes';
import { askCompanion } from './companion';
import { createAnnotationWindow } from './annotations';
import { MAX_TASK_STEPS } from './actionFlow';
import { closeLocalStt, warmLocalStt } from './localStt';
import { closeDesktopHelper, startDesktopHelper, inspectDesktopTarget, runDesktopAction, type DesktopTarget } from './desktop';
import { requireApprovedStep, requireSameTarget } from './agentGuard';
import { loadSettings, saveSettings } from './settings';
import type { AgentProposal, AppStatus, Reply, Settings } from './types';

if (!app.requestSingleInstanceLock()) app.quit();

let settings: Settings;
let chatWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const overlays = new Map<number, BrowserWindow>();
const cursorDot = new CursorDot(error => console.error('Cursor dot:', error.message));
let markerGeneration = 0;
const sampler = new ScreenSampler();
let status: AppStatus;
let foreground: Foreground = { process: '', title: '' };
let locked = false;
let recording = false;
let busy = false;
let inferenceController: AbortController | null = null;
let markerTimer: NodeJS.Timeout | null = null;
let statusTimer: NodeJS.Timeout | null = null;
let chatSession = '';
let proactiveSession = '';
let agentSession = '';
let agentTask = '';
let agentHistory: string[] = [];
let pendingProposal: AgentProposal | null = null;
let pendingTarget: DesktopTarget | null = null;
let proposedAt = 0;
let requestEpoch = 0;

function progress(stage: string, text?: string): void { chatWindow?.webContents.send('chat:progress', { stage, text }); }

function loadSessionIds(): void {
  const file = path.join(app.getPath('userData'), 'sessions.json');
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { chat?: string; proactive?: string };
    if (typeof saved.chat === 'string' && /^cursor-chat-[a-f0-9-]{36}$/.test(saved.chat)) chatSession = saved.chat;
    if (typeof saved.proactive === 'string' && /^cursor-watch-[a-f0-9-]{36}$/.test(saved.proactive)) proactiveSession = saved.proactive;
  } catch { /* Create stable sessions on first launch. */ }
  chatSession ||= `cursor-chat-${crypto.randomUUID()}`;
  proactiveSession ||= `cursor-watch-${crypto.randomUUID()}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ chat: chatSession, proactive: proactiveSession }), 'utf8');
}

function rendererUrl(view: string, displayId?: number): string {
  const suffix = `?view=${view}${displayId === undefined ? '' : `&displayId=${displayId}`}`;
  return `${pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).toString()}${suffix}`;
}

function broadcast(channel: string, payload: unknown): void {
  if (chatWindow && !chatWindow.isDestroyed()) chatWindow.webContents.send(channel, payload);
  for (const win of overlays.values()) if (!win.isDestroyed()) win.webContents.send(channel, payload);
}

function setStatus(connection: AppStatus['connection'], detail: string): void {
  status = {
    connection, detail, paused: settings.paused, proactive: settings.proactive,
    recording, excludedApps: settings.excludedApps,
    launchAtLogin: settings.launchAtLogin, lastForeground: foreground.process || foreground.title,
  };
  broadcast('status:update', status);
  cursorDot.setVisible(!settings.paused && !locked);
  rebuildTrayMenu();
}

function isExcludedTarget(target: { process: string; title: string }): boolean {
  if (!target.process && !target.title) return true;
  const title = target.title.toLowerCase();
  if (/\b(incognito|inprivate|private browsing|windows security|credential|password manager)\b/.test(title)) return true;
  return settings.excludedApps.some(item => target.process.toLowerCase() === item || title.includes(item));
}

function isExcluded(): boolean { return isExcludedTarget(foreground); }

async function bindProposal(proposal: AgentProposal): Promise<void> {
  pendingTarget = null;
  proposedAt = Date.now();
  if (!proposal.action) return;
  chatWindow?.hide();
  try {
    await new Promise(resolve => setTimeout(resolve, 60));
    const target = await inspectDesktopTarget(proposal.action, proposal.displayId);
    if (isExcludedTarget(target)) throw new Error('The proposed target is excluded from desktop actions.');
    pendingTarget = target;
  } finally { showChat(false); }
}

function rebuildOverlays(): void {
  markerGeneration++;
  if (markerTimer) clearTimeout(markerTimer);
  for (const win of overlays.values()) win.destroy();
  overlays.clear();
}

function createChatWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 360, height: 160, show: false, frame: false, transparent: true,
    resizable: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  void win.loadURL(rendererUrl('chat'));
  win.setContentProtection(!process.argv.includes('--visual-check'));
  win.setAlwaysOnTop(true, 'screen-saver');
  win.webContents.on('render-process-gone', (_event, details) => console.error('Chat renderer stopped:', details.reason));
  win.webContents.on('did-fail-load', (_event, code, description) => console.error('Chat load failed:', code, description));
  win.on('close', event => { if (!isQuitting) { event.preventDefault(); win.hide(); } });
  return win;
}

function showChat(reposition = true): void {
  if (!chatWindow) return;
  if (reposition) {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const bounds = display.workArea;
  const size = chatWindow.getBounds();
  const x = Math.max(bounds.x + 8, Math.min(cursor.x + 28, bounds.x + bounds.width - size.width - 8));
  const y = Math.max(bounds.y + 8, Math.min(cursor.y + 28, bounds.y + bounds.height - size.height - 8));
  chatWindow.setPosition(Math.round(x), Math.round(y));
  }
  chatWindow.show();
  chatWindow.focus();
}

function toggleChat(): void {
  if (chatWindow?.isVisible()) chatWindow.hide(); else showChat();
}

function toggleRecording(): void {
  if (settings.paused || locked || (!recording && busy)) return;
  showChat();
  recording = !recording;
  setStatus(status.connection, status.detail);
  chatWindow?.webContents.send('voice:recording', recording);
}

function showMarkers(reply: Reply): void {
  rebuildOverlays();
  if (settings.paused || locked || (!reply.points.length && !reply.answer)) return;
  const display = screen.getAllDisplays().find(item => item.id === reply.displayId);
  if (!display) return;
  const generation = markerGeneration;
  const target = createAnnotationWindow(display, rendererUrl('overlay', display.id),
    path.join(__dirname, 'preload.js'), reply, screen.getCursorScreenPoint(),
    () => generation === markerGeneration && !settings.paused && !locked,
    () => { markerTimer = setTimeout(rebuildOverlays, reply.mode === 'guide' ? 30000 : 9500); },
    !process.argv.includes('--visual-check'));
  overlays.set(display.id, target);
}

async function captureOnDemand(): Promise<Awaited<ReturnType<ScreenSampler['capture']>>> {
  chatWindow?.hide();
  rebuildOverlays();
  try {
    await new Promise(resolve => setTimeout(resolve, 60));
    if (settings.paused || locked) throw new Error('Screen capture is paused.');
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const probe = { kind: 'click' as const, x: (cursor.x - display.bounds.x) / Math.max(1, display.bounds.width - 1), y: (cursor.y - display.bounds.y) / Math.max(1, display.bounds.height - 1) };
    const before = await inspectDesktopTarget(probe, display.id);
    foreground = before;
    if (isExcludedTarget(before)) throw new Error('Screen capture is unavailable for this app.');
    sampler.clear();
    const shot = await sampler.capture(display.id);
    const after = await inspectDesktopTarget(probe, display.id);
    foreground = after;
    if (settings.paused || locked || before.handle !== after.handle || isExcludedTarget(after)) {
      sampler.clear();
      throw new Error('Screen capture stopped because the target changed.');
    }
    return shot;
  } finally { showChat(false); }
}

async function runInference<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  inferenceController = controller;
  try { return await request(controller.signal); }
  finally { if (inferenceController === controller) inferenceController = null; }
}

async function sendQuestion(text: string): Promise<Reply> {
  if (settings.paused || locked) throw new Error('Screen awareness is paused.');
  if (status.connection !== 'online') throw new Error(status.detail);
  if (busy) throw new Error('Hermes is still answering the previous request.');
  busy = true;
  const epoch = ++requestEpoch;
  pendingProposal = null; pendingTarget = null;
  const started = Date.now();
  try {
    progress('Looking at your screen…');
    const screenshot = await captureOnDemand();
    if (epoch !== requestEpoch) throw new Error('Request stopped.');
    if (!screenshot) throw new Error('The screen could not be captured.');
    if (settings.paused || locked) throw new Error('Screen awareness was paused before sending.');
    const captured = Date.now();
    let firstToken = 0;
    progress('Thinking…');
    const reply = await runInference(signal => askCompanion(text, screenshot, chatSession, signal, answer => {
      firstToken ||= Date.now(); progress('Answering…', answer);
    }));
    if (settings.paused || locked || epoch !== requestEpoch) throw new Error('Request stopped.');
    if (reply.proposal) {
      agentTask = text; agentHistory = []; agentSession = chatSession;
      pendingProposal = reply.proposal;
      await bindProposal(pendingProposal);
    }
    console.log(`Companion timing: capture=${captured - started}ms first=${firstToken ? firstToken - started : 0}ms total=${Date.now() - started}ms`);
    showMarkers(reply);
    return reply;
  } finally { busy = false; progress(''); }
}

async function startAgent(task: string): Promise<AgentProposal> {
  const reply = await sendQuestion(task);
  return reply.proposal || { id: crypto.randomUUID(), displayId: reply.displayId, explanation: reply.answer, action: null, done: true };
}
async function executeAgentStep(id: string): Promise<AgentProposal> {
  const proposal = pendingProposal;
  const target = requireApprovedStep(proposal, pendingTarget, id, proposedAt, Date.now(), settings.paused, locked, isExcluded());
  if (!proposal?.action) throw new Error('This agent step is no longer available.');
  if (busy) throw new Error('Hermes is still answering.');
  busy = true;
  const epoch = ++requestEpoch;
  pendingProposal = null;
  pendingTarget = null;
  chatWindow?.hide();
  try {
    await new Promise(resolve => setTimeout(resolve, 60));
    if (settings.paused || locked) throw new Error('Desktop actions were paused before execution.');
    const currentTarget = await inspectDesktopTarget(proposal.action, proposal.displayId);
    if (epoch !== requestEpoch) throw new Error('Request stopped.');
    requireSameTarget(target, currentTarget, isExcludedTarget(currentTarget));
    if (settings.paused || locked) throw new Error('Desktop actions were paused before execution.');
    if (agentHistory.length >= MAX_TASK_STEPS) throw new Error('Stopped after eight steps. Review the screen and ask to continue.');
    progress(`Running step ${agentHistory.length + 1}…`);
    await runDesktopAction(proposal.action, proposal.displayId, target.handle);
    agentHistory.push(proposal.explanation);
    await new Promise(resolve => setTimeout(resolve, 250));
    if (settings.paused || locked || isExcluded()) throw new Error('The desktop is unavailable; the agent stopped.');
    const afterActionTarget = await inspectDesktopTarget(proposal.action, proposal.displayId);
    foreground = afterActionTarget;
    if (epoch !== requestEpoch || settings.paused || locked || isExcludedTarget(afterActionTarget)) {
      throw new Error('The desktop is unavailable; the agent stopped.');
    }
    sampler.clear();
    const screenshot = await sampler.capture(proposal.displayId);
    const afterCaptureTarget = await inspectDesktopTarget(proposal.action, proposal.displayId);
    if (afterCaptureTarget.handle !== afterActionTarget.handle || isExcludedTarget(afterCaptureTarget)) {
      sampler.clear();
      throw new Error('The target changed during capture; the agent stopped.');
    }
    if (epoch !== requestEpoch) throw new Error('Request stopped.');
    if (!screenshot) throw new Error('The screen could not be captured after the action.');
    showChat(false);
    progress('Checking the result…');
    const nextReply = await runInference(signal => askCompanion(`Perform the remaining steps of this task: ${agentTask}\nActions actually executed: ${agentHistory.join(' | ')}. Verify the current screenshot. If the original task is satisfied, action=null and confirm completion. Otherwise propose only the next required action. Never repeat a completed action.`, screenshot, agentSession, signal, answer => progress('Answering…', answer), Boolean(proposal.automatic)));
    pendingProposal = nextReply.proposal || { id: crypto.randomUUID(), displayId: screenshot.displayId, explanation: nextReply.answer, action: null, done: true };
    if (epoch !== requestEpoch) { pendingProposal = null; throw new Error('Request stopped.'); }
    if (settings.paused || locked || isExcluded()) throw new Error('The desktop changed while planning this step.');
    pendingProposal.automatic = Boolean(proposal.automatic && nextReply.proposal?.automatic);
    await bindProposal(pendingProposal);
    showMarkers(nextReply);
    return pendingProposal;
  } finally { busy = false; progress(''); showChat(false); }
}

function rebuildTrayMenu(): void {
  if (!tray) return;
  tray.setToolTip(`Hermes Cursor Companion — ${status?.connection || 'starting'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open companion', click: () => showChat() },
    { label: 'Pause screen awareness', type: 'checkbox', checked: settings.paused, click: () => updateSettings({ paused: !settings.paused }) },

    { label: 'Settings', click: () => { showChat(); chatWindow?.webContents.send('settings:open'); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

function updateSettings(changes: Partial<Settings>): AppStatus {
  if (typeof changes.paused === 'boolean') settings.paused = changes.paused;
  settings.proactive = false;
  if (typeof changes.launchAtLogin === 'boolean') settings.launchAtLogin = changes.launchAtLogin;
  if (Array.isArray(changes.excludedApps)) {
    settings.excludedApps = changes.excludedApps.filter(item => typeof item === 'string')
      .map(item => item.trim().toLowerCase()).filter(Boolean).slice(0, 50);
  }
  saveSettings(settings);
  if (settings.paused) { requestEpoch++; recording = false; chatWindow?.webContents.send('voice:recording', false, true); inferenceController?.abort(); sampler.clear(); pendingProposal = null; pendingTarget = null; rebuildOverlays(); }
  setStatus(status.connection, status.detail);
  return status;
}

function registerIpc(): void {
  ipcMain.handle('status:get', () => status);
  ipcMain.handle('chat:send', (_event, text: unknown) => {
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw new Error('Enter a question of at most 4,000 characters.');
    return sendQuestion(text.trim());
  });
  ipcMain.handle('voice:submit', async (_event, dataUrl: unknown) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:audio/') || dataUrl.length > 16_000_000) throw new Error('Invalid voice recording.');
    if (settings.paused || locked || busy) throw new Error('Voice input is unavailable right now.');
    busy = true;
    const epoch = requestEpoch;
    progress('Transcribing…');
    let transcript: string;
    try { transcript = await transcribeAudio(dataUrl); } finally { progress(''); busy = false; }
    if (epoch !== requestEpoch) throw new Error('Request stopped.');
    if (!transcript) throw new Error('I could not hear any speech.');
    const reply = await sendQuestion(transcript);
    if (!reply.proposal) chatWindow?.hide();
    return { transcript, reply };
  });
  ipcMain.handle('voice:transcribe', (_event, dataUrl: unknown) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:audio/') || dataUrl.length > 16_000_000) throw new Error('Invalid voice recording.');
    return transcribeAudio(dataUrl);
  });
  ipcMain.handle('agent:start', (_event, task: unknown) => {
    if (typeof task !== 'string' || !task.trim() || task.length > 2000) throw new Error('Enter an agent task of at most 2,000 characters.');
    return startAgent(task.trim());
  });
  ipcMain.handle('agent:execute', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid agent step.');
    return executeAgentStep(id);
  });
  ipcMain.handle('agent:cancel', () => { requestEpoch++; inferenceController?.abort(); pendingProposal = null; pendingTarget = null; agentTask = ''; agentHistory = []; rebuildOverlays(); });
  ipcMain.handle('voice:speak', (_event, text: unknown) => {
    if (typeof text !== 'string' || !text.trim()) throw new Error('Nothing to speak.');
    return speakText(text);
  });
  ipcMain.handle('voice:toggle', () => toggleRecording());
  ipcMain.handle('hermes:configure', async () => {
    setStatus('setting-up', 'Checking the existing Hermes connection…');
    try {
      await configureHermes();
      setStatus('online', 'Connected to Hermes with guidance-only access.');
    } catch (error) {
      setStatus('offline', String(error instanceof Error ? error.message : error));
      throw error;
    }
  });
  ipcMain.handle('settings:update', (_event, changes: Partial<Settings>) => updateSettings(changes || {}));
  ipcMain.on('chat:hide', () => chatWindow?.hide());
  ipcMain.on('chat:resize', (_event, height: unknown) => {
    if (!chatWindow || typeof height !== 'number' || !Number.isFinite(height)) return;
    const current = chatWindow.getBounds();
    const area = screen.getDisplayMatching(current).workArea;
    const nextHeight = Math.round(Math.min(area.height - 16, Math.max(116, Math.min(460, height))));
    if (current.height === nextHeight) return;
    chatWindow.setBounds({ ...current, height: nextHeight, y: Math.max(area.y + 8, Math.min(current.y, area.y + area.height - nextHeight - 8)) });
  });
}

async function refreshConnection(): Promise<void> {
  if (status.connection === 'setting-up') return;
  const check = await checkHermes();
  const unsafe = check.detail.includes('toolset') || check.detail.includes('enabled API tools');
  setStatus(check.ok ? 'online' : unsafe ? 'unsafe' : 'offline', check.detail);
}

app.on('second-instance', () => showChat());

app.whenReady().then(async () => {
  const { session } = await import('electron');
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'media'));
  settings = loadSettings();
  settings.proactive = false;
  if (app.isPackaged) saveSettings(settings);
  loadSessionIds();
  status = {
    connection: 'offline', detail: 'Checking Hermes…', paused: settings.paused,
    proactive: settings.proactive, recording: false, excludedApps: settings.excludedApps,
    launchAtLogin: settings.launchAtLogin, lastForeground: '',
  };
  registerIpc();
  const iconPath = path.join(app.getAppPath(), 'assets', 'tray.png');
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.on('double-click', () => showChat());
  rebuildTrayMenu();
  chatWindow = createChatWindow();
  globalShortcut.register('CommandOrControl+Shift+Space', toggleChat);
  globalShortcut.register('CommandOrControl+Alt+Space', toggleRecording);
  powerMonitor.on('lock-screen', () => { locked = true; requestEpoch++; recording = false; chatWindow?.webContents.send('voice:recording', false, true); cursorDot.setVisible(false); inferenceController?.abort(); sampler.clear(); pendingProposal = null; pendingTarget = null; rebuildOverlays(); });
  powerMonitor.on('unlock-screen', () => { locked = false; cursorDot.setVisible(!settings.paused); });
  screen.on('display-added', rebuildOverlays);
  screen.on('display-removed', rebuildOverlays);
  screen.on('display-metrics-changed', rebuildOverlays);
  cursorDot.start();
  cursorDot.setVisible(!settings.paused);
  startDesktopHelper();
  void warmLocalStt().catch(() => {});

  statusTimer = setInterval(() => { void refreshConnection(); }, 15000);
  await refreshConnection();
  showChat();
});

app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  cursorDot.stop();
  closeDesktopHelper();
  closeLocalStt();
  closeDashboard();


  if (statusTimer) clearInterval(statusTimer);
  if (markerTimer) clearTimeout(markerTimer);
});
