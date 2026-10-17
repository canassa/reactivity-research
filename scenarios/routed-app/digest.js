// routed-app in digest (prototype): compiled dirty checking, with components that mount and
// unmount.
//
// What a compiler for this approach would produce for an app of pages:
// - One function per page, written out in full from that page's description. Calling it mounts the
//   page: it declares the page's state as local variables (so a page starts fresh each time it
//   mounts and its state is gone when it unmounts), makes the page's node from a template and
//   registers its bindings, handlers, timer and feed subscription. Its tab panels and its
//   modal are functions inside it, in the same way: calling one mounts it with fresh state.
//   Nothing about a page is kept as data for a generic routine; the only data are the initial
//   values and the texts (the template) and the table of page titles the "All pages" menu lists.
// - A page is a widget with its own binding list. An event runs the handler of the control it
//   came from, then digests that list. A component that reads something other components write
//   joins a set when it mounts: one per global field (the lists of the mounted components that
//   read it) and one for the page's own fields when its tabs or modal read or write them. A
//   handler that writes such a source digests the set (`up`), and nothing else. A component
//   leaves every set when it ends, so a global write digests only what is mounted.
// - Navigation ends every component but the shell (the page, its tab panel and modal, the menu):
//   their nodes go, their lists are emptied, their timers are cleared, their subscriptions
//   dropped. Then the new page's function is called. The hidden pages' code is in the bundle
//   and nothing of them is built.
// - The shell is a component of its own, with the bindings that read `route`, `menu` and the
//   three global fields it shows. The menu that lists every page is built when it is opened.
// - Code only where it is used: a global field nobody reads has no variable, no setter and no
//   set; the feed, the page sets and the timers exist only in pages that have them.
//
// The runtime is frameworks/digest/runtime-routed.js. Style choices are in `style`.

import { templateFiles } from "../../frameworks/digest/framework.js";

export const framework = "digest";

export const params = {};

