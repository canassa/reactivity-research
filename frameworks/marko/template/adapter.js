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
// the adapter notes the capturing listeners added on `document`; dispose() removes those that
// carry Marko's mark (set right after the call, so it is checked at dispose) and deletes the mark,
// so a later mount registers them again. Listeners added by anything else are left alone. This
// depends on an undocumented runtime detail (see frameworks/marko/README.md); it is the same
// compromise as Solid's clearDelegatedEvents.
let added = [];
function noteDocumentListeners() {
  document.addEventListener = function (type, handler, options) {
    if (options === true && typeof handler === "function") added.push([type, handler]);
    return EventTarget.prototype.addEventListener.call(this, type, handler, options);
  };
}

function mount(root) {
  if (mounted) throw new Error("rr.mount: the app is already mounted; call rr.dispose() first");
  noteDocumentListeners();
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
  if (!mounted) return;
  mounted.destroy();
  mounted = undefined;
  delete document.addEventListener;
  for (const [type, handler] of added) {
    if (handler[1 + type] !== 1) continue;
    document.removeEventListener(type, handler, true);
    delete handler[1 + type];
  }
  added = [];
}

window.rr = { mount, dispatch, settled, dispose };
