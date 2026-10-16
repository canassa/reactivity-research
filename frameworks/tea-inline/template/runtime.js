// The tea-inline runtime: what every compiled app shares, whatever it contains.
//
// - DOM helpers: elements built once, then bindings write text, properties and attributes
//   only when the value differs.
// - Batching: actions schedule bindings; one microtask flush runs each scheduled binding once.
// - Conditional blocks (`when`) and keyed lists (`list`), the only structural changes.

// ---------------------------------------------------------------------------------------------
// Batching

let pending = new Set();
let done = null;

// Schedule bindings: functions, or (nested) arrays of them. `undefined` entries are skipped,
// so a widget nobody reads can pass its empty `readers`.
export function schedule(...work) {
  for (const f of work.flat(Infinity)) if (f) pending.add(f);
  done ||= Promise.resolve().then(flush);
}

// Run every scheduled binding once (bindings scheduled meanwhile run in the same flush).
export function flush() {
  done = null;
  for (const f of pending) {
    pending.delete(f);
    f();
  }
}

// Resolved once the DOM reflects everything scheduled so far.
export function settled() {
  return done || Promise.resolve();
}

// Drop pending work (on unmount).
export function cancel() {
  pending.clear();
}

// ---------------------------------------------------------------------------------------------
// DOM

// A new element with its static attributes and text, appended to `parent` when given.
export function el(tag, parent, attrs, content) {
  const node = document.createElement(tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  if (content != null) node.textContent = content;
  parent?.append(node);
  return node;
}

export function text(node, value) {
  value = String(value);
  if (node.textContent !== value) node.textContent = value;
}

// A live property: value, checked, disabled.
export function prop(node, key, value) {
  if (node[key] !== value) node[key] = value;
}

export function attr(node, key, value) {
  if (node.getAttribute(key) !== value) node.setAttribute(key, value);
}

export function on(node, type, handler) {
  node.addEventListener(type, handler);
}

// A conditional block: `node`, built once in place, swaps with an empty text node to hide it.
// `show(cond)` puts whichever should be in the page in the place of the other (a no-op when it
// already is: `replaceWith` does nothing on a node out of the page).
export function when(node) {
  const anchor = new Text();
  return (cond) => (cond ? anchor : node).replaceWith(cond ? node : anchor);
}

// ---------------------------------------------------------------------------------------------
// Keyed lists

// A keyed list owning every child of `parent`. `items()` reads the array from the model;
// `row(item)` builds a row once and returns `{ node, set(item) }`.
//
// The list is itself a binding. Actions that edit the array in place record what they did
// (`add`, `drop`, `patch`), and the flush applies just those rows. When the array itself was
// replaced (a server push, a snapshot, a derived list), the flush falls back to a full keyed
// reconcile: rows are reused by key, the rows of keys that left are removed, and the rest are
// put in order from the last one up, moving only a row not already followed by the right one
// (so a list that only lost or gained rows moves none, and a reversed run moves all but one).
export function list(parent, items, key, row) {
  let rows = new Map();
  let last;
  let edits = [];

  const make = (item) => {
    const r = row(item);
    r.set(item);
    rows.set(key(item), r);
    return r.node;
  };

  const binding = () => {
    const xs = items();
    if (xs === last) {
      for (const e of edits) e();
    } else {
      const old = rows;
      rows = new Map();
      const nodes = [];
      for (const item of xs) {
        const k = key(item);
        const r = old.get(k);
        if (r) {
          old.delete(k);
          r.set(item);
          rows.set(k, r);
          nodes.push(r.node);
        } else nodes.push(make(item));
      }
      for (const r of old.values()) r.node.remove();
      let next = null;
      for (let i = nodes.length; i--; ) {
        const node = nodes[i];
        if (node.parentNode !== parent || node.nextSibling !== next) parent.insertBefore(node, next);
        next = node;
      }
    }
    edits = [];
    last = xs;
  };

  const edit = (e) => {
    edits.push(e);
    schedule(binding);
  };
  binding.add = (item) => edit(() => parent.append(make(item)));
  binding.drop = (k) => edit(() => {
    rows.get(k).node.remove();
    rows.delete(k);
  });
  binding.patch = (item) => edit(() => rows.get(key(item)).set(item));
  return binding;
}
