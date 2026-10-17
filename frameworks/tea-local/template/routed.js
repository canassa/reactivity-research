// The runtime of the routed-app scenario (opt-in, counted as runtime): component instances that
// can be destroyed, and slots that mount and unmount one child instance.
//
// `instance` of runtime.js lives as long as the page. A routed app's instances come and go: a
// page, a tab panel and a modal exist only while shown. So a component here owns what it started
// (its watches on the instances it reads, its timers) and gives it all back in `destroy()`.

import { schedule } from "./runtime.js";

// A component instance: its model lives in this closure. `sources` are the instances its patch
// reads (it watches them, so a change to one schedules its patch). `send(tag, value)` first runs
// the message's command, if it has one (`cmds[tag]`: a message to another instance, as Elm's
// `Cmd`, but an imperative send: it is the only way a component writes to another instance, and
// it runs even when the component's own model does not change), then its reducer arm, if it has one (`update[tag]`), and schedules the patch.
export function component(sources, model, update, patch, cmds) {
  let alive = 1;
  const watchers = new Set();
  // A patch scheduled before `destroy` is skipped. `dirty`: a change is waiting for the flush.
  let dirty = 0;
  const run = () => {
    dirty = 0;
    if (alive) patch?.();
  };
  const wake = () => {
    dirty = 1;
    schedule(run);
  };
  const off = sources.map((source) => source.watch(wake));
  const set = (next) => {
    if (next === self.m) return;
    self.m = next;
    wake();
    for (const watcher of watchers) watcher();
  };
  wake(); // the first render, in the flush after mount
  const self = {
    m: model,
    // What `destroy` runs: unwatch, clear timers, destroy the slots' children.
    off,
    send: (tag, value) => {
      // A destroyed instance, or one whose owner's model has replaced it (`stale`, set by the
      // app), sends nothing: its handlers and commands are no-ops.
      if (!alive || self.stale?.()) return;
      cmds?.[tag]?.(self.m, value);
      if (update[tag]) set(update[tag](self.m, value));
    },
    set,
    // Bring the DOM up to the model now, if a change is waiting: an event that reaches a node
    // the model has already removed (a conditional section, say) must find it gone.
    sync: () => dirty && !self.stale?.() && run(),
    watch: (watcher) => (watchers.add(watcher), () => watchers.delete(watcher)),
    // A time-driven field: one interval while the component is mounted, sending message `tag`.
    every(tag, ms) {
      const timer = setInterval(() => self.send(tag), ms);
      off.push(() => clearInterval(timer));
    },
    destroy() {
      alive = 0;
      for (const stop of off) stop();
    },
  };
  return self;
}

// A place in `owner` that holds one child instance made by `make(key)` while `key` is not false,
// and none otherwise. A new key destroys the child and removes its node (the child's `root`
// is set by its frame), then makes the next. The owner's `destroy` destroys the child.
export function slot(owner) {
  const s = (key, make) => {
    if (key === s.key) return;
    s.c?.destroy();
    s.c?.root.remove();
    s.c = (s.key = key) !== false ? make(key) : null;
  };
  owner.off.push(() => s.c?.destroy());
  return s;
}

// The events of a view, as `wire` of runtime.js (the controls take the tags first, first + 1, …),
// except that a handler first brings the instance's DOM up to its model (`sync`) and does nothing
// for a control that is no longer in the page. Within one task a second event can reach a control
// the first one removed; the page does not know it until the flush.
export function wire(root, self, first, id) {
  for (const node of root.querySelectorAll("button,input,select")) {
    const tag = first++;
    const click = node.matches("button,[type=checkbox]");
    node.addEventListener(click ? "click" : "input", () => {
      self.sync();
      if (node.isConnected) self.send(tag, click ? id : node.type === "number" ? node.valueAsNumber : node.value);
    });
  }
  return [root, ...root.querySelectorAll("*")];
}