const lit = (v) => JSON.stringify(v);
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);
// Text inside a JavaScript template literal.
const tpl = (s) => s.replace(/[\\`]|\$\{/g, (m) => "\\" + m);

// Both sides of a comparison have the same type (the expressions are typed), so loose equality
// is strict equality.
const CMP = new Set(["==", "!=", "<", "<=", ">", ">="]);

// Per compile: the global fields by name, and, per page, what it needs of the others.
// ctx.live: the global fields some component reads (they have a set of readers).
// ctx.shared: the fields of this page that its tabs or modal read or write (the page has a set,
// `Ps`, of the lists that read them, when there are any).
let GL;

// A template without the end tags it closes with: the end of the HTML closes every element
// still open, so they change nothing.
const open = (html) => html.replace(/(<\/\w+>)+$/, "");

// A field's initial value, as a plain literal; a list's items as object literals.
function initial(f, v) {
  if (f.type !== "list") return lit(v);
  const item = (it) => `{ id: ${it.id}, text: ${lit(it.text)}${f.checkable ? `, done: ${!!it.done}` : ""} }`;
  return `[${v.map(item).join(", ")}]`;
}

// Compile one component (a page, a tab panel or a modal) of `page`. Returns its template, the
// code of its bindings (in document order) and handlers, and what it reads and writes outside
// itself.
function compile(kind, comp, page, ctx) {
  const fields = Object.fromEntries(comp.fields.map((f) => [f.name, f]));
  const msgs = Object.fromEntries(comp.messages.map((m) => [m.name, m]));
  // What the component reads and writes outside itself: global fields, and (from a tab or
  // the modal) fields of the page.
  const reads = { g: new Set(), p: new Set() };
  const writes = { g: new Set(), p: new Set() };
  const fdesc = (ref) => (ref[0] === "g" ? GL[ref[1]] : ref[0] === "p" ? page.fields.find((f) => f.name === ref[1]) : fields[ref[1]]);
  const name = (ref) => "$" + ref[1];
  // A read in a binding: the component joins the source's set.
  const rd = (ref) => {
    if (ref[0] === "g") reads.g.add(ref[1]);
    else if (ref[0] === "p") reads.p.add(ref[1]);
    return name(ref);
  };
  // Is this ref a field of the page (whoever's code names it)?
  const isPage = (ref) => ref[0] === "p" || (ref[0] === "f" && kind === "page");
  // The `up` calls a handler that writes these refs needs: the readers' sets.
  const ups = (refs) => {
    const out = new Set();
    for (const ref of refs) {
      if (ref[0] === "g") {
        writes.g.add(ref[1]);
        if (ctx.live.has(ref[1])) out.add(`up(r$${ref[1]})`);
      } else if (isPage(ref)) {
        if (kind !== "page") writes.p.add(ref[1]);
        // Only a page field that its tab or modal reads or writes has readers to digest.
        if (ctx.shared.has(ref[1])) out.add("up(Ps)");
      }
    }
    return [...out];
  };

  function expr(e) {
    const x = expr;
    switch (e[0]) {
      case "f": case "p": case "g": return rd(e);
      case "k": return lit(e[1]);
      case "+": return `(${x(e[1])} + ${x(e[2])})`;
      case "-": return `(${x(e[1])} - ${x(e[2])})`;
      case "count": case "len": return `${x(e[1])}.length`;
      case "done": return `${x(e[1])}.filter((i) => i.done).length`;
      case "left": return `${x(e[1])}.filter((i) => !i.done).length`;
      case "has": return `${x(e[1])}.includes(${lit(e[2])})`;
      case "and": return `(${x(e[1])} && ${x(e[2])})`;
      case "or": return `(${x(e[1])} || ${x(e[2])})`;
      case "not": return `!${x(e[1])}`;
      case "if": return `(${x(e[1])} ? ${x(e[2])} : ${x(e[3])})`;
    }
    if (CMP.has(e[0])) return `(${x(e[1])} ${e[0]} ${x(e[2])})`;
    throw new Error(`digest: unknown expression ${lit(e)}`);
  }

  // A list of text parts: its static HTML when no part is an expression, else the code of the
  // string it computes.
  function parts(ps) {
    if (ps.every((p) => typeof p === "string")) return { html: esc(ps.join("")) };
    if (ps.length === 2 && typeof ps[0] === "string" && typeof ps[1] !== "string") return { html: esc(ps[0]), code: expr(ps[1]) };
    const code = ps.length === 1 ? expr(ps[0])
      : "`" + ps.map((p) => (typeof p === "string" ? tpl(p) : "${" + expr(p) + "}")).join("") + "`";
    return { html: "", code };
  }

  // One op of a click or confirm message as an expression (`t` when it uses the parameter `t`).
  function op(o) {
    const [kind, ref] = o;
    const f = fdesc(ref);
    const L = name(ref);
    switch (kind) {
      // An int field always lies within its range (every op, input and external state keeps it
      // there), so adding k > 0 can only pass the top and k < 0 the bottom: one bound is checked.
      case "add": return { e: o[2] > 0 ? `${L} = Math.min(${L} + ${o[2]}, ${f.max})` : `${L} = Math.max(${L} - ${-o[2]}, ${f.min})` };
      case "set": return { e: `${L} = ${lit(o[2])}` };
      case "toggle": return { e: `${L} = !${L}` };
      case "reset": return { e: `${L} = ${initial(f, f.initial)}` };
      case "cycle": return { e: `${L} = nx(${[L, ...f.options.map(lit)].join(", ")})` };
      case "copy": return { e: `${L} = ${name(o[2])}` };
      case "push": return { e: `(t = ${name(o[2])}.trim()) && (add(${L}, t${f.checkable ? ", false" : ""}), ${name(o[2])} = "")`, t: 1 };
      case "pushText": return { e: `add(${L}, ${lit(o[2])}${f.checkable ? ", false" : ""})` };
      case "pop": return { e: `${L}.pop()` };
      case "shift": return { e: `${L}.shift()` };
      case "clear": return { e: `${L} = []` };
      case "clearDone": return { e: `${L} = ${L}.filter((i) => !i.done)` };
    }
    throw new Error(`digest: unknown op ${kind}`);
  }

  // A message's handler, as an arrow function. It reads its control from `X`. `M` is the modal
  // (a page's variable), `sel` the page's tab selector.
  function handler(m) {
    const L = m.field && name(m.field);
    switch (m.kind) {
      case "click": case "confirm": {
        const ops = m.ops.map(op);
        const wr = m.ops.flatMap((o) => (o[0] === "push" ? [o[1], o[2]] : [o[1]]));
        const all = [...ops.map((o) => o.e), ...ups(wr), ...(m.kind === "confirm" ? ["end(M)"] : [])];
        return `${ops.some((o) => o.t) ? "(t)" : "()"} => ${all.length === 1 ? all[0] : `(${all.join(", ")})`}`;
      }
      case "input": {
        // A number input sends only an integer within the field's range.
        const f = fdesc(m.field);
        const u = ups([m.field]);
        if (f.type === "int") return `(t) => Number.isInteger((t = X.valueAsNumber)) && t >= ${f.min} && t <= ${f.max} && (${[`${L} = t`, ...u].join(", ")})`;
        return `() => ${u.length ? `(${[`${L} = X.value`, ...u].join(", ")})` : `${L} = X.value`}`;
      }
      case "check": case "select": {
        const u = ups([m.field]);
        const v = m.kind === "check" ? "X.checked" : "X.value";
        return `() => ${u.length ? `(${[`${L} = ${v}`, ...u].join(", ")})` : `${L} = ${v}`}`;
      }
      // An item control's handler is created with its item and reads `r.i`, its current value.
      case "item": {
        const u = ups([m.field]);
        const e = m.op === "remove" ? `${L} = ${L}.filter((i) => i != r.i)` : `r.i.done = X.checked`;
        return `() => ${u.length ? `(${[e, ...u].join(", ")})` : e}`;
      }
      case "open": return page.modal.fields.length ? `() => M ? (M.r(), up([M])) : (M = md())` : `() => M || (M = md())`;
      case "close": return `() => end(M)`;
    }
    throw new Error(`digest: unknown message kind ${m.kind}`);
  }

  const binds = [];
  const ctl = []; // the handlers of the template's controls, in document order
  let n = kind === "tab" ? 0 : 1; // the next element's index in the template (0: the heading)
  let at = 0;
  const ref = (i) => {
    if (i < at) throw new Error("digest: bindings out of document order");
    const d = i - at;
    at = i;
    return d;
  };
  const on = (h, c) => ctl.push(`${h}${c ? `, // ${c}` : ","}`);
  const onMsg = (msg) => on(handler(msgs[msg]), msg);

  const view = (v) => {
    switch (v.el) {
      case "text": {
        const i = n++, p = parts(v.parts);
        if (p.code) binds.push(`text(${ref(i)}, () => ${p.code});`);
        return `<${v.tag}>${p.html}</${v.tag}>`;
      }
      case "button": {
        const i = n++, p = parts(v.text);
        if (p.code) binds.push(`text(${ref(i)}, () => ${p.code});`);
        onMsg(v.msg);
        if (v.disabled) binds.push(`bind(${ref(i)}, () => ${expr(v.disabled)}, "disabled");`);
        return `<button data-role=${v.msg}>${p.html}</button>`;
      }
      case "link": {
        n++;
        on("go", v.to);
        return `<button data-key=${v.to} data-role=pageLink>${esc(v.text)}</button>`;
      }
      case "open": {
        n++;
        onMsg(v.msg);
        return `<button data-role=${v.msg}>${esc(v.text)}</button>`;
      }
      case "tabs": {
        binds.push(`const tn = at(${ref(n++)});`);
        const bs = page.tabs.map((t) => {
          binds.push(`bind(${ref(n++)}, () => $tab == ${lit(t.id)}, "ariaSelected");`);
          on("sel", t.id);
          return `<button data-key=${t.id} data-role=tab>${esc(t.label)}</button>`;
        });
        return `<nav data-role=tabs>${bs.join("")}</nav>`;
      }
      case "input": {
        const m = msgs[v.msg];
        const f = fdesc(m.field);
        if (v.label) n++;
        const i = n++;
        onMsg(v.msg);
        binds.push(`bind(${ref(i)}, () => ${rd(m.field)});`);
        let html = f.type === "int" ? `<input type=number data-role=${v.msg}>`
          : `<input type=text data-role=${v.msg}${v.placeholder ? ` placeholder="${esc(v.placeholder)}"` : ""}>`;
        if (v.label) html = `<label>${esc(v.label)}${html}</label>`;
        if (v.invalid) {
          binds.push(`show(${ref(n++)}, () => ${expr(v.invalid.when)});`);
          html += `<p data-role=${v.msg}Error>${esc(v.invalid.message)}</p>`;
        }
        return html;
      }
      case "check": {
        n++;
        const i = n++;
        onMsg(v.msg);
        binds.push(`bind(${ref(i)}, () => ${rd(msgs[v.msg].field)}, "checked");`);
        return `<label><input type=checkbox data-role=${v.msg}>${esc(v.label)}</label>`;
      }
      case "select": {
        const m = msgs[v.msg];
        const f = fdesc(m.field);
        if (v.label) n++;
        const i = n++;
        n += f.options.length;
        onMsg(v.msg);
        binds.push(`bind(${ref(i)}, () => ${rd(m.field)});`);
        const html = `<select data-role=${v.msg}>${f.options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}</select>`;
        return v.label ? `<label>${esc(v.label)}${html}</label>` : html;
      }
      case "list": {
        const i = n++;
        // The item's bindings refer to its elements by position, and the handlers of its
        // controls (checkbox, remove button) are returned in document order.
        let item = "";
        const inner = [], hs = [];
        if (v.check) {
          item += `<input type=checkbox data-role=${v.check}>`;
          inner.push(`bind(0, () => r.i.done, "checked")`);
          hs.push(handler(msgs[v.check]));
        }
        inner.push(`text(${v.check ? 1 : 0}, () => r.i.text)`);
        item += "<span></span>";
        if (v.remove) {
          item += `<button data-role=${v.remove}>${esc(v.removeText)}</button>`;
          hs.push(handler(msgs[v.remove]));
        }
        if (hs.length) inner.push(`[${hs.join(", ")}]`);
        binds.push(`list(${ref(i)}, () => ${rd(v.field)}, "${v.field[1]}Item", \`${tpl(open(item))}\`, (r) => (${inner.join(", ")}));`);
        return `<${v.tag}></${v.tag}>`;
      }
      case "when": {
        const i = n++;
        binds.push(`show(${ref(i)}, () => ${expr(v.cond)});`);
        return `<${v.tag}>${v.children.map(view).join("")}</${v.tag}>`;
      }
      case "group": {
        n++;
        return `<${v.tag}>${v.children.map(view).join("")}</${v.tag}>`;
      }
    }
    throw new Error(`digest: unknown view node ${v.el}`);
  };

  const body = comp.view.map(view).join("");
  const root = kind === "page" ? `<main data-key=${page.id} data-role=page><h1>${esc(page.title)}</h1>`
    : kind === "modal" ? `<aside data-key=modal data-role=dialog><h2>${esc(comp.title)}</h2>`
      : `<section data-key=${comp.id} data-role=panel>`;
  const html = open(root + body + (kind === "page" ? "</main>" : kind === "modal" ? "</aside>" : "</section>"));

  return { html, binds, ctl, reads, writes, ups };
}

