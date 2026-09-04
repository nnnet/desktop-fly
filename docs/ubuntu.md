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

# pnpm via corepack (ships with Node 16+).
sudo corepack enable
corepack prepare pnpm@11.22.0 --activate
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
pnpm install
```

The shared sim and body code is symlinked from `../windows/src/...` — you
should see them as symlinks in `linux/src/`:

```sh
ls -l src/    # sim.js -> ../../windows/src/sim.js, etc.
```

`pnpm-workspace.yaml` is the source of truth for `allowBuilds` (electron
needs postinstall scripts); pnpm 11 reads it from there, not from
`package.json`.

## Run

```sh
pnpm start
```

A 🪰 item appears in the system tray; the overlay opens on the primary
display. Click **Send Fly to Next Display** to hop the fly across monitors.

For the full port layout, tray items, and CLI flags see
[`../linux/README.md`](../linux/README.md).

## Test

```sh
pnpm test
```

Runs `simtest` (10 phases) + `behaviortest` (~23) + `attracttest` (14) +
`scaffold` — all four suites are pure-Node, with three.js operating
headless. The `xvfb` wrapper is only needed if a host renderer init
requires a window object — the suites are self-contained.

## Snapshot (dGPU)

There is no `pnpm run snapshot` script on this port. The two headless
renderers are CLI flags on the main binary:

```sh
pnpm start -- --snapshot=/tmp/fly.png         # 720x720 body render
pnpm start -- --brainshot=/tmp/brain.png      # 720x560 brain render
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
| `Cannot find module 'koffi'` | koffi is Windows-only; linux/ does not depend on it. If you see this, an old `package.json` leaked. Re-run `pnpm install`. |
| `xprop` not found | `apt install x11-utils`; the app still runs, just without window ledges |
| Fly flickers / GPU error | `nvidia-smi` to check the driver; on Optimus laptops, force NVIDIA via `prime-run pnpm start` |
| Tests fail with `EACCES: /dev/dri` | run under `xvfb-run -a pnpm test` (no real GPU needed) |

## Customizing the fly

The fly's appearance is configurable at startup and at runtime, both from
the CLI and from the tray.

### CLI

```sh
pnpm start -- --fly-theme cyan --fly-size 1.5   # cyan fly at 1.5x scale
FLY_THEME=magenta FLY_SIZE=2.0 pnpm start       # env vars work too
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

The trainer has a second tab, **Memory**, that reads
`food-memories.json` on demand and on a 30 s poll and renders the
top 20 edges by `|w|` as horizontal bars — green for LTP, red for LTD.
The signed `dW` is shown to 4-decimal precision. The tab falls back
to a `No learning yet` placeholder when the snapshot is missing or
empty.

## Game mode (food, mate, predator)

The tray has a **Game** submenu with five entries:

All three zone kinds **wander**: every 4–10 s they pick a new
target and lerp toward it (sugar 30 pt/s, mate 20 pt/s, predator
50 pt/s). A per-kind chase-bias — sugar 15 %, mate 25 %, predator
40 % — picks a point within 200 pt of the fly instead of a uniform
display point. So within a normal session the zones interact with
the fly multiple times.

- **Spawn Sugar Zone** — drops a yellow circle on the active display.
  The fly orients toward it via a tarsal-contact gradient; on contact
  the sugar disappears, the brain receives a `fwd + groom` reward
  pulse (proboscis-extension surrogate), and Hebbian LTP grows the
  edges that delivered the success. The fly's `sugarLevel` is
  restored on every eat; above the 0.2 threshold the fly chases
  sugar, below it the fly ignores sugar and goes hungry until you
  spawn more. **Sugar never respawns on its own** — the user is the
  only source of new zones.
- **Spawn Near Fly** — drops a sugar zone within 50–200 pt of the
  fly at a random angle. The deterministic demo entry: you can
  verify sugar-reach behaviour immediately, without waiting for
  the random chase-bias branch to fire.
- **Spawn Predator** — drops a red octagon. The fly rotates away,
  gets a temporary speed boost (up to 1.5× within 900 pt), and the
  proximity feeds an `escapeTeach` signal to the sim. With plasticity
  on this drives Hebbian LTD on the sensory→giant-fiber edges.
  Predator zones do not consume on contact.
- **Spawn Mate** — drops a slowly-moving pink glow. The fly steers
  toward it; close approach fires wing-extension (courtship surrogate).
  The mate never disappears; **Clear Zones** wipes everything.
- **Clear Zones** — removes all food, mate, and predator zones.

### What you see on contact

The renderer logs a single line per (zone, fly) the first time they
contact — visible in the launcher's terminal:

```
[zone] sugar reach id=7 fly=#0 d=14 bias=0.957
[zone] mate close id=3 fly=#0 d=42 bias=0.218
[zone] predator loom id=11 fly=#0 d=480 bias=-0.182
```

Reactions you should observe on screen:

| Contact | Visible reaction |
|---|---|
| Sugar reach | sugar disappears; brief wing raise (proboscis extension surrogate); brain receives reward pulse on DNp09 (walk) and DNg11 (groom) |
| Mate close | wing raise (courtship posture); wing extension via DNp02/04/11; brain state line shows `court` |
| Predator within 900 pt | fly turns away, speeds up; the predator closes in and the fly accelerates; plasticity window applies Hebbian LTD on sensory→escape edges |

The trainer submenu still has **Enable Hebbian plasticity** — leave it
on while you hunt sugar, and the brain snapshots its weight matrix to
`~/.config/desktop-fly/food-memories.json` every 30 s. Quit and relaunch
and the brain picks up where it left off. **Reset weights** wipes the
file.

## Reading the brain window

The brain window has a thin status bar at the top. The left side is
the current behavioural state in a single word: `walk`, `flight`,
`groom`, `idle`, `sleep`, `eat`, `court`. The right side shows the
nine population rates the connectome already exposes, normalised to
`[0, 1]` with 3-decimal precision: `LC4`, `LPLC2`, `GF`, `DNa01`,
`DNa02`, `DNp09`, `DNg11`, `MDN`, `escW`. The readout is throttled
to 10 Hz so the DOM does not churn at 60 fps.

Headless smoke check: `node windows/test/attracttest.js` (14 cases) and
`node windows/test/simtest.js` (10 phases) — both should pass before any
change ships.
