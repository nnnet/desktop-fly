# Fly size/color configurability + Brain-trainer (continuation of food/mate)

## Context

В предыдущей сессии был исправлен `linux/main.js` — overlay-окно грузило
`linux/renderer/overlay.html` (untracked scratchpad) вместо
`../windows/renderer/overlay.html` (git-tracked source of truth). После
фикса муха снова видна, `simtest` PASS, `attracttest` 14/14 PASS,
snapshot 18977 байт (vs 3160 сломанный). Коммит `8c819d6` запушен в
`github.com:nnnet/desktop-fly` ветка `research/brain-trainer`.

Скаут репо показал, что food/mate seeking **уже практически полностью
реализован** в коммите `b66ee6d feat(game): sugar + mate zones with
Hebbian memory persistence`:

- `windows/src/attract.js` — чистая функция heading-bias, есть
  `attracttest.js` (14/14 PASS).
- `windows/renderer/overlay.js` — `zones[]`, `spawnSugar`, `spawnMate`,
  `checkReaches`, `sim.exportWeights/importWeights` + Hebbian snapshot
  в `overlay.js:457-460` + persistence через `loadMemories/saveMemories`
  в `preload.mjs:33-35`.
- `linux/main.js:129` — tray Game submenu (Spawn Sugar/Mate).
- Все 6 фаз плана `plans/20260904-food-mate-seeking/plan.md` закрыты,
  кроме мелочей (Clear Zones, docs Game mode section).

Реальный объём новой работы:
1. **Fly size/color configurability** — `FLY_THEMES` и `FLY_SCALE` уже
   экспортируются из `linux/src/flymodel.js:23,33,53`. Нужны:
   CLI-флаги `--fly-size`, `--fly-theme`, IPC для runtime-смены,
   tray-submenu "Theme" и "Size".
2. **Brain-trainer** — `windows/renderer/brain.js` уже умеет
   `api.stimulate(indices, strength, durationMs)`, есть role-coloring,
   click-to-stimulate. Нужна **отдельная панель уроков** + лог
   стимуляции + сохранение/загрузка patterns.
3. **Food/mate полировка** — добавить "Clear Zones" в tray, написать
   секцию в `docs/ubuntu.md`.

## Outcome, constraints, non-goals, acceptance

- **Outcome.**
  - `npm start -- --fly-size 2.0 --fly-theme cyan` — муха видна в
    новом цвете/масштабе, тесты green.
  - tray-меню `Theme ▸ {orange, cyan, magenta, yellow, green,
    fruitfly}` и `Size ▸ {0.5x, 1x, 2x, 3x}` — клик применяется
    сразу, без рестарта.
  - `Brain ▸ Trainer` открывает новое окно `brain-trainer.html`
    со списком уроков: "Loom → escape", "Stim sugar → fwd",
    "Stim left DNa01 → turn right", и т.д. Кнопка "Apply"
    шлёт `sim.stimulate` с заранее заданными параметрами.
    Кнопка "Save pattern" пишет `.json` в `userData/lessons/`.
  - tray-меню `Game ▸ Clear Zones` — удаляет все зоны.
- **Constraints.**
  - Тесты остаются green: `cd linux && npm test` (simtest + attracttest
    + behavibortest + snapshot).
  - Symlink sharing: всё новое либо в `windows/src/`, либо
    per-platform, без ломки.
  - На Linux overlay per-monitor — trainer открывается в отдельном
    BrowserWindow (как `brainWindow` сейчас).
  - Headed и headless (`--snapshot`) работают оба.
  - Не ломать CLAUDE.md инварианты (walk-drive duty 20-50%, GF silent
    4 s rest, escape race).
- **Non-goals.**
  - Полноценный ML/BCI (это тул, не наука).
  - 3D food mesh, GPU instancing, multi-fly courtship.
  - Звук (proboscis buzz, courtship song).
