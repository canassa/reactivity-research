// The contract adapter (not part of the app's size): mount, dispatch, settled, dispose.
//
// It expects the app to be `Elm.Main`, a `Browser.element` taking no flags, with an incoming
// port `events` that receives every external event as JSON.
(function () {
  var root;
  var app;

  // Elm replaces the node it is given with the view's root, so it gets a child of `root`.
  function mount(target) {
    root = target;
    var node = document.createElement("div");
    root.appendChild(node);
    app = Elm.Main.init({ node: node });
  }

  function dispatch(msg) {
    app.ports.events.send(msg);
  }

  // Elm applies a message at once but redraws on the next animation frame (only `onInput`
  // handlers, which stop propagation, redraw synchronously). A frame callback queued after
  // the message runs after that redraw. Elm then queues one more frame to see whether it can
  // stop asking for frames; waiting for a second frame lets that pass too, so no frame
  // request of the app is left pending when this resolves (after dispose() included).
  function settled() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { resolve(); });
      });
    });
  }

  // Elm 0.19 has no unmount. The program creates no timers, and its only listeners are on its
  // own DOM nodes, so removing the nodes disconnects them; its one subscription is the
  // incoming port, which nothing can send to once the adapter drops the program.
  function dispose() {
    root.textContent = "";
    app = undefined;
    root = undefined;
  }

  window.rr = { mount: mount, dispatch: dispatch, settled: settled, dispose: dispose };
})();
