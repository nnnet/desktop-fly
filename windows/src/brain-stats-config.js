// brain-stats-config.js — main-process-only Brain Stats config loader.
//
// Reads ~/.config/desktop-fly/brain-stats.json (or the Windows
// equivalent under %APPDATA%) and returns a fully-validated config
// object. Falls back to the default config on any failure (missing
// file, malformed JSON, partial keys).
//
// This module is SEPARATE from brain-stats.js because the renderer
// imports `BrainStats` + `TAG_FOR_NEURON` from the latter, and the
// renderer's CSP (script-src 'self') forbids `node:*` imports. The
// renderer instead fetches its config via the `brain-stats:read`
// IPC channel which is handled in this file.
//
// Spec: openspec/changes/fly-neuron-activity-bars/specs/fly-neuron-activity-bars/spec.md
// (Requirement: "Configurable neuron list, metric, and window")

import { readFileSync } from 'node:fs';
import { mergeConfig, DEFAULT_CONFIG } from './brain-stats.js';

/**
 * Read the config JSON from disk. Falls back to the default config
 * on any failure (missing file, malformed JSON, partial keys). Used
 * by the `brain-stats:read` IPC handler in the main process; the
 * renderer fetches the same data through the IPC bridge so it does
 * not need this file.
 */
export function loadConfig(path) {
  try {
    const raw = readFileSync(path, 'utf8');
    return mergeConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
