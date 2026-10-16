// big-component in digest (prototype): compiled dirty checking, one component split into small
// binding lists.
//
// What a compiler for this approach would produce for one big form:
// - One function per widget (the form, its companion), written out in full from its description:
//   its state (its setter's defaults), its template (static HTML, escaped at build time), its
//   handlers (what each message does, as statements), its bindings (one closure per dynamic DOM
//   property, the derived expressions compiled to JavaScript) and, for a time-driven field, its
//   tick function. Nothing is kept as data for a generic routine (no op tables, no view trees).
// - Locality inside the component. A digest that re-ran the whole form's bindings would cost O(N)
//   per event, so the form's bindings are split into lists, one per section (for what sits
//   directly in a section, such as its total) and one per fieldset (the group's controls,
//   displays, conditional sections and summary). A control digests its own list, plus the lists
//   of the sections and fieldsets that read a field the control writes. The compiler knows both
//   sides: which fields each list's bindings read, and which fields each control's handler
//   writes, so it emits `dep(source, ...readers)`: the lists to digest after a control of
//   `source`. The reads are cross-field but windowed (a field is read by a bounded number of
//   bindings, all near it), so the lists an event digests stay a constant few, however big the
//   form. A dependency is between lists: a reader list's own readers are not digested (a
//   binding never writes state).
// - The companion is another widget with one list; its reads of the form's fields are
//   dependencies of the form's lists on it, the same wiring.
// - The runtime (frameworks/digest/runtime-big.js) is generic: a widget built from a template,
//   bind/text/show, a keyed-list reconciler, one delegated click/input listener, and small
//   handler helpers.
// - State is plain variables: a field only its widget uses is a parameter of the widget's
//   function, a field another widget reads a module variable, a feed list a field of the widget's
//   record (`notify` pushes into it by name). External replacements go through the widget's
//   setter, which assigns every field from the runtime's `S`; whole-state events digest all of
//   the widget's lists.
// - Nodes are found by their position in the template, each binding's as a distance from the
//   previous binding's, resolved once at creation; handlers are given to the controls in
//   document order, a number among them moving the controls that follow to another list.
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

// Dependencies between binding lists. Lists are numbered in page order, across widgets.
// - `RS`: the fields (`w1.name`) the bindings of the list being made read; `reads[list]` all of them.
// - `writers`: for each control (and tick function, and notify), its list and the fields it writes.
// - `first[field]`: the first list reading a field (a tick or notify digests it).
let RS, reads, writers, first, scope;
const rd = (key) => {
  RS.add(key);
  first[key] ??= scope;
};

// Both sides of a comparison have the same type (the expressions are typed), so loose equality
// is strict equality.
const CMP = new Set(["==", "!=", "<", "<=", ">", ">="]);

