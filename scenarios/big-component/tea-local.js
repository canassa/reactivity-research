// big-component as tea-local, a prototype strategy (frameworks/tea-local/README.md): what an
// ideal compiler would emit from a TEA source of one big settings form, with local message
// routing.
//
// The problem this scenario poses to tea-local: the strategy re-runs the whole binding list of
// an instance after each of its messages, and the form is one flat list of N field units with
// dependencies reaching anywhere earlier. Two grains (the `grain` parameter):
//
// - `unit` (default): one component instance per field unit, the smallest block the app's own
//   structure gives (a field with its controls and displays; a list brings its draft text, a
//   time-driven int its gate). The spec draws no groups, but it does define a unit; nothing here
//   is a fixed-size chunk. An event re-runs the binding list of that unit (a handful of
//   bindings), plus the lists of the units that read its fields.
// - `form`: the whole form as one instance. The strategy exactly as written, and a dead end for
//   this scenario: every message re-runs all N units' bindings (see the README).
//
// Style (recorded in every generated app's rr.json):
// - One model, split into slices. The form's state is one record; each instance owns the slice of
//   its unit's fields in its closure. Its reducer (a table of arms, one per message, written out
//   from the message's kind and ops) only ever touches its own slice. The companion is an
//   instance of its own, as in unique-components.
// - A unit block is what its factory would be, inlined (it is called once): its slice, its
//   reducer, its static template and its binding list (`patch`, one write per binding, each
//   skipped when unchanged), the DOM built once and wired by position. A top-level view node
//   belongs to the unit of the latest field it touches (a derived text over this field and an
//   earlier one is built by this unit's instance). After a message only that unit's patch runs,
//   plus the patches of the readers that watch it.
// - Bindings that read another unit's field read that instance's current slice from the frame's
//   registry (`units[3].m`) in `patch`, and the reader watches the instance (`follow`), as a
//   summary watches its sources in the sibling scenarios. Every field is read by a bounded number
//   of bindings (the scenario's cap), so an event costs a bounded number of patches.
// - A combined button (it writes its own field and an earlier one) is a message to two instances,
//   as a parent routing a child's message would be: the button's unit runs its arm for its own
//   fields, and sends the other unit a message of its own (an extra constructor on that unit,
//   `forward`). A reducer never does the sending.
// - Every instance has `Load` as message 0: it takes the whole component's state, picks its own
//   fields and replaces its slice. A `serverSet` or `snapshot` of the form sends it to each
//   instance (the global events, O(N) by nature). Nothing else touches the slices as a whole, so
//   no reducer ever copies the whole form's state.
// - External events: `tick` calls the instances in the shared `running` set (a unit with a
//   time-driven int subscribes while its gate is on); `notify` sends the feed's unit its Notify
//   message.
// - Keyed lists through the runtime's `list`. Conditional content (`when`, validation errors)
//   is in the template; while hidden, an empty text node holds its place.
// - A message is sent as its constructor's tag and its argument, if any: `send(tag, value)`, the
//   reducer is a jump table, controls take tags 1, 2, … in document order (then each list row's
//   controls), attached by position by the runtime's `wire`; a number input sends its value as
//   a number and its reducer arm takes only an integer within [min, max].

import { templateFiles } from "../../frameworks/tea-local/framework.js";

export const framework = "tea-local";

