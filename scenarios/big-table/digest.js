// big-table in digest (prototype): compiled dirty checking, one function per table, one binding
// list per table and one per row.
//
// What a compiler for this approach would produce for a page of data tables:
// - One function per table, written out in full from that table's description: its state (an
//   object with the protocol's four fields, the rows built at start-up by its own row builder),
//   its pools, its row builder (which pools, ranges and draws it uses, in column order), its
//   template (heading, toolbar, header: static HTML, escaped at build time, without the end
//   tags it closes with), its toolbar handlers (what each button does to which rows), its row
//   template, its row bindings (one closure per dynamic cell, computed cells and formats
//   compiled to JavaScript) and its row controls' handlers. Nothing is kept as data for a
//   generic routine: no column descriptors, no op tables.
// - The runtime (frameworks/digest/runtime-table.js) is generic: a section built from a
//   template, bind/text, a keyed-rows reconciler, one delegated click/input listener, the
//   number and date formatters, and small helpers (swap, every k-th row, order by and select a
//   row).
// - Lists: a table's list holds one binding, the rows' reconciler; an operation digests it. A
//   row has its own list: a row control digests only that list (plus, for a select, the list
//   of the row that was selected). Tables share nothing, so there are no dependencies between
//   lists, and an event costs the same at any number of tables. This is digest's local strategy
//   with the list cut at the row; it is not another prototype's per-action scheduling.
// - Rows are plain objects edited in place by row controls and by the operations that touch
//   some rows (which digest those rows' lists themselves); an operation that adds, drops or
//   reorders rows leaves that to the reconciler, which re-checks a row only when the row is new
//   or its object was replaced (a server page, a snapshot).
// - The selection marker is a binding of the row, written only when it changes. The selection
//   is dropped by the reconciler when its row is gone (the only way the reference loses it).
// - External events are generic (a server page replaces the table's rows, an update edits the
//   listed rows in place, a delete removes them, a snapshot assigns the tables' state), so
//   `receive` is the same text for every app.
// - Nodes are found by their position in the row template, each binding's as a distance from
//   the previous binding's; handlers are given to the controls in document order.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { templateFiles } from "../../frameworks/digest/framework.js";

export const framework = "digest";

export const params = {
  rowDigest: {
    default: "changed",
    choices: ["changed", "all"],
    help: "what a table's digest does with its rows: re-check only the rows that are new or replaced (in-place edits digest their rows by hand), or every row, as the other digest runtimes do",
  },
};

// The runtime names the generated code uses (the import list), collected as it is written; and
// whether the table's digest re-checks every row.
let USED, ALL;
const use = (name) => (USED.add(name), name);

