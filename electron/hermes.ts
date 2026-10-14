import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import net from 'node:net';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import YAML from 'yaml';
import type { AgentAction, AgentProposal, Marker, Reply } from './types';
import { requestDesktopSpeech } from './desktop';
import { transcribeLocal } from './localStt';

const API = 'http://127.0.0.1:8642';
// A private dashboard avoids taking over the gateway's shared dashboard port.
let dashboardPort = 19120;
let DASHBOARD = `http://127.0.0.1:${dashboardPort}`;
const dashboardToken = crypto.randomBytes(32).toString('hex');

function hermesHome(): string {
  return process.env.HERMES_HOME || path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'hermes');
}

function hermesExecutable(): string {
  return path.join(hermesHome(), 'bin', 'hermes.exe');
}

function readEnv(): Record<string, string> {
  const file = path.join(hermesHome(), '.env');
  if (!fs.existsSync(file)) return {};
  try {
    return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).flatMap(line => {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, '')]] : [];
    }));
  } catch { return {}; }
}

export function getApiKey(): string | null {
  return process.env.API_SERVER_KEY || readEnv().API_SERVER_KEY || null;
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<any> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || body?.detail || `HTTP ${response.status}`);
  return body;
}

export async function checkHermes(): Promise<{ ok: boolean; detail: string }> {
  const key = getApiKey();
  if (!key) return { ok: false, detail: 'Hermes API key is not configured.' };
  try {
    const cfg = YAML.parse(fs.readFileSync(path.join(hermesHome(), 'config.yaml'), 'utf8')) as any;
    const toolsets = cfg?.platform_toolsets?.api_server;
    if (!Array.isArray(toolsets) || toolsets.length !== 0) {
      return { ok: false, detail: 'Hermes API toolsets must be explicitly empty.' };
    }
    const response = await fetchJson(`${API}/v1/toolsets`, {
      headers: { Authorization: `Bearer ${key}` },
    }, 5000);
    const entries = Array.isArray(response) ? response : response?.data;
    if (!Array.isArray(entries) || entries.some((item: any) => item.enabled)) {
      return { ok: false, detail: 'Hermes reports enabled API tools; companion requests are blocked.' };
    }
    return { ok: true, detail: 'Connected to Hermes with guidance-only access.' };
  } catch (error) {
    return { ok: false, detail: `Hermes API unavailable: ${String(error instanceof Error ? error.message : error)}` };
  }
}

export async function configureHermes(): Promise<void> {
  const result = await checkHermes();
  if (!result.ok) throw new Error(`${result.detail} Configure the active HERMES_HOME profile manually: enable the loopback API server, set platform_toolsets.api_server to [], then start it outside this app.`);
}

export interface Screenshot {
  dataUrl: string;
  displayId: number;
}

function parseReply(raw: string, displayId: number, proactive: boolean): Reply {
  let parsed: any;
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  } catch {
    return { answer: raw.trim(), points: [], displayId, proactive };
  }
  const answer = typeof parsed?.answer === 'string' ? parsed.answer.trim() : raw.trim();
  const points: Marker[] = Array.isArray(parsed?.points) ? parsed.points.slice(0, 3).flatMap((point: any) => {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return [];
    return [{ x, y, label: String(point?.label || '').slice(0, 48) }];
  }) : [];
  return { answer, points, displayId, proactive };
}

