// The tea-inline runtime for derived graphs (derived-graph only; the other scenarios do not
// include it): formulas that are computed once per change, in dependency order, with an equality
// cut-off. Generic, independent of any formula or scenario; counted as runtime.
//
// - A formula is a `node`: a function that recomputes one value and, only when it changed, queues
//   the formulas that read it and paints the displays that read it. Nodes are made in dependency
//   order (a formula reads only earlier cells), so their creation order is their rank.
// - `queue` puts formulas in rank order, each once; `paint` collects the displays that read
//   several values. One flush runs the queued formulas, lowest rank first (a formula that two
//   queued formulas feed runs after both), then the collected displays: every formula runs at
//   most once per flush and every display after the values it reads are final.

import { schedule } from "./runtime.js";

let count = 0;
let queued = [];
let painted = new Set();
let armed = false;

export const node = (f) => ((f.r = ++count), f);

const arm = () => {
  armed ||= (schedule(drain), true);
};

// Queue formulas (each once; an insertion keeps the queue in rank order).
export function queue(...fs) {
  for (const f of fs) {
    if (f.q) continue;
    f.q = true;
    let at = queued.length;
    while (at && queued[at - 1].r > f.r) at--;
    queued.splice(at, 0, f);
  }
  arm();
}

// Collect displays to run after the formulas.
export function paint(...displays) {
  for (const d of displays) painted.add(d);
  arm();
}

function drain() {
  try {
    while (queued.length) {
      const f = queued.shift();
      f.q = false;
      f();
    }
    for (const d of painted) {
      painted.delete(d);
      d();
    }
  } finally {
    // After a throw too: the graph must not stay armed with stale flags, or it never flushes again.
    reset();
  }
}

// Drop pending work (on unmount).
export function reset() {
  for (const f of queued) f.q = false;
  queued = [];
  painted.clear();
  armed = false;
}

// The cut-off of a list-valued formula: the same items (or numbers) in the same order.
export const same = (a, b) => a.length === b?.length && a.every((x, i) => x === b[i]);

// Parse `html` into `parent`; return its elements in document order, those nothing refers to
// (labels, options) left out, so code refers to an element by its place: `E[n]`.
export function part(parent, html) {
  parent.insertAdjacentHTML("beforeend", html);
  return parent.querySelectorAll(":not(label,option)");
}
