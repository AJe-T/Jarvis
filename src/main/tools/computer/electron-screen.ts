import { BrowserWindow, desktopCapturer, screen } from 'electron';
import type { ScreenSource } from './drivers';

/** desktopCapturer screenshots of the primary display (overlay windows are content-protected, so excluded). */
export function createElectronScreen(
  isJarvisWindowVisible: (w: BrowserWindow) => boolean,
): ScreenSource {
  const display = () => {
    const d = screen.getPrimaryDisplay();
    return { bounds: d.bounds, scaleFactor: d.scaleFactor, id: d.id };
  };
  return {
    display: () => {
      const { bounds, scaleFactor } = display();
      return { bounds, scaleFactor };
    },
    async capture({ crop, width, height }) {
      const d = display();
      const physical = {
        width: Math.round(d.bounds.width * d.scaleFactor),
        height: Math.round(d.bounds.height * d.scaleFactor),
      };
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: physical,
      });
      const source = sources.find((s) => s.display_id === String(d.id)) ?? sources[0];
      if (!source) throw new Error('No screen available to capture.');
      let img = source.thumbnail;
      if (crop) img = img.crop(crop);
      return img.resize({ width, height, quality: 'good' }).toPNG();
    },
    cursorDip: () => screen.getCursorScreenPoint(),
    jarvisWindows: () =>
      BrowserWindow.getAllWindows()
        .filter(
          (w) => !w.isDestroyed() && w.isVisible() && !w.isMinimized() && isJarvisWindowVisible(w),
        )
        .map((w) => w.getBounds()),
  };
}
