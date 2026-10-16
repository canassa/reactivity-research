// A minimal headless Chrome driver over the DevTools protocol (Node's built-in WebSocket), with
// no dependencies. Used by ./rr check, ./rr work and ./rr bench.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";

const CANDIDATES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"];

// The Chrome binary: `explicit` (./rr bench --chrome), else $CHROME, else the first candidate on PATH.
export function findChrome(explicit) {
  if (explicit) return explicit;
  if (process.env.CHROME) return process.env.CHROME;
  for (const c of CANDIDATES) {
    try {
      execFileSync("which", [c], { stdio: "ignore" });
      return c;
    } catch {}
  }
  throw new Error(`no Chrome or Chromium found (tried ${CANDIDATES.join(", ")}); set CHROME=/path/to/chrome`);
}

// `args`: extra Chrome command-line flags, e.g. ["--js-flags=--no-turbofan"]. `chrome`: the
// binary (default: findChrome()). `taskset`: a CPU list (e.g. "1-5,7-11") to pin Chrome to.
export async function launch({ args = [], chrome, taskset } = {}) {
  const bin = findChrome(chrome);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "rr-chrome-"));
  const argv = [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1400,1000", ...args, "about:blank",
  ];
  const child = taskset
    ? spawn("taskset", ["-c", String(taskset), bin, ...argv], { stdio: ["ignore", "ignore", "pipe"] })
    : spawn(bin, argv, { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((resolve, reject) => {
    let err = "";
    const t = setTimeout(() => reject(new Error(`Chrome did not start:\n${err}`)), 20000);
    child.stderr.on("data", (d) => {
      err += d;
      const m = err.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
    child.on("exit", (code) => { clearTimeout(t); reject(new Error(`Chrome exited (${code}):\n${err}`)); });
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    } else for (const l of listeners) l(m);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  // Open a page; returns { evaluate(expr), cdp(method, params), on(fn), waitFor, errors, close() }.
  // `beforeNavigate({ cdp, on })` runs once the page target exists, before it navigates (e.g. to
  // start a trace that covers the load).
  async function open(url, { beforeNavigate } = {}) {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const errors = [];
    const onEvent = (m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
    };
    listeners.add(onEvent);
    const own = new Set();
    // Subscribe to this page's protocol events; returns the unsubscribe function.
    const on = (fn) => {
      const l = (m) => { if (m.sessionId === sessionId) fn(m); };
      listeners.add(l);
      own.add(l);
      return () => { listeners.delete(l); own.delete(l); };
    };
    const cdp = (method, params = {}) => send(method, params, sessionId);
    await cdp("Runtime.enable");
    await cdp("Page.enable");
    if (beforeNavigate) await beforeNavigate({ cdp, on });
    await cdp("Page.navigate", { url });
    const evaluate = async (expression) => {
      const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    return {
      evaluate,
      // Any DevTools protocol command on this page, e.g. cdp("Profiler.enable").
      cdp,
      on,
      errors,
      async waitFor(expression, timeout = 15000) {
        const t0 = Date.now();
        for (;;) {
          try { if (await evaluate(expression)) return; } catch {}
          if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${expression}${errors.length ? `\npage errors:\n${errors.join("\n")}` : ""}`);
          await new Promise((r) => setTimeout(r, 50));
        }
      },
      close: () => {
        listeners.delete(onEvent);
        for (const l of own) listeners.delete(l);
        return send("Target.closeTarget", { targetId });
      },
    };
  }

  // The browser's product string, e.g. "HeadlessChrome/154.0.8037.97".
  const version = async () => (await send("Browser.getVersion")).product;

  async function close() {
    try { ws.close(); } catch {}
    child.kill("SIGKILL");
    fs.rmSync(profile, { recursive: true, force: true });
  }
  return { open, close, version, bin };
}
