// The serve panel: outside the app's root and never measured. It drives the app through the
// contract (window.rr: mount, dispatch, settled, dispose) and through DOM events, keeps the
// reference state alongside, and shows what the owner needs to judge each step by eye:
// whether the page matches the reference render, how many elements were created or removed,
// whether a typed-into input kept focus and caret, and what is left after dispose.
//
// It knows no scenario: it uses the scenario's spec module (update, render, panelEvents) and the
// interaction script from the spec.

// The page may be served under a path prefix (./rr hub); the server injects it as window.__rrBase.
const BASE = window.__rrBase || "/";
const SPEC_MODULE = `${BASE}__rr/spec.js`;
const hooks = window.__rrHooks;
const on = (el, type, fn, opts) => hooks.orig.add.call(el, type, fn, opts);
const wait = (ms) => new Promise((r) => hooks.orig.setTimeout(r, ms));

const ref = await import(SPEC_MODULE);
const spec = await (await fetch(`${BASE}__rr/spec.json`)).json();
const variant = location.pathname.slice(BASE.length).split("/").filter(Boolean)[0];
const app = window.rr;
const root = document.getElementById("root");

// ---------------------------------------------------------------------------------------------
// State

let state = null;          // the reference state, or null when not mounted
let mounted = false;
let pos = 0;               // next script step
let manual = false;        // the owner interacted with the app since the last reset
let salt = 0;              // makes every panel-built external event different
let running = false;
let acting = false;        // the panel is performing an action (its events are not the owner's)
const tally = { steps: 0, compared: 0, mismatches: 0, focusLost: 0, keyedReplaced: 0, errors: 0 };

// ---------------------------------------------------------------------------------------------
// The panel's DOM

const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) on(e, k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  e.append(...children.flat().filter((c) => c != null));
  return e;
};

const panel = el("aside", { id: "rr-panel" });
document.body.append(panel);
document.body.classList.add("rr-served");

const o = spec.options;
const checks = el("dl", { class: "rr-checks" });
const stepLabel = el("div", { class: "rr-step" });
const log = el("ol", { class: "rr-log" });
const refBox = el("div", { class: "rr-ref", inert: true, hidden: true });
const diffBox = el("pre", { class: "rr-diff", hidden: true });

const btnStep = el("button", { onclick: () => guard(stepOnce) }, "Step");
const btnRun = el("button", { onclick: () => guard(runAll) }, "Run to end");
const btnReset = el("button", { onclick: () => guard(reset) }, "Reset");

const events = ref.panelEvents(spec).map((ev) => {
  const select = ev.targets ? el("select", {}, ev.targets.map((t) => el("option", { value: t }, labelOf(t)))) : null;
  const disabled = ev.targets && ev.targets.length === 0;
  const button = el("button", { disabled, onclick: () => guard(() => sendEvent(ev, select && select.value)) }, `Send ${ev.name}`);
  return el("div", { class: "rr-event" }, button, select, disabled ? el("small", {}, " (no target in this app)") : null);
});

panel.append(
  el("header", {},
    el("strong", {}, `${spec.scenario} · ${variant}`),
    el("span", {}, ` n=${o.size} seed=${o.seed}` + Object.entries(o).filter(([k]) => k !== "size" && k !== "seed").map(([k, v]) => ` ${k}=${v}`).join(""))),
  el("section", {}, el("h3", {}, "Interaction script"), stepLabel, el("div", { class: "rr-row" }, btnStep, btnRun, btnReset)),
  el("section", {}, el("h3", {}, "External events (dispatch)"), events),
  el("section", {}, el("h3", {}, "Last action"), checks, diffBox),
  el("section", {},
    el("h3", {}, "Reference render ", el("button", { class: "rr-small", onclick: () => { refBox.hidden = !refBox.hidden; showReference(); } }, "show / hide")),
    refBox),
  el("section", {}, el("h3", {}, "Log"), log),
);

function labelOf(id) {
  const w = spec.widgets?.find((x) => x.id === id);
  return w ? `${id} · ${w.kind} · ${w.label}` : id;
}

