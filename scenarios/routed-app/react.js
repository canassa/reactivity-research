// The routed-app scenario in React 19.
//
// Style (recorded in every generated app's rr.json):
// - Routing is in-app state (README, "Routing"): a `route` state in `App`, and the page component
//   looked up in a table by route and rendered as `<Page />`, the way a router resolves a
//   component for a route. No router library (React Router's memory router would bring its own
//   runtime; the Solid emitter uses none either).
// - One component per page (`src/pages/PN.jsx`), written from the page's description alone: its
//   handlers, bindings and derived expressions are that page's own code, nothing is interpreted
//   at runtime. A tab panel (`PNT1`) and a modal (`PNModal`) are components of their own, in the
//   page's file. The "All pages" menu and the nav bar map over a table of (id, title), which is
//   genuine data.
// - Page-local state is one `useState` object per page, tab panel and modal component (its
//   fields), so it starts fresh whenever the component mounts and is gone when it unmounts. A tab
//   panel reads its page's state through a prop; the modal's confirm writes it through the
//   page's setter, passed as a prop. Each message's writes are updater functions, one per state
//   it writes, so two events before a render both apply.
// - The route, the menu and the global state are one `useState` object in `App`, shared through a
//   context with the external events source. Pages reach it through `usePage(id)`, whose global
//   setter and navigation are updaters that check the route: a handler of a page just navigated
//   away from (two events in one task, before the render) changes nothing.
// - Tabs, the modal, the menu, conditional sections and validation errors render with `&&`. The
//   modal gets a `key` counted per open, so opening it again (even right after closing it)
//   mounts it afresh. A modal notes in a ref that it closed, so a second confirm or close (or a
//   write outside it) in the same task, before the render that removes it, does nothing.
// - Time-driven fields: `setInterval` in an effect of the component that owns the field, cleared
//   by the effect's cleanup. A page with a feed list subscribes to the external events in an
//   effect and takes the `pagePush` events for itself, so a push reaches only the page shown.
// - Lists with `.map` and `key={item.id}`, derived values as plain expressions in the JSX, no
//   manual memoization. Controlled inputs with `onChange`; a number input sends its message only
//   for an integer in range and keeps a draft of any other text, dropped by every write of its
//   field in the component.

import { templateFiles, params as frameworkParams } from "../../frameworks/react/framework.js";
import { literal, jsxAttr } from "../../frameworks/shared/jsx.js";
import { GLOBAL } from "./spec.js";

export const framework = "react";

export const params = { ...frameworkParams };

const str = JSON.stringify;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const COMPARE = { "==": "===", "!=": "!==", "<": "<", "<=": "<=", ">": ">", ">=": ">=" };

// The three states a component sees, by ref kind: its own, its page's (the page itself sees its
// own), and the global one. Each has a variable and a setter.
const SCOPES = {
  own: { v: "s", set: "setS" },
  page: { v: "p", set: "setP" },
  g: { v: "g", set: "setG" },
};

// ---------------------------------------------------------------------------------------------
// One component: the context that maps refs onto state reads and writes.

function makeCtx(page, comp, kind) {
  const ctx = { needs: {}, options: new Map(), drafts: new Set(), kind };
  ctx.desc = (ref) => {
    const list = ref[0] === "g" ? GLOBAL : ref[0] === "p" ? page.fields : comp.fields;
    return list.find((f) => f.name === ref[1]);
  };
  ctx.scope = (ref) => (ref[0] === "g" ? "g" : ref[0] === "p" && kind !== "page" ? "page" : "own");
  ctx.use = (scope, write) => {
    if (scope === "g") ctx.needs[write ? "setG" : "g"] = true;
    if (scope === "page") ctx.needs[write ? "setP" : "p"] = true;
  };
  // A read of a ref. Inside an updater of the ref's own state, `inner` names the fresh state.
  ctx.read = (ref, inner = null) => {
    const scope = ctx.scope(ref);
    if (inner && inner.scope === scope) return `${inner.name}.${ref[1]}`;
    ctx.use(scope, false);
    return `${SCOPES[scope].v}.${ref[1]}`;
  };
  ctx.expr = function expr(e, top = true) {
    const wrap = (code) => (top ? code : `(${code})`);
    const sub = (x) => expr(x, false);
    switch (e[0]) {
      case "f": case "p": case "g": return ctx.read(e);
      case "k": return str(e[1]);
      case "+": return wrap(`${sub(e[1])} + ${sub(e[2])}`);
      case "-": return wrap(`${sub(e[1])} - ${sub(e[2])}`);
      case "count": case "len": return `${sub(e[1])}.length`;
      case "done": return `${sub(e[1])}.filter((item) => item.done).length`;
      case "left": return `${sub(e[1])}.filter((item) => !item.done).length`;
      case "has": return `${sub(e[1])}.includes(${str(e[2])})`;
      case "and": return wrap(`${sub(e[1])} && ${sub(e[2])}`);
      case "or": return wrap(`${sub(e[1])} || ${sub(e[2])}`);
      case "not": return `!${sub(e[1])}`;
      case "if": return wrap(`${sub(e[1])} ? ${sub(e[2])} : ${sub(e[3])}`);
    }
    if (COMPARE[e[0]]) return wrap(`${sub(e[1])} ${COMPARE[e[0]]} ${sub(e[2])}`);
    throw new Error(`unknown expression ${JSON.stringify(e)}`);
  };
  return ctx;
}