const indent = (s, n = 2) => s.split("\n").map((l) => (l ? " ".repeat(n) + l : l)).join("\n");

// The controls' handlers as the arguments after a template.
const handlers = (ctl) => (ctl.length ? `,\n${ctl.map((h) => "    " + h).join("\n")}\n  ` : "");

// What a page and its tabs and modal need of each other: does the page keep a set of its own
// fields (its tabs or modal read or write them)?
function analyse(page) {
  const ctx = { live: new Set(Object.keys(GL)), shared: { has: () => true } };
  const subs = [...(page.tabs || []).map((t) => compile("tab", t, page, ctx)), ...(page.modal ? [compile("modal", page.modal, page, ctx)] : [])];
  return { own: compile("page", page, page, ctx), subs, shared: new Set(subs.flatMap((c) => [...c.reads.p, ...c.writes.p])) };
}

// One page: its function, with its tabs and modal inside.
function pageCode(page, ctx) {
  const tabs = page.tabs || [];
  const own = compile("page", page, page, ctx);
  const subs = [...tabs.map((t) => compile("tab", t, page, ctx)), ...(page.modal ? [compile("modal", page.modal, page, ctx)] : [])];
  const decl = (comp) => comp.fields.map((f) => `$${f.name} = ${initial(f, f.initial)}`);
  const joins = (c, ps) => {
    const j = [...(ps.size ? ["Ps"] : []), ...[...c.reads.g].filter((g) => ctx.live.has(g)).map((g) => `r$${g}`)];
    return j.length ? [`join(${j.join(", ")});`] : [];
  };

  // A tab panel or the modal: a function that mounts it with fresh state and returns its list.
  const subFn = (kind, comp, c, fn) => {
    const lines = [];
    if (comp.fields.length) lines.push(`let ${decl(comp).join(", ")};`);
    lines.push(`${kind === "tab" ? "tn.after" : "pg.append"}(widget(\`${tpl(c.html)}\`${handlers(c.ctl)}));`);
    lines.push(...c.binds, ...joins(c, c.reads.p));
    // The modal clears `M` when it ends, and opening it while open resets its fields in place.
    if (kind === "modal") {
      lines.push("cleanup(() => M = 0);");
      if (comp.fields.length) lines.push(`B.r = () => (${comp.fields.map((f) => `$${f.name} = ${initial(f, f.initial)}`).join(", ")});`);
    }
    for (const f of comp.fields) if (f.every) lines.push(`every(${f.every}, () => $${f.name} = Math.min(${f.max}, $${f.name} + ${f.by}));`);
    lines.push("return B;");
    return `const ${fn} = () => {\n${indent(lines.join("\n"))}\n};`;
  };

  const lines = [];
  const vars = [...decl(page), ...(tabs.length ? ['$tab = "t1"', "T"] : []), ...(page.modal ? ["M"] : [])];
  if (vars.length) lines.push(`let ${vars.join(", ")};`);
  if (ctx.shared.size) lines.push("const Ps = new Set();");
  tabs.forEach((t, i) => lines.push(subFn("tab", t, subs[i], `t${i + 1}`)));
  if (page.modal) lines.push(subFn("modal", page.modal, subs[tabs.length], "md"));
  if (tabs.length) lines.push(`const sel = () => X.dataset.key != $tab && (end(T), ($tab = X.dataset.key), (T = { ${tabs.map((_, i) => `t${i + 1}`).join(", ")} }[$tab]()));`);
  const make = `widget(\`${tpl(own.html)}\`${handlers(own.ctl)})`;
  lines.push(page.modal ? `const pg = ${make};\nA.append(pg);` : `A.append(${make});`);
  lines.push(...own.binds, ...joins(own, ctx.shared));
  for (const f of page.fields) {
    if (f.every) lines.push(`every(${f.every}, () => (${[`$${f.name} = Math.min(${f.max}, $${f.name} + ${f.by})`, ...own.ups([["f", f.name]])].join(", ")}));`);
    if (f.feed) lines.push(`feed((i) => (${[`$${f.name}.push(i)`, ...own.ups([["f", f.name]])].join(", ")}));`);
  }
  if (tabs.length) lines.push("T = t1();");
  return { code: `const ${page.id} = () => {\n${indent(lines.join("\n"))}\n};`, own, subs };
}