export async function askHermes(input: string, screenshot: Screenshot, sessionId: string, proactive = false, signal?: AbortSignal): Promise<Reply> {
  const key = getApiKey();
  if (!key) throw new Error('Hermes API key is missing.');
  const instruction = proactive
    ? 'You are a quiet Windows screen companion. Offer one short, useful hint only if the screenshot shows a clear opportunity to help. If no clear hint is warranted, return an empty answer. Do not use tools or claim to have acted.'
    : 'You are a Windows screen companion beside the cursor. Answer the user directly and briefly. You may point out up to three visible UI elements. You cannot click, type, run commands, or change the desktop.';
  const message = `${instruction}\nReturn only JSON: {"answer":"...","points":[{"x":0.0,"y":0.0,"label":"..."}]}. Coordinates are fractions of the attached image from top-left. Never invent a point for an element you cannot see.\n${proactive ? 'Task: inspect the screen for a useful nudge.' : `User: ${input}`}`;
  const body = {
    model: 'hermes-agent',
    messages: [{ role: 'user', content: [
      { type: 'text', text: message },
      { type: 'image_url', image_url: { url: screenshot.dataUrl, detail: 'high' } },
    ] }],
    stream: false,
    model_options: { reasoning_effort: 'low' },
  };
  const result = await fetchJson(`${API}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Hermes-Session-Id': sessionId },
    body: JSON.stringify(body),
    signal,
  }, 120000);
  const raw = result?.choices?.[0]?.message?.content;
  if (typeof raw !== 'string') throw new Error('Hermes returned no text response.');
  return parseReply(raw, screenshot.displayId, proactive);
}

export async function proposeAgentStep(task: string, screenshot: Screenshot, sessionId: string, history: string[], signal?: AbortSignal): Promise<AgentProposal> {
  const key = getApiKey();
  if (!key) throw new Error('Hermes API key is missing.');
  const instruction = `You are a Windows desktop assistant. Plan exactly ONE next visible UI action for the user's task. The app will show it to the user and execute it only after they press Run step. Use only what is visible in this screenshot. Do not use tools. Do not request terminal commands, credentials, payments, deletion, or security changes. If the task is complete or needs information you cannot see, set done=true and explain. For typing, include coordinates of the target field. Coordinates are fractions of the image from top-left. Return only JSON: {"explanation":"short plain-language step","done":false,"action":{"kind":"click|type|key","x":0.0,"y":0.0,"text":"text for type","key":"enter|tab|escape|backspace|up|down|left|right"}}. Use null action when done=true.\nTask: ${task}\nCompleted steps: ${history.join(' | ') || 'none'}`;
  const result = await fetchJson(`${API}/v1/chat/completions`, {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Hermes-Session-Id': sessionId },
    body: JSON.stringify({ model: 'hermes-agent', messages: [{ role: 'user', content: [
      { type: 'text', text: instruction }, { type: 'image_url', image_url: { url: screenshot.dataUrl, detail: 'high' } },
    ] }], stream: false, model_options: { reasoning_effort: 'low' } }),
  }, 120000);
  const raw = result?.choices?.[0]?.message?.content;
  if (typeof raw !== 'string') throw new Error('Hermes returned no agent step.');
  let parsed: any;
  try { parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw new Error(`Hermes did not return an actionable step: ${raw.slice(0, 180)}`); }
  const explanation = String(parsed?.explanation || '').trim().slice(0, 240);
  if (!explanation) throw new Error('Hermes returned an empty agent step.');
  if (parsed?.done === true) return { id: crypto.randomUUID(), displayId: screenshot.displayId, explanation, action: null, done: true };
  const candidate = parsed?.action;
  const x = Number(candidate?.x), y = Number(candidate?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) throw new Error('Hermes returned invalid action coordinates.');
  let action: AgentAction;
  if (candidate?.kind === 'click') action = { kind: 'click', x, y };
  else if (candidate?.kind === 'type' && typeof candidate.text === 'string' && candidate.text.length <= 1000) action = { kind: 'type', x, y, text: candidate.text };
  else if (candidate?.kind === 'key' && ['enter','tab','escape','backspace','up','down','left','right'].includes(candidate.key)) action = { kind: 'key', x, y, key: candidate.key };
  else throw new Error('Hermes returned an unsupported desktop action.');
  return { id: crypto.randomUUID(), displayId: screenshot.displayId, explanation, action, done: false };
}

let dashboardProcess: ChildProcessWithoutNullStreams | null = null;
let dashboardError = '';
let dashboardStartup: Promise<void> | null = null;

async function dashboardAvailable(): Promise<boolean> {
  if (!dashboardProcess) return false;
  try {
    const response = await fetch(`${DASHBOARD}/api/status`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch { return false; }
}

export function privateVoiceBackendArgs(port = 19120): string[] {
  return ['serve', '--isolated', '--host', '127.0.0.1', '--port', String(port)];
}

export async function ensureDashboard(): Promise<void> {
  if (dashboardStartup) return dashboardStartup;
  dashboardStartup = startDashboard();
  try { await dashboardStartup; } finally { dashboardStartup = null; }
}

async function startDashboard(): Promise<void> {
  if (await dashboardAvailable()) return;
  if (!dashboardProcess) {
    if (!fs.existsSync(hermesExecutable())) throw new Error(`Hermes executable was not found in ${hermesHome()}.`);
    dashboardError = '';
    dashboardPort = await new Promise<number>((resolve, reject) => {
      const server = net.createServer(); server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { const port = (server.address() as net.AddressInfo).port; server.close(error => error ? reject(error) : resolve(port)); });
    });
    DASHBOARD = `http://127.0.0.1:${dashboardPort}`;
    dashboardProcess = spawn(hermesExecutable(), privateVoiceBackendArgs(dashboardPort), {
      windowsHide: true,
      stdio: 'pipe',
      env: { ...process.env, HERMES_DASHBOARD_SESSION_TOKEN: dashboardToken },
    });
    dashboardProcess.stdout.resume();
    dashboardProcess.stderr.setEncoding('utf8');
    dashboardProcess.stderr.on('data', (chunk: string) => { dashboardError = (dashboardError + chunk).slice(-1000); });
    dashboardProcess.once('error', error => { dashboardError = error.message; dashboardProcess = null; });
    dashboardProcess.once('exit', code => { if (code !== 0) dashboardError ||= `Hermes dashboard exited with code ${code}.`; dashboardProcess = null; });
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await dashboardAvailable()) return;
    if (!dashboardProcess) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Hermes voice dashboard did not start on its private loopback port. ${dashboardError.slice(0, 300)}`);
}

export async function transcribeAudio(dataUrl: string): Promise<string> {
  const local = await transcribeLocal(dataUrl);
  if (local !== null) return local;
  await ensureDashboard();
  try {
    const result = await fetchJson(`${DASHBOARD}/api/audio/transcribe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hermes-Session-Token': dashboardToken },
      body: JSON.stringify({ data_url: dataUrl, mime_type: dataUrl.slice(5).split(';', 1)[0] }),
    }, 120000);
    return String(result?.transcript || '').trim();
  } catch (error) {
    if (/no confident speech detected|empty transcript/i.test(String(error))) return '';
    throw error;
  }
}

