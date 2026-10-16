// routed-app as tea-dirtybits, a prototype strategy (see frameworks/tea-dirtybits/README.md).
//
// This emitter plays the compiler: it writes what an ideal TEA compiler with dirty bits would emit
// for an app of pages, where only the shell and the page shown exist. Style (recorded in every
// generated app's rr.json):
// - Real messages and reducers. The model is the reference's shape, `{ route, menu, global, page }`,
//   where `page` is the shown page's local state `{ fields, tab, panel, modal }`. A message is
//   `{ type, id?, value? }` (a tag number, or a name for an external event); the app reducer
//   sends it to the arm of the page shown. An arm returns `[bits, model]`: the compile-time dirty
//   bits of what it wrote, and the new model.
// - ONE dirty word per event, `dirty.a`: bits 0 to 5 are the six global fields (the same numbers
//   in every page), the next are the shown page's own fields, then its tab bit, then the fields of
//   its tab panels (every panel starts at the same bit, because one is mounted at a time), then the
//   modal's. A global write marks its bits straight in that word, so no mapping from global to
//   local bits exists. `dirty.n` holds the shell's two: route changed, menu changed.
// - A page is a unit with its own module (src/pages/<id>.js): its bits, its reducer (one table for
//   the page, its tabs and its modal, by tag), its initial local state, and its mount function,
//   which builds the page once from one static template and returns
//   `[root, patch, stop]`. The patch tests only the bits of its own bindings (global ones included),
//   so the global bits a page does not read cost nothing, and a page that is not mounted has no
//   patch to run. Tab panels and the modal are units of their own, mounted by a `slot` in the page
//   when the tab or the modal appears and torn down when it goes.
// - Lifetime is in the runtime's `slot` (template/routes.js): it builds a unit when its key
//   appears and runs its `stop` (timers, nested slots) and removes its root when the key changes.
//   The shell mounts the page and the "All pages" menu through the same slot, so only the shell and
//   the page shown (with its open tab and modal) ever have nodes, listeners or timers.
// - A time-driven field starts one `setInterval` when its unit mounts, which sends a tick message
//   to the page's reducer; the unit's `stop` clears it.
// - Each page is its own code, written from its description alone: nothing is interpreted.

import { templateFiles, templateFile, trimTemplate } from "../../frameworks/tea-dirtybits/framework.js";
import { literal, tplText } from "../../frameworks/shared/jsx.js";

export const framework = "tea-dirtybits";

export const params = {};

const J = JSON.stringify;
const indent = (lines, n = 2) => lines.join("\n").split("\n").map((l) => (l ? " ".repeat(n) + l : l)).join("\n");
const OPS = { "==": "===", "!=": "!==", "<": "<", "<=": "<=", ">": ">", ">=": ">=", and: "&&", or: "||" };

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);

// Which module a helper comes from.
const FROM_ROUTES = new Set(["go", "slot", "tap", "typed", "typedInt", "nextId", "setF", "setP", "setM", "setG", "putModal", "putTab"]);

const PAGE_FILE = `// Every page, by id: [mount, reducer, initial local state] (each module adds its own when the
// app imports it).
export const PAGES = {};
`;

// ---------------------------------------------------------------------------------------------
// Static markup: elements are built as a tree so the nodes the code touches can be numbered the
// way \`template()\` returns them: every element with a data-role, a \`b\` marker or no children,
// in document order.

let eid = 0;
const el = (tag, attrs, kids) => ({ id: ++eid, tag, attrs, kids, marker: false });
const ref = (e) => `@${e.id}@`;
const VOID = new Set(["input"]);
const ser = (e) =>
  `<${e.tag}${e.attrs ? " " + e.attrs : ""}${e.marker ? " b" : ""}>${e.kids.map((k) => (typeof k === "string" ? k : ser(k))).join("")}${VOID.has(e.tag) ? "" : `</${e.tag}>`}`;
const selected = (e) => e.marker || /(^| )data-role=/.test(e.attrs) || e.kids.length === 0;
function numbering(root) {
  const map = new Map();
  const walk = (e) => {
    if (selected(e)) map.set(e.id, map.size);
    for (const k of e.kids) if (typeof k !== "string") walk(k);
  };
  walk(root);
  return map;
}
// Replace the placeholders of a tree's elements by `prefix[index]`.
const resolve = (src, map, prefix) => src.replace(/@(\d+)@/g, (all, id) => (map.has(+id) ? `${prefix}[${map.get(+id)}]` : all));

// ---------------------------------------------------------------------------------------------
// One page module

