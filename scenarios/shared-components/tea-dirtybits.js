// The dashboard as tea-dirtybits, a prototype strategy (see frameworks/tea-dirtybits/README.md).
//
// This emitter plays the compiler: it writes what an ideal TEA compiler would emit.
// Style (recorded in every generated app's rr.json):
// - One module per widget kind (src/widgets/<kind>.js), configured per widget by its row
//   (kind, initial state, label, the kind's parameters by position): its reducer
//   `(row, s, msg) => s`, whose arms mark dirty bits for the fields they write, and its DOM
//   factory `(parent, row, id) => patch` (exported as the pair `kind`), which builds the DOM once from a static template and
//   returns a static `patch(s, dirty)` that runs only the bindings whose bits are set.
// - One app module (src/app.js): the widget rows (the initial model comes from them), the app reducer
//   (routes user messages and external events to the widgets' reducers and files their bits
//   per widget), and the top-level view, whose patch calls each dirty widget's patch and
//   recomputes a summary only when a bit it reads is set.
// - Events build a message and send it; patches are batched into one microtask.
// - Keyed lists patch changed rows, remove gone ones and move misplaced nodes in one walk.

import { templateFiles } from "../../frameworks/tea-dirtybits/framework.js";
import { literal, tplText, camelCase } from "../../frameworks/shared/jsx.js";

export const framework = "tea-dirtybits";

export const params = {};

// The config fields each kind takes, beyond id and label.
const PARAMS = {
  counter: ["step", "min", "max", "start"],
  toggles: ["items"],
  field: ["placeholder", "valid", "message"],
  todo: ["placeholder", "addText", "removeText"],
  tabs: ["tabs"],
  panel: ["showText", "hideText", "body"],
  choice: ["options", "extraFor", "extraPlaceholder"],
  amount: ["format"],
  filter: ["items", "placeholder"],
  rating: ["stars", "labels"],
  feed: ["emptyText", "dismissText"],
  clock: ["startText", "stopText", "resetText"],
  summary: [],
};

// Config fields that are functions or derived from the widget's rules: their source.
const DERIVED = {
  valid(w) {
    if (w.rule.type === "required") return `(text) => text.trim() !== ""`;
    if (w.rule.type === "minLength") return `(text) => text.length >= ${w.rule.min}`;
    return `(text) => /${w.rule.pattern}/.test(text)`;
  },
  message(w) {
    return JSON.stringify(w.rule.message);
  },
  format(w) {
    const f = w.format;
    const fixed = `value.toFixed(${f.decimals})`;
    if (f.type === "currency") return `(value) => ${JSON.stringify(f.symbol)} + ${fixed}`;
    if (f.type === "percent") return `(value) => ${fixed} + "%"`;
    return `(value) => ${fixed} + ${JSON.stringify(" " + f.unit)}`;
  },
};

// The dirty bit a summary reads from each kind it can summarize (value, on, items, stars,
// seconds, query, entries: each the first field of its kind).
const METRIC_BIT = {
  counter: 1, amount: 1, toggles: 1, todo: 1, rating: 1, clock: 1, filter: 1, feed: 1,
};

// ---------------------------------------------------------------------------------------------
// The widget kinds: one module each, shared by every instance of the kind. Each module lists its
// dirty bits and message tags (numbers, as Elm --optimize tags constructors; external events
// keep their names) and exports `kind`, the pair [reducer, DOM factory].

const WIDGET_FILE = `import { html } from "../runtime.js";

// A widget's <section> with its heading and the kind's static markup \`inner\`: every element, in
// document order.
export function section(parent, id, label, kind, inner) {
  const t = html(\`<section data-role=widget-\${kind}><h2></h2>\${inner}</section>\`, parent);
  t[0].dataset.key = id;
  t[1].textContent = label;
  return t;
}
`;

