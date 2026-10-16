// unique-components as tea-dirtybits, a prototype strategy (see frameworks/tea-dirtybits/README.md).
//
// This emitter plays the compiler: it writes what an ideal TEA compiler would emit for an app
// where every widget is its own component. Style (recorded in every generated app's rr.json):
// - One module per widget (src/widgets/<id>.js), written from that widget's description alone:
//   its own bits (one per field, plus one per field of another widget it reads), its reducer
//   `update(s, msg)` with one arm per message (the ops written out as code, each arm marking the
//   bits of the fields it writes), its initial state, and its DOM factory `view(...)`, which
//   builds the DOM once with explicit element calls and returns a static `patch(s, d, w)` that
//   runs only the bindings whose bits are set. No tables of ops or view trees: nothing is
//   interpreted at runtime.
// - Conditional sections are `branch`es with their own nested patch, built when shown.
// - One app module (src/app.js): the widgets in page order, the app reducer (routes a message to
//   its widget's reducer and files the marked bits per widget; `tick` goes to the time-driven
//   widgets only), and the top-level view, whose patch first turns a dirty source bit into the
//   reader's bit (one line per cross-widget read), then runs each dirty widget's patch.
// - Events build a message and send it; patches are batched into one microtask.
// - Keyed lists patch changed rows and reconcile the order with Solid 2's reconcileArrays.

import { templateFiles } from "../../frameworks/tea-dirtybits/framework.js";
import { literal, tplText } from "../../frameworks/shared/jsx.js";

export const framework = "tea-dirtybits";

export const params = {};

const J = JSON.stringify;
const OPS = { "==": "===", "!=": "!==", "<": "<", "<=": "<=", ">": ">", ">=": ">=", and: "&&", or: "||" };

const WIDGET_FILE = `import { element, text } from "../runtime.js";

// A widget's <section> and its heading.
export function section(parent, id, label) {
  const root = element(parent, "section", "widget");
  root.setAttribute("data-key", id);
  text(element(root, "h2"), label);
  return root;
}

// A new item's id: one more than the largest.
export function nextId(items) {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}
`;

// ---------------------------------------------------------------------------------------------
// One widget module

