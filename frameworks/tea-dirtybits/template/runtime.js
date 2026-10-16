// The tea-dirtybits runtime (a prototype; no framework ships it). Shared by every app:
// - the TEA loop: messages go through one reducer, which marks dirty bits for what it writes;
//   one microtask later the view's static patch runs only the bindings whose bits are set;
// - helpers the compiled DOM factories call: static templates, events that send a message,
//   guarded text and property writes, conditional content and keyed lists (with Solid 2's
//   reconcileArrays as fallback).
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
// The loop. `view(root, model)` builds the DOM once and returns `patch(model, dirty)`. `send`
// is the running program's: event handlers import it.

export let send;

export function program(root, model, update, view) {
  let pending = null;
  dirty = {};
  send = (msg) => {
    model = update(model, msg);
    pending ||= Promise.resolve().then(() => {
      const d = dirty;
      dirty = {};
      pending = null;
      if (patch) patch(model, d);
    });
  };
  let patch = view(root, model);
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

const T = document.createElement("template");

// A component's static markup, parsed once and appended to `parent` (or left detached): its
// root element and every element inside it, in document order, so the compiled code finds a
// node by its position.
export function html(source, parent) {
  T.innerHTML = source;
  const node = T.content.firstChild;
  if (parent) parent.append(node);
  return [node, ...node.querySelectorAll("*")];
}

// Events that send a message to a widget, like Elm's `onClick Msg` and `onInput Msg`. A click or
// a checkbox change sends a constant message (with the item's id in a list row), built once
// when the event is wired; an input sends the control's value.
export function onClick(n, widget, type, id) {
  const msg = { widget, type, id };
  n.addEventListener("click", () => send(msg));
}

export function onCheck(n, widget, type, id) {
  const msg = { widget, type, id };
  n.addEventListener("change", () => send(msg));
}

export function onInput(n, widget, type) {
  n.addEventListener("input", () => send({ widget, type, value: n.value }));
}

// An element's text, written only when it differs.
export function setText(n, value) {
  value = String(value);
  if (n.textContent !== value) n.textContent = value;
}

// A DOM property (value, checked, disabled), written only when it differs, so an input being
// typed into keeps its caret.
export function prop(n, key, value) {
  if (n[key] !== value) n[key] = value;
}

export function attr(n, name, value) {
  if (n.getAttribute(name) !== value) n.setAttribute(name, value);
}

// Conditional content, built once with the rest of its component. The returned
// `show(on, s, d, w)` swaps it for an empty comment when it hides, puts it back (patched with
// every bit) when it shows, and while it stays runs its own static `patch(s, d, w)`.
export function branch(node, patch) {
  const anchor = new Comment();
  let shown = true;
  return (show, s, d, w) => {
    if (show) {
      if (!shown) {
        anchor.replaceWith(node);
        d = -1;
      }
      patch?.(s, d, w);
    } else if (shown) node.replaceWith(anchor);
    shown = show;
  };
}

// A keyed list (by item.id) filling `parent`. `row(item)` builds a detached row once and returns
// [node, patch(item)]. New rows and rows whose item changed are patched; when the order of nodes
// changed (adds, removes, reorders) the full keyed reconcile runs.
export function list(parent, row) {
  let rows = new Map();
  let nodes = [];
  return (items) => {
    const next = new Map();
    const order = items.map((item) => {
      const r = rows.get(item.id) || row(item);
      if (r.item !== item) r[1](item);
      r.item = item;
      next.set(item.id, r);
      return r[0];
    });
    if (order.length !== nodes.length || order.some((n, i) => n !== nodes[i])) {
      if (nodes.length) reconcileArrays(parent, nodes, order, null);
      else parent.append(...order);
    }
    rows = next;
    nodes = order;
  };
}
