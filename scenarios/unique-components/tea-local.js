// unique-components as tea-local, a prototype strategy (frameworks/tea-local/README.md): what an
// ideal compiler would emit from a TEA source of the dashboard, with local message routing,
// when every widget is its own component type.
//
// Style (recorded in every generated app's rr.json):
// - Each widget is its own block of the app's `dashboard(main)` function, in page order: its own
//   initial model, its own reducer (a table of arms, one per message, written out from the
//   message's kind and ops), its own template and binding list. It is what the widget's factory
//   would be, inlined, since a unique widget's factory is called once (a compiler inlines a
//   function it calls once): no name and no call per widget, and every block reuses the same
//   local names. Nothing is shared between widgets except generic helpers: the runtime's DOM,
//   instance and keyed-list helpers, and `widgets/frame.js` (the widget frame and registry,
//   readers, list rows, conditional placement, next item id, subscriptions, property writes).
// - The block declares one `patch` arrow first (the binding list, one write per binding,
//   derived texts compiled to template literals and operators, each skipped when its value did
//   not change; it runs after mount), then its instance, then builds the widget's DOM once from
//   its own static template (the markup as one string, its elements addressed by document order;
//   a list row has a template of its own), its controls wired to messages for its own instance.
// - The model lives in the instance's closure; `send` runs the widget's reducer and schedules
//   that instance's patch in a microtask. No global dispatch, dirty bits or dependency graph.
// - The widget frame registers each instance in page order (`widgets`, w1 first), numbering
//   widgets w1, w2, …, for the external events that name a widget and for readers: a
//   cross-widget read reads the earlier widget's model from it in `patch` (`widgets[2].m` for
//   w3); its instance is made by the frame's `reader([2], …)`, which has its patch watch the
//   sources, so its patch is scheduled when one changes.
// - External events: `serverSet` and `snapshot` replace instance models (`set`); `notify` sends
//   a feed's Notify message (the instance keeps its tag) to that instance. A widget with a time-driven int
//   is a subscription, as in Elm's `subscriptions`: while a gate is on it puts its `tick` into
//   the shared `running` set (the app's `tick` event calls only those), and its reducer has its
//   own Tick message. So `tick` costs the running widgets, not the number of widgets.
// - Keyed lists through the runtime's `list`. Conditional content (`when`, validation errors)
//   is in the template; while hidden, an empty text node holds its place, which it takes back
//   when shown.
// - A message is sent as its constructor's tag and its argument, if any: `send(tag, value)`, and
//   the reducer is a jump table: `update[tag](model, value)` runs that constructor's arm.
// - Events, as Elm's `onClick msg` and `onInput Tag`: messages are numbered so that the
//   template's controls take tags 0, 1, 2, … in document order, then each list row's controls;
//   the runtime's `wire` attaches them by position: a button or checkbox sends its message when
//   clicked, a text input, select or number input sends its tag with its value on input. A list
//   row wires its own controls the same way, from its first tag, with the item's id as the
//   argument.
// - A number input sends its value as a number; its reducer case takes only an integer within
//   [min, max] (anything else leaves the model unchanged, so nothing is patched), and it is
//   written through `valueAsNumber`, so a typed "007" is not rewritten.

import { templateFiles } from "../../frameworks/tea-local/framework.js";

export const framework = "tea-local";

export const params = {};

const q = JSON.stringify;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const IDENT = /^[A-Za-z_$][\w$]*$/;
const key = (k) => (IDENT.test(k) ? k : q(k));

// A JavaScript literal for plain data.
function lit(v) {
  if (v === null || typeof v !== "object") return q(v);
  if (Array.isArray(v)) return `[${v.map(lit).join(", ")}]`;
  return `{ ${Object.entries(v).map(([k, x]) => `${key(k)}: ${lit(x)}`).join(", ")} }`;
}

// ---------------------------------------------------------------------------------------------
// Expressions → JavaScript. Composite ones are parenthesised unless at the top.

