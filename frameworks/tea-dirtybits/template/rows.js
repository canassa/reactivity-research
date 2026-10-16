// Row edits of the tea-dirtybits big-table apps (scenario code, counted as app): the reducer helpers
// every table's arms share. Each returns an arm's `[bits, fields, payload]` (bits: see grid.js).

// The index of the row with this id, or -1 (a click on a row an earlier event of the same tick
// removed): the row arms do nothing then.
export const at = (rows, id) => rows.findIndex((r) => r.id === id);

// One row edited: `f(row)` returns its new fields.
export function edit(s, id, bits, f) {
  const i = at(s.rows, id);
  if (i < 0) return;
  const next = { ...s.rows[i], ...f(s.rows[i]) };
  return [bits, { rows: s.rows.with(i, next) }, [next]];
}

// One row removed (and the selection, if it was the row).
export function cut(s, id) {
  const i = at(s.rows, id);
  if (i < 0) return;
  return [6, { rows: s.rows.toSpliced(i, 1), selected: s.selected === id ? null : s.selected }, [id]];
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

