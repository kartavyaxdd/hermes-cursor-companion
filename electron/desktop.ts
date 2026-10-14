import { app, screen } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import type { AgentAction } from './types';
import { fractionToDisplayPoint } from './coordinates';
export interface DesktopTarget { handle: string; process: string; title: string }
let child: ChildProcessWithoutNullStreams | null = null;
let sequence = 0;
const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
function failPending(error: Error): void {
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
  pending.clear();
}
export function startDesktopHelper(): void {
  if (child) return;
  const script = app?.isPackaged ? path.join(process.resourcesPath, 'act.ps1') : path.join(__dirname, '..', 'windows', 'act.ps1');
  const worker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Server'], { windowsHide: true, stdio: 'pipe' });
  child = worker;
  let buffer = '';
  worker.stdout.setEncoding('utf8');
  worker.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
    for (const line of lines) {
      try {
        const message = JSON.parse(line);
        const request = pending.get(message.id);
        if (!request) continue;
        pending.delete(message.id); clearTimeout(request.timer);
        message.ok ? request.resolve(message.result) : request.reject(new Error(message.error || 'Desktop helper rejected the request.'));
      } catch { /* Startup diagnostics are not protocol replies. */ }
    }
  });
  worker.stderr.resume();
  worker.stdin.on('error', () => {});
  worker.once('error', error => { if (child === worker) { child = null; failPending(error); } });
  worker.once('exit', () => { if (child === worker) { child = null; failPending(new Error('Desktop helper stopped. Please try again.')); } });
}
export function closeDesktopHelper(): void {
  const worker = child; child = null;
  failPending(new Error('Companion is shutting down.'));
  worker?.stdin.end();
  const timer = setTimeout(() => worker?.kill(), 1000); timer.unref();
  worker?.once('exit', () => clearTimeout(timer));
}
function helper(request: object, timeout = 10000): Promise<any> {
  startDesktopHelper();
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id); reject(new Error('Desktop helper timed out.'));
      child?.kill();
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    child!.stdin.write(JSON.stringify({ ...request, id }) + '\n');
  });
}
function actionPoint(action: AgentAction, displayId: number): { x: number; y: number } {
  const display = screen.getAllDisplays().find(item => item.id === displayId);
  if (!display) throw new Error('The target monitor is no longer connected.');
  return screen.dipToScreenPoint(fractionToDisplayPoint(display.bounds, action.x, action.y));
}
export async function inspectDesktopTarget(action: AgentAction, displayId: number): Promise<DesktopTarget> {
  const target = await helper({ kind: 'inspect', ...actionPoint(action, displayId) }) as DesktopTarget;
  if (!target?.handle || !target.process) throw new Error('The proposed desktop target could not be identified.');
  return target;
}
export async function runDesktopAction(action: AgentAction, displayId: number, expectedHandle: string): Promise<void> {
  await helper({ ...action, ...actionPoint(action, displayId), expectedHandle });
}
export async function requestDesktopSpeech(text: string): Promise<string> {
  return helper({ kind: 'speak', text: text.slice(0, 4000) }, 30000);
}
