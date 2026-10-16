// The routed-app scenario in Marko 6 (the Tags API).
//
// Style (recorded in every generated app's rr.json):
// - Routing is in-app state (README, "Routing"): `<let/route>` in the root template and an
//   `<if>`/`<else if>` chain with one branch per page. Marko creates a branch when its condition
//   becomes true and destroys it when it stops, so only the shell and the page shown exist. No
//   router. The nav bar and the "All pages" menu read two static tables of (id, title), which is
//   genuine data.
// - One tag per page (`src/tags/page-pN.marko`, auto-discovered), written from the page's
//   description alone: its handlers, bindings and derived expressions are that page's own code. A
//   tab panel (`page-pN-tK`) and a modal (`page-pN-modal`) are tags of their own, mounted by
//   `<if>` (the active tab's branch, `modalOpen`), so each starts fresh every time it appears.
// - Page-local state is `<let>`s in the page tag (and in each panel and modal tag): created when
//   the tag mounts, gone when it is destroyed, as the README's lifetime rules require.
// - Global state: `<let>`s in the root template. Marko has no context API, so the root passes each
//   page only the fields that page (or its panels and modal) uses, as attributes: a field the page
//   only reads is `user=user`; one that it writes is bound both ways, `user:=user`, and the page
//   takes it as a controllable `<let/user:=input.user>`. A page passes what its panels and modal
//   use down the same way (`age=age` to read a page field, `note:=note` to write it from the
//   modal's confirm). The root passes `onNavigate`, the shell's `go`, to pages with links.
// - A number input is the `int-field` tag: a controllable `<let/value:=input.value>` with a
//   `<let/pending>` holding an edit that is not a valid integer in range (the cheat sheet's
//   pattern for uncommitted edits: the input keeps what was typed, the state its last valid value).
//   Text inputs, checkboxes and selects are controlled with `value:=` and `checked:=`.
// - Time-driven fields: a `<lifecycle>` in the tag that owns the field, `setInterval` in
//   `onMount`, `clearInterval` in `onDestroy`. A page with a feed list subscribes to `pagePush` in
//   the same `<lifecycle>`: the root holds a `feeds` Map (a `<const>`), the page sets its handler
//   on mount and deletes it on destroy, so a push reaches only the page shown.
// - External events: the root `<return>`s one function that assigns the root's `<let>`s;
//   dispatched items are copied, never adopted.
// - Click messages are handlers in markup (`onClick() { … }`) with immutable list updates; items
//   are found by id, so a missing id is a no-op. Derived values are plain expressions in the
//   markup, conditional sections and validation errors are `<if>`, lists are `<for … by="id">`.

import { templateFiles } from "../../frameworks/marko/framework.js";
import { literal } from "../../frameworks/marko/source.js";
import { GLOBAL, messageWrites, refKey } from "./spec.js";

export const framework = "marko";

export const params = {};

const str = JSON.stringify;
const COMPARE = { "==": "===", "!=": "!==", "<": "<", "<=": "<=", ">": ">", ">=": ">=" };

