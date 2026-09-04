// main.js — DesktopFly Linux entry point.
//
// Per-monitor overlay (macOS-style): one transparent BrowserWindow per
// display, the active display's overlay is visible, others are hidden to
// save GPU memory. Tray menu hops the fly across displays.
//
// CLI flags (pre-whenReady, useful for headless rendering):
//   --snapshot=PATH       offscreen 720x720 PNG of the fly
//   --brainshot=PATH      offscreen 720x560 PNG of the brain window
//
// The GPU stack is forced onto EGL so Electron talks to the NVIDIA ICD
// directly via the Vulkan translation layer in ANGLE. On Wayland we set
// OZONE_PLATFORM_HINT=auto; the user can override via env if a non-GNOME
// compositor misbehaves.
//
// koffi is never required on Linux; OS senses (Phase 2/3) live in src/os.js
// and shell out to xprop/xdotool when on X11.

import { app, BrowserWindow, Tray, Menu, screen, ipcMain, nativeImage, powerMonitor } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, promises as fsp, unlinkSync } from 'node:fs';
import { sense } from './src/os.js';
import { loadBrainData } from './src/data.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ----- GPU / Wayland switches (must run before app.whenReady) -----
app.commandLine.appendSwitch('use-gl', 'egl');
app.commandLine.appendSwitch('enable-gpu', '1');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch(
  'enable-features',
  'UseOzonePlatform,WaylandWindowDecorations',
);
if (process.env.ELECTRON_OZONE_PLATFORM_HINT) {
  app.commandLine.appendSwitch('ozone-platform', process.env.ELECTRON_OZONE_PLATFORM_HINT);
}

// ----- CLI dispatch -----
// Must be parsed before whenReady so offscreen / non-GUI flags short-circuit
// the whole app loop.
const args = process.argv.slice(2);
function argValue(name) {
  const i = args.findIndex(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return null;
  const a = args[i];
  const eq = a.indexOf('=');
  return eq >= 0 ? a.slice(eq + 1) : (args[i + 1] ?? '');
}
const snapshotPath = argValue('snapshot');
const brainshotPath = argValue('brainshot');

// Activity knobs: CLI --key=value wins, env FLY_KEY falls back, default last.
//   walk-speed   multiplier on tempo (>=0); 1.0 = normal, 2.0 = zippy fly.
//   escape-rate  multiplier on spontaneous-takeoff probability.
//   idle-ms      milliseconds of system-idle time before the fly goes sleepy.
function numFlag(name, envName, def) {
  const cli = argValue(name);
  if (cli !== null && cli !== '') { const v = Number(cli); if (Number.isFinite(v)) return v; }
  if (envName && process.env[envName] != null) { const v = Number(process.env[envName]); if (Number.isFinite(v)) return v; }
  return def;
}
const cfgWalkSpeed  = numFlag('walk-speed',  'FLY_WALK_SPEED',  1.0);
const cfgEscapeRate = numFlag('escape-rate', 'FLY_ESCAPE_RATE', 1.0);
const cfgIdleMs     = numFlag('idle-ms',     'FLY_IDLE_MS',     90_000);

// Hebbian plasticity toggles. plasticity=on enables LTP/LTD updates on every
// sim step; the rates are the canonical erojasoficial fly-brain defaults
// (eta=1e-4 LTP, alpha=1e-7 homeostatic decay). Persisted weights are loaded
// from app.getPath('userData')/weights.json on startup if present, and saved
// every PLASTIC_SAVE_MS (or on quit).
const cfgPlasticity  = argValue('plasticity') || process.env.FLY_PLASTICITY || 'off';
const cfgPlasticEta  = numFlag('plasticity-eta',  'FLY_PLASTIC_ETA',  1e-4);
const cfgPlasticAlpha = numFlag('plasticity-alpha', 'FLY_PLASTIC_ALPHA', 1e-7);

// Phase A: fly appearance overrides. fly-theme is a name from FLY_THEMES
// (orange, cyan, magenta, yellow, green, fruitfly). fly-size is a multiplier
// on the body scale; clamped to [0.3, 5.0] in flymodel.setScale.
const cfgFlyTheme = (argValue('fly-theme') || process.env.FLY_THEME || 'orange').toLowerCase();
const cfgFlySize  = numFlag('fly-size', 'FLY_SIZE', 1.0);

// ----- Pure helpers (exported for tests) -----

/**
 * Plan one BrowserWindow per display. Each entry is a description; main()
 * turns it into a real window.
 * @param {Electron.Display[]} allDisplays
 * @param {number} activeDisplayId
 * @returns {Array<{id:number, bounds:object, hidden:boolean}>}
 */
export function planOverlays(allDisplays, activeDisplayId) {
  return allDisplays.map(d => ({
    id: d.id,
    bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height },
    hidden: d.id !== activeDisplayId,
  }));
}

