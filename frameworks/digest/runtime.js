// The digest runtime: compiled dirty checking, one widget at a time.
//
// A widget is plain mutable state plus its list of bindings. A binding is a closure that reads
// the state and writes one DOM property when the value it computes differs from the last one
// it wrote. An event runs its handler, which mutates one widget's state, and then that widget's
// bindings only: a local digest. A widget's list also holds the bindings of the widgets that
// read it (a summary adds its line to each source's list), so derived values follow without a
// dependency graph. There is no virtual DOM and no scheduler.
//
// Keyed lists are bindings too: they reconcile their items by `id` and run each item's own
// bindings. Conditional content is a binding that inserts or removes one node.

let B; // the bindings being collected: the widget's, or one list item's while it is created
let X; // the section of the widget being created
let D; // the dashboard element

// By widget id: the instance state (S), what other widgets may read of it (E; `m`: its metric,
// `p`: its phrase) and its bindings (W). T: the clocks' tick functions.
export let S, E, W, T;

export const run = (b) => b.forEach((f) => f());

// Digest one widget after its state changed: its bindings and its readers'.
export const up = (k) => run(W[k]);

export const el = (tag, html) => {
  const n = document.createElement(tag);
  n.innerHTML = html;
  return n;
};

// The element with data-role `r` in the widget being created.
export const role = (r) => X.querySelector(`[data-role=${r}]`);
export const roles = (r) => X.querySelectorAll(`[data-role=${r}]`);
export const $ = (sel) => X.querySelector(sel);

// Write `n[k] = f()` whenever f() changes. Returns the binding, so a widget that reads others
// can add it to their lists.
export const bind = (n, k, f, last, u) => {
  B.push((u = () => last !== (last = f()) && (n[k] = last)));
  return u;
};
export const text = (r, f) => bind(role(r), "textContent", f);

// Keep node `n` in its place (before the sibling it had in the template) only while f() holds.
export const show = (n, f, last) => {
  const p = n.parentNode, next = n.nextSibling;
  B.push(() => last !== (last = !!f()) && (last ? p.insertBefore(n, next) : n.remove()));
};

// A keyed list in `p`: `items()` gives the current items (each with an `id`), `make(r, item)`
// creates an item's element; the bindings it registers read `r.i`, the item's current value.
export const list = (p, items, make) => {
  let map = new Map();
  B.push(() => {
    const old = map;
    map = new Map();
    for (const i of items()) {
      let r = old.get(i.id);
      if (r) old.delete(i.id);
      else {
        const outer = B;
        r = { b: (B = []) };
        r.n = make(r, i);
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

// Create the widget's section: its heading and `html`. `h` maps a data-role to the handler of
// events on elements with that role: h(element, key of the nearest data-key). Returns the
// widget's binding list, which the bindings created next fill.
let id;
export const widget = (kind, label, html, h) => {
  X = el("section", "<h2></h2>" + html);
  X.firstChild.textContent = label;
  X.dataset.key = id;
  X.dataset.role = "widget-" + kind;
  X.h = h;
  D.append(X);
  return (W[id] = X.b = B = []);
};

// One delegated handler for clicks and input, on the dashboard element. Handlers read the
// element they are given, so a checkbox's click and input events (both fire) agree. Only the
// widget the event came from is digested.
const onEvent = ({ target: t }) => {
  const x = t.closest("section"), f = x?.h?.[t.dataset.role];
  if (f) {
    f(t, t.closest("[data-key]").dataset.key);
    run(x.b);
  }
};

// The program: `defs` is one [factory, ...config] per widget, in page order (ids w1, w2, …);
// `receive(msg)` applies an external event and digests the widgets it touched (with `up`).
export const app = (defs, receive) => ({
  mount(root) {
    S = {};
    E = {};
    W = {};
    T = [];
    D = el("div", "");
    D.dataset.role = "dashboard";
    defs.forEach(([f, ...c], i) => {
      id = "w" + (i + 1);
      E[id] = f((S[id] = {}), ...c);
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
    B = S = E = W = T = X = D = null;
  },
});
