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
const btnSame = el("button", { title: "Replay the script, landing two events in one task at a few steps", onclick: () => guard(sameTaskButton) }, "Same-task pass");

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
  el("section", {}, el("h3", {}, "Interaction script"), stepLabel, el("div", { class: "rr-row" }, btnStep, btnRun, btnReset, btnSame)),
  el("section", {}, el("h3", {}, "External events (dispatch)"), events),
  el("section", {}, el("h3", {}, "Last action"), checks, diffBox),
  el("section", {},
    el("h3", {}, "Reference render ", el("button", { class: "rr-small", onclick: () => { refBox.hidden = !refBox.hidden; showReference(); } }, "show / hide")),
    refBox),
  el("section", {}, el("h3", {}, "Log"), log),
);

function labelOf(id) {
  const w = spec.widgets?.find((x) => x.id === id);
  if (w) return `${id} · ${w.kind} · ${w.label}`;
  const t = spec.tables?.find((x) => x.id === id) || spec.pages?.find((x) => x.id === id);
  return t ? `${id} · ${t.title}` : id;
}

// Owner interaction with the app (trusted events) means the reference no longer follows.
for (const type of ["click", "input", "change", "keydown"]) {
  // (A scripted checkbox click() fires trusted input/change events too, hence `acting`.)
  on(root, type, (e) => { if (e.isTrusted && mounted && !acting) manual = true; }, true);
}

// ---------------------------------------------------------------------------------------------
// Comparing the page with the reference render

