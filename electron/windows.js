// Window construction: dashboard, flow bar overlay, onboarding.

const { BrowserWindow, screen } = require('electron');
const path = require('path');

const PRELOAD = path.join(__dirname, 'preload.js');

function createDashboard() {
  const win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 980,
    minHeight: 620,
    title: 'Sotto',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 18 },
    backgroundColor: '#F4F2EC',
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'dashboard', 'index.html'));
  win.on('close', (e) => {
    // Keep the app alive in the tray; closing the dashboard just hides it.
    if (!global.__sottoQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
  return win;
}

// The flow bar window is a fixed-size transparent canvas; the pill inside it
// grows/shrinks with CSS so the window never needs resizing (fewer flicker
// and compositor edge cases). Mouse events pass through except over the pill.
const FLOWBAR = { w: 260, h: 84, margin: 4 };

function flowbarBounds(dock, offset) {
  const disp = screen.getPrimaryDisplay();
  const wa = disp.workArea;
  const { w, h, margin } = FLOWBAR;
  let x; let y;
  if (dock === 'left') {
    x = wa.x + margin;
    y = wa.y + Math.round((wa.height - h) * clamp01(offset));
  } else if (dock === 'right') {
    x = wa.x + wa.width - w - margin;
    y = wa.y + Math.round((wa.height - h) * clamp01(offset));
  } else {
    x = wa.x + Math.round((wa.width - w) * clamp01(offset));
    y = wa.y + wa.height - h - margin;
  }
  return { x, y, width: w, height: h };
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0.5));
}

function createFlowbar(settings) {
  const bounds = flowbarBounds(settings.flowBarDock, settings.flowBarOffset);
  const win = new BrowserWindow({
    ...bounds,
    // NSPanel: the only window type macOS will float above OTHER apps'
    // fullscreen Spaces. A plain window vanishes there even at
    // screen-saver level.
    type: 'panel',
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: false,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver', 1);
  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  win.setFullScreenable(false);
  if (typeof win.setHiddenInMissionControl === 'function') {
    win.setHiddenInMissionControl(true);
  }
  win.loadFile(path.join(__dirname, '..', 'renderer', 'flowbar', 'index.html'));
  // Headless E2E runs keep the overlay hidden; JS still runs (no throttling).
  if (process.env.SOTTO_E2E !== '1') {
    win.once('ready-to-show', () => win.showInactive());
  }
  return win;
}

function setFlowbarPosition(win, settings) {
  if (!win || win.isDestroyed()) return;
  const b = flowbarBounds(settings.flowBarDock, settings.flowBarOffset);
  win.setBounds(b);
}

// Ask HUD: a non-activating panel that pops on the ask-by-voice hotkey,
// listens, then shows/reads the answer. Never steals focus, floats over
// fullscreen apps like the flow bar.
function createAskHud() {
  const disp = screen.getPrimaryDisplay();
  const wa = disp.workArea;
  const w = 520;
  const h = 300;
  const win = new BrowserWindow({
    width: w,
    height: h,
    x: wa.x + Math.round((wa.width - w) / 2),
    y: wa.y + wa.height - h - 70,
    type: 'panel',
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver', 2);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'askhud', 'index.html'));
  return win;
}

function createOnboarding() {
  const win = new BrowserWindow({
    width: 960,
    height: 680,
    resizable: false,
    title: 'Welcome to Sotto',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 18 },
    backgroundColor: '#F4F2EC',
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'onboarding', 'index.html'));
  win.once('ready-to-show', () => win.show());
  return win;
}

module.exports = { createDashboard, createFlowbar, createOnboarding, createAskHud, setFlowbarPosition, flowbarBounds, FLOWBAR };
