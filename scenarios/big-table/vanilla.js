// The big-table scenario in vanilla JavaScript: the floor, written the way js-framework-benchmark's
// `frameworks/keyed/vanillajs` writes its one table, N times (see frameworks/vanilla/README.md).
//
// Style (recorded in every generated app's rr.json):
// - One module per table (`src/tables/tN.js`), written out from its description alone: its row
//   `<template>` (a `<tr>` whose innerHTML holds the static cells, cloned with
//   `cloneNode(true)`), its row builder (the Park–Miller draws, one statement per drawn cell, in
//   column order), its cell setters (one per data column, which also rewrites the computed cells
//   that read it), its operations and row controls (one `case` each in its listener), its sort
//   comparators and its computed expressions, all as that table's own code. Nothing is
//   interpreted at runtime.
// - Plain mutable state per table, in the table's closure: `rows` (records `{ id, …cells }`,
//   each carrying its `<tr>` in `tr`), `nextId`, `rng`, and for tables with select the selected
//   `<tr>` (the selection itself), so a selection touches two rows. Operations mutate records
//   in place, as vanillajs's store does.
// - One delegated click listener per table, on its `<section>`, switching on the clicked
//   element's `data-role`; a row control finds its `<tr>` with `closest("tr")` and its record
//   with `findIndex`/`find`, as vanillajs does.
// - Direct DOM operations, with vanillajs's fast paths: `tbody.textContent = ""` to clear, the
//   `<tbody>` taken out of the table while an empty table is filled, two `insertBefore` for a
//   swap, the previous selected `<tr>` unmarked; a sort sorts the records and moves the `<tr>`s in
//   one forward pass.
// - External events: `serverRows`, `serverDelete` and the snapshot go through a small keyed
//   reconciler (`src/lib.js`, the only generic helper, counted as runtime): rows whose id stays
//   keep their `<tr>` and get only their changed cells rewritten. `serverUpdate` sets the cells
//   of the listed rows through the column's setter. Rows taken from a message are copied
//   before they become records, so a dispatched payload is never adopted or mutated.
// - Formatting (thousands grouping, currency, percent, the three date formats) and the PRNG step
//   are small app helpers in `src/util.js`; the bundler keeps only those an app uses.
// - `dispose` removes each table's listener and the page.

import { JFB_ADJECTIVES, JFB_COLOURS, JFB_NOUNS } from "./spec.js";
import { templateFiles } from "../../frameworks/vanilla/framework.js";

export const framework = "vanilla";

export const params = {};

