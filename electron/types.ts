export interface Marker {
  x: number;
  y: number;
  label: string;
  step?: number;
}

export interface Reply {
  answer: string;
  mode?: 'answer' | 'guide' | 'act';
  points: Marker[];
  displayId: number;
  proactive?: boolean;
  proposal?: AgentProposal;
}

export interface AgentAction {
  kind: 'click' | 'type' | 'key';
  x: number;
  y: number;
  text?: string;
  key?: 'enter' | 'tab' | 'escape' | 'backspace' | 'up' | 'down' | 'left' | 'right';
}

export interface AgentProposal {
  id: string;
  displayId: number;
  explanation: string;
  action: AgentAction | null;
  done: boolean;
  automatic?: boolean;
}

export interface Settings {
  paused: boolean;
  proactive: boolean;
  launchAtLogin: boolean;
  excludedApps: string[];
}

export interface AppStatus {
  connection: 'online' | 'offline' | 'setting-up' | 'unsafe';
  detail: string;
  paused: boolean;
  proactive: boolean;
  recording: boolean;
  excludedApps: string[];
  launchAtLogin: boolean;
  lastForeground: string;
}
