// big-table as tea-dirtybits, a prototype strategy (see frameworks/tea-dirtybits/README.md).
//
// This emitter plays the compiler: it writes what an ideal TEA compiler would emit for a page of
// data tables, each its own module written from that table's description alone. Style (recorded
// in every generated app's rr.json):
// - One module per table (src/tables/<id>.js): its pools, its row builder (the PRNG draws written
//   out in column order), its reducer (a table of arms by message tag, each returning
//   `[bits, fields, payload]`), its row template and static row patch, its click handler, and
//   its initial state. Nothing is interpreted: no column descriptors, no op codes.
// - Rows are dynamic data, so a table has two kinds of dirty bits (src/grid.js): the table's
//   (rows 1, selected 2, gone 4, moved 8, added 16) and one bit per data column of a row (32 up).
//   An arm marks what it wrote and names the rows it touched in its payload: select touches two
//   rows' markers, remove one node, swap two, append the new rows, toggle, bump and updateEvery
//   only the cells of the rows they edited. Only create, sort, clear and the server's rows ask
//   for the keyed reconcile of the whole list (bit 1).
// - A row is built from one cloned template (parsed once); its static patch tests the column
//   bits of the cells it writes (a computed cell tests every column its expression reads).
//   Events are delegated: one click listener per table, whose switch on data-role sends the
//   message; a row's control sends the row's current item with it, so the reducer finds it with
//   one native scan.
// - One app module (src/app.js): the tables in page order, the app reducer (routes a message to
//   its table's reducer, files the bits under the table; the server's rows, updates and deletes
//   are handled here, as they name no column), and the view whose patch runs the dirty tables'.

import { templateFiles, templateFile, trimTemplate } from "../../frameworks/tea-dirtybits/framework.js";
import { literal } from "../../frameworks/shared/jsx.js";

export const framework = "tea-dirtybits";

export const params = {};

const J = JSON.stringify;
const indent = (lines) => lines.join("\n").split("\n").map((l) => (l ? "  " + l : l)).join("\n");
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);

const DATA = ["label", "text", "number", "date", "status", "flag"];
const DRAW = "r = r * 48271 % 2147483647;";
const UP = (name) => name.toUpperCase();

// The optional end tags of table markup (`</td>` before another cell or the row's end, …), left out
// as an HTML minifier would; the parser closes them the same.
const tableTags = (m) => m
  .replace(/<\/t([dh])>(?=<t[dh][\s>]|<\/tr>)/g, "")
  .replace(/<\/tr>(?=<tr[\s>]|<\/tbody>|<\/thead>)/g, "")
  .replace(/<\/thead>(?=<tbody)/g, "");

const REGISTRY = `// Every table, by id, in page order (each module adds its own when the app imports it).
export const TABLES = {};
`;

