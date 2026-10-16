// The tea-local runtime (a prototype; see frameworks/tea-local/README.md): DOM helpers,
// microtask batching, component instances with local message routing, and keyed lists.
//
// Adapted from the shared support of canassa/beni's rendering-design research (strategy C,
// "local reducers"): the same element, text and attribute helpers that skip unchanged writes, the
// same batching, and the same keyed fallback (Solid 2's reconcileArrays, see reconcile.js).
import { reconcileArrays } from "./reconcile.js";

// ---------------------------------------------------------------------------------------------
// Batching: patches run once each, in one microtask after the messages that scheduled them.

let queued = false;
let pending = new Set();

export function schedule(patch) {
  pending.add(patch);
  if (!queued) {
    queued = true;
    queueMicrotask(flush);
  }
}

function flush() {
  queued = false;
  const work = pending;
  pending = new Set();
  for (const patch of work) patch();
}

// Resolves after the pending flush (it was queued first), so the DOM is current.
export const settled = () => new Promise((resolve) => queueMicrotask(resolve));

// ---------------------------------------------------------------------------------------------
// DOM: built once (by createElement calls or from a static template); every later write is
// skipped when nothing changed.

export function element(parent, tag, attrs, content) {
  const node = document.createElement(tag);
  for (const key in attrs) node.setAttribute(key, attrs[key]);
  if (content != null) node.append(content);
  if (parent) parent.append(node);
  return node;
}

export function on(node, type, handler) {
  node.addEventListener(type, handler);
}

// Elm's `onClick msg`: the event sends a constant message to the instance.
export function onSend(node, self, msg, type = "click") {
  node.addEventListener(type, () => self.send(msg));
}

// Elm's `onInput Tag`: the event sends `[tag, node.value]` to the instance.
export function onValue(node, self, tag, type = "input") {
  node.addEventListener(type, () => self.send([tag, node.value]));
}

// A static template, parsed once: returns a function that clones its (single) root element.
export function template(html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  return () => t.content.firstChild.cloneNode(true);
}

// A dynamic text is the only child of `node`: a text node (a placeholder in the template).
export function setText(node, value) {
  node = node.firstChild;
  value = String(value);
  if (node.data !== value) node.data = value;
}

export function setAttr(node, key, value) {
  if (node.getAttribute(key) !== value) node.setAttribute(key, value);
}

export function setProp(node, key, value) {
  if (node[key] !== value) node[key] = value;
}

// Conditional content: `node` is built once and attached (as the last child of `parent`) only
// while `shown`, so its siblings are never touched.
export function show(parent, node, shown) {
  if (!shown) node.remove();
  else if (!node.parentNode) parent.append(node);
}

// ---------------------------------------------------------------------------------------------
// A component instance: its model lives in this closure. `send(msg)` runs the component's own
// reducer and schedules the instance's `patch` (its binding list) and whoever watches it.
// There is no global dispatch, no dirty bits and no dependency tracking.

export function instance(model, update, patch, config) {
  const watchers = [];
  const set = (next) => {
    if (next === self.m) return;
    self.m = next;
    schedule(patch);
    for (const watcher of watchers) schedule(watcher);
  };
  // `m` is the current model, read by the instance's patch and by its watchers.
  const self = {
    m: model,
    send: (msg) => set(update(self.m, msg, config)),
    set,
    watch: (watcher) => watchers.push(watcher),
  };
  return self;
}

// ---------------------------------------------------------------------------------------------
// A keyed list owning every child of `parent`, keyed by `item.id` (written as the row's
// `data-key`). `row(item)` builds a detached row `{ node, patch(item) }`. Rows whose item
// changed are patched in place; when the sequence of rows changed (adds, removes, filtering,
// reorders), the keyed reconcile moves the nodes.

export function list(parent, row) {
  let rows = new Map();
  let nodes = [];
  return (items) => {
    const next = new Map();
    const order = [];
    let moved = items.length !== nodes.length;
    for (const item of items) {
      let r = rows.get(item.id);
      if (!r) {
        r = row(item);
        r.node.dataset.key = item.id;
        r.patch(item);
      } else if (r.item !== item) r.patch(item);
      r.item = item;
      next.set(item.id, r);
      moved ||= r.node !== nodes[order.length];
      order.push(r.node);
    }
    if (moved) {
      if (nodes.length) reconcileArrays(parent, nodes, order);
      else parent.append(...order);
    }
    rows = next;
    nodes = order;
  };
}
