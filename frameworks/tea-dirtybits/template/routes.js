// The tea-dirtybits runtime for routed-app (a prototype; included only here, counted as runtime).
// It holds only what is generic: units that mount and unmount.
// - `slot`: a place where a unit (a page, a tab panel, a modal, the menu) is built when its key
//   appears, patched while it stays, and torn down (its timers stopped, its nodes removed) when
//   the key changes. Nothing outside the shown units has a node, a listener or a timer.
// - `program`: the runtime's loop, whose `dispose` first runs the stop that `view` returns.
import { program as run } from "./runtime.js";

// A unit's place. `place(node)` puts a new unit's root where it belongs; `mount(key, model)` builds
// the unit once and returns `[root, patch(s, d, m), stop]` (the patch and the stop are optional).
// The returned `update(key, s, d, m)` mounts the unit when `key` changes (a falsy key means no
// unit), patches it with every bit when new and with `d` while it stays; `update.stop()` runs the
// unit's own stop (its timers, its nested slots). The app makes a key change whenever the unit
// must be built again, even from the same page or tab (a generation number in the model).
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
      if (k) place((unit = mount(k, m))[0]);
      d = -1;
    }
    unit?.[1]?.(s, d, m);
  };
  update.stop = stop;
  return update;
}

// The runtime's loop for an app whose `view(root, model)` returns `[patch, stop]`.
export function program(root, model, update, view) {
  let stop;
  const app = run(root, model, update, (r, m) => {
    const v = view(r, m);
    stop = v[1];
    return v[0];
  });
  return {
    ...app,
    dispose() {
      stop();
      app.dispose();
    },
  };
}
