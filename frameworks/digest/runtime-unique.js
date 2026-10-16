// The digest runtime for apps where every widget is its own component (unique-components).
//
// Same strategy as runtime.js: a widget is plain mutable state plus its list of bindings. A
// binding is a closure that writes one DOM property when the value it computes differs from
// the last one it wrote. An event runs the widget's own handler, then that widget's bindings
// only (a local digest). A widget that reads other widgets adds its bindings to theirs (`dep`).
//
// What differs: there are no kinds, so nothing here knows what a widget does. A widget's
// compiled code creates its section from a template (`widget`), then registers its own
// bindings against the template's elements, by position. The helpers below are generic DOM and
// list mechanics.

let B; // the bindings being collected: the widget's, or one list item's while it is created
let E; // the elements of the template being created (a widget's, or one list item's), by position
let D; // the dashboard element
let P; // the position of the element the last binding was made on (bindings come in document order)
let id; // the id of the widget being created: `w` and its number I in page order
let I;

// By widget id: the record of its fields that other code reads (O) and its bindings (W; the list
// also carries the setter that replaces the widget's whole state, `W[k].s`). T: the time-driven
// fields' tick functions. S: the state a setter assigns, and X: the control a handler reads (they
// read them instead of taking an argument, so none needs a parameter of its own).
export let O, W, T, S, X;

// Digest a binding list: `run(W[k])` digests widget k after its state changed, its bindings
// and its readers'. `run(W[k], v)` first replaces the widget's whole state with `v`, through its
// setter.
export const run = (b, v) => {
  v && ((S = v), b.s());
  for (const f of b) f();
};

const el = (tag, html) => {
  const n = document.createElement(tag);
  n.innerHTML = html;
  return n;
};

// Give the controls of a template (its buttons, inputs and selects, in document order) their
// handlers, in the same order, and the binding list `b` of their widget. The delegated listener
// calls the target's handler, then digests its list.
const on = (n, h, b, i = 0) => {
  for (const c of n.querySelectorAll("button,input,select")) (c.h = h[i++]), (c.b = b);
};

// Write `n[k] = f()` whenever f() changes (`k` is an input's value unless given). A binding names
// its element `n` by its distance `d` from the previous binding's element: a template's bindings
// are made in document order.
export const bind = (d, f, k = "value", last, n = E[(P += d)]) => B.push(() => last !== (last = f()) && (n[k] = last));
export const text = (d, f) => bind(d, f, "textContent");

// Keep element `n` (`d` as for bind) in its place only while f() holds; a hidden node leaves an
// empty text node.
export const show = (d, f, last, n = E[(P += d)], c = new Text()) =>
  B.push(() => last !== (last = !!f()) && (last ? c.replaceWith(n) : n.replaceWith(c)));

// A keyed list in element `p` (`d` as for bind): `items()` gives the current items (each with
// an `id`). An item is an `<li data-key data-role=role>` made from `html`; `make(r)` registers
// its bindings, which read `r.i`, the item's current value, and returns the handlers of the
// item's controls.
export const list = (d, items, role, html, make, p = E[(P += d)], map = new Map(), w = B) =>
  B.push(() => {
    const old = map;
    map = new Map();
    for (const i of items()) {
      let r = old.get(i.id);
      if (r) old.delete(i.id);
      else {
        // Items are created during a digest, after every widget has registered its bindings,
        // so B and E are free to collect the item's.
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
      run(r.b);
    }
  });

// Small helpers for handlers.
export const nx = (a, v) => a[(a.indexOf(v) + 1) % a.length];
// A new item gets the next id and is not done (a list without checkboxes never reads `done`).
export const add = (l, text) => l.push({ id: Math.max(0, ...l.map((i) => i.id)) + 1, text, done: false });
// A list from its items' texts, as arguments; the ids are 1, 2, …
export const L = (...a) => a.map((text, i) => ({ id: i + 1, text }));
// A checkable list from a bit mask of the done items (bit i: item i), then its items' texts.
export const C = (m, ...a) => a.map((text, i) => ({ id: i + 1, text, done: !!(m & (1 << i)) }));

// Create the widget's section, with `set`, the setter of its whole state, then the handlers of its
// controls in document order, then its template (its heading and content, the last argument),
// and make it the one being created: the bindings that follow refer to its elements by position
// (0 is the heading). The setter's defaults are the initial state: it is called once while S
// is empty. A widget with a feed list puts the record `notify` pushes into in O itself.
export const widget = (set, ...h) => {
  const x = el("section", h.pop());
  x.dataset.role = "widget";
  x.dataset.key = id;
  on(x, h, (W[id] = B = []));
  D.append(x);
  (B.s = set)();
  E = x.querySelectorAll("*");
  P = 0;
};

// This widget's bindings also run after the given widgets change. A widget reads earlier
// widgets, named by their distance back from it.
export const dep = (...d) => {
  for (const k of d) W["w" + (I - k)].push(...B);
};

// One delegated handler for clicks and input, on the dashboard element. Handlers read the
// control from X, so a checkbox's click and input events (both fire) agree. Only the
// widget the event came from is digested.
const onEvent = (e) => (X = e.target).h && (X.h(), run(X.b));

// The program: `defs` is one widget function per widget, in page order (ids w1, w2, …);
// `receive(msg)` applies an external event and digests the widgets it touched (with `run`).
export const app = (defs, receive) => ({
  mount(root) {
    O = {};
    S = {};
    W = {};
    T = [];
    I = 0;
    D = el("div", "");
    D.dataset.role = "dashboard";
    for (const f of defs) (id = "w" + ++I), f();
    for (const k in W) run(W[k]);
    D.addEventListener("click", onEvent);
    D.addEventListener("input", onEvent);
    root.append(D);
  },
  receive,
  // The listeners are on the dashboard element, so removing it removes them.
  dispose() {
    D.remove();
    B = E = O = W = T = D = null;
  },
});
