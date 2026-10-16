// The big-table scenario as tea-inline, a prototype strategy (see frameworks/tea-inline/README.md).
//
// The emitter plays the compiler of a TEA app, as in unique-components: every table is its own
// component (src/tables/<id>.js), written out from its description as that table's own code.
// - A table's DOM is built once from one static HTML string (heading, toolbar, header row and an
//   empty body); its code refers to the buttons and the body by their place (`E[n]`). Its rows
//   are cloned from one row template per table, parsed once; a row's elements are found by
//   place in document order (`E[n]`, the row's own `tr` excluded).
// - Every message (a `case` arm of the table's `update`) is inlined into the action its control
//   calls: it writes the table's state in place (`s.rows`, `s.selected`, `s.rng`, `s.nextId`)
//   and schedules exactly the bindings that read what it wrote. No `Msg` object, no switch, no
//   op table, no column table: the row builder, the sorts, the cell formats and the computed
//   expressions are code, compiled from the description.
// - The bindings of a table, and who reads what (decided at compile time):
//     rows (the array)  the list, a reconcile by id; an action that replaces the array
//                       (create, clear, sort, removeChecked) schedules it, one that edits it in
//                       place schedules the matching DOM edit (`add`, `drop`, `swap`)
//     a row's cells     the row's `set`, which paints the row's item; an action that edits an
//                       item in place (toggle, bump, updateEvery, a server update) schedules
//                       the `set` of the rows it touched
//     selected          each row's `mark`, which reads `s.selected === item.id`: a row's marker
//                       changes only when its own id is the old or the new selection, so
//                       select schedules the `mark` of those two rows and no other
// - External events stay messages: `receive(msg)` applies serverRows, serverUpdate,
//   serverDelete and snapshot to the table's state (a copy of the message's rows) and
//   schedules its list or the rows it touched. These arms are the same for every table (they
//   move data, not columns), so they live once in src/app.js.
//
// Style choices (also in `style` below): one module per table; static markup parsed once and
// rows cloned from a template; listeners on each row's controls, the item in scope; in-place
// edits of the rows; sorts, filters and server pushes replace the array and reconcile by id;
// hand-trimmed markup (optional end tags and quotes left out: -0.8% bytes against writing them all
// out); one microtask flush; the keyed row list from the runtime's rows.js, and the scenario's
// PRNG, formatters and state helpers from scenario.js (counted as app code). Initial rows are built at mount with the table's own row builder.

import { templateFiles } from "../../frameworks/tea-inline/framework.js";

export const framework = "tea-inline";

export const params = {};

const str = JSON.stringify;
const num = (id) => Number(id.slice(1));
const escText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const attrValue = (v) => (/^[\w.:-]+$/.test(v) ? v : `"${v.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`);

// The shared helpers of the tables (generated: they depend on nothing a table decides).
const HELPER_FILE = `// A table's DOM: its section, keyed by its id (table i is ti), with the markup inside, appended to
// \`parent\`; returned as the buttons of its toolbar in order, then its body.
export function section(parent, i, html) {
  parent.insertAdjacentHTML("beforeend", \`<section data-key=t\${i} data-role=table>\${html}\`);
  return parent.lastChild.querySelectorAll("button,tbody");
}

// The tables by number, from 1: each table's module adds its markup and its function when the app
// imports it, in page order.
export const W = [,];
`;

// ---------------------------------------------------------------------------------------------
// Expressions of computed cells, compiled over \`item\`.

const col = (t, name) => t.columns.find((c) => c.name === name);

// A number column's formatted text, from a JavaScript expression of its value.
function fmt(c, v) {
  switch (c.format) {
    case "plain": return v;
    case "grouped": return `group(${v})`;
    case "unit": return `\`\${group(${v})} ${c.unit}\``;
    case "currency": return `money(${str(c.symbol)}, ${v})`;
    case "percent": return `percent(${v})`;
  }
  throw new Error(`unknown number format ${c.format}`);
}

const DATE_FORMAT = { "mon-d": "monD", "d-mon": "dMon", "mm-dd": "mmDd" };

