// The digest runtime: compiled dirty checking.
//
// A widget is plain mutable state plus a list of bindings. A binding is a closure that reads
// the state and writes one DOM property when the value it computes differs from the last one
// it wrote. Every event (a DOM event or an external message) runs its handler, which mutates
// the state, and then one digest: every binding of the app runs once. There is no dependency
// tracking, no virtual DOM and no scheduler; derived values (a summary reading three widgets)
// are just bindings that read more state.
//
// Keyed lists are bindings too: they reconcile their items by `id` and run each item's own
// bindings. Conditional content is a binding that inserts or removes one node.

let B; // the bindings being collected: the app's, or one list item's while it is created
let X; // the section of the widget being created
let D; // the dashboard element

// Instance state by widget id, and what other widgets may read of a widget (`m`: its metric,
// `p`: its phrase) or call on it (`t`: on tick).
export let S, E;

const run = (b) => b.forEach((f) => f());

export const el = (tag, html) => {
  const n = document.createElement(tag);
  n.innerHTML = html;
  return n;
};

// The element with data-role `r` in the widget being created.
export const role = (r) => X.querySelector(`[data-role=${r}]`);
export const roles = (r) => X.querySelectorAll(`[data-role=${r}]`);
export const $ = (sel) => X.querySelector(sel);

// Write `n[k] = f()` whenever f() changes.
export const bind = (n, k, f, last) => {
  B.push(() => last !== (last = f()) && (n[k] = last));
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
// events on elements with that role: h(element, key of the nearest data-key).
let id;
export const widget = (kind, label, html, h) => {
  X = el("section", "<h2></h2>" + html);
  X.firstChild.textContent = label;
  X.dataset.key = id;
  X.dataset.role = "widget-" + kind;
  X.h = h;
  D.append(X);
};

// One delegated handler for clicks and input, on the dashboard element. Handlers read the
// element they are given, so a checkbox's click and input events (both fire) agree.
const onEvent = ({ target: t }) => {
  const f = t.closest("section")?.h?.[t.dataset.role];
  if (f) {
    f(t, t.closest("[data-key]").dataset.key);
    run(B);
  }
};

// The program: `defs` is one [factory, ...config] per widget, in page order (ids w1, w2, …);
// `receive(msg)` applies an external event to S and E.
export const app = (defs, receive) => ({
  mount(root) {
    B = [];
    S = {};
    E = {};
    D = el("div", "");
    D.dataset.role = "dashboard";
    defs.forEach(([f, ...c], i) => {
      id = "w" + (i + 1);
      E[id] = f((S[id] = {}), ...c);
    });
    run(B);
    D.addEventListener("click", onEvent);
    D.addEventListener("input", onEvent);
    root.append(D);
  },
  receive(msg) {
    receive(msg);
    run(B);
  },
  // The listeners are on the dashboard element, so removing it removes them.
  dispose() {
    D.remove();
    B = S = E = X = D = null;
  },
});