function widgetModule(w) {
  const fieldOf = (name) => w.fields.find((f) => f.name === name);
  const msgOf = (name) => w.messages.find((m) => m.name === name);
  const own = (name) => name.toUpperCase();
  const optsName = (name) => "OPTS_" + name.toUpperCase();
  const reads = new Map(); // foreign bit name -> [widget id, field]
  const helpers = new Set(["mark"]);
  const use = (...names) => names.forEach((n) => helpers.add(n));
  const bitList = (names) => (names.length === 1 ? names[0] : names.join(" | "));
  const usedOpts = new Set();

  // An expression of the widget's fields (`s`) and of other widgets' (`w`); `deps` collects
  // the bits it reads.
  function ex(e, deps) {
    const E = (x) => ex(x, deps);
    switch (e[0]) {
      case "f": deps.add(own(e[1])); return `s.${e[1]}`;
      case "w": {
        const bit = `${e[1].toUpperCase()}_${e[2].toUpperCase()}`;
        reads.set(bit, [e[1], e[2]]);
        deps.add(bit);
        return `w.${e[1]}.${e[2]}`;
      }
      case "k": return J(e[1]);
      case "+": return `(${E(e[1])} + ${E(e[2])})`;
      case "-": return `(${E(e[1])} - ${E(e[2])})`;
      case "count": case "len": return `${E(e[1])}.length`;
      case "done": return `${E(e[1])}.filter((item) => item.done).length`;
      case "left": return `${E(e[1])}.filter((item) => !item.done).length`;
      case "has": return `${E(e[1])}.includes(${J(e[2])})`;
      case "not": return `!${E(e[1])}`;
      case "if": return `(${E(e[1])} ? ${E(e[2])} : ${E(e[3])})`;
      default:
        if (OPS[e[0]]) return `(${E(e[1])} ${OPS[e[0]]} ${E(e[2])})`;
    }
    throw new Error(`unknown expression ${J(e)}`);
  }

  // The text of `parts`: a constant string, or a source expression.
  function textOf(parts, deps) {
    if (parts.every((p) => typeof p === "string")) return { stat: parts.join("") };
    if (parts.length === 1) return { src: ex(parts[0], deps) };
    const body = parts.map((p) => (typeof p === "string" ? tplText(p) : `\${${ex(p, deps)}}`)).join("");
    return { src: `\`${body}\`` };
  }

  // -------------------------------------------------------------------------------------------
  // The reducer

  function arm(m) {
    const W = (f) => own(f);
    const guard = [];
    const values = new Map();
    const set = (f, src) => {
      if (values.has(f)) throw new Error(`${w.id}.${m.name} writes ${f} twice`);
      values.set(f, src);
    };
    switch (m.kind) {
      case "input": case "select": set(m.field, "msg.value"); break;
      case "check": set(m.field, `!s.${m.field}`); break;
      case "item": {
        const L = `s.${m.field}`;
        set(m.field, m.op === "remove"
          ? `${L}.filter((item) => item.id !== msg.id)`
          : `${L}.map((item) => (item.id === msg.id ? { ...item, done: !item.done } : item))`);
        break;
      }
      case "click": {
        const alone = m.ops.length === 1;
        for (const op of m.ops) {
          const [kind, f] = op;
          const field = fieldOf(f);
          const S = `s.${f}`;
          if (values.has(f) || (kind === "push" && values.size)) throw new Error(`${w.id}.${m.name}: ops overlap`);
          switch (kind) {
            case "add":
              set(f, op[2] > 0 ? `Math.min(${field.max}, ${S} + ${op[2]})` : `Math.max(${field.min}, ${S} - ${-op[2]})`);
              break;
            case "set": set(f, J(op[2])); break;
            case "toggle": set(f, `!${S}`); break;
            case "reset": set(f, J(field.initial)); break;
            case "cycle": usedOpts.add(f); set(f, `${optsName(f)}[(${optsName(f)}.indexOf(${S}) + 1) % ${optsName(f)}.length]`); break;
            case "push": {
              if (!alone) throw new Error("push with other ops");
              use("nextId");
              guard.push(`const text = s.${op[2]}.trim();`, `if (text === "") return s;`);
              set(f, `[...${S}, { id: nextId(${S}), text${field.checkable ? ", done: false" : ""} }]`);
              set(op[2], '""');
              break;
            }
            case "pushText":
              use("nextId");
              set(f, `[...${S}, { id: nextId(${S}), text: ${J(op[2])}${field.checkable ? ", done: false" : ""} }]`);
              break;
            case "pop": case "shift": case "clear": case "clearDone":
              if (!alone) throw new Error(`${kind} with other ops`);
              guard.push(kind === "clearDone" ? `if (!${S}.some((item) => item.done)) return s;` : `if (${S}.length === 0) return s;`);
              set(f, { pop: `${S}.slice(0, -1)`, shift: `${S}.slice(1)`, clear: "[]", clearDone: `${S}.filter((item) => !item.done)` }[kind]);
              break;
            default: throw new Error(`unknown op ${kind}`);
          }
        }
        break;
      }
      default: throw new Error(`unknown message kind ${m.kind}`);
    }
    return { guard, values, bits: bitList([...values.keys()].map(W)) };
  }

  function write(values, full) {
    const entries = [...values].map(([f, src]) => (src === f ? f : `${f}: ${src}`));
    const spread = full ? [] : ["...s"];
    return `{ ${[...spread, ...entries].join(", ")} }`;
  }

  const arms = [];
  for (const m of w.messages) {
    const a = arm(m);
    const full = a.values.size === w.fields.length;
    arms.push(`    case ${J(m.name)}: {\n${[...a.guard, `mark(${a.bits});`, `return ${write(a.values, full)};`].map((l) => "      " + l).join("\n")}\n    }`);
  }
  // External events: a feed receives notifications; time-driven fields advance while gated.
  const feed = w.fields.find((f) => f.feed);
  if (feed) {
    arms.push(`    case "notify":\n      mark(${own(feed.name)});\n      return { ...s, ${feed.name}: [...s.${feed.name}, msg.item] };`);
  }
  const ticks = w.fields.filter((f) => f.tick);
  if (ticks.length === 1) {
    const f = ticks[0];
    arms.push(`    case "tick": {
      if (!s.${f.tickWhen}) return s;
      const ${f.name} = Math.min(${f.max}, s.${f.name} + ${f.tick});
      if (${f.name} === s.${f.name}) return s;
      mark(${own(f.name)});
      return { ...s, ${f.name} };
    }`);
  } else if (ticks.length > 1) {
    const body = ticks.map((f) => `      if (s.${f.tickWhen}) {
        const v = Math.min(${f.max}, s.${f.name} + ${f.tick});
        if (v !== s.${f.name}) {
          mark(${own(f.name)});
          next = { ...next, ${f.name}: v };
        }
      }`);
    arms.push(`    case "tick": {\n      let next = s;\n${body.join("\n")}\n      return next;\n    }`);
  }

  // -------------------------------------------------------------------------------------------
  // The view: explicit element calls, and bindings grouped by the bits they depend on.

  let uid = 0;
  const name = (p = "e") => p + ++uid;
  const scope = () => ({ groups: new Map(), deps: new Set() });
  const bind = (sc, deps, stmt) => {
    const key = [...deps].sort().join("|");
    if (!sc.groups.has(key)) sc.groups.set(key, { deps: [...deps], stmts: [] });
    sc.groups.get(key).stmts.push(stmt);
    for (const d of deps) sc.deps.add(d);
  };
  // The static patch of a scope. A bit's order is the order of first use, which the mask does
  // not care about.
  const patchBody = (sc, ind) => {
    const out = [];
    for (const g of sc.groups.values()) {
      const mask = g.deps.length === 1 ? g.deps[0] : `(${g.deps.join(" | ")})`;
      if (g.stmts.length === 1) out.push(`${ind}if (d & ${mask}) ${g.stmts[0]}`);
      else out.push(`${ind}if (d & ${mask}) {`, ...g.stmts.map((s) => `${ind}  ${s}`), `${ind}}`);
    }
    return out;
  };

  function build(nodes, P, sc, out, ind) {
    const L = (line) => out.push(ind + line);
    const send = (type, extra = "") => `send({ widget: ${J(w.id)}, type: ${J(type)}${extra} })`;
    for (const n of nodes) {
      switch (n.el) {
        case "text": {
          use("element", "text");
          const deps = new Set();
          const t = textOf(n.parts, deps);
          if (t.stat !== undefined) L(`text(element(${P}, ${J(n.tag)}), ${J(t.stat)});`);
          else {
            const x = name();
            use("setText");
            L(`const ${x} = text(element(${P}, ${J(n.tag)}), "");`);
            bind(sc, deps, `setText(${x}, ${t.src});`);
          }
          break;
        }
        case "button": {
          use("element", "text", "on");
          const b = name();
          L(`const ${b} = element(${P}, "button", ${J(n.msg)});`);
          const deps = new Set();
          const t = textOf(n.text, deps);
          if (t.stat !== undefined) L(`text(${b}, ${J(t.stat)});`);
          else {
            const x = name();
            use("setText");
            L(`const ${x} = text(${b}, "");`);
            bind(sc, deps, `setText(${x}, ${t.src});`);
          }
          if (n.disabled) {
            const d = new Set();
            use("prop");
            bind(sc, d, `prop(${b}, "disabled", ${ex(n.disabled, d)});`);
          }
          L(`on(${b}, "click", () => ${send(n.msg)});`);
          break;
        }
        case "input": {
          use("element", "text", "on", "prop");
          const m = msgOf(n.msg);
          const f = fieldOf(m.field);
          let Q = P;
          if (n.label) {
            Q = name();
            L(`const ${Q} = element(${P}, "label");`);
            L(`text(${Q}, ${J(n.label)});`);
          }
          const i = name();
          L(`const ${i} = element(${Q}, "input", ${J(n.msg)});`);
          if (f.type === "int") {
            L(`${i}.setAttribute("type", "number");`);
            // Only an integer within range becomes a message; anything else stays as typed.
            L(`on(${i}, "input", () => {`);
            L(`  const value = ${i}.valueAsNumber;`);
            L(`  if (Number.isInteger(value) && value >= ${f.min} && value <= ${f.max}) ${send(n.msg, ", value")};`);
            L(`});`);
            bind(sc, new Set([own(f.name)]), `prop(${i}, "valueAsNumber", s.${f.name});`);
          } else {
            L(`${i}.setAttribute("type", "text");`);
            if (n.placeholder) L(`${i}.setAttribute("placeholder", ${J(n.placeholder)});`);
            L(`on(${i}, "input", () => ${send(n.msg, `, value: ${i}.value`)});`);
            bind(sc, new Set([own(f.name)]), `prop(${i}, "value", s.${f.name});`);
          }
          if (n.invalid) {
            use("branch");
            const e = name();
            L(`const ${e} = branch(${P}, () => {`);
            L(`  const p = element(null, "p", ${J(n.msg + "Error")});`);
            L(`  text(p, ${J(n.invalid.message)});`);
            L(`  return [p];`);
            L(`});`);
            const deps = new Set();
            bind(sc, deps, `${e}(${ex(n.invalid.when, deps)}, s, d, w);`);
          }
          break;
        }
        case "check": {
          use("element", "text", "on", "prop");
          const m = msgOf(n.msg);
          const l = name();
          const i = name();
          L(`const ${l} = element(${P}, "label");`);
          L(`const ${i} = element(${l}, "input", ${J(n.msg)});`);
          L(`${i}.setAttribute("type", "checkbox");`);
          L(`text(${l}, ${J(n.label)});`);
          L(`on(${i}, "change", () => ${send(n.msg)});`);
          bind(sc, new Set([own(m.field)]), `prop(${i}, "checked", s.${m.field});`);
          break;
        }
        case "select": {
          use("element", "text", "on", "prop");
          const m = msgOf(n.msg);
          usedOpts.add(m.field);
          let Q = P;
          if (n.label) {
            Q = name();
            L(`const ${Q} = element(${P}, "label");`);
            L(`text(${Q}, ${J(n.label)});`);
          }
          const e = name();
          L(`const ${e} = element(${Q}, "select", ${J(n.msg)});`);
          L(`for (const option of ${optsName(m.field)}) {`);
          L(`  const o = element(${e}, "option");`);
          L(`  o.value = option;`);
          L(`  text(o, option);`);
          L(`}`);
          L(`on(${e}, "change", () => ${send(n.msg, `, value: ${e}.value`)});`);
          bind(sc, new Set([own(m.field)]), `prop(${e}, "value", s.${m.field});`);
          break;
        }
        case "list": {
          use("element", "text", "setText", "list");
          const f = fieldOf(n.field);
          const l = name();
          L(`const ${l} = list(element(${P}, ${J(n.tag)}), (item) => {`);
          L(`  const li = element(null, "li", ${J(n.field + "Item")});`);
          L(`  li.setAttribute("data-key", item.id);`);
          if (n.check) {
            use("on", "prop");
            L(`  const box = element(li, "input", ${J(n.check)});`);
            L(`  box.setAttribute("type", "checkbox");`);
            L(`  on(box, "change", () => ${send(n.check, ", id: item.id")});`);
          }
          L(`  const label = text(element(li, "span"), "");`);
          if (n.remove) {
            use("on");
            L(`  const remove = element(li, "button", ${J(n.remove)});`);
            L(`  text(remove, ${J(n.removeText)});`);
            L(`  on(remove, "click", () => ${send(n.remove, ", id: item.id")});`);
          }
          L(`  const patch = (item) => {`);
          if (n.check) L(`    prop(box, "checked", item.done);`);
          L(`    setText(label, item.text);`);
          L(`  };`);
          L(`  patch(item);`);
          L(`  return { node: li, patch };`);
          L(`});`);
          void f;
          bind(sc, new Set([own(n.field)]), `${l}(s.${n.field});`);
          break;
        }
        case "group": {
          use("element");
          const g = name();
          L(`const ${g} = element(${P}, ${J(n.tag)});`);
          build(n.children, g, sc, out, ind);
          break;
        }
        case "when": {
          use("element", "branch");
          const c = name();
          const inner = scope();
          const body = [];
          const nd = name();
          build(n.children, nd, inner, body, ind + "  ");
          L(`const ${c} = branch(${P}, () => {`);
          L(`  const ${nd} = element(null, ${J(n.tag)});`);
          out.push(...body);
          const patch = patchBody(inner, ind + "    ");
          if (patch.length) {
            L(`  return [${nd}, (s, d, w) => {`);
            out.push(...patch);
            L(`  }];`);
          } else L(`  return [${nd}];`);
          L(`});`);
          const deps = new Set(inner.deps);
          const cond = ex(n.cond, deps);
          bind(sc, deps, `${c}(${cond}, s, d, w);`);
          break;
        }
        default: throw new Error(`unknown view node ${n.el}`);
      }
    }
  }

  const root = scope();
  const body = [];
  build(w.view, "root", root, body, "  ");
  const patch = patchBody(root, "    ");

  // -------------------------------------------------------------------------------------------
  // The module

  let bit = 0;
  const bits = [...w.fields.map((f) => own(f.name)), ...reads.keys()]
    .map((b) => `export const ${b} = ${1 << bit++};`);
  const opts = [...usedOpts].map((f) => `const ${optsName(f)} = ${J(fieldOf(f).options)};`);
  const imports = [...helpers].sort().filter((h) => h !== "nextId");
  const file = `import { ${imports.join(", ")} } from "../runtime.js";
import { section${helpers.has("nextId") ? ", nextId" : ""} } from "./widget.js";

export const id = ${J(w.id)};
${bits.join("\n")}
${opts.length ? opts.join("\n") + "\n" : ""}
export const init = ${literal(Object.fromEntries(w.fields.map((f) => [f.name, f.initial])), "")};

export function update(s, msg) {
  switch (msg.type) {
${arms.join("\n")}
  }
  return s;
}

export function view(parent, s, send, w) {
  const root = section(parent, ${J(w.id)}, ${J(w.label)});
${body.join("\n")}
  const patch = (s, d, w) => {
${patch.join("\n")}
  };
  patch(s, -1, w);
  return patch;
}
`;
  return { file, reads };
}

