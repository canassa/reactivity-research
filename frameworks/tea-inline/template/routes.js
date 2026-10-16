// What an app of pages asks of the runtime, beside runtime.js (included only by routed-app):
// lifetime. A unit (a page, a tab panel, a modal, the shell) is a markup string and a function
// over its elements; mounting one builds it and gives it a list of disposers, and `down` runs
// them. Everything a unit puts outside itself registers a disposer: a binding added to the
// readers of a global field (`reg`), a timer (`every`), its own nodes. A unit left behind keeps
// nothing alive.

import { schedule } from "./runtime.js";

// Build a unit: parse `html` at `at` of `ref` ("beforeend" or "afterend"), then call
// `fn(E, G, D, root)` with the unit's elements in document order (headings, labels and options
// left out: no code refers to them), its binding table `G` and its disposers `D`. The unit's
// first render is scheduled. Returns the arms `fn` returned, plus `down`, which disposes the unit
// (once: a second call does nothing).
export function up(ref, at, html, fn) {
  // A stale event (a click on a page that left in the same task) reaches a detached `ref`: build
  // nothing, so nothing registers or starts a timer that no `down` would ever end.
  if (!ref.isConnected) return { down() {} };
  ref.insertAdjacentHTML(at, html);
  const root = at == "afterend" ? ref.nextSibling : ref.lastChild;
  const G = [];
  const D = [() => root.remove()];
  const arms = fn(root.querySelectorAll(":not(h1,h2,label,option)"), G, D, root) || {};
  schedule(G);
  arms.down = () => {
    for (const f of D.splice(0)) f();
  };
  return arms;
}

// Add `item` (a binding, or a group of them) to `group`, a list of readers that outlives the
// unit (a global field's, or the page's): the disposer takes it out again.
export function reg(D, group, item) {
  group.push(item);
  D.push(() => group.splice(group.indexOf(item), 1));
}

// A timer that runs while the unit does.
export function every(D, ms, tick) {
  const timer = setInterval(tick, ms);
  D.push(() => clearInterval(timer));
}
