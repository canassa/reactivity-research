// The digest runtime for apps where every widget is its own component (unique-components).
//
// Same strategy as runtime.js: a widget is plain mutable state plus its list of bindings. A
// binding is a closure that writes one DOM property when the value it computes differs from
// the last one it wrote. An event runs the widget's own handler, then that widget's bindings
// only (a local digest). A widget that reads other widgets adds its list to theirs (`dep`).
//
// What differs: there are no kinds, so nothing here knows what a widget does. A widget's
// compiled code creates its section from a template (`widget`), then registers its own
// bindings against the template's elements. The helpers below are generic DOM and list
// mechanics.

let B; // the bindings being collected: the widget's, or one list item's while it is created
let X; // the section of the widget being created
let D; // the dashboard element
let id;

// By widget id: the state (S) and the bindings (W). T: the time-driven fields' tick functions.
export let S, W, T;

export const run = (b) => b.forEach((f) => f());

// Digest one widget after its state changed: its bindings and its readers'.
export const up = (k) => run(W[k]);

export const el = (tag, html) => {
  const n = document.createElement(tag);
  n.innerHTML = html;
  return n;
};

// Write `n[k] = f()` whenever f() changes.
export const bind = (n, k, f, last) => B.push(() => last !== (last = f()) && (n[k] = last));
export const text = (n, f) => bind(n, "textContent", f);

// Keep node `n` in its place only while f() holds; a hidden node leaves an empty text node.
export const show = (n, f, last, c = new Text()) =>
  B.push(() => last !== (last = !!f()) && (last ? c.replaceWith(n) : n.replaceWith(c)));

// A keyed list in `p`: `items()` gives the current items (each with an `id`). An item is an
// `<li data-key data-role=role>` made from `html`; `make(r, children)` registers its bindings,
// which read `r.i`, the item's current value.
export const list = (p, items, role, html, make) => {
  let map = new Map();
  B.push(() => {
    const old = map;
    map = new Map();
    for (const i of items()) {
      let r = old.get(i.id);
      if (r) old.delete(i.id);
      else {
        const outer = B;
        r = { b: (B = []), n: el("li", html) };
        r.n.dataset.key = i.id;
        r.n.dataset.role = role;
        make(r, r.n.children);
        B = outer;
      }
      r.i = i;
      map.set(i.id, r);
    }
    old.forEach((r) => r.n.remove());
    let c = p.firstChild;
    map.forEach((r) => {
      r.n === c ? (c = c.nextSibling) : p.insertBefore(r.n, c);
      run(r.b);
    });
  });
};

// Small helpers for handlers.
export const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const nx = (a, v) => a[(a.indexOf(v) + 1) % a.length];
export const add = (l, text, done) => l.push({ id: Math.max(0, ...l.map((i) => i.id)) + 1, text, done });
// A list from its items' texts, or [text, done] pairs; the ids are 1, 2, …
export const L = (a) => a.map((x, i) => (typeof x == "string" ? { id: i + 1, text: x } : { id: i + 1, text: x[0], done: !!x[1] }));

// Create the widget's section from `html` (its heading and content) and make it the one being
// created. `h` maps a data-role to the handler of events on elements with that role:
// h(element, key of the nearest data-key). Returns all the elements of the template, in
// document order, for the widget's bindings.
export const widget = (html, s, h) => {
  X = el("section", html);
  X.dataset.key = id;
  X.dataset.role = "widget";
  X.h = h;
  D.append(X);
  S[id] = s;
  W[id] = X.b = B = [];
  return X.querySelectorAll("*");
};

// This widget's bindings also run after the given widgets change.
export const dep = (...ids) => {
  const b = B;
  ids.forEach((k) => W[k].push(() => run(b)));
};

// One delegated handler for clicks and input, on the dashboard element. Handlers read the
// element they are given, so a checkbox's click and input events (both fire) agree. Only the
// widget the event came from is digested.
const onEvent = ({ target: t }) => {
  const x = t.closest("[data-role=widget]"), f = x?.h[t.dataset.role];
  if (f) {
    f(t, t.closest("[data-key]").dataset.key);
    run(x.b);
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
    B = S = W = T = X = D = null;
  },
});