const str = JSON.stringify;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const indent = (code, pad) => code.split("\n").map((l) => (l ? pad + l : l)).join("\n");
// HTML escaping for the static markup (attributes single-quoted, as vanillajs writes them).
const escText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escAttr = (s) => s.replace(/&/g, "&amp;").replace(/'/g, "&#39;");

const DATA_KINDS = ["label", "text", "number", "date", "status", "flag"];

// ---------------------------------------------------------------------------------------------
// Shared files.

const LIB_FILE = `// The app's only generic helper: keeping a table's rows in step with a new array of them, for the
// events that replace rows wholesale (a server page, a server delete, a snapshot). Each row
// record carries its <tr> in \`tr\`.

// Make the rows of \`parent\` those of \`list\`, in its order, and return \`list\`. A row whose id
// was already there keeps its <tr> (\`patch(old, row)\` rewrites the cells that changed; a record
// that is the same object needs nothing), a new id gets one from \`create(row)\`, and the <tr>s of
// ids that left are removed.
export function reconcile(parent, rows, list, create, patch) {
  const old = new Map();
  for (const r of rows) old.set(r.id, r);
  for (const r of list) {
    const o = old.get(r.id);
    if (!o) create(r);
    else {
      old.delete(r.id);
      if (o !== r) {
        r.tr = o.tr;
        patch(o, r);
      }
    }
  }
  for (const o of old.values()) o.tr.remove();
  place(parent, list);
  return list;
}

// Put the <tr>s of \`rows\` in that order in \`parent\`, in one forward pass: a row already in
// place stays, any other moves before the first row not yet placed (so a list that only lost
// rows moves none).
export function place(parent, rows) {
  let at = parent.firstChild;
  for (const r of rows) {
    if (r.tr === at) at = at.nextSibling;
    else parent.insertBefore(r.tr, at);
  }
}
`;

const UTIL_FILE = `// Small helpers the tables share: the PRNG step and the formatters (no locale APIs).

// One Park–Miller ("minstd") draw: the next state, which the caller then uses.
export const next = (s) => (s * 48271) % 2147483647;

// 1234567 → "1,234,567".
export const group = (n) => String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");

// Cents as "1,234.50", tenths as "12.5".
export const cents = (v) => group(Math.floor(v / 100)) + "." + String(v % 100).padStart(2, "0");
export const tenths = (v) => group(Math.floor(v / 10)) + "." + (v % 10);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const pad = (n) => String(n).padStart(2, "0");

// A day of the year (1-365, no leap years) as [month index, day of the month].
function monthDay(day) {
  let m = 0;
  while (day > DAYS[m]) day -= DAYS[m++];
  return [m, day];
}

// "Mar 14", "14 Mar", "03-14".
export const monD = (day) => { const [m, d] = monthDay(day); return MONTHS[m] + " " + d; };
export const dMon = (day) => { const [m, d] = monthDay(day); return d + " " + MONTHS[m]; };
export const mmDd = (day) => { const [m, d] = monthDay(day); return pad(m + 1) + "-" + pad(d); };
`;

// ---------------------------------------------------------------------------------------------
// One table.

function tableFile(t) {
  const uses = new Set();
  const use = (name) => (uses.add(name), name);
  const columns = t.columns;
  const data = columns.filter((c) => DATA_KINDS.includes(c.kind));
  const computed = columns.filter((c) => c.kind === "computed");
  const col = (name) => columns.find((c) => c.name === name);
  const index = (c) => columns.indexOf(c);
  const hasSelect = !!t.marker;
  const findsRows = columns.some((c) => c.toggle || c.kind === "bump");

  // Module-level data: word pools and status options.
  const consts = [];
  const poolName = new Map();
  const jfb = new Map([[str(JFB_ADJECTIVES), "adjectives"], [str(JFB_COLOURS), "colours"], [str(JFB_NOUNS), "nouns"]]);
  const pool = (key, list, fallback) => {
    if (!poolName.has(key)) {
      const name = jfb.get(str(list)) || fallback;
      poolName.set(key, name);
      consts.push(`const ${name} = ${str(list).replace(/","/g, '", "')};`);
    }
    return poolName.get(key);
  };
  for (const c of data) {
    if (c.kind === "label") c.pools.forEach((p, i) => pool(`${c.name}.${i}`, p, `${c.name.toUpperCase()}_${i + 1}`));
    if (c.kind === "text") pool(c.name, c.pool, c.name.toUpperCase());
    if (c.kind === "status") pool(c.name, c.options, c.name.toUpperCase());
  }
  const options = (c) => poolName.get(c.name);

  // Display code for a value.
  const number = (c, v) => {
    switch (c.format) {
      case "plain": return v;
      case "grouped": return `${use("group")}(${v})`;
      case "unit": return `${use("group")}(${v}) + ${str(" " + c.unit)}`;
      case "currency": return `${str(c.symbol)} + ${use("cents")}(${v})`;
      case "percent": return `${use("tenths")}(${v}) + "%"`;
    }
    throw new Error(`unknown number format ${c.format}`);
  };
  const DATE_FN = { "mon-d": "monD", "d-mon": "dMon", "mm-dd": "mmDd" };
  const cond = (e) => {
    switch (e[0]) {
      case ">": return `r.${e[1]} > ${e[2]}`;
      case "==": return `r.${e[1]} === ${str(e[2])}`;
      case "f": return `r.${e[1]}`;
    }
    throw new Error(`unknown condition ${str(e)}`);
  };
  const computedCode = (c) => {
    const e = c.expr;
    switch (e[0]) {
      case "*": return number(c, `r.${e[1]} * r.${e[2]}`);
      case "+": return number(c, `r.${e[1]} + r.${e[2]}`);
      case "len": return `r.${e[1]}.length`;
      case "if": return `${cond(e[1])} ? ${str(e[2])} : ${str(e[3])}`;
    }
    throw new Error(`unknown expression ${str(e)}`);
  };
  // The statement writing one cell of the row whose cells are `c` (its <td>s).
  const write = (c, cells = "c") => {
    const td = `${cells}[${index(c)}]`;
    switch (c.kind) {
      case "id": return `${td}.firstChild.nodeValue = r.id;`;
      case "label": case "text": return `${td}.firstChild${c.select ? ".firstChild" : ""}.nodeValue = r.${c.name};`;
      case "number": return `${td}.firstChild.nodeValue = ${number(c, `r.${c.name}`)};`;
      case "date": return `${td}.firstChild.nodeValue = ${use(DATE_FN[c.format])}(r.${c.name});`;
      case "status": return `${td}.firstChild.firstChild.nodeValue = r.${c.name};`;
      case "flag": return `${td}.firstChild.checked = r.${c.name};`;
      case "computed": return `${td}.firstChild.nodeValue = ${computedCode(c)};`;
    }
    throw new Error(`no cell write for a ${c.kind} column`);
  };
  const readsOf = (e, out = new Set()) => {
    if (Array.isArray(e)) e.slice(1).forEach((x) => readsOf(x, out));
    else if (typeof e === "string") out.add(e);
    return out;
  };
  const readers = (c) => computed.filter((x) => readsOf(x.expr).has(c.name));
  const setter = (c) => `set${cap(c.name)}`;

  // The row template.
  const cellHTML = (c) => {
    switch (c.kind) {
      case "id": case "number": case "date": case "computed": return "<td> </td>";
      case "label": case "text": return c.select ? `<td><a data-role='${escAttr(c.select)}'> </a></td>` : "<td> </td>";
      case "status": return `<td><${c.tag}> </${c.tag}></td>`;
      case "flag": return `<td><input type='checkbox' data-role='${escAttr(c.toggle)}'></td>`;
      case "remove": {
        const inner = c.glyph ? `<span aria-hidden='true'>${escText(c.text)}</span>` : escText(c.text);
        return `<td><${c.element} data-role='${escAttr(c.role)}'>${inner}</${c.element}></td>`;
      }
      case "bump": return `<td><button data-role='${escAttr(c.role)}'>${escText(c.text)}</button></td>`;
      case "spacer": return "<td></td>";
    }
    throw new Error(`unknown column kind ${c.kind}`);
  };
  const sectionHTML = `<section data-key='${t.id}' data-role='table'><h2>${escText(t.title)}</h2><div>` +
    t.ops.map((o) => `<button data-role='${escAttr(o.name)}'>${escText(o.text)}</button>`).join("") + "</div><table>" +
    (t.thead ? `<thead><tr>${columns.map((c) => `<th>${escText(c.header)}</th>`).join("")}</tr></thead>` : "") +
    "<tbody></tbody></table></section>";

  // The row builder: one draw per generated cell, in column order.
  const draws = [];
  for (const c of data) {
    const n = c.name;
    switch (c.kind) {
      case "label": {
        c.pools.forEach((_, i) => {
          const p = poolName.get(`${n}.${i}`);
          draws.push("s = next(s);", i === 0 ? `let ${n} = ${p}[s % ${p}.length];` : `${n} += " " + ${p}[s % ${p}.length];`);
        });
        break;
      }
      case "text": draws.push("s = next(s);", `const ${n} = ${poolName.get(n)}[s % ${poolName.get(n)}.length];`); break;
      case "number": draws.push("s = next(s);", `const ${n} = ${c.min} + s % ${c.max - c.min + 1};`); break;
      case "date": draws.push("s = next(s);", `const ${n} = 1 + s % 365;`); break;
      case "status": draws.push("s = next(s);", `const ${n} = ${options(c)}[s % ${options(c)}.length];`); break;
      case "flag": draws.push("s = next(s);", `const ${n} = s % 2 === 1;`); break;
    }
  }
  if (draws.length) use("next");
  const record = `{ id: nextId++${data.map((c) => `, ${c.name}`).join("")} }`;

  // The marker of the selected row.
  const mark = !hasSelect ? null : t.marker.attr === "class"
    ? { on: (tr) => `${tr}.className = ${str(t.marker.value)};`, off: (tr) => `${tr}.className = "";` }
    : { on: (tr) => `${tr}.setAttribute(${str(t.marker.attr)}, ${str(t.marker.value)});`, off: (tr) => `${tr}.removeAttribute(${str(t.marker.attr)});` };
  const dropSelection = hasSelect ? "\nif (selectedTr && !selectedTr.parentNode) selectedTr = null;" : "";

  // Functions in the table's closure.
  const fns = [];
  fns.push(`// Build \`count\` rows from the table's PRNG and append them (into a detached <tbody> when the
// table was empty, as vanillajs does).
function add(count) {
  const empty = !rows.length;
  if (empty) tbody.remove();
  let s = rng;
  for (let n = 0; n < count; n++) {
${indent(draws.join("\n"), "    ")}${draws.length ? "\n" : ""}    const r = ${record};
    rows.push(r);
    tbody.appendChild(createRow(r));
  }
  rng = s;
  if (empty) table.appendChild(tbody);
}`);
  fns.push(`function clear() {
  tbody.textContent = "";
  rows = [];${hasSelect ? "\n  selectedTr = null;" : ""}
}`);
  fns.push(`function create(count) {
  clear();
  add(count);
}`);
  const shown = columns.filter((c) => c.kind === "id" || DATA_KINDS.includes(c.kind) || c.kind === "computed");
  fns.push(`function createRow(r) {
  const tr = rowTemplate.cloneNode(true), c = tr.childNodes;
  tr.dataset.key = r.id;
${indent(shown.map((c) => write(c)).join("\n"), "  ")}
  r.tr = tr;
  return tr;
}`);
  // One setter per data column: its cell and the computed cells reading it.
  for (const c of data) {
    const ws = [c, ...readers(c)];
    fns.push(ws.length === 1
      ? `function ${setter(c)}(r) {\n  ${write(c, "r.tr.childNodes")}\n}`
      : `function ${setter(c)}(r) {\n  const c = r.tr.childNodes;\n${indent(ws.map((x) => write(x)).join("\n"), "  ")}\n}`);
  }
  fns.push(`// A server row replacing the record \`o\` with the same id: rewrite what changed.
function patch(o, r) {
${indent(data.map((c) => `if (o.${c.name} !== r.${c.name}) ${setter(c)}(r);`).join("\n"), "  ")}
}`);
  fns.push(`// Replace the rows with \`list\`, keeping the <tr>s of the ids that stay.
function replace(list) {
  rows = reconcile(tbody, rows, list, createRow, patch);${indent(dropSelection, "  ")}
}`);
  if (hasSelect) {
    fns.push(`// Move the selection marker to \`tr\` (null: no selection), touching the two rows only.
function select(tr) {
  if (tr === selectedTr) return;
  if (selectedTr) ${mark.off("selectedTr")}
  if (tr) ${mark.on("tr")}
  selectedTr = tr;
}`);
  }
  if (findsRows) {
    fns.push(`// The record of the row a control belongs to.
function rowOf(el) {
  const tr = el.closest("tr");
  return rows.find((r) => r.tr === tr);
}`);
  }

  // The listener: one case per operation and row control.
  const compare = (name, dir) => {
    const c = name === "id" ? { kind: "id", name: "id" } : col(name);
    const [x, y] = dir === "asc" ? ["a", "b"] : ["b", "a"];
    const n = c.name;
    switch (c.kind) {
      case "id": return `(a, b) => ${x}.id - ${y}.id`;
      case "number": case "date": case "flag": return `(a, b) => ${x}.${n} - ${y}.${n} || a.id - b.id`;
      case "status": return `(a, b) => ${options(c)}.indexOf(${x}.${n}) - ${options(c)}.indexOf(${y}.${n}) || a.id - b.id`;
      case "label": case "text": return `(a, b) => (${x}.${n} < ${y}.${n} ? -1 : ${x}.${n} > ${y}.${n} ? 1 : a.id - b.id)`;
    }
    throw new Error(`cannot sort by a ${c.kind} column`);
  };
  const effect = (op) => {
    const c = col(op.column), n = c.name;
    switch (c.kind) {
      case "label": case "text": return `r.${n} += ${str(op.suffix)};`;
      case "number": return `r.${n} += ${op.delta};`;
      case "date": return op.days === 1 ? `r.${n} = r.${n} % 365 + 1;` : `r.${n} = (r.${n} + ${op.days - 1}) % 365 + 1;`;
      case "status": return `r.${n} = ${options(c)}[(${options(c)}.indexOf(r.${n}) + 1) % ${options(c)}.length];`;
      case "flag": return `r.${n} = !r.${n};`;
    }
    throw new Error(`updateEvery on a ${c.kind} column`);
  };
  const cases = [];
  let usesPlace = false;
  for (const op of t.ops) {
    const label = `case ${str(op.name)}:`;
    switch (op.kind) {
      case "create": cases.push(`${label}\n  create(${op.count});\n  break;`); break;
      case "append": cases.push(`${label}\n  add(${op.count});\n  break;`); break;
      case "clear": cases.push(`${label}\n  clear();\n  break;`); break;
      case "updateEvery":
        cases.push(`${label}
  for (let i = 0; i < rows.length; i += ${op.k}) {
    const r = rows[i];
    ${effect(op)}
    ${setter(col(op.column))}(r);
  }
  break;`);
        break;
      case "swap":
        cases.push(`${label}
  if (rows.length > ${op.j}) {
    const a = rows[${op.i}], b = rows[${op.j}], after = b.tr.nextSibling;
    tbody.insertBefore(b.tr, a.tr);
    tbody.insertBefore(a.tr, after);
    rows[${op.i}] = b;
    rows[${op.j}] = a;
  }
  break;`);
        break;
      case "sort":
        usesPlace = true;
        cases.push(`${label}\n  rows.sort(${compare(op.column, op.dir)});\n  place(tbody, rows);\n  break;`);
        break;
      case "removeChecked":
        cases.push(`${label}
  rows = rows.filter((r) => {
    if (!r.${op.column}) return true;
    r.tr.remove();
    return false;
  });${indent(dropSelection, "  ")}
  break;`);
        break;
      default: throw new Error(`unknown operation ${op.kind}`);
    }
  }
  for (const c of columns) {
    if (c.select) {
      cases.push(`case ${str(c.select)}:\n  select(el.closest("tr"));\n  break;`);
    }
    if (c.toggle) cases.push(`case ${str(c.toggle)}: {\n  const r = rowOf(el);\n  r.${c.name} = !r.${c.name};\n  ${setter(c)}(r);\n  break;\n}`);
    if (c.kind === "bump") cases.push(`case ${str(c.role)}: {\n  const r = rowOf(el);\n  r.${c.column} += ${c.delta};\n  ${setter(col(c.column))}(r);\n  break;\n}`);
    if (c.kind === "remove") {
      cases.push(`case ${str(c.role)}: {
  const tr = el.closest("tr");
  rows.splice(rows.findIndex((r) => r.tr === tr), 1);
  tr.remove();${hasSelect ? "\n  if (tr === selectedTr) selectedTr = null;" : ""}
  break;
}`);
    }
  }
  fns.push(`function onClick(e) {
  const el = e.target.closest("[data-role]");
  switch (el.dataset.role) {
${indent(cases.join("\n"), "    ")}
  }
}`);

  // External events.
  fns.push(`function receive(msg) {
  switch (msg.type) {
    case "serverRows":
      // Copies become our records (edited in place, carrying their <tr>): the message stays the
      // sender's.
      replace(msg.rows.map((r) => ({ ...r })));
      for (const r of msg.rows) if (r.id >= nextId) nextId = r.id + 1;
      break;
    case "serverUpdate": {
      const values = new Map(msg.changes.map((c) => [c.id, c.value]));
      for (const r of rows) {
        if (!values.has(r.id)) continue;
        r[msg.column] = values.get(r.id);
        switch (msg.column) {
${indent(data.map((c) => `case ${str(c.name)}: ${setter(c)}(r); break;`).join("\n"), "          ")}
        }
      }
      break;
    }
    case "serverDelete": {
      const ids = new Set(msg.ids);
      replace(rows.filter((r) => !ids.has(r.id)));
      break;
    }
    case "snapshot": {
      const ts = msg.state.tables.${t.id};
      replace(ts.rows.map((r) => ({ ...r })));
      nextId = ts.nextId;
      rng = ts.rng;${hasSelect ? `
      const id = ts.selected;
      select(id == null ? null : rows.find((r) => r.id === id)?.tr);` : ""}
    }
  }
}`);
  fns.push(`function stop() {
  section.removeEventListener("click", onClick);
}`);

  const libImports = ["reconcile", ...(usesPlace ? ["place"] : [])];
  const utilImports = ["next", "group", "cents", "tenths", "monD", "dMon", "mmDd"].filter((n) => uses.has(n));
  const rowHTML = columns.map(cellHTML).join("");
  return `// ${t.id}: ${t.title}.
${utilImports.length ? `import { ${utilImports.join(", ")} } from "../util.js";\n` : ""}import { ${libImports.join(", ")} } from "../lib.js";
${consts.length ? "\n" + consts.join("\n") + "\n" : ""}
const rowTemplate = document.createElement("tr");
rowTemplate.dataset.role = "row";
rowTemplate.innerHTML = ${str(rowHTML)};

export function ${t.id}(page) {
  page.insertAdjacentHTML("beforeend", ${str(sectionHTML)});
  const section = page.lastChild, table = section.lastChild, tbody = table.lastChild;
  let rows = [], nextId = 1, rng = ${t.rng}${hasSelect ? ", selectedTr = null" : ""};

${indent(fns.join("\n\n"), "  ")}
${t.initialRows ? `\n  add(${t.initialRows});` : ""}
  section.addEventListener("click", onClick);
  return { receive, stop };
}
`;
}

// ---------------------------------------------------------------------------------------------
// The page.

function appFile(spec) {
  const ids = spec.tables.map((t) => t.id);
  return `${ids.map((id) => `import { ${id} } from "./tables/${id}.js";`).join("\n")}

// Render every table into a new page, then put the page in \`root\`.
export function start(root) {
  const page = document.createElement("div");
  page.dataset.role = "page";
  const tables = {
${ids.map((id) => `    ${id}: ${id}(page),`).join("\n")}
  };
  root.appendChild(page);

  // An external event: a snapshot goes to every table, the others to the one they name.
  function receive(msg) {
    if (msg.type === "snapshot") for (const id in tables) tables[id].receive(msg);
    else tables[msg.table].receive(msg);
  }

  function stop() {
    for (const id in tables) tables[id].stop();
    page.remove();
  }

  return { receive, stop };
}
`;
}

export function emit(spec) {
  for (const t of spec.tables) if (!/^t\d+$/.test(t.id)) throw new Error(`unexpected table id ${t.id}`);
  const files = {
    ...templateFiles({ name: "big-table", title: "Big table" }),
    "src/app.js": appFile(spec),
    "src/lib.js": LIB_FILE,
    "src/util.js": UTIL_FILE,
  };
  for (const t of spec.tables) files[`src/tables/${t.id}.js`] = tableFile(t);
  return {
    files,
    style: {
      model: "js-framework-benchmark's vanillajs-keyed, once per table",
      components: "one module per table, written out from its description: its row template, row builder, cell setters, operations, row controls, sort comparators and computed expressions are that table's own code; nothing interpreted",
      rows: "a <tr> template (innerHTML of static cells) cloned with cloneNode(true); dynamic cells written through their placeholder text nodes",
      state: "plain mutable state in each table's closure: rows (records carrying their <tr>), nextId, rng (Park–Miller, as the README specifies) and, for tables with select, the selected <tr> (the selection itself)",
      events: "one delegated click listener per table section, switching on data-role; row controls find their <tr> with closest and their record with find/findIndex",
      updates: "direct DOM operations: textContent = '' to clear, a detached <tbody> while an empty table fills, two insertBefore for a swap, the previous selected <tr> unmarked, sort moves the <tr>s in one forward pass",
      externalEvents: "serverRows, serverDelete and snapshot through a small generic keyed reconciler (src/lib.js, counted as runtime) that keeps every <tr> whose id stays and rewrites only changed cells, fed copies of the message's rows (payloads stay read-only); serverUpdate through the column's setter",
      helpers: "src/util.js: the PRNG step, thousands grouping, currency, percent and date formatters (app code)",
      build: "Vite with no framework plugin, production defaults, hidden source maps",
    },
  };
}
