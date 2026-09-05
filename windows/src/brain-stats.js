// brain-stats.js — pure aggregator for the Brain Stats window.
// Spec: openspec/changes/fly-neuron-activity-bars/specs/fly-neuron-activity-bars/spec.md
// ("One row per behaviour, with two global-share bars")
//
// Consumes a stream of `{tag, t}` events (the same stream that drives
// the brain window's state line) and produces per-behaviour aggregates:
// lifetime and recent (last `window_seconds`). Aggregation is metric-
// agnostic; the only difference between `count` and `sum_duration` is
// how each pair of consecutive events is reduced.
//
// THIS MODULE IS RENDERER-SAFE. It must not import anything from
// `node:*` because the renderer (windows/renderer/brain-stats.js)
// imports the `BrainStats` class from here and the renderer's CSP
// forbids `node:*` scripts (script-src 'self'). The `loadConfig`
// helper that reads brain-stats.json from disk lives in a separate
// sibling file (brain-stats-config.js) that only the main process
// imports.

// Fixed mapping from neuron → behavioural tag. The brain window's
// state line uses the same priority order (overlay.js `tag` field);
// see spec Requirement "Bars reflect aggregated state events".
export const TAG_FOR_NEURON = Object.freeze({
  LC4:   'flight',     // looming → flight via GF; we use the
  LPLC2: 'flight',     // behavioural tag for the row, not the rate.
  GF:    'flight',
  DNa01: 'walk',
  DNa02: 'walk',
  DNp09: 'walk',
  DNg11: 'groom',
  MDN:   'walk',       // backward walk still counts as 'walk'
  escW:  'flight',     // wing-beat effort accompanies flight
});

// Note: LC4 and LPLC2 do not have a behavioural tag in the existing
// `state` payload — the `state` line only reports walk/flight/groom/
// idle/sleep/eat/court. To still give the user a meaningful signal
// for those populations, we treat them as "flight" (they're the
// looming detectors that drive escape, so their lifetime is the
// most informative aggregate for them). This is captured in the
// spec under "Bars reflect aggregated state events" → Scenario
// "Default list renders nine rows".

export const DEFAULT_CONFIG = Object.freeze({
  // The seven behavioural states that appear in the `state.tag`
  // field. Order matters: the renderer shows rows in this order.
  behaviours: ['walk', 'fly', 'idle', 'groom', 'sleep', 'eat', 'court'],
  metric: 'sum_duration',
  window_seconds: 60,
});

/**
 * Merge a parsed JSON object with the defaults so partial files
 * still yield a valid config. The merge is shallow on the three
 * known keys; unknown keys are dropped. The `behaviours` key is
 * the new canonical name; `neurons` is accepted as an alias for
 * backwards compatibility (older configs listed per-neuron rows).
 */
export function mergeConfig(parsed) {
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_CONFIG };
  const cfg = { ...DEFAULT_CONFIG };
  const list = Array.isArray(parsed.behaviours) ? parsed.behaviours
             : Array.isArray(parsed.neurons)   ? parsed.neurons
             : null;
  if (list && list.every((n) => typeof n === 'string')) {
    cfg.behaviours = list;
  }
  if (parsed.metric === 'count' || parsed.metric === 'sum_duration') cfg.metric = parsed.metric;
  if (typeof parsed.window_seconds === 'number' && parsed.window_seconds >= 0) {
    cfg.window_seconds = parsed.window_seconds;
  }
  return cfg;
}

/**
 * BrainStats — in-memory aggregator. One instance per window.
 *
 * The buffer is a sorted array of `{tag, t}` entries, keyed by
 * arrival order. We do not sort on insert; the recent-window
 * filter runs from the back of the array and stops as soon as it
 * sees a too-old entry. For our scale (a few hundred entries per
 * minute) this is O(W) per query, where W is the window size in
 * events — well under the 10 Hz render cadence.
 *
 * Sum-duration semantics: the contribution of an event at index i
 * is the time delta to the next event at index i+1 (or "now" for
 * the most recent event). The lifetime total is the sum of all
 * these deltas; the recent total is the same restricted to events
 * whose `t >= now - windowMs`. This is the standard "fraction of
 * time spent in state" estimator.
 */
export class BrainStats {
  constructor(config = DEFAULT_CONFIG) {
    this.config = mergeConfig(config);
    this.events = [];   // [{tag, t}], t in ms (wall clock or performance.now)
  }

  /** Push one state event. Append-only; the recent-window query
   *  filters by `t` so we keep the full lifetime buffer. The
   *  expected growth is ~10 events/s × 1 hr ≈ 36k entries (~1.8 MB
   *  in V8), which is well below the renderer's per-frame budget. */
  push(tag, t) {
    if (typeof tag !== 'string' || typeof t !== 'number') return;
    this.events.push({ tag, t });
  }

  /**
   * Swap the config without losing the existing event buffer.
   * The renderer calls this on every config hot-reload so the user
   * can change the metric or the window size without resetting the
   * lifetime totals they've already accumulated.
   */
  replaceConfig(next) {
    this.config = mergeConfig(next);
  }