- **Acceptance.**
  - `cd linux && npm test` — все 4 suites PASS.
  - `npm start -- --fly-theme cyan --fly-size 2.0` → муха cyan в
    2-кратном масштабе; snapshot 200+ KB.
  - tray Theme ▸ fruitfly → муха мгновенно бледнеет до off-white.
  - tray Brain ▸ Trainer → окно trainer открылось, список из
    ≥4 уроков виден, Apply шлёт `sim.stimulate`, в brain.js видны
    flashes.
  - Game ▸ Clear Zones → все зоны исчезают.

## Borrow-list

| Source | Pattern | Что берём |
|---|---|---|
| (своё) `flymodel.js:33,53` | `FLY_THEMES`/`FLY_THEME` уже swappable | Перешиваем через IPC + tray, не трогаем flymodel |
| (своё) `linux/main.js:129` | tray Game submenu | Копируем паттерн для Theme/Size/Trainer submenu |
| (своё) `overlay.js:259,271` | spawnSugar/spawnMate | Для `Clear Zones` — добавить `clearZones` cmd |
| (своё) `brain.js:253` | `api.stimulate(indices, strength, durationMs)` | Trainer дёргает тот же API |
| er Rojas fly-brain repo | стандартные optogenetic-протоколы | Lesson templates: loom→GF, sugar→fwd, DNa01 L→turn R |

## Architecture

```
┌────────────────┐    ipc 'cmd'        ┌──────────────────┐
│ Tray submenus  │ ──────────────────► │ overlay.js (3D)  │
│  - Theme       │ { setTheme,         │  FLY_THEME = ... │
│  - Size        │   setSize,          │  FLY_SCALE = ... │
│  - Game        │   clearZones }      │  zones = []      │
│  - Trainer     │                     │  rebuild body    │
└────────────────┘                     └──────────────────┘
        │
        │  ipc 'cmd' { openTrainer }
        ▼
┌────────────────┐    ipc 'stimulate'   ┌──────────────────┐
│ Trainer window │ ───────────────────► │ overlay.js (sim) │
│  brain-        │ { indices,           │  sim.stimulate() │
│  trainer.html  │   strength,          │                  │
│  lesson list   │   durationMs }       │  sim.onSpikes →  │
│  apply/save    │                      │  brain.js flash  │
└────────────────┘                      └──────────────────┘
```

- **Renderer-owned state**: `FLY_THEME`, `FLY_SCALE` (через `import()`)
  + `zones[]` (уже).
- **Sim-owned state**: ничего нового.
- **IPC**: расширяем `cmd` channel — добавляем `setTheme`, `setSize`,
  `clearZones`, `openTrainer`.
- **Trainer-window**: отдельный `BrowserWindow` (как `brainWindow`),
  шлёт `stimulate` через тот же preload.

## Graph of nodes

```yaml
graph:
  # Phase A — Fly size/color configurability
  - {id: A1, needs: [],        parallel: "",         status: "[ ]", files: [linux/src/flymodel.js, windows/src/flymodel.js]}
  - {id: A2, needs: [],        parallel: "after-a1", status: "[ ]", files: [linux/main.js, windows/preload.mjs]}
  - {id: A3, needs: [A1, A2],  parallel: "after-a2", status: "[ ]", files: [linux/main.js, windows/renderer/overlay.js]}
  - {id: A4, needs: [A3],      parallel: "",         status: "[ ]", files: [linux/test/snapshot.test.js]}

  # Phase B — Brain-trainer window
  - {id: B1, needs: [],        parallel: "",         status: "[ ]", files: [windows/renderer/brain-trainer.html]}
  - {id: B2, needs: [B1],      parallel: "after-b1", status: "[ ]", files: [windows/renderer/brain-trainer.js]}
  - {id: B3, needs: [B2],      parallel: "after-b2", status: "[ ]", files: [linux/main.js, windows/main.js]}
  - {id: B4, needs: [B2],      parallel: "after-b3", status: "[ ]", files: [linux/test/brain-trainer.test.js, data/lessons/]}

  # Phase C — Food/mate polish
  - {id: C1, needs: [],        parallel: "after-a4", status: "[ ]", files: [windows/renderer/overlay.js]}
  - {id: C2, needs: [C1],      parallel: "after-c1", status: "[ ]", files: [linux/main.js, windows/main.js]}
  - {id: C3, needs: [A4, B4, C2], parallel: "",      status: "[ ]", files: [docs/ubuntu.md, README.md]}
```