const lit = (v) => JSON.stringify(v);
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);
// Text inside a JavaScript template literal.
const tpl = (s) => s.replace(/[\\`]|\$\{/g, (m) => "\\" + m);

// The marker of a selected row, as the DOM property that writes it and its value when off.
const MARK = {
  class: { prop: "className", off: '""' },
  "aria-selected": { prop: "ariaSelected", off: "null" },
};

// A cell's value as the text it shows.
function format(c, v) {
  switch (c.format) {
    case "plain": return v;
    case "grouped": return `${use("g")}(${v})`;
    case "unit": return `${use("g")}(${v}) + ${lit(" " + c.unit)}`;
    case "currency": return `${use("cur")}(${lit(c.symbol)}, ${v})`;
    case "percent": return `${use("pct")}(${v})`;
  }
  throw new Error(`digest: unknown number format ${c.format}`);
}

const DATE = { "mon-d": "md", "d-mon": "dm", "mm-dd": "nd" };

// A computed cell's expression over its own row, as JavaScript.
function expr(e) {
  const v = (name) => `r.i.${name}`;
  switch (e[0]) {
    case "*": return `${v(e[1])} * ${v(e[2])}`;
    case "+": return `${v(e[1])} + ${v(e[2])}`;
    case "len": return `${v(e[1])}.length`;
    case ">": return `${v(e[1])} > ${e[2]}`;
    case "==": return `${v(e[1])} == ${lit(e[2])}`;
    case "f": return v(e[1]);
    case "if": return `${expr(e[1])} ? ${lit(e[2])} : ${lit(e[3])}`;
  }
  throw new Error(`digest: unknown expression ${lit(e)}`);
}

// One table's function.
function tableCode(t) {
  const text = use("text"), col = (name) => t.columns.find((c) => c.name === name);
  const initial = { rows: [], selected: null, nextId: 1, rng: t.rng };
  const hasSelect = !!t.marker;

  // The pools (word lists, status options), as constants of the table.
  const pools = [];
  const pool = (list) => {
    pools.push(`const p${pools.length} = ${lit(list)};`);
    return `p${pools.length - 1}`;
  };
  const poolOf = new Map(); // column name → the pool(s) its draws use

  // The row builder: one draw per pool of a generated cell, in column order, then the id.
  const cells = [];
  for (const c of t.columns) {
    const draw = (p, n) => `${p}[d() % ${n}]`;
    switch (c.kind) {
      case "label": {
        const ps = c.pools.map((l) => [pool(l), l.length]);
        cells.push(`${c.name}: ${ps.map(([p, n]) => draw(p, n)).join(' + " " + ')}`);
        break;
      }
      case "text": {
        cells.push(`${c.name}: ${draw(pool(c.pool), c.pool.length)}`);
        break;
      }
      case "status": {
        const p = pool(c.options);
        poolOf.set(c.name, p);
        cells.push(`${c.name}: ${draw(p, c.options.length)}`);
        break;
      }
      case "number": cells.push(`${c.name}: ${c.min} + d() % ${c.max - c.min + 1}`); break;
      case "date": cells.push(`${c.name}: 1 + d() % 365`); break;
      case "flag": cells.push(`${c.name}: d() % 2 == 1`); break;
    }
  }

  // The row template, its bindings and its controls' handlers, in document order.
  let n = 0, at = 0; // n: the next element's index in the row (the cells are the elements)
  const ref = (i) => {
    const d = i - at;
    at = i;
    return d;
  };
  const html = [], binds = [], hs = [];
  for (const c of t.columns) {
    const td = n++;
    const v = `r.i.${c.name}`;
    switch (c.kind) {
      case "id":
        html.push("<td>");
        binds.push(`${text}(${ref(td)}, () => r.i.id)`);
        break;
      case "label": case "text": {
        if (c.select) {
          const a = n++;
          html.push(`<td><a data-role=${c.select}>`);
          binds.push(`${text}(${ref(a)}, () => ${v})`);
          hs.push(ALL ? `() => o.selected = r.i.id` : `() => ${use("sel")}(o, m, r)`);
        } else {
          html.push("<td>");
          binds.push(`${text}(${ref(td)}, () => ${v})`);
        }
        break;
      }
      case "number":
        html.push("<td>");
        binds.push(`${text}(${ref(td)}, () => ${format(c, v)})`);
        break;
      case "date":
        html.push("<td>");
        binds.push(`${text}(${ref(td)}, () => ${use(DATE[c.format])}(${v}))`);
        break;
      case "status": {
        const s = n++;
        html.push(`<td><${c.tag}>`);
        binds.push(`${text}(${ref(s)}, () => ${v})`);
        break;
      }
      case "flag": {
        const f = n++;
        html.push(`<td><input type=checkbox data-role=${c.toggle}>`);
        binds.push(`${use("bind")}(${ref(f)}, () => ${v}, "checked")`);
        hs.push(`() => ${v} = ${use("X")}.checked`);
        break;
      }
      case "computed": {
        html.push("<td>");
        const e = c.expr;
        const code = e[0] === "if" ? expr(e) : e[0] === "len" ? expr(e) : format(c, expr(e));
        binds.push(`${text}(${ref(td)}, () => ${code})`);
        break;
      }
      case "remove": {
        n++;
        html.push(`<td><${c.element} data-role=${c.role}>${c.glyph ? `<span aria-hidden=true>${esc(c.text)}` : esc(c.text)}`);
        if (c.glyph) n++;
        hs.push(ALL ? `() => o.rows = o.rows.filter((x) => x != r.i)` : `() => ((o.rows = o.rows.filter((x) => x != r.i)), ${use("go")}(b))`);
        break;
      }
      case "bump": {
        n++;
        html.push(`<td><button data-role=${c.role}>${esc(c.text)}`);
        hs.push(`() => r.i.${c.column} += ${c.delta}`);
        break;
      }
      case "spacer": html.push("<td>"); break;
      default: throw new Error(`digest: unknown column kind ${c.kind}`);
    }
  }

  // The toolbar's handlers, in the order of the buttons.
  const toolbar = t.ops.map((op) => {
    switch (op.kind) {
      case "create": return `() => ((o.rows = []), mk(${op.count})), // ${op.name}`;
      case "append": return `() => mk(${op.count}), // ${op.name}`;
      case "clear": return `() => (o.rows = []), // ${op.name}`;
      case "swap": return `() => ${use("swap")}(o.rows, ${op.i}, ${op.j}), // ${op.name}`;
      case "sort": {
        const c = op.column === "id" ? { kind: "id", name: "id" } : col(op.column);
        const key = c.kind === "status" ? `${poolOf.get(c.name)}.indexOf(r.${c.name})` : c.kind === "flag" ? `+r.${c.name}` : `r.${c.name}`;
        return `() => o.rows.sort(${use("by")}((r) => ${key}, ${op.dir === "desc" ? -1 : 1})), // ${op.name}`;
      }
      case "removeChecked": return `() => (o.rows = o.rows.filter((r) => !r.${op.column})), // ${op.name}`;
      case "updateEvery": {
        const c = col(op.column);
        const v = `r.${c.name}`;
        let e;
        switch (c.kind) {
          case "label": case "text": e = `${v} += ${lit(op.suffix)}`; break;
          case "number": e = `${v} += ${op.delta}`; break;
          case "date": e = `${v} = ((${v} - 1 + ${op.days}) % 365) + 1`; break;
          case "status": e = `${v} = ${use("nx")}(${v}, ${poolOf.get(c.name)})`; break;
          case "flag": e = `${v} = !${v}`; break;
          default: throw new Error(`digest: updateEvery on a ${c.kind} column`);
        }
        return `() => ${use("every")}(o, m, ${op.k}, (r) => ${e}), // ${op.name}`;
      }
    }
    throw new Error(`digest: unknown operation ${op.kind}`);
  });

  const head = `<h2>${esc(t.title)}</h2><div>${t.ops.map((op) => `<button data-role=${op.name}>${esc(op.text)}`).join("")}</div><table>`
    + (t.thead ? `<thead><tr>${t.columns.map((c) => `<th>${esc(c.header)}`).join("")}` : "") + "<tbody>";
  const mark = hasSelect ? `, ${lit(MARK[t.marker.attr].prop)}, ${lit(t.marker.value)}, ${MARK[t.marker.attr].off}` : "";
  const rowsCall = `${use("rows")}(o, m, \`${tpl(html.join(""))}\`, (r) => (\n${[...binds, `[${hs.join(", ")}]`].map((b) => `    ${b}`).join(",\n")}\n  )${mark});`;

  const body = [
    `const o = { rows: [], selected: null, nextId: 1, rng: ${initial.rng} }, m = new Map();`,
    `const d = () => (o.rng = (o.rng * 48271) % 2147483647);`,
    ...pools.map((p) => p),
    `const mk = (n) => {\n    while (n--) o.rows.push({ id: o.nextId++, ${cells.join(", ")} });\n  };`,
    ...(t.initialRows ? [`mk(${t.initialRows});`] : []),
    `const b = ${use("table")}(o, m, \`${tpl(head)}\`,\n${toolbar.map((h) => `    ${h}`).join("\n")}\n  );`,
    rowsCall,
  ];
  return `// ${t.id}\nconst ${t.id} = () => {\n${body.map((l) => "  " + l).join("\n")}\n};`;
}

