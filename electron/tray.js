// Menu bar (tray) icon + menu.

const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

function createTray(ctx) {
  const iconPath = path.join(__dirname, '..', 'assets', 'trayTemplate.png');
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    image = nativeImage.createEmpty();
  }
  image.setTemplateImage(true);
  const tray = new Tray(image);
  tray.setToolTip('Sotto — voice dictation');

  const rebuild = () => {
    const { recorder, windows, app } = ctx;
    const menu = Menu.buildFromTemplate([
      {
        label: 'Open Sotto',
        click: () => {
          if (windows.dashboard && !windows.dashboard.isDestroyed()) {
            windows.dashboard.show();
            windows.dashboard.focus();
          }
        },
      },
      {
        label: recorder.state === 'recording' ? 'Stop dictation' : 'Start hands-free dictation',
        click: () => recorder.toggleHandsFree(),
      },
      { type: 'separator' },
      {
        label: 'Quit Sotto',
        click: () => {
          global.__sottoQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(menu);
  };
  rebuild();
  return { tray, rebuild };
}

module.exports = { createTray };