const KINDS = {
  counter: `import { mark, setText, prop, onClick } from "../runtime.js";
import { section } from "./widget.js";

// Dirty bits: value 1. Message tags: inc 0, dec 1, reset 2.

// The kind: its reducer and its DOM factory.
export const kind = [
  ([, , , step, min, max, start], s, msg) => {
    switch (msg.type) {
      case 0:
        mark(1);
        return { value: Math.min(max, s.value + step) };
      case 1:
        mark(1);
        return { value: Math.max(min, s.value - step) };
      case 2:
        mark(1);
        return { value: start };
    }
    return s;
  },
  (parent, [, , label, step, min, max], id) => {
    const [, , value, dec, inc, reset] = section(parent, id, label, "counter",
      "<output data-role=value></output><button data-role=dec></button><button data-role=inc></button><button data-role=reset>Reset");
    dec.textContent = "-" + step;
    inc.textContent = "+" + step;
    onClick(dec, id, 1);
    onClick(inc, id, 0);
    onClick(reset, id, 2);
    return (s, d) => {
      if (d & 1) {
        setText(value, s.value);
        prop(dec, "disabled", s.value <= min);
        prop(inc, "disabled", s.value >= max);
      }
    };
  },
];
`,

  toggles: `import { mark, html, setText, prop, onCheck } from "../runtime.js";
import { section } from "./widget.js";

// Dirty bits: on 1. Message tags: toggle 0 (id: the toggle's index).

// The kind: its reducer and its DOM factory.
export const kind = [
  (c, s, msg) => {
    switch (msg.type) {
      case 0:
        mark(1);
        return { on: s.on.map((on, i) => (i === msg.id ? !on : on)) };
    }
    return s;
  },
  (parent, [, , label, items], id) => {
    const t = section(parent, id, label, "toggles", "<ul></ul><p data-role=count>");
    const boxes = items.map((name, i) => {
      const [, , box] = html("<li><label><input type=checkbox data-role=toggle>", t[2]);
      box.dataset.key = i;
      box.after(name);
      onCheck(box, id, 0, i);
      return box;
    });
    return (s, d) => {
      if (d & 1) {
        boxes.forEach((box, i) => prop(box, "checked", s.on[i]));
        setText(t[3], s.on.filter(Boolean).length + " of " + items.length + " on");
      }
    };
  },
];
`,

  field: `import { mark, prop, onInput, branch } from "../runtime.js";
import { section } from "./widget.js";

// Dirty bits: text 1. Message tags: edit 0.

// The kind: its reducer and its DOM factory.
export const kind = [
  (c, s, msg) => {
    switch (msg.type) {
      case 0:
        mark(1);
        return { text: msg.value };
    }
    return s;
  },
  (parent, [, , label, placeholder, valid, message], id) => {
    const [, , input, p] = section(parent, id, label, "field", "<input type=text data-role=input><p data-role=error>");
    input.placeholder = placeholder;
    p.textContent = message;
    onInput(input, id, 0);
    const error = branch(p);
    return (s, d) => {
      if (d & 1) {
        prop(input, "value", s.text);
        error(!valid(s.text));
      }
    };
  },
];
`,

  todo: `import { mark, html, setText, prop, onClick, onCheck, onInput, list } from "../runtime.js";
import { section } from "./widget.js";

// Dirty bits: items 1, draft 2. Message tags: editDraft 0, add 1, toggle 2, remove 3.

// The kind: its reducer and its DOM factory.
export const kind = [
  (c, s, msg) => {
    switch (msg.type) {
      case 0:
        mark(2);
        return { ...s, draft: msg.value };
      case 1: {
        const text = s.draft.trim();
        if (text === "") return s;
        mark(3);
        const id = s.items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
        return { items: [...s.items, { id, text, done: false }], draft: "" };
      }
      case 2:
        mark(1);
        return { ...s, items: s.items.map((item) => (item.id === msg.id ? { ...item, done: !item.done } : item)) };
      case 3:
        mark(1);
        return { ...s, items: s.items.filter((item) => item.id !== msg.id) };
    }
    return s;
  },
  (parent, [, , label, placeholder, addText, removeText], id) => {
    const [, , draft, add, ul, left] = section(parent, id, label, "todo",
      "<input type=text data-role=draft><button data-role=add></button><ul></ul><p data-role=left>");
    draft.placeholder = placeholder;
    add.textContent = addText;
    onInput(draft, id, 0);
    onClick(add, id, 1);
    const items = list(ul, (item) => {
      const [li, box, label, remove] = html("<li><input type=checkbox data-role=toggle><span></span><button data-role=remove>");
      li.dataset.key = item.id;
      remove.textContent = removeText;
      onCheck(box, id, 2, item.id);
      onClick(remove, id, 3, item.id);
      return [li, (item) => {
        prop(box, "checked", item.done);
        setText(label, item.text);
      }];
    });
    return (s, d) => {
      if (d & 2) prop(draft, "value", s.draft);
      if (d & 1) {
        items(s.items);
        setText(left, s.items.filter((item) => !item.done).length + " left");
      }
    };
  },
];
`,

  tabs: `import { mark, html, setText, prop, onClick } from "../runtime.js";
import { section } from "./widget.js";

// Dirty bits: active 1. Message tags: select 0 (id: the tab's index).

// The kind: its reducer and its DOM factory.
export const kind = [
  (c, s, msg) => {
    switch (msg.type) {
      case 0:
        mark(1);
        return { active: msg.id };
    }
    return s;
  },
  (parent, [, , label, tabs], id) => {
    const t = section(parent, id, label, "tabs", "<div role=tablist></div><p data-role=tab-content role=tabpanel>");
    const buttons = tabs.map((tab, i) => {
      const [button] = html("<button data-role=tab role=tab>", t[2]);
      button.dataset.key = i;
      button.textContent = tab.title;
      onClick(button, id, 0, i);
      return button;
    });
    return (s, d) => {
      if (d & 1) {
        buttons.forEach((tab, i) => prop(tab, "ariaSelected", String(i === s.active)));
        setText(t[3], tabs[s.active].content);
      }
    };
  },
];
`,

  panel: `import { mark, setText, prop, onClick, branch } from "../runtime.js";
import { section } from "./widget.js";

// Dirty bits: open 1. Message tags: toggle 0.

// The kind: its reducer and its DOM factory.
export const kind = [
  (c, s, msg) => {
    switch (msg.type) {
      case 0:
        mark(1);
        return { open: !s.open };
    }
    return s;
  },
  (parent, [, , label, showText, hideText, body], id) => {
    const [, , toggle, p] = section(parent, id, label, "panel", "<button data-role=toggle></button><p data-role=body>");
    p.textContent = body;
    onClick(toggle, id, 0);
    const shown = branch(p);
    return (s, d) => {
      if (d & 1) {
        prop(toggle, "ariaExpanded", String(s.open));
        setText(toggle, s.open ? hideText : showText);
        shown(s.open);
      }
    };
  },
];
`,

  choice: `import { mark, html, prop, onInput, branch } from "../runtime.js";
import { section } from "./widget.js";

// Dirty bits: option 1, extra 2. Message tags: choose 0, editExtra 1.

// The kind: its reducer and its DOM factory.
export const kind = [
  (c, s, msg) => {
    switch (msg.type) {
      case 0:
        mark(1);
        return { ...s, option: msg.value };
      case 1:
        mark(2);
        return { ...s, extra: msg.value };
    }
    return s;
  },
  (parent, [, , label, options, extraFor, extraPlaceholder], id) => {
    const [, , select, input] = section(parent, id, label, "choice", "<select data-role=select></select><input type=text data-role=extra>");
    for (const option of options) {
      const [o] = html("<option>", select);
      o.value = option.value;
      o.textContent = option.label;
    }
    input.placeholder = extraPlaceholder;
    onInput(select, id, 0);
    onInput(input, id, 1);
    const extra = branch(input);
    return (s, d) => {
      if (d & 1) prop(select, "value", s.option);
      if (d & 3) {
        const show = extraFor.includes(s.option);
        extra(show);
        if (show) prop(input, "value", s.extra);
      }
    };
  },
];
`,

  amount: `import { mark, send, setText, prop } from "../runtime.js";
import { section } from "./widget.js";

// Dirty bits: value 1. Message tags: set 0.

// The kind: its reducer and its DOM factory.
export const kind = [
  (c, s, msg) => {
    switch (msg.type) {
      case 0:
        mark(1);
        return { value: msg.value };
    }
    return s;
  },
  (parent, [, , label, format], id) => {
    const [, , input, formatted] = section(parent, id, label, "amount", "<input type=number data-role=input><output data-role=formatted>");
    // Only a valid number becomes a message; anything else stays in the input as typed.
    input.addEventListener("input", () => {
      const value = input.valueAsNumber;
      if (!Number.isNaN(value)) send({ widget: id, type: 0, value });
    });
    return (s, d) => {
      if (d & 1) {
        prop(input, "value", String(s.value));
        setText(formatted, format(s.value));
      }
    };
  },
];
`,

  filter: `import { mark, html, setText, prop, onInput, list } from "../runtime.js";
import { section } from "./widget.js";

// Dirty bits: query 1. Message tags: edit 0.


export function matches(items, query) {
  const q = query.toLowerCase();
  return items.filter((item) => item.text.toLowerCase().includes(q));
}

// The kind: its reducer and its DOM factory.
export const kind = [
  (c, s, msg) => {
    switch (msg.type) {
      case 0:
        mark(1);
        return { query: msg.value };
    }
    return s;
  },
  (parent, [, , label, items, placeholder], id) => {
    const [, , input, ul, count] = section(parent, id, label, "filter", "<input type=text data-role=query><ul></ul><p data-role=matches>");
    input.placeholder = placeholder;
    onInput(input, id, 0);
    const rows = list(ul, (item) => {
      const [li] = html("<li>");
      li.dataset.key = item.id;
      return [li, (item) => setText(li, item.text)];
    });
    return (s, d) => {
      if (d & 1) {
        prop(input, "value", s.query);
        const shown = matches(items, s.query);
        rows(shown);
        setText(count, shown.length + " matches");
      }
    };
  },
];
`,

  rating: `import { mark, html, setText, prop, onClick } from "../runtime.js";
import { section } from "./widget.js";

// Dirty bits: stars 1. Message tags: rate 0 (id: the star's number).

// The kind: its reducer and its DOM factory.
export const kind = [
  (c, s, msg) => {
    switch (msg.type) {
      case 0:
        mark(1);
        return { stars: msg.id };
    }
    return s;
  },
  (parent, [, , label, stars, labels], id) => {
    const t = section(parent, id, label, "rating", "<div></div><p data-role=rating-label>");
    const buttons = [];
    for (let n = 1; n <= stars; n++) {
      const [button] = html("<button data-role=star>", t[2]);
      button.dataset.key = n;
      onClick(button, id, 0, n);
      buttons.push(button);
    }
    return (s, d) => {
      if (d & 1) {
        buttons.forEach((button, i) => {
          prop(button, "ariaPressed", String(i < s.stars));
          setText(button, i < s.stars ? "★" : "☆");
        });
        setText(t[3], labels[s.stars]);
      }
    };
  },
];
`,

  feed: `import { mark, html, setText, onClick, branch, list } from "../runtime.js";
import { section } from "./widget.js";

// Dirty bits: entries 1. Message tags: dismiss 0; \`notify\` is an external event.

// The kind: its reducer and its DOM factory.
export const kind = [
  (c, s, msg) => {
    switch (msg.type) {
      case 0:
        mark(1);
        return { entries: s.entries.filter((entry) => entry.id !== msg.id) };
      case "notify":
        mark(1);
        return { entries: [...s.entries, msg.entry] };
    }
    return s;
  },
  (parent, [, , label, emptyText, dismissText], id) => {
    const [, , ul, p] = section(parent, id, label, "feed", "<ul></ul><p data-role=empty>");
    p.textContent = emptyText;
    const entries = list(ul, (entry) => {
      const [li, label, dismiss] = html("<li><span></span><button data-role=dismiss>");
      li.dataset.key = entry.id;
      dismiss.textContent = dismissText;
      onClick(dismiss, id, 0, entry.id);
      return [li, (entry) => setText(label, entry.text)];
    });
    const empty = branch(p);
    return (s, d) => {
      if (d & 1) {
        entries(s.entries);
        empty(s.entries.length === 0);
      }
    };
  },
];
`,

  clock: `import { mark, setText, prop, onClick } from "../runtime.js";
import { section } from "./widget.js";

// Dirty bits: seconds 1, running 2. Message tags: start 0, stop 1, reset 2; \`tick\` is an
// external event.


function formatTime(seconds) {
  const s = seconds % 60;
  return Math.floor(seconds / 60) + ":" + (s < 10 ? "0" : "") + s;
}

// The kind: its reducer and its DOM factory.
export const kind = [
  (c, s, msg) => {
    switch (msg.type) {
      case 0:
        mark(2);
        return { ...s, running: true };
      case 1:
        mark(2);
        return { ...s, running: false };
      case 2:
        mark(3);
        return { seconds: 0, running: false };
      case "tick":
        if (!s.running) return s;
        mark(1);
        return { ...s, seconds: s.seconds + 1 };
    }
    return s;
  },
  (parent, [, , label, startText, stopText, resetText], id) => {
    const [, , time, start, stop, reset] = section(parent, id, label, "clock",
      "<output data-role=time></output><button data-role=start></button><button data-role=stop></button><button data-role=reset>");
    start.textContent = startText;
    stop.textContent = stopText;
    reset.textContent = resetText;
    onClick(start, id, 0);
    onClick(stop, id, 1);
    onClick(reset, id, 2);
    return (s, d) => {
      if (d & 1) setText(time, formatTime(s.seconds));
      if (d & 2) {
        prop(start, "disabled", s.running);
        prop(stop, "disabled", !s.running);
      }
    };
  },
];
`,

  summary: `import { setText } from "../runtime.js";
import { section } from "./widget.js";

// The kind: no reducer, and its DOM factory. A summary has no state of its own:
// \`text(widgets)\` derives its line from other widgets, and the app's patch calls it
// again only when a field it reads is dirty.
export const kind = [
  0,
  (parent, [, , label, text], id) => {
    const [, , line] = section(parent, id, label, "summary", "<p data-role=summary>");
    return (widgets) => setText(line, text(widgets));
  },
];

// Round to at most two decimals for display.
export function num(n) {
  return String(Math.round(n * 100) / 100);
}
`,
};

