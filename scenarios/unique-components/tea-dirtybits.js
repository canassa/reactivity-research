// unique-components as tea-dirtybits, a prototype strategy (see frameworks/tea-dirtybits/README.md).
//
// This emitter plays the compiler: it writes what an ideal TEA compiler would emit for an app
// where every widget is its own component. Style (recorded in every generated app's rr.json):
// - One module per widget (src/widgets/<id>.js), written from that widget's description alone:
//   its own bits (one per field, plus one per field of another widget it reads), its reducer
//   `update(s, msg)` with one arm per message (the ops written out as code, each arm marking the
//   bits of the fields it writes), its initial state, and its DOM factory `view(parent, id)`,
//   which builds the DOM once from one static template (nodes found by position) and returns a
//   static `patch(s, d, w)` that runs only the bindings whose bits are set. The module adds
//   the triple [view, reducer, initial state] under its id to the registry in widget.js when
//   the app imports it (in page order), so no binding is named per widget. Bits and message
//   tags are numbers. No tables of ops or view
//   trees: nothing is interpreted at runtime.
// - Conditional sections are `branch`es with their own nested patch, built once with the
//   template and swapped for an empty comment while hidden.
// - One app module (src/app.js): the widgets in page order, the app reducer (routes a message to
//   its widget's reducer and files the marked bits per widget; `tick` goes to the time-driven
//   widgets only), and the top-level view, whose patch first turns a dirty source bit into the
//   reader's bit (one line per cross-widget read), then runs each dirty widget's patch.
// - Events build a message and send it; patches are batched into one microtask.
// - Keyed lists patch changed rows, remove gone ones and move misplaced nodes in one walk.

import { templateFiles, trimTemplate } from "../../frameworks/tea-dirtybits/framework.js";
import { literal, tplText } from "../../frameworks/shared/jsx.js";

export const framework = "tea-dirtybits";

export const params = {};

const J = JSON.stringify;
const indent = (lines) => lines.join("\n").split("\n").map((l) => (l ? "  " + l : l)).join("\n");
const OPS = { "==": "===", "!=": "!==", "<": "<", "<=": "<=", ">": ">", ">=": ">=", and: "&&", or: "||" };

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);