function appFile(spec, options) {
  USED = new Set();
  ALL = options.rowDigest === "all";
  spec.tables.forEach((t, i) => {
    if (t.id !== `t${i + 1}`) throw new Error(`digest expects sequential table ids, got ${t.id} at ${i}`);
    if (t.marker && !MARK[t.marker.attr]) throw new Error(`digest: unknown selection marker ${t.marker.attr}`);
  });
  const code = spec.tables.map(tableCode);
  const ids = spec.tables.map((t) => t.id).join(", ");
  const upd = ALL ? "(r.i[m.column] = c.value)" : "((r.i[m.column] = c.value), go(r.b))";
  const receive = `const receive = (m, x = W[m.table], o = x?.o, r) => {
  if (m.type == "serverUpdate") {
    for (const c of m.changes) (r = x.m.get(c.id)) && ${upd};${ALL ? "\n    go(x.b);" : ""}
  } else if (m.type == "serverDelete") {
    o.rows = o.rows.filter((r) => !m.ids.includes(r.id));
    go(x.b);
  } else if (m.type == "serverRows") {
    o.rows = structuredClone(m.rows);
    o.nextId = m.rows.reduce((n, r) => Math.max(n, r.id + 1), o.nextId);
    go(x.b);
  } else for (const k in m.state.tables) Object.assign(W[k].o, structuredClone(m.state.tables[k])), go(W[k].b);
};`;
  use("W");
  use("go");
  const names = [...USED].filter((n) => !HELPER_NAMES.has(n)).sort();
  const helperNames = [...USED].filter((n) => HELPER_NAMES.has(n)).sort();
  return `// Generated by scenarios/big-table/digest.js. Do not edit.
import { app, ${names.join(", ")} } from "./runtime.js";${helperNames.length ? `\nimport { ${helperNames.join(", ")} } from "./helpers.js";` : ""}

${code.join("\n\n")}

// External events: a server page replaces a table's rows, an update edits the listed rows in
// place, a delete removes them, a snapshot assigns every table's state.
${receive}

export default app([${ids}], receive);
`;
}

