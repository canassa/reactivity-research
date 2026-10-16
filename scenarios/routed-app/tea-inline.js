// The routed-app scenario as tea-inline, a prototype strategy (see frameworks/tea-inline/README.md).
//
// The emitter plays the compiler of a TEA app, as in unique-components, but the pages have a
// lifetime (notes/2026-10-16-tea-inline-critique.md, weakness 2): the shell and the page shown are
// built, and only those.
// - A unit is a markup string and a function over its elements. The shell, each page, each tab
//   panel and the modal are units; `up` (template/routes.js) builds one when it is shown and hands
//   it a list of disposers, and its `down` runs them. Page-local state is a `const` of the unit's
//   function, so it is fresh each time the unit is built, as the contract wants.
// - Bindings are grouped by the field they read, as in unique-components. The groups of a global
//   field are a list outside every unit (`GR.balance`): the shell adds its bindings when it is
//   built, and a page, tab or modal adds a group of its own (`reg(D, GR.balance, G[2])`) when it
//   is built and takes it out when it goes. A tab or modal reading a page field does the same with
//   the page's group of that field. So a write to a global field schedules exactly the readers
//   that are mounted, and a page that is not shown costs nothing.
// - Every message (a `case` arm of update) is inlined into the action its control calls: it writes
//   the fields it changes in place and schedules the groups of those fields, known at compile time.
//   Navigation is the shell's: one delegated click listener for the nav bar, the menu and the
//   pages' links; a page's timer is `every` (cleared with the unit).
// - External events stay messages: `receive(msg)` writes the global field and schedules its group,
//   and `pagePush` reaches the arm of the page shown (a page not shown has none).
//
// Style choices (also in `style` below): one module per page (its tabs and modal inside it, since
// they share its state), static markup parsed once per unit, elements by their place in document
// order (E[n]), in-place edits for page-local lists and replacement for the global lists (their
// readers are not known to the action), per-field binding groups, one microtask flush.

import { templateFiles } from "../../frameworks/tea-inline/framework.js";
import { literal, tplText } from "../../frameworks/shared/jsx.js";

export const framework = "tea-inline";

export const params = {};

const str = JSON.stringify;
const escText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const attrValue = (v) => (/^[\w.:-]+$/.test(v) ? v : `"${v.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`);
const key = (ref) => `${ref[0]}:${ref[1]}`;
// What the shell reads of the global state (it is written by this emitter, below).
const SHELL_READS = ["user", "cart", "notices"];

const UTIL_FILE = `// Small helpers the pages share (the scenario's, not the runtime's).

// A list's initial items, numbered from 1: their texts, or [text, done] pairs for a checkable list.
export const items = (...xs) => xs.map((x, i) => (x.map ? { id: i + 1, text: x[0], done: x[1] } : { id: i + 1, text: x }));

// A new list item's id: one more than the largest.
export const nextId = (items) => items.reduce((max, item) => Math.max(max, item.id), 0) + 1;

// The pages by number, from 1: each page's module adds its markup and its function when the app
// imports it, in order.
export const W = [,];
`;

// ---------------------------------------------------------------------------------------------
// Expressions: compiled to JavaScript over the unit's state (\`s\` in a page, \`t\` in a tab or
// the modal), the page's state seen from a tab or the modal (\`s\`) and the global state (\`g\`).

function bare(code) {
  if (code[0] !== "(" || code.at(-1) !== ")") return code;
  let depth = 0;
  for (let i = 0; i < code.length - 1; i++) {
    if (code[i] === '"') i = code.indexOf('"', i + 1);
    else if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) return code;
  }
  return code.slice(1, -1);
}

function inner(e, deps, u) {
  const go = (x) => inner(x, deps, u);
  switch (e[0]) {
    case "f": deps.add(key(e)); return `${u.S}.${e[1]}`;
    case "p": deps.add(key(e)); return `s.${e[1]}`;
    case "g": deps.add(key(e)); u.ctx.usesG = true; return `g.${e[1]}`;
    case "k": return str(e[1]);
    case "+": case "-": return `(${go(e[1])} ${e[0]} ${go(e[2])})`;
    case "count": case "len": return `${go(e[1])}.length`;
    case "done": return `${go(e[1])}.filter((item) => item.done).length`;
    case "left": return `${go(e[1])}.filter((item) => !item.done).length`;
    case "has": return `${go(e[1])}.includes(${str(e[2])})`;
    case "==": return `(${go(e[1])} == ${go(e[2])})`;
    case "!=": return `(${go(e[1])} != ${go(e[2])})`;
    case "<": case "<=": case ">": case ">=": return `(${go(e[1])} ${e[0]} ${go(e[2])})`;
    case "and": return `(${go(e[1])} && ${go(e[2])})`;
    case "or": return `(${go(e[1])} || ${go(e[2])})`;
    case "not": return `!${go(e[1])}`;
    case "if": return `(${go(e[1])} ? ${go(e[2])} : ${go(e[3])})`;
  }
  throw new Error(`unknown expression ${JSON.stringify(e)}`);
}