const WIDGET_FILE = `// Every widget, by id, in page order (each module adds its own when the app imports it).
export const WIDGETS = {};

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
  // Dirty bits, written as numbers (the compiler knows them): one per field in order, then one
  // per field of another widget the view reads, in order of first use.
  const own = (name) => 1 << w.fields.findIndex((f) => f.name === name);
  const reads = new Map(); // "widget.field" -> [bit, widget id, field]
  const helpers = new Set(["mark"]);
  const use = (...names) => names.forEach((n) => helpers.add(n));
  const bitList = (bits) => bits.reduce((a, b) => a | b, 0);
  // Messages are numbered, as Elm --optimize tags constructors, in the order the view first
  // sends them (then any the view never sends).
  const order = [];
  const sends = (nodes) => {
    for (const n of nodes) {
      for (const k of ["msg", "check", "remove"]) if (n[k] && !order.includes(n[k])) order.push(n[k]);
      if (n.children) sends(n.children);
    }
  };
  sends(w.view);
  for (const m of w.messages) if (!order.includes(m.name)) order.push(m.name);
  const messages = order.map((name) => w.messages.find((m) => m.name === name));
  const tag = (name) => order.indexOf(name);

  // An expression of the widget's fields (`s`) and of other widgets' (`w`); `deps` collects
  // the bits it reads.
  function ex(e, deps) {
    const E = (x) => ex(x, deps);
    switch (e[0]) {
      case "f": deps.add(own(e[1])); return `s.${e[1]}`;
      case "w": {
        const key = `${e[1]}.${e[2]}`;
        if (!reads.has(key)) reads.set(key, [1 << (w.fields.length + reads.size), e[1], e[2]]);
        deps.add(reads.get(key)[0]);
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
            case "cycle": {
              // The option after the current one, wrapping around, decided at compile time.
              const o = field.options;
              set(f, "(" + o.slice(0, -1).map((v, i) => `${S} === ${J(v)} ? ${J(o[i + 1])} : `).join("") + J(o[0]) + ")");
              break;
            }
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
  for (const m of messages) {
    const a = arm(m);
    const full = a.values.size === w.fields.length;
    arms.push(`    case ${tag(m.name)}: { // ${m.name}\n${[...a.guard, `mark(${a.bits});`, `return ${write(a.values, full)};`].map((l) => "      " + l).join("\n")}\n    }`);
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
  // The view: one static template (escaped at build time), nodes found by their position in it,
  // and bindings grouped by the bits they depend on.

  let uid = 0;
  const name = (p = "e") => p + ++uid;
  const scope = () => ({ groups: new Map(), deps: new Set() });
  const bind = (sc, deps, stmt) => {
    const key = [...deps].sort().join("|");
    if (!sc.groups.has(key)) sc.groups.set(key, { deps: [...deps], stmts: [] });
    sc.groups.get(key).stmts.push(stmt);
    for (const d of deps) sc.deps.add(d);
  };
  // The static patch of a scope: one test per group of bindings, in the order of their masks
  // (bindings are independent, so any order is correct; this one reads alike across widgets).
  const patchBody = (sc, ind) => {
    const out = [];
    const groups = [...sc.groups.values()].map((g) => [bitList(g.deps), g]).sort((x, y) => x[0] - y[0]);
    for (const [mask, g] of groups) {
      if (g.stmts.length === 1) out.push(`${ind}if (d & ${mask}) ${g.stmts[0]}`);
      else out.push(`${ind}if (d & ${mask}) {`, ...g.stmts.map((s) => `${ind}  ${s}`), `${ind}}`);
    }
    return out;
  };
  const W = "id";

  // Elements are numbered in document order, as `html` returns them: `t[0]` is the section.
  let count = 0;
  const node = () => `t[${count++}]`;

  // Appends the markup of `nodes` to the returned string; handlers go to `out`, bindings to `sc`.
  function build(nodes, sc, out, ind) {
    const L = (line) => out.push(ind + line);
    const E = (line) => wires.push("  " + line);
    let h = "";
    for (const n of nodes) {
      switch (n.el) {
        case "text": {
          const deps = new Set();
          const t = textOf(n.parts, deps);
          const e = node();
          if (t.stat !== undefined) h += `<${n.tag}>${esc(t.stat)}</${n.tag}>`;
          else {
            use("setText");
            h += `<${n.tag}></${n.tag}>`;
            bind(sc, deps, `setText(${e}, ${t.src});`);
          }
          break;
        }
        case "button": {
          use("onClick");
          const b = node();
          const deps = new Set();
          const t = textOf(n.text, deps);
          if (t.stat !== undefined) h += `<button data-role=${n.msg}>${esc(t.stat)}</button>`;
          else {
            use("setText");
            h += `<button data-role=${n.msg}></button>`;
            bind(sc, deps, `setText(${b}, ${t.src});`);
          }
          if (n.disabled) {
            const d = new Set();
            use("setDisabled");
            bind(sc, d, `setDisabled(${b}, ${ex(n.disabled, d)});`);
          }
          E(`onClick(${b}, ${W}, ${tag(n.msg)});`);
          break;
        }
        case "input": {
          const m = msgOf(n.msg);
          const f = fieldOf(m.field);
          if (n.label) {
            node();
            h += `<label>${esc(n.label)}`;
          }
          const i = node();
          if (f.type === "int") {
            use("onInt", "setNumber");
            h += `<input type=number data-role=${n.msg}>`;
            // Only an integer within range becomes a message; anything else stays as typed.
            E(`onInt(${i}, ${W}, ${tag(n.msg)}, ${f.min}, ${f.max});`);
            bind(sc, new Set([own(f.name)]), `setNumber(${i}, s.${f.name});`);
          } else {
            use("onInput", "setValue");
            h += `<input type=text data-role=${n.msg}${n.placeholder ? ` placeholder="${esc(n.placeholder)}"` : ""}>`;
            E(`onInput(${i}, ${W}, ${tag(n.msg)});`);
            bind(sc, new Set([own(f.name)]), `setValue(${i}, s.${f.name});`);
          }
          if (n.label) h += `</label>`;
          if (n.invalid) {
            use("branch");
            const e = name();
            h += `<p data-role=${n.msg}Error>${esc(n.invalid.message)}</p>`;
            L(`const ${e} = branch(${node()});`);
            const deps = new Set();
            bind(sc, deps, `${e}(${ex(n.invalid.when, deps)});`);
          }
          break;
        }
        case "check": {
          use("onCheck", "setChecked");
          const m = msgOf(n.msg);
          node();
          const i = node();
          h += `<label><input type=checkbox data-role=${n.msg}>${esc(n.label)}</label>`;
          E(`onCheck(${i}, ${W}, ${tag(n.msg)});`);
          bind(sc, new Set([own(m.field)]), `setChecked(${i}, s.${m.field});`);
          break;
        }
        case "select": {
          use("onInput", "setValue");
          const m = msgOf(n.msg);
          if (n.label) {
            node();
            h += `<label>${esc(n.label)}`;
          }
          const e = node();
          h += `<select data-role=${n.msg}>`;
          for (const o of fieldOf(m.field).options) {
            node();
            h += `<option value="${esc(o)}">${esc(o)}</option>`;
          }
          h += `</select>`;
          if (n.label) h += `</label>`;
          E(`onInput(${e}, ${W}, ${tag(n.msg)});`);
          bind(sc, new Set([own(m.field)]), `setValue(${e}, s.${m.field});`);
          break;
        }
        case "list": {
          use("html", "setText", "list");
          const l = name();
          h += `<${n.tag}></${n.tag}>`;
          let row = `<li data-role=${n.field}Item>`;
          let k = 1;
          const box = n.check ? `r[${k++}]` : null;
          if (n.check) row += `<input type=checkbox data-role=${n.check}>`;
          const label = `r[${k++}]`;
          row += `<span></span>`;
          const remove = n.remove ? `r[${k++}]` : null;
          if (n.remove) row += `<button data-role=${n.remove}>${esc(n.removeText)}</button>`;
          row += `</li>`;
          L(`const ${l} = list(${node()}, (item) => {`);
          L(`  const r = html(${J(trimTemplate(row))});`);
          L(`  r[0].dataset.key = item.id;`);
          if (n.check) {
            use("onCheck", "setChecked");
            L(`  onCheck(${box}, ${W}, ${tag(n.check)}, item.id);`);
          }
          if (n.remove) {
            use("onClick");
            L(`  onClick(${remove}, ${W}, ${tag(n.remove)}, item.id);`);
          }
          if (n.check) {
            L(`  return [r[0], (item) => {`);
            L(`    setChecked(${box}, item.done);`);
            L(`    setText(${label}, item.text);`);
            L(`  }];`);
          } else L(`  return [r[0], (item) => setText(${label}, item.text)];`);
          L(`});`);
          bind(sc, new Set([own(n.field)]), `${l}(s.${n.field});`);
          break;
        }
        case "group": {
          node();
          h += `<${n.tag}>${build(n.children, sc, out, ind)}</${n.tag}>`;
          break;
        }
        case "when": {
          use("branch");
          const c = name();
          const e = node();
          const inner = scope();
          h += `<${n.tag}>${build(n.children, inner, out, ind)}</${n.tag}>`;
          const patch = patchBody(inner, ind + "  ");
          if (patch.length) {
            L(`const ${c} = branch(${e}, (s, d, w) => {`);
            out.push(...patch);
            L(`});`);
          } else L(`const ${c} = branch(${e});`);
          const deps = new Set(inner.deps);
          const cond = ex(n.cond, deps);
          bind(sc, deps, patch.length ? `${c}(${cond}, s, d, w);` : `${c}(${cond});`);
          break;
        }
        default: throw new Error(`unknown view node ${n.el}`);
      }
    }
    return h;
  }

  const root = scope();
  const body = [];
  const wires = [];
  node(); // the section
  node(); // its heading
  const markup = `<section data-role=widget><h2>${esc(w.label)}</h2>${build(w.view, root, body, "  ")}</section>`;
  let patch = patchBody(root, "    ");
  // Patches take the whole model (`w`) only when the widget reads another widget.
  const args = reads.size ? "s, d, w" : "s, d";
  if (!reads.size) {
    const drop = (l) => l.replace("(s, d, w) =>", "(s, d) =>").replace(", s, d, w);", ", s, d);");
    patch = patch.map(drop);
    body.forEach((l, i) => (body[i] = drop(l)));
  }
  // Event wiring after the branches and lists, so the handlers read as one run.
  body.push(...wires);

  // -------------------------------------------------------------------------------------------
  // The module

  const bits = [...w.fields.map((f) => `${f.name} ${own(f.name)}`), ...[...reads].map(([k, [b]]) => `${k} ${b}`)];
  const tags = messages.map((m, i) => `${m.name} ${i}`);
  helpers.add("html");
  const imports = [...helpers].sort().filter((h) => h !== "nextId");
  const file = `import { ${imports.join(", ")} } from "../runtime.js";
import { ${helpers.has("nextId") ? "WIDGETS, nextId" : "WIDGETS"} } from "./widget.js";

// Dirty bits: ${bits.join(", ")}.
// Message tags: ${tags.join(", ")}.

// The widget: its DOM factory, its reducer and its initial state.
WIDGETS.${w.id} = [
  // Builds the widget once and returns its static patch.
  (parent, id) => {
    const t = html(${J(trimTemplate(markup))}, parent);
${indent(body)}
    return (${args}) => {
${indent(patch)}
    };
  },

  (s, msg) => {
    switch (msg.type) {
${indent(arms)}
    }
    return s;
  },

  ${literal(Object.fromEntries(w.fields.map((f) => [f.name, f.initial])), "  ")},
];
`;
  return { file, reads, bit: own };
}

