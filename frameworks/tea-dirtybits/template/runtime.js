// The tea-dirtybits runtime (a prototype; no framework ships it). Shared by every app:
// - the TEA loop: messages go through one reducer, which marks dirty bits for what it writes;
//   one microtask later the view's static patch runs only the bindings whose bits are set;
// - helpers the compiled DOM factories call: elements, text, guarded property and attribute
//   writes, conditional content and keyed lists (with Solid 2's reconcileArrays as fallback).
import { reconcileArrays } from "./reconcile.js";

// ---------------------------------------------------------------------------------------------
// Dirty bits. A component's reducer arm calls mark(FIELD) for each field it writes; the app's
// reducer takes those bits and files them under the component instance (touch).

let bits = 0;
let dirty = {};

export function mark(b) {
  bits |= b;
}

export function take() {
  const b = bits;
  bits = 0;
  return b;
}

export function touch(id, b) {
  dirty[id] |= b;
}

// ---------------------------------------------------------------------------------------------
// The loop. `view(root, model, send)` builds the DOM once and returns `patch(model, dirty)`.

export function program(root, model, update, view) {
  let pending = null;
  dirty = {};
  const send = (msg) => {
    model = update(model, msg);
    pending ||= Promise.resolve().then(() => {
      const d = dirty;
      dirty = {};
      pending = null;
      if (patch) patch(model, d);
    });
  };
  let patch = view(root, model, send);
  return {
    send,
    settled: () => pending || Promise.resolve(),
    dispose() {
      patch = null;
      root.textContent = "";
    },
  };
}

// ---------------------------------------------------------------------------------------------
// DOM construction (run once per component) and bindings (run when their bits are set).

// An element appended to `parent` (or detached when `parent` is null), with its data-role.
export function element(parent, tag, role) {
  const n = document.createElement(tag);
  if (parent) parent.appendChild(n);
  if (role) n.setAttribute("data-role", role);
  return n;
}

export function text(parent, value) {
  return parent.appendChild(document.createTextNode(value));
}

export function setText(node, value) {
  value = String(value);
  if (node.data !== value) node.data = value;
}

// A DOM property (value, checked, disabled), written only when it differs, so an input being
// typed into keeps its caret.
export function prop(n, key, value) {
  if (n[key] !== value) n[key] = value;
}

export function attr(n, name, value) {
  if (n.getAttribute(name) !== value) n.setAttribute(name, value);
}

export function on(n, type, handler) {
  n.addEventListener(type, handler);
}

// Conditional content, always the last child of `parent`: `make(parent)` appends it when it
// appears. Returns `show(on)`, which returns the node while it is shown.
export function when(parent, make) {
  let node = null;
  return (show) => {
    if (show && !node) node = make(parent);
    else if (!show && node) {
      node.remove();
      node = null;
    }
    return node;
  };
}

// A keyed list (by item.id) filling `parent`. `row(item)` builds a detached row once and returns
// { node, patch(item) }. Rows whose item changed are patched; when the order of nodes changed
// (adds, removes, reorders) the full keyed reconcile runs.
export function list(parent, row) {
  let rows = new Map();
  let nodes = [];
  return (items) => {
    const next = new Map();
    const order = items.map((item) => {
      let r = rows.get(item.id);
      if (!r) r = row(item);
      else if (r.item !== item) r.patch(item);
      r.item = item;
      next.set(item.id, r);
      return r.node;
    });
    if (order.length !== nodes.length || order.some((n, i) => n !== nodes[i])) {
      if (nodes.length) reconcileArrays(parent, nodes, order, null);
      else parent.append(...order);
    }
    rows = next;
    nodes = order;
  };
}

// Conditional content among its siblings (unique-components), kept in place by an empty comment.
// `make()` builds the content detached and returns [node, patch?], where `patch(s, d, w)` is the
// content's own static patch. The returned `show(on, s, d, w)` adds the content (patching it with
// every bit), removes it, or, while it stays, runs its patch with the dirty bits `d`.
export function branch(parent, make) {
  const anchor = parent.appendChild(document.createComment(""));
  let node = null;
  let patch;
  return (show, s, d, w) => {
    if (show && !node) {
      [node, patch] = make();
      patch?.(s, -1, w);
      parent.insertBefore(node, anchor);
    } else if (!show && node) {
      node.remove();
      node = null;
    } else if (node) patch?.(s, d, w);
  };
}