// A widget's expression as JavaScript. `reads` collects the earlier widgets it reads.
function expr(e, rw) {
  const x = (a) => expr(a, rw);
  switch (e[0]) {
    case "f": rd(`${cur}.${e[1]}`); return F(e[1]);
    case "w": rw.add(e[1]); rd(`${e[1]}.${e[2]}`); return V(e[1], e[2]);
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
  if (CMP.has(e[0])) return `(${x(e[1])} ${e[0]} ${x(e[2])})`;
  throw new Error(`digest: unknown expression ${lit(e)}`);
}

// A list of text parts: its static HTML when no part is an expression, else the code of the
// string it computes.
function parts(ps, rw) {
  if (ps.every((p) => typeof p === "string")) return { html: esc(ps.join("")) };
  const code = ps.length === 1 ? expr(ps[0], rw)
    : "`" + ps.map((p) => (typeof p === "string" ? tpl(p) : "${" + expr(p, rw) + "}")).join("") + "`";
  return { html: "", code };
}

// One op of a click message as code: an expression (`e`; `t` when it uses the parameter `t`).
function op(o, fields) {
  const [kind, name] = o;
  const f = fields[name];
  const L = F(name);
  switch (kind) {
    // An int field always lies within its range (every op, input and external state keeps it
    // there), so adding k > 0 can only pass the top and k < 0 the bottom: one bound is checked.
    case "add": return { e: o[2] > 0 ? `${L} = Math.min(${L} + ${o[2]}, ${f.max})` : `${L} = Math.max(${L} - ${-o[2]}, ${f.min})` };
    case "set": return { e: `${L} = ${lit(o[2])}` };
    case "toggle": return { e: `${L} = !${L}` };
    case "reset": return { e: `${L} = ${lit(f.initial)}` };
    case "cycle": return { e: `${L} = nx(${[L, ...f.options.map(lit)].join(", ")})` };
    // The trimmed draft goes in `t`, the handler's parameter, which it is called without (it
    // reads its control, when it needs it, from `X`).
    case "push": return { e: `(t = ${F(o[2])}.trim()) && (add(${L}, t), ${F(o[2])} = "")`, t: 1 };
    case "pushText": return { e: `add(${L}, ${lit(o[2])})` };
    case "pop": return { e: `${L}.pop()` };
    case "shift": return { e: `${L}.shift()` };
    case "clear": return { e: `${L} = []` };
    case "clearDone": return { e: `${L} = ${L}.filter((i) => !i.done)` };
  }
  throw new Error(`digest: unknown op ${kind}`);
}

// The fields a message writes.
const writes = (m) => (m.kind === "click"
  ? m.ops.flatMap((o) => (o[0] === "push" ? [o[1], o[2]] : [o[1]]))
  : [m.field]).map((n) => `${cur}.${n}`);

// A message's handler, as an arrow function. It reads its control from `X`, which the runtime sets
// to the event's target before it calls the handler.
function handler(m, fields) {
  const L = F(m.field);
  switch (m.kind) {
    case "click": {
      const ops = m.ops.map((o) => op(o, fields));
      return `${ops.some((o) => o.t) ? "(t)" : "()"} => ${ops.length === 1 ? ops[0].e : `(${ops.map((o) => o.e).join(", ")})`}`;
    }
    case "input": {
      // A number input sends only an integer within the field's range (the README's rule).
      const f = fields[m.field];
      return f.type === "int" ? `(t) => Number.isInteger((t = X.valueAsNumber)) && t >= ${f.min} && t <= ${f.max} && (${L} = t)` : `() => ${L} = X.value`;
    }
    case "check": return `() => ${L} = X.checked`;
    case "select": return `() => ${L} = X.value`;
    // An item control's handler is created with its item and reads `r.i`, the item's current
    // value (the very object in the list).
    case "item": return m.op === "remove" ? `() => ${L} = ${L}.filter((i) => i != r.i)` : `() => r.i.done = X.checked`;
  }
  throw new Error(`digest: unknown message kind ${m.kind}`);
}

// A field's initial value: as it is; a list's items as their texts when their ids are 1, 2, …,
// after a bit mask of which are done for a checkable list (bit i: item i).
function initial(f, v) {
  if (f.type !== "list") return lit(v);
  if (v.every((it, i) => it.id === i + 1) && v.length < 31) {
    const texts = v.map((it) => lit(it.text));
    return f.checkable ? `C(${[v.reduce((m, it, i) => m | (it.done ? 1 << i : 0), 0), ...texts].join(", ")})` : `L(${texts.join(", ")})`;
  }
  return lit(v);
}

let nextList = 0; // the number of the next binding list, in page order across widgets

// One widget's function.
function widgetCode(w, init) {
  cur = w.id;
  const fields = Object.fromEntries(w.fields.map((f) => [f.name, f]));
  const msgs = Object.fromEntries(w.messages.map((m) => [m.name, m]));
  const rw = new Set();
  const binds = [];
  const root = nextList++; // the widget's first list: what is outside every section
  const mine = [root]; // this widget's lists
  const newList = () => {
    const l = nextList++;
    mine.push(l);
    reads[l] = new Set();
    return l;
  };
  reads[root] = new Set();
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
  // A binding goes in the list of the section or fieldset it is in; `to` moves to that list.
  let bs = root;
  const put = (l, code) => {
    if (l !== bs) binds.push(`to(${(bs = l)});`);
    binds.push(code);
  };
  // The handlers of the template's controls (buttons, inputs, selects), in document order, a
  // list's number before the first of its controls.
  const ctl = [];
  let cs = root;
  const on = (l, msg, out = ctl) => {
    if (out === ctl && l !== cs) ctl.push(`${(cs = l)},`);
    out.push(handler(msgs[msg], fields) + (out === ctl ? `, // ${msg}` : ""));
    writers.push({ list: l, writes: new Set(writes(msgs[msg])) });
  };

  // A node as template HTML; its bindings go to `binds`, in document order. `l` is the list
  // of the section or fieldset it is in.
  const view = (v, l) => {
    scope = l;
    RS = reads[l];
    switch (v.el) {
      case "text": {
        const i = n++, p = parts(v.parts, rw);
        if (p.code) put(l, `text(${ref(i)}, () => ${p.code});`);
        return `<${v.tag}>${p.html}</${v.tag}>`;
      }
      case "button": {
        const i = n++, p = parts(v.text, rw);
        if (p.code) put(l, `text(${ref(i)}, () => ${p.code});`);
        on(l, v.msg);
        if (v.disabled) put(l, `bind(${ref(i)}, () => ${expr(v.disabled, rw)}, "disabled");`);
        return `<button data-role=${v.msg}>${p.html}</button>`;
      }
      case "input": {
        const f = fields[msgs[v.msg].field];
        if (v.label) n++;
        const i = n++;
        on(l, v.msg);
        rd(`${cur}.${f.name}`);
        put(l, `bind(${ref(i)}, () => ${F(f.name)});`);
        let html = f.type === "int" ? `<input type=number data-role=${v.msg}>`
          : `<input type=text data-role=${v.msg}${v.placeholder ? ` placeholder="${esc(v.placeholder)}"` : ""}>`;
        if (v.label) html = `<label>${esc(v.label)}${html}</label>`;
        if (v.invalid) {
          put(l, `show(${ref(n++)}, () => ${expr(v.invalid.when, rw)});`);
          html += `<p data-role=${v.msg}Error>${esc(v.invalid.message)}</p>`;
        }
        return html;
      }
      case "check": {
        n++;
        const i = n++;
        on(l, v.msg);
        rd(`${cur}.${msgs[v.msg].field}`);
        put(l, `bind(${ref(i)}, () => ${F(msgs[v.msg].field)}, "checked");`);
        return `<label><input type=checkbox data-role=${v.msg}>${esc(v.label)}</label>`;
      }
      case "select": {
        const f = fields[msgs[v.msg].field];
        if (v.label) n++;
        const i = n++;
        n += f.options.length;
        on(l, v.msg);
        rd(`${cur}.${f.name}`);
        put(l, `bind(${ref(i)}, () => ${F(f.name)});`);
        const html = `<select data-role=${v.msg}>${f.options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}</select>`;
        return v.label ? `<label>${esc(v.label)}${html}</label>` : html;
      }
      case "list": {
        const i = n++;
        // The item's bindings refer to its elements by position, and the handlers of its
        // controls (checkbox, remove button) are returned in document order. They belong to
        // the list the keyed list is in.
        let item = "";
        const inner = [], hs = [];
        if (v.check) {
          item += `<input type=checkbox data-role=${v.check}>`;
          inner.push(`bind(0, () => r.i.done, "checked")`);
          on(l, v.check, hs);
        }
        inner.push(`text(${v.check ? 1 : 0}, () => r.i.text)`);
        item += "<span></span>";
        if (v.remove) {
          item += `<button data-role=${v.remove}>${esc(v.removeText)}</button>`;
          on(l, v.remove, hs);
        }
        if (hs.length) inner.push(`[${hs.join(", ")}]`);
        rd(`${cur}.${v.field}`);
        put(l, `list(${ref(i)}, () => ${F(v.field)}, "${v.field}Item", \`${tpl(item)}\`, (r) => (${inner.join(", ")}));`);
        return `<${v.tag}></${v.tag}>`;
      }
      case "when": {
        const i = n++;
        put(l, `show(${ref(i)}, () => ${expr(v.cond, rw)});`);
        return `<${v.tag}>${v.children.map((c) => view(c, l)).join("")}</${v.tag}>`;
      }
      case "group": {
        n++;
        // A fieldset, and a section at the top of the form, have a list of their own.
        const g = v.tag === "fieldset" || l === root ? newList() : l;
        const html = `<${v.tag}>${v.children.map((c) => view(c, g)).join("")}</${v.tag}>`;
        return html;
      }
    }
    throw new Error(`digest: unknown view node ${v.el}`);
  };

  const html = `<h2>${esc(w.label)}</h2>` + w.view.map((c) => view(c, root)).join("");
  const own = w.fields.filter((f) => !FEED[cur].has(f.name) && !READ[cur].has(f.name));
  const shared = w.fields.filter((f) => FEED[cur].has(f.name));
  const handlers = ctl.map((h) => `    ${h}`).join("\n");
  // External events replace the widget's whole state: its setter assigns every field from `S`,
  // the state `all(W[k], state)` is applying. Each field's default is its initial value, so the
  // setter also initialises the state (`widget()` calls it while `S` is empty). A field named
  // like a property of Object.prototype would pick that property up instead.
  for (const f of w.fields) if (f.name in {}) throw new Error(`digest: field name ${f.name} shadows an Object.prototype property`);
  const set = `() => ({ ${w.fields.map((f) => `${f.name}: ${F(f.name)} = ${initial(f, init[f.name])}`).join(", ")} } = S)`;

  // A time-driven field's tick function writes it, and digests a list that reads it (and so
  // the other readers). So does `notify` for the feed list.
  const tickLists = [];
  for (const f of w.fields) {
    if (f.tick) {
      const l = first[`${cur}.${f.name}`];
      tickLists.push([f, l]);
      writers.push({ list: l, writes: new Set([`${cur}.${f.name}`]) });
    }
    if (f.feed) {
      FEEDLIST[cur + "." + f.name] = first[`${cur}.${f.name}`];
      writers.push({ list: first[`${cur}.${f.name}`], writes: new Set([`${cur}.${f.name}`]) });
    }
  }

  const body = [
    ...(shared.length ? [`  const s = (O.${cur} = {});`] : []),
    `  widget(${set}, ${mine.length},\n${handlers}\n    \`${tpl(html)}\`,\n  );`,
    ...binds.map((b) => "  " + b)];
  for (const [f, l] of tickLists) {
    body.push(`  T.push(() => ${F(f.tickWhen)} && (${F(f.name)} = Math.min(${f.max}, ${F(f.name)} + ${f.tick}), run(${l})));`);
  }
  // The lists of this widget that read what a control of an earlier list (or of the same
  // widget) writes. Everything before this widget's lists exists when its function runs.
  const readers = new Map();
  for (const r of mine) {
    for (const wr of writers) {
      if (wr.list !== r && [...wr.writes].some((k) => reads[r].has(k))) {
        if (!readers.has(wr.list)) readers.set(wr.list, new Set());
        readers.get(wr.list).add(r);
      }
    }
  }
  for (const [s, rs] of [...readers].sort((a, b) => a[0] - b[0])) body.push(`  dep(${s}, ${[...rs].join(", ")});`);
  return `// ${w.id}\nconst ${w.id} = (${own.map((f) => F(f.name)).join(", ")}) => {\n${body.join("\n")}\n};`;
}

let FEEDLIST;

function appFile(spec) {
  spec.widgets.forEach((w, i) => {
    if (w.id !== `w${i + 1}`) throw new Error(`digest expects sequential widget ids, got ${w.id} at ${i}`);
  });
  nextList = 0;
  reads = {};
  writers = [];
  first = {};
  FEEDLIST = {};
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
  const feeds = fields.filter((f) => f.feed);
  if (feeds.length > 1) throw new Error("digest: big-component expects one feed list");
  const feedList = feeds.length ? FEEDLIST[Object.keys(FEEDLIST)[0]] : null;
  // `serverSet` and `snapshot` (the last branch) both replace whole widget states: a serverSet
  // is a snapshot of one widget. A tick or notify this app has no branch for carries no state, so
  // it replaces nothing.
  const branches = [];
  if (fields.some((f) => f.tick)) branches.push(`if (m.type == "tick") for (const t of T) t();`);
  if (feeds.length) branches.push(`if (m.type == "notify") O[m.widget][m.field].push({ ...m.item }), run(${feedList});`);
  branches.push(`for (const k in (m = m.type == "serverSet" ? { [m.widget]: m.state } : m.state?.widgets)) all(W[k], structuredClone(m[k]));`);
  for (let i = 1; i < branches.length; i++) branches[i] = "else " + branches[i];

  const body = code.join("\n\n") + "\n\n" + branches.join("\n");
  const names = ["widget", "bind", "text", "show", "list", "to", "dep", "run", "all", "nx", "add", "L", "C", "O", "W", "T", "S", "X"]
    .filter((x) => new RegExp(`(^|[^\\w.])${x}\\b`, "m").test(body));
  const ids = spec.widgets.map((w) => w.id).join(", ");

  return `// Generated by scenarios/big-component/digest.js. Do not edit.
import { app, ${names.join(", ")} } from "./runtime.js";
${shared.length ? `
// The fields other widgets read.
let ${shared.join(", ")};
` : ""}
${code.join("\n\n")}

// External events: each replaces the state of the widgets it concerns and digests all of their
// lists, or (a tick, a notify) digests the lists reading the field it changed.
const receive = (m) => {
  ${branches.join("\n  ")}
};

export default app([${ids}], receive);
`;
}

export function emit(spec) {
  return {
    files: {
      ...templateFiles({ name: "big-component", title: "Big component", runtime: "runtime-big.js" }),
      "src/app.js": appFile(spec),
    },
    style: {
      approach: "compiled dirty checking over small binding lists: an event re-runs the bindings of the section or fieldset its control is in, and of the lists that read a field the control writes, writing a DOM property only when its value changed",
      components: "one function per widget (the form, its companion), written out in full from its description (state, template, handlers, setter, bindings, tick); no data rows, no interpreter",
      lists: "one binding list per fieldset, one per section (for its direct bindings, e.g. the total) and one per widget root; the compiler derives from the bindings' reads and the handlers' writes which lists to digest after a control, wired as dep(source, ...readers); direct readers only, nothing copied between lists",
      state: "plain mutable variables: locals of the widget's function, module variables for the fields the companion reads, a record for the feed list; external replacements are deep-copied and assigned through the widget's setter",
      templates: "one static HTML string per widget (texts escaped at build time); nodes are found by their position in the template (a distance from the previous binding's), once",
      handlers: "one arrow function per control, given to the controls in document order (a list number moves the controls after it to another list), compiled from the message's ops; small generic helpers (next option, add an item); an int add checks only the bound it can pass",
      keyedLists: "keyed by id, reconciled in place by the runtime; item template and item bindings are the widget's own code",
      conditionals: "a binding that swaps one node with an empty text node",
      events: "one delegated click and input listener that calls the target's handler",
      derived: "expressions compiled to JavaScript inside the bindings; no memoization",
      time: "each time-driven field pushes its own tick function, which digests a list reading the field; a tick digests only the fields whose gate is on",
      build: "Vite production build, no plugin, hidden source maps",
    },
  };
}
