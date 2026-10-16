// The tea-dirtybits runtime (a prototype; no framework ships it). Shared by every app:
// - the TEA loop: messages go through one reducer, which marks dirty bits for what it writes;
//   one microtask later the view's static patch runs only the bindings whose bits are set;
// - helpers the compiled DOM factories call: static templates, events that send a message,
//   guarded text and property writes, conditional content and keyed lists.

// ---------------------------------------------------------------------------------------------
// Dirty bits. A component's reducer arm returns its new state with the bits of the fields it
// writes, `[state, bits]` (or nothing when the state is unchanged); the app's reducer files
// those bits under the component instance in `dirty`, which the next patch takes.

export let dirty = {};

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
// a checkbox toggle sends a constant message (with the item's id in a list row), built once
// when the event is wired; an input sends the control's value.
export function onClick(n, widget, type, id) {
  const msg = { widget, type, id };
  n.addEventListener("click", () => send(msg));
}

// A checkbox toggles on its click event, which the keyboard fires too (React's onChange for a
// checkbox listens to it as well), so onCheck is onClick.
export { onClick as onCheck };

export function onInput(n, widget, type) {
  n.addEventListener("input", () => send({ widget, type, value: n.value }));
}

// A number input's decoder: only an integer within [min, max] becomes a message; anything else
// stays in the input as typed.
export function onInt(n, widget, type, min, max) {
  n.addEventListener("input", () => {
    const value = n.valueAsNumber;
    if (Number.isInteger(value) && value >= min && value <= max) send({ widget, type, value });
  });
}

// An element's text, written only when it differs.
export function setText(n, value) {
  value = "" + value;
  if (n.textContent !== value) n.textContent = value;
}

// A DOM property (value, checked, disabled, or a reflected ARIA state), written only when it differs, so an input being
// typed into keeps its caret.
export function prop(n, key, value) {
  if (n[key] !== value) n[key] = value;
}

// The same for the common properties, each named once: `setValue(n, v)` is
// `prop(n, "value", v)`.
const setter = (key) => (n, value) => {
  if (n[key] !== value) n[key] = value;
};
export const setValue = setter("value");
export const setNumber = setter("valueAsNumber");
export const setChecked = setter("checked");
export const setDisabled = setter("disabled");

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
// [node, patch(item)]; the list keys the node. New rows and rows whose item changed are patched;
// rows whose id is gone are removed, and one walk puts every remaining node in order, moving
// only the misplaced ones.
export function list(parent, row) {
  let rows = new Map();
  return (items) => {
    const next = new Map();
    for (const item of items) {
      let r = rows.get(item.id);
      if (!r) (r = row(item))[0].dataset.key = item.id;
      if (r.item !== item) r[1](item);
      r.item = item;
      next.set(item.id, r);
    }
    for (const [id, r] of rows) if (!next.has(id)) r[0].remove();
    let at = parent.firstChild;
    for (const [node] of next.values()) {
      if (node === at) at = at.nextSibling;
      else parent.insertBefore(node, at);
    }
    rows = next;
  };
}
