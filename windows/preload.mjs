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
  // boot-config: the initial cfg (size, theme) sent by the main process
  // immediately on `did-finish-load`, BEFORE the renderer creates any
  // Fly. The renderer waits for this event before addFly() so the first
  // frame already has the right scale/theme — no visible size jump.
  onBootConfig: on('boot-config'),
  sendSpikes: (list) => ipcRenderer.send('spikes', list),
  // Brain state readout (throttled to 10 Hz). The main process fans this
  // out to every brain window. Spec: brain-state-readout.
  sendState: (payload) => ipcRenderer.send('state', payload),

  // brain renderer
  onSpikes: on('spikes'),
  onState: on('state'),
  stimulate: (req) => ipcRenderer.send('stimulate', req),

  // Hebbian food-memories persistence
  loadMemories: () => ipcRenderer.invoke('memories:load'),
  saveMemories: (data) => ipcRenderer.send('memories:save', data),
  clearMemories: () => ipcRenderer.send('memories:clear'),

  // Phase B: brain-trainer lesson persistence (saves go to
  // app.getPath('userData')/lessons/<name>.json, load is read-only).
  saveLesson: (name, data) => ipcRenderer.invoke('lessons:save', { name, data }),
  loadLesson: (name) => ipcRenderer.invoke('lessons:load', name),

  // fly-neuron-activity-bars: the Brain Stats window reads its
  // config via this single invoke channel. The main process holds
  // the file path; the renderer is fully read-only here.
  brainStats: () => ipcRenderer.invoke('brain-stats:read'),

  // debug: forward renderer console to main process log
  sendLog: (level, args) => ipcRenderer.send('renderer-log', { level, args }),
});
