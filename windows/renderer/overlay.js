// overlay.js — the desktop overlay renderer: buildScene() plus Coordinator
// from main.swift. This is where the brain runs; the main process only feeds
// it senses and tray commands.

// relative rather than bare so the same module resolves in Node (tests)
// and in the renderer without an inline importmap
import * as THREE from '../node_modules/three/build/three.module.js';
import { LIFSim, SpikeBus } from '../src/sim.js';
import { SignalBuilder } from '../src/signals.js';
import { Fly, SHADOWS_ENABLED, setEscapeRateMul, setTheme, setScale } from '../src/flymodel.js';
import { zoneAttract, PREDATOR_RANGE_PT } from '../src/attract.js';
import { pickZoneTarget, stepZoneMotion as stepZone, predatorStep, mateStep, sugarStep } from '../src/zone-motion.js';
import { clampf, rnd, lag } from '../src/util.js';

const api = window.flyAPI;

// Forward every console message to the main process so we can debug the
// overlay from the terminal without opening DevTools. The preload exposes
// `sendLog` over IPC; if it's missing (e.g. older binary) the calls no-op.
if (api && api.sendLog) {
  for (const level of ['log', 'info', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      try {
        const safe = (args || []).map(a => {
          if (a instanceof Error) return a.message + (a.stack ? '\n' + a.stack : '');
          if (typeof a === 'object') { try { return JSON.stringify(a); } catch (_) { return String(a); } }
          return a;
        });
        api.sendLog(level, safe);
      } catch (_) { /* no-op */ }
      orig(...args);
    };
  }
}

let bounds = { width: window.innerWidth, height: window.innerHeight };

// ---- scene ----

const scene = new THREE.Scene();

const camera = new THREE.OrthographicCamera(
  -bounds.width / 2, bounds.width / 2, bounds.height / 2, -bounds.height / 2, 1, 600);
camera.position.set(0, 0, 300);

// SCNLight .directional with eulerAngles(-0.35, 0.30, 0): the light shines
// along that node's -Z axis, so three.js gets the light placed on the opposite
// side, aiming at the origin.
// SceneKit used 1000 lm key / 550 lm ambient; three.js light units differ,
// so these are the equivalents that keep highlights from clipping to white.
const key = new THREE.DirectionalLight(0xffffff, 1.5);
key.position.set(0.2955 * 900, 0.3276 * 900, 0.8974 * 900);
key.target.position.set(0, 0, 0);
scene.add(key.target);
if (SHADOWS_ENABLED) {
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.radius = 3;
  key.shadow.bias = -0.0008;
}
scene.add(key);

const ambient = new THREE.AmbientLight(0xffffff, 0.82);
scene.add(ambient);

// invisible catcher plane: writes only the shadow, exactly like the SceneKit
// plane with an empty colorBufferWriteMask
let shadowPlane = null;
if (SHADOWS_ENABLED) {
  shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
    new THREE.ShadowMaterial({ opacity: 0.30 }));
  shadowPlane.position.z = -0.6;
  shadowPlane.receiveShadow = true;
  scene.add(shadowPlane);
}

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(bounds.width, bounds.height);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
if (SHADOWS_ENABLED) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}
document.body.appendChild(renderer.domElement);

function fitShadowCamera() {
  const c = key.shadow.camera;
  const m = 260;
  c.left = -bounds.width / 2 - m; c.right = bounds.width / 2 + m;
  c.top = bounds.height / 2 + m; c.bottom = -bounds.height / 2 - m;
  c.near = 1; c.far = 2200;
  c.updateProjectionMatrix();
}
fitShadowCamera();

// ---- coordinator ----

const flies = [];
let sim = null;
let spikeBus = null;
const signalBuilder = new SignalBuilder();

// Sugar zones and pheromone-bearing mate sprites. The renderer owns the
// state; the sim is unaware of them — it just receives scaled-up sensory
// drive via sim.airPuff and reward stimulations on reach. Each zone also
// has a three.js Mesh in `mesh` so we don't look it up by id per frame.
const zones = [];
let zoneIdSeq = 1;
// Per-session dedup set for the contact log. Keyed by
// `${zoneId}:${flyIndex}` so re-entering the same zone does not spam
// the console. Cleared by clearZones() so a fresh wave of zones
// produces a fresh round of contact logs.
// Spec: fly-zone-contact-debug "First contact per zone per fly is logged".
const zoneContactLogged = new Set();
const THREE_ns = THREE;   // alias for the closure below

let lastTime = null;
let paused = false;
let mouseScene = null;
let prevMouse = null;
const mouseVel = { x: 0, y: 0 };
const mouseVelRaw = { x: 0, y: 0 };   // last measurement, held between samples
let mouseSampleDt = 0;                // real time since that measurement
let loomOverride = 0;
let msAccumulator = 0;

let terrain = [];
let screens = null;             // scene-space rects of the real monitors
let knownWindowIds = null;      // null until the first poll, like WindowSense.first
let typingLevel = 0;
let sleepy = false;
let tempo = 1;
let plasticEnabled = false;    // mirrors sim state for the save timer
let lastSaveMs = 0;            // performance.now() of last Hebbian snapshot
const SAVE_INTERVAL_MS = 30000;
// Brain state readout throttle. Spec: brain-state-readout "Update cadence"
// caps the readout at 10 Hz so the DOM doesn't churn at 60 fps.
let lastStateMs = 0;
const STATE_MIN_INTERVAL_MS = 100;
let activity = 1;
let windowLoomL = 0;
let windowLoomR = 0;

