// The contract adapter (not part of the app's size): mount, dispatch, settled, dispose.
//
// It expects the app to provide `App` (src/App.jsx), taking `events`: the source of external
// events, which the app subscribes to in an effect, as a component connects to a socket or any
// other outside system. `events.subscribe(listener)` returns the unsubscribe function.
import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import App from "./App";

let root;
let listeners;

// createRoot attaches React's delegated listeners (every event type it supports, capturing and
// bubbling) to the container, and one `selectionchange` listener to the document, and marks both
// with a property named `_reactListening…` so a later root on the same container adds none.
// Unmounting leaves all of them in place. While createRoot runs the adapter notes the listeners
// added to the container and the document; dispose() removes exactly those and deletes React's
// marks, so a later mount registers them again. This depends on an undocumented ReactDOM detail
// (listenToAllSupportedEvents in react-dom-client); it is the same compromise as Solid's
// clearDelegatedEvents and the Marko adapter's.
let added = [];
function noting(targets, fn) {
  for (const target of targets) {
    target.addEventListener = function (type, handler, options) {
      added.push([target, type, handler, options]);
      return EventTarget.prototype.addEventListener.call(this, type, handler, options);
    };
  }
  try {
    return fn();
  } finally {
    for (const target of targets) delete target.addEventListener;
  }
}

function mount(container) {
  if (root) throw new Error("rr.mount: the app is already mounted; call rr.dispose() first");
  listeners = new Set();
  const events = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  root = noting([container, document], () => createRoot(container));
  // Rendered synchronously, so the app's effects (its subscription to `events`) have run when
  // mount returns.
  flushSync(() =>
    root.render(
      <StrictMode>
        <App events={events} />
      </StrictMode>,
    ),
  );
}

// An external event: delivered to the app's subscribers and rendered at once (flushSync), so the
// DOM and the handlers' state are current before the caller goes on in the same task.
function dispatch(msg) {
  flushSync(() => {
    for (const listener of listeners) listener(msg);
  });
}

// User events are discrete: React renders their updates synchronously, in a microtask after the
// event. flushSync() with no callback renders any such work still pending.
function settled() {
  flushSync();
  return Promise.resolve();
}

function dispose() {
  if (!root) return;
  root.unmount();
  root = listeners = undefined;
  for (const [target, type, handler, options] of added) {
    target.removeEventListener(type, handler, options);
    for (const key of Object.keys(target)) if (key.startsWith("_reactListening")) delete target[key];
  }
  added = [];
}

window.rr = { mount, dispatch, settled, dispose };