/**
 * Build the tray menu. The "Send Fly to Next Display" item is hidden on
 * single-monitor hosts.
 * @param {{
 *   onMove: () => void,
 *   onTogglePause: () => void,
 *   onToggleBrain: () => void,
 *   onAddFly: () => void,
 *   onRemoveFly: () => void,
 *   onScare: () => void,
 *   onTrainer: (target: string, dir: 1 | -1) => void,
 *   onPlasticity: (action: 'enable' | 'disable' | 'reset') => void,
 *   onSpawnSugar: () => void,
 *   onSpawnNear: () => void,
 *   onSpawnPredator: () => void,
 *   onSpawnMate: () => void,
 *   onClearZones: () => void,
 *   onSetTheme: (name: string) => void,
 *   onSetSize: (size: number) => void,
 *   onToggleTrainer: () => void,
 *   onQuit: () => void,
 *   activeDisplayId: number,
 *   displayCount: number,
 *   paused: boolean,
 *   brainVisible: boolean,
 *   trainerVisible: boolean,
 *   currentTheme: string,
 *   currentSize: number,
 * }} ctx
 */
export function buildTrayMenu(ctx) {
  // Theme options — must match FLY_THEMES keys in flymodel.js.
  const themeNames = ['orange', 'fruitfly', 'cyan', 'magenta', 'yellow', 'green'];
  const sizeOptions = [0.5, 1.0, 1.5, 2.0, 3.0];
  return Menu.buildFromTemplate([
    { label: 'DesktopFly (Linux)', enabled: false },
    { type: 'separator' },
    { label: ctx.paused ? 'Resume' : 'Pause', click: ctx.onTogglePause },
    { label: ctx.brainVisible ? 'Hide Brain' : 'Show Brain', click: ctx.onToggleBrain },
    {
      label: 'Brain',
      submenu: [
        { label: ctx.trainerVisible ? 'Hide Trainer' : 'Open Trainer', click: ctx.onToggleTrainer },
      ],
    },
    {
      label: 'Send Fly to Next Display',
      visible: ctx.displayCount > 1,
      click: ctx.onMove,
    },
    { type: 'separator' },
    {
      label: 'Theme',
      submenu: themeNames.map((n) => ({
        label: n.charAt(0).toUpperCase() + n.slice(1) + (n === ctx.currentTheme ? '  ✓' : ''),
        click: () => ctx.onSetTheme(n),
      })),
    },
    {
      label: 'Size',
      submenu: sizeOptions.map((s) => ({
        label: s + 'x' + (Math.abs(s - ctx.currentSize) < 0.01 ? '  ✓' : ''),
        click: () => ctx.onSetSize(s),
      })),
    },
    { type: 'separator' },
    {
      label: 'Game',
      submenu: [
        { label: 'Spawn Sugar Zone', click: ctx.onSpawnSugar },
        { label: 'Spawn Near Fly',    click: ctx.onSpawnNear },
        { label: 'Spawn Predator',   click: ctx.onSpawnPredator },
        { label: 'Spawn Mate',       click: ctx.onSpawnMate },
        { label: 'Clear Zones',      click: ctx.onClearZones },
      ],
    },
    { type: 'separator' },
    { label: 'Add Fly', click: ctx.onAddFly },
    { label: 'Remove Fly', click: ctx.onRemoveFly },
    { label: 'Scare Flies', click: ctx.onScare },
    {
      label: 'Trainer',
      submenu: [
        { label: 'Reward walk (DNp09)',  click: () => ctx.onTrainer('walk', +1) },
        { label: 'Reward groom (DNg11)', click: () => ctx.onTrainer('groom', +1) },
        { label: 'Punish escape (GF)',   click: () => ctx.onTrainer('escape', -1) },
        { label: 'Punish backward (MDN)', click: () => ctx.onTrainer('backward', -1) },
        { type: 'separator' },
        { label: 'Enable Hebbian plasticity',
          click: () => ctx.onPlasticity('enable') },
        { label: 'Disable plasticity',  click: () => ctx.onPlasticity('disable') },
        { label: 'Reset weights',       click: () => ctx.onPlasticity('reset') },
      ],
    },
    { type: 'separator' },
    { label: 'Quit', click: ctx.onQuit },
  ]);
}