function addFly() {
  const hw = bounds.width / 2 - 100, hh = bounds.height / 2 - 100;
  let p = { x: rnd(-hw, hw), y: rnd(-hh, hh) };
  for (let k = 0; k < 24 && screens && !onAnyScreen(p.x, p.y, 60); k++) {
    p = { x: rnd(-hw, hw), y: rnd(-hh, hh) };
  }
  const fly = new Fly(p);
  fly.screens = screens;
  scene.add(fly.node);
  flies.push(fly);
  console.info(`[fly] addFly pos=(${p.x.toFixed(0)}, ${p.y.toFixed(0)})`
    + ` bounds=${bounds.width}x${bounds.height}`
    + ` screens=${screens ? screens.length : 0}`
    + ` scene.children=${scene.children.length}`);
}

function onAnyScreen(x, y, inset = 0) {
  if (!screens || !screens.length) return true;
  return screens.some((s) => x > s.x0 + inset && x < s.x1 - inset
    && y > s.y0 + inset && y < s.y1 - inset);
}

// Tray-driven stimulation of a named population: the same electrode the brain
// window's click applies, with the strengths and durations the behavior test
// uses, so "Groom" here and a click on DNg11 there do the identical thing.
const STIM_GROUPS = {
  groom: ['groom', 0.25, 600],
  walk: ['fwd', 0.25, 1200],
  backward: ['mdn', 0.3, 600],
  escape: ['gf', 0.5, 40],
  wings: ['escw', 0.3, 600],
  tap: ['sens', 0.45, 150],
  steerLeft: ['dnaL', 0.3, 900],
  steerRight: ['dnaR', 0.3, 900],
};

function stimulateGroup(name) {
  if (!sim) return;
  const spec = STIM_GROUPS[name];
  if (!spec) return;
  const [field, strength, durationMs] = spec;
  sim.stimulate(sim[field], strength, durationMs);
}

// Trainer: positive direction = stimulate the named population, negative =
// silence it. Both use sim.stimulate/silence with fixed, short parameters
// so each click is a single operant-conditioning pulse, not a sustained
// effect. The "weight" of a single click is small on purpose; long-term
// learning happens through Hebbian plasticity over many paired events.
const TRAINER_GROUPS = {
  walk: 'fwd',       // DNp09 — reward walking
  groom: 'groom',    // DNg11 — reward grooming
  escape: 'gf',      // DNp01 — punish spontaneous escape
  backward: 'mdn',   // MDN   — punish backward walk
  wings: 'escw',     // wing DNs
};
function trainerAction(name, dir) {
  if (!sim) return;
  const field = TRAINER_GROUPS[name];
  if (!field || !sim[field] || !sim[field].length) return;
  if (dir > 0) sim.stimulate(sim[field], 0.4, 80);
  else sim.silence(sim[field], 250);
}

// tray command: nudge the fly across to another monitor
function flyToNextDisplay() {
  const fly = flies[0];
  if (!fly || !screens || screens.length < 2) return;
  const here = screens.findIndex((s) => fly.pos.x > s.x0 && fly.pos.x < s.x1
    && fly.pos.y > s.y0 && fly.pos.y < s.y1);
  const next = screens[(Math.max(0, here) + 1) % screens.length];
  fly.startFlight(bounds, {
    target: {
      x: rnd(next.x0 + 120, next.x1 - 120),
      y: rnd(next.y0 + 120, next.y1 - 120),
    },
  });
}

function removeFly() {
  if (flies.length <= 1) return;          // fly #1 carries the brain
  const fly = flies.pop();
  scene.remove(fly.node);
}

function scareAll() {
  loomOverride = 0.6;                     // real stimulus into the real circuit for fly #1
  for (const fly of flies.slice(1)) {
    if (fly.state !== 'flying') fly.startFlight(bounds);
  }
}

// a window appeared near the fly: a real looming object
function injectWindowLoom(strength, p) {
  const fly = flies[0];
  if (!fly) return;
  const rel = { x: p.x - fly.pos.x, y: p.y - fly.pos.y };
  const dist = Math.max(1, Math.hypot(rel.x, rel.y));
  const f = { x: Math.cos(fly.heading), y: Math.sin(fly.heading) };
  const crossZ = (f.x * rel.y - f.y * rel.x) / dist;
  windowLoomL = Math.max(windowLoomL, strength * clampf(0.5 + 0.5 * crossZ, 0.12, 1));
  windowLoomR = Math.max(windowLoomR, strength * clampf(0.5 - 0.5 * crossZ, 0.12, 1));
}

// a global mouse click: a tap on the fly's substrate -> sensory pathway
function injectTap(p) {
  const fly = flies[0];
  if (!sim || !fly) return;
  const d = Math.hypot(p.x - fly.pos.x, p.y - fly.pos.y);
  const strength = clampf(1 - d / 520, 0, 1);
  if (strength > 0.05) sim.stimulate(sim.sens, 0.15 + strength * 0.35, 130);
}

