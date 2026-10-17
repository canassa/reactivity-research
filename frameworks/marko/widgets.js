// Marko 6 tags for the generated widgets of `unique-components` and `big-component`, which share
// one vocabulary (fields, messages made of ops, a view tree, typed expressions). Each widget is
// written as its own tag from its description alone; nothing is interpreted at runtime.
//
// Shared by the two scenarios' Marko emitters (a scenario's README fixes the vocabulary).
//
// `state` is where the state lives:
// - "local": every tag owns its fields as `<let>`s and `<return>`s an API (the fields other
//   widgets read, `set`, `tick`, `notify`); the root names the tags with tag variables and routes
//   the external events through the APIs (see `localRoot` for the 6.4.6 compiler trap).
// - "root": the root template owns every field and binds it down with `:=` to a controllable
//   `<let/x:=input.x>` in the tag (the cheat sheet's pattern for state a parent owns); the external
//   events assign the root's `<let>`s.
//
// `layout` (root state only) is the shape of one widget's state:
// - "fields": one `<let>` per field, one `:=` binding per field;
// - "object": one `<let>` per widget holding `{ field, … }`, one `:=` binding per widget, and
//   handlers that replace the object (`state = { ...state, hours: 8 }`).
//
// `inline` names a widget written in the root template itself, with no tag and no binding.

import { literal, pascal } from "./source.js";

// Names the generated code uses itself; a field must not take them.
const RESERVED = new Set(["input", "item", "Math", "nextId", "static", "msg", "state", "next", "content", "widgets", "id", "other", "text", "n"]);

const COMPARE = { "==": "===", "!=": "!==", "<": "<", "<=": "<=", ">": ">", ">=": ">=" };

// The layout being written (set by widgetFiles) and the name the widget's state object has in
// the template being written ("state" in a tag, the widget id when written in the root).
const cfg = { object: false, sv: "state" };

// A widget's own field as an expression.
const own = (name) => (cfg.object ? `${cfg.sv}.${name}` : name);

// The spec's typed expression as JavaScript.
function expr(e, top = true) {
  const wrap = (code) => (top ? code : `(${code})`);
  const sub = (x) => expr(x, false);
  switch (e[0]) {
    case "f": return own(e[1]);
    case "w": return `input.${e[1]}${pascal(e[2])}`;
    case "k": return JSON.stringify(e[1]);
    case "+": return wrap(`${sub(e[1])} + ${sub(e[2])}`);
    case "-": return wrap(`${sub(e[1])} - ${sub(e[2])}`);
    case "count": case "len": return `${sub(e[1])}.length`;
    case "done": return `${sub(e[1])}.filter((item) => item.done).length`;
    case "left": return `${sub(e[1])}.filter((item) => !item.done).length`;
    case "has": return `${sub(e[1])}.includes(${JSON.stringify(e[2])})`;
    case "and": return wrap(`${sub(e[1])} && ${sub(e[2])}`);
    case "or": return wrap(`${sub(e[1])} || ${sub(e[2])}`);
    case "not": return `!${sub(e[1])}`;
    case "if": return wrap(`${sub(e[1])} ? ${sub(e[2])} : ${sub(e[3])}`);
  }
  if (COMPARE[e[0]]) return wrap(`${sub(e[1])} ${COMPARE[e[0]]} ${sub(e[2])}`);
  throw new Error(`unknown expression ${JSON.stringify(e)}`);
}

// Every [widget, field] pair an expression reads from another widget.
function foreignReads(e, out) {
  if (!Array.isArray(e)) return;
  if (e[0] === "w") out.add(`${e[1]}.${e[2]}`);
  else if (e[0] !== "k") for (const x of e.slice(1)) foreignReads(x, out);
}

function viewReads(n, out) {
  for (const k of ["disabled", "cond"]) if (n[k]) foreignReads(n[k], out);
  if (n.invalid) foreignReads(n.invalid.when, out);
  for (const p of [...(n.parts || []), ...(n.text || [])]) if (typeof p !== "string") foreignReads(p, out);
  for (const c of n.children || []) viewReads(c, out);
}

// The foreign fields a widget reads: [{ widget, field }] in a stable order.
export function readsOf(w) {
  const out = new Set();
  for (const n of w.view) viewReads(n, out);
  return [...out].map((s) => { const [widget, field] = s.split("."); return { widget, field }; });
}

// The attribute a reader receives a foreign field in.
export const readAttr = ({ widget, field }) => `${widget}${pascal(field)}`;