// ---------------------------------------------------------------------------------------------
// Messages

// One op as writes to the states it touches: [{ scope, field, value(inner) }], where `value`
// gives the new value's expression, and `when(inner)` an optional condition.
function opWrites(ctx, op) {
  const [kind, ref] = op;
  const f = ctx.desc(ref);
  const scope = ctx.scope(ref);
  const name = ref[1];
  const cur = (inner) => ctx.read(ref, inner);
  const w = (value, when) => [{ scope, field: name, value, when }];
  const item = (list, text) => `{ id: nextId(${list}), text: ${text}${f.checkable ? ", done: false" : ""} }`;
  switch (kind) {
    case "add": {
      const k = op[2];
      return w((i) => `Math.min(${f.max}, Math.max(${f.min}, ${cur(i)} ${k < 0 ? "-" : "+"} ${Math.abs(k)}))`);
    }
    case "set": return w(() => str(op[2]));
    case "toggle": return w((i) => `!${cur(i)}`);
    case "reset": return w(() => literal(f.initial));
    case "cycle": {
      const options = `${name}Options`;
      ctx.options.set(options, f.options);
      return w((i) => `${options}[(${options}.indexOf(${cur(i)}) + 1) % ${f.options.length}]`);
    }
    case "copy": return w((i) => ctx.read(op[2], i));
    case "push": {
      ctx.needs.nextId = true;
      const draft = (i) => ctx.read(op[2], i);
      const when = (i) => `${draft(i)}.trim()`;
      return [
        { scope, field: name, value: (i) => `[...${cur(i)}, ${item(cur(i), `${draft(i)}.trim()`)}]`, when },
        { scope: ctx.scope(op[2]), field: op[2][1], value: () => '""', when },
      ];
    }
    case "pushText":
      ctx.needs.nextId = true;
      return w((i) => `[...${cur(i)}, ${item(cur(i), str(op[2]))}]`);
    case "pop": return w((i) => `${cur(i)}.slice(0, -1)`);
    case "shift": return w((i) => `${cur(i)}.slice(1)`);
    case "clear": return w(() => "[]");
    case "clearDone": return w((i) => `${cur(i)}.filter((item) => !item.done)`);
  }
  throw new Error(`unknown op ${kind}`);
}

