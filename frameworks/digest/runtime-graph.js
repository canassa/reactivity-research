// The digest runtime for a sheet of derived values (derived-graph).
//
// Same strategy as the other digest runtimes (plain mutable state; bindings are closures that
// write one DOM property when the value they compute changed; an event runs its handler, then a
// local digest), applied to an app that is one model:
// - the sheet is ONE binding list. Its formulas (`calc`) and its displays are bindings in unit
//   order, and any formula may read any earlier cell, so there is no boundary to cut the list
//   along: an event on the sheet re-runs all of it. That costs O(N) calls per event, so
//   ./rr check fails its locality (see frameworks/digest/README.md, "derived-graph").
// - the items section is another list (the keyed rows' reconciler, which re-runs every row's
//   own list); a row control digests only its row's list, then the handler digests the sheet by
//   hand when the edit changes an item the sheet reads.

let B; // the bindings being collected: a widget's list, or one keyed item's while it is created
let E; // the elements of the template being created (a widget's, or one keyed item's), by position
let D; // the page element
let P; // the position of the element the last binding was made on (bindings come in document order)
let L; // the widgets' lists, to digest once the page is built

// X: the control an event came from, which handlers read.
export let X;

export const go = (b) => {
  for (const f of b) f();
};

const el = (tag, html) => {
  const n = document.createElement(tag);
  n.innerHTML = html;
  return n;
};

// Give the controls of a template (its buttons, inputs and selects, in document order) their
// handlers, in the same order, and their list `b`.
const on = (n, h, b, i = 0) => {
  for (const c of n.querySelectorAll("button,input,select")) (c.h = h[i++]), (c.b = b);
};

// Write `n[k] = f()` whenever f() changes (`k` is an input's value unless given). A binding names
// its element `n` by its distance `d` from the previous binding's element: a template's bindings
// are made in document order. An element that is not in the template is given as `n`.
export const bind = (d, f, k = "value", n = E[(P += d)], last) => B.push(() => (last !== (last = f()) || n[k] != last) && (n[k] = last));
export const text = (d, f, n) => bind(d, f, "textContent", n);

// A formula: recomputed in its place in the list, writes no DOM.
export const calc = (f) => B.push(f);

// A keyed list in element `p` (`d` as for bind): `items()` gives the current items (each with an
// `id`). An item is an element `tag` made from `html`, with `data-key` and `data-role=role`;
// `make(r)` registers its bindings, which read `r.i`, the item's current value, and returns the
// handlers of its controls, which belong to the item's own list.
export const list = (d, items, tag, role, html, make, p = E[(P += d)], map = new Map(), proto = el(tag, html)) =>
  B.push(() => {
    const old = map;
    map = new Map();
    for (const i of items()) {
      let r = old.get(i.id);
      if (r) old.delete(i.id);
      else {
        // Items are created during a digest, after every widget has been made, so B, E and P are
        // free to collect the item's.
        r = { b: (B = []), n: proto.cloneNode(true) };
        r.n.dataset.key = i.id;
        r.n.dataset.role = role;
        E = r.n.querySelectorAll("*");
        P = 0;
        on(r.n, make(r), B);
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

// Create a section `key` from its template (heading first), with the handlers of its controls in
// document order, and make it the one being created: the bindings that follow refer to its
// elements by position (0 is the heading). Returns its list.
export const widget = (key, html, ...h) => {
  const x = el("section", html);
  x.dataset.key = x.dataset.role = key;
  L.push((B = []));
  on(x, h, B);
  D.append(x);
  E = x.querySelectorAll("*");
  P = 0;
  return B;
};

// One delegated handler for clicks and input, on the page element. Handlers read the control
// from X, so a checkbox's click and input events (both fire) agree.
const onEvent = (e) => (X = e.target).h && (X.h(), go(X.b));

// The program: `main()` builds the app's state and widgets and returns `receive(msg)`, which
// applies an external event and digests what it touched.
export const app = (main) => {
  let receive;
  return {
    mount(root) {
      L = [];
      D = el("div", "");
      D.dataset.role = "page";
      receive = main();
      L.forEach(go);
      D.addEventListener("click", onEvent);
      D.addEventListener("input", onEvent);
      root.append(D);
    },
    receive: (m) => receive(m),
    // The listeners are on the page element, so removing it removes them.
    dispose() {
      D.remove();
      B = E = D = L = X = receive = null;
    },
  };
};
