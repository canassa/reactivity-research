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
// bindings. Conditional content is a binding that swaps one node with an empty text node.

let B; // the bindings being collected: the widget's, or one list item's while it is created
let N; // the elements of the template being created (a widget's, or one list item's), by position
let D; // the dashboard element

// By widget id: the setter that replaces the widget's whole state (S), what its factory returns
// for others to read (E; `m`: its metric, `p`: its phrase; a feed's record, which `notify`
// pushes into) and its bindings (W). T: the clocks' tick functions.
export let S, E, W, T;

// Digest a binding list: `run(W[k])` digests widget k after its state changed, its bindings and
// its readers'.
export const run = (b) => {
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

// Write `N[i][k] = f()` whenever f() changes. `i` is the element's position in the template (0 is
// a widget's heading).
export const bind = (i, k, f, last, n = N[i]) => B.push(() => last !== (last = f()) && (n[k] = last));
export const text = (n, f) => bind(n, "textContent", f);

// Keep element `i` in its place only while f() holds; a hidden node leaves an empty text node.
export const show = (i, f, last, n = N[i], c = new Text()) =>
  B.push(() => last !== (last = !!f()) && (last ? c.replaceWith(n) : n.replaceWith(c)));

// A keyed list in element `i`: `items()` gives the current items (each with an `id`). An item is
// an `<li data-key>` made from `html`; `make(r)` registers its bindings, which read `r.i`, the
// item's current value, and returns the handlers of the item's controls.
export const list = (i, items, html, make, p = N[i], map = new Map(), w = B) =>
  B.push(() => {
    const old = map;
    map = new Map();
    for (const i of items()) {
      let r = old.get(i.id);
      if (r) old.delete(i.id);
      else {
        // Items are created during a digest, after every widget has registered its bindings,
        // so B and N are free to collect the item's.
        r = { b: (B = []), n: el("li", html), i };
        r.n.dataset.key = i.id;
        N = r.n.children;
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

// The id of the widget being created.
export let id;

// Create the widget's section: its heading (`label`, spliced into the HTML: the emitter checks
// that it needs no escaping) and `html`, with `set`, the setter of its whole
// state, and `h`, the handlers of its controls in document order. Returns the widget's binding
// list, which the bindings created next fill.
export const widget = (kind, label, html, set, ...h) => {
  const x = el("section", `<h2>${label}</h2>` + html);
  x.dataset.key = id;
  x.dataset.role = "widget-" + kind;
  on(x, h, (W[id] = B = []));
  D.append(x);
  N = x.querySelectorAll("*");
  S[id] = set;
  return B;
};

// One delegated handler for clicks and input, on the dashboard element. Handlers read the
// element they are given, so a checkbox's click and input events (both fire) agree. Only the
// widget the event came from is digested.
const onEvent = ({ target: t }) => {
  if (t.h) {
    t.h(t);
    run(t.b);
  }
};

// The program: `defs` is one [factory, ...config] per widget, in page order (ids w1, w2, …);
// `receive(msg)` applies an external event and digests the widgets it touched (with `run`).
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
      E[id] = f(...c);
      // The first digest of the widget: its own bindings, and a summary's line (which its
      // sources, created before it, did not have yet).
      run(W[id]);
    });
    D.addEventListener("click", onEvent);
    D.addEventListener("input", onEvent);
    root.append(D);
  },
  receive,
  // The listeners are on the dashboard element, so removing it removes them.
  dispose() {
    D.remove();
    B = N = S = E = W = T = D = null;
  },
});
