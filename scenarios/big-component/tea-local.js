// big-component as tea-local, a prototype strategy (frameworks/tea-local/README.md): what an
// ideal compiler would emit from a TEA source of one big settings form, with local message
// routing.
//
// The problem this scenario poses to tea-local: the strategy re-runs the whole binding list of
// an instance after each of its messages. If the form were one instance, every message would
// re-run all of its ~N bindings (O(N) per event, a failed locality check). So the form is
// split the way an expert TEA developer splits a big form: **one component instance per
// fieldset** (a group of 2-5 units), the unit of the layout the form already has.
//
// Style (recorded in every generated app's rr.json):
// - One model, split into slices. The form's state is one record; each fieldset instance owns the
//   slice of the fields whose first appearance in the view is in that fieldset, in its closure.
//   Its reducer (a table of arms, one per message, written out from the message's kind and ops)
//   only ever touches its own slice. The companion is an instance of its own, as in
//   unique-components.
// - A fieldset block is what its factory would be, inlined (it is called once): its slice, its
//   reducer, its static template and its binding list (`patch`, one write per binding, each
//   skipped when unchanged), the DOM built once and wired by position. After a message only that
//   fieldset's patch runs, plus the patches of the readers that watch it.
// - Bindings that cross fieldsets read the other fieldset's current slice from the frame's
//   registry (`groups[3].m`) in `patch`, and the reader watches it (`follow`), as a summary
//   watches its sources in the sibling scenarios. A section total, which reads fields of
//   several fieldsets, is a reader instance without a model of its own. Every field is read by
//   a bounded number of bindings (the scenario's window), so the readers of one fieldset are
//   too, and an event costs a constant number of patches however big the form is.
// - A combined button (it writes its own field and an earlier one) that crosses fieldsets is a
//   message to two instances, as a parent routing a child's message would be: the button's
//   fieldset runs its arm for its own fields, and sends the other fieldset a message of its own
//   (an extra constructor on that fieldset, `forward`). A reducer never does the sending.
// - Every fieldset has `Load` as message 0: it takes the whole component's state, picks its own
//   fields and replaces its slice. A `serverSet` or `snapshot` of the form sends it to each
//   fieldset (the global events, O(N) by nature). Nothing else touches the slices as a whole, so
//   no reducer ever copies the whole form's state.
// - External events: `tick` calls the fieldsets in the shared `running` set (a fieldset with a
//   time-driven int subscribes while its gate is on); `notify` sends the feed's fieldset its
//   Notify message.
// - Keyed lists through the runtime's `list`. Conditional content (`when`, validation errors)
//   is in the template; while hidden, an empty text node holds its place.
// - A message is sent as its constructor's tag and its argument, if any: `send(tag, value)`, the
//   reducer is a jump table, controls take tags 1, 2, … in document order (then each list row's
//   controls), attached by position by the runtime's `wire`; a number input sends its value as
//   a number and its reducer arm takes only an integer within [min, max].

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


// A field read: the instance's own model, or another fieldset's slice (`m3.field`), which the
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
// The form's layout: sections of fieldsets, and which fieldset owns which field.

