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
// `Cmd`), then its reducer arm, if it has one (`update[tag]`), and schedules the patch.
export function component(sources, model, update, patch, cmds) {
  let alive = 1;
  const watchers = new Set();
  // A patch scheduled before `destroy` is skipped.
  const run = () => alive && patch?.();
  const off = sources.map((source) => source.watch(run));
  const set = (next) => {
    if (next === self.m) return;
    self.m = next;
    schedule(run);
    for (const watcher of watchers) schedule(watcher);
  };
  schedule(run); // the first render, in the flush after mount
  const self = {
    m: model,
    // What `destroy` runs: unwatch, clear timers, destroy the slots' children.
    off,
    send: (tag, value) => {
      cmds?.[tag]?.(self.m, value);
      if (update[tag]) set(update[tag](self.m, value));
    },
    set,
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