function appFile(spec) {
  GL = Object.fromEntries(spec.global.map((f) => [f.name, f]));
  const byId = (id) => spec.pages.find((p) => p.id === id);

  // Pass 1: what is read and written where, and which pages keep a set of their own fields.
  const live = new Set(["user", "cart", "notices"]); // the fields some component reads
  const declared = new Set(live); // the fields some component reads or writes
  const shared = {};
  for (const page of spec.pages) {
    const a = analyse(page);
    shared[page.id] = a.shared;
    for (const c of [a.own, ...a.subs]) {
      for (const g of c.reads.g) (live.add(g), declared.add(g));
      for (const g of c.writes.g) declared.add(g);
    }
  }
  const liveList = spec.global.map((f) => f.name).filter((g) => live.has(g));
  const declList = spec.global.map((f) => f.name).filter((g) => declared.has(g));

  // Pass 2: the pages.
  const pages = spec.pages.map((page) => pageCode(page, { live, shared: shared[page.id] }));
  const hasFeed = spec.pages.some((p) => p.fields.some((f) => f.feed));

  // The shell: the nav bar of the pinned pages, the menu button and the three global fields.
  const pinned = spec.pinned;
  const k = pinned.length;
  const shellHtml = open(`<header data-key=shell data-role=shell><strong>${esc(spec.app)}</strong><nav data-role=nav>${pinned.map((id) => `<button data-key=${id} data-role=navLink>${esc(byId(id).title)}</button>`).join("")}<button data-role=menu>All pages</button></nav><p><span data-role=user>Signed in as </span> · <span data-role=cartCount>Cart: </span> · <span data-role=noticeCount></span></p></header>`);
  const shellBinds = [];
  let sat = 0;
  const sref = (i) => { const d = i - sat; sat = i; return d; };
  pinned.forEach((id, i) => shellBinds.push(`bind(${sref(2 + i)}, () => route == ${lit(id)} ? "page" : null, "ariaCurrent");`));
  shellBinds.push(`bind(${sref(2 + k)}, () => menu, "ariaExpanded");`);
  shellBinds.push(`text(${sref(4 + k)}, () => $user);`);
  shellBinds.push(`text(${sref(5 + k)}, () => $cart.length);`);
  shellBinds.push(`text(${sref(6 + k)}, () => $notices.length + " notices");`);
  const shell = `// The shell: it stays while pages come and go.
const shell = () => {
  A.append(widget(\`${tpl(shellHtml)}\`, ${[...pinned.map(() => "go"), "toggle"].join(", ")}));
  SB = B;
${indent(shellBinds.join("\n"))}
  join(r$user, r$cart, r$notices);
};

// The menu lists every page: it is built when opened and ends with navigation.
const menuList = () => {
  const n = widget(\`<nav data-role=menuList>\${TT.map((t, i) => \`<button data-key=p\${i + 1} data-role=menuLink>\${t}</button>\`).join("")}\`, ...TT.map(() => go));
  A.firstChild.after(n);
  return B;
};
const toggle = () => ((menu = !menu) ? (M0 = menuList()) : end(M0), up([SB]));

// Navigate: end every component but the shell (the page, its tab panel and modal, the menu) and
// mount the new page.
const go = (k = X.dataset.key) => {
  k == route ? menu && end(M0) : (leave(SB), (route = k), pages[k]());
  menu = false;
  up([SB]);
};`;

  const setters = liveList.map((g) => `  ${g}: (v) => ($${g} = v, up(r$${g})),`).join("\n");
  const initials = declList.map((g) => `$${g} = ${initial(GL[g], GL[g].initial)}`);
  const start = `const start = () => {
  ${initials.join(", ")};
  route = ${lit(spec.pages[0].id)};
  menu = false;
  shell();
  ${spec.pages[0].id}();
};`;
  const receive = `const receive = (m) => {
${hasFeed ? '  if (m.type == "pagePush") return m.page == route && Fd && Fd({ ...m.item });\n' : ""}  act(null, () => {
    if (m.type == "deepLink") go(m.route);
    else if (m.type == "notify") $notices.push({ ...m.item }), up(r$notices);
    else if (m.type == "serverSet") SET[m.field]?.(m.value);
    else if (m.type == "snapshot") for (const k in SET) SET[k](structuredClone(m.global[k]));
  });
};`;

  const body = `// The global state, and for each field some component reads, the lists of the mounted components
// that read it.
let ${declList.map((g) => `$${g}`).join(", ")};
const ${liveList.map((g) => `r$${g} = new Set()`).join(", ")};
// The shell's state: the route, whether the menu is open, the shell's list, the menu's list.
let route, menu, SB, M0;
// The pages' titles, for the menu.
const TT = [${spec.pages.map((p) => lit(esc(p.title))).join(", ")}];

${pages.map((p) => p.code).join("\n\n")}

${shell}

const pages = { ${spec.pages.map((p) => p.id).join(", ")} };

// What a server sets or replaces, by field: the new value, and the readers digested.
const SET = {
${setters}
};

${start}

${receive}
`;
  const names = ["A", "B", "X", "Fd", "act", "up", "widget", "bind", "text", "show", "list", "at", "end", "join", "every", "feed", "leave", "cleanup"]
    .filter((x) => new RegExp(`(^|[^\\w.$])${x}\\b`, "m").test(body.replace(/`[^`]*`/g, "")));
  // The scenario's own helpers are app code: the cycle op and adding an item.
  const code = body.replace(/`[^`]*`/g, "");
  const used = (x) => new RegExp(`(^|[^\\w.$])${x}\\(`, "m").test(code);
  const helpers = [
    used("nx") && "// The option after v (the first after the last).\nconst nx = (v, ...a) => a[(a.indexOf(v) + 1) % a.length];",
    used("add") && "// A new item gets the next id.\nconst add = (l, text, done) => l.push({ id: Math.max(0, ...l.map((i) => i.id)) + 1, text, done });",
  ].filter(Boolean);
  return `// Generated by scenarios/routed-app/digest.js. Do not edit.
import { app, ${names.join(", ")} } from "./runtime.js";
${helpers.length ? "\n" + helpers.join("\n") + "\n" : ""}
${body}
// One page at a time: \`start\` mounts the shell and the first page.
export default app(start, receive);
`;
}

export function emit(spec) {
  return {
    files: {
      ...templateFiles({ name: "routed-app", title: "Routed app", runtime: "runtime-routed.js" }),
      "src/app.js": appFile(spec),
    },
    style: {
      approach: "compiled dirty checking with mounting components: a page is a widget with its own binding list; an event digests the list it came from plus the lists of the mounted components that read what it wrote; navigation ends every component but the shell",
      components: "one function per page, written out in full from that page's description, with its tab panels and modal as functions inside it; calling one mounts it with fresh state; no shared factories, no data rows, no interpreter",
      state: "plain mutable variables: locals of the page's, tab's or modal's function (so they start fresh on each mount and are gone with it), module variables for global fields",
      lifetime: "a component is a binding list with its root node and its cleanups; ending it removes the node, empties the list, leaves every set it joined, clears its timer and drops its feed subscription; navigation ends every mounted component but the shell",
      globals: "each global field some component reads has a Set of the binding lists that read it (a component joins when it mounts); a handler or external event that writes it digests that set; fields nobody reads have no set",
      templates: "one static HTML string per page, tab panel and modal, in the function that mounts it (texts escaped at build time, no end tags at its end); nodes are found by their position in the template, once",
      routing: "in-app state: a route variable, a nav bar of the first pages and a menu built when opened; every link, nav and menu button shares one handler that reads the target's data-key",
      time: "one setInterval per mounted time-driven field, started when its component mounts and cleared when it ends",
      events: "one delegated click and input listener on the app element that calls the target's handler",
      build: "Vite production build, no plugin, hidden source maps",
    },
  };
}
