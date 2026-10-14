import { desktopCapturer, screen } from 'electron';
import type { Screenshot } from './hermes';

export interface Foreground {
  process: string;
  title: string;
}

export class ScreenSampler {
  private latest: Screenshot | null = null;
  private latestAt = 0;
  private generation = 0;
  private pending = Promise.resolve();

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.pending.then(work);
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }

  capture(displayId?: number): Promise<Screenshot | null> {
    const generation = this.generation;
    const targetId = displayId ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
    return this.serialize(async () => {
      if (generation !== this.generation) return null;
      const display = screen.getAllDisplays().find(item => item.id === targetId);
      if (!display) return null;
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1600, height: 1000 } });
      if (generation !== this.generation || !screen.getAllDisplays().some(item => item.id === targetId)) return null;
      // Electron identifies monitors by display_id; source ordering can change.
      // Refuse a missing monitor instead of attaching another monitor's image.
      const displays = screen.getAllDisplays();
      const source = sources.find(item => item.display_id === String(display.id))
        // Windows can identify a sole capture source as "Entire screen" with no
        // display_id. This is unambiguous only when exactly one monitor exists.
        ?? (displays.length === 1 && sources.length === 1 && !sources[0].display_id ? sources[0] : undefined);
      if (!source || source.thumbnail.isEmpty()) return null;
      const image = source.thumbnail;
      this.latest = { dataUrl: `data:image/jpeg;base64,${image.toJPEG(72).toString('base64')}`, displayId: display.id };
      this.latestAt = Date.now();
      return this.latest;
    });
  }

  async current(): Promise<Screenshot | null> {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (this.latest?.displayId === display.id && Date.now() - this.latestAt < 2000) return this.latest;
    return this.capture(display.id);
  }

  clear(): void {
    this.generation += 1;
    this.latest = null;
    this.latestAt = 0;
  }
}
