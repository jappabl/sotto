// Bridge exposed to all renderer windows. Kept to a single, explicit surface.

const { contextBridge, ipcRenderer } = require('electron');

const listenChannels = [
  'flow:record-start',
  'flow:record-stop',
  'flow:record-cancel',
  'flow:done',
  'flow:error',
  'flow:command-mode',
  'data:changed',
  'ob:model-progress',
  'ob:ax-status',
  'settings:changed',
  'debug:navigate',
  'debug:flow-state',
  'debug:ob-step',
  'meeting:started',
  'meeting:ready',
  'meeting:level',
  'meeting:segment',
  'meeting:warning',
  'meeting:ended',
  'meet:enhance-progress',
  'flow:meeting-state',
  'org:changed',
  'know:retrieved',
  'know:goto-meeting',
  'flow:ask-start',
  'ask:answer',
  'debug:ask-demo',
  'debug:ask-phase',
  'notes:changed',
];

contextBridge.exposeInMainWorld('sotto', {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  on: (channel, fn) => {
    if (!listenChannels.includes(channel)) return () => {};
    const wrapped = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  sendAudio: (buffer, meta) => ipcRenderer.invoke('flow:audio', { wav: buffer, ...meta }),
});