// Text in a template: the placeholder and markup characters escaped.
const text = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\$/g, "\\$");
const parts = (ps) => ps.map((p) => (typeof p === "string" ? text(p) : `\${${expr(p)}}`)).join("");

// ---------------------------------------------------------------------------------------------
// Messages as handler bodies

// How a handler reads and writes fields: `get(name)` is the expression, `set(name, value)` the
// statement.
function accessors(mode) {
  if (mode === "next") return { get: (n) => `next.${n}`, set: (n, v) => `next.${n} = ${v};` };
  if (mode === "spread") return { get: (n) => `${cfg.sv}.${n}`, set: (n, v) => `${cfg.sv} = { ...${cfg.sv}, ${n}: ${v} };` };
  return { get: (n) => n, set: (n, v) => `${n} = ${v};` };
}

// The statements of one op, and the fields it reads and writes.
function opStatements(w, op, { get, set }) {
  const [kind, name] = op;
  const f = w.fields.find((x) => x.name === name);
  switch (kind) {
    case "add": {
      const k = op[2];
      return { reads: [name], writes: [name], code: [set(name, `Math.min(${f.max}, Math.max(${f.min}, ${get(name)} ${k < 0 ? "-" : "+"} ${Math.abs(k)}))`)] };
    }
    case "set": return { reads: [], writes: [name], code: [set(name, JSON.stringify(op[2]))] };
    case "toggle": return { reads: [name], writes: [name], code: [set(name, `!${get(name)}`)] };
    case "reset": return { reads: [], writes: [name], code: [set(name, literal(f.initial))] };
    case "cycle": return { reads: [name], writes: [name], code: [set(name, `${name}Options[(${name}Options.indexOf(${get(name)}) + 1) % ${f.options.length}]`)] };
    case "push": {
      const draft = op[2];
      const item = `{ id: nextId(${get(name)}), text: ${get(draft)}.trim()${f.checkable ? ", done: false" : ""} }`;
      return {
        reads: [name, draft],
        writes: [name, draft],
        code: [`if (${get(draft)}.trim()) {`, `  ${set(name, `${get(name)}.concat(${item})`)}`, `  ${set(draft, '""')}`, `}`],
      };
    }
    case "pushText":
      return { reads: [name], writes: [name], code: [set(name, `${get(name)}.concat({ id: nextId(${get(name)}), text: ${JSON.stringify(op[2])}${f.checkable ? ", done: false" : ""} })`)] };
    case "pop": return { reads: [name], writes: [name], code: [set(name, `${get(name)}.slice(0, -1)`)] };
    case "shift": return { reads: [name], writes: [name], code: [set(name, `${get(name)}.slice(1)`)] };
    case "clear": return { reads: [], writes: [name], code: [set(name, "[]")] };
    case "clearDone": return { reads: [name], writes: [name], code: [set(name, `${get(name)}.filter((item) => !item.done)`)] };
  }
  throw new Error(`unknown op ${kind}`);
}

// A click message's handler body. Assigning a `<let>` does not change the variable the rest of
// the handler reads, so with one `<let>` per field an op that reads a field an earlier op wrote
// would see the old value: the vocabulary never does that, and the emitter refuses it rather
// than write a wrong handler. With one object per widget, a handler that writes more than one
// field edits a copy (`next`) and assigns it once.
function clickBody(w, m, needs) {
  const count = m.ops.reduce((n, op) => n + opStatements(w, op, accessors("fields")).writes.length, 0);
  const mode = !cfg.object ? "fields" : count === 1 ? "spread" : "next";
  const acc = accessors(mode);
  const written = new Set();
  const lines = mode === "next" ? [`const next = { ...${cfg.sv} };`] : [];
  for (const op of m.ops) {
    const { reads, writes, code } = opStatements(w, op, acc);
    const stale = mode === "fields" && reads.find((r) => written.has(r));
    if (stale) throw new Error(`${w.id}.${m.name}: an op reads ${stale} after an earlier op wrote it`);
    for (const x of writes) written.add(x);
    if (code.some((l) => l.includes("nextId("))) needs.nextId = true;
    lines.push(...code);
  }
  const pending = pendingFields(w);
  for (const x of written) if (pending.has(x)) lines.push(`${x}Pending = null;`);
  if (mode === "next") lines.push(`${cfg.sv} = next;`);
  return lines;
}

// A handler that sets one field to a value.
function setLine(name, value) {
  return cfg.object ? `${cfg.sv} = { ...${cfg.sv}, ${name}: ${value} };` : `${name} = ${value};`;
}

