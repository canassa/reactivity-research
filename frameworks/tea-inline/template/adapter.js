// The contract adapter (not part of the app's size): mount, dispatch, settled, dispose.
//
// It expects the app to provide `start(root)`, which builds the DOM for a fresh model and
// returns `receive(msg)` (the update arms still reached by a message: external events) and
// `stop()` (removes every node and drops pending work).
import { start } from "./app.js";
import { settled } from "./runtime.js";

let app;

function mount(root) {
  app = start(root);
}

function dispatch(msg) {
  app.receive(msg);
}

function dispose() {
  app.stop();
  app = undefined;
}

// `settled` is the runtime's own: resolved once the microtask flush has run.
window.rr = { mount, dispatch, settled, dispose };
