# DesktopFly on Ubuntu 24.04

A Linux variant of [DesktopFly](../) — the same 3D fruit fly on a
transparent desktop overlay, driven by the same 1 kHz leaky-integrate-and-fire
simulation of 668 real neurons from the FlyWire connectome (FAFB v783).

The brain is shared with the macOS and Windows ports; the rendering and OS
layers are an Electron + three.js port that talks to the local NVIDIA dGPU
through ANGLE on EGL.

## System packages

```sh
sudo apt-get update
sudo apt-get install -y \
  nodejs npm \
  xvfb x11-utils xdotool wmctrl \
  nvidia-driver-580 libegl1 libgl1 libvulkan1
```

Versions: Node 22+ (Node 24 LTS tested), NVIDIA driver 580+ (anything that
exposes the RTX 5090 via `nvidia_icd.json`).

`xprop` is in `x11-utils`, `wmctrl` provides `_NET_CLIENT_LIST` for the ledge
sensor on X11, and `xdotool` is used for the global-tap fallback.

## Verify the GPU

```sh
nvidia-smi -L                                # should list at least one dGPU
ls /usr/share/vulkan/icd.d/nvidia_icd.json  # must exist
```

If `nvidia_icd.json` is missing, install the matching driver and
`nvidia-vulkan-icd` (or the equivalent for your distro).

## Install

```sh
git clone https://github.com/DenisSergeevitch/desktop-fly.git
cd desktop-fly/linux
npm install
```

The shared sim and body code is symlinked from `../windows/src/...` — you
should see them as symlinks in `linux/src/`:

```sh
ls -l src/    # sim.js -> ../../windows/src/sim.js, etc.
```

## Run

```sh
npm start
```

A 🪰 item appears in the system tray; the overlay opens on the primary
display. Click **Send Fly to Next Display** to hop the fly across monitors.

## Test

```sh
npm test
```

Both suites (`simtest`, `behaviortest`) run on bare Node, with three.js
operating headless. The `xvfb` wrapper is only needed if a host renderer
init requires a window object — the suites are self-contained.

## Snapshot (dGPU)

```sh
npm run snapshot -- /tmp/fly.png         # 720x720 body render
npm run brainshot -- /tmp/brain.png      # 720x560 brain render
```

Both paths use Electron's headless `BrowserWindow` with `offscreen: true` and
write a PNG via `webContents.capturePage()`. Verify the renderer really hit
the dGPU while the snapshot runs:

```sh
nvidia-smi pmon -c 5 -d 0 | grep electron
```

The MiB column should be > 0 for the electron process during the render.

## Wayland v1 (no ledges)

Wayland deliberately withholds foreign-toplevel information from clients
without a DBus bridge. In v1 the `wayland.js` sense is a typed no-op: the
fly still walks, grooms, and flees the cursor, but it cannot walk on real
window edges.

### Future work: DBus foreign-toplevel bridge

The intended v2 path is a small DBus daemon (e.g. a Python wrapper around
`wlr-foreign-toplevel-management-v1`) exposed over a Unix socket that
`wayland.js` reads. Tracked in this doc for the next iteration; out of
scope for v1 per `plans/20260903-linux-port-electron-dgpu-per-monitor/plan.md`.

## Multi-monitor

The overlay is per-monitor (macOS-style): one `BrowserWindow` per display,
the active display is visible, the rest are hidden to save GPU memory.
"Send Fly to Next Display" in the tray menu rotates the active display and
re-anchors the camera.

X11 + xrandr work out of the box. Wayland on Mutter (GNOME 46+), KWin (KDE
Plasma 6), and wlroots compositors report logical outputs through the
`UseOzonePlatform` feature flag.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Tray icon 🪰 does not appear | `echo $XDG_CURRENT_DESKTOP`; on headless hosts the tray is hidden |
| Black overlay on X11 | `export ELECTRON_OZONE_PLATFORM_HINT=x11`; the default on X11 is native X, not XWayland |
| Black overlay on Wayland | `export ELECTRON_OZONE_PLATFORM_HINT=wayland`; ensure `nvidia_icd.json` is installed |
| `Cannot find module 'koffi'` | koffi is Windows-only; linux/ does not depend on it. If you see this, an old `package.json` leaked. Re-run `npm install`. |
| `xprop` not found | `apt install x11-utils`; the app still runs, just without window ledges |
| Fly flickers / GPU error | `nvidia-smi` to check the driver; on Optimus laptops, force NVIDIA via `prime-run npm start` |
| Tests fail with `EACCES: /dev/dri` | run under `xvfb-run -a npm test` (no real GPU needed) |

## Customizing the fly

The fly's appearance is configurable at startup and at runtime, both from
the CLI and from the tray.

### CLI

```sh
npm start -- --fly-theme cyan --fly-size 1.5   # cyan fly at 1.5x scale
FLY_THEME=magenta FLY_SIZE=2.0 npm start       # env vars work too
```

`--fly-size` is clamped to `[0.3, 5.0]` — values outside the range are
snapped to the nearest bound (the original `FLY_SCALE=14.0` invisibility
bug is the reason for the cap). Theme names: `orange` (default), `fruitfly`,
`cyan`, `magenta`, `yellow`, `green`.

### Tray

The tray menu has two appearance submenus:

- **Theme** — pick any of the six themes; the swap is instant, no restart.
  The current theme has a ✓ marker.
- **Size** — 0.5x, 1x, 1.5x, 2x, 3x. The current size has a ✓ marker.

The scale is applied to the body's `root.scale`, so the same `FLY_SCALE`
cap applies; the menu labels also reflect the bounds.

## Brain Trainer

Tray → **Brain** → **Open Trainer** opens a small 540×420 window with a
list of pre-built optogenetic lessons:

- **loom-escape** — stimulate LC4 + LPLC2; the fly should escape within ~100 ms.
- **sugar-forward-walk** — DNp09 + sensory pulse; the fly walks forward.
- **turn-left** — right steering DNa01; the fly turns left.
- **groom-trigger** — DNg11; the fly switches to groom.

Click **Apply** to inject current into the listed neurons for the
specified duration. The brain window flashes the targeted neurons. Click
**Save** to copy the pattern into
`~/.config/desktop-fly/lessons/<name>.json` for editing; **Load** reads it
back.

The lessons live in `data/lessons/*.json` (the source of truth, edited by
hand) and are bundled as `windows/renderer/lessons.json` (the runtime
sidecar). The `brain-trainer.test.js` suite validates every lesson:
indices must be in-bounds, strength ∈ [0, 1], durationMs ∈ [50, 2000].

## Game mode (food & mate)

The tray has a **Game** submenu with three entries:

- **Spawn Sugar Zone** — drops a yellow circle on the active display.
  The fly orients toward it via a tarsal-contact gradient; on contact the
  sugar disappears, the brain receives a `fwd + groom` reward pulse
  (proboscis-extension surrogate), and Hebbian LTP grows the edges that
  delivered the success.
- **Spawn Mate** — drops a slowly-moving pink glow. The fly steers
  toward it; close approach fires wing-extension (courtship surrogate).
  The mate never disappears; **Clear Zones** wipes everything.
- **Clear Zones** — removes all food and mate zones.

The trainer submenu still has **Enable Hebbian plasticity** — leave it
on while you hunt sugar, and the brain snapshots its weight matrix to
`~/.config/desktop-fly/food-memories.json` every 30 s. Quit and relaunch
and the brain picks up where it left off. **Reset weights** wipes the
file.

Headless smoke check: `node windows/test/attracttest.js` (14 cases) and
`node windows/test/simtest.js` (10 phases) — both should pass before any
change ships.