## Detailed design

### A1 `a1-themes-and-scale-export` — расширить FLY_THEMES + setTheme/setScale API

- output: `flymodel.js` добавляет `setTheme(name)`, `setScale(s)` —
  mutating-функции, пересобирающие root.scale и material colors.
  Также добавляет темы `cyan`, `magenta`, `yellow`, `green` в
  `FLY_THEMES`.
- acceptance: `setTheme('cyan')` меняет body color; `setScale(2.0)`
  ставит root.scale = 2.0; headless `--snapshot` показывает
  изменённый цвет.

### A2 `a2-cli-args` — CLI флаги + tray submenu

- output: `linux/main.js` парсит `--fly-theme` и `--fly-size`; tray
  submenu "Theme" и "Size" с sub-items; на click — broadcast cmd
  `{name: 'setTheme', theme}` / `{name: 'setSize', size}`.
- acceptance: `npm start -- --fly-theme cyan --fly-size 2.0` стартует
  сразу с cyan + 2x; tray Theme ▸ magenta → overlay переключается
  на magenta без рестарта.

### A3 `a3-overlay-handlers` — onCommand cases в overlay.js

- output: `overlay.js#onCommand` обрабатывает `setTheme` (импорт
  `flymodel.js` + `setTheme(name)` + rebuild body) и `setSize`
  (setScale).
- acceptance: симулятор + размер применяются мгновенно, `simtest`
  и `attracttest` остаются green.

### A4 `a4-snapshot-test` — headless test для разных тем

- output: `linux/test/snapshot.test.js` добавляет тест "fly theme
  cyan renders with body color != orange" (анализ пикселей в
  bounding box).
- acceptance: `npm test` PASS.

### B1 `b1-trainer-html` — UI окна trainer

- output: `windows/renderer/brain-trainer.html` + CSS — список
  уроков слева, кнопка Apply/Save/Load справа, лог стимуляции
  снизу, справка (какие нейроны, что будет) сверху.
- acceptance: открывается, layout читаемый, кнопки кликабельны.

### B2 `b2-trainer-logic` — JS логика уроков

- output: `windows/renderer/brain-trainer.js` — загрузка
  `data/circuit.json`, словарь уроков `data/lessons/*.json`
  (минимум 4 шаблона: loom, sugar, turn-L, turn-R, groom,
  escape-inhibit), apply → `api.stimulate({indices, strength,
  durationMs})`, save pattern → `api.saveLesson(name, json)`,
  load → `api.loadLesson(name)`.
- acceptance: клик Apply → в `brain.js` видны flash'и; Save →
  `~/.config/desktop-fly/lessons/my.json` создан.

### B3 `b3-trainer-window` — Electron window + IPC

- output: `linux/main.js` `createTrainerWindow()` (как
  `createBrainWindow`); tray submenu "Brain ▸ Trainer"; cmd
  `openTrainer`; IPC `lessons:save/load`.
- acceptance: tray Brain ▸ Trainer → окно trainer открылось; в нём
  работают Apply и Save.

### B4 `b4-trainer-test` — node-тест логики уроков

- output: `linux/test/brain-trainer.test.js` — читает
  `data/lessons/*.json`, для каждого проверяет: indices
  существуют в `data/circuit.json`; strength ∈ [0, 1];
  durationMs ∈ [50, 2000].
- acceptance: `npm test` PASS.

### C1 `c1-clear-zones-cmd` — clearZones case

- output: `overlay.js#onCommand` обрабатывает `clearZones` —
  `zones.length = 0` + удалить mesh'и из scene.
- acceptance: Game ▸ Clear Zones → все жёлтые круги пропадают.

