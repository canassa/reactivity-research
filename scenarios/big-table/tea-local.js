// big-table as tea-local, a prototype strategy (frameworks/tea-local/README.md): what an ideal
// compiler would emit from a TEA source of N data tables, each its own component, with local
// message routing.
//
// Style (recorded in every generated app's rr.json):
// - One component instance per table. Its model lives in the instance's closure:
//   { rows, selected, nextId, rng }. Its messages are the toolbar's operations, the row controls
//   and the external events; its reducer is a jump table by constructor tag, written out from the
//   table's description (one arm per operation and control, never interpreted). An event sends a
//   real message to the instance, the reducer runs, then the instance's binding list re-runs and
//   skips the writes that changed nothing.
// - The rows are NOT instances (the README argues it). A row is a DOM node and a plain object;
//   the table's binding list has three bindings: the rows (a keyed list, written only when the
//   model's rows array is not the one on screen), each row's cells (a patch per row whose object
//   changed, written out per table from its columns), and the selection marker (moved between
//   two rows, found by key, in O(1)).
// - The DOM is built once: the table's markup as one static template (trailing end tags left
//   out), the row as a template cloned per new row. Toolbar buttons are wired by position (the
//   runtime's `wire`), the rows' controls by ONE delegated click listener on the table body: the
//   control of column i sends the constructor `base + i` with the row's key.
// - External events: serverRows, serverUpdate and serverDelete are the first three constructors
//   of every table (the app routes them by table id); a snapshot sets each instance's model.
// - Generic helpers (the PRNG step, number and date formatters, the reducer steps of the external
//   events, `edit`) are shared; everything a table does is that table's own code: its row
//   builder, pools, row template, patch, operations and formatting calls.

import { templateFiles, runtimeFile } from "../../frameworks/tea-local/framework.js";

export const framework = "tea-local";

export const params = {};

