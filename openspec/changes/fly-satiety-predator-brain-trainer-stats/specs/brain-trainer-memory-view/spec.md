## Purpose

Surfaces Hebbian learning to the user. The brain-trainer window
gains a Memory tab that reads the on-disk memory snapshot
(`food-memories.json`) and renders a top-20 bar chart of edges
ranked by absolute weight change, so the user can see what the
network has actually learned.

## ADDED Requirements

### Requirement: Memory tab exists

The system SHALL render a `Memory` tab in the brain-trainer window
alongside the existing optogenetic-lessons tab. The tab SHALL be
visible by default and SHALL show a `Loading…` placeholder while
the snapshot is being read.

#### Scenario: Opening the brain-trainer shows both tabs
- **WHEN** the user opens the trainer via tray → Brain → Open Trainer
- **THEN** the window shows a `Lessons` tab and a `Memory` tab

#### Scenario: Memory tab reads the latest snapshot
- **WHEN** the user clicks the `Memory` tab
- **THEN** the system reads
  `~/.config/desktop-fly/food-memories.json` (Linux) /
  `%APPDATA%/desktop-fly/food-memories.json` (Windows) and renders
  the bar chart

### Requirement: Bar chart shows top 20 edges

The system SHALL display exactly 20 horizontal bars, sorted by
absolute `dW` in descending order. Each bar SHALL show: edge label
(pre pop name → post pop name), the signed `dW` value with 4
decimal places, and a colour — green for `dW > 0` (LTP), red for
`dW < 0` (LTD).

#### Scenario: Twenty bars in the chart
- **WHEN** the snapshot contains 412 edges with non-zero `dW`
- **THEN** exactly the top 20 by `|dW|` are rendered, the rest are
  not shown

#### Scenario: Bar colour follows sign
- **WHEN** an edge has `dW = +0.0018`
- **THEN** its bar is rendered green
- **WHEN** an edge has `dW = -0.0021`
- **THEN** its bar is rendered red

### Requirement: Auto-refresh on save

The system SHALL re-read the snapshot at most every 30 s without
reloading the window. The bar chart SHALL update in place when a
new snapshot is detected (file mtime changes).

#### Scenario: Save event refreshes the chart
- **WHEN** the renderer writes a new `food-memories.json`
- **THEN** within 30 s the Memory tab shows updated bars without a
  user click

#### Scenario: No save leaves the chart stable
- **WHEN** no save has occurred since the panel opened
- **THEN** the chart does not flicker or re-render

### Requirement: Empty snapshot is handled gracefully

The system SHALL render a friendly `No learning yet — fly has not
eaten or fled.` placeholder when the snapshot file is missing or
its `weights` array is empty.

#### Scenario: First launch, no snapshot
- **WHEN** the user opens the Memory tab before any plasticity
  snapshot exists
- **THEN** the placeholder is shown, not a blank chart or error

#### Scenario: Snapshot exists with zero non-zero weights
- **WHEN** the snapshot file is present but all weights are 0
- **THEN** the placeholder is shown