// ---------------------------------------------------------------------------------------------
// Summaries: per instance, the text function and the dirty bits that trigger it.

function metricExpr(src, slice, configName) {
  switch (src.kind) {
    case "counter": case "amount": return `${slice}.value`;
    case "toggles": return `${slice}.on.filter(Boolean).length`;
    case "todo": return `${slice}.items.filter((item) => !item.done).length`;
    case "rating": return `${slice}.stars`;
    case "clock": return `${slice}.seconds`;
    case "filter": return `filter.matches(${configName}, ${slice}.query).length`;
    case "feed": return `${slice}.entries.length`;
  }
  throw new Error(`a summary cannot read ${src.kind}`);
}

const PHRASES = {
  counter: (v, w) => `${tplText(w.label)}: ${v}`,
  amount: (v, w) => `${tplText(w.label)}: ${v}`,
  toggles: (v, w) => `${v} on in ${tplText(w.label)}`,
  todo: (v, w) => `${v} left in ${tplText(w.label)}`,
  rating: (v, w) => `${v} stars for ${tplText(w.label)}`,
  clock: (v, w) => `${v}s on ${tplText(w.label)}`,
  filter: (v, w) => `${v} found in ${tplText(w.label)}`,
  feed: (v, w) => `${v} in ${tplText(w.label)}`,
};