/**
 * One transparent, click-through overlay per display. macOS-style geometry.
 * @param {Electron.Display} display
 * @param {string} linuxDir
 * @param {boolean} hidden
 */
export function createOverlayWindow(display, linuxDir, hidden) {
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    transparent: true,
    frame: false,
    hasShadow: false,
    focusable: false,
    skipTaskbar: true,
    type: 'desktop',
    show: false,
    webPreferences: {
      preload: resolve(linuxDir, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,            // preload.mjs is ESM; sandbox:true strips it
    },
  });
  // The renderer assets live in windows/renderer/ — that directory is the
  // single source of truth, the linux/ tree is a thin main-process wrapper
  // around it.  linux/renderer/ is a per-machine scratchpad (overlay.html
  // there is not git-tracked), so we must NOT use resolve(linuxDir, ...).
  const rendererDir = resolve(linuxDir, '..', 'windows', 'renderer');
  win.loadFile(resolve(rendererDir, 'overlay.html'));
  // Phase A: apply the requested theme + size before the first frame paints
  // so the user never sees the default orange/1.0 flash. We send a single
  // `boot-config` payload FIRST; the renderer awaits it before addFly()
  // so the very first Fly is created with the right scale + theme (no
  // visible jump from the default FLY_SCALE to cfgFlySize on frame 1).
  // The setTheme / setSize cmds below then re-apply (idempotently) to
  // every live Fly — including any added later via the tray.
  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return;
    win.webContents.send('boot-config', { theme: cfgFlyTheme, size: cfgFlySize });
    win.webContents.send('cmd', { name: 'setTheme', theme: cfgFlyTheme });
    win.webContents.send('cmd', { name: 'setSize', size: cfgFlySize });
  });
  // Pipe renderer console so we can debug the overlay from the terminal
  // without opening DevTools. The renderer forwards all console.* through
  // the flyAPI.sendLog IPC channel and the preload exposes it.
  win.webContents.on('console-message', (_e, level, msg, line, src) => {
    const tag = ['V', 'I', 'W', 'E'][level] || '?';
    process.stderr.write(`[overlay ${tag}] ${msg}  (${src}:${line})\n`);
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    process.stderr.write(`[overlay GONE] reason=${d.reason} exitCode=${d.exitCode}\n`);
  });
  win.once('ready-to-show', () => {
    win.setIgnoreMouseEvents(true, { forward: true });
    if (!hidden) win.show();
  });
  return win;
}

