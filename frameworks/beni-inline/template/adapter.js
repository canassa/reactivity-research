// The contract adapter (not part of the app's size): mount, dispatch, settled, dispose.
//
// A beni page program starts when its module is evaluated: `main` mounts at the element whose id
// `Browser.mountAt` names (here "root", the page's root) and renders `init` there. So the page
// does not load the module itself; `mount` imports it, from the URL beni wrote into the page
// (`{{entry}}`, in this script's `data-entry`). External events reach the program through its
// own platform layer (`Push.onPush`, a subscription): `dispatch` fires the `rr-push` event on
// `window` with the event as its `detail`.
//
// browser-inline writes the DOM synchronously inside each dispatch (beni's
// docs/design/browser-inline.md), so `settled` has nothing to flush or wait for: it resolves once
// the module has loaded. Its runtime exports `stop`, the page's unmount, which removes what the
// mount added (the program's root node, its listeners, its timers), so `dispose` calls it and
// nothing else. A second `mount` evaluates the module again, as a module of its own (a query
// string makes it a new module record): a fresh program, as a page load gives.
(function () {
  var entry = document.currentScript.getAttribute("data-entry");
  var mounts = 0;
  var loading, program;

  function mount(target) {
    mounts += 1;
    var url = new URL(entry, document.baseURI);
    if (mounts > 1) url.searchParams.set("mount", String(mounts));
    loading = import(url.href).then(function (module) { program = module; });
  }

  function dispatch(msg) {
    window.dispatchEvent(new CustomEvent("rr-push", { detail: msg }));
  }

  function settled() {
    return loading.then(function () {});
  }

  function dispose() {
    program.stop();
    program = undefined;
  }

  window.rr = { mount: mount, dispatch: dispatch, settled: settled, dispose: dispose };
})();
