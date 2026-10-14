import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from './types';

const defaults: Settings = {
  paused: false,
  proactive: false,
  launchAtLogin: false,
  excludedApps: ['1password.exe', 'bitwarden.exe', 'keepass.exe', 'keepassxc.exe', 'passwordsafe.exe'],
};

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): Settings {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) as Partial<Settings>;
    return {
      paused: Boolean(parsed.paused),
      proactive: parsed.proactive === true,
      launchAtLogin: Boolean(parsed.launchAtLogin),
      excludedApps: Array.isArray(parsed.excludedApps)
        ? parsed.excludedApps.filter((value): value is string => typeof value === 'string').map(value => value.trim().toLowerCase()).filter(Boolean)
        : defaults.excludedApps,
    };
  } catch {
    return { ...defaults, excludedApps: [...defaults.excludedApps] };
  }
}

export function saveSettings(value: Settings): void {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(value, null, 2), 'utf8');
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: value.launchAtLogin });
}
