// The contract adapter (not part of the app's size): mount, dispatch, settled, dispose.
//
// The app module exports the program the runtime built (`app(...)`): `mount(root)`,
// `receive(msg)` for external events, and `dispose()`.
import app from "./app.js";

window.rr = {
  mount: (root) => app.mount(root),
  dispatch: (msg) => app.receive(msg),
  // Every update is applied synchronously (one digest per event), so the DOM is current as
  // soon as dispatch returns.
  settled: () => Promise.resolve(),
  dispose: () => app.dispose(),
};