// The name of a filter's items, when a summary reads that filter.
const configName = (w) => w.id.toUpperCase() + "_ITEMS";

// The source of a summary's `text(widgets)` function.
function summaryText(spec, w, indent) {
  const sources = w.sources.map((id) => spec.widgets.find((x) => x.id === id));
  // A breakdown shows each term twice (alone and in the total), so it names them; otherwise
  // each term is read once, in place.
  const named = w.formula === "breakdown";
  const names = [];
  const lines = [];
  for (const src of sources) {
    const expr = metricExpr(src, `widgets.${src.id}`, configName(src));
    if (!named) {
      names.push(expr);
      continue;
    }
    let name = camelCase(src.label);
    while (names.includes(name)) name += "2";
    names.push(name);
    lines.push(`const ${name} = ${expr};`);
  }
  // Only amounts can hold fractions; their terms (and any total including them) are rounded.
  const decimal = sources.map((src) => src.kind === "amount");
  const show = (i) => (decimal[i] ? `\${summary.num(${names[i]})}` : `\${${names[i]}}`);
  const total = decimal.some(Boolean) ? `summary.num(${names.join(" + ")})` : names.join(" + ");
  let text;
  if (w.formula === "sum") text = `${tplText(w.prefix)}: \${${total}}`;
  else if (w.formula === "breakdown") text = `${tplText(w.prefix)}: ${names.map((_, i) => show(i)).join(" + ")} = \${${total}}`;
  else text = sources.map((src, i) => PHRASES[src.kind](show(i), src)).join("; ");
  if (!named) return `(widgets) => \`${text}\``;
  const body = [...lines, `return \`${text}\`;`].map((l) => indent + "  " + l).join("\n");
  return `(widgets) => {\n${body}\n${indent}}`;
}