const exprCode = (e, deps, u) => bare(inner(e, deps, u));

function partsCode(parts, deps, u) {
  if (parts.every((p) => typeof p === "string")) return { static: parts.join("") };
  if (parts.length === 1) return { code: exprCode(parts[0], deps, u) };
  return { code: "`" + parts.map((p) => (typeof p === "string" ? tplText(p) : `\${${exprCode(p, deps, u)}}`)).join("") + "`" };
}

// Drop the end tags HTML makes optional (`</option>` before an option or the select's end, `</p>`
// before a block or its parent's end), and the run of end tags at the very end: the parser closes
// them at the end of the string, and the parsed DOM is the same.
const lean = (html) => html.replace(/<\/option>(?=<option|<\/select>)/g, "")
  .replace(/<\/p>(?=<(?:aside|div|fieldset|footer|header|ol|p|section|ul)[\s>]|<\/|$)/g, "")
  .replace(/(<\/\w+>)+$/, "");

// ---------------------------------------------------------------------------------------------
// A unit (a page, a tab panel or the modal): its view, compiled to markup, bindings and actions.

function makeUnit(kind, comp, page, ctx) {
  const isPage = kind === "page";
  const u = {
    kind, comp, page, ctx,
    T: isPage ? "G" : "H", D: isPage ? "D" : "C", S: isPage ? "s" : "t",
    bindings: [], actions: [], itemBodies: {}, lists: {}, groupIdx: new Map(),
    html: "", tabs: null, opens: false,
  };
  const fieldOf = (ref) => (ref[0] === "g" ? ctx.globalField[ref[1]] : (ref[0] === "p" ? page : comp).fields.find((f) => f.name === ref[1]));
  const message = (name) => comp.messages.find((m) => m.name === name);
  // The place an lvalue/rvalue of a ref has in the code.
  const lv = (ref) => {
    if (ref[0] === "g") ctx.usesG = true;
    return ref[0] === "f" ? `${u.S}.${ref[1]}` : ref[0] === "p" ? `s.${ref[1]}` : `g.${ref[1]}`;
  };
  const ids = {};
  const id = (p) => p + (ids[p] = (ids[p] || 0) + 1);
  const ref = (p) => `\0${id(p)}\0`;
  const refs = [];

  const bind = (mk) => {
    const deps = new Set();
    const code = mk(deps);
    u.bindings.push({ code, reads: [...deps] });
  };
  const attrs = (o) => `{ ${Object.entries(o).map(([k, v]) => `${/^\w+$/.test(k) ? k : str(k)}: ${v}`).join(", ")} }`;

  // The group a write schedules, if anyone can read it: a field of this unit (its group), a field
  // of the page (the page's group, where this unit registered its readers), or a global field (the
  // readers outside every unit, when the shell or the page can read it).
  const target = (k) => {
    const name = k.slice(2);
    if (k[0] === "g") {
      if (!ctx.globalRead.has(name)) return null;
      ctx.usesGR = true;
      return `GR.${name}`;
    }
    if (k[0] === "p") {
      const i = ctx.pageUnit.groupIdx.get(`f:${name}`);
      return i === undefined ? null : `G[${i}]`;
    }
    return u.groupIdx.has(k) ? `${u.T}[${u.groupIdx.get(k)}]` : null;
  };
  const sched = (keys, args = []) => {
    for (const k of new Set(keys)) {
      const t = target(k);
      if (t) args.push(t);
    }
    return args.length ? [`schedule(${args.join(", ")});`] : [];
  };
  u.target = target;

  const listPath = (k) => {
    // The list binding of a field of this unit, or of the page's (the modal pushing into it).
    const owner = k[0] === "p" ? ctx.pageUnit : u;
    const l = owner.lists[`f:${k.slice(2)}`];
    if (!l) throw new Error(`no list ${k}`);
    return l;
  };

  // The code of a click or confirm message: its ops, inlined.
  function opLines(m) {
    const confirm = m.kind === "confirm";
    const lines = [];
    for (const op of m.ops) {
      const [kind, r] = op;
      const f = fieldOf(r);
      const v = lv(r);
      switch (kind) {
        case "add":
          lines.push(op[2] > 0 ? `${v} = Math.min(${f.max}, ${v} + ${op[2]});` : `${v} = Math.max(${f.min}, ${v} - ${-op[2]});`);
          break;
        case "set": lines.push(`${v} = ${str(op[2])};`); break;
        case "toggle": lines.push(`${v} = !${v};`); break;
        case "reset": lines.push(`${v} = ${literal(f.initial)};`); break;
        case "copy": lines.push(`${v} = ${lv(op[2])};`); break;
        case "cycle": {
          const o = f.options;
          lines.push(`${v} = ${o.map((x, i) => `${v} == ${str(o.at(i - 1))} ? ${str(x)} : `).slice(0, -1).join("")}${str(o.at(-1))};`);
          break;
        }
        case "push": case "pushText": {
          const item = (text) => `{ id: nextId(${v}), text: ${text}${f.checkable ? ", done: false" : ""} }`;
          if (r[0] === "g") {
            // A global list may be shown by the shell and the page: replace it, and its groups reconcile.
            lines.push(`${v} = [...${v}, ${item(str(op[2]))}];`);
            break;
          }
          const body = [];
          if (kind === "push") {
            const draft = lv(op[2]);
            lines.push(`const title = ${draft}.trim();`);
            if (!confirm) lines.push("if (!title) return;");
            body.push(`const item = ${item("title")};`);
            body.push(`${v}.push(item);`);
            if (!confirm) body.push(`${draft} = "";`);
          } else {
            body.push(`const item = ${item(str(op[2]))};`);
            body.push(`${v}.push(item);`);
          }
          body.push(`${listPath(key(r))}.add(item);`);
          if (kind === "push" && confirm) lines.push("if (title) {", ...body.map((l) => "  " + l), "}");
          else lines.push(...body);
          break;
        }
        case "pop": lines.push(`${v} = ${v}.slice(0, -1);`); break;
        case "shift": lines.push(`${v} = ${v}.slice(1);`); break;
        case "clear": lines.push(`${v} = [];`); break;
        case "clearDone": lines.push(`${v} = ${v}.filter((item) => !item.done);`); break;
        default: throw new Error(`unknown op ${kind}`);
      }
    }
    return lines;
  }

  // The refs a message writes (a confirm drops what the modal itself holds: it goes with it).
  const writesOf = (m) => {
    if (m.kind === "click" || m.kind === "confirm") {
      const out = m.ops.flatMap((op) => (op[0] === "push" ? [op[1], op[2]] : [op[1]]));
      return (m.kind === "confirm" ? out.filter((r) => r[0] !== "f") : out).map(key);
    }
    return [key(m.field)];
  };

  // The handler of a message on the element `node`.
  function handler(node, m) {
    u.actions.push(() => {
      const f = m.field && fieldOf(m.field);
      const done = sched(m.kind === "open" || m.kind === "close" ? [] : writesOf(m));
      // A control that writes state outside its unit does nothing once the unit has left (a stale
      // click in the same task as the navigation): its node is no longer in the page.
      const outside = m.kind !== "open" && m.kind !== "close" && writesOf(m).some((k) => k[0] !== "f");
      const wrap = (event, body) => [`on(${node}, ${event === "click" ? "()" : "(e)"} => {`, ...(outside ? [`  if (!${node}.isConnected) return;`] : []), ...body.map((l) => "  " + l), event === "click" ? "});" : `}, "${event}");`];
      const v = m.field && lv(m.field);
      switch (m.kind) {
        case "click": return wrap("click", [...opLines(m), ...done]);
        case "confirm": return wrap("click", [...opLines(m), ...done, "modal.down();"]);
        case "open":
          ctx.usesN = true;
          return wrap("click", ["modal?.down();", 'modal = up(N, "beforeend", ...M);']);
        case "close": return wrap("click", ["modal.down();"]);
        case "check": return wrap("click", [`${v} = !${v};`, ...done]);
        case "select": return wrap("input", [`${v} = e.target.value;`, ...done]);
        case "input":
          if (f.type === "int") {
            return wrap("input", ["const value = e.target.valueAsNumber;",
              `if (!Number.isInteger(value) || value < ${f.min} || value > ${f.max}) return;`,
              `${v} = value;`, ...done]);
          }
          return wrap("input", [`${v} = e.target.value;`, ...done]);
      }
      throw new Error(`unknown message kind ${m.kind}`);
    });
  }

  // The action of an item control (toggle or remove), inlined into the row's handler, which
  // knows its item; written once the binding groups are known.
  function itemAction(name) {
    const m = message(name);
    u.itemBodies[name] = () => {
      const v = lv(m.field);
      if (m.op === "toggle") return ["item.done = !item.done;", ...sched([key(m.field)], ["set"])];
      // Removed by identity from the current array: a click on a row that something else has
      // dropped already (a snapshot, a clear) changes nothing.
      return [...(m.field[0] === "f" ? [] : ["if (!node.isConnected) return;"]), `${v} = ${v}.filter((x) => x !== item);`, ...sched([key(m.field)])];
    };
    return `@@${name}@@`;
  }

  // The unit's static markup, and the elements the code refers to: the n-th element (in document
  // order, headings, labels and options left out) is `refs[n]`.
  let count = 0;
  const open = (tag, a = {}, name) => {
    if (name) refs[count] = name;
    if (!["h1", "h2", "label", "option"].includes(tag)) count++;
    u.html += `<${tag}${Object.entries(a).map(([k, v]) => ` ${k}=${attrValue(String(v))}`).join("")}>`;
  };
  const close = (tag) => (u.html += `</${tag}>`);
  const element = (tag, a, content, name) => {
    open(tag, a, name);
    if (tag !== "input") u.html += escText(content ?? "") + `</${tag}>`;
  };

  function node(n) {
    switch (n.el) {
      case "text": {
        const p = partsCode(n.parts, new Set(), u);
        if (p.static !== undefined) element(n.tag, {}, p.static);
        else {
          const t = ref("t");
          element(n.tag, {}, "", t);
          bind((deps) => `() => text(${t}, ${partsCode(n.parts, deps, u).code})`);
        }
        return;
      }
      case "button": {
        const b = ref("b");
        const p = partsCode(n.text, new Set(), u);
        element("button", { "data-role": n.msg }, p.static ?? "", b);
        if (p.static === undefined) bind((deps) => `() => text(${b}, ${partsCode(n.text, deps, u).code})`);
        if (n.disabled) bind((deps) => `() => prop(${b}, ${exprCode(n.disabled, deps, u)}, "disabled")`);
        handler(b, message(n.msg));
        return;
      }
      case "link":
        // Navigation is the shell's: one delegated listener reads the button's data-key.
        element("button", { "data-key": n.to, "data-role": "pageLink" }, n.text);
        return;
      case "open": {
        const b = ref("b");
        element("button", { "data-role": n.msg }, n.text, b);
        u.opens = true;
        handler(b, message(n.msg));
        return;
      }
      case "tabs": {
        const nav = ref("nv");
        open("nav", { "data-role": "tabs" }, nav);
        const buttons = page.tabs.map((t, i) => {
          const b = ref("tb");
          element("button", { "data-key": t.id, "data-role": "tab", "aria-selected": String(i === 0) }, t.label, b);
          return b;
        });
        close("nav");
        u.tabs = { nav, buttons };
        return;
      }
      case "input": {
        const m = message(n.msg);
        const f = fieldOf(m.field);
        const num = f.type === "int";
        if (n.label) {
          open("label");
          u.html += escText(n.label);
        }
        const i = ref("i");
        const o = { type: num ? "number" : "text", "data-role": n.msg };
        if (n.placeholder) o.placeholder = n.placeholder;
        element("input", o, null, i);
        if (n.label) close("label");
        bind((deps) => `() => prop(${i}, ${num ? `String(${exprCode(m.field, deps, u)})` : exprCode(m.field, deps, u)})`);
        handler(i, m);
        if (n.invalid) {
          const e = ref("e");
          element("p", { "data-role": n.msg + "Error" }, n.invalid.message, e);
          bind((deps) => `() => when(${e}, ${exprCode(n.invalid.when, deps, u)})`);
        }
        return;
      }
      case "check": {
        const m = message(n.msg);
        const c = ref("c");
        open("label");
        element("input", { type: "checkbox", "data-role": n.msg }, null, c);
        u.html += escText(n.label);
        close("label");
        bind((deps) => `() => prop(${c}, ${exprCode(m.field, deps, u)}, "checked")`);
        handler(c, m);
        return;
      }
      case "select": {
        const m = message(n.msg);
        const f = fieldOf(m.field);
        if (n.label) {
          open("label");
          u.html += escText(n.label);
        }
        const o = ref("o");
        open("select", { "data-role": n.msg }, o);
        for (const value of f.options) element("option", { value }, value);
        close("select");
        if (n.label) close("label");
        bind((deps) => `() => prop(${o}, ${exprCode(m.field, deps, u)})`);
        handler(o, m);
        return;
      }
      case "list": {
        const k = key(n.field);
        const l = `\u0001L${++ctx.lists}\u0001`;
        const parent = ref("n");
        u.lists[k] = l;
        element(n.tag, {}, "", parent);
        const row = [`const node = el("li", null, ${attrs({ "data-key": "item.id", "data-role": str(n.field[1] + "Item") })});`];
        const set = [];
        if (n.check) {
          row.push(`const box = el("input", node, ${attrs({ type: str("checkbox"), "data-role": str(n.check) })});`);
          set.push('prop(box, item.done, "checked");');
        }
        row.push('const label = el("span", node);');
        set.push("text(label, item.text);");
        row.push(`const set = (${n.check ? "next = item" : "next"}) => { item = next; ${set.join(" ")} };`);
        if (n.check) row.push("on(box, () => {", itemAction(n.check), "});");
        if (n.remove) {
          row.push(`on(el("button", node, ${attrs({ "data-role": str(n.remove) })}, ${str(n.removeText)}), () => {`, itemAction(n.remove), "});");
        }
        row.push("return [node, set];");
        const deps = new Set([k]);
        if (n.field[0] === "g") ctx.usesG = true;
        const code = [`list(${parent}, () => ${lv(n.field)}, (item) => {`, ...row.map((r) => "  " + r), "})"].join("\n");
        u.bindings.push({ code, reads: [...deps], list: l });
        return;
      }
      case "when": {
        const g = ref("g");
        open(n.tag, {}, g);
        for (const c of n.children) node(c);
        close(n.tag);
        bind((deps) => `() => when(${g}, ${exprCode(n.cond, deps, u)})`);
        return;
      }
      case "group": {
        open(n.tag);
        for (const c of n.children) node(c);
        close(n.tag);
        return;
      }
    }
    throw new Error(`unknown view node ${n.el}`);
  }

  u.build = (view) => {
    for (const n of view) node(n);
    u.html = lean(u.html);
  };

  // The binding table: one group per field (or global field, or page field) the unit's bindings
  // read; a binding reading one source sits inline in its group, one reading several is an entry of
  // its own, added to each of its groups. `extra`: page fields that tabs or the modal read.
  u.layout = (extra = []) => {
    const used = new Set(extra);
    for (const b of u.bindings) for (const k of b.reads) used.add(k);
    const keys = [
      ...comp.fields.map((f) => `f:${f.name}`).filter((k) => used.has(k)),
      ...[...used].filter((k) => k[0] === "g").sort(),
      ...[...used].filter((k) => k[0] === "p").sort(),
    ];
    keys.forEach((k, i) => u.groupIdx.set(k, i));
    u.keys = keys;
    u.groups = new Map(keys.map((k) => [k, []]));
    u.extras = u.bindings.filter((b) => b.reads.length !== 1);
    u.listRefs = {};
    for (const b of u.bindings) {
      if (u.extras.includes(b)) continue;
      const g = u.groups.get(b.reads[0]);
      if (b.list) {
        const at = g.filter((x) => x.list).length;
        ctx.listPaths[b.list] = `${u.T}[${u.groupIdx.get(b.reads[0])}][${at}]`;
        g.splice(at, 0, b);
      } else g.push(b);
    }
    u.extras.forEach((b, i) => (b.name = `${u.T}[${keys.length + i}]`));
  };

  // The unit's function body.
  u.body = (extraLines = [], tailLines = []) => {
    const { T, D, S } = u;
    const lines = [];
    // Page-local state: fresh each time the unit is built.
    if (comp.fields.length) {
      const init = {};
      for (const f of comp.fields) init[f.name] = f.initial;
      lines.push(`const ${S} = ${initLiteral(init, ctx)};`);
    }
    const entries = [...[...u.groups.values()].map((g) => `[${g.map((b) => b.name || b.code).join(", ")}]`), ...u.extras.map((b) => b.code)];
    if (entries.length) {
      lines.push("", "// The bindings, grouped by the field they read.", `${T}.push(`, ...entries.flatMap((g) => `  ${g},`.split("\n").map((l, i) => (i ? "  " + l : l))), ");");
      for (const b of u.extras) for (const k of b.reads) lines.push(`${T}[${u.groupIdx.get(k)}].push(${b.name});`);
    }
    // Readers outside the unit: they register while the unit is built and leave with it.
    const regs = [];
    for (const k of u.keys) {
      const name = k.slice(2);
      if (k[0] === "g") {
        ctx.usesGR = true;
        ctx.usesReg = true;
        regs.push(`reg(${D}, GR.${name}, ${T}[${u.groupIdx.get(k)}]);`);
      } else if (k[0] === "p") {
        ctx.usesReg = true;
        regs.push(`reg(${D}, G[${ctx.pageUnit.groupIdx.get(`f:${name}`)}], ${T}[${u.groupIdx.get(k)}]);`);
      }
    }
    if (regs.length) lines.push("", "// Register with the state this unit reads from outside, while it is built.", ...regs);
    // Time-driven fields.
    for (const f of comp.fields.filter((x) => x.every)) {
      ctx.usesEvery = true;
      lines.push("", `// A timer for \`${f.name}\`, while the unit is built.`, `every(${D}, ${f.every}, () => {`, `  if (${S}.${f.name} != ${f.max}) {`,
        `    ${S}.${f.name} = Math.min(${f.max}, ${S}.${f.name} + ${f.by});`, ...sched([`f:${f.name}`]).map((l) => "    " + l), "  }", "});");
    }
    lines.push(...extraLines);
    const handlers = u.actions.map((a) => a());
    if (handlers.length) lines.push("", "// The arms of update, as actions.", ...handlers.flat());
    lines.push(...tailLines);
    u.usesD = regs.length > 0 || comp.fields.some((x) => x.every) || extraLines.some((l) => /\bD\.push/.test(l));
    const text = lines.map((l) => (l ? "  " + l : l)).join("\n");
    // Resolve the item bodies and the elements.
    const at = new Map(refs.map((r, n) => [r, n]).filter(([r]) => r));
    return text.replace(/^(\s*)@@(\w+)@@$/gm, (_, ind, name) => u.itemBodies[name]().map((b) => ind + "  " + b).join("\n"))
      .replace(/\0\w+\0/g, (r) => `E[${at.get(r)}]`);
  };
  u.elementIndex = (r) => refs.indexOf(r);
  u.refs = refs;
  return u;
}