async function localWindowsSpeech(text: string): Promise<string> {
  const script = process.resourcesPath ? path.join(process.resourcesPath, 'speak.ps1') : '';
  const source = path.join(process.cwd(), 'windows', 'speak.ps1');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fs.existsSync(script) ? script : source], {
      windowsHide: true, stdio: 'pipe',
    });
    let output = '', error = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Windows speech timed out.')); }, 60000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { output += chunk; });
    child.stderr.on('data', (chunk: string) => { error += chunk.slice(0, 2000); });
    child.once('error', reason => { clearTimeout(timer); reject(reason); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0 && output.startsWith('data:audio/wav;base64,')) resolve(output);
      else reject(new Error(error.trim() || `Windows speech exited with code ${code}`));
    });
    child.stdin.end(JSON.stringify({ text: text.slice(0, 4000) }));
  });
}

export async function speakText(text: string): Promise<string> {
  // The installed Windows voice is immediate; no failed remote-TTS wait per reply.
  try { return await requestDesktopSpeech(text); }
  catch { /* Hermes remains available if the installed voice cannot synthesize. */ }
  try {
    await ensureDashboard();
    const result = await fetchJson(`${DASHBOARD}/api/audio/speak`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hermes-Session-Token': dashboardToken },
      body: JSON.stringify({ text: text.slice(0, 4000) }),
    }, 20000);
    if (typeof result?.data_url === 'string') return result.data_url;
  } catch { /* Use the installed Windows voice when Hermes TTS is unavailable. */ }
  return localWindowsSpeech(text);
}

export function closeDashboard(): void {
  dashboardProcess?.kill();
  dashboardProcess = null;
}