function exprCode(e) {
  switch (e[0]) {
    case "*": return `item.${e[1]} * item.${e[2]}`;
    case "+": return `item.${e[1]} + item.${e[2]}`;
    case "len": return `item.${e[1]}.length`;
    case ">": return `item.${e[1]} > ${e[2]}`;
    case "==": return `item.${e[1]} == ${str(e[2])}`;
    case "f": return `item.${e[1]}`;
    case "if": return `${exprCode(e[1])} ? ${str(e[2])} : ${str(e[3])}`;
  }
  throw new Error(`unknown expression ${JSON.stringify(e)}`);
}

// ---------------------------------------------------------------------------------------------
// One table: its module.

function tableFile(t, spec) {
  const used = new Set(); // runtime names the code uses
  const use = (...names) => names.forEach((n) => used.add(n));
  const hasSelect = t.columns.some((c) => c.select);
  const L = "L";

  // ---- The markup: heading, toolbar, header, an empty body.
  let html = `<h2>${escText(t.title)}</h2><div>`;
  html += t.ops.map((o) => `<button data-role=${attrValue(o.name)}>${escText(o.text)}</button>`).join("");
  html += "</div><table>";
  if (t.thead) html += `<thead><tr>${t.columns.map((c) => `<th>${escText(c.header)}`).join("")}</tr>`;
  html += "<tbody>";
  // The end tags HTML makes optional are left out (the parser closes them at the end of the string).
  html = html.replace(/<\/tr>(?=<tbody>)/, "");

  // ---- The row template, and the code over its elements (E[n], in document order, tr excluded).
  let n = 0;
  const cells = [];
  const once = []; // run when the row is built
  const paints = []; // the row's `set`
  const events = [];
  const E = (k) => `E[${k}]`;
  for (const c of t.columns) {
    const td = n++;
    switch (c.kind) {
      case "id":
        cells.push("");
        once.push(`${E(td)}.textContent = item.id;`);
        break;
      case "label": case "text": {
        const value = `item.${c.name}`;
        if (c.select) {
          const a = n++;
          cells.push(`<a data-role=${attrValue(c.select)}></a>`);
          paints.push(`text(${E(a)}, ${value});`);
          events.push(`on(${E(a)}, () => {`, "  if (!s.rows.some((x) => x.id === item.id)) return;", "  const was = s.selected;", "  s.selected = item.id;", `  schedule(${L}.get(was)?.[2], mark);`, "});");
          use("text", "on", "schedule");
        } else {
          cells.push("");
          paints.push(`text(${E(td)}, ${value});`);
          use("text");
        }
        break;
      }
      case "number":
        cells.push("");
        paints.push(`text(${E(td)}, ${fmt(c, `item.${c.name}`)});`);
        use("text");
        break;
      case "date":
        cells.push("");
        paints.push(`text(${E(td)}, ${DATE_FORMAT[c.format]}(item.${c.name}));`);
        use("text");
        break;
      case "status": {
        const b = n++;
        cells.push(`<${c.tag}></${c.tag}>`);
        paints.push(`text(${E(b)}, item.${c.name});`);
        use("text");
        break;
      }
      case "flag": {
        const i = n++;
        cells.push(`<input type=checkbox data-role=${attrValue(c.toggle)}>`);
        paints.push(`prop(${E(i)}, item.${c.name}, "checked");`);
        events.push(`on(${E(i)}, () => {`, "  const row = s.rows.find((x) => x.id === item.id);", "  if (!row) return;", `  row.${c.name} = !row.${c.name};`, "  schedule(set);", "});");
        use("prop", "on", "schedule");
        break;
      }
      case "computed": {
        cells.push("");
        const e = c.expr;
        const value = e[0] === "if" ? exprCode(e)
          : e[0] === "len" ? exprCode(e)
          : fmt(c, exprCode(e));
        paints.push(`text(${E(td)}, ${value});`);
        use("text");
        break;
      }
      case "remove": {
        const a = n++;
        const attrs = `data-role=${attrValue(c.role)}`;
        if (c.glyph) {
          n++;
          cells.push(`<${c.element} ${attrs}><span aria-hidden=true>${escText(c.text)}</span></${c.element}>`);
        } else cells.push(`<${c.element} ${attrs}>${escText(c.text)}</${c.element}>`);
        events.push(`on(${E(a)}, () => {`, "  const at = s.rows.findIndex((x) => x.id === item.id);", "  if (at < 0) return;", "  s.rows.splice(at, 1);",
          ...(hasSelect ? ["  if (s.selected === item.id) s.selected = null;"] : []), `  ${L}.drop(item.id);`, "});");
        use("on");
        break;
      }
      case "bump": {
        const b = n++;
        cells.push(`<button data-role=${attrValue(c.role)}>${escText(c.text)}</button>`);
        events.push(`on(${E(b)}, () => {`, "  const row = s.rows.find((x) => x.id === item.id);", "  if (!row) return;", `  row.${c.column} += ${c.delta};`, "  schedule(set);", "});");
        use("on", "schedule");
        break;
      }
      case "spacer":
        cells.push("");
        break;
      default: throw new Error(`unknown column kind ${c.kind}`);
    }
  }
  const row = `<tr data-role=row>${cells.map((c) => `<td>${c}`).join("")}`;

  // The marker of the selected row: class (its whole value) or an ARIA state.
  let mark = [];
  if (t.marker) {
    const m = t.marker;
    mark = m.attr === "class"
      ? [`const mark = () => prop(tr, s.selected === item.id ? ${str(m.value)} : "", "className");`]
      : [`const mark = () => prop(tr, s.selected === item.id ? ${str(m.value)} : null, "ariaSelected");`];
    if (m.attr !== "class" && m.attr !== "aria-selected") throw new Error(`unknown marker ${m.attr}`);
    paints.push("mark();");
    use("prop");
  }

  // ---- The row builder: random cells in column order, then the id.
  const pools = [];
  const poolName = (base, i) => `${base}${i}`;
  const fields = [];
  for (const c of t.columns) {
    switch (c.kind) {
      case "label": {
        const words = c.pools.map((p, i) => {
          pools.push(`const ${poolName(c.name + "Words", i)} = ${str(p)};`);
          return `\${pick(r = next(r), ${poolName(c.name + "Words", i)})}`;
        });
        fields.push(`${c.name}: \`${words.join(" ")}\``);
        break;
      }
      case "text":
        pools.push(`const ${c.name}Words = ${str(c.pool)};`);
        fields.push(`${c.name}: pick(r = next(r), ${c.name}Words)`);
        break;
      case "number": fields.push(`${c.name}: between(r = next(r), ${c.min}, ${c.max})`); break;
      case "date": fields.push(`${c.name}: between(r = next(r), 1, 365)`); break;
      case "status":
        pools.push(`const ${c.name}Options = ${str(c.options)};`);
        fields.push(`${c.name}: pick(r = next(r), ${c.name}Options)`);
        break;
      case "flag": fields.push(`${c.name}: (r = next(r)) % 2 === 1`); break;
    }
  }
  fields.push("id: s.nextId++");

  // ---- The toolbar: every op is an action, its message inlined.
  const sortCmp = (o) => {
    const c = o.column === "id" ? { kind: "id", name: "id" } : col(t, o.column);
    const [a, b] = o.dir === "desc" ? ["b", "a"] : ["a", "b"];
    const key = (x) => (c.kind === "status" ? `${c.name}Options.indexOf(${x}.${c.name})` : `${x}.${c.name}`);
    let cmp;
    if (c.kind === "id") return `(a, b) => ${a}.id - ${b}.id`;
    if (c.kind === "label" || c.kind === "text") cmp = `(${key(a)} < ${key(b)} ? -1 : ${key(a)} > ${key(b)} ? 1 : 0)`;
    else cmp = `${key(a)} - ${key(b)}`;
    return `(a, b) => ${cmp} || a.id - b.id`;
  };
  const effect = (o) => {
    const c = col(t, o.column);
    const v = `item.${c.name}`;
    switch (c.kind) {
      case "label": case "text": return `${v} += ${str(o.suffix)};`;
      case "number": return `${v} += ${o.delta};`;
      case "date": return `${v} = ((${v} - 1 + ${o.days}) % 365) + 1;`;
      case "status": return `${v} = ${c.name}Options[(${c.name}Options.indexOf(${v}) + 1) % ${c.options.length}];`;
      case "flag": return `${v} = !${v};`;
    }
    throw new Error(`updateEvery on a ${c.kind} column`);
  };
  const ops = [];
  t.ops.forEach((o, k) => {
    const body = [];
    switch (o.kind) {
      case "create":
        body.push(`s.rows = make(${o.count});`, ...(hasSelect ? ["s.selected = null;"] : []), `schedule(${L});`);
        break;
      case "append":
        body.push(`const added = make(${o.count});`, "s.rows.push(...added);", `${L}.add(added);`);
        break;
      case "updateEvery":
        body.push(`for (let i = 0; i < s.rows.length; i += ${o.k}) {`, "  const item = s.rows[i];", `  ${effect(o)}`,
          `  schedule(${L}.get(item.id)?.[1]);`, "}");
        break;
      case "clear":
        body.push("s.rows = [];", ...(hasSelect ? ["s.selected = null;"] : []), `schedule(${L});`);
        break;
      case "swap":
        body.push(`if (s.rows.length > ${o.j}) {`, `  const a = s.rows[${o.i}];`, `  const b = s.rows[${o.j}];`,
          `  s.rows[${o.i}] = b;`, `  s.rows[${o.j}] = a;`, `  ${L}.swap(b.id, a.id);`, "}");
        break;
      case "sort":
        body.push(`s.rows = s.rows.slice().sort(${sortCmp(o)});`, `schedule(${L});`);
        break;
      case "removeChecked":
        body.push(`s.rows = s.rows.filter((item) => !item.${o.column});`, ...(hasSelect ? ["keepSelected(s);"] : []), `schedule(${L});`);
        break;
      default: throw new Error(`unknown operation ${o.kind}`);
    }
    ops.push(`on(E[${k}], () => {`, ...body.map((l) => "  " + l), "});");
  });
  use("on", "schedule");
  if (t.ops.some((o) => o.kind === "removeChecked") && hasSelect) use("keepSelected");

  // ---- Assemble.
  const rtNames = ["text", "prop", "on", "schedule"].filter((x) => used.has(x));
  const rowNames = new Set(["rows", "tpl"]);
  const scenarioNames = new Set(["state"]);
  const allText = [...paints, ...events, ...ops, ...fields].join("\n");
  for (const name of ["next", "pick", "between", "group", "money", "percent", "monD", "dMon", "mmDd", "keepSelected"]) {
    if (new RegExp(`\\b${name}\\(`).test(allText) || (name === "keepSelected" && used.has(name))) scenarioNames.add(name);
  }
  const initial = t.initialRows ? [`s.rows = make(${t.initialRows});`] : [];

  const lines = [
    `const s = state(${t.rng});`,
    ...pools,
    "",
    "// The row builder: one draw per random cell in column order, then the id.",
    "const make = (n) => {",
    "  let r = s.rng;",
    "  const out = [];",
    `  while (n--) out.push({ ${fields.join(", ")} });`,
    "  s.rng = r;",
    "  return out;",
    "};",
    ...initial,
    "",
    "// A row: cloned from the template; its binding `set` paints the row's item.",
    `const row = tpl(${str(row)});`,
    `const ${L} = rows(E[${t.ops.length}], () => s.rows, (item) => {`,
    "  const tr = row.cloneNode(true);",
    '  const E = tr.querySelectorAll("*");',
    '  tr.setAttribute("data-key", item.id);',
    ...once.map((l) => "  " + l),
    ...mark.map((l) => "  " + l),
    "  const set = (fresh = item) => {",
    "    item = fresh;",
    ...paints.map((l) => "    " + l),
    "  };",
    ...events.map((l) => "  " + l),
    `  return [tr, set${t.marker ? ", mark" : ""}];`,
    "});",
    "",
    "// The arms of update, as actions.",
    ...ops,
    "",
    `return [s, ${L}];`,
  ];
  const body = lines.map((l) => (l ? "  " + l : l)).join("\n");

  return `import { ${rtNames.join(", ")} } from "../runtime.js";
import { ${[...rowNames].join(", ")} } from "../rows.js";
import { ${[...scenarioNames].join(", ")} } from "../scenario.js";
import { W } from "./table.js";

// Table ${t.id}: its markup, and its code over the markup's buttons and body (E), returning its
// state and its list.
W.push([${str(html)}, (E) => {
${body}
}]);
`;
}

