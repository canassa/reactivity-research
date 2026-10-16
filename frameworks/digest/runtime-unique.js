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
let id;

// By widget id: the state (S) and the bindings (W). T: the time-driven fields' tick functions.
export let S, W, T;

const run = (b) => {
  for (const f of b) f();
};

// Digest one widget after its state changed: its bindings and its readers'.
export const up = (k) => run(W[k]);

const el = (tag, html) => {
  const n = document.createElement(tag);
  n.innerHTML = html;
  return n;
};

// Give the controls of a template (its buttons, inputs and selects, in document order) their
// handlers, in the same order. The delegated listener calls the target's handler.
const on = (n, h, i = 0) => {
  for (const c of n.querySelectorAll("button,input,select")) c.h = h[i++];
};

// Write `E[i][k] = f()` whenever f() changes.
export const bind = (i, k, f, last, n = E[i]) => B.push(() => last !== (last = f()) && (n[k] = last));
export const text = (i, f) => bind(i, "textContent", f);

// Keep element `i` in its place only while f() holds; a hidden node leaves an empty text node.
export const show = (i, f, last, n = E[i], c = new Text()) =>
  B.push(() => last !== (last = !!f()) && (last ? c.replaceWith(n) : n.replaceWith(c)));

// A keyed list in element `i`: `items()` gives the current items (each with an `id`). An item is
// an `<li data-key data-role=role>` made from `html`; `make(r)` registers its bindings, which
// read `r.i`, the item's current value, and returns the handlers of the item's controls.
export const list = (i, items, role, html, make, p = E[i], map = new Map()) =>
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
        on(r.n, make(r));
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
export const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const nx = (a, v) => a[(a.indexOf(v) + 1) % a.length];
export const add = (l, text, done) => l.push({ id: Math.max(0, ...l.map((i) => i.id)) + 1, text, done });
// A list from its items' texts, or [text, done] pairs; the ids are 1, 2, …
export const L = (a) => a.map((x, i) => (typeof x == "string" ? { id: i + 1, text: x } : { id: i + 1, text: x[0], done: !!x[1] }));

// Create the widget's section from `html` (its heading and content), with state `s` and `h`, the
// handlers of its controls in document order, and make it the one being created: the bindings
// that follow refer to its elements by position (0 is the heading).
export const widget = (html, s, h) => {
  const x = el("section", html);
  x.dataset.key = id;
  x.dataset.role = "widget";
  on(x, h);
  D.append(x);
  S[id] = s;
  W[id] = x.b = B = [];
  E = x.querySelectorAll("*");
};

// This widget's bindings also run after the given widgets change.
export const dep = (...ids) => {
  for (const k of ids) W[k].push(...B);
};

// One delegated handler for clicks and input, on the dashboard element. Handlers read the
// element they are given, so a checkbox's click and input events (both fire) agree. Only the
// widget the event came from is digested.
const onEvent = ({ target: t }) => {
  if (t.h) {
    t.h(t);
    run(t.closest("[data-role=widget]").b);
  }
};

// The program: `defs` is one widget function per widget, in page order (ids w1, w2, …);
// `receive(msg)` applies an external event and digests the widgets it touched (with `up`).
export const app = (defs, receive) => ({
  mount(root) {
    S = {};
    W = {};
    T = [];
    D = el("div", "");
    D.dataset.role = "dashboard";
    defs.forEach((f, i) => {
      id = "w" + (i + 1);
      f();
    });
    for (const k in W) up(k);
    D.addEventListener("click", onEvent);
    D.addEventListener("input", onEvent);
    root.append(D);
  },
  receive,
  // The listeners are on the dashboard element, so removing it removes them.
  dispose() {
    D.remove();
    B = E = S = W = T = D = null;
  },
});
