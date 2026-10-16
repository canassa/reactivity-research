// The derived-graph scenario in Marko 6 (the Tags API).
//
// Style (recorded in every generated app's rr.json):
// - One root template, `src/app.marko`, holds the sheet and the items table, the way a person
//   writes a Marko page: inputs and items are `<let>`s, every formula is a `<const>`, every display
//   reads the values it shows. Marko's compiler turns that into its dependency graph: a write to a
//   `<let>` runs the `<const>`s that read it, in order, each once, and the displays that read
//   them; a `<const>` whose value is the same as before (`===`) runs none of its readers. That is
//   the memoization and the equality cut-off, without a line of the app's code asking for them.
//   Formulas that build a list (a filter, a top-k, a group sum) produce a new array each time they
//   run, so their readers run.
// - Formulas are written as expressions over the cells (`<const/dutyOwed=Math.floor(…)>`), in unit
//   order; item expressions are arrow functions given to the collection helpers (`sumBy`, `avgBy`,
//   `maxBy`, `minBy`, `topBy`, `sumByCategory`), which are `static` functions of the template.
//   The item builder's PRNG and the number formatters are `static` too: the scenario's own code.
// - Inputs: a number input is the `int-field` tag, a controllable `<let/value:=input.value>` with a
//   `<let/pending>` for an edit that is not a valid integer in range (the cheat sheet's pattern),
//   bound with `value:=name`; step buttons are `onClick` handlers that clamp; a checkbox is
//   `checked:=name`; a select is `<select value:=name>` with its options written out.
// - Items: `items`, `nextId` and `rng` are `<let>`s of the root; the rows are a `<for … by="id">`
//   in the same template. An edit replaces the array (`items.map`, matching the row by id, so a
//   row removed by an earlier event is a no-op); an edited row is a new object, the others keep
//   theirs, so Marko's identity checks leave their cells alone. A row's quantity commits through
//   `int-field`'s `valueChange`, its note through the input's `valueChange`.
// - Top-k and group lists are `<for>` over the formula's value, keyed by item id (top) or by
//   category (group rows, over the static category list).
// - External events: the root `<return>`s one function, the root's tag variable, that assigns the
//   `<let>`s; dispatched items are copied, never adopted. The six initial items are built at
//   start-up by the item builder.

import { templateFiles } from "../../frameworks/marko/framework.js";
import { literal } from "../../frameworks/marko/source.js";

export const framework = "marko";

export const params = {};