export const params = {
  grain: {
    default: "unit",
    choices: ["unit", "form"],
    help: "instances of the form: one per field unit (a field with its controls), or the whole form as one",
  },
};

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
    case "f": return ref(cx, e[1], false);
    case "w": return ref(cx, e[2], true);
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
// block gets them from the frame as `[root, ...root.querySelectorAll("*")]`, so `e[0]` is
// the template's root (a fragment for a unit) and `e[1]` its first element. A dynamic text is the only child of its
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
      if (n.disabled) cx.patch.push(`setProp(${v}, "disabled", ${expr(n.disabled, cx, true)});`);
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
          cx.patch.push(`setProp(${v}, "valueAsNumber", m.${f.name});`);
        } else {
          cx.wire.push(tag(n.msg));
          cx.patch.push(`setProp(${v}, "value", m.${f.name});`);
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
      cx.patch.push(`setProp(${v}, "checked", m.${msgOf(n.msg).field});`);
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
        cx.patch.push(`setProp(${v}, "value", m.${f.name});`);
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
      if (n.check) create(`  setProp(r[1], "checked", item.done);`);
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


// A field read: the instance's own model, or another unit's slice (`m3.field`), which the
// reader watches. The companion's own fields are `local`; its `["w", "w1", name]` reads are the
// form's.
function ref(cx, name, foreign) {
  if (cx.local && !foreign) { cx.own = true; return `m.${name}`; }
  const owner = cx.groupOf.get(name);
  if (owner === cx.group) { cx.own = true; return `m.${name}`; }
  cx.sources.add(owner);
  return `m${owner}.${name}`;
}

// ---------------------------------------------------------------------------------------------
// The form's instances. A field unit is a main field with its auxiliary fields (the draft of a
// list fed from a draft, the gate of a time-driven int): the grain the app's own structure gives.
// Each unit is one instance (`grain: unit`), or the whole form is one (`grain: form`).

function unitsOf(form) {
  const aux = new Map();
  for (const m of form.messages) if (m.kind === "click") for (const op of m.ops) if (op[0] === "push") aux.set(op[2], op[1]);
  for (const f of form.fields) if (f.tickWhen) aux.set(f.tickWhen, f.name);
  const out = [];
  const byMain = new Map();
  for (const f of form.fields) {
    const main = aux.get(f.name) ?? f.name;
    if (!byMain.has(main)) {
      byMain.set(main, []);
      out.push(byMain.get(main));
    }
    byMain.get(main).push(f.name);
  }
  return out;
}

// [{ index, names, nodes }]: the instances in page order, each with its fields and the top-level
// view nodes it builds. A node belongs to the instance of the latest field it touches (a derived
// text, a combined button or a validation sits with the latest unit it involves); a node touching
// nothing stays with the previous one. The nodes of an instance are contiguous.
function layout(form, grain) {
  const units = grain === "form" ? [form.fields.map((f) => f.name)] : unitsOf(form);
  const groups = units.map((names, index) => ({ index, names, nodes: [] }));
  const owner = new Map(groups.flatMap((g) => g.names.map((n) => [n, g.index])));
  let at = 0;
  for (const node of form.view) {
    const seen = [];
    touches(form, node, seen);
    at = Math.max(at, ...seen.map((f) => owner.get(f)));
    groups[at].nodes.push(node);
  }
  return groups;
}

// The fields an expression reads.
function reads(e, out = new Set()) {
  if (Array.isArray(e)) {
    if (e[0] === "f") out.add(e[1]);
    else if (e[0] === "has") reads(e[1], out);
    else if (e[0] !== "k" && e[0] !== "w") e.slice(1).forEach((x) => reads(x, out));
  }
  return out;
}

// The fields a view node touches, in document order: reads, and those of its messages.
function touches(w, node, out) {
  const msg = (name) => w.messages.find((m) => m.name === name);
  const expr = (e) => e && out.push(...reads(e));
  const message = (name) => {
    const m = msg(name);
    if (m.kind === "click") for (const op of m.ops) { out.push(op[1]); if (op[0] === "push") out.push(op[2]); }
    else out.push(m.field);
  };
  switch (node.el) {
    case "text": node.parts.forEach(expr); break;
    case "button": node.text.forEach(expr); message(node.msg); expr(node.disabled); break;
    case "input": message(node.msg); expr(node.invalid?.when); break;
    case "check": case "select": message(node.msg); break;
    case "list": out.push(node.field); if (node.check) message(node.check); if (node.remove) message(node.remove); break;
    case "when": expr(node.cond); break;
  }
  for (const c of node.children || []) touches(w, c, out);
}

// The controls of a view (the messages they send), in document order.
function controlsOf(nodes, out = []) {
  for (const n of nodes) {
    if (n.msg) out.push(n.msg);
    if (n.el === "list") out.push(...[n.check, n.remove].filter(Boolean));
    controlsOf(n.children || [], out);
  }
  return out;
}

// Message tags are the compiler's to choose: the controls of a template take 1, 2, 3, ... (tag 0
// is Load) in document order, then each list row's controls, in order.
function messageOrder(nodes, sent) {
  const section = [];
  const rows = [];
  const walk = (ns) => {
    for (const n of ns) {
      if (n.el === "list") rows.push(...[n.check, n.remove].filter(Boolean));
      else if (n.el === "when" || n.el === "group") walk(n.children);
      else if (n.msg) section.push(n.msg);
    }
  };
  walk(nodes);
  return [...section, ...rows].map((name) => sent.find((m) => m.name === name));
}

// Plan every instance: its fields, its messages (the ones its controls send, in the order the
// template's controls take tags, after the Load message 0), the messages other units send it
// for their combined buttons, and its tags.
function plan(spec, form, groups) {
  const owner = new Map(groups.flatMap((g) => g.names.map((n) => [n, g.index])));
  for (const f of form.fields) {
    if (f.tickWhen && owner.get(f.tickWhen) !== owner.get(f.name)) throw new Error(`${f.name}: gate in another unit`);
  }
  const init = spec.initialState.widgets[form.id];
  for (const g of groups) {
    g.fields = form.fields.filter((f) => owner.get(f.name) === g.index);
    g.init = Object.fromEntries(g.fields.map((f) => [f.name, init[f.name]]));
    g.sent = []; // the messages whose control is in this unit
    g.recv = []; // messages from other units' combined buttons
  }
  // Which unit's control sends each message.
  const home = new Map();
  for (const g of groups) {
    for (const name of controlsOf(g.nodes)) {
      if (home.has(name)) throw new Error(`${name}: a message sent by two controls`);
      home.set(name, g.index);
    }
  }
  for (const m of form.messages) {
    if (!home.has(m.name)) throw new Error(`${m.name}: no control`);
    const g = groups[home.get(m.name)];
    if (m.kind !== "click") {
      if (owner.get(m.field) !== g.index) throw new Error(`${m.name}: writes another unit's field`);
      g.sent.push(m);
      continue;
    }
    const by = new Map();
    for (const op of m.ops) {
      if (op[0] === "push" && owner.get(op[1]) !== owner.get(op[2])) throw new Error(`${m.name}: push across units`);
      const o = owner.get(op[1]);
      by.set(o, [...(by.get(o) ?? []), op]);
    }
    const sent = { ...m, ops: by.get(g.index) ?? [], forwards: [] };
    g.sent.push(sent);
    for (const [o, ops] of by) {
      if (o === g.index) continue;
      groups[o].recv.push({ name: "from" + cap(m.name), kind: "click", ops });
      sent.forwards.push({ to: o, recv: groups[o].recv.length - 1 });
    }
  }
  // Tags: Load 0, the controls' messages, then Tick, Notify, the received ones.
  for (const g of groups) {
    g.messages = [{ name: "load", kind: "load" }, ...messageOrder(g.nodes, g.sent)];
    g.timed = g.fields.filter((f) => f.tick);
    g.feed = g.fields.find((f) => f.feed);
    g.tickTag = g.timed.length ? g.messages.length : null;
    g.notifyTag = g.feed ? g.messages.length + (g.timed.length ? 1 : 0) : null;
    g.recvBase = g.messages.length + (g.timed.length ? 1 : 0) + (g.feed ? 1 : 0);
  }
  return { groups, owner };
}

// ---------------------------------------------------------------------------------------------
// Blocks of the page function.

const RUNTIME = ["setText", "setProp", "instance", "list", "wire"];
const FRAME = ["add", "unit", "units", "follow", "forward", "running", "row", "place", "nextId", "subscribe"];

const newCx = (extra) => ({
  create: [], patch: [], wire: [], html: "", index: 1, own: false, sources: new Set(), counts: {},
  name(prefix) { this.counts[prefix] = (this.counts[prefix] ?? 0) + 1; return prefix + this.counts[prefix]; },
  ...extra,
});

const msgType = (w, messages) => messages.map((m) => {
  if (m.kind === "load") return "Load Model";
  const f = w.fields.find((x) => x.name === m.field);
  return cap(m.name) + (m.kind === "input" || m.kind === "select" ? (f.type === "int" ? " Float" : " String") : m.kind === "item" ? " Int" : "");
});

const indent = (s, n = 2) => s.replace(/^(?=.)/gm, " ".repeat(n));

// One instance: a block of the page function.
function groupBlock(spec, form, p, g) {
  const w = { fields: form.fields, messages: g.messages };
  const cx = newCx({ group: g.index, groupOf: p.owner });
  compileView(w, g.nodes, cx);
  const cases = g.messages.map((m) => {
    if (m.kind === "load") {
      const names = g.fields.map((f) => f.name).join(", ");
      return `(_, { ${names} }) => ({ ${names} })`;
    }
    return m.kind === "click" && !m.ops.length ? "(m) => m" : reducerCase(form, m, cx);
  });
  const gate = g.timed.map((f) => "m." + f.tickWhen).join(" || ");
  if (g.timed.length) {
    const step = (f, s) => `${s}.${f.tickWhen} && ${s}.${f.name} < ${f.max}`;
    const grown = (f, s) => `{ ...${s}, ${f.name}: Math.min(${f.max}, ${s}.${f.name} + ${f.tick}) }`;
    if (g.timed.length === 1) cases.push(handler(`${step(g.timed[0], "m")} ? ${grown(g.timed[0], "m")} : m`));
    else {
      const body = g.timed.map((f) => `  if (${step(f, "n")}) n = ${grown(f, "n")};`);
      cases.push(handler(`{\n  let n = m;\n${body.join("\n")}\n  return n;\n}`));
    }
  }
  if (g.feed) cases.push(handler(`{ ...m, ${g.feed.name}: [...m.${g.feed.name}, value] }`));
  for (const r of g.recv) cases.push(reducerCase(form, r, cx));

  const types = msgType(form, g.messages);
  if (g.timed.length) types.push("Tick");
  if (g.feed) types.push("Notify Item");
  for (const r of g.recv) types.push(cap(r.name));

  const sources = [...cx.sources].sort((a, b) => a - b);
  const fn = [`{`, `  // unit ${g.index}`];
  fn.push(`  const patch = () => {`);
  if (cx.own) fn.push(`    const m = self.m;`);
  for (const s of sources) fn.push(`    const m${s} = units[${s}].m;`);
  fn.push(...cx.patch.map((l) => "    " + l));
  fn.push(`  };`);
  if (sources.length) fn.push(`  follow(patch, ${sources.join(", ")});`);
  fn.push(`  // type Msg = ${types.join(" | ")}`);
  fn.push(`  const self = instance(${lit(g.init)}, [`, ...cases.map((c) => `    ${c.replace(/\n/g, "\n    ")},`), `  ], patch);`);
  cx.wire.forEach((t, i) => { if (t !== i + 1) throw new Error(`unit ${g.index}: control tags out of order`); });
  // A combined button that also writes another unit sends it a message of its own.
  for (const m of g.messages) {
    for (const f of m.forwards ?? []) {
      fn.push(`  forward(self, ${g.messages.indexOf(m)}, ${f.to}, ${p.groups[f.to].recvBase + f.recv});`);
    }
  }
  fn.push(`  const e = unit(form, ${q(trim(cx.html))}, self);`);
  fn.push(...cx.create);
  if (g.timed.length) fn.push(`  subscribe(self, ${g.tickTag}, (m) => ${gate});`);
  fn.push(`}`);
  return fn.join("\n");
}

// The companion: an instance of its own, reading the form's fields through the frame's registry.
function companionBlock(spec, p, w) {
  w = { ...w, messages: messageOrder(w.view, w.messages) };
  const cx = newCx({ group: null, groupOf: p.owner, local: true, index: 2 });
  compileView(w, w.view, cx);
  const cases = w.messages.map((m) => reducerCase(w, m, cx));
  const sources = [...cx.sources].sort((a, b) => a - b);
  const fn = [`{`, `  // ${w.id}: ${w.label} (${w.kind})`, `  const patch = () => {`];
  if (cx.own) fn.push(`    const m = self.m;`);
  for (const s of sources) fn.push(`    const m${s} = units[${s}].m;`);
  fn.push(...cx.patch.map((l) => "    " + l), `  };`);
  fn.push(`  follow(patch, ${sources.join(", ")});`);
  fn.push(`  // type Msg = ${msgType(w, w.messages).join(" | ")}`);
  fn.push(`  const self = instance(${lit(spec.initialState.widgets[w.id])}, [`, ...cases.map((c) => `    ${c.replace(/\n/g, "\n    ")},`), `  ], patch);`);
  cx.wire.forEach((t, i) => { if (t !== i) throw new Error(`${w.id}: control tags out of order`); });
  fn.push(`  companion = self;`);
  fn.push(`  const e = wire(add(main, ${q(trim("<section data-key=" + w.id + " data-role=widget><h2>" + esc(w.label) + "</h2>" + cx.html))}), self, 0);`);
  fn.push(...cx.create, `}`);
  return fn.join("\n");
}

// ---------------------------------------------------------------------------------------------

const FRAME_FILE = `import { wire, schedule } from "../runtime.js";

// The form's instances in page order (the first unit first), for the external events, the
// readers that cross instances and the messages between them.
export const units = [];

// Insert markup as the last child of \`parent\` (trailing end tags may be left out) and return it.
export function add(parent, html) {
  parent.insertAdjacentHTML("beforeend", html);
  return parent.lastChild;
}

// A unit: its template (a run of sibling nodes of the form, parsed in a fragment) appended to the
// form, registered, its controls wired to the messages 1, 2, 3, ... (message 0 is Load). Returns
// the template's elements in document order.
export function unit(parent, html, self) {
  units.push(self);
  const t = document.createElement("template");
  t.innerHTML = html;
  const e = wire(t.content, self, 1);
  parent.append(t.content);
  return e;
}

// A reader of the units \`sources\` (their indexes): its patch runs after the first render and
// whenever one of them changes.
export function follow(patch, ...sources) {
  schedule(patch);
  for (const source of sources) units[source].watch(patch);
}

// A combined button that also writes another unit: after its own message, the message
// \`otherTag\` goes to unit \`other\`.
export function forward(self, tag, other, otherTag) {
  const { send } = self;
  self.send = (t, value) => {
    send(t, value);
    if (t === tag) units[other].send(otherTag);
  };
}

// Conditional content, built in the template: while hidden, an empty text node holds its place
// (and takes it back when shown), so its siblings are never touched.
export function place(node, shown) {
  if (!shown) node.replaceWith((node.mark ??= new Text()));
  else node.mark?.replaceWith(node);
}

// A list row from its template (parsed once): each new row is a clone, its controls wired to
// the messages \`first\`, … with the item's id (see \`wire\`). Returns its elements, in document
// order (the row first).
export function row(html, self, first) {
  const t = document.createElement("template");
  t.innerHTML = html;
  return (item) => wire(t.content.firstChild.cloneNode(true), self, first, item.id);
}

export const nextId = (items) => items.reduce((max, item) => Math.max(max, item.id), 0) + 1;

// The tick handlers of the units whose time-driven gate is on (their subscription).
export const running = new Set();

// A time-driven unit's subscription, as in Elm's \`subscriptions\`: after every change to its
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

export function emit(spec, options = {}) {
  const [form, companion] = spec.widgets;
  if (spec.widgets.length !== 2 || form.id !== "w1" || companion.id !== "w2") throw new Error("expected the form w1 and its companion w2");
  const grain = options.grain ?? "unit";
  const p = plan(spec, form, layout(form, grain));
  const files = {
    ...templateFiles({ name: "big-component", title: "Big component" }),
    "src/widgets/frame.js": FRAME_FILE,
  };
  const blocks = p.groups.map((g) => groupBlock(spec, form, p, g)).join("\n");
  const timed = p.groups.some((g) => g.timed.length);
  const feedGroup = p.groups.find((g) => g.feed);
  const companionCode = companionBlock(spec, p, companion);
  const code = blocks + companionCode;
  const used = (names) => names.filter((h) => h === "units" || (h === "running" && timed) || new RegExp(`\\b${h}\\(`).test(code));
  files["src/app.js"] = `import { ${used(RUNTIME).join(", ")} } from "./runtime.js";
import { ${used(FRAME).join(", ")} } from "./widgets/frame.js";

export function App(root) {
  root.insertAdjacentHTML("beforeend", "<div data-role=page>");
  return page(root.lastChild);
}

// The form's instances in page order, then the companion and the routing of external events.
function page(main) {
  let companion;
  const form = add(main, ${q(trim("<section data-key=w1 data-role=widget><h2>" + esc(form.label) + "</h2>"))});
${indent(blocks)}
${indent(companionCode)}

  return {
    // External events, routed to the instances they concern.
    receive(msg) {
      switch (msg.type) {
        case "serverSet":
          if (msg.widget === "w2") companion.set(msg.state);
          else for (const g of units) g.send(0, msg.state);
          break;
${timed ? `        case "tick":
          for (const tick of running) tick();
          break;
` : ""}${feedGroup ? `        case "notify":
          units[${feedGroup.index}].send(${feedGroup.notifyTag}, msg.item);
          break;
` : ""}        case "snapshot":
          for (const g of units) g.send(0, msg.state.widgets.w1);
          companion.set(msg.state.widgets.w2);
          break;
      }
    },
    dispose() {
${timed ? "      running.clear();\n" : ""}      units.length = 0;
      main.remove();
    },
  };
}
`;
  return {
    files,
    style: {
      components: "grain " + grain + (grain === "unit" ? ": the form is split into one instance per field unit (a field with its controls, displays and the bindings it adds), each in its own block of the page function" : ": the whole form is one instance") + " (factory inlined, as it is called once): its slice of the one model, its own reducer (a table of arms by message tag, written out from its ops), template and bindings; the companion is an instance of its own; only generic helpers are shared",
      state: "the form's one record is split into slices: each instance owns, in its closure, the fields of its unit; send(tag, value) runs its reducer arm and schedules that instance's binding list",
      updates: "one patch function per instance, every DOM write skipped when unchanged; derived texts compiled to template literals; batched in a microtask",
      crossUnit: "a binding that reads a field of another unit reads that instance's slice from the frame's registry in patch, and the reader watches the instance (follow); the companion reads the form the same way",
      combinedButtons: "a combined button that writes a field of another unit: its own arm for its fields, and a message of its own for the other unit, sent after it (forward)",
      externalEvents: "serverSet/snapshot of the form send every instance its Load message (it picks its own fields), the companion's are set; notify sends the feed's unit its Notify message; tick calls the instances of a shared running set, each subscribing while its gate is on",
      lists: "runtime keyed list by item.id: patch changed rows, one forward placement pass when order or membership changes",
      dom: "one static template per instance (a run of sibling nodes, trailing end tags left out), parsed in a fragment appended to the form, elements addressed by document order; one template per list row, cloned per new item",
      conditionals: "node in the template; while hidden, an empty text node holds its place",
      events: "tag 0 is Load; the template's controls take tags 1, 2, … in document order (then each row's controls), attached by position by the runtime's wire; messages are sent as send(tag, value); number inputs send valueAsNumber and the reducer takes integers within range only",
      build: "Vite production build, no framework plugin, hidden source maps",
    },
  };
}
