// The contract adapter (not part of the app's size): mount, dispatch, settled, dispose.
//
// It expects the app to provide `init()` (a fresh initial model), `update(model, msg)` and
// `view(root, model, send)`, and runs them with the runtime's own loop.
import { program } from "./runtime";
import { init, update, view } from "./app";

let app;

function mount(root) {
  app = program(root, init(), update, view);
}

// External events go through the same reducer as user events.
function dispatch(msg) {
  app.send(msg);
}

// Resolves once the pending microtask patch (if any) has run.
function settled() {
  return app ? app.settled() : Promise.resolve();
}

// Empties the root. Listeners live on the removed nodes; the runtime has no timers.
function dispose() {
  app.dispose();
  app = undefined;
}

window.rr = { mount, dispatch, settled, dispose };
