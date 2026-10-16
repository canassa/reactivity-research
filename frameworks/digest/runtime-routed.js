// The digest runtime for apps of pages that mount and unmount (routed-app).
//
// Same strategy as runtime-unique.js: state is plain mutable variables, a binding is a closure that
// writes one DOM property when the value it computes differs from the last one it wrote, and an
// event runs its handler and then digests the binding lists it touched. What is new is lifetime.
//
// - A *component* (the shell, a page, a tab panel, a modal, the menu) is a binding list with its
//   root node (`b.n`) and a list of cleanups (`b.u`). `widget()` creates one from a template and
//   registers it among the mounted components (`K`); `end(b)` removes its node, empties its
//   list and runs its cleanups. Navigation ends every component but the shell.
// - A component's state is the local variables of the function that creates it, so it starts
//   fresh whenever the component is created and is gone when the function's closures are.
// - A binding runs once when it is registered, so a component is complete when its function
//   returns. There is no separate first pass.
// - A source of change that is read from other components (a global field, the page's fields) is a
//   Set of the lists that read it. A component joins the sets of what it reads when it mounts
//   (`join`) and leaves them when it ends. A handler that writes a source digests its readers
//   (`up`). Only mounted components are in any set.
// - Timers and the feed subscription are registered as cleanups, so they end with their component.

let B; // the binding list being made: the component's, or one list item's while it is created
let E; // the elements of the template being made, by position
let P; // the position of the element the last binding was made on
let Q; // the lists the current event digests
let K; // the mounted components
export let A; // the app element
export { B }; // the binding list being made (the code that mounts a component returns it)
export let X; // the control the current event came from (handlers read it instead of taking an argument)
export let Fd; // the shown page's feed subscription: pushes an item into its feed list

// Digest a binding list.
const run = (b) => {
  for (const f of b) f();
};

// Run `f` (a handler, a timer, an external event), then digest the list `b` and every list it
// asked for with `up`. A list that has ended is empty.
export const act = (b, f) => {
  Q = new Set(b && [b]);
  f();
  Q.forEach(run);
};

// Digest the lists of a set (or an array) too.
export const up = (s) => s.forEach(Q.add, Q);

const reg = (f) => (B.push(f), f());

// Write `n[k] = f()` whenever f() changes (`k` is an input's value unless given). A binding names
// its element `n` by its distance `d` from the previous binding's element: a template's bindings
// are made in document order.
export const bind = (d, f, k = "value", n = E[(P += d)], last) => reg(() => last !== (last = f()) && (n[k] = last));
// A text binding writes a text node of its own at the end of the element, after the static text
// the template gives it.
export const text = (d, f) => bind(0, f, "data", E[(P += d)].appendChild(new Text()));
// An element of the template, for code that is not a binding (where a tab panel goes).
export const at = (d) => E[(P += d)];

// Keep element `n` in its place only while f() holds; a hidden node leaves an empty text node.
export const show = (d, f, last, n = E[(P += d)], c = new Text()) =>
  reg(() => last !== (last = f()) && (last ? c.replaceWith(n) : n.replaceWith(c)));

const parse = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content.firstChild;
};

// Give the controls of a template (its buttons, inputs and selects, in document order) their
// handlers, in the same order, and the binding list `b` of their component.
const on = (n, h, b, i = 0) => {
  for (const c of n.querySelectorAll("button,input,select")) (c.h = h[i++]), (c.b = b);
};

// A keyed list in element `p` (`d` as for bind): `items()` gives the current items (each with an
// `id`). An item is an `<li data-key data-role=role>` made from `html`; `make(r)` registers its
// bindings, which read `r.i`, the item's current value, and returns the handlers of the item's
// controls. `r` is the item's binding list itself, which also keeps its node (`r.n`).
export const list = (d, items, role, html, make, p = E[(P += d)], map = new Map(), w = B) =>
  reg(() => {
    const old = map;
    map = new Map();
    for (const i of items()) {
      let r = old.get(i.id);
      if (r) old.delete(i.id);
      else {
        // The item's bindings take over B, E and P while it is made.
        const s = [B, E, P];
        (r = B = []).n = parse(`<li data-key=${i.id} data-role=${role}>${html}`);
        r.i = i;
        E = r.n.children;
        P = 0;
        on(r.n, make(r), w);
        [B, E, P] = s;
      }
      r.i = i;
      map.set(i.id, r);
    }
    for (const r of old.values()) r.n.remove();
    let c = p.firstChild;
    for (const r of map.values()) {
      r.n === c ? (c = c.nextSibling) : p.insertBefore(r.n, c);
      run(r);
    }
  });

// Small helpers for handlers.
// The option after v (the first after the last), the options as arguments.
export const nx = (v, ...a) => a[(a.indexOf(v) + 1) % a.length];
// A new item gets the next id and is not done.
export const add = (l, text) => l.push({ id: Math.max(0, ...l.map((i) => i.id)) + 1, text, done: false });
// A list from its items' texts, as arguments; the ids are 1, 2, …
export const L = (...a) => a.map((text, i) => ({ id: i + 1, text }));
// A checkable list from a bit mask of the done items (bit i: item i), then its items' texts.
export const C = (m, ...a) => a.map((text, i) => ({ id: i + 1, text, done: !!(m & (1 << i)) }));

// Create a component from its template and the handlers of its controls (in document order) and
// make it the one being made: the bindings that follow refer to its elements by position (0 is
// the first element below the root). The caller puts the root node in the page.
export const widget = (html, ...h) => {
  const n = parse(html);
  (B = []).n = n;
  B.u = [];
  K.add(B);
  on(n, h, B);
  E = n.querySelectorAll("*");
  P = 0;
  return n;
};

// What the component being made does when it ends.
export const cleanup = (f) => B.u.push(f);

// The component being made reads these sets of lists: it is digested when they are.
export const join = (...a) => {
  const b = B;
  for (const s of a) s.add(b);
  cleanup(() => a.forEach((s) => s.delete(b)));
};

// Call `f` and digest the component every `ms`, until it ends.
export const every = (ms, f, b = B, id = setInterval(() => act(b, f), ms)) => cleanup(() => clearInterval(id));

// The component being made shows an incoming item: `f(item)` adds it to the page's feed list.
export const feed = (f, b = B) => {
  Fd = (i) => act(b, () => f(i));
  cleanup(() => (Fd = 0));
};

// End a component (none: nothing).
export const end = (b) => b && (K.delete(b), b.n.remove(), (b.length = 0), b.u.forEach((f) => f()));
// End every mounted component but `keep`.
export const leave = (keep) => {
  for (const b of K) b == keep || end(b);
};

// One delegated handler for clicks and input, on the app element.
const onEvent = (e) => (X = e.target).h && act(X.b, X.h);

// The program: `start()` sets the initial state and makes the shell and the first page;
// `receive(msg)` applies an external event.
export const app = (start, receive) => ({
  mount(root) {
    K = new Set();
    A = document.createElement("div");
    A.dataset.role = "app";
    A.addEventListener("click", onEvent);
    A.addEventListener("input", onEvent);
    start();
    root.append(A);
  },
  receive,
  // Ending every component stops the timers and leaves the sets; the listeners are on the app
  // element, so removing it removes them.
  dispose() {
    leave();
    A.remove();
    B = E = Q = K = A = null;
  },
});
