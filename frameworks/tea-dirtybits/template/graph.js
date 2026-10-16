// Helpers of the tea-dirtybits apps whose cells form a graph of derived values (a prototype; only
// derived-graph includes this file). The page is a table of cells, `cells[g]`, in an order in which
// every cell comes after the cells it reads: formulas, displays and controls. A cell's dirty bit is
// its number g (bit g % 31 of word g / 31 of `d`).
//
//   - An arm marks the bits of the cells that read the field it wrote (`touch`).
//   - A flush sweeps the words in ascending order and runs each marked cell once. A formula
//     recomputes its value and, only when the value changed, marks the cells that read it; a display
//     writes its text. Marks always point forward, so one sweep settles the graph.

import { send, setText } from "./runtime.js";

// ---------------------------------------------------------------------------------------------
// Dirty bits.

export const d = [];

export const touch = (cells) => {
  for (const g of cells) d[(g / 31) | 0] |= 1 << g % 31;
};

// Every one of the first n cells (a mount, a snapshot).
export function markAll(n) {
  for (let g = 0; g < n; g++) d[(g / 31) | 0] |= 1 << g % 31;
}

// Run every marked cell once, in ascending order of g (the lowest set bit of each word first).
export function sweep(cells, s) {
  for (let k = 0; k < d.length; k++) {
    for (let m; (m = d[k]); ) {
      const b = m & -m;
      d[k] ^= b;
      cells[k * 31 + Math.log2(b)](s);
    }
  }
  d.length = 0;
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

// ---------------------------------------------------------------------------------------------
// Lists of derived values. Both write guarded texts, so only the text that differs touches the DOM.

// A keyed list of items (`<li data-key=id data-role=roleItem>`): the returned `(items, text)`
// writes every row's text (a row's key may change with a scalar cell although the item did not),
// builds the rows of new items, removes the rows of gone ones and moves only the misplaced nodes.
export function ranked(parent, role) {
  let rows = new Map();
  return (items, text) => {
    const next = new Map();
    for (const item of items) {
      let li = rows.get(item.id);
      if (!li) {
        li = document.createElement("li");
        li.dataset.key = item.id;
        li.dataset.role = role + "Item";
      }
      setText(li, text(item));
      next.set(item.id, li);
    }
    for (const [id, li] of rows) if (!next.has(id)) li.remove();
    let at = parent.firstChild;
    for (const li of next.values()) {
      if (li === at) at = at.nextSibling;
      else parent.insertBefore(li, at);
    }
    rows = next;
  };
}

// One row per category (`<li data-key=category data-role=roleRow>`); the returned `(group, format)`
// writes them.
export function groups(ul, role, cats) {
  const rows = cats.map((c) => {
    const li = document.createElement("li");
    li.dataset.key = c;
    li.dataset.role = role + "Row";
    ul.append(li);
    return li;
  });
  return (g, format) => rows.forEach((li, k) => setText(li, cats[k] + ": " + format(g[cats[k]])));
}

// ---------------------------------------------------------------------------------------------
// The items table: a keyed set of rows, each a clone of one template. `row()` builds a detached
// record `[tr, item, …bound elements]`, `fill(record, item, bits, markup)` is the row's static
// patch. Dirty bits of the table: reconcile 1, gone 4, added 16, and one bit per cell group of a
// row from 32 up (the row patch tests them); 256 is the markup, which every row reads. The
// payload `p` names the rows an event touched (ids for gone, items for added and edited cells).
// A second event of one tick files bit 1, which covers both.
export function table(body, row, fill) {
  let recs = new Map();
  const make = (item, s) => {
    const r = row();
    r[1] = item;
    r[0].dataset.key = item.id;
    fill(r, item, -1, s.markup);
    return r;
  };
  // The whole list: new items get rows, changed items are patched, gone rows are removed and one
  // walk moves only the nodes out of place.
  const sync = (s) => {
    const next = new Map();
    let hits = 0;
    for (const item of s.items) {
      let r = recs.get(item.id);
      if (r) {
        hits++;
        if (r[1] !== item) fill(r, (r[1] = item), -1, s.markup);
      } else r = make(item, s);
      next.set(item.id, r);
    }
    if (hits) {
      for (const [id, r] of recs) if (!next.has(id)) r[0].remove();
    } else body.textContent = "";
    let cur = body.firstChild;
    for (const r of next.values()) {
      if (r[0] === cur) cur = cur.nextSibling;
      else body.insertBefore(r[0], cur);
    }
    recs = next;
  };
  return (s, bits, p) => {
    if (bits & 1) sync(s);
    else if (bits & 4) {
      for (const id of p) {
        const r = recs.get(id);
        if (r) r[0].remove(), recs.delete(id);
      }
    } else if (bits & 16) {
      for (const item of p) {
        const r = make(item, s);
        recs.set(item.id, r);
        body.append(r[0]);
      }
    } else if (bits & 224) {
      for (const item of p) {
        const r = recs.get(item.id);
        if (r) fill(r, (r[1] = item), bits, s.markup);
      }
    }
    if (bits & 256) for (const r of recs.values()) fill(r, r[1], 256, s.markup);
  };
}

// The id of the row an element is in.
export const idOf = (el) => +el.closest("tr").dataset.key;

// A row's static markup, parsed once; each row is a clone, `bind` finds its bound elements.
export function clone(source, bind) {
  const t = document.createElement("template");
  t.innerHTML = source;
  const proto = t.content.firstChild;
  return () => bind(proto.cloneNode(true));
}