  /**
   * Compute lifetime + recent aggregates for a single neuron at
   * the supplied `now` (ms). Returns `{lifetime, recent}` in the
   * metric's natural unit: integer count for `count`, seconds for
   * `sum_duration`.
   *
   * The "time spent in state X" semantics: each interval between
   * two consecutive events (and the open-ended tail) is attributed
   * to the state of the *later* event, because that is the state
   * that was active at the end of the interval. So:
   *
   *     events:    T_0 ── T_1 ── T_2 ── ... ── T_n
   *     interval:        [0,1)  [1,2)         [n,now)
   *     state at:        T_1    T_2   ...     T_n
   *
   * For `sum_duration` the time delta goes to T_{i+1}. For `count`
   * the count goes to T_i (the event itself is the count).
   *
   * When `now` is not supplied, the aggregator uses the timestamp
   * of the most recent event in the buffer (clamped to
   * `Date.now()`). This lets pure-Node tests push synthetic event
   * times without having to fabricate a matching wall clock.
   */
  aggregatesFor(name, now) {
    const events = this.events;
    if (typeof now !== 'number') {
      now = events.length > 0 ? events[events.length - 1].t : Date.now();
      if (now > Date.now()) now = Date.now();
    }
    const tag = TAG_FOR_NEURON[name];
    if (!tag) return { lifetime: 0, recent: 0 };
    const windowMs = this.config.window_seconds * 1000;
    const recentCutoff = now - windowMs;
    const useDuration = this.config.metric === 'sum_duration';

    let lifetime = 0;
    let recent = 0;

    // For each event i with matching tag, count=1; for duration,
    // add (events[i+1].t - events[i].t) to T_{i+1} (the later tag).
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.tag !== tag) continue;
      if (!useDuration) {
        lifetime += 1;
        if (e.t >= recentCutoff) recent += 1;
        continue;
      }
      const next = events[i + 1];
      // Interval is (e.t, next.t]; the "later" event sets the state,
      // so the interval's duration belongs to T_{i+1}. If next.tag
      // matches, this event's hold time is added to the match total.
      if (next && next.tag === tag) {
        lifetime += next.t - e.t;
        if (next.t >= recentCutoff) recent += Math.min(next.t - e.t, next.t - Math.max(e.t, recentCutoff));
      }
    }
    // The last event contributes the open-ended tail (now - last.t)
    // to its own tag.
    if (useDuration && events.length > 0) {
      const last = events[events.length - 1];
      if (last.tag === tag) {
        const tail = now - last.t;
        lifetime += tail;
        if (last.t >= recentCutoff) recent += Math.min(tail, now - Math.max(last.t, recentCutoff));
      }
    }
    if (useDuration) {
      lifetime = lifetime / 1000;
      recent = recent / 1000;
    }
    return { lifetime, recent };
  }

  /**
   * Compute lifetime + recent aggregates per behavioural tag (the
   * `state.tag` value: walk / fly / idle / groom / sleep / eat / court).
   * The renderer uses this to build the per-behaviour chart.
   *
   * Same "later-tag" semantics as `aggregatesFor`: an interval
   * between two events is attributed to the *later* event's tag.
   *
   * Returns `{lifetime, recent}` where each is an object keyed by
   * tag. The numeric unit is the metric's natural unit (count or
   * seconds). The renderer is responsible for global-share
   * normalisation at render time.
   */
  totalsByTag(now) {
    const events = this.events;
    if (typeof now !== 'number') {
      now = events.length > 0 ? events[events.length - 1].t : Date.now();
      if (now > Date.now()) now = Date.now();
    }
    const windowMs = this.config.window_seconds * 1000;
    const recentCutoff = now - windowMs;
    const useDuration = this.config.metric === 'sum_duration';

    const lt = Object.create(null);
    const rt = Object.create(null);

    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const next = events[i + 1];
      if (useDuration) {
        // Interval (e.t, next.t] is attributed to next.tag (if next exists)
        if (next) {
          if (!(next.tag in lt)) { lt[next.tag] = 0; rt[next.tag] = 0; }
          lt[next.tag] += next.t - e.t;
          if (next.t >= recentCutoff) {
            rt[next.tag] += Math.min(next.t - e.t, next.t - Math.max(e.t, recentCutoff));
          }
        }
      } else {
        // Count metric: the event itself is the count, attributed to
        // its own tag.
        if (!(e.tag in lt)) { lt[e.tag] = 0; rt[e.tag] = 0; }
        lt[e.tag] += 1;
        if (e.t >= recentCutoff) rt[e.tag] += 1;
      }
    }
    // The last event contributes the open-ended tail to its own tag.
    if (useDuration && events.length > 0) {
      const last = events[events.length - 1];
      if (!(last.tag in lt)) { lt[last.tag] = 0; rt[last.tag] = 0; }
      const tail = now - last.t;
      lt[last.tag] += tail;
      if (last.t >= recentCutoff) {
        rt[last.tag] += Math.min(tail, now - Math.max(last.t, recentCutoff));
      }
    }
    if (useDuration) {
      for (const t in lt) { lt[t] = lt[t] / 1000; rt[t] = rt[t] / 1000; }
    }
    return { lifetime: lt, recent: rt };
  }

  /**
   * Count of state events of each tag that fall within the recent
   * window. Independent of the metric (always an integer count).
   * Used for the right-hand "recent count" column in the bar chart.
   */
  recentCountsByTag(now) {
    const events = this.events;
    if (typeof now !== 'number') {
      now = events.length > 0 ? events[events.length - 1].t : Date.now();
      if (now > Date.now()) now = Date.now();
    }
    const windowMs = this.config.window_seconds * 1000;
    const recentCutoff = now - windowMs;
    const counts = Object.create(null);
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.t < recentCutoff) continue;
      counts[e.tag] = (counts[e.tag] || 0) + 1;
    }
    return counts;
  }
}
