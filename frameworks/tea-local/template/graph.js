// Additions to the tea-local runtime for derived graphs (the derived-graph scenario only; an app
// of another scenario never gets this file): component instances that other instances can read,
// run in dependency order, and the delegated events of a table's rows.
//
// The strategy is the same as `instance` in runtime.js: a cell keeps its model in its closure,
// `send(tag, a, b)` runs the arm of that constructor and then the cell's `patch` (its binding
// list) is scheduled, and so is whoever watches the cell. What the sheet adds is an order. A
// formula reads cells that were made before it, so the rank a cell gets when it is made is a
// topological order of the graph, and the flush runs the scheduled jobs by rank. A job that is
// scheduled while the flush runs always ranks after the one running, so a cell is recomputed
// once, after every cell it reads has settled (no stale read, no repeated recompute in a diamond).

import { wire } from "./runtime.js";

// Jobs (a cell's patch, a formula's refresh) waiting for the flush, in rank order. A job is
// queued once (`q`); the first one queues the flush. The running job stays at the front until it
// is done, so what it schedules never queues a second flush (`settled` in runtime.js waits for
// the one microtask).
const pending = [];

function schedule(job) {
  if (job.q) return;
  job.q = true;
  if (!pending.length) queueMicrotask(flush);
  let i = pending.length;
  while (i && pending[i - 1].r > job.r) i--;
  pending.splice(i, 0, job);
}

function flush() {
  let error, failed;
  while (pending.length) {
    const job = pending[0];
    job.q = false;
    try {
      job();
    } catch (e) {
      // One failing job must not wedge the queue: the rest still run, the first error is rethrown.
      if (!failed) [failed, error] = [true, e];
    }
    pending.shift();
  }
  if (failed) throw error;
}

// Forget the queued jobs (on dispose).
export function reset() {
  for (const job of pending) job.q = false;
  pending.length = 0;
}

let ranks = 0;

// A cell: `update[tag](model, a, b)` is the reducer's arm for a constructor. `quiet` lists the
// tags whose arms change nothing that the readers read (a compile-time analysis of the arms
// against the readers, one bit per arm): the cell's own patch runs after them, the readers are
// not told. `typed` lists the tags that take what the user typed: when such an arm rejects the
// value the controls are left alone. A cell that is only
// read has no patch. Returns the instance: its model `m`, `send`, `set` (replace the model) and
// the two jobs a reader subscribes (`refresh` runs the formula's message 0, `patch` the binding
// list), kept in `w`, the list of the jobs to run when the model changes.
export function cell(model, update, patch = () => {}, quiet = [], typed = []) {
  const rank = ++ranks;
  const w = [];
  // `repaint`: the model is the same but the controls may not show it (an external write, a
  // clamped step), so the binding list runs; its writes are skipped when nothing differs.
  const set = (next, mute, repaint) => {
    if (next === self.m) { // a value that did not change tells nobody
      if (repaint) schedule(patch);
      return;
    }
    self.m = next;
    schedule(patch);
    if (!mute) for (const job of w) schedule(job);
  };
  const refresh = () => set(update[0](self.m));
  refresh.r = rank;
  patch.r = rank + 0.5;
  const self = {
    m: model,
    w,
    patch,
    refresh,
    set: (next) => set(next, false, true),
    // A typed value that is rejected leaves the model, and what the user typed, alone (`typed`).
    send: (tag, a, b) => set(update[tag](self.m, a, b), quiet.includes(tag), !typed.includes(tag)),
  };
  schedule(patch); // the first render, in the flush after mount
  return self;
}

// A formula: a cell whose only message is `derive(model)` → its new value, sent to it whenever
// a cell it reads (`sources`) changes. Its binding list also runs when a cell that is only
// displayed (`shown`) changes. The first value comes in the flush after mount, in rank order.
export function formula(derive, patch, sources, shown) {
  const self = cell(undefined, [derive], patch);
  for (const s of sources) s.w.push(self.refresh);
  for (const s of shown) s.w.push(self.patch);
  schedule(self.refresh);
  return self;
}

// A unit's markup, inserted as the last child of `parent`; its controls (if `self` is given) send
// the cell's messages 0, 1, 2, … in document order. Returns the unit's elements, root first.
export function unit(parent, html, self) {
  parent.insertAdjacentHTML("beforeend", html);
  const root = parent.lastChild;
  return self ? wire(root, self, 1) : [root, ...root.querySelectorAll("*")];
}
