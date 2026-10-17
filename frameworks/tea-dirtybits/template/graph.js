// Helpers of the tea-dirtybits apps whose cells form a graph of derived values (a prototype; only
// derived-graph includes this file). The page is a table of cells, `cells[g]`, in an order in which
// every cell comes after the cells it reads: formulas, displays and controls. A cell's dirty bit is
// its number g (bit g % 31 of word g / 31 of `d`).
//
//   - An arm marks the bits of the cells that read the field it wrote (`touch`).
//   - A flush sweeps the words in ascending order and runs each marked cell once. A formula
//     recomputes its value and, only when the value changed, marks the cells that read it; a display
//     writes its text. Marks always point forward, so one sweep settles the graph.

import { send } from "./runtime.js";

// ---------------------------------------------------------------------------------------------
// Dirty bits.

export const d = [];

// The lowest and highest word marked since the last sweep: a sweep walks only that range.
let lo = Infinity, hi = -1;

export const touch = (cells) => {
  for (const g of cells) {
    const k = (g / 31) | 0;
    d[k] |= 1 << g % 31;
    if (k < lo) lo = k;
    if (k > hi) hi = k;
  }
};

// Every one of the first n cells (a mount, a snapshot).
export function markAll(n) {
  for (let g = 0; g < n; g++) d[(g / 31) | 0] |= 1 << g % 31;
  lo = 0;
  hi = Math.max(hi, ((n - 1) / 31) | 0);
}

// Run every marked cell once, in ascending order of g (the lowest set bit of each word first).
// Marks made while sweeping always point forward, so the range only grows at its top.
export function sweep(cells, s) {
  for (let k = lo; k <= hi; k++) {
    for (let m; (m = d[k]); ) {
      const b = m & -m;
      d[k] ^= b;
      cells[k * 31 + Math.log2(b)](s);
    }
  }
  lo = Infinity;
  hi = -1;
}

// ---------------------------------------------------------------------------------------------
// Events. A control sends a numbered message to the app's reducer.

export function onClick(n, type) {
  const msg = { type };
  n.addEventListener("click", () => send(msg));
}

export function onInput(n, type) {
  n.addEventListener("input", () => send({ type, value: n.value }));
}

// A number input sends only an integer within [min, max]; anything else stays as typed.
export function onInt(n, type, min, max) {
  n.addEventListener("input", () => {
    const value = n.valueAsNumber;
    if (Number.isInteger(value) && value >= min && value <= max) send({ type, value });
  });
}
