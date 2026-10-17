// The big-table page (N data tables, each its own component) in Marko 6 (the Tags API).
//
// Style (recorded in every generated app's rr.json):
// - One tag per table (`src/tags/t1-table.marko`, `t2-table.marko`, …, auto-discovered), written
//   from that table's description alone: its row builder, its toolbar handlers, its row controls,
//   its computed cells and its formatting calls are the tag's own code. Nothing is interpreted at
//   runtime: no column descriptors, no op codes. Table 1 follows js-framework-benchmark's Marko
//   entry (`<let/rows>`, `<let/selected>`, `<for|row| of=rows by="id">`, `class=(selected ===
//   row.id && "danger")`, handlers in markup), with the contract's selectors and toolbar.
// - State: each table owns its slice as `<let>`s inside its own tag: `rows`, `selected`, `nextId`
//   and `rng`, initialised from the spec's initial state. Updates are immutable (`map`,
//   `filter`, `toSorted`, spreads, `slice` for the swap), as Marko requires. Row controls find
//   their row by id, never by index or object identity, so two clicks in one task cannot hit the
//   wrong row. Rows are never mutated, and the messages' rows are plain data kept as they are.
// - Rows: `<for|row| of=rows by="id">`, Marko's keyed list. The selection is the expression
//   `selected === row.id` in the row's marker (a `class` or an attribute), which Marko compiles
//   into a selector: a select writes the two rows involved.
// - Handlers in markup (`onClick() { … }`); the row checkboxes are `checked=… checkedChange(…)`.
//   The row builder is a `static function` over the PRNG (shared `prng.js`) that returns the new
//   rows with the advanced `rng` and `nextId`, which the handler assigns. (A `<const>` function
//   that assigns the `<let>`s is not used: it compiled to a signal that fails at run time.)
// - External events: every table `<return>`s one function that applies the events of its own
//   table (a tag variable, `<t3-table/t3/>`); app.marko `<return>`s the function the adapter
//   calls, which routes `serverRows`, `serverUpdate` and `serverDelete` by `msg.table` and sends
//   a `snapshot` to every table. The routing function is declared in the body that declares the
//   tags, after them (frameworks/marko/README.md, "Tag variables and hoisting").
// - Shared helpers (`format.js`, `prng.js`) are the scenario's number and date formatters and its
//   PRNG, counted as app code.

import { templateFiles } from "../../frameworks/marko/framework.js";
import { literal } from "../../frameworks/marko/source.js";

export const framework = "marko";

export const params = {};

// Text in a template child position: a Marko placeholder when it holds markup characters.
function text(s) {
  return /[${}<>&]/.test(s) ? `\${${JSON.stringify(s)}}` : s;
}

const DATE_FORMATS = { "mon-d": "monD", "d-mon": "dMon", "mm-dd": "mmDd" };

// A number in its column's format, as an expression over the value expression `v`.
function formatted(c, v, needs) {
  switch (c.format) {
    case "plain": return v;
    case "grouped": needs.format.add("group"); return `group(${v})`;
    case "unit": needs.format.add("withUnit"); return `withUnit(${v}, ${JSON.stringify(c.unit)})`;
    case "currency": needs.format.add("currency"); return `currency(${v}, ${JSON.stringify(c.symbol)})`;
    case "percent": needs.format.add("percent"); return `percent(${v})`;
  }
  throw new Error(`unknown number format ${c.format}`);
}

// A computed cell's expression, over `row`.
function computed(c, needs) {
  const [op, a, b] = c.expr;
  switch (op) {
    case "*": return formatted(c, `row.${a} * row.${b}`, needs);
    case "+": return formatted(c, `row.${a} + row.${b}`, needs);
    case "len": return `row.${a}.length`;
    case "if": {
      const [cop, x, y] = a;
      const cond = cop === ">" ? `row.${x} > ${y}` : cop === "==" ? `row.${x} === ${JSON.stringify(y)}` : `row.${x}`;
      return `${cond} ? ${JSON.stringify(b)} : ${JSON.stringify(c.expr[3])}`;
    }
  }
  throw new Error(`unknown expression ${JSON.stringify(c.expr)}`);
}

const indent = (s, pad) => s.replace(/^(?=.)/gm, pad);

// ---------------------------------------------------------------------------------------------
// Statics: the pools and options, and the row builder.

