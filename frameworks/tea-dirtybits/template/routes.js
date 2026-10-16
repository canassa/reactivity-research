// The tea-dirtybits runtime for routed-app (a prototype; included only here, counted as runtime).
// It adds what pages need and the other scenarios do not: units that mount and unmount.
// - `slot`: a place where a unit (a page, a tab panel, a modal, the menu) is built when its key
//   appears, patched while it stays, and torn down (its timers stopped, its nodes removed) when
//   the key changes. Nothing outside the shown units has a node, a listener or a timer.
// - events that carry no widget: the app routes a message to the page shown;
// - setters that return the model with one slice of it changed (the page's fields, the active tab
//   panel, the open modal, or the global state), and the lifetime moves of the page's local state.
import { send } from "./runtime.js";

// A click (or a checkbox toggle) sends a constant message, built once when it is wired; `id` is
// the item's or the tab's.
export function tap(n, type, id) {
  const msg = { type, id };
  n.addEventListener("click", () => send(msg));
}

export function typed(n, type) {
  n.addEventListener("input", () => send({ type, value: n.value }));
}

// A number input sends only an integer within [min, max].
export function typedInt(n, type, min, max) {
  n.addEventListener("input", () => {
    const value = n.valueAsNumber;
    if (Number.isInteger(value) && value >= min && value <= max) send({ type, value });
  });
}

// A link or a nav button: navigate to a page.
export function go(n, route) {
  const msg = { type: "navigate", route };
  n.addEventListener("click", () => send(msg));
}

// A new item's id: one more than the largest.
export function nextId(items) {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

// The model with the page's fields, the tab panel's, the modal's or the global state changed.
export const setF = (m, f) => ({ ...m, page: { ...m.page, fields: { ...m.page.fields, ...f } } });
export const setP = (m, f) => ({ ...m, page: { ...m.page, panel: { ...m.page.panel, ...f } } });
export const setM = (m, f) => ({ ...m, page: { ...m.page, modal: { ...m.page.modal, ...f } } });
export const setG = (m, f) => ({ ...m, global: { ...m.global, ...f } });

// The modal opened (with its initial fields) or closed (null), and another tab selected (its
// panel starts from its initial fields).
export const putModal = (m, modal) => ({ ...m, page: { ...m.page, modal } });
export const putTab = (m, tab, panel) => ({ ...m, page: { ...m.page, tab, panel } });

// A unit's place. `place(node)` puts a new unit's root where it belongs; `mount(key)` builds the
// unit once and returns `[root, patch(s, d, m), stop]` (the patch and the stop are optional).
// The returned `update(key, s, d, m)` mounts the unit when `key` changes (a falsy key means no
// unit), patches it with every bit when new and with `d` while it stays; `update.stop()` runs the
// unit's own stop (its timers, its nested slots).
export function slot(place, mount) {
  let key, unit;
  const stop = () => {
    unit?.[2]?.();
    unit?.[0].remove();
    unit = null;
  };
  const update = (k, s, d, m) => {
    if (k !== key) {
      stop();
      key = k;
      if (k) place((unit = mount(k))[0]);
      d = -1;
    }
    unit?.[1]?.(s, d, m);
  };
  update.stop = stop;
  return update;
}