// ---------------------------------------------------------------------------------------------
// The app module

function appFile(spec, reads) {
  const ids = spec.widgets.map((w) => w.id);
  const imports = ids.map((id) => `import * as ${id} from "./widgets/${id}.js";`);
  // A tick reaches only the time-driven widgets whose gate is on (checked inline, so a tick costs
  // one reducer call per running widget, not per time-driven one).
  const ticks = spec.widgets.filter((w) => w.fields.some((f) => f.tick)).map((w) => {
    const gates = [...new Set(w.fields.filter((f) => f.tick).map((f) => `ws.${w.id}.${f.tickWhen}`))];
    return `      if (${gates.join(" || ")}) model = route(model, ${J(w.id)}, msg);`;
  });
  // One line per cross-widget read: a dirty bit of the source becomes a bit of the reader.
  const edges = [];
  for (const w of spec.widgets) {
    for (const [bit, [src, field]] of reads[w.id]) {
      edges.push(`    if (dirty.${src} & ${src}.${field.toUpperCase()}) dirty.${w.id} |= ${w.id}.${bit};`);
    }
  }
  return `import { take, touch, element } from "./runtime.js";
${imports.join("\n")}

// Every widget in page order: each module is that widget's own bits, reducer and view.
const WIDGETS = [${ids.join(", ")}];
const BY_ID = {};
for (const m of WIDGETS) BY_ID[m.id] = m;

// The initial model: one slice per widget, from its module.
export function init() {
  const widgets = {};
  for (const m of WIDGETS) widgets[m.id] = m.init;
  return { widgets };
}

// All bits: a widget whose whole state was replaced.
const ALL = -1;

function set(model, id, s, bits) {
  touch(id, bits);
  return { ...model, widgets: { ...model.widgets, [id]: s } };
}

// Run one widget's reducer and file the bits its arm marked under that widget.
function route(model, id, msg) {
  const s = model.widgets[id];
  const next = BY_ID[id].update(s, msg);
  const bits = take();
  return next === s ? model : set(model, id, next, bits);
}

// The app reducer: user messages and most external events go to one widget's reducer.
export function update(model, msg) {
  switch (msg.type) {
    case "serverSet":
      return set(model, msg.widget, msg.state, ALL);
    case "snapshot":
      for (const id in msg.state.widgets) touch(id, ALL);
      return msg.state;
    case "tick": {
      const ws = model.widgets;
${ticks.join("\n")}
      return model;
    }
  }
  return route(model, msg.widget, msg);
}

// Builds every widget once. The returned patch first turns dirty bits that other widgets read
// into the readers' bits, then runs each dirty widget's patch.
export function view(root, model, send) {
  const dash = element(root, "div", "dashboard");
  const w = model.widgets;
  const patches = {};
  for (const m of WIDGETS) patches[m.id] = m.view(dash, w[m.id], send, w);
  return (model, dirty) => {
    const w = model.widgets;
${edges.join("\n")}
    for (const id in dirty) patches[id](w[id], dirty[id], w);
  };
}
`;
}