// `onClick() { … }`, one statement per line when there are several.
function handlerAttr(name, params, lines, pad) {
  if (lines.length === 1) return ` ${name}(${params}) { ${lines[0].replace(/;$/, "")} }`;
  return ` ${name}(${params}) {\n${lines.map((l) => `${pad}  ${l}`).join("\n")}\n${pad}}`;
}

// The two-way binding of a control to a field: `:=` for a field of its own, a value and its
// change handler for a member of the widget's state object.
function bind(attr, change, name, pad) {
  if (!cfg.object) return ` ${attr}:=${name}`;
  return ` ${attr}=${own(name)}${handlerAttr(change, "value", [setLine(name, "value")], pad)}`;
}

// ---------------------------------------------------------------------------------------------
// View

function view(w, n, ind, needs) {
  const pad = "  ".repeat(ind);
  const msg = (name) => w.messages.find((m) => m.name === name);
  const field = (name) => w.fields.find((f) => f.name === name);
  switch (n.el) {
    case "text":
      return [`${pad}<${n.tag}>${parts(n.parts)}</${n.tag}>`];
    case "button": {
      const m = msg(n.msg);
      const disabled = n.disabled ? ` disabled=(${expr(n.disabled)})` : "";
      const click = handlerAttr("onClick", "", clickBody(w, m, needs), pad);
      return [`${pad}<button data-role="${n.msg}"${disabled}${click}>${parts(n.text)}</button>`];
    }
    case "input": {
      const f = field(msg(n.msg).field);
      let attrs;
      if (f.type === "int") {
        // An edit that is not a valid number is kept on screen and not committed.
        needs.pending.add(f.name);
        const change = handlerAttr("valueChange", "text", [
          `const n = +text;`,
          `if (text !== "" && Number.isInteger(n) && n >= ${f.min} && n <= ${f.max}) {`,
          `  ${setLine(f.name, "n")}`,
          `  ${f.name}Pending = null;`,
          `} else {`,
          `  ${f.name}Pending = { over: ${own(f.name)}, text };`,
          `}`,
        ], pad);
        attrs = `type="number" data-role="${n.msg}" value=${f.name}Draft${change}`;
      } else {
        attrs = `type="text" data-role="${n.msg}"${n.placeholder ? ` placeholder=${JSON.stringify(n.placeholder)}` : ""}${bind("value", "valueChange", f.name, pad)}`;
      }
      const lines = [];
      if (n.label) lines.push(`${pad}<label>${text(n.label)}<input ${attrs}></label>`);
      else lines.push(`${pad}<input ${attrs}>`);
      if (n.invalid) {
        lines.push(`${pad}<if=(${expr(n.invalid.when)})>`);
        lines.push(`${pad}  <p data-role="${n.msg}Error">${text(n.invalid.message)}</p>`);
        lines.push(`${pad}</if>`);
      }
      return lines;
    }
    case "check": {
      const m = msg(n.msg);
      return [`${pad}<label><input type="checkbox" data-role="${n.msg}"${bind("checked", "checkedChange", m.field, pad)}>${text(n.label)}</label>`];
    }
    case "select": {
      const f = field(msg(n.msg).field);
      const options = f.options.map((o) => `${pad}  <option value=${JSON.stringify(o)}>${text(o)}</option>`);
      const select = [`${pad}<select data-role="${n.msg}"${bind("value", "valueChange", f.name, pad)}>`, ...options, `${pad}</select>`];
      if (!n.label) return select;
      return [`${pad}<label>`, `${pad}  ${text(n.label)}`, ...select.map((l) => "  " + l), `${pad}</label>`];
    }
    case "list": {
      const list = n.field;
      const item = [`${pad}    <li data-key=item.id data-role="${list}Item">`];
      if (n.check) {
        const toggle = handlerAttr("checkedChange", "", [setLine(list, `${own(list)}.map((other) => (other.id === item.id ? { ...other, done: !other.done } : other))`)], pad + "      ");
        item.push(`${pad}      <input type="checkbox" data-role="${n.check}" checked=item.done${toggle}>`);
      }
      item.push(`${pad}      <span>\${item.text}</span>`);
      if (n.remove) {
        const remove = handlerAttr("onClick", "", [setLine(list, `${own(list)}.filter((other) => other.id !== item.id)`)], pad + "      ");
        item.push(`${pad}      <button data-role="${n.remove}"${remove}>${text(n.removeText)}</button>`);
      }
      item.push(`${pad}    </li>`);
      return [`${pad}<${n.tag}>`, `${pad}  <for|item| of=${own(list)} by="id">`, ...item, `${pad}  </for>`, `${pad}</${n.tag}>`];
    }
    case "when":
      return [
        `${pad}<if=(${expr(n.cond)})>`,
        `${pad}  <${n.tag}>`,
        ...n.children.flatMap((c) => view(w, c, ind + 2, needs)),
        `${pad}  </${n.tag}>`,
        `${pad}</if>`,
      ];
    case "group":
      return [`${pad}<${n.tag}>`, ...n.children.flatMap((c) => view(w, c, ind + 1, needs)), `${pad}</${n.tag}>`];
  }
  throw new Error(`unknown view node ${n.el}`);
}

