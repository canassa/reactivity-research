// The contract adapter (not part of the app's size): mount, dispatch, settled, dispose.
//
// It expects the app to provide `App(root)`, returning `{ receive(msg), dispose() }`: `receive`
// routes an external event to the component instances it concerns.
import { App } from "./app.js";
import { settled } from "./runtime.js";

let app;

window.rr = {
  mount(root) {
    app = App(root);
  },
  dispatch(msg) {
    app.receive(msg);
  },
  // Every update is batched into one microtask flush; this resolves after it.
  settled,
  dispose() {
    app.dispose();
    app = undefined;
  },
};
