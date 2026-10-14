import type { AgentProposal, AppStatus, Reply, Settings } from '../electron/types';

declare global {
  interface Window {
    companion: {
      getStatus(): Promise<AppStatus>;
      sendMessage(text: string): Promise<Reply>;
      submitVoice(dataUrl: string): Promise<{ transcript: string; reply: Reply }>;
      transcribeVoice(dataUrl: string): Promise<string>;
      startAgent(task: string): Promise<AgentProposal>;
      executeAgent(id: string): Promise<AgentProposal>;
      cancelAgent(): Promise<void>;
      speak(text: string): Promise<string>;
      toggleRecording(): Promise<void>;
      configureHermes(): Promise<void>;
      updateSettings(changes: Partial<Settings>): Promise<AppStatus>;
      hideChat(): void;
      resizeSurface(height: number): void;
      overlayReady(): void;
      on(channel: string, listener: (...args: any[]) => void): () => void;
    };
  }
}

export {};