// ---------------------------------------------------------------------------------------------
// One widget's tag

// A list copied out of a message, so no dispatched object ends up in the state.
const copy = (f, source) => (f.type === "list" ? `${source}.map((item) => ({ ...item }))` : source);

// The int fields with a number input: each keeps a pending edit, which every write to the field
// clears (the commit of a valid edit, the external events, the buttons).
function pendingFields(w) {
  const out = new Set();
  const walk = (n) => {
    if (n.el === "input") {
      const field = w.messages.find((m) => m.name === n.msg).field;
      if (w.fields.find((x) => x.name === field).type === "int") out.add(field);
    }
    for (const c of n.children || []) walk(c);
  };
  w.view.forEach(walk);
  return out;
}

const timed = (w) => w.fields.filter((f) => f.tick);
const feeds = (w) => w.fields.filter((f) => f.feed);

// The pieces of one widget's template: module-level statements, state declarations (with the
// initial values when the state is declared in the same template, bound from the root otherwise)
// and the section.
function widgetParts(w, ind, { initial, inRoot = false }) {
  for (const f of w.fields) if (RESERVED.has(f.name)) throw new Error(`${w.id}: field name ${f.name} is reserved`);
  cfg.sv = inRoot ? w.id : "state";
  const needs = { pending: new Set() };
  const body = w.view.flatMap((n) => view(w, n, ind + 1, needs));
  const pad = "  ".repeat(ind);
  const statics = [];
  if (needs.nextId) statics.push(`import { nextId } from "${inRoot ? "." : ".."}/list.js";`);
  // The enum options a cycle message steps through.
  for (const f of w.fields) {
    if (f.type === "enum" && w.messages.some((m) => m.kind === "click" && m.ops.some((op) => op[0] === "cycle" && op[1] === f.name))) {
      statics.push(`static const ${f.name}Options = ${literal(f.options)};`);
    }
  }
  let lets;
  if (cfg.object) lets = [inRoot ? `<let/${w.id}=${literal(initial)}>` : `<let/state:=input.state>`];
  else lets = w.fields.map((f) => (initial ? `<let/${f.name}=${literal(initial[f.name])}>` : `<let/${f.name}:=input.${f.name}>`));
  for (const name of needs.pending) {
    lets.push(`<let/${name}Pending=null>`, `<const/${name}Draft=(${name}Pending?.over === ${own(name)} ? ${name}Pending.text : ${own(name)})>`);
  }
  const section = [`${pad}<section data-key="${w.id}" data-role="widget">`, `${pad}  <h2>${text(w.label)}</h2>`, ...body, `${pad}</section>`];
  return { statics, lets, section };
}

// The members of a widget's API for the external events, over its fields (the object that a
// local-state tag `<return>`s, or that the root builds for a widget written in it): the fields
// other widgets read, `set`, and `tick` and `notify` where the widget has them.
function apiMembers(w, exposed) {
  const members = [...exposed];
  const pending = pendingFields(w);
  const clear = (f) => (pending.has(f.name) ? `\n    ${f.name}Pending = null;` : "");
  members.push(`set(next) {\n${w.fields.map((f) => `    ${f.name} = ${copy(f, `next.${f.name}`)};${clear(f)}`).join("\n")}\n  }`);
  if (timed(w).length) {
    members.push(`tick() {\n${timed(w).map((f) => (pending.has(f.name) ? `    if (${f.tickWhen}) {\n      ${f.name} = Math.min(${f.max}, ${f.name} + ${f.tick});\n      ${f.name}Pending = null;\n    }` : `    if (${f.tickWhen}) ${f.name} = Math.min(${f.max}, ${f.name} + ${f.tick});`)).join("\n")}\n  }`);
  }
  const fd = feeds(w);
  if (fd.length === 1) {
    members.push(`notify(field, item) {\n    if (field === "${fd[0].name}") ${fd[0].name} = ${fd[0].name}.concat({ ...item });\n  }`);
  } else if (fd.length > 1) {
    members.push(`notify(field, item) {\n    switch (field) {\n${fd.map((f) => `      case "${f.name}":\n        ${f.name} = ${f.name}.concat({ ...item });\n        break;`).join("\n")}\n    }\n  }`);
  }
  return members;
}

