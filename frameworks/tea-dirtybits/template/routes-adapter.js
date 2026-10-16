// The contract adapter for routed-app (not part of the app's size): mount, dispatch, settled,
// dispose. As adapter.js, except that dispose first stops the units still mounted (their timers).
import { program } from "./runtime";
import { init, update, view, stop } from "./app";

let app;

function mount(root) {
  app = program(root, init(), update, view);
}

// External events go through the same reducer as user events.
function dispatch(msg) {
  app.send(msg);
}

function settled() {
  return app ? app.settled() : Promise.resolve();
}

// The runtime empties the root; the app stops the timers of the page (and tab) shown.
function dispose() {
  stop();
  app.dispose();
  app = undefined;
}

window.rr = { mount, dispatch, settled, dispose };