// ----- App state (used by the live loop; tests do not touch this) -----
let tray = null;
const windows = new Map();   // displayId -> BrowserWindow
let brainWindow = null;      // separate 340x300 panel that shows spike flashes
let activeDisplayId = null;
let paused = false;
let brainVisible = true;
// Phase A: runtime-mutable fly appearance. Initialized from CLI/env so the
// first frame already has the right look; the tray mutates these on click.
let currentTheme = cfgFlyTheme;
let currentSize  = cfgFlySize;

/**
 * The brain panel. Same shape as windows/main.js#createBrain: 340x300, top-right
 * of the primary display, dark background, closes by hide (tray keeps the app
 * alive). On Linux we never have a parent NSPanel to mimic, so this is just a
 * normal always-on-top window with no taskbar entry.
 * @param {Electron.Display} primary
 * @param {string} linuxDir
 */
export function createBrainWindow(primary, linuxDir) {
  // The original brain window size. The bar charts and the
  // stats panel live in the trainer window (see createTrainer
  // below) so the brain window is back to the original square.
  const W = 340, H = 300;
  const win = new BrowserWindow({
    x: primary.workArea.x + primary.workArea.width - W - 18,
    y: primary.workArea.y + primary.workArea.height - H - 18,
    width: W,
    height: H,
    title: 'Fly Brain — FlyWire v783 (click = stimulate)',
    backgroundColor: '#080a10',
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: resolve(linuxDir, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setMenu(null);
  win.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); win.hide(); brainVisible = false; refreshTray(); }
  });
  win.loadFile(resolve(linuxDir, 'renderer/brain.html'));
  win.once('ready-to-show', () => { if (brainVisible) win.show(); });
  return win;
}

// Phase B: brain-trainer window — optogenetic lesson player. Same shape as
// the brain window (small, top-right, hideable) but with its own title and
// page. Uses the same preload so api.getBrainData and api.stimulate just
// work over the same IPC channels.
let trainerWindow = null;
let trainerVisible = false;
export function createTrainerWindow(primary, linuxDir) {
  const W = 540, H = 420;
  const win = new BrowserWindow({
    x: primary.workArea.x + primary.workArea.width - W - 18,
    y: primary.workArea.y + primary.workArea.height - H - 18,
    width: W,
    height: H,
    title: 'Brain Trainer — optogenetic lessons',
    backgroundColor: '#0c0f15',
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: resolve(linuxDir, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setMenu(null);
  win.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); win.hide(); trainerVisible = false; refreshTray(); }
  });
  // brain-trainer.html lives in windows/renderer/ (the symlinked source of
  // truth). Same path as the brain window uses.
  win.loadFile(resolve(linuxDir, '..', 'windows', 'renderer', 'brain-trainer.html'));
  win.once('ready-to-show', () => { if (trainerVisible) win.show(); });
  return win;
}
function toggleTrainer() {
  if (!trainerWindow || trainerWindow.isDestroyed()) {
    trainerWindow = createTrainerWindow(screen.getPrimaryDisplay(), __dirname);
    trainerVisible = true;
    trainerWindow.once('ready-to-show', () => trainerWindow.show());
  } else if (trainerWindow.isVisible()) {
    trainerWindow.hide(); trainerVisible = false;
  } else {
    trainerWindow.show();   trainerVisible = true;
  }
  refreshTray();
}

// ----- IPC bridge: the renderer (windows/renderer/overlay.js, symlinked)
// expects 8 channels. Without them, its async IIFE rejects on
// `api.getBrainData()` and the scene stays empty (white PNG).
let brainData = null;       // FlyWire data; null on disk-miss → legacy fly
const idleSinceMs = () => powerMonitor.getSystemIdleTime() * 1000;

// Each overlay is a per-monitor BrowserWindow whose render scene is centered
// on that monitor. To get the cursor into the same scene space, subtract the
// monitor center and flip Y (overlay.js uses +Y up). Done per window so the
// active display's render sees its own coords and inactive displays still
// get a value (their fly is hidden but the math stays consistent if shown).
function cursorInScene(windowBounds) {
  const c = screen.getCursorScreenPoint();
  return {
    x: c.x - (windowBounds.x + windowBounds.width / 2),
    y: (windowBounds.y + windowBounds.height / 2) - c.y,
  };
}

