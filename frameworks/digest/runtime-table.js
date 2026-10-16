// The digest runtime for apps made of data tables (big-table).
//
// Same strategy as the other digest runtimes (plain mutable state; bindings are closures that
// write one DOM property when the value they compute changed; an event runs its handler, then a
// local digest), with the binding lists cut along the table's own seams:
// - a table has one list, with one binding in it: the one that reconciles its rows (membership
//   and order). An operation on the table (a toolbar button, a server event) digests that list.
// - a row has its own list, made with the row. A row control (select, toggle, bump) digests only
//   its row's list, so it costs the same with 10 rows as with 10,000. A handler that touches
//   more rows (every k-th, a server update) digests the lists of those rows by itself.
// - the table's list digests a row's list only when the row is new or its object was replaced
//   (a server page, a snapshot), never because the table was digested. In-place edits digest
//   their rows explicitly, so nothing re-checks every row.
// Tables share no state, so nothing is wired between lists (no dependencies at all).

let B; // the bindings being collected: a table's list, or one row's while it is created
let E; // the elements of the row being created, by position
let D; // the page element
let P; // the position of the element the last binding was made on (bindings come in document order)
let T; // the table body of the table being created
let I; // the number of the table being created, in page order (its id is `t` and I)

// W: by table id, the table's state `o`, its records by row id `m` and its list `b`. X: the
// control an event came from, which handlers read.
export let W, X;

export const go = (b) => {
  for (const f of b) f();
};

const el = (tag, html) => {
  const n = document.createElement(tag);
  n.innerHTML = html;
  return n;
};

// Give the controls of a template (its links, buttons and checkboxes, in document order) their
// handlers, in the same order, and the number of their list `b`.
const on = (n, h, b, i = 0) => {
  for (const c of n.querySelectorAll("a,button,input")) (c.h = h[i++]), (c.b = b);
};

// Write `n[k] = f()` whenever f() changes. A binding names its element `n` by its distance `d`
// from the previous binding's element: a row's bindings are made in document order.
export const bind = (d, f, k, last, n = E[(P += d)]) => B.push(() => last !== (last = f()) && (n[k] = last));
export const text = (d, f) => bind(d, f, "textContent");

// Create a table's section from its template (heading, toolbar, header and an empty body), with
// the handlers of its toolbar buttons in document order. `o` is its state, `m` the records of
// its rows. Returns the table's list, which the bindings created next fill.
export const table = (o, m, html, ...h) => {
  const x = el("section", html);
  x.dataset.key = "t" + ++I;
  x.dataset.role = "table";
  W[x.dataset.key] = { o, m, b: (B = []) };
  T = x.querySelector("tbody");
  on(x, h, B);
  D.append(x);
  return B;
};

// The table's rows, keyed by `id` in its body. A row is a `<tr>` cloned from `html`; `make(r)`
// registers its bindings, which read `r.i`, the row's current object, and returns the handlers
// of its controls, which belong to the row's own list. A table with a selection also gets the
// marker (`k`: the property, `v`: its value, `off`: its value when not selected).
export const rows = (o, m, html, make, k, v, off, p = T, proto = el("tr", html), y = 0) => {
  proto.dataset.role = "row";
  B.push(() => {
    y++;
    // The nodes are put in order as the rows are walked. A node out of place whose next
    // sibling is the row's is left where it is (it moves when its own row comes), so swapping
    // two rows moves two nodes.
    let c = p.firstChild;
    for (const i of o.rows) {
      let r = m.get(i.id);
      if (!r) {
        // Rows are created during a digest, after every table has registered its bindings, so
        // B and E are free to collect the row's.
        m.set(i.id, (r = { b: (B = []), n: proto.cloneNode(true) }));
        r.n.dataset.key = i.id;
        E = r.n.querySelectorAll("*");
        P = 0;
        on(r.n, make(r), B);
        k && bind(0, () => (o.selected === r.i.id ? v : off), k, off, r.n);
      }
      r.g = y;
      if (r.i !== i) (r.i = i), go(r.b);
      r.n === c ? (c = c.nextSibling) : c && c.nextSibling === r.n ? (c = r.n.nextSibling) : p.insertBefore(r.n, c);
    }
    if (m.size > o.rows.length) for (const [id, r] of m) r.g < y && (r.n.remove(), m.delete(id));
    // The selection goes with its row.
    m.has(o.selected) || (o.selected = null);
  });
};

// One delegated handler for clicks and input, on the page element. A control's handler reads the
// control from X, so a checkbox's click and input events (both fire) agree; a click on the
// glyph inside a link is the link's.
const onEvent = (e) => (X = e.target.closest("a,button,input")) && X.h && (X.h(), go(X.b));

// The program: `defs` is one function per table, in page order (ids t1, t2, …); `receive(msg)`
// applies an external event and digests what it touched.
export const app = (defs, receive) => ({
  mount(root) {
    W = {};
    I = 0;
    D = el("div", "");
    D.dataset.role = "page";
    for (const f of defs) f();
    for (const k in W) go(W[k].b);
    D.addEventListener("click", onEvent);
    D.addEventListener("input", onEvent);
    root.append(D);
  },
  receive,
  // The listeners are on the page element, so removing it removes them.
  dispose() {
    D.remove();
    B = E = T = W = D = X = null;
  },
});
