// unique-components as tea-local, a prototype strategy (frameworks/tea-local/README.md): what an
// ideal compiler would emit from a TEA source of the dashboard, with local message routing,
// when every widget is its own component type.
//
// Style (recorded in every generated app's rr.json):
// - One module per widget (`src/widgets/w3.js`): its own initial model, its own `update`
//   reducer (one `case` per message, written out from the message's kind and ops) and its own
//   factory `w3(parent, ...sources)`. Nothing is shared between widgets except generic helpers:
//   the runtime's DOM, instance and keyed-list helpers, and `widgets/frame.js` (the widget
//   frame, conditional placement, next item id).
// - The factory builds the widget's DOM once with createElement calls, wires each DOM event to
//   `self.send([tag, payload])` of its own instance, and declares one `patch` function: the
//   binding list, one write per binding (derived texts compiled to template literals and
//   operators), each skipped when its value did not change.
// - The model lives in the instance's closure; `send` runs the widget's reducer and schedules
//   that instance's patch in a microtask. No global dispatch, dirty bits or dependency graph.
// - A cross-widget read is a factory parameter (the earlier widget's instance): the reader
//   reads its model in `patch` and watches it, so its patch is scheduled when the source changes.
// - External events: `serverSet` and `snapshot` replace instance models (`set`); `notify` is a
//   method of widgets with a feed (a message to that instance). A widget with a time-driven int
//   is a subscription, as in Elm's `subscriptions`: while a gate is on it puts its `tick` into
//   the shared `running` set (the app's `tick` event calls only those), and its reducer has its
//   own Tick message. So `tick` costs the running widgets, not the number of widgets.
// - Keyed lists through the runtime's `list`. Conditional content (`when`, validation errors)
//   is built once, detached, and placed before its next attached sibling while shown.
// - Number inputs send only integers within [min, max], and are written through
//   `valueAsNumber`, so a typed "007" is not rewritten.

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
// The view: creation lines (run once), patch lines (the binding list), and event wiring.

function compileView(w, nodes, parent, cx) {
  const tops = nodes.map((n) => compileNode(w, n, parent, cx)); // per node: [{ v, cond? }]
  // Conditional tops are placed in patch, before the next attached sibling.
  tops.forEach((group, i) => {
    const later = tops.slice(i + 1).flat().map((t) => t.v);
    for (const t of group) {
      if (!t.cond) continue;
      if (later.length) cx.patch.push(`place(${parent}, ${t.v}, ${t.cond}, ${later.join(", ")});`);
      else cx.patch.push(`show(${parent}, ${t.v}, ${t.cond});`);
    }
  });
}

