// The contract adapter (not part of the app's size): mount, dispatch, settled, dispose.
//
// It expects the app's root template, `src/app.marko`, to `<return>` one function that takes an
// external event message (the root's tag variable, which `Template.mount` exposes as `.value`).
import App from "./app.marko";

let mounted;

// Marko delegates events: the first `_on` (or controlled input) for an event type adds one
// capturing listener on `document` and marks the handler as registered with a property named
// after the type ("1click" on the handler function), and nothing ever removes it
// (references/marko/packages/runtime-tags/src/dom/event.ts:30-34, called from event.ts:21-23 and
// controllable.ts:558-559). `destroy()` leaves those listeners behind. While the app is mounted
// the adapter records the listeners added on `document`; dispose() removes them and deletes the
// mark, so a later mount registers them again. This depends on an undocumented runtime detail
// (see frameworks/marko/README.md); it is the same compromise as Solid's clearDelegatedEvents.
let delegated = [];
function recordDocumentListeners() {
  document.addEventListener = function (type, handler, options) {
    delegated.push([type, handler, options]);
    return EventTarget.prototype.addEventListener.call(this, type, handler, options);
  };
}

function mount(root) {
  recordDocumentListeners();
  mounted = App.mount({}, root);
}

function dispatch(msg) {
  mounted.value(msg);
}

// Marko has no public flush. A write schedules a microtask that renders and requests an
// animation frame, and writes made before that frame's MessageChannel task render in that task
// (references/marko/packages/runtime-tags/src/dom/schedule.ts:6-51). Queued after Marko's
// microtask, this waits for the same frame and then for a task posted after Marko's.
function settled() {
  return new Promise((resolve) =>
    queueMicrotask(() =>
      requestAnimationFrame(() => {
        const { port1, port2 } = new MessageChannel();
        port1.onmessage = () => {
          port1.close();
          resolve();
        };
        port2.postMessage(0);
      }),
    ),
  );
}

function dispose() {
  mounted.destroy();
  mounted = undefined;
  delete document.addEventListener;
  for (const [type, handler, options] of delegated) {
    document.removeEventListener(type, handler, options);
    delete handler[1 + type];
  }
  delegated = [];
}

window.rr = { mount, dispatch, settled, dispose };