// ---------------------------------------------------------------------------------------------
// The app: the tables in page order, and the external arms of update.

function appFile(spec) {
  return `import { flush, cancel, schedule } from "./runtime.js";
import { keepSelected } from "./scenario.js";
import { W, section } from "./tables/table.js";
${spec.tables.map((t) => `import "./tables/${t.id}.js";`).join("\n")}

export function start(root) {
  // The page, from its markup like every table.
  root.insertAdjacentHTML("beforeend", "<div data-role=page>");
  const board = root.lastChild;
  // Every table in page order, given its buttons and body (table \`tN\` is number N, its position
  // from 1: its handle is \`views[N]\`; \`map\` skips the hole at 0): its state and its list.
  const views = W.map(([html, table], i) => table(section(board, i, html)));
  schedule(views.map(([, list]) => list));
  flush();

  // The arms of update still reached by a message: external events. They move data, the same for
  // every table; the rows they copy are the message's, not ours to edit.
  function receive(msg) {
    if (msg.type === "snapshot") {
      for (const id in msg.state.tables) {
        const [s, list] = views[id.slice(1)];
        Object.assign(s, structuredClone(msg.state.tables[id]));
        schedule(list);
      }
      return;
    }
    const [s, list] = views[msg.table.slice(1)];
    switch (msg.type) {
      case "serverRows":
        s.rows = structuredClone(msg.rows);
        keepSelected(s);
        s.nextId = s.rows.reduce((max, item) => Math.max(max, item.id + 1), s.nextId);
        schedule(list);
        break;
      case "serverUpdate":
        for (const { id, value } of msg.changes) {
          const item = s.rows.find((x) => x.id === id);
          if (item) {
            item[msg.column] = value;
            schedule(list.get(id)?.[1]);
          }
        }
        break;
      case "serverDelete": {
        const gone = new Set(msg.ids);
        s.rows = s.rows.filter((item) => !gone.has(item.id));
        keepSelected(s);
        schedule(list);
        break;
      }
    }
  }

  function stop() {
    cancel();
    board.remove();
  }

  return { receive, stop };
}
`;
}

