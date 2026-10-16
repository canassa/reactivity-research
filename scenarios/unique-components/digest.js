// unique-components in digest (prototype): compiled dirty checking, one component per widget.
//
// What a compiler for this approach would produce when every widget is its own component:
// - One function per widget, written out in full from that widget's description: its state as
//   a literal, its template (static HTML, escaped at build time), its handlers (what each
//   message does, as that widget's own statements), its bindings (one closure per dynamic DOM
//   property, the derived expressions compiled to JavaScript) and, for a time-driven field, its
//   tick function.
// - Nothing about a widget is kept as data for a generic routine: no op tables, no view trees,
//   no descriptors. Deleting a widget's function deletes its behaviour. The only data in a
//   widget are its initial values (state literal) and its texts (the template).
// - The runtime (frameworks/digest/runtime-unique.js) is generic: a section built from a
//   template, bind/text/show, a keyed-list reconciler, one delegated click/input listener, and
//   small handler helpers (clamp, next option, add an item).
// - Locality: an event runs only its widget's bindings. A widget that reads others subscribes
//   its binding list to theirs (`dep`, a compile-time fact), external events digest only the
//   widgets they name, and a tick digests only the fields whose gate is on.
// - Nodes are found by their position in the template (`text(3, …)`), resolved once at creation;
//   handlers are given to the controls (buttons, inputs, selects) in document order.
// - Code only where it is used: the receive branches (`tick`, `notify`) exist only if some
//   widget has a time-driven field or a feed list.

import { templateFiles } from "../../frameworks/digest/framework.js";

export const framework = "digest";

export const params = {};

