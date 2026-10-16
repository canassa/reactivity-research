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
  return [
    (s, bits, p) => {
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
    },
    (el) => recs.get(+el.closest("tr").dataset.key)[1],
  ];
}

// A row's static markup, parsed once; each row is a clone, `bind` finds its bound elements.
export function clone(source, bind) {
  const t = document.createElement("template");
  t.innerHTML = source;
  const proto = t.content.firstChild;
  return () => bind(proto.cloneNode(true));
}

// ---------------------------------------------------------------------------------------------
// Row edits the reducers share. Each returns an arm's `[bits, fields, payload]`.

// The index of a row in the table's rows: by identity (one native scan), or by id when the
// message carries an older version of the row.
export function at(rows, row) {
  const i = rows.indexOf(row);
  return i < 0 ? rows.findIndex((r) => r.id === row.id) : i;
}

// One row edited: `f(row)` returns its new fields.
export function edit(s, row, bits, f) {
  const i = at(s.rows, row);
  const next = { ...s.rows[i], ...f(s.rows[i]) };
  return [bits, { rows: s.rows.with(i, next) }, [next]];
}

// Every k-th row (from the first) edited.
export function every(s, k, bits, f) {
  const rows = s.rows.slice();
  const edited = [];
  for (let i = 0; i < rows.length; i += k) edited.push((rows[i] = { ...rows[i], ...f(rows[i]) }));
  return [bits, { rows }, edited];
}

// Rows i and j swapped, when there are more than j rows.
export function swap(s, i, j) {
  const rows = s.rows;
  if (rows.length <= j) return;
  const next = rows.slice();
  next[i] = rows[j];
  next[j] = rows[i];
  return [8, { rows: next }, [rows[i].id, rows[j].id]];
}

// The rows `gone(row)` names removed, and the selection with them.
export function drop(s, gone) {
  const ids = s.rows.filter(gone).map((r) => r.id);
  return [6, { rows: s.rows.filter((r) => !gone(r)), selected: ids.includes(s.selected) ? null : s.selected }, ids];
}

// The selection, if one of the rows still has it.
export const kept = (rows, id) => (rows.some((r) => r.id === id) ? id : null);

export const maxId = (rows) => rows.reduce((max, r) => Math.max(max, r.id), 0);

// ---------------------------------------------------------------------------------------------
// Cell formats. No locale APIs, so every language formats alike.

export const group = (n) => ("" + n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export const money = (symbol, cents) => symbol + group(Math.floor(cents / 100)) + "." + ("" + (cents % 100)).padStart(2, "0");
export const pct = (tenths) => group(Math.floor(tenths / 10)) + "." + (tenths % 10) + "%";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// A day of the year (1-365) as [month index, day of the month].
const monthDay = (day) => {
  let m = 0;
  while (day > DAYS[m]) day -= DAYS[m++];
  return [m, day];
};
export const monD = (day) => {
  const [m, d] = monthDay(day);
  return MONTHS[m] + " " + d;
};
export const dMon = (day) => {
  const [m, d] = monthDay(day);
  return d + " " + MONTHS[m];
};
export const mmDd = (day) => {
  const [m, d] = monthDay(day);
  return ("" + (m + 1)).padStart(2, "0") + "-" + ("" + d).padStart(2, "0");
};