export function emit(spec) {
  const files = {
    ...templateFiles({ name: "unique-components", title: "Unique components" }),
    "src/widgets/widget.js": WIDGET_FILE,
  };
  const reads = {};
  for (const w of spec.widgets) {
    const m = widgetModule(w);
    files[`src/widgets/${w.id}.js`] = m.file;
    reads[w.id] = m.reads;
  }
  files["src/app.js"] = appFile(spec, reads);
  return {
    files,
    style: {
      components: "one module per widget (bits, reducer, initial state, DOM factory), each written from that widget's description; nothing interpreted at runtime",
      state: "one immutable TEA model; the app reducer routes messages to the widgets' reducers",
      updates: "reducer arms mark compile-time dirty bits per field written; a static patch per widget runs only the bindings whose bits are set, batched in a microtask",
      externalEvents: "through the same reducer (send); serverSet and snapshot mark every bit of the widgets they replace; tick goes to the time-driven widgets",
      crossWidgetReads: "a reader has one bit per field it reads; the app patch sets it when the source's bit is dirty (one line per read)",
      lists: "keyed by id: changed rows patched, order reconciled with Solid 2's reconcileArrays",
      conditionals: "branches kept in place by an empty comment, with their own nested patch, built when shown, removed when hidden",
      events: "addEventListener on each element; the handler builds a message and sends it",
      build: "Vite with no framework plugin, production defaults, hidden source maps",
    },
  };
}