// [{ title, groups: [{ node, index }], total }] from the form's view.
function layout(form) {
  let index = 0;
  return form.view.map((sec) => {
    if (sec.el !== "group" || sec.tag !== "div" || sec.children[0].el !== "text") throw new Error("unexpected section");
    const kids = sec.children.slice(1);
    const total = kids.length && kids.at(-1).el === "text" ? kids.pop() : null;
    const groups = kids.map((g) => {
      if (g.el !== "group" || g.tag !== "fieldset") throw new Error("unexpected group");
      return { node: g, index: index++ };
    });
    return { title: sec.children[0], groups, total };
  });
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

// Plan every fieldset: its fields, its messages (the ones its controls send, in the order the
// template's controls take tags, after the Load message 0), the messages other fieldsets send it
// for their combined buttons, and its tags.
function plan(spec, form, secs) {
  const groups = secs.flatMap((s) => s.groups);
  const owner = new Map();
  for (const g of groups) {
    const seen = [];
    touches(form, g.node, seen);
    for (const f of seen) if (!owner.has(f)) owner.set(f, g.index);
  }
  for (const f of form.fields) {
    if (!owner.has(f.name)) throw new Error(`field ${f.name} is not in the view`);
    if (f.tickWhen && owner.get(f.tickWhen) !== owner.get(f.name)) throw new Error(`${f.name}: gate in another fieldset`);
  }
  const init = spec.initialState.widgets[form.id];
  for (const g of groups) {
    g.fields = form.fields.filter((f) => owner.get(f.name) === g.index);
    g.init = Object.fromEntries(g.fields.map((f) => [f.name, init[f.name]]));
    g.sent = []; // the messages whose control is in this fieldset
    g.recv = []; // messages from other fieldsets' combined buttons
  }
  // Which fieldset's control sends each message.
  const home = new Map();
  for (const g of groups) {
    for (const name of controlsOf(g.node.children)) {
      if (home.has(name)) throw new Error(`${name}: a message sent by two controls`);
      home.set(name, g.index);
    }
  }
  for (const m of form.messages) {
    if (!home.has(m.name)) throw new Error(`${m.name}: no control`);
    const g = groups[home.get(m.name)];
    if (m.kind !== "click") {
      if (owner.get(m.field) !== g.index) throw new Error(`${m.name}: writes another fieldset's field`);
      g.sent.push(m);
      continue;
    }
    const by = new Map();
    for (const op of m.ops) {
      if (op[0] === "push" && owner.get(op[1]) !== owner.get(op[2])) throw new Error(`${m.name}: push across fieldsets`);
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
    g.messages = [{ name: "load", kind: "load" }, ...messageOrder(g.node.children, g.sent)];
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
const FRAME = ["add", "group", "groups", "follow", "forward", "running", "row", "place", "nextId", "subscribe"];

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

// One fieldset: a block of the page function.
function groupBlock(spec, form, p, g) {
  const w = { fields: form.fields, messages: g.messages };
  const cx = newCx({ group: g.index, groupOf: p.owner });
  compileView(w, g.node.children, cx);
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
  const fn = [`{`, `  // group ${g.index}`];
  fn.push(`  const patch = () => {`);
  if (cx.own) fn.push(`    const m = self.m;`);
  for (const s of sources) fn.push(`    const m${s} = groups[${s}].m;`);
  fn.push(...cx.patch.map((l) => "    " + l));
  fn.push(`  };`);
  if (sources.length) fn.push(`  follow(patch, ${sources.join(", ")});`);
  fn.push(`  // type Msg = ${types.join(" | ")}`);
  fn.push(`  const self = instance(${lit(g.init)}, [`, ...cases.map((c) => `    ${c.replace(/\n/g, "\n    ")},`), `  ], patch);`);
  cx.wire.forEach((t, i) => { if (t !== i + 1) throw new Error(`group ${g.index}: control tags out of order`); });
  // A combined button that also writes another fieldset sends it a message of its own.
  for (const m of g.messages) {
    for (const f of m.forwards ?? []) {
      fn.push(`  forward(self, ${g.messages.indexOf(m)}, ${f.to}, ${p.groups[f.to].recvBase + f.recv});`);
    }
  }
  fn.push(`  const e = group(s, ${q(trim("<fieldset>" + cx.html))}, self);`);
  fn.push(...cx.create);
  if (g.timed.length) fn.push(`  subscribe(self, ${g.tickTag}, (m) => ${gate});`);
  fn.push(`}`);
  return fn.join("\n");
}

// A section total: a reader of several fieldsets with no model of its own.
function totalBlock(p, sec) {
  const cx = newCx({ group: null, groupOf: p.owner });
  const { code } = textCode(sec.total.parts, cx);
  const sources = [...cx.sources].sort((a, b) => a - b);
  return [
    `{`,
    `  const p = add(s, "<p> ");`,
    `  const patch = () => {`,
    ...sources.map((s) => `    const m${s} = groups[${s}].m;`),
    `    setText(p, ${code});`,
    `  };`,
    `  follow(patch, ${sources.join(", ")});`,
    `}`,
  ].join("\n");
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
  for (const s of sources) fn.push(`    const m${s} = groups[${s}].m;`);
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

// The fieldset instances in page order (group 0 first), for the external events, the readers
// that cross fieldsets and the messages between them.
export const groups = [];

// Insert markup as the last child of \`parent\` (trailing end tags may be left out) and return it.
export function add(parent, html) {
  parent.insertAdjacentHTML("beforeend", html);
  return parent.lastChild;
}

// A fieldset: its template inserted in its section, registered, its controls wired to the
// messages 1, 2, 3, ... (message 0 is Load). Returns the template's elements in document order.
export function group(parent, html, self) {
  groups.push(self);
  return wire(add(parent, html), self, 1);
}

// A reader of the fieldsets \`sources\` (their indexes): its patch runs after the first render and
// whenever one of them changes.
export function follow(patch, ...sources) {
  schedule(patch);
  for (const source of sources) groups[source].watch(patch);
}

// A combined button that also writes another fieldset: after its own message, the message
// \`otherTag\` goes to fieldset \`other\`.
export function forward(self, tag, other, otherTag) {
  const { send } = self;
  self.send = (t, value) => {
    send(t, value);
    if (t === tag) groups[other].send(otherTag);
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

// The tick handlers of the fieldsets whose time-driven gate is on (their subscription).
export const running = new Set();

// A time-driven fieldset's subscription, as in Elm's \`subscriptions\`: after every change to its
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
  const [form, companion] = spec.widgets;
  if (spec.widgets.length !== 2 || form.id !== "w1" || companion.id !== "w2") throw new Error("expected the form w1 and its companion w2");
  const secs = layout(form);
  const p = plan(spec, form, secs);
  const files = {
    ...templateFiles({ name: "big-component", title: "Big component" }),
    "src/widgets/frame.js": FRAME_FILE,
  };
  const sections = secs.map((sec) => {
    const inner = sec.groups.map((g) => groupBlock(spec, form, p, g));
    if (sec.total) inner.push(totalBlock(p, sec));
    const title = sec.title;
    const html = `<div><${title.tag}>${esc(title.parts.join(""))}</${title.tag}>`;
    return `{\n  const s = add(form, ${q(trim(html))});\n${indent(inner.join("\n"))}\n}`;
  });
  const timed = p.groups.some((g) => g.timed.length);
  const feedGroup = p.groups.find((g) => g.feed);
  const companionCode = companionBlock(spec, p, companion);
  const code = sections.join("\n") + companionCode;
  const used = (names) => names.filter((h) => h === "groups" || (h === "running" && timed) || new RegExp(`\\b${h}\\(`).test(code));
  files["src/app.js"] = `import { ${used(RUNTIME).join(", ")} } from "./runtime.js";
import { ${used(FRAME).join(", ")} } from "./widgets/frame.js";

export function App(root) {
  root.insertAdjacentHTML("beforeend", "<div data-role=page>");
  return page(root.lastChild);
}

// The form's fieldsets, section by section in page order, then the companion and the routing of
// external events.
function page(main) {
  let companion;
  const form = add(main, ${q(trim("<section data-key=w1 data-role=widget><h2>" + esc(form.label) + "</h2>"))});
${indent(sections.join("\n"))}
${indent(companionCode)}

  return {
    // External events, routed to the instances they concern.
    receive(msg) {
      switch (msg.type) {
        case "serverSet":
          if (msg.widget === "w2") companion.set(msg.state);
          else for (const g of groups) g.send(0, msg.state);
          break;
${timed ? `        case "tick":
          for (const tick of running) tick();
          break;
` : ""}${feedGroup ? `        case "notify":
          groups[${feedGroup.index}].send(${feedGroup.notifyTag}, msg.item);
          break;
` : ""}        case "snapshot":
          for (const g of groups) g.send(0, msg.state.widgets.w1);
          companion.set(msg.state.widgets.w2);
          break;
      }
    },
    dispose() {
${timed ? "      running.clear();\n" : ""}      groups.length = 0;
      main.remove();
    },
  };
}
`;
  return {
    files,
    style: {
      components: "the form is split into one instance per fieldset (a group of 2-5 units), each in its own block of the page function (factory inlined, as it is called once): its slice of the one model, its own reducer (a table of arms by message tag, written out from its ops), template and bindings; the companion is an instance of its own; only generic helpers are shared",
      state: "the form's one record is split into slices: each fieldset instance owns, in its closure, the fields whose first appearance in the view is in that fieldset; send(tag, value) runs its reducer arm and schedules that instance's binding list",
      updates: "one patch function per instance, every DOM write skipped when unchanged; derived texts compiled to template literals; batched in a microtask",
      crossFieldset: "a binding that reads a field of another fieldset reads that instance's slice from the frame's registry in patch, and the reader watches the instance (follow); a section total (several fieldsets) is a reader without a model; the companion reads the form the same way",
      combinedButtons: "a combined button that writes a field of another fieldset: its own arm for its fields, and a message of its own for the other fieldset, sent after it (forward)",
      externalEvents: "serverSet/snapshot of the form send every fieldset its Load message (the fieldset picks its own fields), the companion's are set; notify sends the feed's fieldset its Notify message; tick calls the fieldsets of a shared running set, each subscribing while its gate is on",
      lists: "runtime keyed list by item.id: patch changed rows, one forward placement pass when order or membership changes",
      dom: "one static template per fieldset (trailing end tags left out), inserted into its section's element by insertAdjacentHTML, elements addressed by document order; one template per list row, cloned per new item",
      conditionals: "node in the template; while hidden, an empty text node holds its place",
      events: "tag 0 is Load; the template's controls take tags 1, 2, … in document order (then each row's controls), attached by position by the runtime's wire; messages are sent as send(tag, value); number inputs send valueAsNumber and the reducer takes integers within range only",
      build: "Vite production build, no framework plugin, hidden source maps",
    },
  };
}