// The statements applying a list of ops: one updater per state they write, in the order of the
// first write to each. A single write is an object spread; several (or a push and its draft in
// the same state, which must see each other) update a copy in order.
function opsStatements(ctx, ops) {
  const writes = ops.flatMap((op) => opWrites(ctx, op));
  const scopes = [...new Set(writes.map((x) => x.scope))];
  const out = [];
  for (const scope of scopes) {
    const { v, set } = SCOPES[scope];
    ctx.use(scope, true);
    const mine = writes.filter((x) => x.scope === scope);
    const simple = { scope, name: v };
    const conds = [...new Set(mine.map((x) => x.when && x.when(simple)).filter(Boolean))];
    if (mine.every((x) => !x.when) && mine.length === 1) {
      out.push(`${set}((${v}) => ({ ...${v}, ${mine[0].field}: ${mine[0].value(simple)} }));`);
    } else if (mine.every((x) => x.when) && conds.length === 1) {
      const fields = mine.map((x) => `${x.field}: ${x.value(simple)}`).join(", ");
      out.push(`${set}((${v}) => (${conds[0]} ? { ...${v}, ${fields} } : ${v}));`);
    } else {
      const inner = { scope, name: "next" };
      const lines = [`${set}((${v}) => {`, `  const next = { ...${v} };`];
      // A push's draft is cleared after the list reads it: group the writes of one push.
      for (let i = 0; i < mine.length; i++) {
        const x = mine[i];
        if (x.when) {
          const group = [x];
          while (mine[i + 1] && mine[i + 1].when && mine[i + 1].when === x.when) group.push(mine[++i]);
          const cond = x.when(inner);
          const values = group.map((y) => [y.field, y.value(inner)]);
          lines.push(`  if (${cond}) {`, ...values.map(([f, val]) => `    next.${f} = ${val};`), "  }");
        } else {
          lines.push(`  next.${x.field} = ${x.value(inner)};`);
        }
      }
      lines.push("  return next;", "});");
      out.push(...lines);
    }
    // A write of a number input's field drops the text typed into it.
    for (const field of new Set(mine.map((x) => x.field))) {
      if (scope === "own" && ctx.drafts.has(field)) out.push(`set${cap(field)}Draft(null);`);
    }
  }
  return out;
}

function fn(name, args, stmts) {
  return `  function ${name}(${args}) {\n${stmts.map((l) => `    ${l}`).join("\n")}\n  }`;
}

function handler(ctx, m) {
  const set1 = (ref, value) => {
    const scope = ctx.scope(ref);
    ctx.use(scope, true);
    const { v, set } = SCOPES[scope];
    return `${set}((${v}) => ({ ...${v}, ${ref[1]}: ${value(v)} }));`;
  };
  switch (m.kind) {
    case "open": return fn(m.name, "", ["setModalKey((key) => key + 1);", "setModalOpen(true);"]);
    case "close": ctx.needs.onClose = true; return fn(m.name, "", ["onClose();"]);
    case "click": case "confirm": {
      const stmts = opsStatements(ctx, m.ops);
      if (m.kind === "confirm") { ctx.needs.onClose = true; stmts.push("onClose();"); }
      return fn(m.name, "", stmts);
    }
    case "input": {
      const f = ctx.desc(m.field);
      if (f.type === "int") {
        const draft = `set${cap(m.field[1])}Draft`;
        return fn(m.name, "e", [
          "const value = e.target.valueAsNumber;",
          `if (Number.isInteger(value) && value >= ${f.min} && value <= ${f.max}) {`,
          `  ${draft}(null);`,
          `  ${set1(m.field, () => "value")}`,
          "} else {",
          `  ${draft}(e.target.value);`,
          "}",
        ]);
      }
      return fn(m.name, "e", ["const { value } = e.target;", set1(m.field, () => "value")]);
    }
    case "select": return fn(m.name, "e", ["const { value } = e.target;", set1(m.field, () => "value")]);
    case "check": return fn(m.name, "", [set1(m.field, (v) => `!${v}.${m.field[1]}`)]);
    case "item":
      if (m.op === "remove") return fn(m.name, "id", [set1(m.field, (v) => `${v}.${m.field[1]}.filter((item) => item.id !== id)`)]);
      return fn(m.name, "id", [set1(m.field, (v) => `${v}.${m.field[1]}.map((item) => (item.id === id ? { ...item, done: !item.done } : item))`)]);
  }
  throw new Error(`unknown message kind ${m.kind}`);
}

// ---------------------------------------------------------------------------------------------
// View

function jsxText(s) {
  return /[{}<>&]/.test(s) ? `{${str(s)}}` : s;
}

function parts(ctx, ps) {
  return ps.map((p) => (typeof p === "string" ? jsxText(p) : `{${ctx.expr(p)}}`)).join("");
}