// ---- food / mate (game) zones ----
// Sugar: a yellow circle on the desktop; reach = eat. Reward stimulates
// forward-walk + groom (proboscis-extension surrogate), the zone
// disappears, and Hebbian LTP grows the sens -> fwd / sens -> groom edges
// that delivered the success.
//
// Mate: a slowly-moving soft glow; never consumed, just a pheromone
// gradient. Close approach (60 pt) fires wing-extension stimulation as a
// courtship surrogate.
// Per-kind motion defaults. The repick loop in stepZoneMotion reads
// `chaseProb` to decide whether the next target is "near the fly"
// (heading toward it) or "uniform on the display" (wandering off).
// Spec: fly-zone-wander.
const ZONE_KINDS = {
  sugar:    { speed: 30, chaseProb: 0.15, color: 0xffd23f, glow: false, segments: 32, opacity: 0.65 },
  mate:     { speed: 20, chaseProb: 0.25, color: 0xff7ad9, glow: true,  segments: 24, opacity: 0.95 },
  predator: { speed: 50, chaseProb: 0.40, color: 0xb8232c, glow: false, segments: 8,  opacity: 0.75 },
};

function spawnZone(kind, x, y) {
  const k = ZONE_KINDS[kind];
  const z = {
    id: zoneIdSeq++, kind, x, y, r: kind === 'sugar' ? 28 : kind === 'mate' ? 90 : 50,
    speed: k.speed, chaseProb: k.chaseProb,
    target: { x, y },
    nextHopMs: performance.now() + 4000 + Math.random() * 6000,
    mesh: null, glow: null, born: performance.now(),
  };
  if (k.glow) {
    z.glow = new THREE.Mesh(
      new THREE.CircleGeometry(z.r, 48),
      new THREE.MeshBasicMaterial({ color: k.color, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
  }
  z.mesh = new THREE.Mesh(
    new THREE.CircleGeometry(z.r, k.segments),
    new THREE.MeshBasicMaterial({ color: k.color, transparent: true, opacity: k.opacity, depthWrite: false }),
  );
  z.mesh.position.set(x, y, kind === 'sugar' ? 0.4 : kind === 'mate' ? 0.5 : 0.45);
  if (z.glow) z.glow.position.set(x, y, 0.3);
  scene.add(z.mesh);
  if (z.glow) scene.add(z.glow);
  zones.push(z);
  return z.id;
}

function spawnSugar(x, y)    { return spawnZone('sugar',    x, y); }
function spawnMate(x, y)     { return spawnZone('mate',     x, y); }
function spawnPredator(x, y) { return spawnZone('predator', x, y); }

function clearZones() {
  for (const z of zones) {
    if (z.mesh) scene.remove(z.mesh);
    if (z.glow) scene.remove(z.glow);
  }
  zones.length = 0;
  zoneContactLogged.clear();
}

// stepZoneMotion: per-frame dispatch. Each zone kind has its own
// state machine: predator ambush/sprint, mate orbit, sugar tease/flee.
// Spec: fly-zone-per-kind-motion.
function stepZoneMotion(z, dt, fly) {
  if (z.kind === 'predator')      predatorStep(z, dt, fly, bounds);
  else if (z.kind === 'mate')      mateStep(z, dt, fly, bounds);
  else if (z.kind === 'sugar')     sugarStep(z, dt, fly, bounds);
  else                            stepZone(z, dt, bounds);
}

function drawZones(t, dt, fly) {
  for (const z of zones) {
    stepZoneMotion(z, dt, fly);
    // Push the zone's logical position to the mesh every frame —
    // sugar and predator used to only set their mesh position at
    // spawn time, which made them appear stuck even though the
    // stepZoneMotion was updating z.x/z.y correctly. Spec:
    // fly-zone-wander "Every zone has a target and a repick loop".
    const zPos = (z.kind === 'sugar')    ? 0.4
               : (z.kind === 'mate')     ? 0.5
               :                            0.45;
    z.mesh.position.set(z.x, z.y, zPos);
    if (z.glow) z.glow.position.set(z.x, z.y, 0.3);
    if (z.kind === 'sugar') {
      // gentle pulse to draw the eye
      const s = 1 + 0.08 * Math.sin(t * 2.5 + z.id);
      z.mesh.scale.set(s, s, 1);
    } else if (z.kind === 'mate') {
      const s = 1 + 0.15 * Math.sin(t * 4 + z.id);
      z.glow.scale.set(s, s, 1);
    } else if (z.kind === 'predator') {
      // menacing pulse: 6..10 Hz with a sharp attack
      const s = 1 + 0.18 * (0.5 + 0.5 * Math.sin(t * 6 + z.id));
      z.mesh.scale.set(s, s, 1);
      z.mesh.material.opacity = 0.55 + 0.20 * (0.5 + 0.5 * Math.sin(t * 8 + z.id));
    }
  }
  // Self-despawning zones (sugar after its `flee` phase) request
  // removal via `z.removeRequested = true`. Walk the array once at
  // the end of the frame and dispose the matching meshes. The
  // contact log already fired while the zone was in `tease`.
  for (let i = zones.length - 1; i >= 0; i--) {
    if (zones[i].removeRequested) {
      const z = zones[i];
      if (z.mesh) scene.remove(z.mesh);
      if (z.glow) scene.remove(z.glow);
      zones.splice(i, 1);
    }
  }
}

function checkReaches(fly) {
  if (!sim) return;
  if (!zones.length) return;
  const out = zoneAttract(fly, zones);
  // Satiety gate: a full or near-full fly ignores sugar (sugarLevel
  // >= SUGAR_THRESHOLD multiplier on foodAttract). We implement this
  // here rather than in attract.js because the gate is a renderer-only
  // contract (sim has no idea about hunger).
  // Spec: fly-satiety "Satiety gates food attraction".
  if (fly.sugarLevel < 0.2) {
    out.foodAttract = 0;
  }
  // Sugar reach: pump fwd + groom, remove the zone, restore hunger.
  if (out.foodReached !== null) {
    const i = zones.findIndex((z) => z.id === out.foodReached);
    if (i >= 0) {
      const z = zones[i];
      const flyIdx = flies.indexOf(fly);
      const key = `${z.id}:${flyIdx}`;
      if (!zoneContactLogged.has(key)) {
        zoneContactLogged.add(key);
        const d = Math.hypot(z.x - fly.pos.x, z.y - fly.pos.y);
        console.info(`[zone] sugar reach id=${z.id} fly=#${flyIdx} d=${d.toFixed(0)} bias=${out.foodAttract.toFixed(3)}`);
      }
      if (z.mesh) scene.remove(z.mesh);
      if (z.glow) scene.remove(z.glow);
      zones.splice(i, 1);
      // Reward: forward-walk command (DNp09) + proboscis extension (DNg11).
      // Single brief stimulation — operant-conditioning pulse, not a sustained drive.
      sim.stimulate(sim.fwd, 0.5, 300);
      sim.stimulate(sim.groom, 0.3, 200);
      // Satiety: restore hunger (clamped to 1) and raise the eat transient.
      fly.eatSugar();
      // Animate: brief wing raise (proboscis extension surrogate via groom).
      fly.wingRaise = Math.min(1, fly.wingRaise + 0.7);
    }
  }
  // Mate close approach: fire wing extension (DNp02/04/11) + courting
  // transient for the brain state line.
  if (out.mateClose) {
    const flyIdx = flies.indexOf(fly);
    for (const z of zones) {
      if (z.kind !== 'mate') continue;
      const d = Math.hypot(z.x - fly.pos.x, z.y - fly.pos.y);
      if (d >= 60) continue;          // out of close-approach range
      const key = `${z.id}:${flyIdx}`;
      if (!zoneContactLogged.has(key)) {
        zoneContactLogged.add(key);
        console.info(`[zone] mate close id=${z.id} fly=#${flyIdx} d=${d.toFixed(0)} bias=${out.mateAttract.toFixed(3)}`);
      }
    }
    sim.stimulate(sim.escw, 0.35, 600);
    fly.wingRaise = Math.min(1, fly.wingRaise + 0.4);
    fly.onMateClose();
  }
  // Predator proximity: feed the closest distance to the fly for the
  // teach-signal computation, and apply the speed boost. The flymodel
  // itself does not own the zone list, so the renderer is the natural
  // place to find the closest predator. The teach signal is forwarded
  // to the sim so plasticity can apply sens->gf LTD.
  // Spec: fly-predator-zones "Predator proximity boosts flight speed" +
  // "Predator exposure teaches escape".
  // Per-kind nearest-zone distance. Used by the brain window's state
  // line to show "pred Npt · sgr Npt · mate Npt" so the user can
  // attribute which influence is currently acting on the fly. We
  // report `null` when no zone of that kind exists.
  let nearestPredatorD = null;
  let nearestSugarD    = null;
  let nearestMateD     = null;
  let nearestD = Infinity;
  let nearestPredator = null;
  for (const z of zones) {
    const d = Math.hypot(z.x - fly.pos.x, z.y - fly.pos.y);
    if (z.kind === 'predator') {
      if (nearestPredatorD === null || d < nearestPredatorD) nearestPredatorD = d;
      if (d < nearestD) { nearestD = d; nearestPredator = z; }
    } else if (z.kind === 'sugar') {
      if (nearestSugarD === null || d < nearestSugarD) nearestSugarD = d;
    } else if (z.kind === 'mate') {
      if (nearestMateD === null || d < nearestMateD) nearestMateD = d;
    }
  }
  if (nearestPredator && nearestD < PREDATOR_RANGE_PT) {
    const flyIdx = flies.indexOf(fly);
    const key = `${nearestPredator.id}:${flyIdx}`;
    if (!zoneContactLogged.has(key)) {
      zoneContactLogged.add(key);
      console.info(`[zone] predator loom id=${nearestPredator.id} fly=#${flyIdx} d=${nearestD.toFixed(0)} bias=${out.predatorAttract.toFixed(3)}`);
    }
    // Escape reflex: a nearby predator drives the giant fiber
    // (DNp01) every frame the fly is within the close-approach
    // range (< 300 pt). The previous version rate-limited the
    // stim via zoneContactLogged, which meant a second predator
    // (or a predator re-spawned after the user closed the
    // trainer) would never re-arm the escape reflex. sim.stimulate
    // is already internally rate-limited (max 8 pendingStims)
    // so re-firing every frame is safe — the GF current
    // saturates and the gfLatch fires reliably. The 80ms stim
    // duration overlaps the next per-frame stim, so the fly
    // gets a continuous giant-fiber drive for as long as the
    // predator is close.
    if (sim && sim.gf && nearestD < 300) {
      sim.stimulate(sim.gf, 0.6, 80);
    }
  }
  if (Number.isFinite(nearestD)) {
    fly.onPredatorProximity(nearestD, PREDATOR_RANGE_PT);
    // Speed boost: read the falloff and apply directly. We do NOT touch
    // fly.speed here because the boost must apply this frame; instead we
    // scale the fly's effective speed by a transient factor for one frame
    // via a property the body update reads.
    if (nearestD < PREDATOR_RANGE_PT) {
      const k = 1 - nearestD / PREDATOR_RANGE_PT;
      fly._predatorSpeedMul = 1 + 0.5 * k * k;
    } else {
      fly._predatorSpeedMul = 1;
    }
  } else {
    fly.onPredatorProximity(Infinity, PREDATOR_RANGE_PT);
    fly._predatorSpeedMul = 1;
  }
  if (sim) sim.setEscapeTeach(fly.escapeTeach);
  return out;
}

// Cursor kinematics -> looming drive for each eye of fly #1 + air puff.
// This is the sensory transduction step; everything downstream of the
// LC4/LPLC2 population is the real connectome.
function computeLoom(fly, mouse, dt) {
  if (!mouse) return { l: 0, r: 0, puff: 0 };
  if (prevMouse && dt > 0) {
    // The cursor arrives from a 30 Hz poll in the main process while this runs
    // once per rendered frame (up to 120), so most frames see the same
    // position. Dividing by the render dt turned one 30 Hz step into a spike
    // whose height scaled with refresh rate; measure over the real interval
    // between samples instead, and re-measure if the cursor goes quiet so a
    // stopped cursor decays to zero rather than holding its last speed.
    mouseSampleDt += dt;
    if (mouse.x !== prevMouse.x || mouse.y !== prevMouse.y || mouseSampleDt >= 1 / 30) {
      mouseVelRaw.x = (mouse.x - prevMouse.x) / mouseSampleDt;
      mouseVelRaw.y = (mouse.y - prevMouse.y) / mouseSampleDt;
      prevMouse = { x: mouse.x, y: mouse.y };
      mouseSampleDt = 0;
    }
    // Smoothing runs every frame, frame-rate-corrected: 24/60 = the old fixed
    // per-frame 0.4, so 60 Hz is unchanged.
    const k = lag(24, dt);
    mouseVel.x += (mouseVelRaw.x - mouseVel.x) * k;
    mouseVel.y += (mouseVelRaw.y - mouseVel.y) * k;
  } else {
    prevMouse = { x: mouse.x, y: mouse.y };
    mouseSampleDt = 0;
  }
  const rel = { x: mouse.x - fly.pos.x, y: mouse.y - fly.pos.y };
  const dist = Math.max(20, Math.hypot(rel.x, rel.y));
  // radial approach speed (positive = cursor closing in)
  const approach = -(rel.x * mouseVel.x + rel.y * mouseVel.y) / dist;
  // loom ~ rate of angular expansion, attenuated with distance
  let loom = clampf(approach / dist * 6, 0, 1) * clampf(1 - dist / 800, 0, 1);
  loom += clampf((130 - dist) / 130, 0, 1) * 0.5;          // hovering close = big object
  loom = clampf(loom + loomOverride, 0, 1);
  // split between eyes by bearing relative to heading
  const f = { x: Math.cos(fly.heading), y: Math.sin(fly.heading) };
  const rd = { x: rel.x / dist, y: rel.y / dist };
  const crossZ = f.x * rd.y - f.y * rd.x;                  // >0: threat on the left
  const lw = clampf(0.5 + 0.5 * crossZ, 0.12, 1);
  const rw = clampf(0.5 - 0.5 * crossZ, 0.12, 1);
  const puff = clampf(Math.hypot(mouseVel.x, mouseVel.y) / 1500, 0, 1)
    * clampf(1 - dist / 500, 0, 1);
  return { l: loom * lw, r: loom * rw, puff };
}

function frame(tMs) {
  requestAnimationFrame(frame);
  if (paused) { lastTime = null; return; }
  const t = tMs / 1000;
  if (lastTime === null) { lastTime = t; return; }
  const dt = Math.min(0.05, Math.max(0, t - lastTime));
  lastTime = t;

  let signals = null;
  const first = flies[0];
  if (sim && first) {
    const sensory = computeLoom(first, mouseScene, dt);
    const decayF = Math.exp(-4 * dt);
    windowLoomL *= decayF;
    windowLoomR *= decayF;
    sim.loomL = Math.max(sensory.l, windowLoomL);
    sim.loomR = Math.max(sensory.r, windowLoomR);
    // sugar + pheromone add a tarsal-contact gradient on top of the cursor
    // air-puff; cap at 0.3 so the cursor's fast whoosh still wins.
    let foodPuff = 0;
    for (const z of zones) {
      if (z.kind === 'sugar') {
        const d = Math.hypot(z.x - first.pos.x, z.y - first.pos.y);
        const k = clampf(1 - d / 220, 0, 1);
        foodPuff = Math.max(foodPuff, k * 0.10);
      } else if (z.kind === 'mate') {
        const d = Math.hypot(z.x - first.pos.x, z.y - first.pos.y);
        const k = clampf(1 - d / 320, 0, 1);
        foodPuff = Math.max(foodPuff, k * 0.04);
      }
    }
    sim.airPuff = Math.max(sensory.puff, Math.max(typingLevel * 0.30, foodPuff));
    // body -> brain: leg proprioception from the current gait
    sim.gaitDrive = first.walkingIntensity;
    sim.gaitPhase = first.gaitPhasePublic;
    // circadian + sleep neuromodulation. Compressed: the LIF neurons sit
    // just below threshold, so a raw multiplier silences them entirely —
    // siesta should mean "less active", not comatose.
    sim.activityScale = (1 - (1 - activity) * 0.35) * (sleepy ? 0.75 : 1);
    sim.sensoryGate = sleepy ? 0.55 : 1;
    loomOverride = Math.max(0, loomOverride - dt * 1.2);   // override decays
    msAccumulator += dt * 1000;
    const steps = Math.min(50, Math.floor(msAccumulator));
    msAccumulator -= steps;
    sim.step(steps);

    signals = signalBuilder.make(sim, dt);
    signals.tempo = tempo;
    signals.sleep = sleepy;

    // Zone heading-bias (spec: fly-zone-heading-always-on).
    // Computed ONCE per frame and applied to the primary fly's
    // heading in front of fly.update() so the bias is honoured in
    // every state (the previous code path only ran inside the
    // fly model's updateWalk, which the 'idle' / 'flying' states
    // never reach). The fly model no longer multiplies the bias
    // a second time; this call is the single source of truth.
    if (first && zones.length) {
      const attract = zoneAttract(first, zones);
      // Satiety gate: same as in checkReaches — a satiated fly
      // does not chase sugar.
      if (first.sugarLevel < 0.2) attract.foodAttract = 0;
      const mult = (first.state === 'flying') ? 0.5 : 1.0;
      first.heading += (attract.foodAttract + attract.mateAttract + attract.predatorAttract) * mult * dt;
    }

    if (spikeBus) {
      const events = spikeBus.popAll();
      if (events.length) api.sendSpikes(events);
    }
    // Brain state readout (spec: brain-state-readout). The overlay owns
    // the sim and the fly, so it forwards a throttled state+signals
    // packet to the brain window for the single-line readout. Throttle
    // to 10 Hz so the DOM doesn't churn at 60 fps.
    if (first) {
      const now = performance.now();
      if (now - lastStateMs >= STATE_MIN_INTERVAL_MS) {
        lastStateMs = now;
        const sn = first.state;
        // Transient tags take priority over the persistent state. The
        // tag wins for as long as the transient timer is non-zero.
        const tag =
          first.eatingTimer > 0 ? 'eat' :
          first.courtingTimer > 0 ? 'court' :
          sn === 'walking' ? 'walk' :
          sn === 'flying' ? 'flight' :
          sn === 'grooming' ? 'groom' :
          sn === 'idle' ? 'idle' :
          sn === 'sleeping' ? 'sleep' : 'idle';
        api.sendState({
          tag,
          // Nine population rates, 3-decimal precision after normalising
          // by the typical-max table below. Spec: brain-state-readout
          // "Numeric rates for nine populations".
          rates: {
            LC4:   sim ? sim.rateLC4   : 0,
            LPLC2: sim ? sim.rateLPLC2 : 0,
            GF:    sim ? sim.rateGF    : 0,
            DNa01: sim ? sim.rateDNaL  : 0,
            DNa02: sim ? sim.rateDNaR  : 0,
            DNp09: sim ? sim.rateFwd   : 0,
            DNg11: sim ? sim.rateGroom : 0,
            MDN:   sim ? sim.rateMDN   : 0,
            escW:  sim ? sim.rateEscW  : 0,
          },
          // Per-kind nearest-zone distance (px in the fly's frame).
          // `null` means "no zone of that kind exists". Lets the brain
          // window attribute the current behaviour to a specific
          // influence (predator / sugar / mate) instead of guessing
          // from rates alone. Additive — no existing consumer breaks.
          proximity: {
            predator: nearestPredatorD,
            sugar:    nearestSugarD,
            mate:     nearestMateD,
          },
          // Hebbian teaching signal: rises when a predator zone is
          // close, drives LTD on sens→gf edges. Persists for a while
          // after the predator leaves (decay is in the sim). Useful
          // for distinguishing "the predator was here" from "the
          // fly is just flying" when rateGF is high.
          escapeTeach: sim ? sim.escapeTeach : 0,
        });
      }
    }
  }

  // Hebbian snapshot — only while plasticity is on and at most every 30 s.
  // The interval is in wall-clock so a paused tab doesn't burn through it.
  if (plasticEnabled && sim && performance.now() - lastSaveMs >= SAVE_INTERVAL_MS) {
    const w = sim.exportWeights();
    api.saveMemories({ weights: Array.from(w), edgesTouched: sim.plasticEdgesTouched ?? 0 });
    lastSaveMs = performance.now();
  }

  for (let i = 0; i < flies.length; i++) {
    flies[i].terrain = terrain;
    flies[i].zones = zones;     // game zones, for food/mate heading bias
  }
  // Reach check + zone draw first so the per-frame predator speed boost
  // and the food/sugar/satiety state are applied to fly.speed BEFORE
  // update() consumes it. The order matters: checkReaches sets
  // fly._predatorSpeedMul; update() multiplies this frame's speed by it.
  if (first) {
    drawZones(t, dt, first);
    checkReaches(first);
  }
  for (let i = 0; i < flies.length; i++) {
    // Apply the predator speed boost for this frame only, then revert.
    const fly = flies[i];
    const origSpeed = fly.speed;
    const sm = fly._predatorSpeedMul ?? 1;
    if (sm !== 1) fly.speed = fly.speed * sm;
    fly.update(dt, bounds, mouseScene, i === 0 ? signals : null);
    if (sm !== 1) fly.speed = origSpeed;
  }

  renderer.render(scene, camera);
}

// ---- wiring ----

api.onAmbient((a) => {
  mouseScene = a.mouse;
  typingLevel = a.typing;
  sleepy = a.sleepy;
  tempo = a.tempo;
  activity = a.activity;
  // Linux main process may push a multiplicative override on the spontaneous
  // escape probability. Default 1 (Windows sends no such field) keeps the
  // connectome's baseline behavior untouched.
  if (typeof a.escapeRateMul === 'number') setEscapeRateMul(a.escapeRateMul);
});

api.onTerrain((snap) => {
  terrain = snap.ledges;
  // Linux main sends `windows` (the live _NET_CLIENT_LIST); Windows main
  // historically sent the ledges-only shape. Guard the map so a payload
  // without `windows` doesn't crash the renderer with
  // "Cannot read properties of undefined (reading 'map')".
  const winList = Array.isArray(snap.windows) ? snap.windows : [];
  const ids = new Set(winList.map((w) => w.id));
  if (knownWindowIds !== null) {
    const fly = flies[0];
    for (const w of winList) {
      if (knownWindowIds.has(w.id)) continue;
      if (!fly) continue;
      const d = Math.hypot(w.center.x - fly.pos.x, w.center.y - fly.pos.y);
      const strength = clampf(1 - d / 480, 0, 1) * 0.75;
      if (strength > 0.08) injectWindowLoom(strength, w.center);
    }
  }
  knownWindowIds = ids;
});

api.onTap((p) => injectTap(p));

api.onCommand((c) => {
  switch (c.name) {
    case 'pause': paused = c.value; lastTime = null; break;
    case 'escapeTest': loomOverride = 0.6; break;
    case 'addFly': addFly(); break;
    case 'removeFly': removeFly(); break;
    case 'scareAll': scareAll(); break;
    case 'flyToNextDisplay': flyToNextDisplay(); break;
    case 'stim': stimulateGroup(c.group); break;
    case 'reward': trainerAction(c.target, +1); break;
    case 'spawnSugar': {
      // pick a random point within active-display bounds, well clear of the fly
      const hw = bounds.width / 2 - 80, hh = bounds.height / 2 - 80;
      spawnSugar(rnd(-hw, hw), rnd(-hh, hh));
      break;
    }
    case 'spawnNear': {
      // Spawn a sugar zone within 200 pt of the fly at a random angle.
      // This is the deterministic demo entry so the user can verify
      // sugar-reach behaviour without waiting for the chase-bias
      // branch to fire. Spec: fly-zone-wander "Spawn Near Fly".
      const fly0 = flies[0];
      const hwN = bounds.width / 2 - 80, hhN = bounds.height / 2 - 80;
      if (fly0) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 50 + Math.random() * 150;     // 50..200 pt
        spawnSugar(
          Math.max(-hwN, Math.min(hwN, fly0.pos.x + dist * Math.cos(ang))),
          Math.max(-hhN, Math.min(hhN, fly0.pos.y + dist * Math.sin(ang))),
        );
      } else {
        spawnSugar(rnd(-hwN, hwN), rnd(-hhN, hhN));
      }
      break;
    }
    case 'spawnPredator': {
      // Spawn the predator 200-400 pt from the fly at a random angle.
      // This matches the predator's ambush+sprint target range
      // (see windows/src/zone-motion.js predatorStep) so the
      // sprint lands near the fly on the first attempt. Before
      // this change the predator was placed anywhere on the
      // display; the user reported "predator was set to
      // chase the fly's spawn position but the fly had moved
      // before the sprint started" — placing the predator
      // close to the live fly position makes the contact
      // happen within one rest+sprint cycle.
      const fly0p = flies[0];
      const hwp = bounds.width / 2 - 80, hhp = bounds.height / 2 - 80;
      if (fly0p) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 200 + Math.random() * 200;
        spawnPredator(
          Math.max(-hwp, Math.min(hwp, fly0p.pos.x + dist * Math.cos(ang))),
          Math.max(-hhp, Math.min(hhp, fly0p.pos.y + dist * Math.sin(ang))),
        );
      } else {
        spawnPredator(rnd(-hwp, hwp), rnd(-hhp, hhp));
      }
      break;
    }
    case 'spawnMate': spawnMate(rnd(-bounds.width / 4, bounds.width / 4),
                                 rnd(-bounds.height / 4, bounds.height / 4)); break;
    case 'clearZones': clearZones(); break;
    case 'setTheme': {
      // Phase A: switch FLY_THEME globally and rebuild every live Fly's body.
      // Materials are baked into the meshes, so a theme swap means re-running
      // buildFlyModel(); setTheme() in flymodel.js mutates the global first.
      const ok = setTheme(c.theme);
      if (!ok) { console.warn('[overlay] unknown theme', c.theme); break; }
      for (const fly of flies) fly.applyTheme();
      break;
    }
    case 'setSize': {
      // Phase A: re-apply the global scale to every live Fly. The fly's
      // current `alt` is preserved across the swap so a flying fly stays
      // flying — we only re-set root.scale, not position/state.
      setScale(c.size);
      for (const fly of flies) fly.applyScale();
      break;
    }
    case 'punish': trainerAction(c.target, -1); break;
    case 'resetTraining': if (sim) { sim.resetPlasticity(); api.clearMemories(); } break;
    case 'enablePlasticity': if (sim) {
      sim.enablePlasticity({ eta: c.eta, alpha: c.alpha, stepMs: c.stepMs });
      plasticEnabled = true;
    } break;
    case 'disablePlasticity': if (sim) {
      sim.disablePlasticity();
      // one last snapshot then stop the timer; user can re-enable and pick up
      plasticEnabled = false;
    } break;
    default: break;
  }
});

api.onRetarget((size) => {
  bounds = { width: size.width, height: size.height };
  if (size.screens) screens = size.screens;
  for (const fly of flies) fly.screens = screens;
  terrain = [];                       // stale until the next window poll
  camera.left = -bounds.width / 2; camera.right = bounds.width / 2;
  camera.top = bounds.height / 2; camera.bottom = -bounds.height / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(bounds.width, bounds.height);
  fitShadowCamera();
  console.info(`[fly] retarget bounds=${bounds.width}x${bounds.height}`
    + ` screens=${screens ? screens.length : 0} flies=${flies.length}`);
  // keep flies on a real screen after the desktop changed shape
  for (const fly of flies) {
    fly.ledge = null;
    fly.pos.x = clampf(fly.pos.x, -bounds.width / 2 + 40, bounds.width / 2 - 40);
    fly.pos.y = clampf(fly.pos.y, -bounds.height / 2 + 40, bounds.height / 2 - 40);
    if (!onAnyScreen(fly.pos.x, fly.pos.y)) {
      const c = fly.nearestScreenCenter(fly.pos.x, fly.pos.y);
      fly.pos.x = c.x; fly.pos.y = c.y;
    }
  }
});

api.onStimulate((req) => {
  if (sim) sim.stimulate(req.indices, req.strength, req.durationMs);
});

// boot-config listener MUST be registered synchronously at module top —
// BEFORE the IIFE awaits getBrainData() / loadMemories() — otherwise the
// main process's `boot-config` IPC event arrives during the await window
// and is lost (Electron doesn't queue events for listeners that don't
// exist yet). We buffer the payload and let the IIFE consume it once the
// sim is up. Spec: fix(boot): apply size/theme on first Fly, no race.
let pendingBootConfig = null;
if (api.onBootConfig) {
  api.onBootConfig((cfg) => {
    pendingBootConfig = cfg;
    bootIfReady();
  });
}

function bootIfReady() {
  // We can only addFly() once the sim is constructed (the Fly constructor
  // reads sim-bound data). If the sim isn't ready yet, the IIFE will call
  // bootIfReady() again once LIFSim exists.
  if (!sim) return;
  if (!pendingBootConfig) return;
  const cfg = pendingBootConfig;
  pendingBootConfig = null;
  if (cfg && typeof cfg.size === 'number') {
    setScale(cfg.size);
  }
  if (cfg && typeof cfg.theme === 'string') {
    setTheme(cfg.theme);
    for (const fly of flies) fly.applyTheme();
  }
  addFly();
  requestAnimationFrame(frame);
}

(async () => {
  const data = await api.getBrainData();
  if (data) {
    spikeBus = new SpikeBus();
    sim = new LIFSim(data.circuit, spikeBus);
    // Restore any previously-saved food memories. Skipped silently if the
    // file is missing, corrupt, or the wrong size for the current circuit
    // (e.g. data/ was regenerated since last save).
    try {
      const mem = await api.loadMemories();
      if (mem && Array.isArray(mem.weights) && sim.importWeights(mem.weights)) {
        console.info(`restored ${mem.weights.length} weights from ${mem.savedAt ?? '?'}`);
      }
    } catch (err) { console.warn('food-memories load failed:', err); }
  } else {
    console.warn('no data/ — the fly falls back to legacy distance-based behavior');
  }
  // Sim is up (or legacy fall-through); drain any boot-config the main
  // process sent during the await window. The listener is registered
  // synchronously at module top so the event is never lost.
  bootIfReady();
})();
