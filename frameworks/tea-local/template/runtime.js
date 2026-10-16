// The tea-local runtime (a prototype; see frameworks/tea-local/README.md): DOM helpers,
// microtask batching, component instances with local message routing, and keyed lists.
//
// Adapted from the shared support of canassa/beni's rendering-design research (strategy C,
// "local reducers"): the same element, text and attribute helpers that skip unchanged writes,
// and the same batching. Keyed lists place their rows with one forward pass (see `list`).

// ---------------------------------------------------------------------------------------------
// Batching: patches run once each, in one microtask after the messages that scheduled them. The
// flush is queued with the first patch scheduled after the last flush. Patches only write the
// DOM (they never send), so nothing is scheduled while a flush runs.
const pending = new Set();

export function schedule(patch) {
  if (!pending.size) queueMicrotask(flush);
  pending.add(patch);
}

function flush() {
  for (const patch of pending) patch();
  pending.clear();
}

// ---------------------------------------------------------------------------------------------
// DOM: built once (by createElement calls or from a static template); every later write is
// skipped when nothing changed.

// `content` is an optional text (appended unless empty).
export function element(parent, tag, attrs, content) {
  const node = document.createElement(tag);
  for (const key in attrs) node.setAttribute(key, attrs[key]);
  if (content) node.append(content);
  parent?.append(node);
  return node;
}

// A static template, parsed once: returns a function that clones its (single) root element.
export function template(html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  return () => t.content.firstChild.cloneNode(true);
}

export function on(node, type, handler) {
  node.addEventListener(type, handler);
}

// The controls a view wires to messages, and those of them that send on click.
const controls = "button,input,select";
const clicked = "button,[type=checkbox]";

// The events of a view (Elm's `onClick msg` and `onInput Tag`): `tags` holds one message tag per
// control under `root`, in document order. A button or checkbox sends its message when clicked,
// with `id` as its argument (a list row's item id, or none); a text input, select or number input
// sends its value on input, a number input as a number (the reducer takes it only if it is an
// integer in range).
export function wire(root, self, tags, id) {
  for (const node of root.querySelectorAll(controls)) {
    const tag = tags.shift();
    const click = node.matches(clicked);
    node.addEventListener(click ? "click" : "input", () =>
      self.send(tag, click ? id : node.type === "number" ? node.valueAsNumber : node.value),
    );
  }
}

// A dynamic text is the only child of `node`: a text node (a placeholder in the template).
export function setText(node, value) {
  node = node.firstChild;
  value = String(value);
  if (node.data !== value) node.data = value;
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
// A component instance: its model lives in this closure. `send(tag, value)` (a message: its
// constructor's tag and its argument, if any) runs the component's own reducer and schedules the instance's `patch` (its binding list) and whoever watches it.
// There is no global dispatch, no dirty bits and no dependency tracking.

export function instance(model, update, patch) {
  const watchers = [];
  const set = (next) => {
    if (next === self.m) return;
    self.m = next;
    schedule(patch);
    for (const watcher of watchers) schedule(watcher);
  };
  // `m` is the current model, read by the instance's patch and by its watchers.
  schedule(patch); // the first render, in the flush after mount
  const self = {
    m: model,
    send: (tag, value) => set(update(self.m, tag, value)),
    set,
    watch: (watcher) => watchers.push(watcher),
  };
  return self;
}

// ---------------------------------------------------------------------------------------------
// A keyed list owning every child of `parent`, keyed by `item.id` (written as the row's
// `data-key`). `row(item)` builds a detached row `{ node, patch(item) }`. Rows whose item
// changed are patched in place; when the sequence of rows changed (adds, removes, filtering,
// reorders), one forward pass moves the nodes: a node already in place stays, any other is
// inserted before the first node not yet placed. That keeps the unchanged nodes still for an
// insertion, a removal, a filter or a reversed run; its worst case is a rotation, which moves
// every node but one.

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
      } else {
        rows.delete(item.id);
        if (r.item !== item) r.patch(item);
      }
      r.item = item;
      next.set(item.id, r);
      moved ||= r.node !== nodes[order.length];
      order.push(r.node);
    }
    if (moved) {
      // The rows left in `rows` are gone. The others are put in order: a node already in
      // place stays, any other is moved (or inserted) before the first node not yet placed.
      for (const r of rows.values()) r.node.remove();
      let at = parent.firstChild;
      for (const node of order) node === at ? (at = at.nextSibling) : parent.insertBefore(node, at);
    }
    rows = next;
    nodes = order;
  };
}
