// The routed-app scenario in Solid 1.
//
// Style (recorded in every generated app's rr.json):
// - Routing is in-app state (README, "Routing"): a `route` signal in the app store, and
//   `<Dynamic>` over a table of page components in `App`, mounting the one the route names (a
//   `<Switch>` of N `<Match>`es would build N matches at every mount). No router library.
// - One component per page (`src/pages/PN.jsx`), written from the page's description alone: its
//   handlers, bindings and derived expressions are that page's own code, nothing is interpreted
//   at runtime. A tab panel (`PNT1`) and a modal (`PNModal`) are components of their own, in the
//   page's file. The "All pages" menu and the nav bar read a table of (id, title), which is
//   genuine data.
// - Page-local state is a `createStore` created inside the page component (and inside each tab
//   panel and modal), so it starts fresh whenever the component mounts and is gone when it
//   unmounts, as the README's lifetime rules require. A tab panel reads its page's store through
//   a prop; the modal's confirm writes it through a setter prop.
// - Global state is one `createStore` created per mount, with the route and the menu signals,
//   shared through a context. Components read it directly (`g.balance`), so only the bindings
//   that read a field depend on it; an unmounted page has no bindings left.
// - Tabs and the modal render with `<Switch>`/`<Match>` and `<Show>`: the active panel and the
//   open modal exist only while shown. The menu is a `<Show>` over a `<For>` of every page.
// - Time-driven fields: `setInterval` in the component that owns the field, cleared by
//   `onCleanup`. A feed list subscribes its page's `pagePush` handler to the app store with
//   `onCleanup` to unsubscribe, so a push reaches only the page shown.
// - Click messages with several ops run in `batch`; writes use path setters on the store. List
//   items are found by id and a missing id is a no-op. Dispatched messages are never adopted:
//   items are copied, and a snapshot is cloned before `reconcile(…, { key: "id" })`.
// - Lists with `<For>`, conditional sections and validation errors with `<Show>`, derived values
//   as plain expressions in the JSX. Events: `onClick`/`onInput` (delegated), `onChange` for
//   checkboxes and selects; a number input sends its message only for an integer in range.

import { templateFiles } from "../../frameworks/solid/framework.js";
import { literal, jsxAttr } from "../../frameworks/shared/jsx.js";
import { GLOBAL } from "./spec.js";

export const framework = "solid";

export const params = {};

const str = JSON.stringify;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const COMPARE = { "==": "===", "!=": "!==", "<": "<", "<=": "<=", ">": ">", ">=": ">=" };

// ---------------------------------------------------------------------------------------------
// One component: the context that maps refs onto store reads and writes.