// One line per element, with sorted attributes and the live properties that matter
// (input value or checked, select value); whitespace, comments and an empty class ignored.
// `exempt`: an input whose displayed value is not compared (written as :value=*).
function canonLive(node, depth = 0, out = [], exempt = null) {
  const pad = "  ".repeat(depth);
  const attrs = [];
  for (const a of node.attributes) {
    if (a.name === "value" && (node.tagName === "INPUT" || node.tagName === "SELECT")) continue;
    if (a.name === "checked" || a.name === "selected") continue;
    // An empty class attribute is no class (frameworks leave class="" after removing the last one).
    if (a.name === "class" && a.value.trim() === "") continue;
    attrs.push(`${a.name}="${a.value}"`);
  }
  if (node.tagName === "INPUT") attrs.push(node.type === "checkbox" ? `:checked=${node.checked}` : node === exempt ? ":value=*" : `:value="${node.value}"`);
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
    else if (c.nodeType === 1) { flush(); canonLive(c, depth + 1, out, exempt); }
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

// `exempt`: an input whose displayed value is exempt for this step (a script step typing an
// invalid value, which the scenario says sends no message and keeps the typed text).
function compare(exempt = null) {
  const live = [];
  for (const c of root.children) canonLive(c, 0, live, exempt);
  const want = state ? canonRef(ref.render(spec, state)) : [];
  const n = Math.max(live.length, want.length);
  for (let i = 0; i < n; i++) {
    const same = live[i] === want[i] || (live[i]?.includes(":value=*") && live[i] === want[i]?.replace(/:value="[^"]*"/, ":value=*"));
    if (!same) {
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
  refBox.append(referenceDom(state));
}

// The reference render of `s` as a detached DOM tree.
function referenceDom(s) {
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
  return build(ref.render(spec, s));
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
  btnReset.disabled = btnSame.disabled = running;
  stepLabel.textContent = pos < spec.script.length
    ? `next: step ${pos + 1} of ${spec.script.length} — ${spec.script[pos].label}`
    : `script finished (${spec.script.length} steps, ${tally.compared} compared with the reference): ${tally.mismatches} mismatches, ${tally.focusLost} focus/caret losses, ${tally.keyedReplaced} steps replacing keyed elements, ${tally.errors} errors`;
}

// Perform one action and report on it. `act` changes the page; `msg` (if any) is the
// reference message it stands for, or a list of messages applied in that order, or a function
// returning that list, called after the action.
async function perform(label, act, msg, opts = {}) {
  if (replaying) return replay(act, msg);
  observer.takeRecords();
  mutations = { added: 0, removed: 0 };
  const target = opts.target || null;
  const keyedBefore = keyedElements();
  acting = true;
  try { await act(); } finally { acting = false; }
  await app.settled();
  countMutations(observer.takeRecords());
  applyMessages(msg);
  const result = { label, mutations: { ...mutations } };
  if (mounted) {
    if (manual) result.match = null;
    else {
      let c = compare(opts.exemptValue ? target : null);
      // `orElse`: another reference state the page may equally show (see sameTaskAction).
      if (!c.ok && opts.orElse) {
        const was = state;
        state = opts.orElse();
        const other = compare(opts.exemptValue ? target : null);
        if (other.ok) c = other;
        else state = was;
      }
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
  // A scenario with timers says how many intervals may run in a state (routed-app: one per
  // mounted time-driven field), so one left behind by an unmounted page is caught.
  if (mounted && ref.maxIntervals) {
    const running = hooks.liveTimers().filter((t) => t === "interval").length, allowed = ref.maxIntervals(spec, state);
    if (running > allowed) (result.problems ||= []).push(`${running} intervals running, at most ${allowed} expected (a timer of an unmounted page or tab?)`);
  }
  // The script's busiest point (most intervals, then most listeners), where the same-task pass
  // disposes mid-script.
  if (mounted && !inPass) {
    const busy = hooks.liveTimers().filter((t) => t === "interval").length * 1e6 + result.listeners * 1e3 + result.timers;
    if (busy > busiest.busy) busiest = { at: pos, busy };
  }
  tally.steps++;
  report(result);
  showReference();
}

// The same action without any checks or report, for the same-task pass's replays (every step
// was checked by the script run already).
let replaying = false;
async function replay(act, msg) {
  acting = true;
  try { await act(); } finally { acting = false; }
  await app.settled();
  applyMessages(msg);
}

function applyMessages(msg) {
  if (typeof msg === "function") msg = msg();
  for (const m of msg == null ? [] : [].concat(msg)) if (state) state = ref.update(spec, state, m);
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

// Perform a step's action synchronously: on `t`, its element, for a DOM step.
function fire(step, t) {
  switch (step.do) {
    case "click":
      return t.click();
    case "type":
      t.focus();
      t.value = step.value;
      if (t.type !== "number") t.setSelectionRange(step.value.length, step.value.length);
      t.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: step.value.slice(-1) || null }));
      return;
    case "select":
      t.value = step.value;
      t.dispatchEvent(new Event("input", { bubbles: true }));
      t.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    case "dispatch":
      return dispatch(step.msg);
    case "clock": // one tick of the virtual clock (hooks.js): every running interval fires once
      return hooks.fireIntervals();
  }
  throw new Error(`unknown step ${step.do}`);
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
    case "click":
    case "type":
    case "select": {
      const t = find(step.target);
      const opts = { target: t, selector: step.target };
      if (step.do === "type") Object.assign(opts, { typed: true, exemptValue: !!step.exemptValue });
      return perform(step.label, () => fire(step, t), step.msg, opts);
    }
    case "dispatch":
    case "clock":
      return perform(step.label, () => fire(step), step.msg);
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
  busiest = { at: 0, busy: -1 };
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
  // `clock`: the event is a tick of the virtual clock, not a dispatch.
  await perform(`${ev.name}${target ? " " + target : ""}`, () => (ev.clock ? hooks.fireIntervals() : dispatch(msg)), msg);
}

// ---------------------------------------------------------------------------------------------
// The same-task pass
//
// The script awaits settled() between steps, so it never sees a second event arrive before an
// app's batched update has run. This pass does: it replays the script and, at a few sampled
// points, runs two actions A then B in one task (no await, no microtask between them), then
// awaits settled() and compares with the reference as usual. The samples, planned on the
// reference and the script alone:
//  - twice: a click step clicked twice (one per kind of control, by the shape of its selector,
//    row and list controls first);
//  - next: a step and the step after it, structural steps first (a step that adds or removes
//    controls: a navigation, a tab, a modal, an external event), and two dispatches in a row;
//  - stale: a step that removes a control with its scope (its item, page, tab panel or
//    dialog: its keyed ancestors), then a click on that control's old element;
//  - event: at the end of the script, each of the panel's external events (built for the
//    current state, as its buttons do) that removes a control so, then a click on that control.
//  - rewrite (not two actions): right after a step typing an invalid value, which the script
//    exempts from comparison, a whole-state snapshot re-sending the current state; every input,
//    the typed-into one too, must then show its model value (an app that writes a field only
//    when its value changes keeps the typed text).
// (A control that stops being shown while its scope stays has no defined meaning once gone, as
// an app that renders synchronously never receives its click; no sample uses one.)
// B's element is looked up after A has run (for stale, the element from before A). A click on
// an element that is no longer in the page is skipped, as a browser would; an element still
// there because the app patches the page later is clicked. The reference applies A's message,
// then B's only if B fired and the state after A still renders B's target: an action on a
// control that no longer exists is a no-op, and must not change the app's state either. After a
// sample that left the page right and the reference where the script expects it, the replay
// goes on; otherwise it restarts from mount, so a failure is reported once, by its sample.
// Last, a dispose mid-script, at the busiest point of the script run (most intervals, then
// listeners), must leave the root empty and nothing running, and a remount must work.

const SAME_TASK = { twice: 4, next: 4, stale: 4, event: 4, rewrite: 4, remount: 3 };
let busiest = { at: 0, busy: -1 };   // see perform
let inPass = false;
const DOM_STEPS = ["click", "type", "select"];
const keyCount = (selector) => (selector.match(/data-key=/g) || []).length;
const controlShape = (selector) => selector.replace(/data-key="[^"]*"/g, 'data-key="*"');
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const roleOf = (selector) => [...selector.matchAll(/data-role="([^"]*)"/g)].pop()?.[1];
const clean = (r) => !r.error && r.match !== false && !r.keyedReplaced?.length && r.targetKept !== false && !r.problems?.length;
const kindOf = (step) => step.do + ":" + (step.target ? roleOf(step.target) : step.msg?.type);

// The reference render of a state, in a detached box, cached per state.
const refTrees = new WeakMap();
function refTree(s) {
  if (!refTrees.has(s)) {
    const box = document.createElement("div");
    box.append(referenceDom(s));
    refTrees.set(s, box);
  }
  return refTrees.get(s);
}
const shows = (s, selector) => refTree(s).querySelector(selector) !== null;

// An element of a reference tree as a selector: its keyed ancestors (data-key, data-role), then
// its own data-role and data-key. Its scope: the keyed ancestors alone (an item, a page, a tab
// panel, a dialog), or "" for none.
const attrSel = (e) => (e.dataset.key != null ? `[data-key="${e.dataset.key}"]` : "") + (e.dataset.role != null ? `[data-role="${e.dataset.role}"]` : "");
function scopeOf(e) {
  const keys = [];
  for (let x = e.parentElement; x.parentElement; x = x.parentElement) if (x.dataset.key != null) keys.unshift(attrSel(x));
  return keys.join(" ");
}

// What the plan needs of a state's reference render, cached per state: its controls (elements
// with a role the script clicks), each as its selector and its scope; the selectors of its keyed
// elements (so a scope is there when it is one of them); and the controls as one string.
const planInfos = new WeakMap();
function planInfo(s, roles) {
  if (!planInfos.has(s)) {
    const controls = [], keyed = new Set();
    for (const e of refTree(s).querySelectorAll("[data-key], [data-role]")) {
      const scope = scopeOf(e), sel = `${scope} ${attrSel(e)}`.trim();
      if (e.dataset.key != null) keyed.add(sel);
      if (e.dataset.role != null && roles.has(e.dataset.role)) controls.push({ sel, scope });
    }
    planInfos.set(s, { controls, keyed, all: controls.map((c) => c.sel).join("\n") });
  }
  return planInfos.get(s);
}

// Whether `selector`'s element in `before` belongs to a scope that `after` no longer has: a
// control whose item, page, panel or dialog is gone. Only such a control has a defined meaning
// once gone (its action is a no-op); one that merely stops being shown while its scope stays is
// left out of the samples, as an app that renders synchronously never receives its click.
function scopeGone(before, after, selector) {
  const e = refTree(before).querySelector(selector);
  const scope = e && scopeOf(e);
  return !!scope && !refTree(after).querySelector(scope);
}

function sameTaskPlan() {
  const script = spec.script;
  // states[i]: the reference state before step i (null before mount).
  const states = [null];
  for (const step of script) {
    const s = states[states.length - 1];
    states.push(step.do === "mount" ? spec.initialState : step.do === "dispose" ? null : step.msg && s ? ref.update(spec, s, step.msg) : s);
  }
  const roles = new Set(script.filter((s) => s.do === "click").map((s) => roleOf(s.target)));
  // A control the state before shows (exactly once) in a scope the state after no longer has.
  const removed = (before, after) => {
    const later = planInfo(after, roles);
    for (const { sel, scope } of planInfo(before, roles).controls) {
      if (scope && !later.keyed.has(scope) && refTree(before).querySelectorAll(sel).length === 1) return sel;
    }
    return null;
  };
  const acts = (step) => step.do === "dispatch" || step.do === "clock" || (DOM_STEPS.includes(step.do) && step.msg);
  const samples = [];
  const take = (list, cap) => {
    const seen = new Set();
    for (const c of list) {
      if (seen.size >= cap) break;
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      samples.push(c);
    }
  };

  // twice: the first click step of each control shape whose second click has a defined
  // meaning (its control is still shown, or its scope is gone).
  const defined = (i) => shows(states[i + 1], script[i].target) || scopeGone(states[i], states[i + 1], script[i].target);
  const shapes = new Map();
  script.forEach((step, i) => {
    if (step.do === "click" && step.msg && !shapes.has(controlShape(step.target)) && defined(i)) shapes.set(controlShape(step.target), i);
  });
  take([...shapes.values()]
    .sort((a, b) => (keyCount(script[b].target) >= 2) - (keyCount(script[a].target) >= 2) || a - b)
    .map((i) => ({ at: i, kind: "twice", a: script[i], b: script[i], key: i, resume: [i + 1] })), SAME_TASK.twice);

  // next and stale.
  const next = [], stale = [];
  script.forEach((a, i) => {
    if (!states[i] || !acts(a)) return;
    const gone = removed(states[i], states[i + 1]);
    const structural = gone !== null || planInfo(states[i], roles).all !== planInfo(states[i + 1], roles).all;
    const b = script[i + 1];
    if (b && acts(b)) {
      const external = a.do === "dispatch" || a.do === "clock";
      const score = (structural ? 2 : 0) + (external ? 1 : 0) + (external && (b.do === "dispatch" || b.do === "clock") ? 2 : 0);
      if (score > 0) next.push({ at: i, kind: "next", a, b, score, key: `${kindOf(a)} ${kindOf(b)}`, resume: [i + 2, i + 1] });
    }
    if (gone) stale.push({ at: i, kind: "stale", a, b: { do: "click", target: gone, label: `the old ${gone}` }, key: kindOf(a), external: a.do !== "click", resume: [i + 1] });
  });
  take(next.sort((x, y) => y.score - x.score || x.at - y.at), SAME_TASK.next);
  take(stale.sort((x, y) => y.external - x.external || x.at - y.at), SAME_TASK.stale);
  // rewrite: right after a step typing an invalid value (exemptValue), one per input.
  take(script.flatMap((a, i) => (a.exemptValue ? [{ at: i + 1, kind: "rewrite", a, key: a.target, resume: [i + 1] }] : [])), SAME_TASK.rewrite);
  samples.sort((x, y) => x.at - y.at || (y.kind === "rewrite") - (x.kind === "rewrite"));
  return { samples, states, removed };
}

// A whole-state snapshot that sends `s` itself: the panel's snapshot event with `s` as its one
// field, if the reference agrees that it leaves the state as it is; else null. A snapshot of
// part of the state (a field named after a field of the state: routed-app's `global`) writes
// no page input, so it does not count.
function sameSnapshot(s) {
  const ev = ref.panelEvents(spec).find((e) => e.name === "snapshot" && !e.clock);
  if (!ev) return null;
  const made = ev.make(s, null, "same-task");
  const fields = Object.keys(made).filter((k) => k !== "type");
  if (fields.length !== 1 || fields[0] in s) return null;
  const msg = { type: made.type, [fields[0]]: s };
  return sameJson(ref.update(spec, s, msg), s) ? msg : null;
}

// Run A then B in one task and report on it. `stale`: B acts on the element found before A.
async function sameTaskAction(label, a, b, stale) {
  const node = (step) => (DOM_STEPS.includes(step.do) ? root.querySelector(step.target) : undefined);
  const aNode = node(a);
  if (aNode === null) throw new Error(`no element ${a.target}`);
  const old = stale ? node(b) : undefined;
  if (old === null) throw new Error(`no element ${b.target}`);
  let fired = false;
  const before = state;
  await perform(label, () => {
    fire(a, aNode);
    const t = stale ? old : node(b);
    if (t === null || (t && !t.isConnected)) return;   // gone from the page: a browser can't click it
    fire(b, t);
    fired = true;
  }, () => {
    const msgs = a.msg ? [a.msg] : [];
    const afterA = msgs.length ? ref.update(spec, before, a.msg) : before;
    const live = b.do === "dispatch" || b.do === "clock" || (!stale && shows(afterA, b.target));
    if (fired && live && b.msg) msgs.push(b.msg);
    return msgs;
  }, {
    // A tick of the virtual clock in the same task as a step that starts a timer (a page or tab
    // shown) may or may not reach that new timer: an app that mounts in a microtask has not
    // started it yet, and in a browser a new interval's first tick comes in a later task. So
    // the page may also show the state without that tick. A tick that reaches a timer of a page
    // left in the same task must still change nothing.
    orElse: b.do === "clock" && a.msg ? () => ref.update(spec, before, a.msg) : undefined,
  });
  return fired;
}

// Runs the pass; returns one entry per sample, with the panel's report on it.
async function sameTask() {
  inPass = true;
  try {
    return await sameTaskPass();
  } finally {
    inPass = false;
  }
}

async function sameTaskPass() {
  const { samples, states, removed } = sameTaskPlan();
  const end = spec.script.findIndex((s) => s.do === "dispose");
  const out = [];
  let next = Infinity;   // the next script step to replay; Infinity: restart from mount
  let replayed = 0;
  let rewriteSkipped = false;
  const replayTo = async (at) => {
    if (next > at) {
      if (mounted) app.dispose();
      mounted = false;
      state = null;
      manual = false;
      next = 0;
    }
    replaying = true;
    try {
      while (next < at) { await runStep(spec.script[next++]); replayed++; }
    } finally {
      replaying = false;
    }
  };
  const failed = (label, err) => {
    out.push({ step: pos, report: { label, error: err.message } });
    next = Infinity;
  };
  const what = { twice: "twice", next: "then", stale: "then a click on" };

  for (const sample of samples) {
    const { a, b, kind } = sample;
    const label = kind === "twice" ? `same task: ${a.label}, twice`
      : kind === "rewrite" ? `after ${a.label}, a snapshot of the same state (every input shows its model value)`
      : `same task: ${a.label}, ${what[kind]} ${b.label}`;
    try {
      await replayTo(sample.at);
      pos = sample.at + 1;
      if (kind === "rewrite") {
        // The typed invalid text stays (the script exempts it) until something writes the
        // field: a snapshot re-sending the value the model already has must still repaint it.
        const msg = sameSnapshot(state);
        if (!msg) { rewriteSkipped = true; continue; }
        pos = sample.at;
        await perform(label, () => dispatch(msg), msg);
      } else await sameTaskAction(label, a, b, kind === "stale");
      out.push({ step: pos, report: lastReport });
      const ok = clean(lastReport);
      if (ok && kind === "twice" && !sameJson(state, states[sample.at + 1]) && root.querySelector(a.target)) {
        // One more click often brings the state back where the script expects it (a toggle, a
        // swap), which saves a replay from mount.
        replaying = true;
        try { await runStep(a); } finally { replaying = false; }
      }
      const resume = ok ? sample.resume.find((k) => sameJson(state, states[k])) : undefined;
      next = resume ?? Infinity;
    } catch (err) {
      failed(label, err);
    }
  }

  // event: chained from the state at the end of the script.
  let events = 0;
  try {
    await replayTo(end);
    pos = end;
    for (const ev of ref.panelEvents(spec)) {
      if (events >= SAME_TASK.event) break;
      let pick = null;
      for (const target of ev.targets ?? [null]) {
        const msg = ev.make(state, target, `same-task-${ev.name}`);
        const gone = removed(state, ref.update(spec, state, msg));
        if (gone) { pick = { msg, target, gone }; break; }
      }
      if (!pick) continue;
      events++;
      const a = { do: ev.clock ? "clock" : "dispatch", msg: pick.msg, label: `${ev.name}${pick.target ? " " + pick.target : ""}` };
      const label = `same task: ${a.label}, then a click on the old ${pick.gone}`;
      try {
        await sameTaskAction(label, a, { do: "click", target: pick.gone }, true);
        out.push({ step: pos, report: lastReport });
        if (!clean(lastReport)) break;
      } catch (err) {
        failed(label, err);
        break;
      }
    }
  } catch (err) {
    failed("same task: replay to the end of the script", err);
  }

  // A dispose mid-script, at the script's busiest point (the script itself ends in a quiet state
  // before its dispose): nothing may be left. Then a fresh mount and a few steps, so a remount
  // works.
  let disposedAt = Math.min(busiest.at, end);
  if (disposedAt < 2 || disposedAt === end) disposedAt = Math.max(1, Math.floor(end / 2));
  try {
    await replayTo(disposedAt);
    pos = disposedAt;
    await runStep({ do: "dispose", label: `dispose after step ${disposedAt} (${spec.script[disposedAt - 1].label}), the busiest point` });
    out.push({ step: pos, report: lastReport });
    next = Infinity;
    for (let i = 0; i <= SAME_TASK.remount && i < end; i++) {
      const step = spec.script[i];
      await runStep(i === 0 ? { ...step, label: `remount after that dispose` } : step);
      pos = i + 1;
      out.push({ step: pos, report: lastReport });
    }
  } catch (err) {
    failed("dispose mid-script, then remount", err);
  }

  if (mounted) app.dispose();
  mounted = false;
  state = null;
  pos = spec.script.length;
  const count = samples.filter((x) => !(x.kind === "rewrite" && rewriteSkipped)).length + events;
  return { samples: count, rewriteSkipped, disposedAt, replayed, results: out };
}

async function sameTaskButton() {
  const { samples, results } = await sameTask();
  const bad = results.filter((r) => !clean(r.report));
  report({ label: `same-task pass: ${samples} samples, ${bad.length} failing` + (bad.length ? ` (first: ${bad[0].report.label})` : "") });
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
  for (const p of r.problems || []) rows.push(["problem", "✗ " + p]);
  checks.replaceChildren(...rows.flatMap(([k, v]) => [el("dt", {}, k), el("dd", { class: /✗/.test(v) ? "rr-bad" : "" }, v)]));
  diffBox.hidden = r.match !== false;
  diffBox.textContent = r.match === false ? r.diff : "";
  const bad = r.error || r.match === false || r.targetKept === false || r.keyedReplaced?.length || r.focus === false || r.rootEmpty === false || (r.rootEmpty && (r.listeners || r.timers)) || r.problems?.length;
  log.prepend(el("li", { class: bad ? "rr-bad" : "" }, `${r.label} ${r.error ? "✗ " + r.error : r.match === false ? "✗ differs" : r.match ? "✓" : ""}`));
  while (log.children.length > 60) log.lastChild.remove();
  setButtons();
}

// Start mounted: run the script's first step.
window.rrPanel = {
  stepOnce, runAll, reset, sameTask,
  get tally() { return { ...tally, pos, total: spec.script.length }; },
  get last() { return lastReport; },
  ready: false,
};
await guard(reset);
window.rrPanel.ready = true;
