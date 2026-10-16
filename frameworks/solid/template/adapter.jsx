// The contract adapter (not part of the app's size): mount, dispatch, settled, dispose.
//
// It expects the app to provide `App` (taking the app's store as a prop) and `createAppStore()`
// (returning a store with `receive(msg)` for external events).
import { render, delegateEvents, clearDelegatedEvents } from "solid-js/web";
import App from "./App";
import { createAppStore } from "./store";

let disposeRender;
let store;
// Solid registers delegated event handlers on `document` once, when the app's modules load, and
// render()'s dispose leaves them there. dispose() removes them (clearDelegatedEvents) and keeps
// the names Solid had registered (the Set it keeps on the document), so a later mount() registers
// exactly those again. The adapter uses no library code beyond what the app itself imports.
let delegated;

function mount(root) {
  if (delegated) delegateEvents(delegated);
  store = createAppStore();
  disposeRender = render(() => <App store={store} />, root);
}

function dispatch(msg) {
  store.receive(msg);
}

// Solid applies every update synchronously, so the DOM is current as soon as dispatch returns.
function settled() {
  return Promise.resolve();
}

function dispose() {
  disposeRender();
  delegated = [...(document["_$DX_DELEGATE"] ?? [])];
  clearDelegatedEvents();
  disposeRender = store = undefined;
}

window.rr = { mount, dispatch, settled, dispose };
