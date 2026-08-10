// Menu bar (tray) icon + menu.

const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

function loadTemplate(name) {
  const image = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', name));
  if (!image.isEmpty()) image.setTemplateImage(true);
  return image;
}

function createTray(ctx) {
  const idleImage = loadTemplate('trayTemplate.png');
  const recImage = loadTemplate('trayRecordingTemplate.png');
  const tray = new Tray(idleImage.isEmpty() ? nativeImage.createEmpty() : idleImage);
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
  const setRecording = (recording) => {
    const img = recording ? recImage : idleImage;
    if (!img.isEmpty()) tray.setImage(img);
    rebuild();
  };
  return { tray, rebuild, setRecording };
}

module.exports = { createTray };