function pushAmbientToAll() {
  // The renderer uses ambient for: mouse pos, typing-level, sleep, tempo, activity.
  // Linux gives us system-idle time; we proxy it as typingLevel=0, sleepy=after idleMs.
  const idle = idleSinceMs();
  const sleepy = idle > cfgIdleMs;
  // Window-level fields that don't depend on the per-display transform.
  const baseFields = {
    typing: 0,                        // TODO: hook xkb / libinput key events
    sleepy,
    // tempo carries the user-controllable activity multiplier (default 1.0);
    // escapeRate multiplies the spontaneous-takeoff probability in renderer.
    tempo: cfgWalkSpeed,
    activity: 1.0,
    escapeRateMul: cfgEscapeRate,
    idleMs: cfgIdleMs,
  };
  for (const [id, win] of windows) {
    if (win.isDestroyed()) continue;
    const ambient = { ...baseFields, mouse: cursorInScene(win.getBounds()) };
    win.webContents.send('ambient', ambient);
  }
}
setInterval(pushAmbientToAll, 500);

function pushRetargetToAll() {
  // The renderer uses retarget to size the ortho camera to *its own* display
  // and to know screen rectangles (for fly initial placement). Sending a
  // single primary.bounds size to every per-monitor overlay made the canvas
  // the wrong shape on every non-primary display — squashed, off-centre, or
  // stretched — and on a one-monitor box it just happened to look right
  // because primary was the only one. Each window now gets its own bounds.
  const allDisplays = screen.getAllDisplays();
  const screens = allDisplays.map(d => ({
    id: d.id,
    x0: d.bounds.x, y0: d.bounds.y,
    x1: d.bounds.x + d.bounds.width,
    y1: d.bounds.y + d.bounds.height,
  }));
  for (const [id, win] of windows) {
    if (win.isDestroyed()) continue;
    const b = win.getBounds();
    win.webContents.send('retarget', { width: b.width, height: b.height, screens });
  }
}

ipcMain.handle('brain-data', () => brainData);
// Overlay renderer pushes spike events on 'spikes'; we fan them out to the
// brain panel which subscribes via preload.mjs#onSpikes. Same wire as Windows.
ipcMain.on('spikes', (_e, list) => {
  if (brainWindow && !brainWindow.isDestroyed() && list && list.length) {
    brainWindow.webContents.send('spikes', list);
  }
});
// Brain state readout (throttled to 10 Hz by the renderer). The brain
// window subscribes via preload.mjs#onState and renders the line.
// Spec: brain-state-readout.
ipcMain.on('state', (_e, payload) => {
  if (brainWindow && !brainWindow.isDestroyed() && payload) {
    brainWindow.webContents.send('state', payload);
  }
});
// Brain window's click-to-stimulate -> forward to the overlay (the only one
// with the sim) so the user gets the same effect as Windows.
ipcMain.on('stimulate', (_e, req) => {
  for (const w of windows.values()) {
    if (!w.isDestroyed()) w.webContents.send('stimulate', req);
  }
});

// Hebbian food-memories persistence. userData on Linux lives under
// ~/.config/<appname>/ so a `rm -rf ~/.config/desktop-fly` is the
// nuclear option. (fs/path imports are at the top of the file with
// the rest — ESM forbids redeclaration.)
const memoriesFile = () => join(app.getPath('userData'), 'food-memories.json');
// Phase B: per-lesson JSON files under userData/lessons/<name>.json.
// Same pattern as memoriesFile but per-lesson instead of one big blob.
const lessonsDir  = () => join(app.getPath('userData'), 'lessons');
const lessonFile  = (name) => join(lessonsDir(), `${name}.json`);

