import { contextBridge, ipcRenderer } from 'electron';
import type { AgentProposal, AppStatus, Reply, Settings } from './types';

contextBridge.exposeInMainWorld('companion', {
  getStatus: (): Promise<AppStatus> => ipcRenderer.invoke('status:get'),
  sendMessage: (text: string): Promise<Reply> => ipcRenderer.invoke('chat:send', text),
  submitVoice: (dataUrl: string): Promise<{ transcript: string; reply: Reply }> => ipcRenderer.invoke('voice:submit', dataUrl),
  transcribeVoice: (dataUrl: string): Promise<string> => ipcRenderer.invoke('voice:transcribe', dataUrl),
  startAgent: (task: string): Promise<AgentProposal> => ipcRenderer.invoke('agent:start', task),
  executeAgent: (id: string): Promise<AgentProposal> => ipcRenderer.invoke('agent:execute', id),
  cancelAgent: (): Promise<void> => ipcRenderer.invoke('agent:cancel'),
  speak: (text: string): Promise<string> => ipcRenderer.invoke('voice:speak', text),
  toggleRecording: (): Promise<void> => ipcRenderer.invoke('voice:toggle'),
  configureHermes: (): Promise<void> => ipcRenderer.invoke('hermes:configure'),
  updateSettings: (changes: Partial<Settings>): Promise<AppStatus> => ipcRenderer.invoke('settings:update', changes),
  hideChat: (): void => ipcRenderer.send('chat:hide'),
  resizeSurface: (height: number): void => ipcRenderer.send('chat:resize', height),
  overlayReady: (): void => ipcRenderer.send('overlay:ready'),
  on: (channel: string, listener: (...args: any[]) => void): (() => void) => {
    const allowed = ['status:update', 'cursor:update', 'markers:update', 'nudge:show', 'bubble:show', 'voice:recording', 'settings:open', 'chat:progress'];
    if (!allowed.includes(channel)) return () => {};
    const handler = (_event: Electron.IpcRendererEvent, ...args: any[]) => listener(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