// The fields of each widget that other widgets read: widget id to field names.
function readFields(spec) {
  const out = {};
  for (const w of spec.widgets) for (const r of readsOf(w)) (out[r.widget] ??= new Set()).add(r.field);
  return out;
}

// A tag. With `initial` (local state) it owns its fields and `<return>`s its API; without, its
// fields are bound from the root.
export function widgetTag(w, { initial, exposed = [] } = {}) {
  const { statics, lets, section } = widgetParts(w, 0, { initial });
  const api = initial ? `\n<return={\n  ${apiMembers(w, exposed).join(",\n  ")},\n}>\n` : "";
  return `${statics.length ? statics.join("\n") + "\n\n" : ""}${lets.join("\n")}

${section.join("\n")}
${api}`;
}

// ---------------------------------------------------------------------------------------------
// The root template


// `tagName(w)` names a widget's tag; `pageRole` is the page root's data-role. `inline` is the id
// of a widget written in the root template itself (no tag, its state declared where it is used).
export function rootTemplate(spec, { tagName, pageRole, inline = null, local = false }) {
  const widgets = spec.widgets;
  const exposedFields = readFields(spec);
  const obj = cfg.object;
  // The root's <let> for a widget's field (fields layout) or for the widget (object layout).
  const name = (w, f) => {
    const field = typeof f === "string" ? f : f.name;
    if (obj) return `${w.id}.${field}`;
    return w.id === inline ? field : `${w.id}${pascal(field)}`;
  };
  const lets = widgets.flatMap((w) => {
    if (w.id === inline) return [];
    const init = spec.initialState.widgets[w.id];
    if (local) return [];
    return obj ? [`<let/${w.id}=${literal(init)}>`] : w.fields.map((f) => `<let/${w.id}${pascal(f.name)}=${literal(init[f.name])}>`);
  });
  let inlined = null;
  if (inline) {
    inlined = widgetParts(widgets.find((x) => x.id === inline), 1, { initial: spec.initialState.widgets[inline], inRoot: true });
    lets.unshift(...inlined.statics, ...inlined.lets);
  }
  const elements = widgets.map((w) => {
    if (w.id === inline) return inlined.section.join("\n");
    if (local) {
      const read = readsOf(w).map((r) => ` ${readAttr(r)}=${r.widget === inline ? r.field : `${r.widget}.${r.field}`}`).join("");
      return `  <${tagName(w)}/${w.id}${read}/>`;
    }
    const bound = obj ? ` state:=${w.id}` : w.fields.map((f) => ` ${f.name}:=${name(w, f)}`).join("");
    const read = readsOf(w).map((r) => ` ${readAttr(r)}=${name({ id: r.widget }, r.field)}`).join("");
    return `  <${tagName(w)}${bound}${read}/>`;
  });

  // External events: assignments to the root's <let>s, written out per widget.
  const timedWidgets = widgets.filter((w) => timed(w).length);
  const feedWidgets = widgets.filter((w) => feeds(w).length);
  const setWidget = widgets.map((w) => {
    const body = obj
      ? `        ${w.id} = { ${w.fields.map((f) => `${f.name}: ${copy(f, `state.${f.name}`)}`).join(", ")} };\n`
      : w.fields.map((f) => `        ${name(w, f)} = ${copy(f, `state.${f.name}`)};\n`).join("");
    return `      case "${w.id}":\n${body}        break;`;
  });
  const cases = [`    case "serverSet":\n      setWidget(msg.widget, msg.state);\n      break;`];
  if (timedWidgets.length) {
    const tick = (w) => (obj
      ? `      ${w.id} = { ...${w.id}, ${timed(w).map((f) => `${f.name}: ${name(w, f.tickWhen)} ? Math.min(${f.max}, ${name(w, f)} + ${f.tick}) : ${name(w, f)}`).join(", ")} };\n`
      : timed(w).map((f) => `      if (${name(w, f.tickWhen)}) ${name(w, f)} = Math.min(${f.max}, ${name(w, f)} + ${f.tick});\n`).join(""));
    cases.push(`    case "tick":\n${timedWidgets.map(tick).join("")}      break;`);
  }
  if (feedWidgets.length) {
    const append = (w, f, pad) => `${pad}${obj ? `${w.id} = { ...${w.id}, ${f.name}: ${name(w, f)}.concat({ ...msg.item }) };` : `${name(w, f)} = ${name(w, f)}.concat({ ...msg.item });`}\n`;
    const one = (w) => (feeds(w).length === 1
      ? append(w, feeds(w)[0], "        ")
      : `        switch (msg.field) {\n${feeds(w).map((f) => `          case "${f.name}":\n${append(w, f, "            ")}            break;`).join("\n")}\n        }\n`);
    cases.push(`    case "notify":\n      switch (msg.widget) {\n${feedWidgets.map((w) => `        case "${w.id}":\n${one(w)}          break;`).join("\n")}\n      }\n      break;`);
  }
  cases.push(`    case "snapshot":\n      for (const [id, state] of Object.entries(msg.state.widgets)) setWidget(id, state);\n      break;`);

  if (local) return localRoot(spec, { widgets, lets, elements, inline, inlined, pageRole, exposedFields });

  return `${lets.join("\n")}

<div data-role="${pageRole}">
${elements.join("\n")}
</div>

// External events: the root's tag variable, which the adapter calls with each message.
<return=(msg) => {
  function setWidget(id, state) {
    switch (id) {
${setWidget.join("\n")}
    }
  }
  switch (msg.type) {
${cases.join("\n")}
  }
}>
`;
}

