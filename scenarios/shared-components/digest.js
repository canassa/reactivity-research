// The dashboard in digest (prototype): compiled dirty checking.
//
// What a compiler for this approach would produce from the app's description (state,
// messages, view), and what this emitter writes:
// - One factory per widget kind present in the app, emitted once: the kind's template (HTML
//   with the instance's constants spliced in, escaped at build time), its bindings (one closure
//   per dynamic DOM property, on the template element at a known position) and its handlers
//   (the kind's update cases, one per control, in the template's document order).
// - One row of plain data per widget instance: [factory, ...constants, ...initial state].
//   Rules are partially evaluated at build time into data: every field rule becomes one regular
//   expression, every amount format a prefix, a number of decimals and a suffix.
// - The external events (`receive`), with only the branches the app can receive.
// - Code only where it is used: a kind's metric and phrase are emitted only when a summary
//   reads a widget of that kind.
// - Locality: an event digests only the widget it touched. A summary adds its binding to each
//   source's list, external events digest only the widgets they name, and tick runs only the
//   clocks (each registers its tick function in T).
// The runtime (frameworks/digest/runtime.js) keeps one binding list per widget and runs it after
// that widget's events (a local digest), reconciles keyed lists by id, and delegates click and
// input events to the handlers.

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
  let value = v0;
  widget("counter", l, \`<output data-role=value></output><button data-role=dec>-\${st}</button><button data-role=inc>+\${st}</button><button data-role=reset>Reset</button>\`, [
    () => value = Math.max(mn, value - st), // dec
    () => value = Math.min(mx, value + st), // inc
    () => value = v0, // reset
  ], (v) => ({ value } = v));
  text(1, () => value);
  bind(2, "disabled", () => value <= mn);
  bind(3, "disabled", () => value >= mx);`,
    metric: `{ m: () => value, p: (n) => l + ": " + n }`,
    row: (w, s) => [lit(w.step), lit(w.min), lit(w.max), lit(s.value)],
  },

  toggles: {
    args: "l, names, on",
    body: `
  widget("toggles", l, \`<ul>\${names.map((n, i) => \`<li><label><input type=checkbox data-role=toggle data-key=\${i}>\${n}</label></li>\`).join("")}</ul><p data-role=count></p>\`,
    names.map((n, i) => (t) => on[i] = t.checked), // toggle
    (v) => ({ on } = v));
  // Each item is li, label, input: the i-th checkbox is element 4 + 3i.
  names.forEach((n, i) => bind(4 + 3 * i, "checked", () => on[i]));
  const count = () => on.filter(Boolean).length;
  text(2 + 3 * names.length, () => count() + " of " + names.length + " on");`,
    metric: `{ m: count, p: (n) => n + " on in " + l }`,
    row: (w, s) => [arr(w.items, html), arr(s.on, bit)],
  },

  field: {
    args: "l, ph, re, msg, str",
    body: `
  re = RegExp(re);
  widget("field", l, \`<input type=text data-role=input placeholder="\${ph}"><p data-role=error>\${msg}</p>\`, [
    (t) => str = t.value, // input
  ], (v) => ({ text: str } = v));
  bind(1, "value", () => str);
  show(2, () => !re.test(str));`,
    row: (w, s) => [html(w.placeholder), lit(rulePattern(w.rule)), html(w.rule.message), lit(s.text)],
  },

  todo: {
    args: "l, ph, add, rm, items",
    body: `
  items = items.map(([text, done], i) => ({ id: i + 1, text, done }));
  let draft = "";
  widget("todo", l, \`<input type=text data-role=draft placeholder="\${ph}"><button data-role=add>\${add}</button><ul></ul><p data-role=left></p>\`, [
    (t) => draft = t.value, // draft
    () => { // add
      const text = draft.trim();
      if (text) {
        items.push({ id: Math.max(0, ...items.map((i) => i.id)) + 1, text, done: false });
        draft = "";
      }
    },
  ], (v) => ({ items, draft } = v));
  bind(1, "value", () => draft);
  list(3, () => items, \`<input type=checkbox data-role=toggle><span></span><button data-role=remove>\${rm}</button>\`, (r) => (
    bind(0, "checked", () => r.i.done),
    text(1, () => r.i.text),
    [
      (t) => r.i.done = t.checked, // toggle
      () => items = items.filter((i) => i != r.i), // remove
    ]
  ));
  const left = () => items.filter((i) => !i.done).length;
  text(4, () => left() + " left");`,
    metric: `{ m: left, p: (n) => n + " left in " + l }`,
    row: (w, s) => {
      sequential(s.items, (i) => i + 1);
      return [html(w.placeholder), html(w.addText), html(w.removeText), arr(s.items, (it) => `[${lit(it.text)},${bit(it.done)}]`)];
    },
  },

  tabs: {
    args: "l, titles, texts, active",
    body: `
  widget("tabs", l, \`<div role=tablist>\${titles.map((t, i) => \`<button role=tab data-role=tab data-key=\${i}>\${t}</button>\`).join("")}</div><p role=tabpanel data-role=tab-content></p>\`,
    titles.map((t, i) => () => active = i), // tab
    (v) => ({ active } = v));
  titles.forEach((t, i) => bind(2 + i, "ariaSelected", () => i == active));
  text(2 + titles.length, () => texts[active]);`,
    row: (w, s) => [arr(w.tabs.map((t) => t.title), html), arr(w.tabs.map((t) => t.content)), lit(s.active)],
  },

  panel: {
    args: "l, sh, hi, body, open",
    body: `
  widget("panel", l, \`<button data-role=toggle></button><p data-role=body>\${body}</p>\`, [
    () => open = !open, // toggle
  ], (v) => ({ open } = v));
  bind(1, "ariaExpanded", () => !!open);
  text(1, () => (open ? hi : sh));
  show(2, () => open);`,
    row: (w, s) => [lit(w.showText), lit(w.hideText), html(w.body), bit(s.open)],
  },

  choice: {
    args: "l, values, labels, xf, ph, option, extra",
    body: `
  widget("choice", l, \`<select data-role=select>\${values.map((v, i) => \`<option value="\${v}">\${labels[i]}</option>\`).join("")}</select><input type=text data-role=extra placeholder="\${ph}">\`, [
    (t) => option = t.value, // select
    (t) => extra = t.value, // extra
  ], (v) => ({ option, extra } = v));
  bind(1, "value", () => option);
  // The extra input comes after the select's options.
  const n = 2 + values.length;
  bind(n, "value", () => extra);
  show(n, () => xf.includes(values.indexOf(option)));`,
    row: (w, s) => [arr(w.options.map((o) => o.value), html), arr(w.options.map((o) => o.label), html),
      arr(w.extraFor.map((v) => w.options.findIndex((o) => o.value === v))), html(w.extraPlaceholder), lit(s.option), lit(s.extra)],
  },

  amount: {
    args: "l, d, pre, suf, value",
    body: `
  widget("amount", l, "<input type=number data-role=input><output data-role=formatted></output>", [
    (t) => { t.value && (value = +t.value); }, // input
  ], (v) => ({ value } = v));
  bind(1, "value", () => value);
  text(2, () => pre + value.toFixed(d) + suf);`,
    metric: `{ m: () => value, p: (n) => l + ": " + n }`,
    row: (w, s) => {
      const f = w.format;
      const [pre, suf] = f.type === "currency" ? [f.symbol, ""] : f.type === "percent" ? ["", "%"] : ["", " " + f.unit];
      return [lit(f.decimals), lit(pre), lit(suf), lit(s.value)];
    },
  },

  filter: {
    args: "l, ph, items, query",
    body: `
  items = items.map((text, i) => ({ id: i + 1, text }));
  widget("filter", l, \`<input type=text data-role=query placeholder="\${ph}"><ul></ul><p data-role=matches></p>\`, [
    (t) => query = t.value, // query
  ], (v) => ({ query } = v));
  bind(1, "value", () => query);
  const shown = () => items.filter((i) => i.text.toLowerCase().includes(query.toLowerCase()));
  // The items are constants: their text is written once.
  list(2, shown, "", (r) => { r.n.textContent = r.i.text; });
  text(3, () => shown().length + " matches");`,
    metric: `{ m: () => shown().length, p: (n) => n + " found in " + l }`,
    row: (w, s) => {
      sequential(w.items, (i) => i + 1);
      return [html(w.placeholder), arr(w.items.map((it) => it.text)), lit(s.query)];
    },
  },

  rating: {
    args: "l, labels, n",
    body: `
  const stars = labels.slice(1);
  widget("rating", l, \`<div>\${stars.map((_, i) => \`<button data-role=star data-key=\${i + 1}></button>\`).join("")}</div><p data-role=rating-label></p>\`,
    stars.map((_, i) => () => n = i + 1), // star
    (v) => ({ stars: n } = v));
  stars.forEach((_, i) => {
    bind(2 + i, "ariaPressed", () => i < n);
    text(2 + i, () => (i < n ? "★" : "☆"));
  });
  text(2 + stars.length, () => labels[n]);`,
    metric: `{ m: () => n, p: (k) => k + " stars for " + l }`,
    row: (w, s) => {
      if (w.labels.length !== w.stars + 1) throw new Error("digest expects one label per rating plus one");
      return [arr(w.labels), lit(s.stars)];
    },
  },

  feed: {
    args: "l, empty, dismiss, entries",
    body: `
  // \`notify\` pushes into the entries: they stay on a record, which the factory returns (E).
  const s = { entries: entries.map((text, i) => ({ id: i + 1, text })) };
  widget("feed", l, \`<ul></ul><p data-role=empty>\${empty}</p>\`, [], (v) => ({ entries: s.entries } = v));
  list(1, () => s.entries, \`<span></span><button data-role=dismiss>\${dismiss}</button>\`, (r) => (
    text(0, () => r.i.text),
    [() => s.entries = s.entries.filter((e) => e != r.i)] // dismiss
  ));
  show(2, () => !s.entries.length);`,
    metric: `Object.assign(s, { m: () => s.entries.length, p: (n) => n + " in " + l })`,
    ret: "s",
    row: (w, s) => {
      sequential(s.entries, (i) => i + 1);
      return [html(w.emptyText), html(w.dismissText), arr(s.entries.map((e) => e.text))];
    },
  },

  clock: {
    args: "l, a, b, c, seconds, running",
    body: `
  const w = widget("clock", l, \`<output data-role=time></output><button data-role=start>\${a}</button><button data-role=stop>\${b}</button><button data-role=reset>\${c}</button>\`, [
    () => running = true, // start
    () => running = false, // stop
    () => { seconds = 0; running = false; }, // reset
  ], (v) => ({ seconds, running } = v));
  text(1, () => Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0"));
  bind(2, "disabled", () => running);
  bind(3, "disabled", () => !running);
  T.push(() => running && (seconds++, run(w)));`,
    metric: `{ m: () => seconds, p: (n) => n + "s on " + l }`,
    row: (w, s) => [html(w.startText), html(w.stopText), html(w.resetText), lit(s.seconds), bit(s.running)],
  },

  summary: {
    args: "l, f, src, pre",
    body: `
  const w = widget("summary", l, "<p data-role=summary></p>");
  const num = (x) => Math.round(x * 100) / 100;
  text(1, () => {
    const v = src.map((e) => e.m());
    const total = num(v.reduce((a, b) => a + b));
    return f == 2 ? src.map((e, i) => e.p(num(v[i]))).join("; ") : pre + ": " + (f ? v.map(num).join(" + ") + " = " : "") + total;
  });
  // The sources, as distances back from this widget. A source's digest runs this line too.
  src = src.map((k) => (k = "w" + (id.slice(1) - k), W[k].push(...w), E[k]));`,
    // A list (f = 2) has no prefix.
    row: (w) => [lit({ sum: 0, breakdown: 1, list: 2 }[w.formula]),
      arr(w.sources.map((id) => Number(w.id.slice(1)) - Number(id.slice(1)))),
      ...(w.formula === "list" ? [] : [lit(w.prefix)])],
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
    const ret = (read.has(k) && K.metric) || K.ret;
    return `const ${k} = (${K.args}) => {${K.body}${ret ? `\n  return ${ret};` : ""}\n};`;
  });

  const rows = spec.widgets.map((w) => {
    const s = spec.initialState.widgets[w.id];
    return `  [${[w.kind, lit(w.label), ...KINDS[w.kind].row(w, s)].join(", ")}],`;
  });

  // External events: only the branches this app can receive.
  const has = (k) => kinds.includes(k);
  const branches = [
    // External data is copied before it is kept: handlers mutate state in place.
    `if (m.type == "serverSet") S[m.widget](structuredClone(m.state)), run(W[m.widget]);`,
    `else if (m.type == "snapshot") { const w = structuredClone(m.state.widgets); for (const k in w) S[k](w[k]), run(W[k]); }`,
  ];
  if (has("clock")) branches.push(`else if (m.type == "tick") for (const t of T) t();`);
  if (has("feed")) branches.push(`else if (m.type == "notify") E[m.widget].entries.push(m.entry), run(W[m.widget]);`);

  return `// Generated by scenarios/shared-components/digest.js. Do not edit.
import { app, widget, bind, text, show, list, run, id, S, E, W, T } from "./runtime.js";

${factories.join("\n\n")}

// External events: each changes the state (S) of the widgets it concerns and digests only those
// (\`up\`; a clock's tick function digests its own clock).
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
      approach: "compiled dirty checking, per widget: an event re-runs the bindings of the widget it touched (and of the summaries reading it), writing a DOM property only when its value changed",
      components: "one factory per widget kind present in the app; one data row per instance",
      state: "plain mutable variables of the kind's factory, one set per widget; external replacements go through a setter the factory hands the runtime; a feed's entries sit on a record notify pushes into",
      templates: "HTML strings with the instance's constants (escaped at build time), parsed once per widget or list item",
      lists: "keyed by id, reconciled in place by the runtime",
      conditionals: "a binding that swaps one node with an empty text node",
      events: "one delegated click and input listener; handlers given to the controls in document order (an expando the listener reads)",
      derived: "plain functions read by bindings; a summary's binding sits in each source's list; no memoization",
      build: "Vite production build, no plugin, hidden source maps",
    },
  };
}
