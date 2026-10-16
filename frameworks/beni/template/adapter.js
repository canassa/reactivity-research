// The contract adapter (not part of the app's size): mount, dispatch, settled, dispose.
//
// A beni page program starts when its module is evaluated: `main` mounts at the element whose id
// `Browser.mountAt` names (here "root", the page's root) and renders `init` there. So the page
// does not load the module itself; `mount` imports it, from the URL beni wrote into the page
// (`{{entry}}`, in this script's `data-entry`). External events reach the program through its
// own platform layer (`Push.onPush`, a subscription): `dispatch` fires the `rr-push` event on
// `window` with the event as its `detail`. `settled` calls the module's exported `flush`, beni's
// "render every program with a message waiting, now" (browser-tea renders on a microtask;
// browser-direct writes the DOM while it handles each event and exports none), then waits one
// macrotask (below).
//
// beni has no unmount (boundary.md §9.8.14: "W51, unmount: not now"; a stopped page leaves its
// listeners on the document, inert). So `dispose` does what that unmount would: while a program
// is mounted the adapter records the listeners added to `window` and `document`, and removes
// them; it empties the root and clears the runtime's mark on it (`$$root`, which refuses a
// second program at one element). A second `mount` evaluates the module again, as a module of
// its own (a query string makes it a new module record): a fresh program, as a page load gives.
(function () {
  var entry = document.currentScript.getAttribute("data-entry");
  var targets = [window, document];
  var mounts = 0;
  var root, loading, program;
  var added = [];

  function track() {
    targets.forEach(function (target) {
      target.addEventListener = function (type, fn, options) {
        added.push([target, type, fn, options]);
        return EventTarget.prototype.addEventListener.call(target, type, fn, options);
      };
    });
  }

  function untrack() {
    targets.forEach(function (target) { delete target.addEventListener; });
    added.forEach(function (l) { EventTarget.prototype.removeEventListener.call(l[0], l[1], l[2], l[3]); });
    added = [];
  }

  function mount(target) {
    root = target;
    track();
    mounts += 1;
    var url = new URL(entry, document.baseURI);
    if (mounts > 1) url.searchParams.set("mount", String(mounts));
    loading = import(url.href).then(function (module) { program = module; });
  }

  function dispatch(msg) {
    window.dispatchEvent(new CustomEvent("rr-push", { detail: msg }));
  }

  // Then one macrotask: a checkbox the user clicked is put back to the model by a zero-delay
  // timeout of beni's runtime (its controlled inputs), which runs before this one.
  function settled() {
    return loading.then(function () {
      if (program && typeof program.flush === "function") program.flush();
      return new Promise(function (resolve) { setTimeout(resolve, 0); });
    });
  }

  function dispose() {
    untrack();
    root.textContent = "";
    delete root.$$root;
    program = undefined;
    root = undefined;
  }

  window.rr = { mount: mount, dispatch: dispatch, settled: settled, dispose: dispose };
})();