function statics(t, needs) {
  const out = [];
  for (const c of t.columns) {
    if (c.kind === "label") c.pools.forEach((p, k) => out.push(`static const ${c.name}Pool${k} = ${literal(p)};`));
    if (c.kind === "text") out.push(`static const ${c.name}Pool = ${literal(c.pool)};`);
    if (c.kind === "status") out.push(`static const ${c.name}Options = ${literal(c.options)};`);
  }
  const draws = [];
  const draw = (line, ...helpers) => {
    helpers.forEach((h) => needs.prng.add(h));
    needs.prng.add("next");
    draws.push(`s = next(s);`, line);
  };
  for (const c of t.columns) {
    switch (c.kind) {
      case "label":
        c.pools.forEach((_, k) => draw(k === 0 ? `row.${c.name} = pick(s, ${c.name}Pool0);` : `row.${c.name} += " " + pick(s, ${c.name}Pool${k});`, "pick"));
        break;
      case "text": draw(`row.${c.name} = pick(s, ${c.name}Pool);`, "pick"); break;
      case "number": draw(`row.${c.name} = between(s, ${c.min}, ${c.max});`, "between"); break;
      case "date": draw(`row.${c.name} = between(s, 1, 365);`, "between"); break;
      case "status": draw(`row.${c.name} = pick(s, ${c.name}Options);`, "pick"); break;
      case "flag": draw(`row.${c.name} = s % 2 === 1;`); break;
    }
  }
  out.push(`// The next \`count\` rows, drawn from the table's PRNG.
static function build(rng, nextId, count) {
  let s = rng;
  let id = nextId;
  const rows = [];
  for (let n = 0; n < count; n++) {
    const row = { id: id++ };
${draws.map((l) => `    ${l}`).join("\n")}
    rows.push(row);
  }
  return { rows, rng: s, nextId: id };
}`);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Toolbar operations: each as that table's own handler body.

function sortKey(c, v) {
  if (c.kind === "status") return `${c.name}Options.indexOf(${v}.${c.name})`;
  if (c.kind === "flag") return `Number(${v}.${c.name})`;
  return `${v}.${c.name}`;
}

// Draw rows from the table's PRNG into `drawn`, advancing `rng` and `nextId`.
function drawRows(count) {
  return `const drawn = build(rng, nextId, ${count});
rng = drawn.rng;
nextId = drawn.nextId;`;
}

function operation(t, o) {
  const dropSelection = t.marker ? "\nselected = null;" : "";
  switch (o.kind) {
    case "create": return `${drawRows(o.count)}\nrows = drawn.rows;${dropSelection}`;
    case "append": return `${drawRows(o.count)}\nrows = rows.concat(drawn.rows);`;
    case "clear": return `rows = [];${dropSelection}`;
    case "swap": return `if (rows.length > ${o.j}) {
  const swapped = rows.slice();
  [swapped[${o.i}], swapped[${o.j}]] = [swapped[${o.j}], swapped[${o.i}]];
  rows = swapped;
}`;
    case "sort": {
      const c = o.column === "id" ? { kind: "id", name: "id" } : t.columns.find((x) => x.name === o.column);
      const a = sortKey(c, "a"), b = sortKey(c, "b");
      const cmp = `${a} < ${b} ? -1 : ${a} > ${b} ? 1 : 0`;
      return `rows = rows.toSorted((a, b) => ${o.dir === "desc" ? `-(${cmp})` : `(${cmp})`} || a.id - b.id);`;
    }
    case "removeChecked": return `const kept = rows.filter((row) => !row.${o.column});
rows = kept;${t.marker ? `
if (!kept.some((row) => row.id === selected)) selected = null;` : ""}`;
    case "updateEvery": {
      const col = t.columns.find((c) => c.name === o.column);
      let fn;
      switch (col.kind) {
        case "label": case "text": fn = `row.${col.name} + ${JSON.stringify(o.suffix)}`; break;
        case "number": fn = `row.${col.name} + ${o.delta}`; break;
        case "date": fn = `((row.${col.name} - 1 + ${o.days}) % 365) + 1`; break;
        case "status": fn = `${col.name}Options[(${col.name}Options.indexOf(row.${col.name}) + 1) % ${col.options.length}]`; break;
        case "flag": fn = `!row.${col.name}`; break;
      }
      return `rows = rows.map((row, i) => (i % ${o.k} === 0 ? { ...row, ${col.name}: ${fn} } : row));`;
    }
  }
  throw new Error(`unknown operation ${o.kind}`);
}

// ---------------------------------------------------------------------------------------------
// Row cells

function cell(t, c, needs) {
  switch (c.kind) {
    case "id": return `<td>\${row.id}</td>`;
    case "label": case "text":
      if (c.select) return `<td><a data-role="${c.select}" onClick() { if (rows.some((r) => r.id === row.id)) selected = row.id }>\${row.${c.name}}</a></td>`;
      return `<td>\${row.${c.name}}</td>`;
    case "number": return `<td>\${${formatted(c, `row.${c.name}`, needs)}}</td>`;
    case "date": needs.format.add(DATE_FORMATS[c.format]); return `<td>\${${DATE_FORMATS[c.format]}(row.${c.name})}</td>`;
    case "status": return `<td><${c.tag}>\${row.${c.name}}</${c.tag}></td>`;
    case "flag": return `<td><input type="checkbox" data-role="${c.toggle}" checked=row.${c.name} checkedChange(on) { rows = rows.map((r) => (r.id === row.id ? { ...r, ${c.name}: on } : r)) }></td>`;
    case "computed": return `<td>\${${computed(c, needs)}}</td>`;
    case "remove": {
      const inner = c.glyph ? `<span aria-hidden="true">${text(c.text)}</span>` : text(c.text);
      const body = `rows = rows.filter((r) => r.id !== row.id);${t.marker ? " if (selected === row.id) selected = null;" : ""}`;
      return `<td><${c.element} data-role="${c.role}" onClick() { ${body} }>${inner}</${c.element}></td>`;
    }
    case "bump": return `<td><button data-role="${c.role}" onClick() { rows = rows.map((r) => (r.id === row.id ? { ...r, ${c.column}: r.${c.column} + ${c.delta} } : r)) }>${text(c.text)}</button></td>`;
    case "spacer": return `<td/>`;
  }
  throw new Error(`unknown column kind ${c.kind}`);
}

// ---------------------------------------------------------------------------------------------
// External events: the table's own function.

function receive(t) {
  const sel = !!t.marker;
  return `<return=(msg) => {
  switch (msg.type) {
    case "serverRows":
      rows = msg.rows;${sel ? `
      if (!msg.rows.some((row) => row.id === selected)) selected = null;` : ""}
      nextId = msg.rows.reduce((max, row) => Math.max(max, row.id + 1), nextId);
      break;
    case "serverUpdate":
      rows = rows.map((row) => {
        const change = msg.changes.find((c) => c.id === row.id);
        return change ? { ...row, [msg.column]: change.value } : row;
      });
      break;
    case "serverDelete":
      rows = rows.filter((row) => !msg.ids.includes(row.id));${sel ? `
      if (msg.ids.includes(selected)) selected = null;` : ""}
      break;
    case "snapshot": {
      const state = msg.state.tables.${t.id};
      rows = state.rows;${sel ? `
      selected = state.selected;` : ""}
      nextId = state.nextId;
      rng = state.rng;
      break;
    }
  }
}>`;
}

// ---------------------------------------------------------------------------------------------
// The tag

function tableTag(t, initial) {
  const needs = { format: new Set(), prng: new Set() };
  const stat = statics(t, needs);
  const cells = t.columns.map((c) => `          ${cell(t, c, needs)}`);
  const buttons = t.ops.map((o) => {
    const body = operation(t, o);
    const label = text(o.text);
    if (!body.includes("\n")) return `    <button data-role="${o.name}" onClick() { ${body} }>${label}</button>`;
    return `    <button data-role="${o.name}" onClick() {\n${indent(body, "      ")}\n    }>\n      ${label}\n    </button>`;
  });
  const thead = t.thead
    ? `      <thead>
        <tr>
${t.columns.map((c) => (c.header ? `          <th>${text(c.header)}</th>` : `          <th></th>`)).join("\n")}
        </tr>
      </thead>
`
    : "";
  const marker = t.marker
    ? `\n          ${t.marker.attr}=(selected === row.id && ${JSON.stringify(t.marker.value)})`
    : "";

  const imports = [];
  if (needs.prng.size) imports.push(`import { ${[...needs.prng].sort().join(", ")} } from "../prng";`);
  if (needs.format.size) imports.push(`import { ${[...needs.format].sort().join(", ")} } from "../format";`);

  const lets = [
    `<let/rows=${literal(initial.rows)}>`,
    t.marker ? `<let/selected=${literal(initial.selected)}>` : null,
    `<let/nextId=${initial.nextId}>`,
    `<let/rng=${initial.rng}>`,
  ].filter(Boolean);

  return `${imports.join("\n")}${imports.length ? "\n\n" : ""}${stat.join("\n\n")}

${lets.join("\n")}

<section data-key="${t.id}" data-role="table">
  <h2>${text(t.title)}</h2>
  <div>
${buttons.join("\n")}
  </div>
  <table>
${thead}    <tbody>
      <for|row| of=rows by="id">
        <tr
          data-key=row.id
          data-role="row"${marker}>
${cells.join("\n")}
        </tr>
      </for>
    </tbody>
  </table>
</section>

${receive(t)}
`;
}

// ---------------------------------------------------------------------------------------------
// Files

const PRNG_FILE = `// The PRNG every table carries in its state: Park–Miller. One draw advances the state, then
// uses it.
export const next = (s) => (s * 48271) % 2147483647;
export const pick = (s, list) => list[s % list.length];
export const between = (s, min, max) => min + (s % (max - min + 1));
`;

const FORMAT_FILE = `// Number and date formatting: no locale APIs.
export const group = (n) => String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
export const withUnit = (n, unit) => \`\${group(n)} \${unit}\`;
export const currency = (cents, symbol) => \`\${symbol}\${group(Math.floor(cents / 100))}.\${String(cents % 100).padStart(2, "0")}\`;
export const percent = (tenths) => \`\${group(Math.floor(tenths / 10))}.\${tenths % 10}%\`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const pad = (n) => String(n).padStart(2, "0");

// Day of the year (1-365) as [month index, day of the month].
function split(day) {
  let m = 0;
  while (day > MONTH_DAYS[m]) day -= MONTH_DAYS[m++];
  return [m, day];
}

export const monD = (day) => {
  const [m, d] = split(day);
  return \`\${MONTHS[m]} \${d}\`;
};
export const dMon = (day) => {
  const [m, d] = split(day);
  return \`\${d} \${MONTHS[m]}\`;
};
export const mmDd = (day) => {
  const [m, d] = split(day);
  return \`\${pad(m + 1)}-\${pad(d)}\`;
};
`;

const tagName = (t) => `${t.id}-table`;

function appFile(spec) {
  return `<div data-role="page">
${spec.tables.map((t) => `  <${tagName(t)}/${t.id}/>`).join("\n")}

  // External events: each table applies the events of its own table; a snapshot goes to all of
  // them. Declared after the tags, in their body, because they read the tags' variables.
  <const/receive=(msg) => {
    const tables = { ${spec.tables.map((t) => t.id).join(", ")} };
    if (msg.type === "snapshot") {
      for (const table of Object.values(tables)) table(msg);
    } else {
      tables[msg.table](msg);
    }
  }>
</div>

// The root's tag variable, which the adapter calls with each message.
<return=receive>
`;
}

export function emit(spec) {
  const files = {
    ...templateFiles({ name: "big-table", title: "Data tables" }),
    "src/app.marko": appFile(spec),
    "src/prng.js": PRNG_FILE,
    "src/format.js": FORMAT_FILE,
  };
  for (const t of spec.tables) files[`src/tags/${tagName(t)}.marko`] = tableTag(t, spec.initialState.tables[t.id]);
  return {
    files,
    style: {
      components: "one tag per table (src/tags/<id>-table.marko), written from the table's description; row builder, handlers, computed cells and formatting calls are its own code; no column descriptors",
      state: "each table owns its { rows, selected, nextId, rng } as <let>s in its own tag; immutable updates (map, filter, toSorted, slice for swap); row controls find their row by id",
      externalEvents: "every table <return>s a function for its own events (tag variable); app.marko <return>s the function the adapter calls: routes server events by msg.table, snapshot to every table",
      lists: "<for|row| of=rows by=\"id\">, as js-framework-benchmark's Marko entry",
      selection: "the expression selected === row.id in the row's class or attribute marker (Marko compiles it to a selector)",
      cells: "${} text in plain elements; computed cells and formatting calls inline in the row",
      events: "handlers in markup (onClick); checked/checkedChange for the row checkboxes",
      build: "Vite + @marko/vite (linked: false), production mode, client-only mount, hidden source maps",
    },
  };
}
