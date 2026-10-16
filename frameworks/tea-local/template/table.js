// Additions to the tea-local runtime for keyed tables (the big-table scenario only; an app of
// another scenario never gets this file): a keyed list whose rows are DOM nodes and that can be
// asked for a row by key, the selection marker, and one delegated listener for a table's rows.

// A keyed list owning every child of `parent` (a table body), keyed by `item.id` (written as the
// row's `data-key`). A row is its node: `build(item)` returns a detached `<tr>` and `patch(row,
// item)` writes an item into it. Rows whose item object changed are patched in place. When the
// sequence of rows changed, the rows that left are removed and the rest are placed with the
// fewest moves: the rows whose old positions already increase (a longest increasing subsequence)
// stay where they are, and each other row is inserted before its successor, walking from the end.
// A swap moves two nodes, an insertion or a removal none. The returned function takes the items;
// its `get(id)` is the row node of a key.
export function keyed(parent, build, patch) {
  let rows = new Map();
  const update = (items) => {
    const next = new Map();
    const nodes = parent.childNodes;
    const was = []; // each row's position in the previous order, -1 for a new row
    let moved = items.length !== nodes.length;
    for (const item of items) {
      let r = rows.get(item.id);
      if (!r) {
        r = build(item);
        r.dataset.key = item.id;
        r.at = -1;
      }
      if (r.item !== item) patch(r, (r.item = item));
      rows.delete(item.id);
      moved ||= r !== nodes[next.size];
      was.push(r.at);
      r.at = next.size;
      next.set(item.id, r);
    }
    if (moved) {
      for (const r of rows.values()) r.remove();
      // The rows to leave alone: the longest increasing run of old positions (patience sorting).
      const ends = [], from = [];
      was.forEach((w, i) => {
        if (w < 0) return;
        let lo = 0, hi = ends.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          was[ends[mid]] < w ? (lo = mid + 1) : (hi = mid);
        }
        from[i] = lo ? ends[lo - 1] : -1;
        ends[lo] = i;
      });
      const still = new Set();
      for (let i = ends.length ? ends[ends.length - 1] : -1; i >= 0; i = from[i]) still.add(i);
      let before = null;
      let i = was.length;
      for (const r of [...next.values()].reverse()) {
        if (!still.has(--i)) parent.insertBefore(r, before);
        before = r;
      }
    }
    rows = next;
  };
  update.get = (id) => rows.get(id);
  return update;
}

// The selection marker: moves it from the row `prev` to the row `next` (either may be absent)
// when they differ, and returns the row that has it.
export function mark(prev, next, attr, value) {
  if (prev !== next) {
    prev?.removeAttribute(attr);
    next?.setAttribute(attr, value);
  }
  return next;
}

// The events of a table's rows, delegated to its body (one listener, not one per row): a click
// on a row's control (a link, a button or a checkbox) sends the message `base + the column`,
// with the row's key as its argument. A compiler numbers a row's messages that way: the control
// of column i is the constructor `base + i`.
export function rowEvents(body, self, base) {
  body.addEventListener("click", (e) => {
    const control = e.target.closest("a,button,input");
    if (control) self.send(base + control.closest("td").cellIndex, +control.closest("tr").dataset.key);
  });
}
