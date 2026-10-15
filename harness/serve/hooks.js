// Loaded before the app (classic script, first in <head>) on the serve page only. It counts
// the event listeners and timers the page creates, so the panel can show what is left after
// dispose(). The panel itself uses the original functions, so it is not counted.
(() => {
  const orig = {
    add: EventTarget.prototype.addEventListener,
    remove: EventTarget.prototype.removeEventListener,
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  };
  const listeners = new Set();
  const timers = new Map();
  const captureOf = (opts) => (typeof opts === "boolean" ? opts : !!(opts && opts.capture));
  const find = (target, type, fn, capture) => {
    for (const l of listeners) if (l.target === target && l.type === type && l.fn === fn && l.capture === capture) return l;
    return null;
  };

  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (fn) {
      const capture = captureOf(opts);
      if (!find(this, type, fn, capture)) listeners.add({ target: this, type, fn, capture });
    }
    return orig.add.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    const l = find(this, type, fn, captureOf(opts));
    if (l) listeners.delete(l);
    return orig.remove.call(this, type, fn, opts);
  };

  window.setTimeout = (fn, ms, ...args) => {
    const id = orig.setTimeout((...a) => { timers.delete("t" + id); typeof fn === "function" && fn(...a); }, ms, ...args);
    timers.set("t" + id, "timeout");
    return id;
  };
  window.clearTimeout = (id) => { timers.delete("t" + id); orig.clearTimeout(id); };
  window.setInterval = (fn, ms, ...args) => {
    const id = orig.setInterval(fn, ms, ...args);
    timers.set("i" + id, "interval");
    return id;
  };
  window.clearInterval = (id) => { timers.delete("i" + id); orig.clearInterval(id); };
  window.requestAnimationFrame = (fn) => {
    const id = orig.requestAnimationFrame((t) => { timers.delete("r" + id); fn(t); });
    timers.set("r" + id, "animation frame");
    return id;
  };
  window.cancelAnimationFrame = (id) => { timers.delete("r" + id); orig.cancelAnimationFrame(id); };

  window.__rrHooks = {
    orig,
    // Listeners still reachable: on window, document, or a node still in the page.
    liveListeners() {
      return [...listeners].filter((l) => l.target === window || l.target === document || (l.target instanceof Node && l.target.isConnected));
    },
    liveTimers() {
      return [...timers.values()];
    },
  };
})();