function view(ctx, page, comp, n, ind) {
  const pad = "  ".repeat(ind);
  const msg = (name) => comp.messages.find((m) => m.name === name);
  const e = ctx.expr;
  switch (n.el) {
    case "text": return [`${pad}<${n.tag}>${parts(ctx, n.parts)}</${n.tag}>`];
    case "button": {
      const disabled = n.disabled ? ` disabled={${e(n.disabled)}}` : "";
      return [`${pad}<button data-role="${n.msg}"${disabled} onClick={${n.msg}}>${parts(ctx, n.text)}</button>`];
    }
    case "link":
      ctx.needs.go = true;
      return [`${pad}<button data-key="${n.to}" data-role="pageLink" onClick={() => go("${n.to}")}>${jsxText(n.text)}</button>`];
    case "open":
      return [`${pad}<button data-role="${n.msg}" onClick={${n.msg}}>${jsxText(n.text)}</button>`];
    case "input": {
      const m = msg(n.msg);
      const f = ctx.desc(m.field);
      const attrs = f.type === "int"
        ? `type="number" data-role="${n.msg}" value={${m.field[1]}Draft ?? ${ctx.read(m.field)}} onChange={${n.msg}}`
        : `type="text" data-role="${n.msg}"${n.placeholder ? ` placeholder=${jsxAttr(n.placeholder)}` : ""} value={${ctx.read(m.field)}} onChange={${n.msg}}`;
      const lines = [n.label ? `${pad}<label>${jsxText(n.label)}<input ${attrs} /></label>` : `${pad}<input ${attrs} />`];
      if (n.invalid) lines.push(`${pad}{${e(n.invalid.when, false)} && <p data-role="${n.msg}Error">${jsxText(n.invalid.message)}</p>}`);
      return lines;
    }
    case "check": {
      const m = msg(n.msg);
      return [`${pad}<label><input type="checkbox" data-role="${n.msg}" checked={${ctx.read(m.field)}} onChange={${n.msg}} />${jsxText(n.label)}</label>`];
    }
    case "select": {
      const m = msg(n.msg);
      const f = ctx.desc(m.field);
      const options = f.options.map((o) => `${pad}  <option value=${jsxAttr(o)}>${jsxText(o)}</option>`);
      const select = [`${pad}<select data-role="${n.msg}" value={${ctx.read(m.field)}} onChange={${n.msg}}>`, ...options, `${pad}</select>`];
      if (!n.label) return select;
      return [`${pad}<label>`, `${pad}  ${jsxText(n.label)}`, ...select.map((l) => "  " + l), `${pad}</label>`];
    }
    case "list": {
      const item = [`${pad}    <li key={item.id} data-key={item.id} data-role="${n.field[1]}Item">`];
      if (n.check) item.push(`${pad}      <input type="checkbox" data-role="${n.check}" checked={item.done} onChange={() => ${n.check}(item.id)} />`);
      item.push(`${pad}      <span>{item.text}</span>`);
      if (n.remove) item.push(`${pad}      <button data-role="${n.remove}" onClick={() => ${n.remove}(item.id)}>${jsxText(n.removeText)}</button>`);
      item.push(`${pad}    </li>`);
      return [
        `${pad}<${n.tag}>`,
        `${pad}  {${ctx.read(n.field)}.map((item) => (`,
        ...item,
        `${pad}  ))}`,
        `${pad}</${n.tag}>`,
      ];
    }
    case "when":
      return [
        `${pad}{${e(n.cond, false)} && (`,
        `${pad}  <${n.tag}>`,
        ...n.children.flatMap((c) => view(ctx, page, comp, c, ind + 2)),
        `${pad}  </${n.tag}>`,
        `${pad})}`,
      ];
    case "group":
      return [`${pad}<${n.tag}>`, ...n.children.flatMap((c) => view(ctx, page, comp, c, ind + 1)), `${pad}</${n.tag}>`];
    case "tabs": {
      const pn = page.id.toUpperCase();
      return [
        `${pad}<nav data-role="tabs">`,
        ...page.tabs.map((t) => `${pad}  <button data-key="${t.id}" data-role="tab" aria-selected={tab === "${t.id}"} onClick={() => setTab("${t.id}")}>${jsxText(t.label)}</button>`),
        `${pad}</nav>`,
        ...page.tabs.map((t) => `${pad}{tab === "${t.id}" && <${pn}${t.id.toUpperCase()}${ctx.tabProps[t.id]} />}`),
      ];
    }
  }
  throw new Error(`unknown view node ${n.el}`);
}

// ---------------------------------------------------------------------------------------------
// Components