// Local state: the root names each tag with a tag variable and routes the external events through
// the widgets' APIs. The router sits in the dashboard element after the widgets: a function at the
// template root would read their tag variables through hoisted getters, which Marko 6.4.6
// compiles without the scope they need (see README.md). A widget written in the root gets the
// same API as an object over the root's own `<let>`s.
function localRoot(spec, { widgets, lets, elements, inline, inlined, pageRole, exposedFields }) {
  const timedWidgets = widgets.filter((w) => timed(w).length);
  const feedWidgets = widgets.filter((w) => feeds(w).length);
  const cases = [`      case "serverSet":\n        widgets[msg.widget]?.set(msg.state);\n        break;`];
  if (timedWidgets.length) cases.push(`      case "tick":\n${timedWidgets.map((w) => `        widgets.${w.id}.tick();\n`).join("")}        break;`);
  if (feedWidgets.length) cases.push(`      case "notify":\n        widgets[msg.widget]?.notify?.(msg.field, msg.item);\n        break;`);
  cases.push(`      case "snapshot":\n        for (const [id, state] of Object.entries(msg.state.widgets)) widgets[id]?.set(state);\n        break;`);
  const inlineApi = inline
    ? `  <const/${inline}={\n    ${apiMembers(widgets.find((x) => x.id === inline), []).join(",\n    ").replace(/\n  (?=\S|\s)/g, "\n    ")},\n  }>\n`
    : "";
  void exposedFields;
  return `${lets.join("\n")}

<div data-role="${pageRole}">
${elements.join("\n")}
${inlineApi}  <const/widgets={ ${widgets.map((w) => w.id).join(", ")} }>
  // External events, through the widgets' APIs.
  <const/receive=(msg) => {
    switch (msg.type) {
${cases.join("\n")}
    }
  }>
</div>

// The root's tag variable, which the adapter calls with each message.
<return=receive>
`;
}

export function widgetFiles(spec, { tagName, pageRole, inline = null, layout = "fields", state = "root" }) {
  const local = state === "local";
  if (local && layout === "object") throw new Error("local state has no object layout");
  cfg.object = layout === "object";
  const root = rootTemplate(spec, { tagName, pageRole, inline, local });
  const exposed = readFields(spec);
  const files = { "src/app.marko": root };
  let usesNextId = root.includes("nextId");
  for (const w of spec.widgets) {
    if (w.id === inline) continue;
    const source = widgetTag(w, local ? { initial: spec.initialState.widgets[w.id], exposed: [...(exposed[w.id] ?? [])] } : {});
    files[`src/tags/${tagName(w)}.marko`] = source;
    usesNextId ||= source.includes("nextId");
  }
  if (usesNextId) {
    files["src/list.js"] = `// The id for a new list item: one more than the largest.
export function nextId(items) {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}
`;
  }
  return files;
}