const str = JSON.stringify;
const text = (s) => String(s).replace(/</g, "&lt;").replace(/\$\{/g, "\\${");

// Names the generated code uses itself: no cell may share one.
const RESERVED = new Set([
  "input", "item", "items", "it", "cat", "i", "markup", "nextId", "rng", "initial", "msg", "state", "values", "name", "value",
  "setInput", "buildItems", "formatGrouped", "formatMoney", "groupDigits", "sumBy", "avgBy", "maxBy", "minBy", "topBy",
  "sumByCategory", "CATS", "ADJ", "NOUN", "Math", "Number", "Object", "Map", "Set", "String",
]);

const cap = (s) => s[0].toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------------------------
// Formulas, compiled to JavaScript over the cells (each a `<let>` or `<const>` named like it).

function js(e, cats) {
  const a = (k) => js(e[k], cats);
  const all = (from = 1) => e.slice(from).map((x) => js(x, cats));
  switch (e[0]) {
    case "k": return typeof e[1] === "string" ? str(e[1]) : e[1] < 0 ? `(${e[1]})` : String(e[1]);
    case "v": return e[1];
    case "i": return `it.${e[1]}`;
    case "items": return "items";
    case "+": return `(${all().join(" + ")})`;
    case "-": return `(${a(1)} - ${a(2)})`;
    case "*": return `(${a(1)} * ${a(2)})`;
    case "div": return `Math.floor(${a(1)} / ${a(2)})`;
    case "pct": return `Math.floor((${a(1)} * ${a(2)}) / 100)`;
    case "min": return `Math.min(${all().join(", ")})`;
    case "max": return `Math.max(${all().join(", ")})`;
    case "abs": return `Math.abs(${a(1)})`;
    case "if": return `(${a(1)} ? ${a(2)} : ${a(3)})`;
    case "<": case "<=": case ">": case ">=": return `(${a(1)} ${e[0]} ${a(2)})`;
    case "==": return `(${a(1)} === ${a(2)})`;
    case "!=": return `(${a(1)} !== ${a(2)})`;
    case "and": return `(${all().join(" && ")})`;
    case "or": return `(${all().join(" || ")})`;
    case "not": return `!${a(1)}`;
    case "count": return `${a(1)}.length`;
    case "sum": return `sumBy(${a(1)}, (it) => ${a(2)})`;
    case "avg": return `avgBy(${a(1)}, (it) => ${a(2)})`;
    case "maxOf": return `maxBy(${a(1)}, (it) => ${a(2)})`;
    case "minOf": return `minBy(${a(1)}, (it) => ${a(2)})`;
    case "filter": return `${a(1)}.filter((it) => ${a(2)})`;
    case "top": return `topBy(${a(1)}, (it) => ${a(2)}, ${e[3] === "desc" ? -1 : 1}, ${e[4]})`;
    case "groupSum": return `sumByCategory(${a(1)}, (it) => ${a(2)})`;
    case "at": return `${a(1)}[${cats.indexOf(e[2])}]`;
  }
  throw new Error(`unknown expression ${JSON.stringify(e)}`);
}

// ---------------------------------------------------------------------------------------------

const HELPERS = {
  sumBy: `static function sumBy(list, value) {
  let total = 0;
  for (const it of list) total += value(it);
  return total;
}`,
  avgBy: `static function avgBy(list, value) {
  return list.length ? Math.floor(sumBy(list, value) / list.length) : 0;
}`,
  maxBy: `static function maxBy(list, value) {
  return list.length ? Math.max(...list.map(value)) : 0;
}`,
  minBy: `static function minBy(list, value) {
  return list.length ? Math.min(...list.map(value)) : 0;
}`,
  topBy: `// The first \`k\` items by \`value\`, ascending when \`sign\` is 1 and descending when it is -1; ties by id.
static function topBy(list, value, sign, k) {
  return list.toSorted((a, b) => sign * (value(a) - value(b)) || a.id - b.id).slice(0, k);
}`,
  sumByCategory: `// The sum of \`value\` per category, in the order of CATS.
static function sumByCategory(list, value) {
  return CATS.map((cat) => sumBy(list.filter((it) => it.category === cat), value));
}`,
};

const INT_FIELD = `<let/value:=input.value>
<let/pending=null>
<const/draft=pending ?? value>

<input type="number" data-role=input.msg value=draft valueChange(text) {
  const n = Number(text);
  if (text.trim() !== "" && Number.isInteger(n) && n >= input.min && n <= input.max) {
    value = n;
    pending = null;
  } else {
    pending = text;
  }
}>
`;

function appFile(spec) {
  const cats = spec.categories;
  const cur = spec.currency;
  const cells = new Map();
  const msgs = new Map();
  const inputs = [];
  for (const u of spec.units) {
    for (const c of u.inputs) {
      cells.set(c.name, c);
      inputs.push(c);
    }
    cells.set(u.cell.name, u.cell);
    for (const m of u.messages) msgs.set(m.name, m);
  }
  for (const name of cells.keys()) {
    if (RESERVED.has(name)) throw new Error(`cell name ${name} is a name the generated code uses`);
  }

  // A number as the text a display shows, ready for `${…}` (pct appends the sign outside).
  const showNum = (format, v) => {
    switch (format) {
      case "plain": return `\${${v}}`;
      case "grouped": return `\${formatGrouped(${v})}`;
      case "currency": return `\${formatMoney(${v})}`;
      case "pct": return `\${${v}}%`;
    }
    throw new Error(`unknown format ${format}`);
  };
  const part = (p) => {
    if (typeof p === "string") return text(p);
    const c = cells.get(p[1]);
    if (p[0] === "count") return `\${${p[1]}.length}`;
    if (p[0] === "at") return showNum(c.format, `${p[1]}[${cats.indexOf(p[2])}]`);
    if (c.type === "num") return showNum(c.format, p[1]);
    if (c.type === "bool") return `\${${p[1]} ? ${str(c.words[0])} : ${str(c.words[1])}}`;
    return `\${${p[1]}}`;
  };

  // ---- State and formulas
  const lets = inputs.map((c) => `<let/${c.name}=${literal(c.initial)}>`);
  const consts = spec.units.map((u) => `<const/${u.cell.name}=${js(u.cell.expr, cats)}>`);

  // ---- The sheet
  const sheet = [];
  const p = (n, s) => sheet.push("  ".repeat(n - 1) + s);
  for (const u of spec.units) {
    p(3, "<div>");
    for (const n of u.view) {
      switch (n.el) {
        case "text": p(4, `<${n.tag}>${n.parts.map(part).join("")}</${n.tag}>`); break;
        case "input": {
          const m = msgs.get(n.msg);
          const c = cells.get(m.cell);
          p(4, `<label>${text(n.label)}<int-field msg=${str(n.msg)} min=${c.min} max=${c.max} value:=${c.name}/></label>`);
          break;
        }
        case "button": {
          const m = msgs.get(n.msg);
          const c = cells.get(m.cell);
          const next = m.k > 0 ? `Math.min(${c.max}, ${c.name} + ${m.k})` : `Math.max(${c.min}, ${c.name} - ${-m.k})`;
          p(4, `<button data-role=${str(n.msg)} onClick() { ${c.name} = ${next} }>${text(n.text)}</button>`);
          break;
        }
        case "check": {
          const c = cells.get(msgs.get(n.msg).cell);
          p(4, `<label><input type="checkbox" data-role=${str(n.msg)} checked:=${c.name}/>${text(n.label)}</label>`);
          break;
        }
        case "select": {
          const c = cells.get(msgs.get(n.msg).cell);
          p(4, "<label>");
          p(5, text(n.label));
          p(5, `<select data-role=${str(n.msg)} value:=${c.name}>`);
          for (const o of c.options) p(6, `<option value=${str(o)}>${text(o)}</option>`);
          p(5, "</select>");
          p(4, "</label>");
          break;
        }
        case "top": {
          const c = cells.get(n.cell);
          const key = showNum(c.format, js(c.expr[2], cats));
          p(4, `<${n.tag} data-role=${str(n.cell)}>`);
          p(5, `<for|it| of=${n.cell} by="id">`);
          p(6, `<li data-key=it.id data-role=${str(n.cell + "Item")}>\${it.name}: ${key}</li>`);
          p(5, "</for>");
          p(4, `</${n.tag}>`);
          break;
        }
        case "groups": {
          const c = cells.get(n.cell);
          p(4, `<ul data-role=${str(n.cell)}>`);
          p(5, "<for|cat, i| of=CATS>");
          p(6, `<li data-key=cat data-role=${str(n.cell + "Row")}>\${cat}: ${showNum(c.format, `${n.cell}[i]`)}</li>`);
          p(5, "</for>");
          p(4, "</ul>");
          break;
        }
        default: throw new Error(`unknown view node ${n.el}`);
      }
    }
    p(3, "</div>");
  }

  // ---- External events
  const setInput = inputs.map((c) => `      case ${str(c.name)}:\n        ${c.name} = value;\n        break;`);

  // ---- The static part
  const body = consts.join("\n") + sheet.join("\n");
  const used = Object.keys(HELPERS).filter((h) => new RegExp(`\\b${h}\\(`).test(body));
  if (used.includes("avgBy") && !used.includes("sumBy")) used.unshift("sumBy");
  if (used.includes("sumByCategory") && !used.includes("sumBy")) used.unshift("sumBy");
  const helpers = Object.keys(HELPERS).filter((h) => used.includes(h)).map((h) => HELPERS[h]);

  const statics = `static const CATS = ${literal(cats)};
static const ADJECTIVES = ${literal(spec.itemWords.adjectives)};
static const NOUNS = ${literal(spec.itemWords.nouns)};

// The item builder: the app's own generator (Park-Miller). Each item draws, in order, an adjective,
// a noun, a category, a quantity, a price in cents and whether it is active.
static function buildItems(count, rng, nextId) {
  const draw = () => (rng = (rng * 48271) % 2147483647);
  const items = [];
  for (let n = 0; n < count; n++) {
    const name = \`\${ADJECTIVES[draw() % ADJECTIVES.length]} \${NOUNS[draw() % NOUNS.length]}\`;
    const category = CATS[draw() % CATS.length];
    const qty = 1 + (draw() % 99);
    const price = 100 + (draw() % 9900);
    const active = draw() % 4 !== 0;
    items.push({ id: nextId++, name, category, qty, price, active, note: "" });
  }
  return { items, rng, nextId };
}

static const initial = buildItems(${spec.initialItems}, ${spec.rng}, 1);

// Numbers as text: no locale APIs.
static function formatGrouped(n) {
  return (n < 0 ? "-" : "") + String(Math.abs(n)).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
}

static function formatMoney(cents) {
  const abs = Math.abs(cents);
  return \`\${cents < 0 ? "-" : ""}${cur}\${formatGrouped(Math.floor(abs / 100))}.\${String(abs % 100).padStart(2, "0")}\`;
}

${helpers.join("\n\n")}`;

  const rowEdit = (patch) => `items = items.map((other) => (other.id === item.id ? { ...other, ${patch} } : other))`;

  return `${statics}

${lets.join("\n")}
<let/markup=${spec.markup.initial}>
<let/items=initial.items>
<let/nextId=initial.nextId>
<let/rng=initial.rng>

// The formulas.
${consts.join("\n")}

<div data-role="page">
  <section data-key="sheet" data-role="sheet">
    <h2>${text(spec.title)}</h2>
${sheet.join("\n")}
  </section>
  <section data-key="items" data-role="items">
    <h2>${text(spec.itemsTitle)}</h2>
    <div>
      <button data-role="load" onClick() {
        const built = buildItems(${spec.options.rows}, rng, nextId);
        items = built.items;
        rng = built.rng;
        nextId = built.nextId;
      }>${text(spec.loadText)}</button>
      <button data-role="addItem" onClick() {
        const built = buildItems(1, rng, nextId);
        items = items.concat(built.items);
        rng = built.rng;
        nextId = built.nextId;
      }>Add item</button>
      <label>Markup %<int-field msg="markup" min=0 max=100 value:=markup/></label>
    </div>
    <table>
      <thead>
        <tr><th>Item</th><th>Category</th><th>Qty</th><th>Price</th><th>Line</th><th>With markup</th><th>Active</th><th>Note</th><th></th></tr>
      </thead>
      <tbody>
        <for|item| of=items by="id">
          <tr data-key=item.id data-role="item">
            <td>\${item.name}</td>
            <td>\${item.category}</td>
            <td><int-field msg="qty" min=0 max=999 value=item.qty valueChange(qty) { ${rowEdit("qty")} }/></td>
            <td>\${formatMoney(item.price)}</td>
            <td>\${formatMoney(item.qty * item.price)}</td>
            <td>\${formatMoney(Math.floor((item.qty * item.price * (100 + markup)) / 100))}</td>
            <td><input type="checkbox" data-role="active" checked=item.active checkedChange(active) { ${rowEdit("active")} }/></td>
            <td><input type="text" data-role="note" placeholder="Note" value=item.note valueChange(note) { ${rowEdit("note")} }/></td>
            <td><button data-role="remove" onClick() { items = items.filter((other) => other.id !== item.id) }>×</button></td>
          </tr>
        </for>
      </tbody>
    </table>
  </section>
</div>

// External events: the root's tag variable, which the adapter calls with each message.
<return=(msg) => {
  function setInput(name, value) {
    switch (name) {
${setInput.join("\n")}
    }
  }
  switch (msg.type) {
    case "serverInputs":
      for (const name in msg.values) setInput(name, msg.values[name]);
      break;
    case "serverItems": {
      const gone = new Set(msg.remove);
      const changed = new Map(msg.upsert.map((it) => [it.id, { ...it }]));
      const known = new Set(items.map((it) => it.id));
      items = items
        .filter((it) => !gone.has(it.id))
        .map((it) => changed.get(it.id) ?? it)
        .concat(msg.upsert.filter((it) => !known.has(it.id) && !gone.has(it.id)).map((it) => ({ ...it })));
      nextId = Math.max(nextId, ...msg.upsert.map((it) => it.id + 1));
      break;
    }
    case "snapshot": {
      const state = msg.state;
      for (const name in state.inputs) setInput(name, state.inputs[name]);
      markup = state.markup;
      items = state.items.map((it) => ({ ...it }));
      nextId = state.nextId;
      rng = state.rng;
      break;
    }
  }
}>
`;
}

export function emit(spec) {
  return {
    files: {
      ...templateFiles({ name: "derived-graph", title: "Derived graph" }),
      "src/tags/int-field.marko": INT_FIELD,
      "src/app.marko": appFile(spec),
    },
    style: {
      components: "one root template (src/app.marko) holds the sheet and the items table; the number input is the int-field tag",
      state: "<let> per input, and for the markup, the items, nextId and rng",
      derivedValues: "<const> per formula, in unit order: Marko's compiler computes each once per change, shares it between its readers and stops where a value is unchanged (===); no memo is written by hand",
      collections: "static helper functions that take the formula's own code as an arrow function (sumBy, avgBy, maxBy, minBy, topBy, sumByCategory); filters are Array.filter in the formula",
      displays: "plain ${…} interpolation of the cells in the markup; formats are static functions",
      lists: "<for … by=\"id\"> for the items and the top-k lists, <for> over the static category list for group rows",
      itemEdits: "immutable: items.map matching the row by id (a missing id is a no-op); no incremental aggregates",
      inputs: "int-field (controllable <let> plus <let/pending> for an edit that is not a valid integer in range); checked:= for checkboxes, <select value:=> for selects; step buttons clamp in onClick",
      externalEvents: "app.marko <return>s a function that assigns the <let>s; serverInputs and snapshot go through one setInput switch; dispatched items are copied, never adopted",
      build: "Vite + @marko/vite (linked: false), production mode, client-only mount, hidden source maps",
    },
  };
}