// Text inside a Marko template: `<` and `${` are the only characters that need escaping here.
const text = (s) => String(s).replace(/</g, "&lt;").replace(/\$\{/g, "\\${");

const tagOf = (page, comp, kind) =>
  kind === "page" ? `page-${page.id}` : kind === "modal" ? `page-${page.id}-modal` : `page-${page.id}-${comp.id}`;

// The refs a component uses: everything that looks like a ref in its view and messages.
function refsOf(comp) {
  const out = new Map();
  const walk = (x) => {
    if (Array.isArray(x)) {
      if (["f", "p", "g"].includes(x[0]) && x.length === 2 && typeof x[1] === "string") out.set(refKey(x), x);
      else x.forEach(walk);
    } else if (x && typeof x === "object") Object.values(x).forEach(walk);
  };
  walk(comp.view);
  walk(comp.messages);
  return out;
}

const messagesOf = (comp) => comp.messages.filter((m) => m.kind !== "tab");
const writesOf = (comp) => new Set(messagesOf(comp).flatMap((m) => messageWrites(m)).map(refKey));
const componentsOf = (page) => [page, ...(page.tabs || []), ...(page.modal ? [page.modal] : [])];

// ---------------------------------------------------------------------------------------------
// One component: the context that maps refs onto names.

function makeCtx(page, comp, kind) {
  const writes = writesOf(comp);
  const used = refsOf(comp);
  // The globals a page binds: those that any of its components writes.
  const pageGlobalWrites = new Set();
  for (const c of componentsOf(page)) for (const k of writesOf(c)) if (k.startsWith("g:")) pageGlobalWrites.add(k);
  const ctx = { kind, needs: { nextId: false, link: false }, options: new Map(), writes, used, pageGlobalWrites };
  ctx.desc = (ref) => {
    const list = ref[0] === "g" ? GLOBAL : ref[0] === "p" ? page.fields : comp.fields;
    return list.find((f) => f.name === ref[1]);
  };
  // Is the ref a `<let>` of this component's template?
  const bound = (ref) => {
    if (ref[0] === "f" || (ref[0] === "p" && kind === "page")) return true;
    if (kind === "page") return pageGlobalWrites.has(refKey(ref));
    return writes.has(refKey(ref));
  };
  ctx.read = (ref) => (bound(ref) ? ref[1] : `input.${ref[1]}`);
  ctx.name = (ref) => {
    if (!bound(ref)) throw new Error(`${comp.id || page.id}: ${refKey(ref)} is written but not bound`);
    return ref[1];
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
// Messages, as the statements of a handler.

function opStatement(ctx, op) {
  const [kind, ref] = op;
  const f = ctx.desc(ref);
  const n = ctx.name(ref);
  switch (kind) {
    case "add": {
      const k = op[2];
      return `${n} = Math.min(${f.max}, Math.max(${f.min}, ${n} ${k < 0 ? "-" : "+"} ${Math.abs(k)}));`;
    }
    case "set": return `${n} = ${str(op[2])};`;
    case "toggle": return `${n} = !${n};`;
    case "reset": return `${n} = ${literal(f.initial)};`;
    case "cycle": {
      const options = `${ref[1]}Options`;
      ctx.options.set(options, f.options);
      return `${n} = ${options}[(${options}.indexOf(${n}) + 1) % ${f.options.length}];`;
    }
    case "copy": return `${n} = ${ctx.read(op[2])};`;
    case "push": {
      ctx.needs.nextId = true;
      const draft = ctx.read(op[2]);
      return `if (${draft}.trim()) {\n  ${n} = ${n}.concat({ id: nextId(${n}), text: ${draft}.trim()${f.checkable ? ", done: false" : ""} });\n  ${ctx.name(op[2])} = "";\n}`;
    }
    case "pushText":
      ctx.needs.nextId = true;
      return `${n} = ${n}.concat({ id: nextId(${n}), text: ${str(op[2])}${f.checkable ? ", done: false" : ""} });`;
    case "pop": return `${n} = ${n}.slice(0, -1);`;
    case "shift": return `${n} = ${n}.slice(1);`;
    case "clear": return `${n} = [];`;
    case "clearDone": return `${n} = ${n}.filter((item) => !item.done);`;
  }
  throw new Error(`unknown op ${kind}`);
}

// `onClick() { … }` for a click or confirm message; a confirm closes the modal after its ops.
function clickHandler(ctx, m, pad) {
  if (m.kind === "close") return "onClick() { input.onClose() }";
  const stmts = m.ops.map((op) => opStatement(ctx, op));
  if (m.kind === "confirm") stmts.push("input.onClose();");
  const lines = stmts.flatMap((s) => s.split("\n"));
  if (lines.length === 1) return `onClick() { ${lines[0].replace(/;$/, "")} }`;
  return `onClick() {\n${lines.map((l) => `${pad}  ${l}`).join("\n")}\n${pad}}`;
}

// ---------------------------------------------------------------------------------------------
// View

function parts(ctx, ps) {
  return ps.map((p) => (typeof p === "string" ? text(p) : `\${${ctx.expr(p)}}`)).join("");
}

function view(ctx, page, comp, n, ind) {
  const pad = "  ".repeat(ind);
  const msg = (name) => comp.messages.find((m) => m.name === name);
  const e = ctx.expr;
  switch (n.el) {
    case "text": return [`${pad}<${n.tag}>${parts(ctx, n.parts)}</${n.tag}>`];
    case "button": {
      const disabled = n.disabled ? ` disabled=(${e(n.disabled)})` : "";
      return [`${pad}<button data-role="${n.msg}"${disabled} ${clickHandler(ctx, msg(n.msg), pad)}>${parts(ctx, n.text)}</button>`];
    }
    case "link":
      ctx.needs.link = true;
      return [`${pad}<button data-key="${n.to}" data-role="pageLink" onClick() { input.onNavigate(${str(n.to)}) }>${text(n.text)}</button>`];
    case "open":
      return [`${pad}<button data-role="${n.msg}" onClick() { modalOpen = true }>${text(n.text)}</button>`];
    case "input": {
      const m = msg(n.msg);
      const f = ctx.desc(m.field);
      const name = ctx.name(m.field);
      const field = f.type === "int"
        ? `<int-field msg="${n.msg}" min=${f.min} max=${f.max} value:=${name}/>`
        : `<input type="text" data-role="${n.msg}"${n.placeholder ? ` placeholder=${str(n.placeholder)}` : ""} value:=${name}/>`;
      const lines = [n.label ? `${pad}<label>${text(n.label)}${field}</label>` : `${pad}${field}`];
      if (n.invalid) {
        lines.push(`${pad}<if=(${e(n.invalid.when)})>`, `${pad}  <p data-role="${n.msg}Error">${text(n.invalid.message)}</p>`, `${pad}</if>`);
      }
      return lines;
    }
    case "check": {
      const m = msg(n.msg);
      return [`${pad}<label><input type="checkbox" data-role="${n.msg}" checked:=${ctx.name(m.field)}/>${text(n.label)}</label>`];
    }
    case "select": {
      const m = msg(n.msg);
      const f = ctx.desc(m.field);
      const options = f.options.map((o) => `${pad}  <option value=${str(o)}>${text(o)}</option>`);
      const select = [`${pad}<select data-role="${n.msg}" value:=${ctx.name(m.field)}>`, ...options, `${pad}</select>`];
      if (!n.label) return select;
      return [`${pad}<label>`, `${pad}  ${text(n.label)}`, ...select.map((l) => "  " + l), `${pad}</label>`];
    }
    case "list": {
      const name = n.field[1];
      const item = [`${pad}    <li data-key=item.id data-role="${name}Item">`];
      if (n.check) {
        const l = ctx.name(n.field);
        item.push(`${pad}      <input type="checkbox" data-role="${n.check}" checked=item.done checkedChange(done) { ${l} = ${l}.map((other) => (other.id === item.id ? { ...other, done } : other)) }/>`);
      }
      item.push(`${pad}      <span>\${item.text}</span>`);
      if (n.remove) {
        const l = ctx.name(n.field);
        item.push(`${pad}      <button data-role="${n.remove}" onClick() { ${l} = ${l}.filter((other) => other.id !== item.id) }>${text(n.removeText)}</button>`);
      }
      item.push(`${pad}    </li>`);
      return [`${pad}<${n.tag}>`, `${pad}  <for|item| of=${ctx.read(n.field)} by="id">`, ...item, `${pad}  </for>`, `${pad}</${n.tag}>`];
    }
    case "when":
      return [
        `${pad}<if=(${e(n.cond)})>`,
        `${pad}  <${n.tag}>`,
        ...n.children.flatMap((c) => view(ctx, page, comp, c, ind + 2)),
        `${pad}  </${n.tag}>`,
        `${pad}</if>`,
      ];
    case "group":
      return [`${pad}<${n.tag}>`, ...n.children.flatMap((c) => view(ctx, page, comp, c, ind + 1)), `${pad}</${n.tag}>`];
    case "tabs": {
      const lines = [
        `${pad}<nav data-role="tabs">`,
        ...page.tabs.map((t) => `${pad}  <button data-key="${t.id}" data-role="tab" aria-selected=(activeTab === "${t.id}" ? "true" : "false") onClick() { activeTab = "${t.id}" }>${text(t.label)}</button>`),
        `${pad}</nav>`,
      ];
      page.tabs.forEach((t, i) => {
        const [open, close] = i === 0 ? ["if", "if"] : ["else if", "else"];
        lines.push(`${pad}<${open}=activeTab === "${t.id}">`, `${pad}  ${childTag(ctx, page, t, "tab")}`, `${pad}</${close}>`);
      });
      return lines;
    }
  }
  throw new Error(`unknown view node ${n.el}`);
}

// The use of a tab panel's or modal's tag in the page: what it reads is passed as an attribute,
// what it writes is bound both ways.
function childTag(ctx, page, comp, kind) {
  const child = makeCtx(page, comp, kind);
  const attrs = [];
  for (const [key, ref] of child.used) {
    if (ref[0] === "f") continue;
    attrs.push(child.writes.has(key) ? ` ${ref[1]}:=${ref[1]}` : ` ${ref[1]}=${ctx.read(ref)}`);
  }
  if (kind === "modal") attrs.push(" onClose() { modalOpen = false }");
  return `<${tagOf(page, comp, kind)}${attrs.join("")}/>`;
}

// ---------------------------------------------------------------------------------------------
// Components

function componentFile(page, comp, kind) {
  const ctx = makeCtx(page, comp, kind);
  // The view first: it fills ctx.needs and ctx.options.
  const inner = comp.view.flatMap((n) => view(ctx, page, comp, n, 1));
  if (kind !== "page" && ctx.needs.link) throw new Error(`${page.id}: a link outside the page`);

  const decls = [];
  // The refs the component does not own but writes: controllable lets.
  const takes = kind === "page"
    ? [...ctx.pageGlobalWrites].map((k) => k.slice(2))
    : [...ctx.used].filter(([key, ref]) => ref[0] !== "f" && ctx.writes.has(key)).map(([, ref]) => ref[1]);
  for (const name of takes) decls.push(`<let/${name}:=input.${name}>`);
  for (const f of comp.fields) decls.push(`<let/${f.name}=${literal(f.initial)}>`);
  if (kind === "page" && page.tabs) decls.push(`<let/activeTab=${str(page.tabs[0].id)}>`);
  if (kind === "page" && page.modal) decls.push("<let/modalOpen=false>");

  const live = comp.fields.find((f) => f.every);
  const feed = kind === "page" ? comp.fields.find((f) => f.feed) : null;
  const mounts = [], destroys = [];
  if (live) {
    mounts.push(`this.timer = setInterval(() => { ${live.name} = Math.min(${live.max}, ${live.name} + ${live.by}) }, ${live.every});`);
    destroys.push("clearInterval(this.timer);");
  }
  if (feed) {
    mounts.push(`input.feeds.set(${str(page.id)}, (item) => { ${feed.name} = ${feed.name}.concat({ id: item.id, text: item.text }) });`);
    destroys.push(`input.feeds.delete(${str(page.id)});`);
  }

  const statics = [];
  if (ctx.needs.nextId) {
    statics.push("static function nextId(items) {\n  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;\n}");
  }
  for (const [name, options] of ctx.options) statics.push(`static const ${name} = ${literal(options)};`);

  const markup = {
    page: () => [
      `<main data-key="${page.id}" data-role="page">`,
      `  <h1>${text(page.title)}</h1>`,
      ...inner,
      ...(page.modal ? ["  <if=modalOpen>", `    ${childTag(ctx, page, page.modal, "modal")}`, "  </if>"] : []),
      "</main>",
    ],
    tab: () => [`<section data-key="${comp.id}" data-role="panel">`, ...inner, "</section>"],
    modal: () => [`<aside data-key="modal" data-role="dialog">`, `  <h2>${text(comp.title)}</h2>`, ...inner, "</aside>"],
  }[kind]();

  const lines = [];
  if (statics.length) lines.push(statics.join("\n\n"), "");
  lines.push(...decls);
  if (mounts.length) {
    lines.push("<lifecycle", "  onMount() {", ...mounts.map((m) => `    ${m}`), "  }", "  onDestroy() {", ...destroys.map((m) => `    ${m}`), "  }", "/>");
  }
  lines.push("", ...markup);
  return { code: lines.join("\n") + "\n", needs: ctx.needs, takes };
}

// The pieces of a page: [tag name, file]. Also what the root must pass the page.
function pageFiles(page) {
  const files = {};
  const comps = componentsOf(page);
  const result = {};
  for (const c of comps) {
    const kind = c === page ? "page" : c === page.modal ? "modal" : "tab";
    const f = componentFile(page, c, kind);
    files[`src/tags/${tagOf(page, c, kind)}.marko`] = f.code;
    result[kind === "tab" ? c.id : kind] = f;
  }
  return { files, page: result.page };
}

// ---------------------------------------------------------------------------------------------
// The root template and the files

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

function appFile(spec, pageInfo) {
  const row = (p) => `  [${str(p.id)}, ${str(p.title)}],`;
  const pinned = spec.pages.filter((p) => spec.pinned.includes(p.id));
  const globals = spec.global.map((f) => `<let/${f.name}=${literal(f.initial)}>`);
  const anyFeed = spec.pages.some((p) => p.fields.some((f) => f.feed));

  // What each page is given: the globals it uses (read, or bound both ways), plus `feeds` and
  // `onNavigate` when it needs them.
  const branches = spec.pages.map((p, i) => {
    const info = pageInfo.get(p.id);
    const used = new Map();
    for (const c of componentsOf(p)) for (const [key, ref] of refsOf(c)) if (ref[0] === "g") used.set(key, ref[1]);
    const attrs = [];
    for (const [key, name] of used) attrs.push(info.takes.includes(name) ? ` ${name}:=${name}` : ` ${name}=${name}`);
    if (p.fields.some((f) => f.feed)) attrs.push(" feeds=feeds");
    if (componentsOf(p).some((c) => JSON.stringify(c.view).includes('"el":"link"'))) attrs.push(" onNavigate=go");
    const [open, close] = i === 0 ? ["if", "if"] : ["else if", "else"];
    return `  <${open}=route === ${str(p.id)}>\n    <page-${p.id}${attrs.join("")}/>\n  </${close}>`;
  });

  return `static const pinned = [
${pinned.map(row).join("\n")}
];

static const pages = [
${spec.pages.map(row).join("\n")}
];

<let/route=${str(spec.pages[0].id)}>
<let/menu=false>
${globals.join("\n")}
<const/go=(to) => {
  route = to;
  menu = false;
}>
${anyFeed ? "<const/feeds=new Map()>\n" : ""}
<div data-role="app">
  <header data-key="shell" data-role="shell">
    <strong>${text(spec.app)}</strong>
    <nav data-role="nav">
      <for|page| of=pinned>
        <button data-key=page[0] data-role="navLink" aria-current=(route === page[0] ? "page" : undefined) onClick() { go(page[0]) }>\${page[1]}</button>
      </for>
      <button data-role="menu" aria-expanded=(menu ? "true" : "false") onClick() { menu = !menu }>All pages</button>
    </nav>
    <p><span data-role="user">Signed in as \${user}</span> · <span data-role="cartCount">Cart: \${cart.length}</span> · <span data-role="noticeCount">\${notices.length} notices</span></p>
  </header>
  <if=menu>
    <nav data-role="menuList">
      <for|page| of=pages>
        <button data-key=page[0] data-role="menuLink" onClick() { go(page[0]) }>\${page[1]}</button>
      </for>
    </nav>
  </if>
${branches.join("\n")}
</div>

// External events: the root's tag variable, which the adapter calls with each message.
<return=(msg) => {
  switch (msg.type) {
    case "deepLink":
      go(msg.route);
      break;
    case "serverSet":
      switch (msg.field) {
${["user", "currency", "balance", "online"].map((f) => `        case "${f}":\n          ${f} = msg.value;\n          break;`).join("\n")}
      }
      break;
    case "notify":
      notices = notices.concat({ id: msg.item.id, text: msg.item.text });
      break;
    case "pagePush":
${anyFeed ? "      feeds.get(msg.page)?.(msg.item);\n" : ""}      break;
    case "snapshot":
${spec.global.map((f) => `      ${f.name} = ${f.type === "list" ? `msg.global.${f.name}.map((item) => ({ ...item }))` : `msg.global.${f.name}`};`).join("\n")}
      break;
  }
}>
`;
}

export function emit(spec) {
  const files = { ...templateFiles({ name: "routed-app", title: "Routed app" }), "src/tags/int-field.marko": INT_FIELD };
  const pageInfo = new Map();
  for (const p of spec.pages) {
    const { files: f, page } = pageFiles(p);
    Object.assign(files, f);
    pageInfo.set(p.id, page);
  }
  files["src/app.marko"] = appFile(spec, pageInfo);
  return {
    files,
    style: {
      routing: "in-app route <let> in the root template; an <if>/<else if> chain with one branch per page mounts the page the route names and destroys the one it leaves; no router; the nav bar and the menu read static tables of (id, title)",
      components: "one tag per page (src/tags/page-pN.marko), with its tab panels (page-pN-tK) and modal (page-pN-modal) as tags of their own; written from the description, nothing interpreted at runtime",
      localState: "<let>s in the page, panel and modal tags, created when the tag mounts and gone when it is destroyed; the active tab's panel and the open modal are <if> branches, so they start fresh each time",
      globalState: "<let>s in the root template, passed down as attributes (no context API): read-only as name=name, written as name:=name into a controllable <let/name:=input.name>; a page passes its panels and modal what they use the same way",
      numberInputs: "the int-field tag: a controllable <let> plus a <let/pending> for an edit that is not a valid integer in range",
      time: "<lifecycle> in the tag that owns the field: setInterval in onMount, clearInterval in onDestroy",
      externalEvents: "app.marko <return>s a function (the root's tag variable) that assigns the root's <let>s; pagePush goes to the handler a mounted feed page set in the root's feeds Map from its <lifecycle> (onDestroy deletes it); dispatched items are copied, never adopted",
      writes: "assignments in onClick handlers with immutable list updates; list items found by id",
      derived: "plain expressions in the markup",
      conditionals: "<if> for conditional sections, validation errors, the menu, the active tab and the modal",
      lists: "<for … by=\"id\"> for keyed lists, <for> over the static tables of pages",
      events: "handlers in markup (onClick, checkedChange); value:=, checked:= and <select value:=> for controlled inputs",
      build: "Vite + @marko/vite (linked: false), production mode, client-only mount, hidden source maps",
    },
  };
}