const BINARY = { "==": "===", "!=": "!==", "<": "<", "<=": "<=", ">": ">", ">=": ">=", and: "&&", or: "||", "+": "+", "-": "-" };

function expr(e, cx, top = false) {
  const p = (s) => (top ? s : `(${s})`);
  switch (e[0]) {
    case "f": cx.own = true; return `m.${e[1]}`;
    case "w": cx.sources.add(e[1]); return `m${e[1].slice(1)}.${e[2]}`;
    case "k": return q(e[1]);
    case "count": case "len": return `${expr(e[1], cx)}.length`;
    case "done": return `${expr(e[1], cx)}.filter((it) => it.done).length`;
    case "left": return `${expr(e[1], cx)}.filter((it) => !it.done).length`;
    case "has": return `${expr(e[1], cx)}.includes(${q(e[2])})`;
    case "not": return `!${expr(e[1], cx)}`;
    case "if": return p(`${expr(e[1], cx)} ? ${expr(e[2], cx)} : ${expr(e[3], cx)}`);
    default:
      if (BINARY[e[0]]) return p(`${expr(e[1], cx)} ${BINARY[e[0]]} ${expr(e[2], cx)}`);
  }
  throw new Error(`unknown expression ${q(e)}`);
}

const tpl = (s) => s.replace(/[`\\]|\$\{/g, (c) => "\\" + c);

// The value of a text: a string literal if static, a lone expression, or a template literal.
function textCode(parts, cx) {
  if (parts.every((x) => typeof x === "string")) return { code: q(parts.join("")), dynamic: false };
  if (parts.length === 1) return { code: expr(parts[0], cx, true), dynamic: true };
  const body = parts.map((x) => (typeof x === "string" ? tpl(x) : `\${${expr(x, cx, true)}}`)).join("");
  return { code: `\`${body}\``, dynamic: true };
}

// ---------------------------------------------------------------------------------------------
// The view: one static template (the widget's markup, built once per instance), the event
// wiring of its elements, and the patch lines (the binding list).
//
// The template's elements are addressed by their index in document order (`e[3]`): the
// block gets them from `widget()` as `[section, ...section.querySelectorAll("*")]`, so
// `e[0]` is the section and `e[1]` its heading. A dynamic text is the only child of its
// element; the template gives it a placeholder space, the text node `setText` writes.