const lit = (v) => JSON.stringify(v);
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);
// Text inside a JavaScript template literal.
const tpl = (s) => s.replace(/[\\`]|\$\{/g, (m) => "\\" + m);

// Where a field lives (state stays plain mutable variables; where is a compile-time fact):
// - a field only its widget uses is a local variable of the widget's function (`$name`);
// - a field another widget reads is a module variable (`w1$name`), so the reader's bindings read
//   it directly;
// - a feed list, which `notify` pushes into by name, is on the widget's record (`O.w1.name`, or
//   `s.name` in its own widget).
let FEED, READ, cur;
const V = (id, name) => (FEED[id].has(name) ? (id === cur ? `s.${name}` : `O.${id}.${name}`)
  : READ[id].has(name) ? `${id}$${name}` : `$${name}`);
const F = (name) => V(cur, name);

const CMP = { "==": "===", "!=": "!==", "<": "<", "<=": "<=", ">": ">", ">=": ">=" };

// A widget's expression as JavaScript. `reads` collects the earlier widgets it reads.
function expr(e, reads) {
  const x = (a) => expr(a, reads);
  switch (e[0]) {
    case "f": return F(e[1]);
    case "w": reads.add(e[1]); return V(e[1], e[2]);
    case "k": return lit(e[1]);
    case "+": return `(${x(e[1])} + ${x(e[2])})`;
    case "-": return `(${x(e[1])} - ${x(e[2])})`;
    case "count": case "len": return `${x(e[1])}.length`;
    case "done": return `${x(e[1])}.filter((i) => i.done).length`;
    case "left": return `${x(e[1])}.filter((i) => !i.done).length`;
    case "has": return `${x(e[1])}.includes(${lit(e[2])})`;
    case "and": return `(${x(e[1])} && ${x(e[2])})`;
    case "or": return `(${x(e[1])} || ${x(e[2])})`;
    case "not": return `!${x(e[1])}`;
    case "if": return `(${x(e[1])} ? ${x(e[2])} : ${x(e[3])})`;
  }
  if (CMP[e[0]]) return `(${x(e[1])} ${CMP[e[0]]} ${x(e[2])})`;
  throw new Error(`digest: unknown expression ${lit(e)}`);
}

// A list of text parts: its static HTML when no part is an expression, else the code of the
// string it computes.
function parts(ps, reads) {
  if (ps.every((p) => typeof p === "string")) return { html: esc(ps.join("")) };
  const code = ps.length === 1 ? expr(ps[0], reads)
    : "`" + ps.map((p) => (typeof p === "string" ? tpl(p) : "${" + expr(p, reads) + "}")).join("") + "`";
  return { html: "", code };
}

// One op of a click message as code: an expression (`e`) or a statement (`s`).
function op(o, fields) {
  const [kind, name] = o;
  const f = fields[name];
  const L = F(name);
  switch (kind) {
    case "add": return { e: `${L} = cl(${L} + ${o[2]}, ${f.min}, ${f.max})` };
    case "set": return { e: `${L} = ${lit(o[2])}` };
    case "toggle": return { e: `${L} = !${L}` };
    case "reset": return { e: `${L} = ${lit(f.initial)}` };
    case "cycle": return { e: `${L} = nx(${lit(f.options)}, ${L})` };
    case "push": return { s: `{ const t = ${F(o[2])}.trim(); if (t) add(${L}${f.checkable ? ", t, false" : ", t"}), ${F(o[2])} = ""; }` };
    case "pushText": return { e: `add(${L}, ${lit(o[2])}${f.checkable ? ", false" : ""})` };
    case "pop": return { e: `${L}.pop()` };
    case "shift": return { e: `${L}.shift()` };
    case "clear": return { e: `${L} = []` };
    case "clearDone": return { e: `${L} = ${L}.filter((i) => !i.done)` };
  }
  throw new Error(`digest: unknown op ${kind}`);
}

// A message's handler, as an arrow function of (element, key of the nearest data-key).
function handler(m, fields) {
  const L = F(m.field);
  switch (m.kind) {
    case "click": {
      const ops = m.ops.map((o) => op(o, fields));
      if (ops.every((o) => o.e)) return `() => ${ops.length === 1 ? ops[0].e : `(${ops.map((o) => o.e).join(", ")})`}`;
      // A single statement is the handler's body as it is.
      if (ops.length === 1) return `() => ${ops[0].s}`;
      return `() => { ${ops.map((o) => o.s ?? o.e + ";").join(" ")} }`;
    }
    case "input": {
      // A number input sends only an integer within the field's range (the README's rule).
      const f = fields[m.field];
      return f.type === "int" ? `(t) => Number.isInteger((t = t.valueAsNumber)) && t >= ${f.min} && t <= ${f.max} && (${L} = t)` : `(t) => ${L} = t.value`;
    }
    case "check": return `(t) => ${L} = t.checked`;
    case "select": return `(t) => ${L} = t.value`;
    // An item control's handler is created with its item and reads `r.i`, the item's current
    // value (the very object in the list).
    case "item": return m.op === "remove" ? `() => ${L} = ${L}.filter((i) => i != r.i)` : `(t) => r.i.done = t.checked`;
  }
  throw new Error(`digest: unknown message kind ${m.kind}`);
}

// The state literal: values as they are; a list's items as texts or [text, done] pairs when
// their ids are 1, 2, …
function initial(f, v) {
  if (f.type !== "list") return lit(v);
  if (v.every((it, i) => it.id === i + 1)) {
    return `L(${lit(v.map((it) => (f.checkable ? [it.text, it.done ? 1 : 0] : it.text)))})`;
  }
  return lit(v);
}

// One widget's function.
function widgetCode(w, init) {
  cur = w.id;
  const fields = Object.fromEntries(w.fields.map((f) => [f.name, f]));
  const msgs = Object.fromEntries(w.messages.map((m) => [m.name, m]));
  const reads = new Set();
  const binds = [];
  let n = 1; // the next element's index in the template (0 is the heading)
  // Bindings name their element by its distance from the previous binding's: they are made in
  // document order.
  let at = 0;
  const ref = (i) => {
    if (i < at) throw new Error("digest: bindings out of document order");
    const d = i - at;
    at = i;
    return d;
  };
  // The handlers of the template's controls (buttons, inputs, selects), in document order.
  const ctl = [];
  const on = (msg) => ctl.push(`${handler(msgs[msg], fields)}, // ${msg}`);

  // A node as template HTML; its bindings go to `binds`, in document order.
  const view = (v) => {
    switch (v.el) {
      case "text": {
        const i = n++, p = parts(v.parts, reads);
        if (p.code) binds.push(`text(${ref(i)}, () => ${p.code});`);
        return `<${v.tag}>${p.html}</${v.tag}>`;
      }
      case "button": {
        const i = n++, p = parts(v.text, reads);
        if (p.code) binds.push(`text(${ref(i)}, () => ${p.code});`);
        on(v.msg);
        if (v.disabled) binds.push(`bind(${ref(i)}, () => ${expr(v.disabled, reads)}, "disabled");`);
        return `<button data-role=${v.msg}>${p.html}</button>`;
      }
      case "input": {
        const f = fields[msgs[v.msg].field];
        if (v.label) n++;
        const i = n++;
        on(v.msg);
        binds.push(`bind(${ref(i)}, () => ${F(f.name)});`);
        let html = f.type === "int" ? `<input type=number data-role=${v.msg}>`
          : `<input type=text data-role=${v.msg}${v.placeholder ? ` placeholder="${esc(v.placeholder)}"` : ""}>`;
        if (v.label) html = `<label>${esc(v.label)}${html}</label>`;
        if (v.invalid) {
          binds.push(`show(${ref(n++)}, () => ${expr(v.invalid.when, reads)});`);
          html += `<p data-role=${v.msg}Error>${esc(v.invalid.message)}</p>`;
        }
        return html;
      }
      case "check": {
        n++;
        const i = n++;
        on(v.msg);
        binds.push(`bind(${ref(i)}, () => ${F(msgs[v.msg].field)}, "checked");`);
        return `<label><input type=checkbox data-role=${v.msg}>${esc(v.label)}</label>`;
      }
      case "select": {
        const f = fields[msgs[v.msg].field];
        if (v.label) n++;
        const i = n++;
        n += f.options.length;
        on(v.msg);
        binds.push(`bind(${ref(i)}, () => ${F(f.name)});`);
        const html = `<select data-role=${v.msg}>${f.options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}</select>`;
        return v.label ? `<label>${esc(v.label)}${html}</label>` : html;
      }
      case "list": {
        const i = n++;
        // The item's bindings refer to its elements by position, and the handlers of its
        // controls (checkbox, remove button) are returned in document order.
        let item = "";
        const inner = [], hs = [];
        if (v.check) {
          item += `<input type=checkbox data-role=${v.check}>`;
          inner.push(`bind(0, () => r.i.done, "checked")`);
          hs.push(handler(msgs[v.check], fields));
        }
        inner.push(`text(${v.check ? 1 : 0}, () => r.i.text)`);
        item += "<span></span>";
        if (v.remove) {
          item += `<button data-role=${v.remove}>${esc(v.removeText)}</button>`;
          hs.push(handler(msgs[v.remove], fields));
        }
        if (hs.length) inner.push(`[${hs.join(", ")}]`);
        binds.push(`list(${ref(i)}, () => ${F(v.field)}, "${v.field}Item", \`${tpl(item)}\`, (r) => (${inner.join(", ")}));`);
        return `<${v.tag}></${v.tag}>`;
      }
      case "when": {
        const i = n++;
        binds.push(`show(${ref(i)}, () => ${expr(v.cond, reads)});`);
        return `<${v.tag}>${v.children.map(view).join("")}</${v.tag}>`;
      }
      case "group": {
        n++;
        return `<${v.tag}>${v.children.map(view).join("")}</${v.tag}>`;
      }
    }
    throw new Error(`digest: unknown view node ${v.el}`);
  };

  const html = `<h2>${esc(w.label)}</h2>` + w.view.map(view).join("");
  const own = w.fields.filter((f) => !FEED[cur].has(f.name) && !READ[cur].has(f.name));
  const read = w.fields.filter((f) => !FEED[cur].has(f.name) && READ[cur].has(f.name));
  const shared = w.fields.filter((f) => FEED[cur].has(f.name));
  const handlers = ctl.map((h) => `    ${h}`).join("\n");
  // External events replace the widget's whole state: its setter assigns every field.
  const set = `(v) => ({ ${w.fields.map((f) => `${f.name}: ${F(f.name)}`).join(", ")} } = v)`;

  const body = [
    ...(own.length ? [`  let ${own.map((f) => `$${f.name} = ${initial(f, init[f.name])}`).join(", ")};`] : []),
    ...read.map((f) => `  ${F(f.name)} = ${initial(f, init[f.name])};`),
    ...(shared.length ? [`  const s = { ${shared.map((f) => `${f.name}: ${initial(f, init[f.name])}`).join(", ")} };`] : []),
    `  widget(\`${tpl(html)}\`, [\n${handlers}\n  ], ${set}${shared.length ? ", s" : ""});`,
    ...binds.map((b) => "  " + b)];
  for (const f of w.fields) {
    if (f.tick) body.push(`  T.push(() => ${F(f.tickWhen)} && (${F(f.name)} = Math.min(${f.max}, ${F(f.name)} + ${f.tick}), run(W.${w.id})));`);
  }
  // The widgets it reads, as distances back (they come before it).
  const back = (k) => {
    const d = w.id.slice(1) - k.slice(1);
    if (!(d > 0)) throw new Error(`digest: ${w.id} reads ${k}, which does not come before it`);
    return d;
  };
  if (reads.size) body.push(`  dep(${[...reads].map(back).join(", ")});`);
  return `// ${w.id}\nconst ${w.id} = () => {\n${body.join("\n")}\n};`;
}

function appFile(spec) {
  spec.widgets.forEach((w, i) => {
    if (w.id !== `w${i + 1}`) throw new Error(`digest expects sequential widget ids, got ${w.id} at ${i}`);
  });
  // The fields other widgets read, and the feed lists, by widget.
  FEED = Object.fromEntries(spec.widgets.map((w) => [w.id, new Set(w.fields.filter((f) => f.feed).map((f) => f.name))]));
  READ = Object.fromEntries(spec.widgets.map((w) => [w.id, new Set()]));
  const walk = (x) => {
    if (!x || typeof x !== "object") return;
    if (x[0] === "w" && READ[x[1]] && typeof x[2] === "string") READ[x[1]].add(x[2]);
    for (const y of Object.values(x)) walk(y);
  };
  for (const w of spec.widgets) walk(w.view);
  const code = spec.widgets.map((w) => widgetCode(w, spec.initialState.widgets[w.id]));
  const shared = spec.widgets.flatMap((w) => [...READ[w.id]].filter((f) => !FEED[w.id].has(f)).map((f) => `${w.id}$${f}`));

  // External events: only the branches this app can receive.
  const fields = spec.widgets.flatMap((w) => w.fields);
  const branches = [
    `if (m.type == "serverSet") S[m.widget](structuredClone(m.state)), run(W[m.widget]);`,
    `else if (m.type == "snapshot") for (const k in m.state.widgets) S[k](structuredClone(m.state.widgets[k])), run(W[k]);`,
  ];
  if (fields.some((f) => f.tick)) branches.push(`else if (m.type == "tick") for (const t of T) t();`);
  if (fields.some((f) => f.feed)) branches.push(`else if (m.type == "notify") O[m.widget][m.field].push({ ...m.item }), run(W[m.widget]);`);

  const body = code.join("\n\n") + "\n\n" + branches.join("\n");
  const names = ["widget", "bind", "text", "show", "list", "dep", "run", "cl", "nx", "add", "L", "S", "O", "W", "T"]
    .filter((x) => new RegExp(`(^|[^\\w.])${x}\\b`, "m").test(body));
  const ids = spec.widgets.map((w) => w.id).join(", ");

  return `// Generated by scenarios/unique-components/digest.js. Do not edit.
import { app, ${names.join(", ")} } from "./runtime.js";
${shared.length ? `
// The fields other widgets read.
let ${shared.join(", ")};
` : ""}
${code.join("\n\n")}

// External events: each replaces the state of the widgets it concerns (with their setters, S)
// and digests only those (\`run(W[k])\`; a time-driven field's tick function digests its own
// widget).
const receive = (m) => {
  ${branches.join("\n  ")}
};

export default app([${ids}], receive);
`;
}

export function emit(spec) {
  return {
    files: {
      ...templateFiles({ name: "unique-components", title: "Unique components", runtime: "runtime-unique.js" }),
      "src/app.js": appFile(spec),
    },
    style: {
      approach: "compiled dirty checking, per widget: an event re-runs the bindings of the widget it touched (and of the widgets reading it), writing a DOM property only when its value changed",
      components: "one function per widget, written out in full from that widget's description (state literal, template, handlers, bindings, tick); no shared per-kind factories, no data rows, no interpreter",
      state: "plain mutable objects, one per widget; external replacements are deep-copied into them",
      templates: "one static HTML string per widget (texts escaped at build time); nodes are found by their position in the template, once",
      handlers: "one arrow function per control, given to the controls in document order, compiled from the message's ops; small generic helpers (clamp, next option, add an item)",
      lists: "keyed by id, reconciled in place by the runtime; item template and item bindings are the widget's own code",
      conditionals: "a binding that swaps one node with an empty text node",
      events: "one delegated click and input listener that calls the target's handler",
      derived: "expressions compiled to JavaScript inside the bindings; a reader's whole binding list is added to each source widget's list (compile-time dependency); no memoization",
      time: "each time-driven field pushes its own tick function; a tick digests only the widgets whose gate is on",
      build: "Vite production build, no plugin, hidden source maps",
    },
  };
}
