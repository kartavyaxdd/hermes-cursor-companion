import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import YAML from 'yaml';
let worker: ChildProcessWithoutNullStreams | null = null;
let ready: Promise<boolean> | null = null;
let sequence = 0;
const pending = new Map<number, { resolve(value: string): void; reject(error: Error): void; timer: NodeJS.Timeout }>();

export function warmLocalStt(): Promise<boolean> {
  if (ready) return ready;
  const home = process.env.HERMES_HOME || path.join(process.env.LOCALAPPDATA || '', 'hermes');
  let command = '';
  try {
    const cfg = YAML.parse(fs.readFileSync(path.join(home, 'config.yaml'), 'utf8'));
    command = cfg?.stt?.providers?.[cfg?.stt?.provider]?.command || '';
    if (!command.includes('neo_local_stt.py')) return Promise.resolve(false);
  } catch { return Promise.resolve(false); }
  const python = command.match(/^"([^"]+)"|^(\S+)/)?.slice(1).find(Boolean);
  if (!python || !fs.existsSync(python)) return Promise.resolve(false);
  const model = command.match(/--model\s+([a-zA-Z0-9._-]+)/)?.[1] || 'base';
  const language = command.match(/--language\s+([a-zA-Z0-9_-]+)/)?.[1] || 'auto';
  const script = app?.isPackaged ? path.join(process.resourcesPath, 'local-stt-worker.py') : path.join(__dirname, '..', 'windows', 'local-stt-worker.py');
  ready = new Promise<boolean>(resolve => {
    const child = spawn(python, ['-u', script, model, path.join(home, 'tools', 'neo-stt', 'models'), language], { windowsHide: true, stdio: 'pipe', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    worker = child;
    const timeout = setTimeout(() => { resolve(false); child.kill(); }, 60000);
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          if (message.ready) { clearTimeout(timeout); resolve(true); continue; }
          const request = pending.get(message.id);
          if (!request) continue;
          pending.delete(message.id); clearTimeout(request.timer);
          message.ok ? request.resolve(String(message.transcript || '').trim()) : request.reject(new Error(message.error || 'Local transcription failed.'));
        } catch { /* Ignore diagnostics. */ }
      }
    });
    child.stderr.resume(); child.stdin.on('error', () => {});
    const stopped = () => {
      clearTimeout(timeout); resolve(false);
      if (worker !== child) return;
      worker = null; ready = null;
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Local transcription stopped.')); }
      pending.clear();
    };
    child.once('error', stopped); child.once('exit', stopped);
  });
  return ready;
}

export async function transcribeLocal(dataUrl: string): Promise<string | null> {
  if (!await warmLocalStt() || !worker) return null;
  return new Promise<string>((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Local transcription timed out.')); }, 120000);
    pending.set(id, { resolve, reject, timer });
    worker!.stdin.write(JSON.stringify({ id, audio: dataUrl }) + '\n');
  });
}

export function closeLocalStt(): void {
  const child = worker; worker = null; ready = null;
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Companion is shutting down.')); }
  pending.clear(); child?.kill();
}
