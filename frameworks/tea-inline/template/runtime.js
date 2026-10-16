// The tea-inline runtime: what every compiled app shares, whatever it contains.
//
// - DOM helpers: elements built once, then bindings write text and properties
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
  return Promise.resolve(done);
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

// A live property: a form control's value unless `key` names another (checked, disabled, or a
// reflected ARIA state: ariaPressed, …).
export function prop(node, value, key = "value") {
  if (node[key] !== value) node[key] = value;
}

// A listener: for clicks unless `type` says otherwise.
export function on(node, handler, type = "click") {
  node.addEventListener(type, handler);
}

// A conditional block: `node`, built once in place, swaps with an empty text node (made on first
// use and kept on the node) to hide it. `when(node, cond)` puts whichever should be in the page in
// the place of the other (a no-op when it already is: `replaceWith` does nothing on a node out of
// the page).
export function when(node, cond) {
  const anchor = (node.anchor ||= new Text());
  (cond ? anchor : node).replaceWith(cond ? node : anchor);
}

// ---------------------------------------------------------------------------------------------
// Keyed lists

// A keyed list (by \`item.id\`) owning every child of \`parent\`. \`items()\` reads the array from
// the model; \`row(item)\` builds a row once and returns \`[node, set(item)]\`, \`set\` being the
// row's binding (an action that edits an item in place schedules its row's \`set\` itself).
//
// The list is itself a binding, for when the array itself was replaced (a server push, a
// snapshot, a derived list): a full keyed reconcile, where rows are reused by id, the rows of ids
// that left are removed, and one forward pass puts the rest in order: a row already in place
// stays, any other is moved before the first row not yet placed (so a list that only lost or
// gained rows moves none, and a reversed run moves all but one). Actions that add or remove an
// item in place schedule just that row's edit (\`add\`, \`drop\`) instead; an edit that a reconcile
// in the same flush already made is skipped.
export function list(parent, items, row) {
  let rows = new Map();
  let last;

  const binding = () => {
    const xs = items();
    if (xs !== last) {
      const old = rows;
      rows = new Map();
      const nodes = [];
      for (const item of xs) {
        const r = old.get(item.id) || row(item);
        old.delete(item.id);
        r[1](item);
        rows.set(item.id, r);
        nodes.push(r[0]);
      }
      for (const r of old.values()) r[0].remove();
      let at = parent.firstChild;
      for (const node of nodes) node === at ? (at = at.nextSibling) : parent.insertBefore(node, at);
    }
    last = xs;
  };

  binding.add = (item) => schedule(() => {
    if (rows.has(item.id)) return;
    const r = row(item);
    r[1](item);
    rows.set(item.id, r);
    parent.append(r[0]);
  });
  binding.drop = (k) => schedule(() => {
    rows.get(k)?.[0].remove();
    rows.delete(k);
  });
  return binding;
}