// The condition under which a summary's line can change: a bit it reads is dirty.
function summaryTrigger(spec, w) {
  return w.sources.map((id) => {
    const src = spec.widgets.find((x) => x.id === id);
    return `dirty.${id} & ${METRIC_BIT[src.kind]}`;
  }).join(" || ");
}

// ---------------------------------------------------------------------------------------------
// The app module

// A widget's row, written at `indent`: its kind, its initial state (0 for a summary, which has
// none), its label and its kind's parameters in order (PARAMS), which the kind's functions
// destructure by position.
function rowLiteral(spec, w, indent, named) {
  const inner = indent + "  ";
  const slice = spec.initialState.widgets[w.id];
  const fields = [`${w.kind}.kind`, slice === undefined ? "0" : literal(slice, inner), JSON.stringify(w.label)];
  for (const name of PARAMS[w.kind]) {
    if (name === "items" && named.has(w.id)) fields.push(configName(w));
    else fields.push(DERIVED[name] ? DERIVED[name](w) : literal(w[name], inner));
  }
  if (w.kind === "summary") fields.push(summaryText(spec, w, inner));
  const flat = `[${fields.join(", ")}]`;
  if (flat.length + indent.length <= 90 && !flat.includes("\n")) return flat;
  return `[\n${fields.map((f) => inner + f + ",").join("\n")}\n${indent}]`;
}