// Owner interaction with the app (trusted events) means the reference no longer follows.
for (const type of ["click", "input", "change", "keydown"]) {
  // (A scripted checkbox click() fires trusted input/change events too, hence `acting`.)
  on(root, type, (e) => { if (e.isTrusted && mounted && !acting) manual = true; }, true);
}

// ---------------------------------------------------------------------------------------------
// Comparing the page with the reference render

// One line per element, with sorted attributes and the live properties that matter
// (input value or checked, select value); whitespace and comments ignored.
function canonLive(node, depth = 0, out = []) {
  const pad = "  ".repeat(depth);
  const attrs = [];
  for (const a of node.attributes) {
    if (a.name === "value" && (node.tagName === "INPUT" || node.tagName === "SELECT")) continue;
    if (a.name === "checked" || a.name === "selected") continue;
    attrs.push(`${a.name}="${a.value}"`);
  }
  if (node.tagName === "INPUT") attrs.push(node.type === "checkbox" ? `:checked=${node.checked}` : `:value="${node.value}"`);
  if (node.tagName === "SELECT") attrs.push(`:value="${node.value}"`);
  out.push(`${pad}<${node.tagName.toLowerCase()}${attrs.sort().map((a) => " " + a).join("")}>`);
  let text = "";
  const flush = () => {
    const t = text.replace(/\s+/g, " ").trim();
    if (t) out.push(`${pad}  "${t}"`);
    text = "";
  };
  for (const c of node.childNodes) {
    if (c.nodeType === 3) text += c.data;
    else if (c.nodeType === 1) { flush(); canonLive(c, depth + 1, out); }
  }
  flush();
  return out;
}

function canonRef(node, depth = 0, out = []) {
  const pad = "  ".repeat(depth);
  const attrs = Object.entries(node.attrs).filter(([k]) => !(k === "value" && (node.tag === "input" || node.tag === "select"))).map(([k, v]) => `${k}="${v}"`);
  if (node.tag === "input") attrs.push(node.attrs.type === "checkbox" ? `:checked=${!!node.props.checked}` : `:value="${node.props.value ?? ""}"`);
  if (node.tag === "select") attrs.push(`:value="${node.props.value ?? ""}"`);
  out.push(`${pad}<${node.tag}${attrs.sort().map((a) => " " + a).join("")}>`);
  let text = "";
  const flush = () => {
    const t = text.replace(/\s+/g, " ").trim();
    if (t) out.push(`${pad}  "${t}"`);
    text = "";
  };
  for (const c of node.children) {
    if (typeof c === "string") text += c;
    else { flush(); canonRef(c, depth + 1, out); }
  }
  flush();
  return out;
}

function compare() {
  const live = [];
  for (const c of root.children) canonLive(c, 0, live);
  const want = state ? canonRef(ref.render(spec, state)) : [];
  const n = Math.max(live.length, want.length);
  for (let i = 0; i < n; i++) {
    if (live[i] !== want[i]) {
      const from = Math.max(0, i - 4);
      const ctx = (arr) => arr.slice(from, i + 4).map((l, j) => (from + j === i ? "» " : "  ") + l).join("\n");
      return { ok: false, line: i, text: `first difference at line ${i + 1}\n\npage:\n${ctx(live)}\n\nreference:\n${ctx(want)}` };
    }
  }
  return { ok: true };
}

function showReference() {
  if (refBox.hidden) return;
  refBox.replaceChildren();
  if (!state) return refBox.append("(not mounted)");
  const build = (n) => {
    if (typeof n === "string") return document.createTextNode(n);
    const e = document.createElement(n.tag);
    for (const [k, v] of Object.entries(n.attrs)) e.setAttribute(k, v);
    if (n.props.value != null) e.value = n.props.value;
    if (n.props.checked) e.checked = true;
    e.append(...n.children.map(build));
    if (n.tag === "select" && n.props.value != null) e.value = n.props.value;
    return e;
  };
  refBox.append(build(ref.render(spec, state)));
}

// ---------------------------------------------------------------------------------------------
// Running actions

