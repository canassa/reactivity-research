// The digest runtime for apps made of one big component (big-component).
//
// Same strategy as runtime-unique.js (plain mutable state; bindings are closures that write one
// DOM property when the value they compute changed; an event runs its handler, then a local
// digest), with one difference: the component is split into many small binding lists, one per
// section and per fieldset, and an event digests only the list of the control it came from,
// plus the lists that read what that control writes. Which lists those are is a compile-time
// fact, wired by `dep(source, ...readers)`: no list is copied into another, so a reader list is
// not followed by its own readers.

let B; // the bindings being collected: a list's, or one list item's while it is created
let E; // the elements of the template being created (a component's, or one list item's), by position
let D; // the page element
let P; // the position of the element the last binding was made on (bindings come in document order)
let I; // the number of the widget being created, in page order (its id is `w` and I)
let Q; // the number of the list bindings are being made in

// A: the binding lists, numbered in page order. R: for each list, the numbers of the lists that
// read what its controls write. W: by widget id, its setter `s` and its lists `lo` to `hi`.
// T: the time-driven fields' tick functions. S: the state a setter assigns, X: the control a
// handler reads, O: the records of fields other code reaches by name (feed lists).
export let O, W, T, S, X, A, R;

const go = (b) => {
  for (const f of b) f();
};

// Digest list n and its readers' lists after its state changed.
export const run = (n) => {
  go(A[n]);
  for (const r of R[n]) go(A[r]);
};

// Digest every list of a widget, and the lists reading it, after replacing the widget's whole state with `v`, through its
// setter (no `v`: just the lists).
export const all = (w, v) => {
  v && ((S = v), w.s());
  const s = new Set();
  for (let i = w.lo; i < w.hi; i++) for (const r of [i, ...R[i]]) s.add(A[r]);
  s.forEach(go);
};

// The bindings that follow go in list n.
export const to = (n) => (B = A[(Q = n)]);

// The lists that read what a control of list s writes.
export const dep = (s, ...r) => R[s].push(...r);

const el = (tag, html) => {
  const n = document.createElement(tag);
  n.innerHTML = html;
  return n;
};

// Give the controls of a template (its buttons, inputs and selects, in document order) their
// handlers, in the same order, and the number of their list `b`. A number among the handlers
// moves the following controls to that list.
const on = (n, h, b, i = 0) => {
  for (const c of n.querySelectorAll("button,input,select")) {
    while (typeof h[i] == "number") b = h[i++];
    (c.h = h[i++]), (c.b = b);
  }
};

// Write `n[k] = f()` whenever f() changes (`k` is an input's value unless given). A binding names
// its element `n` by its distance `d` from the previous binding's element: a template's bindings
// are made in document order.
export const bind = (d, f, k = "value", last, n = E[(P += d)]) => B.push(() => (last !== (last = f()) || n[k] != last) && (n[k] = last));
export const text = (d, f) => bind(d, f, "textContent");

// Keep element `n` (`d` as for bind) in its place only while f() holds; a hidden node leaves an
// empty text node.
export const show = (d, f, last, n = E[(P += d)], c = new Text()) =>
  B.push(() => last !== (last = !!f()) && (last ? c.replaceWith(n) : n.replaceWith(c)));

// A keyed list in element `p` (`d` as for bind): `items()` gives the current items (each with
// an `id`). An item is an `<li data-key data-role=role>` made from `html`; `make(r)` registers
// its bindings, which read `r.i`, the item's current value, and returns the handlers of the
// item's controls, which belong to the list the keyed list is in.
export const list = (d, items, role, html, make, p = E[(P += d)], map = new Map(), w = Q) =>
  B.push(() => {
    const old = map;
    map = new Map();
    for (const i of items()) {
      let r = old.get(i.id);
      if (r) old.delete(i.id);
      else {
        // Items are created during a digest, after every list has been made, so B and E are
        // free to collect the item's.
        r = { b: (B = []), n: el("li", html) };
        r.n.dataset.key = i.id;
        r.n.dataset.role = role;
        E = r.n.children;
        P = 0;
        on(r.n, make(r), w);
      }
      r.i = i;
      map.set(i.id, r);
    }
    for (const r of old.values()) r.n.remove();
    let c = p.firstChild;
    for (const r of map.values()) {
      r.n === c ? (c = c.nextSibling) : p.insertBefore(r.n, c);
      go(r.b);
    }
  });

// Small helpers for handlers.
// The option after v (the first after the last), the options as arguments.
export const nx = (v, ...a) => a[(a.indexOf(v) + 1) % a.length];
// A new item gets the next id and is not done (a list without checkboxes never reads `done`).
export const add = (l, text) => l.push({ id: Math.max(0, ...l.map((i) => i.id)) + 1, text, done: false });
// A list from its items' texts, as arguments; the ids are 1, 2, …
export const L = (...a) => a.map((text, i) => ({ id: i + 1, text }));
// A checkable list from a bit mask of the done items (bit i: item i), then its items' texts.
export const C = (m, ...a) => a.map((text, i) => ({ id: i + 1, text, done: !!(m & (1 << i)) }));

// Create the widget's section with `n` binding lists, the setter of its whole state, then the
// handlers of its controls in document order (numbers move to another list, the first list
// being the widget's first), then its template (its heading and content, the last argument),
// and make it the one being created: the bindings that follow refer to its elements by
// position (0 is the heading). The setter's defaults are the initial state: it is called once
// while S is empty.
export const widget = (set, n, ...h) => {
  const x = el("section", h.pop());
  x.dataset.role = "widget";
  const lo = A.length;
  for (let i = 0; i < n; i++) A.push([]), R.push([]);
  on(x, h, lo);
  D.append(x);
  (W[(x.dataset.key = "w" + ++I)] = { s: set, lo, hi: A.length }).s();
  to(lo);
  E = x.querySelectorAll("*");
  P = 0;
};

// One delegated handler for clicks and input, on the page element. Handlers read the control
// from X, so a checkbox's click and input events (both fire) agree. Only the control's list and
// its readers are digested.
const onEvent = (e) => (X = e.target).h && (X.h(), run(X.b));

// The program: `defs` is one widget function per widget, in page order (ids w1, w2, …);
// `receive(msg)` applies an external event and digests what it touched.
export const app = (defs, receive) => ({
  mount(root) {
    O = {};
    S = {};
    W = {};
    T = [];
    A = [];
    R = [];
    I = 0;
    D = el("div", "");
    D.dataset.role = "page";
    for (const f of defs) f();
    for (const k in W) all(W[k]);
    D.addEventListener("click", onEvent);
    D.addEventListener("input", onEvent);
    root.append(D);
  },
  receive,
  // The listeners are on the page element, so removing it removes them.
  dispose() {
    D.remove();
    B = E = O = W = T = A = R = D = null;
  },
});