ipcMain.handle('memories:load', async () => {
  try { return JSON.parse(await fsp.readFile(memoriesFile(), 'utf8')); }
  catch { return null; }
});
ipcMain.on('memories:save', async (_e, payload) => {
  if (!payload || !Array.isArray(payload.weights)) return;
  try {
    await fsp.writeFile(memoriesFile(), JSON.stringify({
      version: 1, savedAt: new Date().toISOString(),
      weights: payload.weights, edgesTouched: payload.edgesTouched ?? 0,
    }));
  } catch (err) { console.warn('memories:save failed:', err); }
});
ipcMain.on('memories:clear', () => {
  try { if (existsSync(memoriesFile())) unlinkSync(memoriesFile()); }
  catch (err) { console.warn('memories:clear failed:', err); }
});

// Phase B: brain-trainer lesson save/load. Returns the saved file path
// string on success, null on failure (the renderer surfaces it in the log).
ipcMain.handle('lessons:save', async (_e, { name, data }) => {
  if (typeof name !== 'string' || !name) return null;
  if (typeof data !== 'string') return null;
  // basic safety: only [a-z0-9._-], prevent path traversal
  if (!/^[a-z0-9._-]+$/i.test(name)) return null;
  try {
    await fsp.mkdir(lessonsDir(), { recursive: true });
    await fsp.writeFile(lessonFile(name), data, 'utf8');
    return lessonFile(name);
  } catch (err) { console.warn('lessons:save failed:', err); return null; }
});

ipcMain.handle('lessons:load', async (_e, name) => {
  if (typeof name !== 'string' || !name) return null;
  if (!/^[a-z0-9._-]+$/i.test(name)) return null;
  try { return await fsp.readFile(lessonFile(name), 'utf8'); }
  catch { return null; }
});

// Forward every renderer console.{log,info,warn,error} to main stderr.
// Used to debug the overlay without opening DevTools (X11+electron: DevTools
// is a manual step we don't want to ask the user to repeat).
ipcMain.on('renderer-log', (_e, { level, args }) => {
  try {
    const text = (args || []).map(a => {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch (_) { return String(a); }
    }).join(' ');
    process.stderr.write(`[renderer ${level}] ${text}\n`);
  } catch (err) {
    process.stderr.write(`[renderer log-forward fail] ${err.message}\n`);
  }
});

// Boot probe: overlay.html/overlay.js ping this at every key checkpoint so
// we get a breadcrumb trail even when console-message is silent.
ipcMain.on('boot-probe', (_e, msg) => {
  process.stderr.write(`[boot] ${msg}\n`);
});

async function run() {
  // Snapshot / brainshot short-circuit before we touch Tray or BrowserWindow.
  if (snapshotPath) return runSnapshot(snapshotPath);
  if (brainshotPath) return runBrainshot(brainshotPath);

  // Try to load the FlyWire data. On miss we fall through and the renderer
  // uses legacy distance-based behavior.
  try { brainData = loadBrainData(); } catch (e) {
    console.warn('[desktop-fly] no data/ found; running without brain:', e.message);
  }

  const allDisplays = screen.getAllDisplays();
  activeDisplayId = screen.getPrimaryDisplay().id;

  for (const d of allDisplays) {
    windows.set(d.id, createOverlayWindow(d, __dirname, d.id !== activeDisplayId));
  }

  // Brain panel mirrors the macOS/Windows one: a 340x300 dark window in the
  // bottom-right of the primary display. Only created when data was found —
  // without a brain there's nothing to render in there.
  if (brainData) brainWindow = createBrainWindow(screen.getPrimaryDisplay(), __dirname);

  // Send the display layout to every overlay so the ortho camera sizes right
  // and `addFly()` picks a starting point on a real monitor.
  pushRetargetToAll();
  screen.on('display-added', pushRetargetToAll);
  screen.on('display-removed', pushRetargetToAll);
  screen.on('display-metrics-changed', pushRetargetToAll);

  tray = new Tray(resolve(__dirname, 'assets/tray.png'));
  refreshTray();

  ipcMain.on('fly-moved-off-screen', () => moveToNextDisplay());

  // 0.7 Hz window terrain poll — same cadence as the Windows port.
  setInterval(async () => {
    try {
      const display = screen.getDisplayMatching(activeWindowBounds());
      const r = await sense.poll({
        x: display.bounds.x, y: display.bounds.y,
        width: display.bounds.width, height: display.bounds.height,
      });
      for (const win of windows.values()) {
        win.webContents.send('terrain', r);
      }
    } catch (e) {
      // sense.poll is best-effort; don't crash on transient errors.
    }
  }, 700);
}