const esc = (s) => String(s).replace(/[&<]/g, (c) => (c === "&" ? "&amp;" : "&lt;"));
const attr = (v) => (/^[^\s"'=<>`]+$/.test(v) ? v : `"${String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`);
const attrs = (a) => Object.entries(a).map(([k, v]) => ` ${k}=${attr(v)}`).join("");
// The parser closes every open element at the end of a template, so its trailing end tags
// are left out (as Solid's compiler does).
const trim = (html) => html.replace(/(<\/\w+>)+$/, "");

function compileView(w, nodes, cx) {
  const tops = nodes.map((n) => compileNode(w, n, cx)); // per node: [{ v, cond? }]
  // Conditional tops are shown or hidden in patch, keeping their place.
  for (const t of tops.flat()) if (t.cond) cx.patch.push(`place(${t.v}, ${t.cond});`);
}

function compileNode(w, n, cx) {
  const create = (line) => cx.create.push("  " + line);
  const msgOf = (name) => w.messages.find((m) => m.name === name);
  const fieldOf = (name) => w.fields.find((f) => f.name === name);
  const tag = (name) => w.messages.findIndex((m) => m.name === name); // ordered by messageOrder
  // Open an element in the template; returns its reference.
  const open = (tag, a = {}) => {
    cx.html += `<${tag}${attrs(a)}>`;
    return `e[${cx.index++}]`;
  };
  const close = (tag) => (cx.html += `</${tag}>`);
  // A text that is static (in the template) or dynamic (a placeholder written by patch).
  const content = (v, parts) => {
    const { code, dynamic } = textCode(parts, cx);
    if (!dynamic) cx.html += esc(JSON.parse(code));
    else {
      cx.html += " ";
      cx.patch.push(`setText(${v}, ${code});`);
    }
  };
  const labelled = (label, inner) => {
    if (!label) return [{ v: inner() }];
    const l = open("label");
    cx.html += esc(label);
    inner();
    close("label");
    return [{ v: l }];
  };
  switch (n.el) {
    case "text": {
      const v = open(n.tag);
      content(v, n.parts);
      close(n.tag);
      return [{ v }];
    }
    case "button": {
      const v = open("button", { "data-role": n.msg });
      content(v, n.text);
      close("button");
      cx.wire.push(tag(n.msg));
      if (n.disabled) cx.patch.push(`setProp(${v}, ${expr(n.disabled, cx, true)}, "disabled");`);
      return [{ v }];
    }
    case "input": {
      const f = fieldOf(msgOf(n.msg).field);
      const number = f.type === "int";
      cx.own = true;
      const out = labelled(n.label, () => {
        const v = open("input", number ? { type: "number", "data-role": n.msg }
          : { type: "text", "data-role": n.msg, ...(n.placeholder ? { placeholder: n.placeholder } : {}) });
        if (number) {
          cx.wire.push(tag(n.msg));
          cx.patch.push(`setProp(${v}, m.${f.name}, "valueAsNumber");`);
        } else {
          cx.wire.push(tag(n.msg));
          cx.patch.push(`setProp(${v}, m.${f.name});`);
        }
        return v;
      });
      if (n.invalid) {
        const e = open("p", { "data-role": n.msg + "Error" });
        cx.html += esc(n.invalid.message);
        close("p");
        out.push({ v: e, cond: expr(n.invalid.when, cx, true) });
      }
      return out;
    }
    case "check": {
      const l = open("label");
      const v = open("input", { type: "checkbox", "data-role": n.msg });
      cx.html += esc(n.label);
      close("label");
      cx.wire.push(tag(n.msg));
      cx.patch.push(`setProp(${v}, m.${msgOf(n.msg).field}, "checked");`);
      cx.own = true;
      return [{ v: l }];
    }
    case "select": {
      const f = fieldOf(msgOf(n.msg).field);
      cx.own = true;
      return labelled(n.label, () => {
        const v = open("select", { "data-role": n.msg });
        for (const o of f.options) {
          open("option", { value: o });
          cx.html += esc(o);
          close("option");
        }
        close("select");
        cx.wire.push(tag(n.msg));
        cx.patch.push(`setProp(${v}, m.${f.name});`);
        return v;
      });
    }
    case "list": {
      const u = open(n.tag);
      close(n.tag);
      const l = cx.name("l");
      // The row's own template (parsed once, cloned for each new item, its controls wired from
      // its first message tag), then its binding list over the row's elements.
      const row = `<li${attrs({ "data-role": n.field + "Item" })}>`
        + (n.check ? `<input${attrs({ type: "checkbox", "data-role": n.check })}>` : "")
        + "<span> </span>"
        + (n.remove ? `<button${attrs({ "data-role": n.remove })}>${esc(n.removeText)}</button>` : "")
        + "</li>";
      const tags = [n.check, n.remove].filter(Boolean).map(tag);
      tags.forEach((t, i) => { if (t !== tags[0] + i) throw new Error(`${w.id}: row tags not consecutive`); });
      create(`const ${l} = list(${u}, row(${q(trim(row))}, self, ${tags[0] ?? 0}), (r, item) => {`);
      if (n.check) create(`  setProp(r[1], item.done, "checked");`);
      create(`  setText(r[${n.check ? 2 : 1}], item.text);`);
      create(`});`);
      cx.patch.push(`${l}(m.${n.field});`);
      cx.own = true;
      return [{ v: u }];
    }
    case "when": case "group": {
      const v = open(n.tag);
      compileView(w, n.children, cx);
      close(n.tag);
      return n.el === "when" ? [{ v, cond: expr(n.cond, cx, true) }] : [{ v }];
    }
  }
  throw new Error(`unknown view node ${n.el}`);
}

// ---------------------------------------------------------------------------------------------
// The reducer: one case per message, written out from its kind and ops.

function opAssign(w, op, s, cx) {
  const [kind, name] = op;
  const f = w.fields.find((x) => x.name === name);
  const cur = `${s}.${name}`;
  const item = (text) => `{ id: nextId(${cur}), text: ${text}${f.checkable ? ", done: false" : ""} }`;
  switch (kind) {
    case "add": {
      const sum = op[2] < 0 ? `${cur} - ${-op[2]}` : `${cur} + ${op[2]}`;
      return `Math.max(${f.min}, Math.min(${f.max}, ${sum}))`;
    }
    case "set": return q(op[2]);
    case "toggle": return `!${cur}`;
    case "reset": return q(f.initial);
    case "cycle":
      // The next option, as a chain of comparisons (the last option, or any other value, wraps
      // to the first).
      return `(${f.options.slice(0, -1).map((o, i) => `${cur} === ${q(o)} ? ${q(f.options[i + 1])} : `).join("")}${q(f.options[0])})`;
    case "pushText": return `[...${cur}, ${item(q(op[2]))}]`;
    case "pop": return `${cur}.slice(0, -1)`;
    case "shift": return `${cur}.slice(1)`;
    case "clear": return "[]";
    case "clearDone": return `${cur}.filter((it) => !it.done)`;
  }
  throw new Error(`unknown op ${kind}`);
}

function pushStep(w, op, s) {
  const f = w.fields.find((x) => x.name === op[1]);
  const item = `{ id: nextId(${s}.${op[1]}), text${f.checkable ? ", done: false" : ""} }`;
  return { text: `${s}.${op[2]}.trim()`, next: `{ ...${s}, ${op[1]}: [...${s}.${op[1]}, ${item}], ${op[2]}: "" }` };
}

// The reducer's branch for one message: a function of the model and the message's argument
// (every branch has the same signature).
function handler(code) {
  return code.startsWith("{") && code.includes("\n") ? `(m, value) => ${code}` : `(m, value) => (${code})`;
}

function reducerCase(w, m, cx) {
  return handler(branch(w, m, cx));
}

function branch(w, m, cx) {
  switch (m.kind) {
    case "input": case "select": {
      // A number input sends its value as a number; only an integer in range is taken.
      const f = w.fields.find((x) => x.name === m.field);
      if (f.type === "int") return `Number.isInteger(value) && value >= ${f.min} && value <= ${f.max} ? { ...m, ${m.field}: value } : m`;
      return `{ ...m, ${m.field}: value }`;
    }
    case "check": return `{ ...m, ${m.field}: !m.${m.field} }`;
    case "item":
      return m.op === "remove"
        ? `{ ...m, ${m.field}: m.${m.field}.filter((it) => it.id !== value) }`
        : `{ ...m, ${m.field}: m.${m.field}.map((it) => (it.id === value ? { ...it, done: !it.done } : it)) }`;
    case "click": {
      const targets = m.ops.map((op) => op[1]);
      if (!m.ops.some((op) => op[0] === "push") && new Set(targets).size === targets.length) {
        return `{ ...m, ${m.ops.map((op) => `${op[1]}: ${opAssign(w, op, "m", cx)}`).join(", ")} }`;
      }
      if (m.ops.length === 1) {
        const { text, next } = pushStep(w, m.ops[0], "m");
        return `{\n  const text = ${text};\n  return text ? ${next} : m;\n}`;
      }
      const body = m.ops.map((op) => {
        if (op[0] !== "push") return `  n = { ...n, ${op[1]}: ${opAssign(w, op, "n", cx)} };`;
        const { text, next } = pushStep(w, op, "n");
        return `  {\n    const text = ${text};\n    if (text) n = ${next};\n  }`;
      });
      return `{\n  let n = m;\n${body.join("\n")}\n  return n;\n}`;
    }
  }
  throw new Error(`unknown message kind ${m.kind}`);
}

// ---------------------------------------------------------------------------------------------
// One widget: a block of the app's dashboard function.

const RUNTIME = ["setText", "instance", "list"];
const FRAME = ["setProp", "reader", "widget", "widgets", "running", "row", "place", "nextId", "subscribe"];

// Message tags are the compiler's to choose: the controls of the widget's template take 0, 1,
// 2, ... in document order, then each list row's controls, in order, then the other messages.
// So `wire` needs no tag list: a control's tag is its position.
function messageOrder(w) {
  const section = [];
  const rows = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.el === "list") rows.push(...[n.check, n.remove].filter(Boolean));
      else if (n.el === "when" || n.el === "group") walk(n.children);
      else if (n.msg) section.push(n.msg);
    }
  };
  walk(w.view);
  const order = [...section, ...rows];
  if (new Set(order).size !== order.length) throw new Error(`${w.id}: a message sent by two controls`);
  return [...order, ...w.messages.map((m) => m.name).filter((name) => !order.includes(name))];
}

// The widget's own code as a block of the dashboard function: what its factory would be,
// inlined, since a unique widget's factory is called once. Its names are the block's own; its
// patch and reducer arms close over them.
function widgetBlock(spec, w) {
  const order = messageOrder(w);
  w = { ...w, messages: order.map((name) => w.messages.find((m) => m.name === name)) };
  const cx = {
    create: [], patch: [], wire: [], html: "", index: 2, own: false, sources: new Set(), counts: {},
    name(prefix) { this.counts[prefix] = (this.counts[prefix] ?? 0) + 1; return prefix + this.counts[prefix]; },
  };
  compileView(w, w.view, cx);

  const timed = w.fields.filter((f) => f.tick);
  const feed = w.fields.find((f) => f.feed);
  const cases = w.messages.map((m) => reducerCase(w, m, cx));
  let next = w.messages.length;
  let tickIndex, notifyIndex, gate;
  // Time-driven ints: a Tick message, and a subscription while a gate is on.
  if (timed.length) {
    tickIndex = next++;
    const step = (f, s) => `${s}.${f.tickWhen} && ${s}.${f.name} < ${f.max}`;
    const grown = (f, s) => `{ ...${s}, ${f.name}: Math.min(${f.max}, ${s}.${f.name} + ${f.tick}) }`;
    if (timed.length === 1) cases.push(handler(`${step(timed[0], "m")} ? ${grown(timed[0], "m")} : m`));
    else {
      const body = timed.map((f) => `  if (${step(f, "n")}) n = ${grown(f, "n")};`);
      cases.push(handler(`{\n  let n = m;\n${body.join("\n")}\n  return n;\n}`));
    }
    gate = timed.map((f) => "m." + f.tickWhen).join(" || ");
  }
  if (feed) {
    notifyIndex = next++;
    cases.push(handler(`{ ...m, ${feed.name}: [...m.${feed.name}, value] }`));
  }

  const sources = [...cx.sources];
  const isInt = (m) => w.fields.find((f) => f.name === m.field)?.type === "int";
  const msgNames = w.messages.map((m) => cap(m.name) + (m.kind === "input" || m.kind === "select" ? (isInt(m) ? " Float" : " String") : m.kind === "item" ? " Int" : ""));
  if (timed.length) msgNames.push("Tick");
  if (feed) msgNames.push("Notify Item");


  const fn = [];
  fn.push(`{`, `  // ${w.id}: ${w.label} (${w.kind})`);
  // The binding list (it runs after mount, once `self` and `e` are set).
  const patchFn = [];
  patchFn.push(`  const patch = () => {`);
  if (cx.own) patchFn.push(`    const m = self.m;`);
  for (const s of sources) patchFn.push(`    const m${s.slice(1)} = widgets[${s.slice(1) - 1}].m;`);
  patchFn.push(...cx.patch.map((l) => "    " + l));
  patchFn.push(`  };`);
  fn.push(...patchFn);
  // The model, and the reducer: one function per message, indexed by its tag.
  fn.push(`  // type Msg = ${msgNames.join(" | ")}`);
  // A reader's instance watches the earlier widgets it reads (by index in the registry).
  const make = sources.length ? `reader([${sources.map((s) => s.slice(1) - 1).join(", ")}], ` : "instance(";
  fn.push(`  const self = ${make}${lit(spec.initialState.widgets[w.id])}, [`, ...cases.map((c) => `    ${c.replace(/\n/g, "\n    ")},`), `  ], patch);`);
  cx.wire.forEach((t, i) => { if (t !== i) throw new Error(`${w.id}: control tags out of order`); });
  fn.push(`  const e = widget(main, ${q(trim("<h2>" + esc(w.label) + "</h2>" + cx.html))}, self);`);
  fn.push(...cx.create);
  // Subscribe to the clock while the gate is on, as soon as the model changes (not at the next
  // render), so a tick right after the gate opens is not missed.
  if (timed.length) fn.push(`  subscribe(self, ${tickIndex}, (m) => ${gate});`);
  if (feed) fn.push(`  self.notify = ${notifyIndex}; // the tag of Notify, sent by the app`);
  fn.push(`}`);
  return fn.map((l) => "  " + l).join("\n");
}

// ---------------------------------------------------------------------------------------------

const FRAME_FILE = `import { wire, instance } from "../runtime.js";

// A property write, skipped if unchanged: a form control's value, unless \`key\` names another.
export function setProp(node, value, key = "value") {
  if (node[key] !== value) node[key] = value;
}

// The frame every widget shares: its keyed section, holding the widget's own template (its
// heading and view), its controls wired to the messages 0, 1, 2, ... (see \`wire\`). Returns the
// section and the template's elements, in document order.
export function widget(parent, html, self) {
  // Widgets are numbered in page order (w1, w2, …): w1 is widgets[0].
  parent.insertAdjacentHTML("beforeend", \`<section data-key=w\${widgets.push(self)} data-role=widget>\${html}\`);
  return wire(parent.lastChild, self, 0);
}

// The instance of a widget that reads earlier ones (\`sources\`, their indexes in the registry):
// its patch watches them, so a change to one schedules it.
export function reader(sources, model, update, patch) {
  for (const i of sources) widgets[i].watch(patch);
  return instance(model, update, patch);
}

// Conditional content, built in the template: while hidden, an empty text node holds its place
// (and takes it back when shown), so its siblings are never touched.
export function place(node, shown) {
  if (!shown) node.replaceWith((node.mark ??= new Text()));
  else node.mark?.replaceWith(node);
}

// The instances in page order (w1 first), for the external events that name a widget and for
// readers.
export const widgets = [];

// A list row from its template (parsed once): each new row is a clone, its controls wired to
// the messages \`first\`, … with the item's id (see \`wire\`). Returns its elements, in document
// order (the row first).
export function row(html, self, first) {
  const t = document.createElement("template");
  t.innerHTML = html;
  return (item) => wire(t.content.firstChild.cloneNode(true), self, first, item.id);
}

export const nextId = (items) => items.reduce((max, item) => Math.max(max, item.id), 0) + 1;

// The tick handlers of the widgets whose time-driven gate is on (their subscription).
export const running = new Set();

// A time-driven widget's subscription, as in Elm's \`subscriptions\`: after every change to its
// model, its \`tick\` is in \`running\` exactly while \`gate(model)\` holds.
export function subscribe(self, tag, gate) {
  const { send, set } = self;
  const tick = () => self.send(tag);
  self.send = (tag, value) => {
    send(tag, value);
    gate(self.m) ? running.add(tick) : running.delete(tick);
  };
  self.set = (next) => {
    set(next);
    gate(self.m) ? running.add(tick) : running.delete(tick);
  };
}
`;

export function emit(spec) {
  // The frame numbers the widgets in page order: the ids must be w1, w2, ….
  if (spec.widgets.some((w, i) => w.id !== `w${i + 1}`)) throw new Error("widget ids are not w1, w2, … in order");
  const files = {
    ...templateFiles({ name: "unique-components", title: "Unique components" }),
    "src/widgets/frame.js": FRAME_FILE,
  };
  const blocks = spec.widgets.map((w) => widgetBlock(spec, w));
  // Only an app with a time-driven widget has ticks to route, and only one with a feed, notify.
  const timed = spec.widgets.some((w) => w.fields.some((f) => f.tick));
  const feeds = spec.widgets.some((w) => w.fields.some((f) => f.feed));
  const code = blocks.join("\n");
  const used = (names) => names.filter((h) => h === "widgets" || (h === "running" && timed) || new RegExp(`\\b${h}\\(`).test(code));
  files["src/app.js"] = `import { ${used(RUNTIME).join(", ")} } from "./runtime.js";
import { ${used(FRAME).join(", ")} } from "./widgets/frame.js";

export function App(root) {
  root.insertAdjacentHTML("beforeend", "<div data-role=dashboard>");
  return dashboard(root.lastChild);
}

// The widgets, each in its own block, in page order, then the routing of external events.
function dashboard(main) {
${blocks.join("\n")}

  return {
    // External events, routed to the instances they concern.
    receive(msg) {
      switch (msg.type) {
        case "serverSet":
          widgets[msg.widget.slice(1) - 1].set(msg.state);
          break;
${timed ? `        case "tick":
          for (const tick of running) tick();
          break;
` : ""}${feeds ? `        case "notify": {
          const feed = widgets[msg.widget.slice(1) - 1];
          feed.send(feed.notify, msg.item);
          break;
        }
` : ""}        case "snapshot":
          for (const id in msg.state.widgets) widgets[id.slice(1) - 1].set(msg.state.widgets[id]);
          break;
      }
    },
    dispose() {
${timed ? "      running.clear();\n" : ""}      widgets.length = 0;
      main.remove();
    },
  };
}
`;
  return {
    files,
    style: {
      components: "one block per widget in the app's dashboard function (its factory inlined, as it is called once): its initial model, its own reducer (a table of arms by message tag, written out from its ops), template and bindings; only generic helpers are shared",
      state: "each instance's model in its own closure; send(tag, value) runs the widget's reducer arm for that tag and schedules that instance's binding list",
      updates: "one patch function per instance, every DOM write skipped when unchanged; derived texts compiled to template literals; batched in a microtask",
      crossWidget: "a reader reads the earlier widgets' models from the frame's registry (instances in page order, w1 first) in patch; its instance, made by the frame's reader, has its patch watch them",
      externalEvents: "serverSet/snapshot replace instance models; notify sends a feed widget its Notify message; tick calls the widgets of a shared running set, each subscribing while its gate is on",
      lists: "runtime keyed list by item.id: patch changed rows, one forward placement pass when order or membership changes",
      dom: "one static template per widget (trailing end tags left out), inserted with its section by insertAdjacentHTML, elements addressed by document order; one template per list row, cloned per new item, its elements an array",
      conditionals: "node in the template; while hidden, an empty text node holds its place",
      events: "messages numbered so the template's controls take tags 0, 1, 2, … in document order (then each row's controls), attached by position by the runtime's wire: a button or checkbox sends its message on click (a list row's with the item id), a text input, select or number input its tag with its value on input; messages are sent as send(tag, value); number inputs send valueAsNumber and the reducer takes integers within range only",
      build: "Vite production build, no framework plugin, hidden source maps",
    },
  };
}