function compileNode(w, n, parent, cx) {
  const create = (line) => cx.create.push("  " + line);
  const msgOf = (name) => w.messages.find((m) => m.name === name);
  const fieldOf = (name) => w.fields.find((f) => f.name === name);
  const send = (name, payload) => `self.send([${w.messages.findIndex((m) => m.name === name)}${payload ? ", " + payload : ""}])`;
  switch (n.el) {
    case "text": {
      const { code, dynamic } = textCode(n.parts, cx);
      const v = cx.name("p");
      if (!dynamic) create(`const ${v} = element(${parent}, ${q(n.tag)}, null, ${code});`);
      else {
        const t = cx.name("t");
        create(`const ${v} = element(${parent}, ${q(n.tag)});`);
        create(`const ${t} = text(${v});`);
        cx.patch.push(`setText(${t}, ${code});`);
      }
      return [{ v }];
    }
    case "button": {
      const v = cx.name("b");
      const { code, dynamic } = textCode(n.text, cx);
      const attrs = `{ "data-role": ${q(n.msg)} }`;
      if (!dynamic) create(`const ${v} = element(${parent}, "button", ${attrs}, ${code});`);
      else {
        const t = cx.name("t");
        create(`const ${v} = element(${parent}, "button", ${attrs});`);
        create(`const ${t} = text(${v});`);
        cx.patch.push(`setText(${t}, ${code});`);
      }
      create(`on(${v}, "click", () => ${send(n.msg)});`);
      if (n.disabled) cx.patch.push(`setProp(${v}, "disabled", ${expr(n.disabled, cx, true)});`);
      return [{ v }];
    }
    case "input": {
      const f = fieldOf(msgOf(n.msg).field);
      const number = f.type === "int";
      const attrs = number ? `{ type: "number", "data-role": ${q(n.msg)} }`
        : `{ type: "text", "data-role": ${q(n.msg)}${n.placeholder ? `, placeholder: ${q(n.placeholder)}` : ""} }`;
      const out = [];
      let at = parent;
      if (n.label) {
        const l = cx.name("k");
        create(`const ${l} = element(${parent}, "label", null, ${q(n.label)});`);
        out.push({ v: l });
        at = l;
      }
      const v = cx.name("i");
      create(`const ${v} = element(${at}, "input", ${attrs});`);
      if (!n.label) out.push({ v });
      if (number) {
        create(`on(${v}, "input", () => {`);
        create(`  const n = ${v}.valueAsNumber;`);
        create(`  if (Number.isInteger(n) && n >= ${f.min} && n <= ${f.max}) ${send(n.msg, "n")};`);
        create(`});`);
        cx.patch.push(`setProp(${v}, "valueAsNumber", m.${f.name});`);
      } else {
        create(`on(${v}, "input", () => ${send(n.msg, `${v}.value`)});`);
        cx.patch.push(`setProp(${v}, "value", m.${f.name});`);
      }
      cx.own = true;
      if (n.invalid) {
        const e = cx.name("e");
        create(`const ${e} = element(null, "p", { "data-role": ${q(n.msg + "Error")} }, ${q(n.invalid.message)});`);
        out.push({ v: e, cond: expr(n.invalid.when, cx, true) });
      }
      return out;
    }
    case "check": {
      const l = cx.name("k"), v = cx.name("c");
      create(`const ${l} = element(${parent}, "label");`);
      create(`const ${v} = element(${l}, "input", { type: "checkbox", "data-role": ${q(n.msg)} });`);
      create(`${l}.append(${q(n.label)});`);
      create(`on(${v}, "change", () => ${send(n.msg)});`);
      cx.patch.push(`setProp(${v}, "checked", m.${msgOf(n.msg).field});`);
      cx.own = true;
      return [{ v: l }];
    }
    case "select": {
      const f = fieldOf(msgOf(n.msg).field);
      const out = [];
      let at = parent;
      if (n.label) {
        const l = cx.name("k");
        create(`const ${l} = element(${parent}, "label", null, ${q(n.label)});`);
        out.push({ v: l });
        at = l;
      }
      const v = cx.name("s");
      create(`const ${v} = element(${at}, "select", { "data-role": ${q(n.msg)} });`);
      if (!n.label) out.push({ v });
      create(`for (const o of ${f.name}Options) element(${v}, "option", { value: o }, o);`);
      create(`on(${v}, "change", () => ${send(n.msg, `${v}.value`)});`);
      cx.patch.push(`setProp(${v}, "value", m.${f.name});`);
      cx.own = true;
      cx.options.add(f.name);
      return out;
    }
    case "list": {
      const u = cx.name("u"), l = cx.name("l");
      create(`const ${u} = element(${parent}, ${q(n.tag)});`);
      create(`const ${l} = list(${u}, byId, (item) => {`);
      create(`  const li = element(null, "li", { "data-key": item.id, "data-role": ${q(n.field + "Item")} });`);
      if (n.check) create(`  const box = element(li, "input", { type: "checkbox", "data-role": ${q(n.check)} });`);
      create(`  const label = text(element(li, "span"));`);
      if (n.remove) create(`  const del = element(li, "button", { "data-role": ${q(n.remove)} }, ${q(n.removeText)});`);
      if (n.check) create(`  on(box, "change", () => ${send(n.check, "item.id")});`);
      if (n.remove) create(`  on(del, "click", () => ${send(n.remove, "item.id")});`);
      create(`  return {`);
      create(`    node: li,`);
      create(`    patch(next) {`);
      create(`      item = next;`);
      if (n.check) create(`      setProp(box, "checked", item.done);`);
      create(`      setText(label, item.text);`);
      create(`    },`);
      create(`  };`);
      create(`});`);
      cx.patch.push(`${l}(m.${n.field});`);
      cx.own = true;
      return [{ v: u }];
    }
    case "when": {
      const v = cx.name("q");
      create(`const ${v} = element(null, ${q(n.tag)});`);
      compileView(w, n.children, v, cx);
      return [{ v, cond: expr(n.cond, cx, true) }];
    }
    case "group": {
      const v = cx.name("g");
      create(`const ${v} = element(${parent}, ${q(n.tag)});`);
      compileView(w, n.children, v, cx);
      return [{ v }];
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
      cx.options.add(name);
      return `${name}Options[(${name}Options.indexOf(${cur}) + 1) % ${name}Options.length]`;
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

function reducerCase(w, m, i, cx) {
  const head = `    case ${i}:`;
  switch (m.kind) {
    case "input": case "select": return `${head} return { ...m, ${m.field}: msg[1] };`;
    case "check": return `${head} return { ...m, ${m.field}: !m.${m.field} };`;
    case "item":
      return m.op === "remove"
        ? `${head} return { ...m, ${m.field}: m.${m.field}.filter((it) => it.id !== msg[1]) };`
        : `${head} return { ...m, ${m.field}: m.${m.field}.map((it) => (it.id === msg[1] ? { ...it, done: !it.done } : it)) };`;
    case "click": {
      const targets = m.ops.map((op) => op[1]);
      if (!m.ops.some((op) => op[0] === "push") && new Set(targets).size === targets.length) {
        return `${head} return { ...m, ${m.ops.map((op) => `${op[1]}: ${opAssign(w, op, "m", cx)}`).join(", ")} };`;
      }
      if (m.ops.length === 1) {
        const { text, next } = pushStep(w, m.ops[0], "m");
        return `${head} {\n      const text = ${text};\n      return text ? ${next} : m;\n    }`;
      }
      const body = m.ops.map((op) => {
        if (op[0] !== "push") return `      n = { ...n, ${op[1]}: ${opAssign(w, op, "n", cx)} };`;
        const { text, next } = pushStep(w, op, "n");
        return `      {\n        const text = ${text};\n        if (text) n = ${next};\n      }`;
      });
      return `${head} {\n      let n = m;\n${body.join("\n")}\n      return n;\n    }`;
    }
  }
  throw new Error(`unknown message kind ${m.kind}`);
}

// ---------------------------------------------------------------------------------------------
// One widget module.

const RUNTIME = ["element", "text", "on", "setText", "setProp", "show", "instance", "list"];
const FRAME = ["widget", "place", "nextId", "byId", "running"];

// Returns { code, sources }: the module, and the earlier widgets its factory takes.
function widgetFile(spec, w) {
  const cx = {
    create: [], patch: [], own: false, sources: new Set(), options: new Set(), counts: {},
    name(prefix) { this.counts[prefix] = (this.counts[prefix] ?? 0) + 1; return prefix + this.counts[prefix]; },
  };
  compileView(w, w.view, "root", cx);

  const timed = w.fields.filter((f) => f.tick);
  const feed = w.fields.find((f) => f.feed);
  const cases = w.messages.map((m, i) => reducerCase(w, m, i, cx));
  let next = w.messages.length;
  let tickIndex, notifyIndex, gate;
  // Time-driven ints: a Tick message, and a subscription while a gate is on.
  if (timed.length) {
    tickIndex = next++;
    const step = (f, s) => `${s}.${f.tickWhen} && ${s}.${f.name} < ${f.max}`;
    const grown = (f, s) => `{ ...${s}, ${f.name}: Math.min(${f.max}, ${s}.${f.name} + ${f.tick}) }`;
    if (timed.length === 1) cases.push(`    case ${tickIndex}: return ${step(timed[0], "m")} ? ${grown(timed[0], "m")} : m;`);
    else {
      const body = timed.map((f) => `      if (${step(f, "n")}) n = ${grown(f, "n")};`);
      cases.push(`    case ${tickIndex}: {\n      let n = m;\n${body.join("\n")}\n      return n;\n    }`);
    }
    gate = timed.map((f) => "m." + f.tickWhen).join(" || ");
  }
  if (feed) {
    notifyIndex = next++;
    cases.push(`    case ${notifyIndex}: return { ...m, ${feed.name}: [...m.${feed.name}, msg[1]] };`);
  }

  const sources = [...cx.sources];
  const msgNames = w.messages.map((m) => cap(m.name) + (m.kind === "input" || m.kind === "select" ? " String" : m.kind === "item" ? " Int" : ""));
  if (timed.length) msgNames.push("Tick");
  if (feed) msgNames.push("Notify Item");

  const optionLines = [...cx.options].map((name) => `const ${name}Options = ${lit(w.fields.find((f) => f.name === name).options)};`);

  const fn = [];
  fn.push(`export function ${w.id}(parent${sources.map((s) => ", " + s).join("")}) {`);
  fn.push(`  const self = instance(null, initial, update, patch);`);
  fn.push(`  const root = widget(parent, ${q(w.id)}, ${q(w.label)});`);
  fn.push(...cx.create);
  if (timed.length) {
    // Subscribe to the clock while the gate is on, as soon as the model changes (not at the next
    // render), so a tick right after the gate opens is not missed.
    fn.push(`  const tick = () => self.send([${tickIndex}]);`);
    fn.push(`  const { send, set } = self;`);
    fn.push(`  const subscribe = () => { const m = self.model(); ${gate} ? running.add(tick) : running.delete(tick); };`);
    fn.push(`  self.send = (msg) => { send(msg); subscribe(); };`);
    fn.push(`  self.set = (next) => { set(next); subscribe(); };`);
  }
  fn.push(``);
  fn.push(`  function patch() {`);
  if (cx.own) fn.push(`    const m = self.model();`);
  for (const s of sources) fn.push(`    const m${s.slice(1)} = ${s}.model();`);
  fn.push(...cx.patch.map((l) => "    " + l));
  fn.push(`  }`);
  for (const s of sources) fn.push(`  ${s}.watch(patch);`);
  fn.push(`  patch();`);
  fn.push(feed ? `  return Object.assign(self, { notify: (item) => self.send([${notifyIndex}, item]) });` : `  return self;`);
  fn.push(`}`);

  // A variable nothing refers to needs no name.
  let body = fn.join("\n");
  body = body.replace(/^(\s*)const (\w+) = (element\(.*)$/gm, (all, sp, name, rest) =>
    new RegExp(`\\b${name}\\b`).test(body.replace(all, "")) ? all : `${sp}${rest}`);

  const code = [...optionLines, `update`, ...cases, body].join("\n");
  const used = (names) => names.filter((h) => new RegExp(`\\b${h}\\b`).test(code));
  const out = [
    `import { ${used(RUNTIME).join(", ")} } from "../runtime.js";`,
    `import { ${used(FRAME).join(", ")} } from "./frame.js";`,
    ``,
    `// ${w.label} (${w.kind})`,
    `const initial = ${lit(spec.initialState.widgets[w.id])};`,
    ...optionLines,
    ``,
    `// type Msg = ${msgNames.join(" | ")}`,
    `function update(m, msg) {`,
    `  switch (msg[0]) {`,
    ...cases,
    `  }`,
    `}`,
    ``,
    body,
    ``,
  ];
  return { code: out.join("\n"), sources };
}

// ---------------------------------------------------------------------------------------------

const FRAME_FILE = `import { element } from "../runtime.js";

// The frame every widget shares: its keyed section and its heading.
export function widget(parent, id, label) {
  const section = element(parent, "section", { "data-key": id, "data-role": "widget" });
  element(section, "h2", null, label);
  return section;
}

// Attach \`node\` to \`parent\` before the first of \`after\` that is attached there (appended if
// none), or detach it: conditional content keeps its place among its siblings.
export function place(parent, node, shown, ...after) {
  if (!shown) node.remove();
  else if (!node.parentNode) parent.insertBefore(node, after.find((n) => n.parentNode === parent) ?? null);
}

export const nextId = (items) => items.reduce((max, item) => Math.max(max, item.id), 0) + 1;

export const byId = (item) => item.id;

// The tick handlers of the widgets whose time-driven gate is on (their subscription).
export const running = new Set();
`;

export function emit(spec) {
  const files = {
    ...templateFiles({ name: "unique-components", title: "Unique components" }),
    "src/widgets/frame.js": FRAME_FILE,
  };
  const calls = [];
  for (const w of spec.widgets) {
    const { code, sources } = widgetFile(spec, w);
    files[`src/widgets/${w.id}.js`] = code;
    calls.push(`  widgets.${w.id} = ${w.id}(${["main", ...sources.map((s) => "widgets." + s)].join(", ")});`);
  }
  files["src/app.js"] = `import { element } from "./runtime.js";
import { running } from "./widgets/frame.js";
${spec.widgets.map((w) => `import { ${w.id} } from "./widgets/${w.id}.js";`).join("\n")}

export function App(root) {
  const main = element(root, "div", { "data-role": "dashboard" });
  const widgets = {};
${calls.join("\n")}

  return {
    // External events, routed to the instances they concern.
    receive(msg) {
      switch (msg.type) {
        case "serverSet":
          widgets[msg.widget].set(msg.state);
          break;
        case "tick":
          for (const tick of running) tick();
          break;
        case "notify":
          widgets[msg.widget].notify(msg.item);
          break;
        case "snapshot":
          for (const id in msg.state.widgets) widgets[id].set(msg.state.widgets[id]);
          break;
      }
    },
    dispose() {
      running.clear();
      main.remove();
    },
  };
}
`;
  return {
    files,
    style: {
      components: "one module per widget: its initial model, its own reducer (one case per message, written out from its ops) and its own factory; only generic helpers are shared",
      state: "each instance's model in its own closure; send(msg) runs the widget's reducer and schedules that instance's binding list",
      updates: "one patch function per instance, every DOM write skipped when unchanged; derived texts compiled to template literals; batched in a microtask",
      crossWidget: "a reader's factory takes the earlier widgets it reads, reads their models in patch and watches them",
      externalEvents: "serverSet/snapshot replace instance models; notify is a message to a feed widget; tick calls the widgets of a shared running set, each subscribing while its gate is on",
      lists: "runtime keyed list: patch changed rows, Solid 2 reconcileArrays when order or membership changes",
      conditionals: "node built once, detached, placed before its next attached sibling while shown",
      events: "addEventListener per element: click, input, change for checkboxes and selects; number inputs send integers within range only",
      build: "Vite production build, no framework plugin, hidden source maps",
    },
  };
}