function tableModule(t) {
  const col = (name) => t.columns.find((c) => c.name === name);
  const data = t.columns.filter((c) => DATA.includes(c.kind));
  const bit = (name) => 32 << data.findIndex((c) => c.name === name); // the cell's bit in a row's dirty word
  const sel = !!t.marker;
  const consts = [];

  // Pools and options: genuinely data, named by their column.
  for (const c of data) {
    if (c.kind === "label") c.pools.forEach((p, k) => consts.push(`const ${UP(c.name)}${k} = ${literal(p)};`));
    if (c.kind === "text") consts.push(`const ${UP(c.name)} = ${literal(c.pool)};`);
    if (c.kind === "status") consts.push(`const ${UP(c.name)} = ${literal(c.options)};`);
  }

  // The row builder: one draw per generated cell in column order (a label: one per pool).
  const draws = [];
  data.forEach((c, i) => {
    switch (c.kind) {
      case "label":
        c.pools.forEach((p, k) => draws.push(DRAW, k ? `c${i} += " " + ${UP(c.name)}${k}[r % ${p.length}];` : `let c${i} = ${UP(c.name)}0[r % ${p.length}];`));
        break;
      case "text": draws.push(DRAW, `const c${i} = ${UP(c.name)}[r % ${c.pool.length}];`); break;
      case "number": draws.push(DRAW, `const c${i} = ${c.min ? c.min + " + " : ""}r % ${c.max - c.min + 1};`); break;
      case "date": draws.push(DRAW, `const c${i} = 1 + r % 365;`); break;
      case "status": draws.push(DRAW, `const c${i} = ${UP(c.name)}[r % ${c.options.length}];`); break;
      case "flag": draws.push(DRAW, `const c${i} = r % 2 === 1;`); break;
    }
  });
  const make = `// The row builder: the table's PRNG draws, in column order, then the next id.
const make = (s, n) => {
  let r = s.rng, id = s.nextId;
  const rows = [];
  while (n--) {
${indent([indent([...draws, `rows.push({ id: id++, ${data.map((c, i) => `${c.name}: c${i}`).join(", ")} });`])])}
  }
  return { rows, rng: r, nextId: id };
};`;

  // A number in its column's format; `v` is the source of the value.
  const fmt = (c, v) => {
    switch (c.format) {
      case "plain": return v;
      case "grouped": return `group(${v})`;
      case "unit": return `group(${v}) + ${J(" " + c.unit)}`;
      case "currency": return `money(${J(c.symbol)}, ${v})`;
      case "percent": return `pct(${v})`;
    }
    throw new Error(`format ${c.format}`);
  };
  const dateFn = { "mon-d": "monD", "d-mon": "dMon", "mm-dd": "mmDd" };

  // The row template and its bound elements (the cells the code writes), in column order.
  const cells = [];
  const bound = []; // [td index, firstChild?]
  const fills = []; // [mask, statement] with the record index filled in below
  t.columns.forEach((c, k) => {
    const dyn = (inner, expr, mask, how = "setText") => {
      cells.push(inner ? `<td>${inner}</td>` : "<td></td>");
      bound.push([k, !!inner]);
      fills.push([mask, `${how}(r[${bound.length + 1}], ${expr});`]);
    };
    switch (c.kind) {
      case "id": dyn("", "row.id", 1); break;
      case "label": case "text": dyn(c.select ? `<a data-role=${c.select}></a>` : "", `row.${c.name}`, bit(c.name)); break;
      case "number": dyn("", fmt(c, `row.${c.name}`), bit(c.name)); break;
      case "date": dyn("", `${dateFn[c.format]}(row.${c.name})`, bit(c.name)); break;
      case "status": dyn(`<${c.tag}></${c.tag}>`, `row.${c.name}`, bit(c.name)); break;
      case "flag": dyn(`<input type=checkbox data-role=${c.toggle}>`, `row.${c.name}`, bit(c.name), "setChecked"); break;
      case "computed": {
        const e = c.expr;
        const reads = e[0] === "if" ? [e[1][1]] : e[0] === "len" ? [e[1]] : [e[1], e[2]];
        let v;
        switch (e[0]) {
          case "*": v = fmt(c, `row.${e[1]} * row.${e[2]}`); break;
          case "+": v = fmt(c, `row.${e[1]} + row.${e[2]}`); break;
          case "len": v = fmt(c, `row.${e[1]}.length`); break;
          case "if": {
            const [op, name, k2] = e[1];
            const cond = op === ">" ? `row.${name} > ${J(k2)}` : op === "==" ? `row.${name} === ${J(k2)}` : `row.${name}`;
            v = `${cond} ? ${J(e[2])} : ${J(e[3])}`;
            break;
          }
          default: throw new Error(`computed ${J(e)}`);
        }
        dyn("", v, reads.reduce((m, n) => m | bit(n), 0));
        break;
      }
      case "remove":
        cells.push(c.glyph
          ? `<td><a data-role=${c.role}><span aria-hidden=true>${esc(c.text)}</span></a></td>`
          : `<td><${c.element} data-role=${c.role}>${esc(c.text)}</${c.element}></td>`);
        break;
      case "bump": cells.push(`<td><button data-role=${c.role}>${esc(c.text)}</button></td>`); break;
      case "spacer": cells.push("<td></td>"); break;
      default: throw new Error(`column ${c.kind}`);
    }
  });
  const rowMarkup = trimTemplate(tableTags(`<tr data-role=row>${cells.join("")}</tr>`));
  const last = Math.max(...bound.map(([k]) => k));
  const tds = Array.from({ length: last + 1 }, (_, k) => (bound.some(([j]) => j === k) ? `c${k}` : "")).join(", ");
  const refs = bound.map(([k, inner]) => (inner ? `c${k}.firstChild` : `c${k}`));
  const rowFile = `// The row: a clone of one template; its record is the row, its item (set by the grid) and the cells
// the patch writes.
const row = clone(${J(rowMarkup)}, (tr) => {
  const [${tds}] = tr.children;
  return [tr, 0, ${refs.join(", ")}];
});

// The row's static patch: the cells whose column bits are set.
const fill = (r, row, b) => {
${fills.map(([mask, stmt]) => `  if (b & ${mask}) ${stmt}`).join("\n")}
};`;

  // The selection marker.
  let mark = "";
  if (sel) {
    const { attr, value } = t.marker;
    if (attr === "class") mark = `(n, on) => n.classList.toggle(${J(value)}, on)`;
    else if (attr === "aria-selected") mark = `(n, on) => (n.ariaSelected = on ? ${J(value)} : null)`;
    else throw new Error(`marker ${attr}`);
  }

  // The reducer: ops in toolbar order (message tags 0…), then the row controls in column order.
  const ctls = [];
  for (const c of t.columns) {
    if (c.select) ctls.push({ kind: "select", role: c.select });
    if (c.toggle) ctls.push({ kind: "toggle", role: c.toggle, column: c.name });
    if (c.kind === "remove") ctls.push({ kind: "remove", role: c.role });
    if (c.kind === "bump") ctls.push({ kind: "bump", role: c.role, column: c.column, delta: c.delta });
  }
  const used = new Set();
  const arms = [];
  const tags = [];
  const comparator = (op) => {
    const [a, b] = op.dir === "desc" ? ["b", "a"] : ["a", "b"];
    if (op.column === "id") return `(a, b) => ${a}.id - ${b}.id`;
    const c = col(op.column), k = c.name;
    if (c.kind === "text" || c.kind === "label") return `(a, b) => ${a}.${k} < ${b}.${k} ? -1 : ${a}.${k} > ${b}.${k} ? 1 : a.id - b.id`;
    if (c.kind === "status") return `(a, b) => ${UP(k)}.indexOf(${a}.${k}) - ${UP(k)}.indexOf(${b}.${k}) || a.id - b.id`;
    return `(a, b) => ${a}.${k} - ${b}.${k} || a.id - b.id`;
  };
  // The new value of a cell for updateEvery.
  const effect = (op) => {
    const c = col(op.column), k = c.name;
    switch (c.kind) {
      case "label": case "text": return `r.${k} + ${J(op.suffix)}`;
      case "number": return `r.${k} + ${op.delta}`;
      case "date": return `((r.${k} - 1 + ${op.days}) % 365) + 1`;
      case "status": return `${UP(k)}[(${UP(k)}.indexOf(r.${k}) + 1) % ${c.options.length}]`;
      case "flag": return `!r.${k}`;
    }
    throw new Error(`updateEvery on ${c.kind}`);
  };
  for (const op of t.ops) {
    tags.push(op.name);
    switch (op.kind) {
      case "create": arms.push(sel ? `(s) => [3, { ...make(s, ${op.count}), selected: null }],` : `(s) => [1, make(s, ${op.count})],`); break;
      case "append":
        arms.push(`(s) => {\n  const m = make(s, ${op.count});\n  return [16, { ...m, rows: s.rows.concat(m.rows) }, m.rows];\n},`);
        break;
      case "updateEvery": used.add("every"); arms.push(`(s) => every(s, ${op.k}, ${bit(op.column)}, (r) => ({ ${op.column}: ${effect(op)} })),`); break;
      case "clear": arms.push(sel ? "() => [3, { rows: [], selected: null }]," : "() => [1, { rows: [] }],"); break;
      case "swap": used.add("swap"); arms.push(`(s) => swap(s, ${op.i}, ${op.j}),`); break;
      case "sort": arms.push(`(s) => [1, { rows: s.rows.toSorted(${comparator(op)}) }],`); break;
      case "removeChecked": used.add("drop"); arms.push(`(s) => drop(s, (r) => r.${op.column}),`); break;
      default: throw new Error(`op ${op.kind}`);
    }
  }
  for (const c of ctls) {
    tags.push(c.role);
    switch (c.kind) {
      case "select": arms.push("(s, { row }) => s.selected !== row.id && [2, { selected: row.id }],"); break;
      case "toggle": used.add("edit"); arms.push(`(s, { row }) => edit(s, row, ${bit(c.column)}, (r) => ({ ${c.column}: !r.${c.column} })),`); break;
      case "bump": used.add("edit"); arms.push(`(s, { row }) => edit(s, row, ${bit(c.column)}, (r) => ({ ${c.column}: r.${c.column} + ${c.delta} })),`); break;
      case "remove":
        used.add("at");
        arms.push(sel
          ? "(s, { row }) => [6, { rows: s.rows.toSpliced(at(s.rows, row), 1), selected: s.selected === row.id ? null : s.selected }, [row.id]],"
          : "(s, { row }) => [4, { rows: s.rows.toSpliced(at(s.rows, row), 1) }, [row.id]],");
        break;
    }
  }

  // The view: the section's markup, the grid, and the click handler (a switch on data-role).
  const head = t.thead ? `<thead><tr>${t.columns.map((c) => `<th>${esc(c.header)}</th>`).join("")}</tr></thead>` : "";
  const section = `<section data-key=${t.id} data-role=table><h2>${esc(t.title)}</h2><div>${t.ops.map((o) => `<button data-role=${o.name}>${esc(o.text)}</button>`).join("")}</div><table>${head}<tbody></tbody></table></section>`;
  const cases = [];
  t.ops.forEach((o, i) => cases.push(`case ${J(o.name)}: return go(${i});`));
  ctls.forEach((c, i) => cases.push(`case ${J(c.role)}: return go(${t.ops.length + i}, el);`));
  const view = `const view = (page) => {
  const t = html(${J(trimTemplate(tableTags(section)))}, page);
  const [patch, rowOf] = grid(t[0].lastChild.lastChild, row, fill${mark ? ", mark" : ""});
  const go = (type, el) => send({ table: ${J(t.id)}, type, row: el && rowOf(el) });
  t[0].addEventListener("click", (e) => {
    const el = e.target.closest("[data-role]");
    switch (el.dataset.role) {
${cases.map((c) => `      ${c}`).join("\n")}
    }
  });
  return patch;
};`;

  // The initial state: the initial rows are built at start-up by the table's own row builder.
  const init = t.initialRows
    ? `() => ({ ...make({ rng: ${t.rng}, nextId: 1 }, ${t.initialRows}), selected: null })`
    : `() => ({ rows: [], selected: null, nextId: 1, rng: ${t.rng} })`;

  const bits = [`rows 1`, `selected 2`, `gone 4`, `moved 8`, `added 16`, ...data.map((c) => `${c.name} ${bit(c.name)}`)];
  const body = [
    consts.join("\n"), make, rowFile, mark ? `// The selection marker.\nconst mark = ${mark};` : "",
    `// The reducer: its arms by message tag.\nconst arms = [\n${indent(arms)}\n];`, view,
  ].filter(Boolean).join("\n\n");
  const rt = ["html", "send", "setChecked", "setText"].filter((h) => new RegExp(`\\b${h}\\(`).test(body) || (h === "send" && /\bsend\(/.test(body)));
  const gr = ["at", "clone", "dMon", "drop", "edit", "every", "grid", "group", "mmDd", "monD", "money", "pct", "swap"].filter((h) => new RegExp(`\\b${h}\\(`).test(body));
  return `import { ${rt.join(", ")} } from "../runtime.js";
import { ${gr.join(", ")} } from "../grid.js";
import { TABLES } from "./registry.js";

// Dirty bits: ${bits.join(", ")}.
// Message tags: ${tags.map((n, i) => `${n} ${i}`).join(", ")}.

${body}

TABLES.${t.id} = [view, arms, ${init}];
`;
}

function appFile(spec) {
  const ids = spec.tables.map((t) => t.id);
  return `import { dirty, html } from "./runtime.js";
import { drop, kept, maxId } from "./grid.js";
import { TABLES } from "./tables/registry.js";
// Every table in page order: each module adds its own [view, reducer, initial state].
${ids.map((id) => `import "./tables/${id}.js";`).join("\n")}

// The initial model: one slice per table, from its module.
export function init() {
  const tables = {};
  for (const id in TABLES) tables[id] = TABLES[id][2]();
  return { tables };
}

// A table's new slice, with the bits and payload of what changed. A second event of one tick
// asks for the whole list to be reconciled (bit 1), which covers both.
function set(model, id, s, bits, payload) {
  const d = dirty[id];
  dirty[id] = d ? [d[0] | bits | 1] : [bits, payload];
  return { tables: { ...model.tables, [id]: s } };
}

// Run one table's reducer arm.
function route(model, id, msg) {
  const s = model.tables[id];
  const next = TABLES[id][1][msg.type](s, msg);
  // An arm returns the fields it wrote, or nothing when the slice is unchanged.
  return next ? set(model, id, { ...s, ...next[1] }, next[0], next[2]) : model;
}

// The app reducer: user messages go to their table; the server's events name no column, so they
// are handled here.
export function update(model, msg) {
  switch (msg.type) {
    case "serverRows": {
      const s = model.tables[msg.table];
      const rows = msg.rows;
      return set(model, msg.table, { ...s, rows, selected: kept(rows, s.selected), nextId: Math.max(s.nextId, maxId(rows) + 1) }, 3);
    }
    case "serverUpdate": {
      const s = model.tables[msg.table];
      const rows = s.rows.slice();
      const edited = [];
      for (const { id, value } of msg.changes) {
        const i = rows.findIndex((r) => r.id === id);
        if (i >= 0 && rows[i][msg.column] !== value) edited.push((rows[i] = { ...rows[i], [msg.column]: value }));
      }
      return edited.length ? set(model, msg.table, { ...s, rows }, -32, edited) : model;
    }
    case "serverDelete": {
      const s = model.tables[msg.table];
      const ids = new Set(msg.ids);
      const next = drop(s, (r) => ids.has(r.id));
      return next[2].length ? set(model, msg.table, { ...s, ...next[1] }, next[0], next[2]) : model;
    }
    case "snapshot":
      for (const id in msg.state.tables) dirty[id] = [3];
      return msg.state;
  }
  return route(model, msg.table, msg);
}

// Builds every table once (each view appends its section) and runs its patch with the rows and
// the selection. The returned patch runs the patch of each dirty table.
export function view(root, model) {
  const page = html("<div data-role=page>", root)[0];
  const patches = {};
  for (const id in TABLES) {
    patches[id] = TABLES[id][0](page);
    patches[id](model.tables[id], 3);
  }
  return (model, d) => {
    for (const id in d) patches[id](model.tables[id], d[id][0], d[id][1]);
  };
}
`;
}

export function emit(spec) {
  const files = {
    ...templateFiles({ name: "big-table", title: "Big table" }),
    "src/grid.js": templateFile("grid.js"),
    "src/tables/registry.js": REGISTRY,
  };
  for (const t of spec.tables) files[`src/tables/${t.id}.js`] = tableModule(t);
  files["src/app.js"] = appFile(spec);
  return {
    files,
    style: {
      components: "one module per table (pools, row builder with the PRNG draws written out, reducer arms by message tag, row template and static row patch, click handler, initial state), each written from that table's description; nothing interpreted at runtime",
      state: "one immutable TEA model (the reference's shape); the app reducer routes messages to the tables' reducers",
      dirtyBits: "per table: rows 1, selected 2, gone 4, moved 8, added 16; per row: one bit per data column from 32 up; an arm returns [bits, fields, payload] with the compile-time bits of what it wrote and the rows it touched; a second event in one tick files bit 1 (reconcile the list)",
      rows: "select marks two rows, remove drops one node, swap moves two, append builds the new rows, toggle, bump and updateEvery patch only the edited rows' cells (the column's bit); create, sort, clear and serverRows reconcile the keyed list (new rows built, changed items patched, gone rows removed, one walk moves misplaced nodes)",
      rowBuilding: "one cloned template per table (parsed once); bound cells found by position; a static row patch with a test per cell",
      events: "delegated: one click listener per table, a switch on data-role sending a numbered message; a row's control sends the row's current item, so the reducer finds it with one native scan (indexOf), by id when the item is stale",
      externalEvents: "through the same send: serverRows reconciles the list, serverUpdate and serverDelete name the rows touched, snapshot files bits 3 for every table",
      build: "Vite with no framework plugin, production defaults, hidden source maps",
    },
  };
}