const q = JSON.stringify;
const IDENT = /^[A-Za-z_$][\w$]*$/;
const prop = (name) => (IDENT.test(name) ? `.${name}` : `[${q(name)}]`);
const esc = (s) => String(s).replace(/[&<]/g, (c) => (c === "&" ? "&amp;" : "&lt;"));
const attr = (v) => (/^[^\s"'=<>`]+$/.test(v) ? v : `"${String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`);
const trim = (html) => html.replace(/(<\/\w+>)+$/, "");
const tpl = (s) => s.replace(/[`\\]|\$\{/g, (c) => "\\" + c);
const indent = (s, n = 2) => s.replace(/^(?=.)/gm, " ".repeat(n));

// ---------------------------------------------------------------------------------------------
// Shared helpers (src/tables/frame.js). Generic: nothing in them knows a table's columns.

const FRAME_FILE = `// Helpers every table shares: the registry of instances, the app's PRNG step, the number and date
// formatters, and the reducer steps of the external events.

export const tables = [];

export function add(parent, html) {
  parent.insertAdjacentHTML("beforeend", html);
  return parent.lastChild;
}

// The PRNG (a Park-Miller generator whose state each table keeps in its model).
export const next = (s) => (s * 48271) % 2147483647;

export const group = (n) => String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
export const money = (symbol, v) => \`\${symbol}\${group(Math.floor(v / 100))}.\${String(v % 100).padStart(2, "0")}\`;
export const percent = (v) => \`\${group(Math.floor(v / 10))}.\${v % 10}%\`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// A day of the year (1 to 365) as its month and day.
function split(day) {
  let m = 0;
  while (day > LENGTHS[m]) day -= LENGTHS[m++];
  return [m, day];
}

export function monD(day) {
  const [m, d] = split(day);
  return \`\${MONTHS[m]} \${d}\`;
}

export function dMon(day) {
  const [m, d] = split(day);
  return \`\${d} \${MONTHS[m]}\`;
}

export function mmDd(day) {
  const [m, d] = split(day);
  return \`\${String(m + 1).padStart(2, "0")}-\${String(d).padStart(2, "0")}\`;
}

export const has = (rows, id) => rows.some((r) => r.id === id);

// The model with other rows; the selection goes with its row.
export function rowsOf(m, rows) {
  if (rows.length === m.rows.length) return m;
  return m.selected != null && !has(rows, m.selected) ? { ...m, rows, selected: null } : { ...m, rows };
}

// Changes one row (found by its key); every other row object is kept.
export function edit(m, id, change) {
  const rows = m.rows.slice();
  const i = rows.findIndex((r) => r.id === id);
  rows[i] = change(rows[i]);
  return { ...m, rows };
}

// The messages of the external events (the first three constructors of every table).
export function loadRows(m, rows) {
  const top = rows.reduce((max, r) => Math.max(max, r.id), 0);
  return { ...m, rows, selected: m.selected != null && has(rows, m.selected) ? m.selected : null, nextId: Math.max(m.nextId, top + 1) };
}

export function setColumn(m, { column, changes }) {
  const values = new Map(changes.map((c) => [c.id, c.value]));
  let changed = false;
  const rows = m.rows.map((r) => {
    if (!values.has(r.id) || r[column] === values.get(r.id)) return r;
    changed = true;
    return { ...r, [column]: values.get(r.id) };
  });
  return changed ? { ...m, rows } : m;
}

export function dropIds(m, ids) {
  const gone = new Set(ids);
  return rowsOf(m, m.rows.filter((r) => !gone.has(r.id)));
}
`;

// ---------------------------------------------------------------------------------------------
// Formatting calls

function formatCode(c, e) {
  switch (c.format) {
    case "plain": return e;
    case "grouped": return `group(${e})`;
    case "unit": return `\`\${group(${e})} ${tpl(c.unit)}\``;
    case "currency": return `money(${q(c.symbol)}, ${e})`;
    case "percent": return `percent(${e})`;
  }
  throw new Error(`unknown number format ${c.format}`);
}

const DATE_FORMAT = { "mon-d": "monD", "d-mon": "dMon", "mm-dd": "mmDd" };

// A computed cell's value, compiled from its expression over the row `r`.
function computedCode(c) {
  const e = c.expr;
  const col = (n) => `r${prop(n)}`;
  switch (e[0]) {
    case "*": return formatCode(c, `${col(e[1])} * ${col(e[2])}`);
    case "+": return formatCode(c, `${col(e[1])} + ${col(e[2])}`);
    case "len": return `${col(e[1])}.length`;
    case "if": {
      const [op, a, b] = e[1];
      const cond = op === ">" ? `${col(a)} > ${b}` : op === "==" ? `${col(a)} === ${q(b)}` : col(a);
      return `${cond} ? ${q(e[2])} : ${q(e[3])}`;
    }
  }
  throw new Error(`unknown expression ${q(e)}`);
}

// ---------------------------------------------------------------------------------------------
// One table.

function tableBlock(t) {
  const cols = t.columns;
  const colOf = (name) => cols.find((c) => c.name === name);
  const ci = (c) => cols.indexOf(c);
  const consts = []; // the table's pools and option lists
  const poolName = (c, j = 0) => `p${ci(c)}${j ? "_" + j : ""}`;
  const optName = (c) => `o${ci(c)}`;

  // The row builder: per row one draw per generated cell, in column order (a label: one per pool).
  const draws = [];
  for (const c of cols) {
    const draw = (list, n) => `(s = next(s), ${list}[s % ${n}])`;
    switch (c.kind) {
      case "label":
        c.pools.forEach((pool, j) => consts.push(`const ${poolName(c, j)} = ${q(pool)};`));
        draws.push(`${c.name}: ${c.pools.map((pool, j) => draw(poolName(c, j), pool.length)).join(' + " " + ')}`);
        break;
      case "text":
        consts.push(`const ${poolName(c)} = ${q(c.pool)};`);
        draws.push(`${c.name}: ${draw(poolName(c), c.pool.length)}`);
        break;
      case "number": {
        const span = c.max - c.min + 1;
        draws.push(`${c.name}: (s = next(s), ${c.min ? c.min + " + " : ""}s % ${span})`);
        break;
      }
      case "date": draws.push(`${c.name}: (s = next(s), 1 + (s % 365))`); break;
      case "status":
        consts.push(`const ${optName(c)} = ${q(c.options)};`);
        draws.push(`${c.name}: ${draw(optName(c), c.options.length)}`);
        break;
      case "flag": draws.push(`${c.name}: (s = next(s), s % 2 === 1)`); break;
    }
  }
  const make = `const make = (m, rows, n) => {
  let s = m.rng, id = m.nextId;
  while (n--) rows.push({ id: id++, ${draws.join(", ")} });
  return { ...m, rows, rng: s, nextId: id };
};`;

  // The row's template and its binding list.
  let rowHtml = "<tr data-role=row>";
  const cells = [];
  cols.forEach((c, i) => {
    const cell = `c[${i}]`;
    let html = "<td> </td>";
    switch (c.kind) {
      case "id": cells.push(`setText(${cell}, r.id);`); break;
      case "label": case "text":
        if (c.select) {
          html = `<td><a data-role=${attr(c.select)}> </a></td>`;
          cells.push(`setText(${cell}.firstChild, r${prop(c.name)});`);
        } else cells.push(`setText(${cell}, r${prop(c.name)});`);
        break;
      case "number": cells.push(`setText(${cell}, ${formatCode(c, `r${prop(c.name)}`)});`); break;
      case "date": cells.push(`setText(${cell}, ${DATE_FORMAT[c.format]}(r${prop(c.name)}));`); break;
      case "status":
        html = `<td><${c.tag}> </${c.tag}></td>`;
        cells.push(`setText(${cell}.firstChild, r${prop(c.name)});`);
        break;
      case "flag":
        html = `<td><input type=checkbox data-role=${attr(c.toggle)}></td>`;
        cells.push(`setProp(${cell}.firstChild, "checked", r${prop(c.name)});`);
        break;
      case "computed": cells.push(`setText(${cell}, ${computedCode(c)});`); break;
      case "remove": {
        const inner = c.glyph ? `<span aria-hidden=true>${esc(c.text)}</span>` : esc(c.text);
        html = `<td><${c.element} data-role=${attr(c.role)}>${inner}</${c.element}></td>`;
        break;
      }
      case "bump": html = `<td><button data-role=${attr(c.role)}>${esc(c.text)}</button></td>`; break;
      case "spacer": html = "<td></td>"; break;
      default: throw new Error(`unknown column kind ${c.kind}`);
    }
    rowHtml += html;
  });

  // The operations (the toolbar), one reducer arm each.
  const ops = t.ops;
  const base = 3 + ops.length; // the first constructor of a row control: base + its column
  const arm = (op) => {
    switch (op.kind) {
      case "create": return `(m) => make({ ...m, selected: null }, [], ${op.count})`;
      case "append": return `(m) => make(m, m.rows.slice(), ${op.count})`;
      case "updateEvery": {
        const c = colOf(op.column);
        const v = `r${prop(c.name)}`;
        let to;
        switch (c.kind) {
          case "label": case "text": to = `${v} + ${q(op.suffix)}`; break;
          case "number": to = `${v} + ${op.delta}`; break;
          case "date": to = `((${v} - 1 + ${op.days}) % 365) + 1`; break;
          case "status": to = `${optName(c)}[(${optName(c)}.indexOf(${v}) + 1) % ${c.options.length}]`; break;
          case "flag": to = `!${v}`; break;
        }
        return `(m) => {
  const rows = m.rows.slice();
  for (let i = 0; i < rows.length; i += ${op.k}) {
    const r = rows[i];
    rows[i] = { ...r, ${c.name}: ${to} };
  }
  return { ...m, rows };
}`;
      }
      case "clear": return `(m) => ({ ...m, rows: [], selected: null })`;
      case "swap": return `(m) => {
  if (m.rows.length <= ${op.j}) return m;
  const rows = m.rows.slice();
  [rows[${op.i}], rows[${op.j}]] = [rows[${op.j}], rows[${op.i}]];
  return { ...m, rows };
}`;
      case "sort": {
        const [a, b] = op.dir === "desc" ? ["b", "a"] : ["a", "b"];
        const c = op.column === "id" ? { kind: "id", name: "id" } : colOf(op.column);
        const k = (x) => `${x}${prop(c.name)}`;
        let cmp;
        if (c.kind === "label" || c.kind === "text") cmp = `${k(a)} < ${k(b)} ? -1 : ${k(a)} > ${k(b)} ? 1 : a.id - b.id`;
        else if (c.kind === "status") cmp = `${optName(c)}.indexOf(${k(a)}) - ${optName(c)}.indexOf(${k(b)}) || a.id - b.id`;
        else if (c.kind === "id") cmp = `${k(a)} - ${k(b)}`;
        else cmp = `${k(a)} - ${k(b)} || a.id - b.id`; // numbers, dates and flags (false before true)
        return `(m) => ({ ...m, rows: m.rows.slice().sort((a, b) => ${cmp}) })`;
      }
      case "removeChecked": return `(m) => rowsOf(m, m.rows.filter((r) => !r${prop(op.column)}))`;
    }
    throw new Error(`unknown operation ${op.kind}`);
  };

  // The row controls: the control of column i is the arm at base + i.
  const slots = new Map();
  cols.forEach((c, i) => {
    if ((c.kind === "label" || c.kind === "text") && c.select) slots.set(i, `(m, id) => (m.selected === id ? m : { ...m, selected: id })`);
    if (c.kind === "flag") slots.set(i, `(m, id) => edit(m, id, (r) => ({ ...r, ${c.name}: !r${prop(c.name)} }))`);
    if (c.kind === "remove") slots.set(i, `(m, id) => dropIds(m, [id])`);
    if (c.kind === "bump") slots.set(i, `(m, id) => edit(m, id, (r) => ({ ...r, ${c.column}: r${prop(c.column)} + ${c.delta} }))`);
  });
  const last = Math.max(-1, ...slots.keys());
  const update = ["loadRows", "setColumn", "dropIds", ...ops.map(arm)];
  for (let i = 0; i <= last; i++) update.push(slots.get(i) ?? "");

  // The page markup of the table.
  const head = t.thead ? `<thead><tr>${cols.map((c) => `<th>${esc(c.header)}</th>`).join("")}</tr></thead>` : "";
  const html = trim(`<section data-key=${attr(t.id)} data-role=table><h2>${esc(t.title)}</h2><div>${ops.map((o) => `<button data-role=${attr(o.name)}>${esc(o.text)}</button>`).join("")}</div><table>${head}<tbody></tbody></table></section>`);

  const model = t.initialRows ? `make({ selected: null, rng: ${t.rng}, nextId: 1 }, [], ${t.initialRows})` : `{ rows: [], selected: null, rng: ${t.rng}, nextId: 1 }`;
  const marker = t.marker ? `\n  marked = mark(marked, fill.get(m.selected), ${q(t.marker.attr)}, ${q(t.marker.value)});` : "";

  const lines = [
    `// ${t.title}`,
    `const sec = add(main, ${q(html)});`,
    `const body = sec.lastChild.lastChild;`,
    ...consts,
    make,
    `const fill = keyed(body, template(${q(trim(rowHtml))}), (tr, r) => {`,
    `  const c = tr.children;`,
    ...cells.map((s) => "  " + s),
    `});`,
    `let shown${t.marker ? ", marked" : ""};`,
    `const patch = () => {`,
    `  const m = self.m;`,
    `  if (m.rows !== shown) fill((shown = m.rows));${marker}`,
    `};`,
    `const self = instance(${model}, [`,
    ...update.map((a) => indent(a + ",")),
    `], patch);`,
    `tables.push(self);`,
    `wire(sec.children[1], self, 3);`,
    ...(last >= 0 ? [`rowEvents(body, self, ${base});`] : []),
  ];
  return lines.join("\n");
}

export function emit(spec) {
  const blocks = spec.tables.map((t, i) => {
    if (t.id !== `t${i + 1}`) throw new Error(`expected table t${i + 1}, got ${t.id}`);
    return `{\n${indent(tableBlock(t))}\n}`;
  });
  const files = {
    ...templateFiles({ name: "big-table", title: "Big table" }),
    "src/table.js": runtimeFile("table.js"),
    "src/tables/frame.js": FRAME_FILE,
  };
  const used = (names, code) => names.filter((h) => new RegExp(`\\b${h}\\b`).test(code));
  const code = blocks.join("\n");
  const FRAME = ["tables", "add", "next", "group", "money", "percent", "monD", "dMon", "mmDd", "edit", "rowsOf", "loadRows", "setColumn", "dropIds"];
  files["src/app.js"] = `import { instance, template, setText, setProp, wire } from "./runtime.js";
import { keyed, mark, rowEvents } from "./table.js";
import { ${used(FRAME, code).join(", ")} } from "./tables/frame.js";

export function App(root) {
  root.insertAdjacentHTML("beforeend", "<div data-role=page>");
  const main = root.lastChild;
${indent(blocks.join("\n"))}

  // The table a message concerns, by its id (t1 is the first).
  const at = (msg) => tables[msg.table.slice(1) - 1];
  return {
    // External events, sent to the table instances they concern.
    receive(msg) {
      switch (msg.type) {
        case "serverRows":
          at(msg).send(0, msg.rows);
          break;
        case "serverUpdate":
          at(msg).send(1, msg);
          break;
        case "serverDelete":
          at(msg).send(2, msg.ids);
          break;
        case "snapshot":
          // Each instance takes its model directly from the payload (same shape as the model).
          tables.forEach((t, i) => t.set(msg.state.tables["t" + (i + 1)]));
          break;
      }
    },
    dispose() {
      tables.length = 0;
      main.remove();
    },
  };
}
`;
  return {
    files,
    style: {
      components: "one component instance per table (factory inlined: each table is a block of the page function with its own pools, row builder, row template, patch and reducer arms); its model { rows, selected, nextId, rng } lives in the instance's closure; rows are plain objects and DOM nodes, not instances",
      updates: "the table's binding list: the rows (keyed list, written only when the model's rows array changed), each row's cells (a patch per row object that changed), the selection marker (moved between two rows found by key); every DOM write skipped when unchanged; batched in a microtask",
      reducer: "a jump table by constructor tag, one arm per operation and per row control written out from the table's description; tags 0-2 are the external events serverRows, serverUpdate, serverDelete, then the toolbar, then the row controls at base + their column",
      events: "toolbar buttons wired by position (wire); the rows' controls by one delegated click listener on the table body, sending the control's column constructor with the row key",
      externalEvents: "serverRows, serverUpdate and serverDelete are messages to the table's instance (routed by table id); a snapshot sets every instance's model",
      lists: "runtime keyed list (src/table.js) whose rows are the tr nodes: patch changed rows, one forward placement pass when order or membership changes",
      dom: "the table's markup as one static template (trailing end tags left out), the row as a template cloned per new row, placeholders for dynamic texts",
      build: "Vite production build, no framework plugin, hidden source maps",
    },
  };
}