// rowDigest "all": the runtime as the other digest runtimes behave. The table's digest runs the
// list of every row (not only the new and replaced ones), and a row control belongs to the
// table's list (so it digests every row), which makes the by-hand row digests unnecessary: the
// one in `every`, and the previous row's in `sel` (not used in this variant).
const ALL_EDITS = [
  ['proto = el("tr", html), y = 0) => {', 'proto = el("tr", html), y = 0, w = B) => {'],
  ["if (r.i !== i) (r.i = i), go(r.b);", "(r.i = i), go(r.b);"],
  ["on(r.n, make(r), B);", "on(r.n, make(r), w);"],
];

// The helpers the generated code calls are big-table's own (select a row, every k-th, swap, sort
// order, formats), shipped as app code in src/helpers.js; the runtime keeps the generic machinery.
const HELPERS = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../frameworks/digest/table-helpers.js"), "utf8");
const HELPER_NAMES = new Set([...HELPERS.matchAll(/^export const (\w+)/gm)].map((m) => m[1]));
const edit = (src, edits, what) => {
  for (const [from, to] of edits) {
    if (!src.includes(from)) throw new Error(`digest: ${what} no longer contains: ${from}`);
    src = src.replace(from, () => to);
  }
  return src;
};

export function emit(spec, options = {}) {
  const files = templateFiles({ name: "big-table", title: "Big table", runtime: "runtime-table.js" });
  let helpers = HELPERS;
  if (options.rowDigest === "all") {
    files["src/runtime.js"] = edit(files["src/runtime.js"], ALL_EDITS, "runtime-table.js");
    helpers = edit(helpers, [["f(o.rows[i]), go(m.get(o.rows[i].id).b);", "f(o.rows[i]);"]], "table-helpers.js");
  }
  files["src/helpers.js"] = helpers;
  return {
    files: {
      ...files,
      "src/app.js": appFile(spec, options),
    },
    style: {
      approach: "compiled dirty checking with one binding list per table (its rows' reconciler) and one per row; an event digests the list of the control it came from, so a row control costs the same at any number of rows and tables",
      components: "one function per table, written out in full from its description (state, pools, row builder, template, toolbar handlers, row template, row bindings, row controls' handlers); no column descriptors, no op tables, no interpreter",
      rowDigest: `${options.rowDigest ?? "changed"}: ` + (options.rowDigest === "all" ? "the table digest runs every row list, and a row control belongs to the table list (as in the other digest runtimes), so no by-hand row digest exists" : "the table digest runs a row list only for a new or replaced row; every in-place edit (every k-th, serverUpdate, the previously selected row) digests its rows by hand"),
      lists: "a table's list holds the rows' reconciler; a row has its own list; no dependencies between lists (tables share nothing); the reconciler re-checks a row only when it is new or its object was replaced, in-place edits digest their rows themselves",
      state: "plain mutable object per table with the protocol's fields (rows, selected, nextId, rng); rows are plain objects edited in place; initial rows built at start-up by the table's own row builder; snapshots are deep-copied and assigned",
      templates: "one static HTML string per table (heading, toolbar, header) and one per row; end tags omitted where the next tag closes them; the row is cloned from a prototype; nodes are found by position, bindings by distance from the previous one",
      handlers: "one arrow function per control, given to the controls in document order; generic helpers for swap, every k-th row, ordering and selecting a row",
      keyedLists: "keyed by id, reconciled in place by the runtime; a node out of place whose next sibling is the row's is left, so a swap moves two nodes",
      selection: "a per-row binding of the marker property (className or ariaSelected), written only on change; a select digests the new row (as any control) and the row that was selected; the reconciler drops the selection when its row is gone",
      events: "one delegated click and input listener that calls the closest control's handler",
      derived: "computed cells are compiled to JavaScript inside the row's bindings; formats are small shared functions",
      build: "Vite production build, no plugin, hidden source maps",
    },
  };
}
