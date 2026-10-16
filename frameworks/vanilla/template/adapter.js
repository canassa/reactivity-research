// The contract adapter (not part of the app's size): mount, dispatch, settled, dispose.
//
// It expects the app to provide `start(root)`, which renders the initial state into `root` and
// returns `receive(msg)` (applies an external event) and `stop()` (removes every node and
// listener the app created).
import { start } from "./app.js";

let app;

function mount(root) {
  app = start(root);
}

function dispatch(msg) {
  app.receive(msg);
}

// The app writes the DOM synchronously in every event handler: nothing is ever pending.
function settled() {
  return Promise.resolve();
}

function dispose() {
  app.stop();
  app = undefined;
}

window.rr = { mount, dispatch, settled, dispose };
