import { app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';

/** Owns the native 24px surface; it follows the mouse without Electron frames or move IPC. */
export class CursorDot {
  private child: ChildProcessWithoutNullStreams | null = null;
  private visible = false;

  constructor(private readonly onError: (error: Error) => void = () => {}) {}

  start(): void {
    if (this.child || process.platform !== 'win32') return;
    const executable = app.isPackaged
      ? path.join(process.resourcesPath, 'cursor-dot.exe')
      : path.join(app.getAppPath(), 'windows', 'cursor-dot.exe');
    const child = spawn(executable, ['--parent', String(process.pid)], {
      windowsHide: true,
      stdio: 'pipe',
    });
    this.child = child;
    let errorText = '';
    child.stdout.resume();
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { errorText = (errorText + chunk).slice(-2048); });
    child.stdin.on('error', () => { /* Exit/error reports the process failure once. */ });
    child.once('error', error => {
      if (this.child === child) this.child = null;
      this.onError(error);
    });
    child.once('exit', code => {
      if (this.child !== child) return;
      this.child = null;
      this.onError(new Error(errorText.trim() || `Native cursor dot exited unexpectedly with code ${code}.`));
    });
    child.once('spawn', () => this.write(this.visible ? 'show' : 'hide'));
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.write(visible ? 'show' : 'hide');
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    if (!child) return;
    if (child.stdin.writable) child.stdin.end('quit\n');
    const timer = setTimeout(() => { if (child.exitCode === null) child.kill(); }, 1000);
    timer.unref();
    child.once('exit', () => clearTimeout(timer));
  }

  private write(command: 'show' | 'hide'): void {
    if (this.child?.stdin.writable) this.child.stdin.write(`${command}\n`);
  }
}