function activeWindowBounds() {
  const allDisplays = screen.getAllDisplays();
  const d = allDisplays.find(x => x.id === activeDisplayId) ?? allDisplays[0];
  return d.bounds;
}

// Send a single command to every overlay window. The renderer's onCommand
// (preload.mjs#onCommand) handles the named actions — see windows/renderer/overlay.js.
function broadcastCmd(payload) {
  for (const w of windows.values()) {
    if (!w.isDestroyed()) w.webContents.send('cmd', payload);
  }
}

function togglePause() {
  paused = !paused;
  broadcastCmd({ name: 'pause', value: paused });
  refreshTray();
}

function toggleBrain() {
  brainVisible = !brainVisible;
  if (brainWindow && !brainWindow.isDestroyed()) {
    if (brainVisible) brainWindow.show(); else brainWindow.hide();
  }
  refreshTray();
}

function refreshTray() {
  if (!tray) return;
  const allDisplays = screen.getAllDisplays();
  tray.setContextMenu(buildTrayMenu({
    onMove: moveToNextDisplay,
    onTogglePause: togglePause,
    onToggleBrain: toggleBrain,
    onAddFly: () => broadcastCmd({ name: 'addFly' }),
    onRemoveFly: () => broadcastCmd({ name: 'removeFly' }),
    onScare: () => broadcastCmd({ name: 'scareAll' }),
    onTrainer: (target, dir) => broadcastCmd({ name: dir > 0 ? 'reward' : 'punish', target }),
    onPlasticity: (action) => {
      if (action === 'enable') {
        broadcastCmd({ name: 'enablePlasticity', eta: cfgPlasticEta, alpha: cfgPlasticAlpha });
      } else if (action === 'disable') {
        broadcastCmd({ name: 'disablePlasticity' });
      } else if (action === 'reset') {
        broadcastCmd({ name: 'resetTraining' });
      }
    },
    onSpawnSugar: () => broadcastCmd({ name: 'spawnSugar' }),
    onSpawnNear: () => broadcastCmd({ name: 'spawnNear' }),
    onSpawnPredator: () => broadcastCmd({ name: 'spawnPredator' }),
    onSpawnMate: () => broadcastCmd({ name: 'spawnMate' }),
    onClearZones: () => broadcastCmd({ name: 'clearZones' }),
    onSetTheme: (name) => {
      currentTheme = name;
      broadcastCmd({ name: 'setTheme', theme: name });
      refreshTray();
    },
    onSetSize: (size) => {
      currentSize = size;
      broadcastCmd({ name: 'setSize', size });
      refreshTray();
    },
    onToggleTrainer: toggleTrainer,
    onQuit: () => { app.isQuitting = true; app.quit(); },
    activeDisplayId,
    displayCount: allDisplays.length,
    paused,
    brainVisible,
    trainerVisible,
    currentTheme,
    currentSize,
  }));
}