function makeCtx(page, comp, kind) {
  const ctx = { needs: {}, options: new Map(), kind };
  const desc = (ref) => {
    const list = ref[0] === "g" ? GLOBAL : ref[0] === "p" ? page.fields : comp.fields;
    return list.find((f) => f.name === ref[1]);
  };
  ctx.desc = desc;
  ctx.read = (ref) => {
    if (ref[0] === "g") { ctx.needs.g = true; return `g.${ref[1]}`; }
    if (ref[0] === "p") return kind === "page" ? `s.${ref[1]}` : `props.p.${ref[1]}`;
    return `s.${ref[1]}`;
  };
  // A setter call on a ref: `args` follow the field's name (a value, or a filter, a key, a value).
  ctx.write = (ref, ...args) => {
    if (ref[0] === "g") { ctx.needs.setG = true; return `setG(${str(ref[1])}, ${args.join(", ")})`; }
    if (ref[0] === "p" && kind !== "page") return `props.setP(${str(ref[1])}, ${args.join(", ")})`;
    return `set(${str(ref[1])}, ${args.join(", ")})`;
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

function opStatement(ctx, op) {
  const [kind, ref] = op;
  const f = ctx.desc(ref);
  const optionsName = `${ref[1]}Options`;
  switch (kind) {
    case "add": {
      const k = op[2];
      return ctx.write(ref, `(v) => Math.min(${f.max}, Math.max(${f.min}, v ${k < 0 ? "-" : "+"} ${Math.abs(k)}))`) + ";";
    }
    case "set": return ctx.write(ref, str(op[2])) + ";";
    case "toggle": return ctx.write(ref, "(v) => !v") + ";";
    case "reset": return ctx.write(ref, literal(f.initial)) + ";";
    case "cycle":
      ctx.options.set(optionsName, f.options);
      return ctx.write(ref, `(v) => ${optionsName}[(${optionsName}.indexOf(v) + 1) % ${f.options.length}]`) + ";";
    case "copy": return ctx.write(ref, ctx.read(op[2])) + ";";
    case "push": {
      ctx.needs.nextId = true;
      const draft = ctx.read(op[2]);
      return `if (${draft}.trim()) {\n  ${ctx.write(ref, `(items) => [...items, { id: nextId(items), text: ${draft}.trim()${f.checkable ? ", done: false" : ""} }]`)};\n  ${ctx.write(op[2], '""')};\n}`;
    }
    case "pushText":
      ctx.needs.nextId = true;
      return ctx.write(ref, `(items) => [...items, { id: nextId(items), text: ${str(op[2])}${f.checkable ? ", done: false" : ""} }]`) + ";";
    case "pop": return ctx.write(ref, "(items) => items.slice(0, -1)") + ";";
    case "shift": return ctx.write(ref, "(items) => items.slice(1)") + ";";
    case "clear": return ctx.write(ref, "[]") + ";";
    case "clearDone": return ctx.write(ref, "(items) => items.filter((item) => !item.done)") + ";";
  }
  throw new Error(`unknown op ${kind}`);
}

// Statements of a list of ops, in one `batch` when they write more than once.
function opsBody(ctx, ops, extra = []) {
  const stmts = [...ops.map((op) => opStatement(ctx, op)), ...extra];
  if (stmts.length === 1 && !stmts[0].startsWith("if")) return { arrow: stmts[0].replace(/;$/, ""), block: null };
  ctx.needs.batch = true;
  return { arrow: null, block: stmts };
}

function handler(ctx, m) {
  const { write } = ctx;
  switch (m.kind) {
    case "open": return `  const ${m.name} = () => setModalOpen(true);`;
    case "close": return `  const ${m.name} = () => props.onClose();`;
    case "click": case "confirm": {
      const extra = m.kind === "confirm" ? ["props.onClose();"] : [];
      const b = opsBody(ctx, m.ops, extra);
      if (b.arrow) return `  const ${m.name} = () => ${b.arrow};`;
      const lines = b.block.flatMap((s) => s.split("\n")).map((l) => `      ${l}`);
      return `  const ${m.name} = () =>\n    batch(() => {\n${lines.join("\n")}\n    });`;
    }
    case "input": {
      const f = ctx.desc(m.field);
      if (f.type === "int") {
        return `  const ${m.name} = (e) => {\n    const value = e.currentTarget.valueAsNumber;\n    if (Number.isInteger(value) && value >= ${f.min} && value <= ${f.max}) ${write(m.field, "value")};\n  };`;
      }
      return `  const ${m.name} = (e) => ${write(m.field, "e.currentTarget.value")};`;
    }
    case "select": return `  const ${m.name} = (e) => ${write(m.field, "e.currentTarget.value")};`;
    case "check": return `  const ${m.name} = () => ${write(m.field, "(on) => !on")};`;
    case "item":
      if (m.op === "remove") return `  const ${m.name} = (id) => ${write(m.field, "(items) => items.filter((item) => item.id !== id)")};`;
      return `  const ${m.name} = (id) => ${write(m.field, "(item) => item.id === id", '"done"', "(done) => !done")};`;
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
      const value = ctx.read(m.field);
      const attrs = f.type === "int"
        ? `type="number" data-role="${n.msg}" value={${value}} onInput={${n.msg}}`
        : `type="text" data-role="${n.msg}"${n.placeholder ? ` placeholder=${jsxAttr(n.placeholder)}` : ""} value={${value}} onInput={${n.msg}}`;
      const lines = [n.label ? `${pad}<label>${jsxText(n.label)}<input ${attrs} /></label>` : `${pad}<input ${attrs} />`];
      if (n.invalid) {
        lines.push(`${pad}<Show when={${e(n.invalid.when)}}>`, `${pad}  <p data-role="${n.msg}Error">${jsxText(n.invalid.message)}</p>`, `${pad}</Show>`);
      }
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
      const item = [`${pad}      <li data-key={item.id} data-role="${n.field[1]}Item">`];
      if (n.check) item.push(`${pad}        <input type="checkbox" data-role="${n.check}" checked={item.done} onChange={() => ${n.check}(item.id)} />`);
      item.push(`${pad}        <span>{item.text}</span>`);
      if (n.remove) item.push(`${pad}        <button data-role="${n.remove}" onClick={() => ${n.remove}(item.id)}>${jsxText(n.removeText)}</button>`);
      item.push(`${pad}      </li>`);
      return [
        `${pad}<${n.tag}>`,
        `${pad}  <For each={${ctx.read(n.field)}}>`,
        `${pad}    {(item) => (`,
        ...item,
        `${pad}    )}`,
        `${pad}  </For>`,
        `${pad}</${n.tag}>`,
      ];
    }
    case "when":
      return [
        `${pad}<Show when={${e(n.cond)}}>`,
        `${pad}  <${n.tag}>`,
        ...n.children.flatMap((c) => view(ctx, page, comp, c, ind + 2)),
        `${pad}  </${n.tag}>`,
        `${pad}</Show>`,
      ];
    case "group":
      return [`${pad}<${n.tag}>`, ...n.children.flatMap((c) => view(ctx, page, comp, c, ind + 1)), `${pad}</${n.tag}>`];
    case "tabs": {
      ctx.needs.tabs = true;
      const pn = page.id.toUpperCase();
      return [
        `${pad}<nav data-role="tabs">`,
        ...page.tabs.map((t) => `${pad}  <button data-key="${t.id}" data-role="tab" aria-selected={tab() === "${t.id}"} onClick={() => setTab("${t.id}")}>${jsxText(t.label)}</button>`),
        `${pad}</nav>`,
        `${pad}<Switch>`,
        ...page.tabs.flatMap((t) => [`${pad}  <Match when={tab() === "${t.id}"}>`, `${pad}    <${pn}${t.id.toUpperCase()} p={s} />`, `${pad}  </Match>`]),
        `${pad}</Switch>`,
      ];
    }
  }
  throw new Error(`unknown view node ${n.el}`);
}

// ---------------------------------------------------------------------------------------------
// Components

// The function of one page, tab panel or modal. `root` builds the outermost JSX from the body.
function component(page, comp, kind, name, { signals = [], extra = [], root }) {
  const ctx = makeCtx(page, comp, kind);
  const handlers = comp.messages.filter((m) => !(kind === "tab" && m.kind === "tab")).map((m) => handler(ctx, m));
  const body = comp.view.flatMap((n) => view(ctx, page, comp, n, 3));
  const jsx = root(body);

  const live = comp.fields.find((f) => f.every);
  const feed = kind === "page" ? comp.fields.find((f) => f.feed) : null;
  const props = kind === "page" ? "" : "props";
  const lines = [];
  const used = [["g", "g"], ["setG", "setG"], ["go", "go"], ["subscribe", "subscribe"]].filter(([k]) => ctx.needs[k] || (k === "subscribe" && feed));
  if (used.length) lines.push(`  const { ${used.map(([, v]) => v).join(", ")} } = useApp();`);
  const initial = Object.fromEntries(comp.fields.map((f) => [f.name, f.initial]));
  lines.push(`  const [s, set] = createStore(${literal(initial, "  ")});`);
  for (const sig of signals) lines.push(sig);
  if (live) {
    lines.push(`  const timer = setInterval(() => set(${str(live.name)}, (v) => Math.min(${live.max}, v + ${live.by})), ${live.every});`);
    lines.push("  onCleanup(() => clearInterval(timer));");
  }
  if (feed) {
    lines.push(`  onCleanup(subscribe(${str(page.id)}, (item) => set(${str(feed.name)}, (items) => [...items, { id: item.id, text: item.text }])));`);
  }
  for (const [n, o] of ctx.options) lines.push(`  const ${n} = ${literal(o)};`);
  lines.push(...handlers, ...extra);
  return {
    code: `function ${name}(${props}) {\n${lines.join("\n")}\n  return (\n${jsx}\n  );\n}\n`,
    needs: ctx.needs,
    source: null,
  };
}

function pageFile(page) {
  const pn = page.id.toUpperCase();
  const out = [];

  for (const t of page.tabs || []) {
    out.push(component(page, t, "tab", `${pn}${t.id.toUpperCase()}`, {
      root: (body) => [`    <section data-key="${t.id}" data-role="panel">`, ...body, "    </section>"].join("\n"),
    }).code);
  }
  if (page.modal) {
    out.push(component(page, page.modal, "modal", `${pn}Modal`, {
      root: (body) => [`    <aside data-key="modal" data-role="dialog">`, `      <h2>${jsxText(page.modal.title)}</h2>`, ...body, "    </aside>"].join("\n"),
    }).code);
  }

  const signals = [];
  if (page.tabs) signals.push(`  const [tab, setTab] = createSignal(${str(page.tabs[0].id)});`);
  if (page.modal) signals.push("  const [modalOpen, setModalOpen] = createSignal(false);");
  const pageParts = component(page, page, "page", pn, {
    signals,
    root: (body) => [
      `    <main data-key="${page.id}" data-role="page">`,
      `      <h1>${jsxText(page.title)}</h1>`,
      ...body,
      ...(page.modal ? [
        "      <Show when={modalOpen()}>",
        `        <${pn}Modal p={s} setP={set} onClose={() => setModalOpen(false)} />`,
        "      </Show>",
      ] : []),
      "    </main>",
    ].join("\n"),
  });
  out.push(pageParts.code.replace(/^function/, "export default function"));

  const code = out.join("\n");
  const has = (re) => re.test(code);
  const solid = [
    ["Match", /<Match /], ["Show", /<Show /], ["Switch", /<Switch>/], ["For", /<For /],
    ["batch", /batch\(/], ["createSignal", /createSignal\(/], ["onCleanup", /onCleanup\(/],
  ].filter(([, re]) => has(re)).map(([n]) => n);
  const imports = [];
  if (solid.length) imports.push(`import { ${solid.join(", ")} } from "solid-js";`);
  imports.push(`import { createStore } from "solid-js/store";`);
  if (has(/useApp\(\)/)) imports.push(`import { useApp } from "../store";`);
  if (has(/nextId\(/)) imports.push(`import { nextId } from "../list";`);
  return `${imports.join("\n")}\n\n${code}`;
}

// ---------------------------------------------------------------------------------------------
// Files

function storeFile(spec) {
  const initial = Object.fromEntries(spec.global.map((f) => [f.name, f.initial]));
  return `import { batch, createContext, createSignal, useContext } from "solid-js";
import { createStore, reconcile } from "solid-js/store";

export const AppContext = createContext();

export const useApp = () => useContext(AppContext);

// The app's state: the global fields, the route and the menu. \`receive\` applies external events.
export function createAppStore() {
  const [g, setG] = createStore(${literal(initial, "  ")});
  const [route, setRoute] = createSignal(${str(spec.pages[0].id)});
  const [menu, setMenu] = createSignal(false);
  // The handler of each mounted page that takes \`pagePush\` events.
  const feeds = new Map();

  const go = (to) =>
    batch(() => {
      setMenu(false);
      setRoute(to);
    });
  const toggleMenu = () => setMenu((open) => !open);
  const subscribe = (page, handler) => {
    feeds.set(page, handler);
    return () => feeds.delete(page);
  };

  function receive(msg) {
    switch (msg.type) {
      case "deepLink":
        go(msg.route);
        break;
      case "serverSet":
        setG(msg.field, msg.value);
        break;
      case "notify":
        setG("notices", (items) => [...items, { id: msg.item.id, text: msg.item.text }]);
        break;
      case "pagePush":
        feeds.get(msg.page)?.(msg.item);
        break;
      case "snapshot":
        setG(reconcile(structuredClone(msg.global), { key: "id" }));
        break;
    }
  }

  return { g, setG, route, menu, go, toggleMenu, subscribe, receive };
}
`;
}

const LIST_FILE = `// The id for a new list item: one more than the largest.
export function nextId(items) {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}
`;

function appFile(spec) {
  const names = spec.pages.map((p) => p.id.toUpperCase());
  const table = (pages) => pages.map((p) => `  [${str(p.id)}, ${str(p.title)}],`).join("\n");
  const pinned = spec.pages.filter((p) => spec.pinned.includes(p.id));
  return `import { For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { AppContext, useApp } from "./store";
${names.map((n) => `import ${n} from "./pages/${n}";`).join("\n")}

const pinned = [
${table(pinned)}
];

const pages = [
${table(spec.pages)}
];

// The page component of each route.
const components = { ${spec.pages.map((p) => `${p.id}: ${p.id.toUpperCase()}`).join(", ")} };

function Shell() {
  const { g, route, menu, go, toggleMenu } = useApp();
  return (
    <header data-key="shell" data-role="shell">
      <strong>${jsxText(spec.app)}</strong>
      <nav data-role="nav">
        <For each={pinned}>
          {([id, title]) => (
            <button data-key={id} data-role="navLink" aria-current={route() === id ? "page" : undefined} onClick={() => go(id)}>
              {title}
            </button>
          )}
        </For>
        <button data-role="menu" aria-expanded={menu()} onClick={toggleMenu}>All pages</button>
      </nav>
      <p><span data-role="user">Signed in as {g.user}</span> · <span data-role="cartCount">Cart: {g.cart.length}</span> · <span data-role="noticeCount">{g.notices.length} notices</span></p>
    </header>
  );
}

function Menu() {
  const { go } = useApp();
  return (
    <nav data-role="menuList">
      <For each={pages}>
        {([id, title]) => (
          <button data-key={id} data-role="menuLink" onClick={() => go(id)}>
            {title}
          </button>
        )}
      </For>
    </nav>
  );
}

export default function App(props) {
  const { route, menu } = props.store;
  return (
    <AppContext.Provider value={props.store}>
      <div data-role="app">
        <Shell />
        <Show when={menu()}>
          <Menu />
        </Show>
        <Dynamic component={components[route()]} />
      </div>
    </AppContext.Provider>
  );
}
`;
}

export function emit(spec) {
  const files = {
    ...templateFiles({ name: "routed-app", title: "Routed app" }),
    "src/store.js": storeFile(spec),
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
      routing: "in-app route signal in the app store; <Dynamic> over a table of page components in App mounts the page the route names; no router library",
      components: "one component per page (src/pages/PN.jsx), with its tab panels and modal as components of their own in the same file; written from the description, nothing interpreted at runtime; the nav bar and the menu read a table of (id, title)",
      localState: "a createStore created inside the page, tab panel and modal component, so it starts fresh on every mount; a panel reads its page's store through a prop, the modal writes it through a setter prop",
      globalState: "one createStore per mount, plus the route and menu signals, shared through a context; read directly by the bindings that need a field",
      conditionals: "<Switch>/<Match> for the active tab panel (at most four), <Show> for the modal, the menu, conditional sections and validation errors",
      lists: "<For>",
      time: "setInterval in the component that owns the time-driven field, cleared with onCleanup",
      externalEvents: "store.receive(msg); pagePush goes to the handler a mounted feed page subscribed (onCleanup unsubscribes); serverSet is a path set; snapshot is reconcile(structuredClone(global), { key: 'id' }); dispatched items are copied, never adopted",
      writes: "path setters on the stores; click messages with several ops in batch; list items found by id",
      derived: "plain expressions in the JSX, one fine-grained binding each",
      events: "onClick/onInput (delegated), onChange for checkboxes and selects; number inputs send only integers within range",
      build: "Vite + vite-plugin-solid, production defaults, hidden source maps",
    },
  };
}
