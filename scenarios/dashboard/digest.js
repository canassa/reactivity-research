// The dashboard in digest (prototype): compiled dirty checking.
//
// What a compiler for this approach would produce from the app's description (state,
// messages, view), and what this emitter writes:
// - One factory per widget kind present in the app, emitted once: the kind's template (HTML
//   with the instance's constants spliced in, escaped at build time), its bindings (one closure
//   per dynamic DOM property, reading the instance's state) and its handlers (the kind's update
//   cases, keyed by the data-role of the element that triggers them).
// - One row of plain data per widget instance: [factory, ...constants, ...initial state].
//   Rules are partially evaluated at build time into data: every field rule becomes one regular
//   expression, every amount format a prefix, a number of decimals and a suffix.
// - The external events (`receive`), with only the branches the app can receive.
// - Code only where it is used: a kind's metric and phrase are emitted only when a summary
//   reads a widget of that kind.
// The runtime (frameworks/digest/runtime.js) runs every binding after each event (one digest),
// reconciles keyed lists by id, and delegates click and input events to the handlers.

import { templateFiles } from "../../frameworks/digest/framework.js";

export const framework = "digest";

export const params = {};

const lit = (v) => JSON.stringify(v);
// A constant that is spliced into a template as HTML: escaped here, at build time.
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const html = (s) => lit(String(s).replace(/[&<>"]/g, (c) => ESC[c]));
// Booleans as 0/1.
const bit = (b) => (b ? "1" : "0");
const arr = (xs, f = lit) => `[${xs.map(f).join(",")}]`;

// Positions are the ids: the runtime numbers widgets w1, w2, … and list items 1, 2, … in
// order. The emitter checks that the spec agrees.
function sequential(xs, id) {
  xs.forEach((x, i) => {
    if (x.id !== id(i)) throw new Error(`digest expects sequential ids, got ${x.id} at ${i}`);
  });
}

// Each kind: `args` (the factory's parameters after the state `s`), `body` (its code),
// `metric` (what it returns when a summary reads it) and `row(w, s)` (the instance's constants
// and initial state, as source).
const KINDS = {
  counter: {
    args: "l, st, mn, mx, v0",
    body: `
  s.value = v0;
  widget("counter", l, \`<output data-role=value></output><button data-role=dec>-\${st}</button><button data-role=inc>+\${st}</button><button data-role=reset>Reset</button>\`, {
    dec: () => { s.value = Math.max(mn, s.value - st); },
    inc: () => { s.value = Math.min(mx, s.value + st); },
    reset: () => { s.value = v0; },
  });
  text("value", () => s.value);
  bind(role("dec"), "disabled", () => s.value <= mn);
  bind(role("inc"), "disabled", () => s.value >= mx);`,
    metric: `{ m: () => s.value, p: (n) => l + ": " + n }`,
    row: (w, s) => [lit(w.step), lit(w.min), lit(w.max), lit(s.value)],
  },

  toggles: {
    args: "l, names, on",
    body: `
  s.on = [...on];
  widget("toggles", l, \`<ul>\${names.map((n, i) => \`<li><label><input type=checkbox data-role=toggle data-key=\${i}>\${n}</label></li>\`).join("")}</ul><p data-role=count></p>\`, {
    toggle: (t, k) => { s.on[k] = t.checked; },
  });
  roles("toggle").forEach((n, i) => bind(n, "checked", () => s.on[i]));
  const count = () => s.on.filter(Boolean).length;
  text("count", () => count() + " of " + names.length + " on");`,
    metric: `{ m: count, p: (n) => n + " on in " + l }`,
    row: (w, s) => [arr(w.items, html), arr(s.on, bit)],
  },

  field: {
    args: "l, ph, re, msg, t0",
    body: `
  s.text = t0;
  re = RegExp(re);
  widget("field", l, \`<input type=text data-role=input placeholder="\${ph}"><p data-role=error>\${msg}</p>\`, {
    input: (t) => { s.text = t.value; },
  });
  bind(role("input"), "value", () => s.text);
  show(role("error"), () => !re.test(s.text));`,
    row: (w, s) => [html(w.placeholder), lit(rulePattern(w.rule)), html(w.rule.message), lit(s.text)],
  },

  todo: {
    args: "l, ph, add, rm, items",
    body: `
  s.items = items.map(([text, done], i) => ({ id: i + 1, text, done }));
  s.draft = "";
  widget("todo", l, \`<input type=text data-role=draft placeholder="\${ph}"><button data-role=add>\${add}</button><ul></ul><p data-role=left></p>\`, {
    draft: (t) => { s.draft = t.value; },
    add: () => {
      const text = s.draft.trim();
      if (text) {
        s.items.push({ id: Math.max(0, ...s.items.map((i) => i.id)) + 1, text, done: false });
        s.draft = "";
      }
    },
    toggle: (t, k) => { s.items.find((i) => i.id == k).done = t.checked; },
    remove: (t, k) => { s.items = s.items.filter((i) => i.id != k); },
  });
  bind(role("draft"), "value", () => s.draft);
  list($("ul"), () => s.items, (r, i) => {
    const li = el("li", \`<input type=checkbox data-role=toggle><span></span><button data-role=remove>\${rm}</button>\`);
    li.dataset.key = i.id;
    bind(li.firstChild, "checked", () => r.i.done);
    bind(li.children[1], "textContent", () => r.i.text);
    return li;
  });
  const left = () => s.items.filter((i) => !i.done).length;
  text("left", () => left() + " left");`,
    metric: `{ m: left, p: (n) => n + " left in " + l }`,
    row: (w, s) => {
      sequential(s.items, (i) => i + 1);
      return [html(w.placeholder), html(w.addText), html(w.removeText), arr(s.items, (it) => `[${lit(it.text)},${bit(it.done)}]`)];
    },
  },

  tabs: {
    args: "l, titles, texts, a",
    body: `
  s.active = a;
  widget("tabs", l, \`<div role=tablist>\${titles.map((t, i) => \`<button role=tab data-role=tab data-key=\${i}>\${t}</button>\`).join("")}</div><p role=tabpanel data-role=tab-content></p>\`, {
    tab: (t, k) => { s.active = +k; },
  });
  roles("tab").forEach((n, i) => bind(n, "ariaSelected", () => "" + (i == s.active)));
  text("tab-content", () => texts[s.active]);`,
    row: (w, s) => [arr(w.tabs.map((t) => t.title), html), arr(w.tabs.map((t) => t.content)), lit(s.active)],
  },

  panel: {
    args: "l, sh, hi, body, o",
    body: `
  s.open = o;
  widget("panel", l, \`<button data-role=toggle></button><p data-role=body>\${body}</p>\`, {
    toggle: () => { s.open = !s.open; },
  });
  bind(role("toggle"), "ariaExpanded", () => "" + !!s.open);
  text("toggle", () => (s.open ? hi : sh));
  show(role("body"), () => s.open);`,
    row: (w, s) => [lit(w.showText), lit(w.hideText), html(w.body), bit(s.open)],
  },

  choice: {
    args: "l, values, labels, xf, ph, o, x",
    body: `
  s.option = o;
  s.extra = x;
  widget("choice", l, \`<select data-role=select>\${values.map((v, i) => \`<option value="\${v}">\${labels[i]}</option>\`).join("")}</select><input type=text data-role=extra placeholder="\${ph}">\`, {
    select: (t) => { s.option = t.value; },
    extra: (t) => { s.extra = t.value; },
  });
  bind(role("select"), "value", () => s.option);
  const extra = role("extra");
  bind(extra, "value", () => s.extra);
  show(extra, () => xf.includes(values.indexOf(s.option)));`,
    row: (w, s) => [arr(w.options.map((o) => o.value), html), arr(w.options.map((o) => o.label), html),
      arr(w.extraFor.map((v) => w.options.findIndex((o) => o.value === v))), html(w.extraPlaceholder), lit(s.option), lit(s.extra)],
  },

  amount: {
    args: "l, d, pre, suf, v0",
    body: `
  s.value = v0;
  widget("amount", l, "<input type=number data-role=input><output data-role=formatted></output>", {
    input: (t) => { t.value && (s.value = +t.value); },
  });
  bind(role("input"), "value", () => "" + s.value);
  text("formatted", () => pre + s.value.toFixed(d) + suf);`,
    metric: `{ m: () => s.value, p: (n) => l + ": " + n }`,
    row: (w, s) => {
      const f = w.format;
      const [pre, suf] = f.type === "currency" ? [f.symbol, ""] : f.type === "percent" ? ["", "%"] : ["", " " + f.unit];
      return [lit(f.decimals), lit(pre), lit(suf), lit(s.value)];
    },
  },

  filter: {
    args: "l, ph, items, q",
    body: `
  s.query = q;
  items = items.map((text, i) => ({ id: i + 1, text }));
  widget("filter", l, \`<input type=text data-role=query placeholder="\${ph}"><ul></ul><p data-role=matches></p>\`, {
    query: (t) => { s.query = t.value; },
  });
  bind(role("query"), "value", () => s.query);
  const shown = () => items.filter((i) => i.text.toLowerCase().includes(s.query.toLowerCase()));
  list($("ul"), shown, (r, i) => {
    const li = el("li", "");
    li.dataset.key = i.id;
    li.textContent = i.text;
    return li;
  });
  text("matches", () => shown().length + " matches");`,
    metric: `{ m: () => shown().length, p: (n) => n + " found in " + l }`,
    row: (w, s) => {
      sequential(w.items, (i) => i + 1);
      return [html(w.placeholder), arr(w.items.map((it) => it.text)), lit(s.query)];
    },
  },

  rating: {
    args: "l, labels, v",
    body: `
  s.stars = v;
  widget("rating", l, \`<div>\${labels.slice(1).map((_, i) => \`<button data-role=star data-key=\${i + 1}></button>\`).join("")}</div><p data-role=rating-label></p>\`, {
    star: (t, k) => { s.stars = +k; },
  });
  roles("star").forEach((n, i) => {
    bind(n, "ariaPressed", () => "" + (i < s.stars));
    bind(n, "textContent", () => (i < s.stars ? "★" : "☆"));
  });
  text("rating-label", () => labels[s.stars]);`,
    metric: `{ m: () => s.stars, p: (n) => n + " stars for " + l }`,
    row: (w, s) => {
      if (w.labels.length !== w.stars + 1) throw new Error("digest expects one label per rating plus one");
      return [arr(w.labels), lit(s.stars)];
    },
  },

  feed: {
    args: "l, empty, dismiss, entries",
    body: `
  s.entries = entries.map((text, i) => ({ id: i + 1, text }));
  widget("feed", l, \`<ul></ul><p data-role=empty>\${empty}</p>\`, {
    dismiss: (t, k) => { s.entries = s.entries.filter((e) => e.id != k); },
  });
  list($("ul"), () => s.entries, (r, i) => {
    const li = el("li", \`<span></span><button data-role=dismiss>\${dismiss}</button>\`);
    li.dataset.key = i.id;
    bind(li.firstChild, "textContent", () => r.i.text);
    return li;
  });
  show(role("empty"), () => !s.entries.length);`,
    metric: `{ m: () => s.entries.length, p: (n) => n + " in " + l }`,
    row: (w, s) => {
      sequential(s.entries, (i) => i + 1);
      return [html(w.emptyText), html(w.dismissText), arr(s.entries.map((e) => e.text))];
    },
  },

  clock: {
    args: "l, a, b, c, sec, run",
    body: `
  s.seconds = sec;
  s.running = run;
  widget("clock", l, \`<output data-role=time></output><button data-role=start>\${a}</button><button data-role=stop>\${b}</button><button data-role=reset>\${c}</button>\`, {
    start: () => { s.running = true; },
    stop: () => { s.running = false; },
    reset: () => { s.seconds = 0; s.running = false; },
  });
  text("time", () => Math.floor(s.seconds / 60) + ":" + String(s.seconds % 60).padStart(2, "0"));
  bind(role("start"), "disabled", () => s.running);
  bind(role("stop"), "disabled", () => !s.running);
  const tick = () => { s.running && s.seconds++; };`,
    // A clock always answers tick; a summary may also read it.
    returns: `{ t: tick }`,
    metric: `{ t: tick, m: () => s.seconds, p: (n) => n + "s on " + l }`,
    row: (w, s) => [html(w.startText), html(w.stopText), html(w.resetText), lit(s.seconds), bit(s.running)],
  },

  summary: {
    args: "l, pre, f, src",
    body: `
  widget("summary", l, "<p data-role=summary></p>");
  src = src.map((i) => E["w" + i]);
  const num = (x) => "" + Math.round(x * 100) / 100;
  text("summary", () => {
    const v = src.map((e) => e.m());
    const total = num(v.reduce((a, b) => a + b));
    return f == 2 ? src.map((e, i) => e.p(num(v[i]))).join("; ") : pre + ": " + (f ? v.map(num).join(" + ") + " = " : "") + total;
  });`,
    row: (w) => [lit(w.formula === "list" ? "" : w.prefix), lit({ sum: 0, breakdown: 1, list: 2 }[w.formula]),
      arr(w.sources.map((id) => Number(id.slice(1))))],
  },
};

// Every field rule as one regular expression the text must match: "required" is "some
// non-space" (String.prototype.trim and \s strip the same characters), "minLength n" is "n
// UTF-16 units" (what .length counts).
function rulePattern(rule) {
  if (rule.type === "required") return "\\S";
  if (rule.type === "minLength") return `[^]{${rule.min}}`;
  return rule.pattern;
}

function appFile(spec) {
  sequential(spec.widgets, (i) => `w${i + 1}`);
  const kinds = [...new Set(spec.widgets.map((w) => w.kind))];
  const read = new Set(spec.widgets.filter((w) => w.kind === "summary")
    .flatMap((w) => w.sources).map((id) => spec.widgets.find((x) => x.id === id).kind));

  const factories = kinds.map((k) => {
    const K = KINDS[k];
    const ret = read.has(k) ? K.metric : K.returns;
    return `const ${k} = (s, ${K.args}) => {${K.body}${ret ? `\n  return ${ret};` : ""}\n};`;
  });

  const rows = spec.widgets.map((w) => {
    const s = spec.initialState.widgets[w.id];
    return `  [${[w.kind, lit(w.label), ...KINDS[w.kind].row(w, s)].join(", ")}],`;
  });

  // External events: only the branches this app can receive.
  const has = (k) => kinds.includes(k);
  const branches = [
    `if (m.type == "serverSet") Object.assign(S[m.widget], m.state);`,
    `else if (m.type == "snapshot") for (const k in m.state.widgets) Object.assign(S[k], m.state.widgets[k]);`,
  ];
  if (has("clock")) branches.push(`else if (m.type == "tick") for (const k in E) E[k]?.t?.();`);
  if (has("feed")) branches.push(`else if (m.type == "notify") S[m.widget].entries.push(m.entry);`);

  return `// Generated by scenarios/dashboard/digest.js. Do not edit.
import { app, widget, bind, text, role, roles, show, list, el, $, S, E } from "./runtime.js";

${factories.join("\n\n")}

// External events, applied to the widgets' state (S) and what they expose (E).
const receive = (m) => {
  ${branches.join("\n  ")}
};

// One row per widget, in page order: [kind, label, ...constants, ...initial state].
export default app([
${rows.join("\n")}
], receive);
`;
}

export function emit(spec) {
  return {
    files: {
      ...templateFiles({ name: "dashboard", title: "Dashboard" }),
      "src/app.js": appFile(spec),
    },
    style: {
      approach: "compiled dirty checking: bindings are closures re-run after every event, writing a DOM property only when its value changed",
      components: "one factory per widget kind present in the app; one data row per instance",
      state: "plain mutable objects, one per widget; external replacements merge into them",
      templates: "HTML strings with the instance's constants (escaped at build time), parsed once per widget or list item",
      lists: "keyed by id, reconciled in place by the runtime",
      conditionals: "a binding that inserts or removes one node",
      events: "one delegated click and input listener; handlers keyed by data-role",
      derived: "plain functions read by bindings; no memoization",
      build: "Vite production build, no plugin, hidden source maps",
    },
  };
}
