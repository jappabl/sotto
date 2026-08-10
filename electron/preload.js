// Bridge exposed to all renderer windows. Kept to a single, explicit surface.

const { contextBridge, ipcRenderer } = require('electron');

const listenChannels = [
  'flow:record-start',
  'flow:record-stop',
  'flow:record-cancel',
  'flow:done',
  'flow:error',
  'data:changed',
  'ob:model-progress',
  'ob:ax-status',
  'settings:changed',
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