function appFile(spec) {
  const kinds = [...new Set(spec.widgets.map((w) => w.kind))].sort();
  const plain = spec.widgets.filter((w) => w.kind !== "summary");
  const summaries = spec.widgets.filter((w) => w.kind === "summary");
  const clocks = plain.filter((w) => w.kind === "clock");

  const imports = [
    `import { take, touch, html } from "./runtime.js";`,
    ...kinds.map((k) => `import * as ${k} from "./widgets/${k}.js";`),
  ];
  // The items of a filter a summary reads are named, so the summary can call `filter.matches`
  // with them.
  const named = new Set(summaries.flatMap((w) => w.sources)
    .filter((id) => spec.widgets.find((x) => x.id === id).kind === "filter"));
  const configs = spec.widgets.filter((w) => named.has(w.id))
    .map((w) => `const ${configName(w)} = ${literal(w.items)};\n`);
  if (Object.keys(spec.initialState).join() !== "widgets") throw new Error("the model is expected to be { widgets }");
  const table = spec.widgets.map((w) => `  ${w.id}: ${rowLiteral(spec, w, "  ", named)},`);
  const tick = clocks.length
    ? `    case "tick":
      for (const id of ${literal(clocks.map((w) => w.id))}) model = route(model, id, msg);
      return model;`
    : `    case "tick":
      return model;`;
  const triggers = summaries.map((w) => `    if (${summaryTrigger(spec, w)}) patches.${w.id}(w);`);

  return `${imports.join("\n")}

${configs.length ? configs.join("\n") + "\n" : ""}// Every widget in page order, one row each (see the kinds' modules for what their parameters
// are): the only per-widget code.
const WIDGETS = {
${table.join("\n")}
};

// The initial model: one slice per widget with state.
export function init() {
  const widgets = {};
  for (const id in WIDGETS) if (WIDGETS[id][1]) widgets[id] = WIDGETS[id][1];
  return { widgets };
}

// All bits: a widget whose whole state was replaced.
const ALL = -1;

function set(model, id, s, bits) {
  touch(id, bits);
  return { ...model, widgets: { ...model.widgets, [id]: s } };
}

// Run one widget's reducer and file the bits its arm marked under that widget.
function route(model, id, msg) {
  const row = WIDGETS[id];
  const s = model.widgets[id];
  const next = row[0][0](row, s, msg);
  // An arm that returns the slice unchanged marks nothing, so only a new slice takes the bits.
  return next === s ? model : set(model, id, next, take());
}

// The app reducer: user messages and most external events go to one widget's reducer.
export function update(model, msg) {
  switch (msg.type) {
    case "serverSet":
      return set(model, msg.widget, msg.state, ALL);
    case "snapshot":
      for (const id in msg.state.widgets) touch(id, ALL);
      return msg.state;
${tick}
  }
  return route(model, msg.widget, msg);
}

// Builds every widget once. The returned patch runs each dirty widget's patch, then the
// summaries whose sources have a dirty bit they read.
export function view(root, model) {
  const dash = html("<div data-role=dashboard>", root)[0];
  const w = model.widgets;
  const patches = {};
  // A summary's state is the whole model: it derives its line from other widgets.
  for (const id in WIDGETS) {
    const row = WIDGETS[id];
    (patches[id] = row[0][1](dash, row, id))(row[1] ? w[id] : w, -1);
  }
  return (model, dirty) => {
    const w = model.widgets;
    for (const id in dirty) patches[id](w[id], dirty[id]);
${triggers.join("\n")}
  };
}
`;
}

export function emit(spec) {
  const files = {
    ...templateFiles({ name: "dashboard", title: "Dashboard" }),
    "src/app.js": appFile(spec),
    "src/widgets/widget.js": WIDGET_FILE,
  };
  const kinds = [...new Set(spec.widgets.map((w) => w.kind))];
  for (const kind of kinds) files[`src/widgets/${kind}.js`] = KINDS[kind];
  return {
    files,
    style: {
      components: "one module per widget kind (reducer + DOM factory), configured per widget by a plain object",
      state: "one immutable TEA model; the app reducer routes messages to the widgets' reducers",
      updates: "reducer arms mark compile-time dirty bits; a static patch per kind runs only the bindings whose bits are set, batched in a microtask",
      externalEvents: "through the same reducer (send); serverSet and snapshot mark every bit of the widgets they replace",
      lists: "keyed by id: changed rows patched, gone rows removed, misplaced nodes moved in one walk",
      conditionals: "built once with the template, swapped for an empty comment while hidden",
      derived: "summaries recomputed when a dirty bit they read is set (static dependencies)",
      events: "addEventListener on each element, sending a message (numeric tags) built when wired, or carrying the control's value",
      build: "Vite with no framework plugin, production defaults, hidden source maps",
    },
  };
}