function pageModule(spec, page, GB) {
  const GLOBAL = Object.fromEntries(spec.global.map((f) => [f.name, f]));
  const tabs = page.tabs ?? [];
  const modal = page.modal ?? null;
  const helpers = new Set();
  const use = (...names) => names.forEach((n) => helpers.add(n));
  const bitList = (bits) => bits.reduce((a, b) => a | b, 0);

  // Field bits: a component's fields are numbered in the order its view first reads them.
  function fieldOrder(comp) {
    const order = [];
    const msgOf = (name) => comp.messages.find((m) => m.name === name);
    const reach = (x) => {
      if (Array.isArray(x)) {
        if (x[0] === "f" && typeof x[1] === "string") {
          if (!order.includes(x[1])) order.push(x[1]);
        } else x.forEach(reach);
      } else if (x && typeof x === "object") {
        const field = x.el === "list" ? x.field : x.msg && msgOf(x.msg)?.field;
        if (field && field[0] === "f" && !order.includes(field[1])) order.push(field[1]);
        Object.values(x).forEach(reach);
      }
    };
    reach(comp.view);
    for (const f of comp.fields) if (!order.includes(f.name)) order.push(f.name);
    return order;
  }
  const pageOrder = fieldOrder(page);
  const pageBit = Object.fromEntries(pageOrder.map((n, i) => [n, 1 << (6 + i)]));
  const TAB = tabs.length ? 1 << (6 + page.fields.length) : 0;
  const tabBase = 6 + page.fields.length + (tabs.length ? 1 : 0);
  const tabOrders = tabs.map(fieldOrder);
  const modalBase = tabBase + Math.max(0, ...tabs.map((t) => t.fields.length));
  const modalOrder = modal ? fieldOrder(modal) : [];
  const top = modal ? modalBase + modal.fields.length : tabBase + Math.max(0, ...tabs.map((t) => t.fields.length));
  if (top > 29) throw new Error(`${page.id}: ${top} dirty bits`);

  // Components: the page, each tab panel, the modal.
  const comps = [
    { kind: "page", comp: page, path: "m.page.fields", set: "setF", order: pageOrder, bit: pageBit },
    ...tabs.map((t, i) => ({
      kind: "tab", comp: t, path: "m.page.panel", set: "setP", order: tabOrders[i],
      bit: Object.fromEntries(tabOrders[i].map((n, k) => [n, 1 << (tabBase + k)])),
    })),
    ...(modal ? [{
      kind: "modal", comp: modal, path: "m.page.modal", set: "setM", order: modalOrder,
      bit: Object.fromEntries(modalOrder.map((n, k) => [n, 1 << (modalBase + k)])),
    }] : []),
  ];
  const bitOf = (c, r) => (r[0] === "g" ? GB[r[1]] : r[0] === "p" ? pageBit[r[1]] : c.bit[r[1]]);
  const fieldDesc = (c, r) => (r[0] === "g" ? GLOBAL[r[1]] : (r[0] === "p" ? page : c.comp).fields.find((f) => f.name === r[1]));

  // Messages are numbered, as Elm --optimize tags constructors, in the order the page's view first
  // sends them (then its tabs', then the modal's), then the rest; time-driven fields' ticks last.
  const order = [];
  const sends = (nodes) => {
    for (const n of nodes) {
      if (n.el === "tabs" && !order.includes("$tab")) order.push("$tab");
      for (const k of ["msg", "check", "remove"]) if (n[k] && !order.includes(n[k])) order.push(n[k]);
      if (n.children) sends(n.children);
    }
  };
  for (const c of comps) sends(c.comp.view);
  for (const c of comps) for (const m of c.comp.messages) if (!order.includes(m.name)) order.push(m.name);
  for (const c of comps) if (c.comp.fields.some((f) => f.every)) order.push(c.kind === "tab" ? `$tick:${c.comp.id}` : "$tick");
  const tag = (name) => order.indexOf(name);
  const ownerOf = (name) => comps.find((c) => c.comp.messages.some((m) => m.name === name));

  // -------------------------------------------------------------------------------------------
  // The reducer

  function expr(c, e) {
    const E = (x) => expr(c, x);
    switch (e[0]) {
      case "f": return `${c.path}.${e[1]}`;
      case "p": return `m.page.fields.${e[1]}`;
      case "g": return `m.global.${e[1]}`;
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

  // An arm: `{ bits, lines }`; its last line is the returned `[bits, model]`.
  function arm(m, c) {
    const R = (r) => expr(c, r);
    const guard = [];
    let when = "";
    const writes = new Map();
    const set = (r, src) => {
      const key = r[0] + ":" + r[1];
      if (writes.has(key)) throw new Error(`${page.id}.${m.name} writes ${key} twice`);
      writes.set(key, { r, src });
    };
    let model = "m";
    const finish = () => {
      // The areas written, in a fixed order; a confirm drops the modal's own fields (it closes).
      const areas = { setF: [], setP: [], setM: [], setG: [] };
      let bits = 0;
      for (const { r, src } of writes.values()) {
        const area = r[0] === "g" ? "setG" : r[0] === "p" ? "setF" : c.set;
        if (m.kind === "confirm" && area === "setM") continue;
        areas[area].push(`${r[1]}: ${src}`);
        bits |= bitOf(c, r);
      }
      for (const [fn, entries] of Object.entries(areas)) {
        if (entries.length) {
          use(fn);
          model = `${fn}(${model}, { ${entries.join(", ")} })`;
        }
      }
      return bits;
    };
    switch (m.kind) {
      case "open":
        use("putModal");
        return { bits: 0, lines: [`return [0, putModal(m, modalInit)];`] };
      case "close":
        use("putModal");
        return { bits: 0, lines: [`return [0, putModal(m, null)];`] };
      case "input": case "select": set(m.field, "msg.value"); break;
      case "check": set(m.field, `!${R(m.field)}`); break;
      case "item": {
        const L = R(m.field);
        set(m.field, m.op === "remove"
          ? `${L}.filter((item) => item.id !== msg.id)`
          : `${L}.map((item) => (item.id === msg.id ? { ...item, done: !item.done } : item))`);
        break;
      }
      case "click": case "confirm": {
        const alone = m.ops.length === 1;
        for (const op of m.ops) {
          const [kind, r] = op;
          const f = fieldDesc(c, r);
          const S = R(r);
          switch (kind) {
            case "add":
              set(r, op[2] > 0 ? `Math.min(${f.max}, ${S} + ${op[2]})` : `Math.max(${f.min}, ${S} - ${-op[2]})`);
              break;
            case "set": set(r, J(op[2])); break;
            case "toggle": set(r, `!${S}`); break;
            case "reset": set(r, J(f.initial)); break;
            case "cycle": {
              const o = f.options;
              set(r, "(" + o.slice(0, -1).map((v, i) => `${S} === ${J(v)} ? ${J(o[i + 1])} : `).join("") + J(o[0]) + ")");
              break;
            }
            case "copy":
              if (writes.has(op[2][0] + ":" + op[2][1])) throw new Error(`${m.name}: copy reads a written field`);
              set(r, R(op[2]));
              break;
            case "push": {
              use("nextId");
              guard.push(`const text = ${R(op[2])}.trim();`);
              const item = `{ id: nextId(${S}), text${f.checkable ? ", done: false" : ""} }`;
              if (alone) {
                when = `text !== ""`;
                set(r, `[...${S}, ${item}]`);
                set(op[2], '""');
              } else if (m.kind === "confirm") set(r, `text === "" ? ${S} : [...${S}, ${item}]`);
              else throw new Error("push with other ops");
              break;
            }
            case "pushText":
              use("nextId");
              set(r, `[...${S}, { id: nextId(${S}), text: ${J(op[2])}${f.checkable ? ", done: false" : ""} }]`);
              break;
            case "pop": case "shift": case "clear": case "clearDone":
              if (!alone) throw new Error(`${kind} with other ops`);
              when = kind === "clearDone" ? `${S}.some((item) => item.done)` : `${S}.length > 0`;
              set(r, { pop: `${S}.slice(0, -1)`, shift: `${S}.slice(1)`, clear: "[]", clearDone: `${S}.filter((item) => !item.done)` }[kind]);
              break;
            default: throw new Error(`unknown op ${kind}`);
          }
        }
        break;
      }
      default: throw new Error(`unknown message kind ${m.kind}`);
    }
    const bits = finish();
    if (m.kind === "confirm") {
      use("putModal");
      model = `putModal(${model}, null)`;
    }
    return { bits, lines: [...guard, `return ${when ? when + " && " : ""}[${bits}, ${model}];`] };
  }

  const arms = [];
  for (const [name, i] of order.map((n, i) => [n, i])) {
    if (name === "$tab") {
      use("putTab");
      arms.push({ key: i, name: "tab", lines: [`return m.page.tab !== msg.id && [${TAB}, putTab(m, msg.id, panels[msg.id])];`] });
    } else if (name.startsWith("$tick")) {
      const c = name === "$tick" ? comps[0] : comps.find((x) => x.kind === "tab" && x.comp.id === name.slice(6));
      const f = c.comp.fields.find((x) => x.every);
      use(c.set);
      arms.push({ key: i, name, lines: [
        `const ${f.name} = Math.min(${f.max}, ${c.path}.${f.name} + ${f.by});`,
        `if (${f.name} !== ${c.path}.${f.name}) return [${bitOf(c, ["f", f.name])}, ${c.set}(m, { ${f.name} })];`,
      ] });
    } else {
      const c = ownerOf(name);
      const m = c.comp.messages.find((x) => x.name === name);
      arms.push({ key: i, name, lines: arm(m, c).lines });
    }
  }
  const feed = page.fields.find((f) => f.feed);
  if (feed) {
    use("setF");
    arms.push({ key: "pagePush", lines: [`return [${pageBit[feed.name]}, setF(m, { ${feed.name}: [...m.page.fields.${feed.name}, msg.item] })];`] });
  }
  const armFn = (a) => {
    const body = a.lines.join("\n");
    const args = /\bmsg\b/.test(body) ? "(m, msg)" : "(m)";
    if (a.lines.length === 1 && body.startsWith("return ")) return `${args} => ${body.slice(7, -1)}`;
    return `${args} => {\n${body.split("\n").map((l) => "    " + l).join("\n")}\n  }`;
  };
  const numeric = arms.every((a, i) => a.key === i);
  const reducer = numeric
    ? `[\n${arms.map((a) => `  ${armFn(a)}, // ${a.name}`).join("\n")}\n]`
    : `{\n${arms.map((a) => `  ${a.key}: ${armFn(a)},${a.name ? " // " + a.name : ""}`).join("\n")}\n}`;

  // -------------------------------------------------------------------------------------------
  // The views: one static template per unit, nodes found by their position in it, and bindings
  // grouped by the bits they depend on.

  let uid = 0;
  const name = (p = "e") => p + ++uid;
  const scope = () => ({ groups: new Map(), deps: new Set() });
  const bind = (sc, deps, stmt) => {
    const key = [...deps].sort().join("|");
    if (!sc.groups.has(key)) sc.groups.set(key, { deps: [...deps], stmts: [] });
    sc.groups.get(key).stmts.push(stmt);
    for (const d of deps) sc.deps.add(d);
  };
  // The static patch of a scope: one test per group of bindings, in the order of their masks. A
  // group whose mask covers every bit the patch can run with needs no test (`cover`).
  const patchBody = (sc, ind, cover) => {
    const out = [];
    const groups = [...sc.groups.values()].map((g) => [bitList(g.deps), g]).sort((x, y) => x[0] - y[0]);
    for (const [mask, g] of groups) {
      if ((mask & cover) === cover) out.push(...g.stmts.map((s) => `${ind}${s}`));
      else if (g.stmts.length === 1) out.push(`${ind}if (d & ${mask}) ${g.stmts[0]}`);
      else out.push(`${ind}if (d & ${mask}) {`, ...g.stmts.map((s) => `${ind}  ${s}`), `${ind}}`);
    }
    return out;
  };

  // An expression of the unit's patch: its own state is `s`, the model `m`.
  function ex(c, e, deps) {
    const E = (x) => ex(c, x, deps);
    switch (e[0]) {
      case "f": deps.add(bitOf(c, e)); return `s.${e[1]}`;
      case "p": deps.add(bitOf(c, e)); return `m.page.fields.${e[1]}`;
      case "g": deps.add(bitOf(c, e)); return `m.global.${e[1]}`;
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

  function textOf(c, parts, deps) {
    if (parts.every((p) => typeof p === "string")) return { stat: parts.join("") };
    if (parts.length === 1) return { src: ex(c, parts[0], deps) };
    const body = parts.map((p) => (typeof p === "string" ? tplText(p) : `\${${ex(c, p, deps)}}`)).join("");
    return { src: `\`${body}\`` };
  }

  // Builds the elements of `nodes`; declarations go to `u.out`, event wiring to `u.wires`,
  // bindings to `sc`.
  function build(c, u, nodes, sc) {
    const L = (line) => u.out.push(line);
    const kids = [];
    for (const n of nodes) {
      switch (n.el) {
        case "text": {
          const deps = new Set();
          const t = textOf(c, n.parts, deps);
          const e = el(n.tag, "", t.stat ? [esc(t.stat)] : []);
          if (t.stat === undefined) {
            use("setText");
            bind(sc, deps, `setText(${ref(e)}, ${t.src});`);
          }
          kids.push(e);
          break;
        }
        case "button": {
          use("tap");
          const deps = new Set();
          const t = textOf(c, n.text, deps);
          const e = el("button", `data-role=${n.msg}`, t.stat ? [esc(t.stat)] : []);
          if (t.stat === undefined) {
            use("setText");
            bind(sc, deps, `setText(${ref(e)}, ${t.src});`);
          }
          if (n.disabled) {
            const d = new Set();
            use("setDisabled");
            bind(sc, d, `setDisabled(${ref(e)}, ${ex(c, n.disabled, d)});`);
          }
          u.wires.push(`tap(${ref(e)}, ${tag(n.msg)});`);
          kids.push(e);
          break;
        }
        case "link": {
          use("go");
          const e = el("button", `data-key=${n.to} data-role=pageLink`, [esc(n.text)]);
          u.wires.push(`go(${ref(e)}, ${J(n.to)});`);
          kids.push(e);
          break;
        }
        case "open": {
          use("tap");
          const e = el("button", `data-role=${n.msg}`, [esc(n.text)]);
          u.wires.push(`tap(${ref(e)}, ${tag(n.msg)});`);
          kids.push(e);
          break;
        }
        case "input": {
          const m = c.comp.messages.find((x) => x.name === n.msg);
          const f = fieldDesc(c, m.field);
          const bit = bitOf(c, m.field);
          let i;
          if (f.type === "int") {
            use("typedInt", "setNumber");
            i = el("input", `type=number data-role=${n.msg}`, []);
            u.wires.push(`typedInt(${ref(i)}, ${tag(n.msg)}, ${f.min}, ${f.max});`);
            bind(sc, new Set([bit]), `setNumber(${ref(i)}, ${ex(c, m.field, new Set())});`);
          } else {
            use("typed", "setValue");
            i = el("input", `type=text data-role=${n.msg}${n.placeholder ? ` placeholder="${esc(n.placeholder)}"` : ""}`, []);
            u.wires.push(`typed(${ref(i)}, ${tag(n.msg)});`);
            bind(sc, new Set([bit]), `setValue(${ref(i)}, ${ex(c, m.field, new Set())});`);
          }
          kids.push(n.label ? el("label", "", [esc(n.label), i]) : i);
          if (n.invalid) {
            use("branch");
            const e = name();
            const p = el("p", `data-role=${n.msg}Error`, [esc(n.invalid.message)]);
            kids.push(p);
            L(`const ${e} = branch(${ref(p)});`);
            const deps = new Set();
            bind(sc, deps, `${e}(${ex(c, n.invalid.when, deps)});`);
          }
          break;
        }
        case "check": {
          use("tap", "setChecked");
          const m = c.comp.messages.find((x) => x.name === n.msg);
          const i = el("input", `type=checkbox data-role=${n.msg}`, []);
          kids.push(el("label", "", [i, esc(n.label)]));
          u.wires.push(`tap(${ref(i)}, ${tag(n.msg)});`);
          bind(sc, new Set([bitOf(c, m.field)]), `setChecked(${ref(i)}, ${ex(c, m.field, new Set())});`);
          break;
        }
        case "select": {
          use("typed", "setValue");
          const m = c.comp.messages.find((x) => x.name === n.msg);
          const s = el("select", `data-role=${n.msg}`, fieldDesc(c, m.field).options.map((o) => el("option", `value="${esc(o)}"`, [esc(o)])));
          kids.push(n.label ? el("label", "", [esc(n.label), s]) : s);
          u.wires.push(`typed(${ref(s)}, ${tag(n.msg)});`);
          bind(sc, new Set([bitOf(c, m.field)]), `setValue(${ref(s)}, ${ex(c, m.field, new Set())});`);
          break;
        }
        case "list": {
          use("template", "setText", "list");
          const l = name();
          const ul = el(n.tag, "", []);
          kids.push(ul);
          // The row: its own static template, numbered on its own.
          const box = n.check ? el("input", `type=checkbox data-role=${n.check}`, []) : null;
          const label = el("span", "", []);
          label.marker = true;
          const remove = n.remove ? el("button", `data-role=${n.remove}`, [esc(n.removeText)]) : null;
          const row = el("li", `data-role=${n.field[1]}Item`, [box, label, remove].filter(Boolean));
          const map = numbering(row);
          const R = (e) => resolve(ref(e), map, "r");
          const lines = [`const ${l} = list(${ref(ul)}, (item) => {`, `  const r = template(${J(trimTemplate(ser(row)))});`];
          if (n.check) {
            use("tap", "setChecked");
            lines.push(`  tap(${R(box)}, ${tag(n.check)}, item.id);`);
          }
          if (n.remove) {
            use("tap");
            lines.push(`  tap(${R(remove)}, ${tag(n.remove)}, item.id);`);
          }
          if (n.check) {
            lines.push(`  return [r[0], (item) => {`, `    setChecked(${R(box)}, item.done);`, `    setText(${R(label)}, item.text);`, `  }];`);
          } else lines.push(`  return [r[0], (item) => setText(${R(label)}, item.text)];`);
          lines.push(`});`);
          u.out.push(...lines);
          bind(sc, new Set([bitOf(c, n.field)]), `${l}(${ex(c, n.field, new Set())});`);
          break;
        }
        case "group": {
          kids.push(el(n.tag, "", build(c, u, n.children, sc)));
          break;
        }
        case "when": {
          use("branch");
          const cname = name();
          const inner = scope();
          const e = el(n.tag, "", []);
          e.marker = true;
          e.kids = build(c, u, n.children, inner);
          kids.push(e);
          const deps = new Set(inner.deps);
          const cond = ex(c, n.cond, deps);
          // Its patch runs when the bits of the binding below are set (or with every bit).
          const patch = patchBody(inner, "  ", bitList([...deps]));
          if (patch.length) {
            L(`const ${cname} = branch(${ref(e)}, (s, d, m) => {`);
            u.out.push(...patch);
            L(`});`);
          } else L(`const ${cname} = branch(${ref(e)});`);
          bind(sc, deps, patch.length ? `${cname}(${cond}, s, d, m);` : `${cname}(${cond});`);
          break;
        }
        case "tabs": {
          use("slot", "prop");
          const bar = el("nav", "data-role=tabs", tabs.map((t) => {
            const b = el("button", `data-key=${t.id} data-role=tab`, [esc(t.label)]);
            use("tap");
            u.wires.push(`tap(${ref(b)}, ${tag("$tab")}, ${J(t.id)});`);
            bind(sc, new Set([TAB]), `prop(${ref(b)}, "ariaSelected", "" + (m.page.tab === ${J(t.id)}));`);
            return b;
          }));
          kids.push(bar);
          L(`const tabSlot = slot((n) => ${ref(bar)}.after(n), (k) => tabMounts[k]());`);
          break;
        }
        default: throw new Error(`unknown view node ${n.el}`);
      }
    }
    return kids;
  }

  // A unit's mount function.
  function unit(c) {
    uid = 0;
    const u = { out: [], wires: [] };
    const root = c.kind === "page" ? el("main", `data-key=${page.id} data-role=page`, [])
      : c.kind === "tab" ? el("section", `data-key=${c.comp.id} data-role=panel`, [])
        : el("aside", "data-key=modal data-role=dialog", []);
    const head = c.kind === "page" ? [el("h1", "", [esc(page.title)])] : c.kind === "modal" ? [el("h2", "", [esc(modal.title)])] : [];
    const sc = scope();
    root.kids = [...head, ...build(c, u, c.comp.view, sc)];
    use("template");
    const stops = [];
    const tail = [];
    const lines = [];
    if (c.kind === "page" && modal) {
      use("slot");
      u.out.push(`const modalSlot = slot((n) => ${ref(root)}.append(n), modalMount);`);
      tail.push(`modalSlot(m.page.modal !== null, m.page.modal, d, m);`);
    }
    if (c.kind === "page" && tabs.length) tail.unshift(`tabSlot(m.page.tab, m.page.panel, d, m);`);
    const live = c.comp.fields.find((f) => f.every);
    if (live) {
      use("send");
      lines.push(`const timer = setInterval(() => send({ type: ${tag(c.kind === "tab" ? `$tick:${c.comp.id}` : "$tick")} }), ${live.every});`);
      stops.push("clearInterval(timer)");
    }
    if (c.kind === "page" && tabs.length) stops.push("tabSlot.stop()");
    const map = numbering(root);
    const patch = patchBody(sc, "    ", -1);
    const body = [`const t = template(${J(trimTemplate(ser(root)))});`, ...u.out, ...u.wires, ...lines];
    const stop = stops.length === 0 ? "" : stops.length === 1 && stops[0] === "tabSlot.stop()" ? ", tabSlot.stop" : stops.length === 1 ? `, () => ${stops[0]}` : `, () => {\n${stops.map((s) => `      ${s};`).join("\n")}\n    }`;
    const src = `() => {
${indent(body, 2)}
  return [t[0], (s, d, m) => {
${[...patch, ...tail.map((l) => "    " + l)].join("\n")}
  }${stop}];
}`;
    return resolve(src, map, "t");
  }

  const mounts = comps.map((c) => ({ c, src: unit(c) }));
  const tabMounts = mounts.filter((x) => x.c.kind === "tab");
  const modalMount = mounts.find((x) => x.c.kind === "modal");
  const pageMount = mounts[0];

  // The initial local state when the page mounts, and the fresh state of a tab panel or modal.
  const initOf = (comp) => Object.fromEntries(comp.fields.map((f) => [f.name, f.initial]));
  const parts = [];
  if (tabs.length) parts.push(`// A tab panel starts from these when it is selected.\nconst panels = ${literal(Object.fromEntries(tabs.map((t) => [t.id, initOf(t)])), "")};`);
  if (modal) parts.push(`// The modal starts from this each time it opens.\nconst modalInit = ${literal(initOf(modal), "")};`);
  if (modal) parts.push(`const modalMount = ${modalMount.src};`);
  if (tabs.length) parts.push(`const tabMounts = {\n${tabMounts.map((x) => `  ${x.c.comp.id}: ${x.src.replace(/\n/g, "\n  ")},`).join("\n")}\n};`);

  const bitsDoc = [
    ...spec.global.map((f) => `${f.name} ${GB[f.name]}`),
    ...pageOrder.map((n) => `${n} ${pageBit[n]}`),
    ...(tabs.length ? [`tab ${TAB}`] : []),
    ...comps.filter((c) => c.kind !== "page").flatMap((c) => c.order.map((n) => `${c.comp.id ?? "modal"}.${n} ${c.bit[n]}`)),
  ];
  const init = `{ fields: ${literal(initOf(page), "  ")}, tab: ${tabs.length ? J(tabs[0].id) : "null"}, panel: ${tabs.length ? "panels." + tabs[0].id : "null"}, modal: null }`;
  const rt = [...helpers].filter((h) => !FROM_ROUTES.has(h)).sort();
  const rts = [...helpers].filter((h) => FROM_ROUTES.has(h)).sort();
  const file = `import { ${rt.join(", ")} } from "../runtime.js";
${rts.length ? `import { ${rts.join(", ")} } from "../routes.js";\n` : ""}import { PAGES } from "./page.js";

// Dirty bits: ${bitsDoc.join(", ")}.
// Message tags: ${order.map((n, i) => `${n} ${i}`).join(", ")}.

${parts.join("\n\n")}${parts.length ? "\n\n" : ""}// The page: its DOM factory, its reducer and its initial local state.
PAGES.${page.id} = [
  // Builds the page once and returns [root, patch, stop].
  ${pageMount.src.replace(/\n/g, "\n  ")},

  ${indent([reducer], 2).trimStart()},

  ${init},
];
`;
  return file;
}

// ---------------------------------------------------------------------------------------------
// The app module: the shell, the reducer's router, and the slots for the page and the menu

function appFile(spec, GB) {
  const pinned = spec.pinned.map((id) => spec.pages.find((p) => p.id === id));
  const first = spec.pages[0].id;
  uidReset();
  const pins = pinned.map((p) => el("button", `data-key=${p.id} data-role=navLink`, [esc(p.title)]));
  const menuBtn = el("button", "data-role=menu", ["All pages"]);
  const user = el("span", "data-role=user", []);
  const cart = el("span", "data-role=cartCount", []);
  const notices = el("span", "data-role=noticeCount", []);
  const header = el("header", "data-key=shell data-role=shell", [
    el("strong", "", [esc(spec.app)]),
    el("nav", "data-role=nav", [...pins, menuBtn]),
    el("p", "", [user, " · ", cart, " · ", notices]),
  ]);
  const app = el("div", "data-role=app", [header]);
  const map = numbering(app);
  const T = (e) => resolve(ref(e), map, "t");
  const menu = el("nav", "data-role=menuList", spec.pages.map((p) => el("button", `data-key=${p.id} data-role=menuLink`, [esc(p.title)])));
  const global = Object.fromEntries(spec.global.map((f) => [f.name, f.initial]));
  const gbits = Object.fromEntries(spec.global.filter((f) => ["user", "currency", "balance", "online"].includes(f.name)).map((f) => [f.name, GB[f.name]]));
  const all = (1 << spec.global.length) - 1;

  return `import { dirty, prop, setText, template } from "./runtime.js";
import { go, setG, slot, tap } from "./routes.js";
import { PAGES } from "./pages/page.js";
// Every page: each module adds its own [mount, reducer, initial local state].
${spec.pages.map((p) => `import "./pages/${p.id}.js";`).join("\n")}

// The "All pages" menu: the one part of the app that lists every page, built only while open.
const menuMount = () => {
  const t = template(${J(trimTemplate(ser(menu)))});
  t.forEach((b, i) => i && go(b, b.dataset.key));
  return [t[0]];
};

// The initial model: the shell's state, the global state, and the first page's local state. No
// other page is built or initialised.
export function init() {
  return { route: ${J(first)}, menu: false, global: ${literal(global, "  ")}, page: PAGES.${first}[2] };
}

// The bits of the global fields a server may set (the same numbers in every page).
const bits = ${literal(gbits)};

// A page's own message goes to the reducer of the page shown; its arm returns the bits of what it
// wrote and the new model. Dirty bits: route 1 and menu 2 in \`dirty.n\`; user 1, cart 2, notices 4,
// currency 8, balance 16 and online 32 are the low bits of \`dirty.a\`, which a page adds its own to.
function route(m, msg) {
  const next = PAGES[m.route][1][msg.type](m, msg);
  if (!next) return m;
  dirty.a |= next[0];
  return next[1];
}

export function update(m, msg) {
  switch (msg.type) {
    case "navigate":
    case "deepLink":
      if (msg.route === m.route) {
        if (!m.menu) return m;
        dirty.n |= 2;
        return { ...m, menu: false };
      }
      dirty.n |= 3;
      return { ...m, route: msg.route, menu: false, page: PAGES[msg.route][2] };
    case "menu":
      dirty.n |= 2;
      return { ...m, menu: !m.menu };
    case "serverSet":
      dirty.a |= bits[msg.field];
      return setG(m, { [msg.field]: msg.value });
    case "notify":
      dirty.a |= ${GB.notices};
      return setG(m, { notices: [...m.global.notices, msg.item] });
    case "snapshot":
      dirty.a |= ${all};
      return { ...m, global: msg.global };
    case "pagePush":
      // The page's subscription lives with the page: a push to another page is dropped.
      return msg.page === m.route ? route(m, msg) : m;
  }
  return route(m, msg);
}

let page, menu;

// Builds the shell once. The page and the menu are slots: built when their key appears and torn
// down when it changes. The returned patch updates the shell, then lets the slots mount and patch.
export function view(root, m) {
  const t = template(${J(trimTemplate(ser(app)))}, root);
  const pins = [${pins.map(T).join(", ")}];
  pins.forEach((b) => go(b, b.dataset.key));
  tap(${T(menuBtn)}, "menu");
  menu = slot((n) => ${T(header)}.after(n), () => menuMount());
  page = slot((n) => ${T(app)}.append(n), (k) => PAGES[k][0]());
  const patch = (m, d) => {
    const a = d.a;
    const g = m.global;
    if (a & ${GB.user}) setText(${T(user)}, "Signed in as " + g.user);
    if (a & ${GB.cart}) setText(${T(cart)}, "Cart: " + g.cart.length);
    if (a & ${GB.notices}) setText(${T(notices)}, g.notices.length + " notices");
    if (d.n & 1) pins.forEach((b) => prop(b, "ariaCurrent", m.route === b.dataset.key ? "page" : null));
    if (d.n & 2) prop(${T(menuBtn)}, "ariaExpanded", "" + m.menu);
    menu(m.menu, 0, 0, m);
    page(m.route, m.page.fields, a, m);
  };
  patch(m, { a: -1, n: -1 });
  return patch;
}

// Stops what is mounted: the page shown (its timers and its tab's).
export function stop() {
  page.stop();
}
`;
}

function uidReset() {
  eid = 0;
}

export function emit(spec) {
  eid = 0;
  const GB = Object.fromEntries(spec.global.map((f, i) => [f.name, 1 << i]));
  const files = {
    ...templateFiles({ name: "routed-app", title: "Routed app" }),
    "src/adapter.js": templateFile("routes-adapter.js"),
    "src/routes.js": templateFile("routes.js"),
    "src/pages/page.js": PAGE_FILE,
  };
  for (const p of spec.pages) files[`src/pages/${p.id}.js`] = pageModule(spec, p, GB);
  files["src/app.js"] = appFile(spec, GB);
  return {
    files,
    style: {
      components: "one module per page (bits, one reducer for the page, its tabs and its modal, initial local state, mount function with a static template whose bound elements are found by data-role, emptiness or a marker); tab panels and the modal are units of their own, mounted by a slot; nothing interpreted at runtime",
      lifetime: "only the shell and the page shown (with its open tab and modal) are built; a slot mounts a unit when its key appears and, when it changes, runs the unit's stop (clears its interval, stops its nested slot) and removes its root; the 'All pages' menu is a slot too, built only while open",
      state: "one immutable TEA model { route, menu, global, page } with the reference's shape; page-local state is replaced by the next page's initial state on navigation",
      updates: "reducers are tables of arms by message tag; each arm returns the compile-time dirty bits of what it wrote and the new model; one dirty word per event (the six global fields are its low bits, the page's own fields follow), so a global write marks bits and the mounted page's static patch tests only its own",
      externalEvents: "through the same reducer (send): navigate and deepLink replace the page, serverSet/notify/snapshot mark the global bits, pagePush reaches the arm of the page shown (dropped otherwise)",
      time: "one setInterval per mounted time-driven field, started when its unit mounts and cleared by the unit's stop; a tick is a message to the page's reducer",
      routing: "plain in-app state: a route field, buttons that send navigate, a slot that mounts the page",
      lists: "keyed by id: changed rows patched, gone rows removed, misplaced nodes moved in one walk",
      conditionals: "branches built once with the template, swapped for an empty comment while hidden, with their own nested patch",
      events: "addEventListener on each element; the handler sends a constant message (or one carrying the control's value)",
      build: "Vite with no framework plugin, production defaults, hidden source maps",
    },
  };
}