// ---------------------------------------------------------------------------------------------
// The app module

function appFile(spec, mods) {
  const ids = spec.widgets.map((w) => w.id);
  const imports = ids.map((id) => `import "./widgets/${id}.js";`);
  // A tick reaches only the time-driven widgets whose gate is on (checked inline, so a tick costs
  // one reducer call per running widget, not per time-driven one).
  const ticks = spec.widgets.filter((w) => w.fields.some((f) => f.tick)).map((w) => {
    const gates = [...new Set(w.fields.filter((f) => f.tick).map((f) => `ws.${w.id}.${f.tickWhen}`))];
    return `      if (${gates.join(" || ")}) model = route(model, ${J(w.id)}, msg);`;
  });
  // One line per cross-widget read: a dirty bit of the source becomes a bit of the reader.
  // The compiler knows every bit, so it writes them as numbers.
  const edges = [];
  for (const w of spec.widgets) {
    for (const [key, [bit, src, field]] of mods[w.id].reads) {
      edges.push(`    if (dirty.${src} & ${mods[src].bit(field)}) dirty.${w.id} |= ${bit}; // ${key} -> ${w.id}`);
    }
  }
  return `import { take, touch, html } from "./runtime.js";
import { WIDGETS } from "./widgets/widget.js";
// Every widget in page order: each module adds its own [view, reducer, initial state].
${imports.join("\n")}

// The initial model: one slice per widget, from its module.
export function init() {
  const widgets = {};
  for (const id in WIDGETS) widgets[id] = WIDGETS[id][2];
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
  const next = WIDGETS[id][1](s, msg);
  // An arm that returns the slice unchanged marks nothing, so only a new slice takes the bits.
  return next === s ? model : set(model, id, next, take());
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

// Builds every widget once (each view appends its section, which the app keys by the widget id).
// The returned patch first turns dirty bits that other widgets read into the readers' bits, then
// runs each dirty widget's patch.
export function view(root, model) {
  const dash = html("<div data-role=dashboard></div>", root)[0];
  const w = model.widgets;
  const patches = {};
  for (const id in WIDGETS) {
    patches[id] = WIDGETS[id][0](dash, id);
    dash.lastChild.dataset.key = id;
    patches[id](w[id], -1, w);
  }
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
  const mods = {};
  for (const w of spec.widgets) {
    const m = widgetModule(w);
    files[`src/widgets/${w.id}.js`] = m.file;
    mods[w.id] = m;
  }
  files["src/app.js"] = appFile(spec, mods);
  return {
    files,
    style: {
      components: "one module per widget (bits, reducer, initial state, DOM factory), each written from that widget's description; nothing interpreted at runtime",
      state: "one immutable TEA model; the app reducer routes messages to the widgets' reducers",
      updates: "reducer arms mark compile-time dirty bits per field written; a static patch per widget runs only the bindings whose bits are set, batched in a microtask",
      externalEvents: "through the same reducer (send); serverSet and snapshot mark every bit of the widgets they replace; tick goes to the time-driven widgets",
      crossWidgetReads: "a reader has one bit per field it reads; the app patch sets it when the source's bit is dirty (one line per read)",
      lists: "keyed by id: changed rows patched, gone rows removed, misplaced nodes moved in one walk",
      conditionals: "branches built once with the template, swapped for an empty comment while hidden, with their own nested patch",
      events: "addEventListener on each element; the handler builds a message and sends it",
      build: "Vite with no framework plugin, production defaults, hidden source maps",
    },
  };
}