export function emit(spec) {
  // Tables are numbered in page order (their ids are t1, t2, …).
  if (spec.tables.some((t, i) => t.id !== `t${i + 1}`)) throw new Error("table ids are not t1, t2, … in order");
  const files = {
    ...templateFiles({ name: "big-table", title: "Big table", extra: ["rows.js", "scenario.js"] }),
    "src/app.js": appFile(spec),
    "src/tables/table.js": HELPER_FILE,
  };
  for (const t of spec.tables) files[`src/tables/${t.id}.js`] = tableFile(t, spec);
  return {
    files,
    style: {
      track: "prototype: no framework implements this strategy",
      components: "one module per table, each written out from its own description; DOM built once from one static HTML string, rows cloned from one row template per table; elements referred to by their place in document order (E[n])",
      messages: "erased for DOM events: each update arm is inlined into the action its control calls, which writes the table's state in place",
      updates: "each action schedules the bindings that read what it writes (known at compile time): the list for a replaced array, a row's set for an edited item, add/drop/swap for in-place row edits",
      selection: "each row has a mark binding reading s.selected === item.id; select schedules the marks of the old and the new row only (looked up by id), never one per row",
      lists: "keyed by id (rows.js): reconcile on a replaced array (nothing reused: the body is emptied in one go; else one forward pass), add/drop/swap for in-place edits, rows whose item is the same object are not repainted",
      externalEvents: "receive(msg): serverRows, serverUpdate, serverDelete and snapshot move copies of the message's data into the table state and schedule its list or the touched rows",
      build: "Vite with no framework plugin, production defaults, hidden source maps",
    },
  };
}
