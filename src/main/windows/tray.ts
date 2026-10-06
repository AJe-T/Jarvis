import { join } from 'node:path';
import { Menu, Tray, app, nativeImage } from 'electron';

export interface TrayActions {
  show(): void;
  stopEverything(): void;
  toggleVoice(): void;
  openSettings(): void;
  miniMode(): void;
  quit(): void;
  voiceEnabled(): boolean;
}

function resourcesDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources')
    : join(app.getAppPath(), 'resources');
}

export function iconPath(file = 'icon.png'): string {
  return join(resourcesDir(), file);
}

/** PRD F6.4 / Implementation Phase 7: Show, Voice on/off, Stop everything, Quit. */
export function createTray(actions: TrayActions): Tray {
  const tray = new Tray(
    nativeImage.createFromPath(iconPath('tray.png')).resize({ width: 16, height: 16 }),
  );
  tray.setToolTip('Jarvis');
  const rebuild = (): void => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show Jarvis', click: actions.show },
        {
          label: actions.voiceEnabled() ? 'Turn voice off' : 'Turn voice on',
          click: () => (actions.toggleVoice(), rebuild()),
        },
        { label: 'Mini orb', click: actions.miniMode },
        { label: 'Stop everything', click: actions.stopEverything },
        { type: 'separator' },
        { label: 'Settings', click: actions.openSettings },
        { label: 'Quit Jarvis', click: actions.quit },
      ]),
    );
  };
  rebuild();
  tray.on('click', actions.show);
  return tray;
}