// The initial state as a literal, with every list of items numbered 1, 2, … written as
// `items(...)`: the items' texts, or [text, done] pairs for a checkable list.
function initLiteral(model, ctx) {
  const calls = [];
  const numbered = (v) => Array.isArray(v) && v.length > 0 && v.every((x, i) => x && x.id === i + 1 && typeof x.text === "string"
    && Object.keys(x).length === ("done" in x ? 3 : 2) && v.every((y) => "done" in y === "done" in x));
  const walk = (v) => {
    if (numbered(v)) {
      calls.push(`items(${v.map((x) => literal("done" in x ? [x.text, x.done] : x.text)).join(", ")})`);
      return `\0${calls.length - 1}\0`;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = literal(walk(model), "  ").replace(/"\\u0000(\d+)\\u0000"/g, (_, i) => calls[i]);
  if (calls.length) ctx.usesItems = true;
  return out;
}

// ---------------------------------------------------------------------------------------------
// One page: its module, with its tabs and its modal inside it.

function pageFile(page, spec, globalReads) {
  const ctx = {
    lists: 0, listPaths: {}, globalField: Object.fromEntries(spec.global.map((f) => [f.name, f])),
    globalRead: new Set(SHELL_READS), pageUnit: null,
    usesG: false, usesGR: false, usesReg: false, usesEvery: false, usesItems: false,
  };
  const P = makeUnit("page", page, page, ctx);
  ctx.pageUnit = P;
  const tabUnits = (page.tabs || []).map((t) => makeUnit("tab", t, page, ctx));
  const M = page.modal ? makeUnit("modal", page.modal, page, ctx) : null;
  const nested = [...tabUnits, ...(M ? [M] : [])];

  P.build(page.view);
  tabUnits.forEach((u, i) => u.build(page.tabs[i].view));
  if (M) M.build(page.modal.view);

  // What can read a global field while this page is shown: the shell and the page's own units.
  for (const u of [P, ...nested]) for (const b of u.bindings) for (const k of b.reads) if (k[0] === "g") ctx.globalRead.add(k.slice(2));
  for (const k of ctx.globalRead) globalReads.add(k);

  // The page's groups include the fields its tabs and modal read.
  const pageReads = new Set();
  for (const u of nested) for (const b of u.bindings) for (const k of b.reads) if (k[0] === "p") pageReads.add(`f:${k.slice(2)}`);
  P.layout([...pageReads]);
  for (const u of nested) u.layout();

  // Tabs and the modal.
  const extra = [];
  const pageArms = [];
  const disposers = [];
  const fn = (u) => {
    const text = u.body();
    return `(E, H${u.usesD ? ", C" : ""}) => {\n${text}\n}`;
  };
  if (page.tabs) {
    const { nav, buttons } = P.tabs;
    const T = tabUnits.map((u, i) => {
      const panel = lean(`<section data-key=${page.tabs[i].id} data-role=panel>${u.html}`);
      return `  [${str(panel)}, ${fn(u).split("\n").map((l, j) => (j && l ? "  " + l : l)).join("\n")}],`;
    });
    extra.push("", "// The tab panels: each is built when its tab is selected, with fresh state.", "const T = [", ...T, "];",
      `const tabs = [${buttons.join(", ")}];`, "let at = 0;", `let tab = up(${nav}, "afterend", ...T[0]);`,
      "tabs.forEach((b, i) => on(b, () => {", "  if (i == at) return;", '  tabs[at].ariaSelected = "false";', '  b.ariaSelected = "true";',
      "  at = i;", "  tab.down();", `  tab = up(${nav}, "afterend", ...T[i]);`, "}));");
    disposers.push("tab.down();");
  }
  if (M) {
    const markup = lean(`<aside data-key=modal data-role=dialog><h2>${escText(page.modal.title)}</h2>${M.html}`);
    extra.push("", "// The modal: built when it opens, with fresh state.", `const M = [${str(markup)}, ${fn(M).split("\n").map((l, j) => (j && l ? "  " + l : l)).join("\n")}];`, "let modal;");
    disposers.push("modal?.down();");
  }
  if (disposers.length) extra.push("", "// Leave with the page.", `D.push(() => {`, ...disposers.map((l) => "  " + l), "});");
  const feed = page.fields.find((f) => f.feed);
  if (feed) {
    const lp = P.lists[`f:${feed.name}`];
    pageArms.push("", "return {", "  // The external arm: pagePush(item).", "  push(item) {", `    s.${feed.name}.push(item);`, `    ${lp}.add(item);`,
      ...(P.target(`f:${feed.name}`) ? [`    schedule(${P.target(`f:${feed.name}`)});`] : []), "  },", "};");
  }
  // tabs/modal setup comes before the handlers, which refer to them.
  let text = P.body(extra, pageArms);
  const params = ctx.usesN ? "E, G, D, N" : P.usesD ? "E, G, D" : "E, G";
  text = text.replace(/\u0001L\d+\u0001/g, (l) => ctx.listPaths[l]);

  const rt = ["el", "text", "prop", "on", "when", "list", "schedule"].filter((n) => new RegExp(`\\b${n}\\(`).test(text));
  const routes = ["up", "reg", "every"].filter((n) => new RegExp(`\\b${n}\\(`).test(text));
  const lines = [`import { ${rt.join(", ")} } from "../runtime.js";`];
  if (routes.length) lines.push(`import { ${routes.join(", ")} } from "../routes.js";`);
  const st = [ctx.usesG && "g", /\bGR\b/.test(text) && "GR"].filter(Boolean);
  if (st.length) lines.push(`import { ${st.join(", ")} } from "../state.js";`);
  lines.push(`import { ${["W", ...(/\bitems\(/.test(text) ? ["items"] : []), ...(/\bnextId\(/.test(text) ? ["nextId"] : [])].join(", ")} } from "./util.js";`);
  return `${lines.join("\n")}

// Page ${page.id}: its markup, and its code over the markup's elements.
W.push([${str(P.html)}, (${params}) => {
${text}
}]);
`;
}

// ---------------------------------------------------------------------------------------------
// The app: the shell, the router, and the external arms of update.

function appFile(spec) {
  const K = spec.pinned.length;
  const titles = spec.pages.map((p) => p.title);
  for (const t of [...titles, spec.app]) if (/[<&"`\\$]/.test(t)) throw new Error(`a title needs escaping: ${t}`);
  const pinned = spec.pinned.map((id, i) => `<button data-key=${id} data-role=navLink${i === 0 ? " aria-current=page" : ""}>${titles[spec.pages.findIndex((p) => p.id === id)]}</button>`).join("");
  const shell = `<header data-key=shell data-role=shell><strong>${spec.app}</strong><nav data-role=nav>${pinned}<button data-role=menu aria-expanded=false>All pages</button></nav><p><span data-role=user></span> · <span data-role=cartCount></span> · <span data-role=noticeCount>`;
  const M = K + 2; // the menu button; the nav buttons are E[2] to E[K + 1]; then <p>, then the three spans
  const initial = initLiteral(spec.initialState.global, { });
  return `import { schedule, flush, cancel, el, on, text, prop } from "./runtime.js";
import { up, reg } from "./routes.js";
import { g, GR } from "./state.js";
import { W, items } from "./pages/util.js";
${spec.pages.map((p) => `import "./pages/${p.id}.js";`).join("\n")}

// The pages' titles: page \`pN\` is PAGES[N - 1] (the nav bar, the menu and its heading).
const PAGES = ${literal(titles, "")};

export function start(root) {
  // The global state (TEA's \`init\`, its global part), fresh for every mount.
  Object.assign(g, ${initial});
  root.insertAdjacentHTML("beforeend", "<div data-role=app>");
  const app = root.lastChild;
  let route = 1;

  // The shell: the nav bar, the menu and the three global reads, for as long as the app lives.
  const shell = up(app, "beforeend", ${str(shell)}, (E, G, D, header) => {
    let menu;
    const shut = () => {
      menu?.remove();
      menu = null;
      E[${M}].ariaExpanded = "false";
    };
    on(E[${M}], () => {
      if (menu) return shut();
      menu = el("nav", null, { "data-role": "menuList" });
      header.after(menu);
      PAGES.forEach((title, i) => el("button", menu, { "data-key": "p" + (i + 1), "data-role": "menuLink" }, title));
      E[${M}].ariaExpanded = "true";
    });
    const mark = () => {
      for (let i = 1; i <= ${K}; i++) prop(E[i + 1], i == route ? "page" : null, "ariaCurrent");
    };
    const user = () => text(E[${M + 2}], "Signed in as " + g.user);
    const cart = () => text(E[${M + 3}], "Cart: " + g.cart.length);
    const notices = () => text(E[${M + 4}], g.notices.length + " notices");
    G.push(mark, user, cart, notices);
    reg(D, GR.user, user);
    reg(D, GR.cart, cart);
    reg(D, GR.notices, notices);
    return { mark, shut };
  });

  // The page shown: built when the route reaches it, disposed when it leaves.
  const open = () => up(app, "beforeend", \`<main data-key=p\${route} data-role=page><h1>\${PAGES[route - 1]}</h1>\${W[route][0]}\`, W[route][1]);
  let page = open();

  function go(n) {
    shell.shut();
    if (n == route) return;
    page.down();
    route = n;
    page = open();
    schedule(shell.mark);
  }

  // Navigation by delegation: the nav bar, the menu and the pages' links are buttons whose key is the page.
  app.addEventListener("click", (e) => {
    const { role, key } = e.target.dataset;
    if (/^(nav|menu|page)Link$/.test(role)) go(+key.slice(1));
  });
  flush();

  // The arms of update still reached by a message: external events.
  function receive(msg) {
    switch (msg.type) {
      case "deepLink":
        go(+msg.route.slice(1));
        break;
      case "serverSet":
        g[msg.field] = msg.value;
        schedule(GR[msg.field]);
        break;
      case "notify":
        g.notices = [...g.notices, structuredClone(msg.item)];
        schedule(GR.notices);
        break;
      case "pagePush":
        if (msg.page == "p" + route) page.push?.(structuredClone(msg.item));
        break;
      case "snapshot":
        Object.assign(g, structuredClone(msg.global));
        schedule(Object.values(GR));
        break;
    }
  }

  function stop() {
    page.down();
    shell.down();
    cancel();
    app.remove();
  }

  return { receive, stop };
}
`;
}

export function emit(spec) {
  if (spec.pages.some((p, i) => p.id !== `p${i + 1}`)) throw new Error("page ids are not p1, p2, … in order");
  const globalReads = new Set(SHELL_READS);
  const files = {
    ...templateFiles({ name: "routed-app", title: "Routed app", extra: ["routes.js"] }),
    "src/pages/util.js": UTIL_FILE,
  };
  for (const p of spec.pages) files[`src/pages/${p.id}.js`] = pageFile(p, spec, globalReads);
  files["src/state.js"] = `// The global state, shared by the shell and the pages: its fields (filled by start), and each
// field's readers, the bindings that read it while they are mounted. A unit adds its group when
// it is built and takes it out when it goes, so a write schedules only what is shown.
export const g = {};
export const GR = { ${spec.global.map((f) => f.name).filter((n) => globalReads.has(n)).map((n) => `${n}: []`).join(", ")} };
`;
  files["src/app.js"] = appFile(spec);
  return {
    files,
    style: {
      track: "prototype: no framework implements this strategy",
      components: "one module per page (its tabs and modal inside, sharing its state); a unit is a markup string and a function over its elements (E[n]), built when shown and disposed when it leaves; the shell lives as long as the app",
      lifetime: "up() builds a unit and gives it a list of disposers; down() runs them once: its nodes, its timers (every) and its entries in the reader groups outside it (reg: global fields, the page's fields)",
      routing: "in-app state: a route number, the page built on go(); one delegated click listener for the nav bar, the menu and the pages' links",
      messages: "erased for DOM events: each update arm is inlined into the action its control calls, which writes the unit's fields in place",
      updates: "each action schedules the binding groups of the fields it writes (known at compile time): the unit's own, the page's, and for global fields the groups registered outside every unit (GR); one microtask flush",
      lists: "page-local lists edit rows in place (add) and remove by replacing the array; global lists are replaced and their groups reconcile by id",
      externalEvents: "receive(msg): serverSet and notify write the global field and schedule its readers; snapshot replaces the global state and schedules all readers; pagePush calls the arm of the page shown",
      build: "Vite with no framework plugin, production defaults, hidden source maps",
    },
  };
}