// The function of one page, tab panel or modal. `root` builds the outermost JSX from the body.
function component(page, comp, kind, name, { state = [], tabProps = {}, root }) {
  const ctx = makeCtx(page, comp, kind);
  ctx.tabProps = tabProps;
  for (const m of comp.messages) {
    if (m.kind === "input" && ctx.desc(m.field).type === "int") ctx.drafts.add(m.field[1]);
  }
  const handlers = comp.messages.filter((m) => !(kind === "tab" && m.kind === "tab")).map((m) => {
    const code = handler(ctx, m);
    if (kind !== "modal") return code;
    // In a modal, a handler that closes it or writes outside it does nothing once it was closed.
    const closes = m.kind === "close" || m.kind === "confirm";
    if (!closes && !/\bset[PG]\(/.test(code)) return code;
    ctx.needs.closed = true;
    const guard = ["    if (closed.current) return;", ...(closes ? ["    closed.current = true;"] : [])];
    return code.replace(/\{\n/, `{\n${guard.join("\n")}\n`);
  });
  const body = comp.view.flatMap((n) => view(ctx, page, comp, n, 3));
  const jsx = root(body);

  const live = comp.fields.find((f) => f.every);
  const feed = kind === "page" ? comp.fields.find((f) => f.feed) : null;
  const lines = [];
  const used = ["g", "setG", "go", "events"].filter((k) => ctx.needs[k] || (k === "events" && feed));
  if (used.length) lines.push(`  const { ${used.join(", ")} } = usePage(${str(page.id)});`);
  const initial = Object.fromEntries(comp.fields.map((f) => [f.name, f.initial]));
  lines.push(`  const [s, setS] = useState(${literal(initial, "  ")});`);
  for (const n of ctx.drafts) lines.push(`  const [${n}Draft, set${cap(n)}Draft] = useState(null);`);
  lines.push(...state);
  if (ctx.needs.closed) {
    lines.push("  // Set when the modal closes: a second event in the same task, before the render that removes", "  // it, then finds it closed.", "  const closed = useRef(false);");
  }
  for (const [n, o] of ctx.options) lines.push(`  const ${n} = ${literal(o)};`);
  if (live) {
    lines.push("", "  useEffect(() => {",
      `    const timer = setInterval(() => setS((s) => ({ ...s, ${live.name}: Math.min(${live.max}, s.${live.name} + ${live.by}) })), ${live.every});`,
      "    return () => clearInterval(timer);",
      "  }, []);");
  }
  if (feed) {
    lines.push("", "  useEffect(",
      "    () =>",
      "      events.subscribe((msg) => {",
      `        if (msg.type === "pagePush" && msg.page === ${str(page.id)}) {`,
      `          setS((s) => ({ ...s, ${feed.name}: [...s.${feed.name}, msg.item] }));`,
      "        }",
      "      }),",
      "    [events],",
      "  );");
  }
  if (handlers.length) lines.push("", handlers.join("\n\n"));
  const props = [ctx.needs.p && "p", ctx.needs.setP && "setP", ctx.needs.onClose && "onClose"].filter(Boolean);
  // Every name the component declares must be distinct (messages are named by the spec).
  const names = [...used, "s", "setS", ...[...ctx.drafts].flatMap((n) => [`${n}Draft`, `set${cap(n)}Draft`]),
    ...[...ctx.options.keys()], ...(ctx.needs.closed ? ["closed"] : []), ...comp.messages.filter((m) => m.kind !== "tab").map((m) => m.name), ...props,
    ...(page.tabs && kind === "page" ? ["tab", "setTab"] : []), ...(page.modal && kind === "page" ? ["modalOpen", "setModalOpen", "modalKey", "setModalKey"] : [])];
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new Error(`${name}: the name ${dup} is declared twice`);
  return {
    code: `function ${name}(${props.length ? `{ ${props.join(", ")} }` : ""}) {\n${lines.join("\n")}\n\n  return (\n${jsx}\n  );\n}\n`,
    needs: ctx.needs,
  };
}

function pageFile(page) {
  const pn = page.id.toUpperCase();
  const out = [];

  // The props each panel and the modal take from the page: its state and setter, if they use them.
  const stateProps = (needs) => (needs.p ? " p={s}" : "") + (needs.setP ? " setP={setS}" : "");
  const tabProps = {};
  for (const t of page.tabs || []) {
    const c = component(page, t, "tab", `${pn}${t.id.toUpperCase()}`, {
      root: (body) => [`    <section data-key="${t.id}" data-role="panel">`, ...body, "    </section>"].join("\n"),
    });
    tabProps[t.id] = stateProps(c.needs);
    out.push(c.code);
  }
  let modalProps = "";
  if (page.modal) {
    const c = component(page, page.modal, "modal", `${pn}Modal`, {
      root: (body) => [`    <aside data-key="modal" data-role="dialog">`, `      <h2>${jsxText(page.modal.title)}</h2>`, ...body, "    </aside>"].join("\n"),
    });
    modalProps = stateProps(c.needs);
    out.push(c.code);
  }

  const state = [];
  if (page.tabs) state.push(`  const [tab, setTab] = useState(${str(page.tabs[0].id)});`);
  if (page.modal) state.push("  const [modalOpen, setModalOpen] = useState(false);", "  // Counts the opens: each one mounts the modal afresh.", "  const [modalKey, setModalKey] = useState(0);");
  const pageParts = component(page, page, "page", pn, {
    state,
    tabProps,
    root: (body) => [
      `    <main data-key="${page.id}" data-role="page">`,
      `      <h1>${jsxText(page.title)}</h1>`,
      ...body,
      ...(page.modal ? [`      {modalOpen && <${pn}Modal key={modalKey}${modalProps} onClose={() => setModalOpen(false)} />}`] : []),
      "    </main>",
    ].join("\n"),
  });
  out.push(pageParts.code.replace(/^function/, "export default function"));

  const code = out.join("\n");
  const react = ["useEffect", "useRef", "useState"].filter((n) => code.includes(n + "("));
  const imports = [`import { ${react.join(", ")} } from "react";`];
  if (code.includes("usePage(")) imports.push(`import { usePage } from "../app";`);
  if (code.includes("nextId(")) imports.push(`import { nextId } from "../list";`);
  return `${imports.join("\n")}\n\n${code}`;
}

// ---------------------------------------------------------------------------------------------
// Files

const APP_CONTEXT_FILE = `import { createContext, useContext } from "react";

// The app's state (the route, the menu and the global state), its setter and the external
// events, provided by App.
export const AppContext = createContext(null);

// Navigation: closes the menu, and mounts the page unless it is the one shown.
export const navigate = (app, to) => (app.route === to ? { ...app, menu: false } : { ...app, route: to, menu: false });

export function useApp() {
  const { app, setApp, events } = useContext(AppContext);
  return { g: app.g, route: app.route, menu: app.menu, go: (to) => setApp((app) => navigate(app, to)), setApp, events };
}

// What a page (and its tab panels and modal) sees: the global state, a setter for it and the
// navigation. A handler of a page that is no longer shown can still run before the next render
// (two events in one task); its writes and links are dropped, as the page is gone.
export function usePage(page) {
  const { app, setApp, events } = useContext(AppContext);
  const shown = (fn) => setApp((app) => (app.route === page ? fn(app) : app));
  return {
    g: app.g,
    setG: (fn) => shown((app) => ({ ...app, g: fn(app.g) })),
    go: (to) => shown((app) => navigate(app, to)),
    events,
  };
}
`;

const LIST_FILE = `// The id for a new list item: one more than the largest.
export function nextId(items) {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}
`;

function appFile(spec) {
  const names = spec.pages.map((p) => p.id.toUpperCase());
  const table = (pages) => pages.map((p) => `  [${str(p.id)}, ${str(p.title)}],`).join("\n");
  const pinned = spec.pages.filter((p) => spec.pinned.includes(p.id));
  const initial = Object.fromEntries(spec.global.map((f) => [f.name, f.initial]));
  return `import { useEffect, useState } from "react";
import { AppContext, navigate, useApp } from "./app";
${names.map((n) => `import ${n} from "./pages/${n}";`).join("\n")}

const initialApp = { route: ${str(spec.pages[0].id)}, menu: false, g: ${literal(initial)} };

const pinned = [
${table(pinned)}
];

const pages = [
${table(spec.pages)}
];

// The page component of each route.
const components = { ${spec.pages.map((p) => `${p.id}: ${p.id.toUpperCase()}`).join(", ")} };

function Shell() {
  const { g, route, menu, go, setApp } = useApp();
  return (
    <header data-key="shell" data-role="shell">
      <strong>${jsxText(spec.app)}</strong>
      <nav data-role="nav">
        {pinned.map(([id, title]) => (
          <button key={id} data-key={id} data-role="navLink" aria-current={route === id ? "page" : undefined} onClick={() => go(id)}>
            {title}
          </button>
        ))}
        <button data-role="menu" aria-expanded={menu} onClick={() => setApp((app) => ({ ...app, menu: !app.menu }))}>All pages</button>
      </nav>
      <p><span data-role="user">Signed in as {g.user}</span> · <span data-role="cartCount">Cart: {g.cart.length}</span> · <span data-role="noticeCount">{g.notices.length} notices</span></p>
    </header>
  );
}

function Menu() {
  const { go } = useApp();
  return (
    <nav data-role="menuList">
      {pages.map(([id, title]) => (
        <button key={id} data-key={id} data-role="menuLink" onClick={() => go(id)}>
          {title}
        </button>
      ))}
    </nav>
  );
}

export default function App({ events }) {
  const [app, setApp] = useState(initialApp);
  const setG = (fn) => setApp((app) => ({ ...app, g: fn(app.g) }));

  useEffect(
    () =>
      events.subscribe((msg) => {
        switch (msg.type) {
          case "deepLink":
            setApp((app) => navigate(app, msg.route));
            break;
          case "serverSet":
            setG((g) => ({ ...g, [msg.field]: msg.value }));
            break;
          case "notify":
            setG((g) => ({ ...g, notices: [...g.notices, msg.item] }));
            break;
          case "snapshot":
            setG(() => msg.global);
            break;
        }
      }),
    [events],
  );

  const Page = components[app.route];
  return (
    <AppContext value={{ app, setApp, events }}>
      <div data-role="app">
        <Shell />
        {app.menu && <Menu />}
        <Page />
      </div>
    </AppContext>
  );
}
`;
}

export function emit(spec, options = {}) {
  const files = {
    ...templateFiles({ name: "routed-app", title: "Routed app" }, options),
    "src/app.js": APP_CONTEXT_FILE,
    "src/App.jsx": appFile(spec),
    "src/list.js": LIST_FILE,
  };
  let usesNextId = false;
  for (const p of spec.pages) {
    const source = pageFile(p);
    files[`src/pages/${p.id.toUpperCase()}.jsx`] = source;
    usesNextId ||= source.includes("nextId(");
  }
  if (!usesNextId) delete files["src/list.js"];
  return {
    files,
    style: {
      routing: "in-app route state in App; the page component looked up in a table by route and rendered as <Page />; no router library",
      components: "one function component per page (src/pages/PN.jsx), with its tab panels and modal as components of their own in the same file; written from the description, nothing interpreted at runtime; the nav bar and the menu map over a table of (id, title)",
      localState: "one useState object per page, tab panel and modal component, so it starts fresh on every mount; a panel or modal gets the page's state (and setter) as props only if it reads (or writes) it; the modal has a key counted per open, so every open mounts it afresh; a ref notes that it closed, so its handlers that close it or write outside it do nothing afterwards",
      globalState: "the route, the menu and the global state as one useState object in App, shared through a context with the external events; pages use usePage(id), whose global setter and navigation are updaters that ignore a page no longer shown",
      writes: "updater functions, one per state a message writes (an object spread, or a copy updated in order for several ops); list items found by id",
      conditionals: "&& in JSX for the active tab panel, the modal, the menu, conditional sections and validation errors",
      lists: ".map with key={item.id}",
      time: "setInterval in a useEffect of the component that owns the time-driven field, cleared by its cleanup",
      externalEvents: "a subscription in a useEffect in App (deepLink, serverSet, notify, snapshot); a page with a feed subscribes in its own effect and takes its pagePush events",
      derived: "plain expressions in the JSX, no manual memoization",
      inputs: "controlled, onChange; number inputs send only integers within range and keep a draft of other text, dropped by every write of the field",
      compiler: options.compiler === "on" ? "React Compiler (babel-plugin-react-compiler through @rolldown/plugin-babel)" : "none (create-vite's react template)",
      build: "Vite + @vitejs/plugin-react, production defaults, hidden source maps",
    },
  };
}