let mutations = { added: 0, removed: 0 };
const countMutations = (records) => {
  for (const r of records) {
    for (const n of r.addedNodes) if (n.nodeType === 1) mutations.added += 1 + n.querySelectorAll("*").length;
    for (const n of r.removedNodes) if (n.nodeType === 1) mutations.removed += 1 + n.querySelectorAll("*").length;
  }
};
const observer = new MutationObserver(countMutations);
observer.observe(root, { childList: true, subtree: true });

async function guard(fn) {
  if (running) return;
  running = true;
  setButtons();
  try { await fn(); } catch (err) { tally.errors++; report({ label: "error", error: err.message }); console.error(err); }
  running = false;
  setButtons();
}

function setButtons() {
  btnStep.disabled = btnRun.disabled = running || pos >= spec.script.length;
  btnReset.disabled = running;
  stepLabel.textContent = pos < spec.script.length
    ? `next: step ${pos + 1} of ${spec.script.length} — ${spec.script[pos].label}`
    : `script finished (${spec.script.length} steps, ${tally.compared} compared with the reference): ${tally.mismatches} mismatches, ${tally.focusLost} focus/caret losses, ${tally.keyedReplaced} steps replacing keyed elements, ${tally.errors} errors`;
}

// Perform one action and report on it. `act` changes the page; `msg` (if any) is the
// reference message it stands for.
async function perform(label, act, msg, opts = {}) {
  observer.takeRecords();
  mutations = { added: 0, removed: 0 };
  const target = opts.target || null;
  const keyedBefore = keyedElements();
  acting = true;
  try { await act(); } finally { acting = false; }
  await app.settled();
  countMutations(observer.takeRecords());
  if (msg && state) state = ref.update(spec, state, msg);
  const result = { label, mutations: { ...mutations } };
  if (mounted) {
    if (manual) result.match = null;
    else {
      const c = compare();
      tally.compared++;
      result.match = c.ok;
      result.diff = c.text;
      if (!c.ok) tally.mismatches++;
    }
  }
  // The element the action targeted: still the same node, gone (removed with its item), or
  // replaced by a new node (a node-identity failure).
  // Keyed elements (anything with data-key, by its chain of data-key ancestors) that still
  // exist after the action must be the same nodes.
  if (mounted) {
    const after = keyedElements();
    result.keyedReplaced = [...after].filter(([k, n]) => keyedBefore.has(k) && keyedBefore.get(k) !== n).map(([k]) => k);
  }
  if (result.keyedReplaced?.length) tally.keyedReplaced++;
  if (target) {
    const now = root.querySelector(opts.selector);
    result.targetKept = now === target ? true : now === null ? "removed" : false;
  }
  if (opts.typed) {
    const caretOk = target.type === "number" || target.selectionStart === target.value.length;
    result.focus = document.activeElement === target && target.isConnected && caretOk;
    if (!result.focus) tally.focusLost++;
  }
  if (opts.disposed) {
    result.rootEmpty = root.childNodes.length === 0;
  }
  result.listeners = hooks.liveListeners().length;
  result.timers = hooks.liveTimers().length;
  tally.steps++;
  report(result);
  showReference();
}

function keyedElements() {
  const map = new Map();
  for (const n of root.querySelectorAll("[data-key]")) {
    const keys = [];
    for (let e = n; e && e !== root; e = e.parentElement) if (e.dataset.key != null) keys.unshift(e.dataset.key);
    map.set(keys.join("/") + "|" + n.dataset.role, n);
  }
  return map;
}

// External events reach the app as fresh data, as if deserialized from the network: an app may
// keep (and later mutate) what it receives, and must not share objects with the reference.
function dispatch(msg) {
  return app.dispatch(structuredClone(msg));
}

function find(selector) {
  const t = root.querySelector(selector);
  if (!t) throw new Error(`no element ${selector}`);
  return t;
}

