// preload.mjs — the only bridge between the main process and the two renderers.
// The renderers get exactly the channels they need and nothing else.

import { contextBridge, ipcRenderer } from 'electron';

const on = (channel) => (fn) => {
  ipcRenderer.on(channel, (_e, payload) => fn(payload));
};

// debug probe — overlay.html#window.__boot pings this so we get a breadcrumb
// trail in main even if the module script never finishes importing.
contextBridge.exposeInMainWorld('electronProbe', (msg) => {
  try { ipcRenderer.send('boot-probe', String(msg).slice(0, 240)); } catch (_) {}
});

contextBridge.exposeInMainWorld('flyAPI', {
  getBrainData: () => ipcRenderer.invoke('brain-data'),

  // overlay renderer
  onAmbient: on('ambient'),
  onTerrain: on('terrain'),
  onTap: on('tap'),
  onCommand: on('cmd'),
  onRetarget: on('retarget'),
  onStimulate: on('stimulate'),
  sendSpikes: (list) => ipcRenderer.send('spikes', list),

  // brain renderer
  onSpikes: on('spikes'),
  stimulate: (req) => ipcRenderer.send('stimulate', req),

  // Hebbian food-memories persistence
  loadMemories: () => ipcRenderer.invoke('memories:load'),
  saveMemories: (data) => ipcRenderer.send('memories:save', data),
  clearMemories: () => ipcRenderer.send('memories:clear'),

  // Phase B: brain-trainer lesson persistence (saves go to
  // app.getPath('userData')/lessons/<name>.json, load is read-only).
  saveLesson: (name, data) => ipcRenderer.invoke('lessons:save', { name, data }),
  loadLesson: (name) => ipcRenderer.invoke('lessons:load', name),

  // debug: forward renderer console to main process log
  sendLog: (level, args) => ipcRenderer.send('renderer-log', { level, args }),
});