function moveToNextDisplay() {
  const allDisplays = screen.getAllDisplays();
  if (allDisplays.length < 2) return;
  const idx = allDisplays.findIndex(d => d.id === activeDisplayId);
  const next = allDisplays[(idx + 1) % allDisplays.length];
  // Hide previous active, show new.
  windows.get(activeDisplayId)?.hide();
  windows.get(next.id)?.show();
  activeDisplayId = next.id;
  // 1) Per-monitor overlay geometry: the visible window's renderer re-anchors
  //    its camera to the new display bounds.
  for (const [id, win] of windows) {
    win.webContents.send('set-active-display', {
      id: next.id,
      bounds: next.bounds,
    });
  }
  // 2) Standard "flyToNextDisplay" cmd so the renderer's onCommand handler
  //    starts a flight to the next monitor (same wire as Windows).
  broadcastCmd({ name: 'flyToNextDisplay' });
  refreshTray();
}

// ----- Snapshot / brainshot paths (Phase 5) -----
// These are CLI-only and create a hidden offscreen window, render one
// frame, and write a PNG via capturePage().

async function runSnapshot(outPath) {
  const win = new BrowserWindow({
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      preload: resolve(__dirname, 'preload.mjs'),
      sandbox: false,
    },
    width: 720, height: 720,
  });
  // Pipe renderer console so we see the IIFE failure path.
  win.webContents.on('console-message', (_e, level, msg) => {
    console.log(`[renderer] ${msg}`);
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    console.error('[renderer] gone:', d);
  });
  // Register brain-data so addFly() can resolve. (handler is global, only
  // set on first snapshot; this branch is fine for repeated runs.)
  if (!brainData) {
    try { brainData = loadBrainData(); } catch (e) {
      console.warn('[desktop-fly] no data/ for snapshot:', e.message);
    }
  }
  await win.loadFile(resolve(__dirname, '..', 'windows', 'renderer', 'overlay.html'));
  // Send a retarget with the window size so the ortho camera fits.
  win.webContents.send('retarget', {
    width: 720, height: 720,
    screens: [{ id: 0, x0: 0, y0: 0, x1: 720, y1: 720 }],
  });
  // boot-config unblocks the overlay's addFly() gate (see
  // overlay.js — addFly is deferred until this event arrives, so the
  // first Fly is built with the right scale + theme, no jump on
  // frame 1). Snapshot path must send it too — otherwise the renderer
  // waits forever and the snapshot is a blank canvas.
  win.webContents.send('boot-config', { theme: cfgFlyTheme, size: cfgFlySize });
  // Phase A: re-apply (idempotently) via the same cmd channel the
  // interactive path uses, so any future flies added by `addFly` tray
  // calls during a long-running session pick up the same look. 800 ms
  // sleep below gives the renderer time to consume these and to run
  // a few sim steps before we capture.
  win.webContents.send('cmd', { name: 'setTheme', theme: cfgFlyTheme });
  win.webContents.send('cmd', { name: 'setSize', size: cfgFlySize });
  // Wait for the renderer's first paint AND give addFly() a few frames to land.
  await new Promise(r => setTimeout(r, 800));
  const img = await win.webContents.capturePage();
  await savePng(img, outPath);
  win.close();
  console.log(`snapshot written to ${outPath}`);
}

async function runBrainshot(outPath) {
  const win = new BrowserWindow({
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      preload: resolve(__dirname, 'preload.mjs'),
      sandbox: false,
    },
    width: 720, height: 560,
  });
  await win.loadFile(resolve(__dirname, 'renderer/brain.html'));
  await new Promise(r => win.webContents.once('paint', r));
  const img = await win.webContents.capturePage();
  await savePng(img, outPath);
  win.close();
  console.log(`brainshot written to ${outPath}`);
}

async function savePng(img, path) {
  // Electron's nativeImage has no fs write helper; write through Buffer.
  const buf = img.toPNG();
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, buf);
}

// ----- Boot -----
if (typeof app.whenReady === 'function') {
  app.whenReady().then(() => {
    run().catch(e => {
      console.error('[desktop-fly] fatal:', e);
      app.exit(1);
    });
  });
}