async function runStep(step) {
  switch (step.do) {
    case "mount":
      if (mounted) return;
      state = spec.initialState;
      mounted = true;
      return perform(step.label, () => app.mount(root));
    case "dispose":
      mounted = false;
      state = null;
      return perform(step.label, () => app.dispose(), null, { disposed: true });
    case "click": {
      const t = find(step.target);
      return perform(step.label, () => t.click(), step.msg, { target: t, selector: step.target });
    }
    case "type": {
      const t = find(step.target);
      return perform(step.label, () => {
        t.focus();
        t.value = step.value;
        if (t.type !== "number") t.setSelectionRange(step.value.length, step.value.length);
        t.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: step.value.slice(-1) || null }));
      }, step.msg, { target: t, selector: step.target, typed: true });
    }
    case "select": {
      const t = find(step.target);
      return perform(step.label, () => {
        t.value = step.value;
        t.dispatchEvent(new Event("input", { bubbles: true }));
        t.dispatchEvent(new Event("change", { bubbles: true }));
      }, step.msg, { target: t, selector: step.target });
    }
    case "dispatch":
      return perform(step.label, () => dispatch(step.msg), step.msg);
  }
  throw new Error(`unknown step ${step.do}`);
}

async function stepOnce() {
  if (pos >= spec.script.length) return;
  const step = spec.script[pos++];
  if (!mounted && step.do !== "mount") throw new Error("not mounted: press Reset");
  await runStep(step);
}

async function runAll() {
  while (pos < spec.script.length) {
    await stepOnce();
    await wait(30);
  }
}

async function reset() {
  if (mounted) app.dispose();
  mounted = false;
  state = null;
  manual = false;
  salt = 0;
  Object.assign(tally, { steps: 0, compared: 0, mismatches: 0, focusLost: 0, keyedReplaced: 0, errors: 0 });
  log.replaceChildren();
  pos = 0;
  await stepOnce();
}

async function sendEvent(ev, target) {
  if (!mounted) throw new Error("not mounted: press Reset");
  const msg = ev.make(state, target, `panel-${++salt}`);
  await perform(`${ev.name}${target ? " " + target : ""}`, () => dispatch(msg), msg);
}

// ---------------------------------------------------------------------------------------------
// Reporting

const mark = (v) => (v === true ? "✓" : v === false ? "✗" : "—");

let lastReport = null;

function report(r) {
  lastReport = r;
  const rows = [];
  rows.push(["action", r.label]);
  if (r.error) rows.push(["error", r.error]);
  if ("match" in r) rows.push(["page = reference", r.match === null ? "— (manual interaction since reset; press Reset to compare again)" : mark(r.match)]);
  if (r.mutations) rows.push(["elements created / removed", `${r.mutations.added} / ${r.mutations.removed}`]);
  if (r.keyedReplaced) rows.push(["keyed elements replaced", r.keyedReplaced.length ? "✗ " + r.keyedReplaced.slice(0, 6).join(", ") : "✓ none"]);
  if ("targetKept" in r) rows.push(["target element kept", r.targetKept === "removed" ? "— (removed)" : mark(r.targetKept)]);
  if ("focus" in r) rows.push(["focus and caret kept", mark(r.focus)]);
  if ("rootEmpty" in r) rows.push(["root empty after dispose", mark(r.rootEmpty)]);
  if ("listeners" in r) rows.push(["live listeners / timers", `${r.listeners} / ${r.timers}`]);
  checks.replaceChildren(...rows.flatMap(([k, v]) => [el("dt", {}, k), el("dd", { class: /✗/.test(v) ? "rr-bad" : "" }, v)]));
  diffBox.hidden = r.match !== false;
  diffBox.textContent = r.match === false ? r.diff : "";
  const bad = r.error || r.match === false || r.targetKept === false || r.keyedReplaced?.length || r.focus === false || r.rootEmpty === false || (r.rootEmpty && (r.listeners || r.timers));
  log.prepend(el("li", { class: bad ? "rr-bad" : "" }, `${r.label} ${r.error ? "✗ " + r.error : r.match === false ? "✗ differs" : r.match ? "✓" : ""}`));
  while (log.children.length > 60) log.lastChild.remove();
  setButtons();
}

// Start mounted: run the script's first step.
window.rrPanel = {
  stepOnce, runAll, reset,
  get tally() { return { ...tally, pos, total: spec.script.length }; },
  get last() { return lastReport; },
  ready: false,
};
await guard(reset);
window.rrPanel.ready = true;
