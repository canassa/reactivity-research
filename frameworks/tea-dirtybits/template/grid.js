// Helpers of the tea-dirtybits apps made of data tables (a prototype; only big-table includes
// this file). A table's rows are dynamic data, so each table has two kinds of dirty bits:
//
//   the table's:  rows 1 (any change to the list: reconcile it), selected 2, gone 4 (rows removed),
//                 moved 8 (two rows swapped), added 16 (rows appended);
//   a row's cells: one bit per data column from 32 up (`bits & -32` is "some cells changed").
//
// An arm returns `[bits, fields, payload]`: the payload names the rows an event touched (ids for
// gone and moved, rows for added and cells), so the patch costs what changed, not the row count.
// A second event of one tick files bit 1: the list reconcile then covers everything.

// ---------------------------------------------------------------------------------------------
// The table body: a keyed set of rows. `row()` builds a detached record `[tr, item, …bound
// elements]`, `fill(record, item, bits)` is the table's static row patch, `mark(tr, on)` writes
// the selection marker. Returns the table's patch `(fields, bits, payload)` and `rowOf(el)`, the
// current item of the row an element is in.
export function grid(body, row, fill, mark) {
  let recs = new Map();
  let sel;
  const make = (item) => {
    const r = row();
    r[1] = item;
    r[0].dataset.key = item.id;
    fill(r, item, -1);
    return r;
  };
  // The whole list: new items get rows, changed items are patched, gone rows are removed and one
  // walk moves only the nodes out of place.
  const sync = (items) => {
    const next = new Map();
    let hits = 0;
    for (const item of items) {
      let r = recs.get(item.id);
      if (r) {
        hits++;
        if (r[1] !== item) fill(r, (r[1] = item), -1);
      } else r = make(item);
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
      if (bits & 1) sync(s.rows);
      else if (bits & 4) {
        for (const id of p) {
          const r = recs.get(id);
          if (r) r[0].remove(), recs.delete(id);
        }
      } else if (bits & 8) {
        const a = recs.get(p[0])[0], b = recs.get(p[1])[0], after = b.nextSibling;
        body.insertBefore(b, a);
        body.insertBefore(a, after);
      } else if (bits & 16) {
        for (const item of p) {
          const r = make(item);
          recs.set(item.id, r);
          body.append(r[0]);
        }
      } else if (bits & -32) {
        for (const item of p) {
          const r = recs.get(item.id);
          if (r) fill(r, (r[1] = item), bits);
        }
      }
      if (mark && bits & 3) {
        const r = recs.get(s.selected);
        if (r !== sel) {
          if (sel) mark(sel[0], false);
          if (r) mark(r[0], true);
          sel = r;
        }
      }
  };
}

// The id of the row an element is in (a row's controls send it with their message).
export const idOf = (el) => +el.closest("tr").dataset.key;

// A row's static markup, parsed once; each row is a clone, `bind` finds its bound elements.
export function clone(source, bind) {
  const t = document.createElement("template");
  t.innerHTML = source;
  const proto = t.content.firstChild;
  return () => bind(proto.cloneNode(true));
}