### C2 `c2-tray-clear-zones` — tray submenu

- output: tray Game submenu получает "Clear Zones" item после
  "Spawn Mate".
- acceptance: tray Game ▸ Clear Zones → IPC → zones очищены.

### C3 `c3-docs` — секция "Game / Trainer / Themes" в docs

- output: `docs/ubuntu.md` секция "Customizing" с sub-sections
  Themes, Size, Game (food/mate), Trainer; `README.md` — буллеты
  в feature list.
- acceptance: `grep -c "Trainer" docs/ubuntu.md` ≥ 3.

## Critical files to modify

| File | Change | Why |
|---|---|---|
| `linux/src/flymodel.js`, `windows/src/flymodel.js` | + `setTheme(name)`, `setScale(s)`, +4 темы | A1 |
| `linux/main.js` | + CLI args, + tray Theme/Size, + Trainer window | A2, B3, C2 |
| `windows/preload.mjs` | + `saveLesson/loadLesson` IPC | B3 |
| `windows/renderer/overlay.js` | + `setTheme`/`setSize`/`clearZones` cmd cases | A3, C1 |
| `windows/renderer/brain-trainer.html`, `.js` | new file | B1, B2 |
| `linux/test/snapshot.test.js` | + theme test | A4 |
| `linux/test/brain-trainer.test.js` | new | B4 |
| `data/lessons/*.json` | 4+ lesson files | B2 |
| `docs/ubuntu.md`, `README.md` | new sections | C3 |

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| `setTheme` ломает текущий body (плеер) | Rebuild через `swapBody()` уже в `flymodel.js`; theme change = rebuild only materials, не геометрию. |
| `--fly-size 5.0` ломает scale (как раньше FLY_SCALE 14.0) | Cap в CLI parser: 0.3 ≤ size ≤ 5.0; warn at > 3.0. |
| Trainer window крашится при отсутствии `data/circuit.json` | Fallback: показать "no data — run etl.py first" (как brain.js:339). |
| Lessons валидны, но не находят neurons (idx out of range) | В trainer.js валидация при load + UI warning. |
| `clearZones` стирает mesh ref'ы, но не THREE.Group children | В `clearZones` пройти по group.children и `remove(mesh)`. |

## Verification

```bash
cd /tmp/desktop-fly
# ground truth
cd linux && node ../windows/test/simtest.js       # все 10 фаз PASS
cd linux && node ../windows/test/attracttest.js   # 14/14 PASS
cd linux && node ../windows/test/behaviortest.js  # green
cd linux && npm test                              # все suites
# headed
cd linux && npm start -- --fly-theme cyan --fly-size 2.0
# → tray Theme ▸ magenta → swap OK
# → tray Game ▸ Spawn Sugar → fly reaches
# → tray Brain ▸ Trainer → Apply loom → flashes in brain
# headless
cd linux && xvfb-run -a npx electron . --snapshot /tmp/themes/orange.png --fly-theme orange
cd linux && xvfb-run -a npx electron . --snapshot /tmp/themes/cyan.png   --fly-theme cyan
# → оба файла > 5 KB, цвета разные (проверить пиксели)
```

## Out-of-scope (later)

- Полноценный ML/BCI / Pavlovian conditioning pipeline.
- Rate-plot brain monitor (Phase 4 плана `20260904-food-mate-seeking`).
- Multi-fly courtship, dimorphic circuits.
- GPU instancing зон, 3D food mesh.
- Звук (proboscis, courtship song).

## Unresolved questions

- Количество тем — делать 4 (cyan, magenta, yellow, green) или больше?
  По умолчанию делаю 4 + уже существующие fruitfly/orange = 6 тем.
- Trainer lessons — 4 минимально или сразу 6-8? Делаю 4 (loom,
  sugar-fwd, turn-L, turn-R), остальные — easy follow-up.
- `clearZones` — отдельный cmd или встроить в `enablePlasticity: false`?
  Отдельный cmd (явный UX).
