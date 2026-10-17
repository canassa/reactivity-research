// routed-app as tea-local, a prototype strategy (frameworks/tea-local/README.md): what an ideal
// compiler would emit from a TEA source of an app of pages, with local message routing.
//
// Style (recorded in every generated app's rr.json):
// - Every component (the shell, a page, a tab panel, a modal) is an instance that owns its model
//   in a closure: a `component(sources, model, update, patch, cmds)` of the routed runtime
//   (`src/routed.js`). An event sends a real message to that instance (`send(tag, value)`), the
//   reducer arm for that tag runs, then the instance's binding list (`patch`) re-runs. No global
//   dispatch, dirty bits or dependency graph.
// - Pages map onto instances: each page is its own factory in the `pages` table, called by the
//   shell's patch when the route changes (a `slot`): it builds the page's DOM from its own static
//   template and makes its instance. On leave the slot destroys the instance, which gives back
//   what it started: its watches on the instances it reads, its timers and its children; the
//   slot removes the node. Page-local state therefore resets on remount, as the contract says.
// - A tab panel and a modal are instances too, made by their page's patch (a slot each) from the
//   page's model (`tab`, `modal`) and destroyed when it changes. They are factories nested in the
//   page's factory, the way a child component is written inside its parent.
// - Global state is one instance (`global`) that no DOM belongs to. Whoever reads it watches it:
//   the shell, and a page, tab or modal that reads a global field, for as long as it is mounted
//   (`sources`). A page that does not read global state does not watch it.
// - A message that is not about the component's own model is a command: a link sends the shell
//   `Go route`, a control that writes global state sends the global instance its message (a
//   generic arm per operation, in the order they are first used), a modal's confirm sends its
//   page a `Confirm…` message carrying the modal's values, then the page closes the modal. The
//   reducers stay pure; commands run before the arm, with the model the message was sent to.
// - Time-driven fields are a subscription by construction: `every(tag, ms)` starts one interval
//   when the component is made and its `destroy` clears it; the message is the field's own Tick.
// - External events: `serverSet` sends the global instance one of its first four messages,
//   `notify` its Notify, `snapshot` replaces its model, `deepLink` sends the shell Go, and
//   `pagePush` sends the page shown its Notify message (nothing when another page is shown).
// - The shell is a static template (nav bar of the pinned pages, three counters); the "All pages"
//   menu is built when opened and removed when closed.
// - Per instance, as in unique-components: a static template (trailing end tags left out) inserted
//   by `insertAdjacentHTML`, elements addressed by document order, tags 0, 1, 2, … for the
//   template's controls in document order (then each list row's controls), derived texts as template
//   literals, conditional content swapped with an empty text node, keyed lists through the
//   runtime's `list`, number inputs sending `valueAsNumber`.

import { templateFiles, runtimeFile } from "../../frameworks/tea-local/framework.js";

export const framework = "tea-local";

export const params = {};

const q = JSON.stringify;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const IDENT = /^[A-Za-z_$][\w$]*$/;
const key = (k) => (IDENT.test(k) ? k : q(k));

// A JavaScript literal for plain data.
function lit(v) {
  if (v === null || typeof v !== "object") return q(v);
  if (Array.isArray(v)) return `[${v.map(lit).join(", ")}]`;
  return `{ ${Object.entries(v).map(([k, x]) => `${key(k)}: ${lit(x)}`).join(", ")} }`;
}

const indent = (s, n = 2) => s.split("\n").map((l) => (l ? " ".repeat(n) + l : l)).join("\n");

// ---------------------------------------------------------------------------------------------
// Global state: the reducer arms of the global instance. The first five are the external events
// (serverSet's four fields, in the spec's order, and Notify); the others are added in the order
// the pages first use them.

const GLOBAL_ARMS = {
  setUser: "(g, value) => ({ ...g, user: value })",
  setCurrency: "(g, value) => ({ ...g, currency: value })",
  setBalance: "(g, value) => ({ ...g, balance: value })",
  setOnline: "(g, value) => ({ ...g, online: value })",
  notify: "(g, value) => ({ ...g, notices: [...g.notices, value] })",
  cartAdd: "(g, value) => ({ ...g, cart: [...g.cart, { id: nextId(g.cart), text: value }] })",
  cartRemove: "(g, value) => ({ ...g, cart: g.cart.filter((it) => it.id !== value) })",
  noticeRemove: "(g, value) => ({ ...g, notices: g.notices.filter((it) => it.id !== value) })",
  cartClear: "(g) => (g.cart.length ? { ...g, cart: [] } : g)",
  noticesClear: "(g) => (g.notices.length ? { ...g, notices: [] } : g)",
  addBalance: "(g, value) => ({ ...g, balance: Math.max(0, Math.min(9999, g.balance + value)) })",
};

function cycleArm(options) {
  const chain = options.slice(0, -1).map((o, i) => `g.currency === ${q(o)} ? ${q(options[i + 1])} : `).join("");
  return `(g) => ({ ...g, currency: ${chain}${q(options[0])} })`;
}

function globalRegistry(spec) {
  const arms = { ...GLOBAL_ARMS, cycleCurrency: cycleArm(spec.global.find((f) => f.name === "currency").options) };
  const order = ["setUser", "setCurrency", "setBalance", "setOnline", "notify"];
  return {
    tag(name) {
      if (!arms[name]) throw new Error(`no global arm ${name}`);
      let i = order.indexOf(name);
      if (i < 0) i = order.push(name) - 1;
      return i;
    },
    // The send of a global field being set to a value (input, select).
    set(field) {
      const i = ["user", "currency", "balance", "online"].indexOf(field);
      if (i < 0) throw new Error(`global ${field} is not settable`);
      return i;
    },
    table: () => order.map((name) => arms[name]),
  };
}

// ---------------------------------------------------------------------------------------------
// Expressions → JavaScript. A ref is `m` (the component's own model), `p` (the page's model, read
// from a tab) or `g` (the global model); composite expressions are parenthesised unless at the top.

const BINARY = { "==": "===", "!=": "!==", "<": "<", "<=": "<=", ">": ">", ">=": ">=", and: "&&", or: "||", "+": "+", "-": "-" };

const refCode = (ref, cx) => {
  const v = ref[0] === "f" ? "m" : ref[0];
  if (v === "p" && cx.kind !== "tab") throw new Error(`${cx.id}: only a tab reads the page's fields`);
  cx.reads[v] = true;
  return `${v}.${ref[1]}`;
};

function expr(e, cx, top = false) {
  const p = (s) => (top ? s : `(${s})`);
  switch (e[0]) {
    case "f": case "p": case "g": return refCode(e, cx);
    case "k": return q(e[1]);
    case "count": case "len": return `${expr(e[1], cx)}.length`;
    case "done": return `${expr(e[1], cx)}.filter((it) => it.done).length`;
    case "left": return `${expr(e[1], cx)}.filter((it) => !it.done).length`;
    case "has": return `${expr(e[1], cx)}.includes(${q(e[2])})`;
    case "not": return `!${expr(e[1], cx)}`;
    case "if": return p(`${expr(e[1], cx)} ? ${expr(e[2], cx)} : ${expr(e[3], cx)}`);
    default:
      if (BINARY[e[0]]) return p(`${expr(e[1], cx)} ${BINARY[e[0]]} ${expr(e[2], cx)}`);
  }
  throw new Error(`unknown expression ${q(e)}`);
}

const tpl = (s) => s.replace(/[`\\]|\$\{/g, (c) => "\\" + c);

// The value of a text: a string literal if static, a lone expression, or a template literal.
function textCode(parts, cx) {
  if (parts.every((x) => typeof x === "string")) return { code: q(parts.join("")), dynamic: false };
  if (parts.length === 1) return { code: expr(parts[0], cx, true), dynamic: true };
  const body = parts.map((x) => (typeof x === "string" ? tpl(x) : `\${${expr(x, cx, true)}}`)).join("");
  return { code: `\`${body}\``, dynamic: true };
}

// ---------------------------------------------------------------------------------------------
// The view: one static template per component, the patch lines (the binding list), the creation
// lines (list builders) and the controls in document order (they take the tags 0, 1, 2, …).

const esc = (s) => String(s).replace(/[&<]/g, (c) => (c === "&" ? "&amp;" : "&lt;"));
const attr = (v) => (/^[^\s"'=<>`]+$/.test(v) ? v : `"${String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`);
const attrs = (a) => Object.entries(a).map(([k, v]) => ` ${k}=${attr(v)}`).join("");
const trim = (html) => html.replace(/(<\/\w+>)+$/, "");

// The controls of a view in document order (what `wire` numbers), and the controls of each list
// row. A control is a message name, `>route` for a link or `#index` for a tab button.
function scan(nodes, page, out = { section: [], rows: [] }) {
  for (const n of nodes) {
    switch (n.el) {
      case "button": case "input": case "check": case "select": case "open": out.section.push(n.msg); break;
      case "link": out.section.push(">" + n.to); break;
      case "tabs": page.tabs.forEach((t, i) => out.section.push("#" + i)); break;
      case "list": out.rows.push([n.check, n.remove].filter(Boolean)); break;
      case "when": case "group": scan(n.children, page, out); break;
    }
  }
  return out;
}

function compileView(cx, nodes) {
  const tops = nodes.map((n) => compileNode(cx, n));
  for (const t of tops.flat()) if (t.cond) cx.patch.push(`place(${t.v}, ${t.cond});`);
}

function compileNode(cx, n) {
  const { comp, page } = cx;
  const msgOf = (name) => comp.messages.find((m) => m.name === name);
  const descOf = (ref) => (ref[0] === "g" ? cx.spec.global.find((f) => f.name === ref[1]) : (ref[0] === "p" ? page : comp).fields.find((f) => f.name === ref[1]));
  const open = (tag, a = {}) => {
    cx.html += `<${tag}${attrs(a)}>`;
    return `${cx.el}[${cx.index++}]`;
  };
  const close = (tag) => (cx.html += `</${tag}>`);
  const content = (v, parts) => {
    const { code, dynamic } = textCode(parts, cx);
    if (!dynamic) cx.html += esc(JSON.parse(code));
    else {
      cx.html += " ";
      cx.patch.push(`setText(${v}, ${code});`);
    }
  };
  const labelled = (label, inner) => {
    if (!label) return [{ v: inner() }];
    const l = open("label");
    cx.html += esc(label);
    inner();
    close("label");
    return [{ v: l }];
  };
  switch (n.el) {
    case "text": {
      const v = open(n.tag);
      content(v, n.parts);
      close(n.tag);
      return [{ v }];
    }
    case "button": {
      const v = open("button", { "data-role": n.msg });
      content(v, n.text);
      close("button");
      cx.ctl.push(n.msg);
      if (n.disabled) cx.patch.push(`setProp(${v}, ${expr(n.disabled, cx, true)}, "disabled");`);
      return [{ v }];
    }
    case "input": {
      const ref = msgOf(n.msg).field;
      const number = descOf(ref).type === "int";
      const out = labelled(n.label, () => {
        const v = open("input", number ? { type: "number", "data-role": n.msg }
          : { type: "text", "data-role": n.msg, ...(n.placeholder ? { placeholder: n.placeholder } : {}) });
        cx.ctl.push(n.msg);
        cx.patch.push(`setProp(${v}, ${refCode(ref, cx)}${number ? ', "valueAsNumber"' : ""});`);
        return v;
      });
      if (n.invalid) {
        const e = open("p", { "data-role": n.msg + "Error" });
        cx.html += esc(n.invalid.message);
        close("p");
        out.push({ v: e, cond: expr(n.invalid.when, cx, true) });
      }
      return out;
    }
    case "check": {
      const l = open("label");
      const v = open("input", { type: "checkbox", "data-role": n.msg });
      cx.html += esc(n.label);
      close("label");
      cx.ctl.push(n.msg);
      cx.patch.push(`setProp(${v}, ${refCode(msgOf(n.msg).field, cx)}, "checked");`);
      return [{ v: l }];
    }
    case "select": {
      const ref = msgOf(n.msg).field;
      const f = descOf(ref);
      return labelled(n.label, () => {
        const v = open("select", { "data-role": n.msg });
        for (const o of f.options) {
          open("option", { value: o });
          cx.html += esc(o);
          close("option");
        }
        close("select");
        cx.ctl.push(n.msg);
        cx.patch.push(`setProp(${v}, ${refCode(ref, cx)});`);
        return v;
      });
    }
    case "list": {
      const u = open(n.tag);
      close(n.tag);
      const l = cx.name("l");
      const row = `<li${attrs({ "data-role": n.field[1] + "Item" })}>`
        + (n.check ? `<input${attrs({ type: "checkbox", "data-role": n.check })}>` : "")
        + "<span> </span>"
        + (n.remove ? `<button${attrs({ "data-role": n.remove })}>${esc(n.removeText)}</button>` : "")
        + "</li>";
      const first = cx.rowTag;
      cx.rowTag += [n.check, n.remove].filter(Boolean).length;
      cx.rowCtl.push([n.check, n.remove].filter(Boolean));
      cx.create.push(`const ${l} = list(${u}, row(${q(trim(row))}, ${cx.self}, ${first}), (r, item) => {`);
      if (n.check) cx.create.push(`  setProp(r[1], item.done, "checked");`);
      cx.create.push(`  setText(r[${n.check ? 2 : 1}], item.text);`, `});`);
      cx.patch.push(`${l}(${refCode(n.field, cx)});`);
      return [{ v: u }];
    }
    case "when": case "group": {
      const v = open(n.tag);
      compileView(cx, n.children);
      close(n.tag);
      return n.el === "when" ? [{ v, cond: expr(n.cond, cx, true) }] : [{ v }];
    }
    case "link": {
      const v = open("button", { "data-key": n.to, "data-role": "pageLink" });
      cx.html += esc(n.text);
      close("button");
      cx.ctl.push(">" + n.to);
      return [{ v }];
    }
    case "open": {
      const v = open("button", { "data-role": n.msg });
      cx.html += esc(n.text);
      close("button");
      cx.ctl.push(n.msg);
      return [{ v }];
    }
    case "tabs": {
      const v = open("nav", { "data-role": "tabs" });
      page.tabs.forEach((t, i) => {
        const b = open("button", { "data-key": t.id, "data-role": "tab", "aria-selected": i === 0 ? "true" : "false" });
        cx.html += esc(t.label);
        close("button");
        cx.ctl.push("#" + i);
        cx.reads.m = true;
        cx.patch.push(`setProp(${b}, String(m.tab === ${i}), "ariaSelected");`);
      });
      close("nav");
      cx.tabsNav = v;
      return [{ v }];
    }
  }
  throw new Error(`unknown view node ${n.el}`);
}

// ---------------------------------------------------------------------------------------------
// The reducer: one arm per message that changes the component's own model, written out from its
// kind and ops; a command for what concerns another instance.

function opAssign(comp, op, s) {
  const [kind, ref] = op;
  const name = ref[1];
  const f = comp.fields.find((x) => x.name === name);
  const cur = `${s}.${name}`;
  const item = (text) => `{ id: nextId(${cur}), text: ${text}${f.checkable ? ", done: false" : ""} }`;
  switch (kind) {
    case "add": {
      const sum = op[2] < 0 ? `${cur} - ${-op[2]}` : `${cur} + ${op[2]}`;
      return `Math.max(${f.min}, Math.min(${f.max}, ${sum}))`;
    }
    case "set": return q(op[2]);
    case "toggle": return `!${cur}`;
    case "reset": return q(f.initial);
    case "cycle":
      return `(${f.options.slice(0, -1).map((o, i) => `${cur} === ${q(o)} ? ${q(f.options[i + 1])} : `).join("")}${q(f.options[0])})`;
    case "pushText": return `[...${cur}, ${item(q(op[2]))}]`;
    case "pop": return `${cur}.slice(0, -1)`;
    case "shift": return `${cur}.slice(1)`;
    case "clear": return "[]";
    case "clearDone": return `${cur}.filter((it) => !it.done)`;
  }
  throw new Error(`unknown op ${kind}`);
}

function pushStep(comp, op, s) {
  const list = op[1][1];
  const draft = op[2][1];
  const f = comp.fields.find((x) => x.name === list);
  const item = `{ id: nextId(${s}.${list}), text${f.checkable ? ", done: false" : ""} }`;
  return { text: `${s}.${draft}.trim()`, next: `{ ...${s}, ${list}: [...${s}.${list}, ${item}], ${draft}: "" }` };
}

// The arm of own ops.
function ownClick(comp, ops) {
  const targets = ops.map((op) => op[1][1]);
  if (!ops.some((op) => op[0] === "push") && new Set(targets).size === targets.length) {
    return `{ ...m, ${ops.map((op) => `${op[1][1]}: ${opAssign(comp, op, "m")}`).join(", ")} }`;
  }
  if (ops.length === 1) {
    const { text, next } = pushStep(comp, ops[0], "m");
    return `{\n  const text = ${text};\n  return text ? ${next} : m;\n}`;
  }
  const body = ops.map((op) => {
    if (op[0] !== "push") return `  n = { ...n, ${op[1][1]}: ${opAssign(comp, op, "n")} };`;
    const { text, next } = pushStep(comp, op, "n");
    return `  {\n    const text = ${text};\n    if (text) n = ${next};\n  }`;
  });
  return `{\n  let n = m;\n${body.join("\n")}\n  return n;\n}`;
}

const arrow = (params, code) => (code.startsWith("{") && code.includes("\n") ? `(${params}) => ${code}` : `(${params}) => (${code})`);

// The sends that write global state, for the ops on a `g` ref.
function globalSend(cx, op) {
  const name = op[1][1];
  const send = (arm, arg) => `global.send(${cx.G.tag(arm)}${arg === undefined ? "" : ", " + arg})`;
  switch (`${op[0]} ${name}`) {
    case "set user": return `global.send(${cx.G.set("user")}, ${q(op[2])})`;
    case "pushText cart": return send("cartAdd", q(op[2]));
    case "clear cart": return send("cartClear");
    case "clear notices": return send("noticesClear");
    case "cycle currency": return send("cycleCurrency");
    case "add balance": return send("addBalance", op[2]);
  }
  throw new Error(`${cx.id}: unsupported global op ${q(op)}`);
}

// The arm and the command of one message: { arm, cmd }, each a source string or undefined.
function message(cx, m) {
  const { comp } = cx;
  switch (m.kind) {
    case "input": case "select": {
      if (m.field[0] === "g") return { cmd: `(m, value) => global.send(${cx.G.set(m.field[1])}, value)` };
      const f = comp.fields.find((x) => x.name === m.field[1]);
      if (f.type === "int") return { arm: arrow("m, value", `Number.isInteger(value) && value >= ${f.min} && value <= ${f.max} ? { ...m, ${f.name}: value } : m`) };
      return { arm: arrow("m, value", `{ ...m, ${f.name}: value }`) };
    }
    case "check": return { arm: arrow("m", `{ ...m, ${m.field[1]}: !m.${m.field[1]} }`) };
    case "item": {
      const name = m.field[1];
      if (m.field[0] === "g") return { cmd: `(m, value) => global.send(${cx.G.tag(name === "cart" ? "cartRemove" : "noticeRemove")}, value)` };
      return { arm: arrow("m, value", m.op === "remove"
        ? `{ ...m, ${name}: m.${name}.filter((it) => it.id !== value) }`
        : `{ ...m, ${name}: m.${name}.map((it) => (it.id === value ? { ...it, done: !it.done } : it)) }`) };
    }
    case "click": {
      const own = m.ops.filter((op) => op[1][0] === "f");
      const sends = m.ops.filter((op) => op[1][0] === "g").map((op) => globalSend(cx, op));
      if (m.ops.some((op) => op[1][0] === "p")) throw new Error(`${cx.id}: ${m.name}: only a modal's confirm writes the page`);
      return {
        arm: own.length ? arrow("m", ownClick(comp, own)) : undefined,
        cmd: sends.length ? (sends.length === 1 ? `() => ${sends[0]}` : `() => {\n${sends.map((s) => "  " + s + ";").join("\n")}\n}`) : undefined,
      };
    }
    case "open": return { arm: arrow("m", `{ ...m, modal: true, mid: m.mid + 1 }`) };
    case "close": return { cmd: `() => self.send(${cx.pageOwn.close()})` };
    case "confirm": {
      const sends = m.ops.filter((op) => op[1][0] === "g").map((op) => globalSend(cx, op));
      const ops = m.ops.filter((op) => op[1][0] === "p");
      if (m.ops.some((op) => op[1][0] === "f")) throw new Error(`${cx.id}: ${m.name}: a confirm writes the page or global state`);
      let send;
      if (!ops.length) send = `self.send(${cx.pageOwn.close()})`;
      else {
        const vars = ops.length === 1 ? ["value"] : ops.map((_, i) => "abcd"[i]);
        const pageComp = cx.page;
        let push = false;
        const assigns = ops.map((op, i) => {
          const name = op[1][1];
          if (op[0] === "copy") return `${name}: ${vars[i]}`;
          if (op[0] !== "push") throw new Error(`${cx.id}: unsupported confirm op ${q(op)}`);
          push = true;
          const f = pageComp.fields.find((x) => x.name === name);
          return `${name}: text ? [...m.${name}, { id: nextId(m.${name}), text${f.checkable ? ", done: false" : ""} }] : m.${name}`;
        });
        const params = ops.length === 1 ? "m, value" : `m, [${vars.join(", ")}]`;
        let arm;
        if (push) {
          const i = ops.findIndex((op) => op[0] === "push");
          arm = `(${params}) => {\n  const text = ${vars[i]}.trim();\n  return { ...m, modal: false, ${assigns.join(", ")} };\n}`;
        } else arm = `(${params}) => ({ ...m, modal: false, ${assigns.join(", ")} })`;
        const payload = ops.map((op) => `m.${op[2][1]}`);
        send = `self.send(${cx.pageOwn.add("Confirm" + cap(m.name), arm)}, ${ops.length === 1 ? payload[0] : `[${payload.join(", ")}]`})`;
      }
      const all = [...sends, send];
      return { cmd: `(m) => {\n${all.map((s) => "  " + s + ";").join("\n")}\n}` };
    }
  }
  throw new Error(`unknown message kind ${m.kind}`);
}

// ---------------------------------------------------------------------------------------------
// One component (a page, a tab panel or a modal) as the lines of its factory.

// The messages a component takes that no control sends (a Tick, a Notify, and for a page the
// ones its modal sends it), numbered after the controls' tags.
function newOwn(sc) {
  const own = {
    base: sc.section.length + sc.rows.flat().length, arms: [], names: [],
    add(name, arm) {
      let i = own.arms.indexOf(arm);
      if (i < 0) {
        i = own.arms.push(arm) - 1;
        own.names.push(name);
      }
      return own.base + i;
    },
    close: () => own.add("CloseModal", "(m) => ({ ...m, modal: false })"),
  };
  return own;
}

function table(arms, length) {
  const lines = [];
  for (let i = 0; i < length; i++) lines.push(arms[i] ? indent(arms[i] + ",", 4) : "    ,");
  while (lines.length && lines[lines.length - 1] === "    ,") lines.pop();
  return `[\n${lines.join("\n")}\n  ]`;
}

function compileComponent(env, kind, comp, parent) {
  const { spec, G } = env;
  const page = kind === "page" ? comp : parent.comp;
  const sc = scan(comp.view, page);
  const own = newOwn(sc);
  const cx = {
    spec, G, page, comp, kind, id: kind === "page" ? comp.id : `${page.id}/${kind === "tab" ? comp.id : "modal"}`,
    self: kind === "page" ? "self" : "me", el: kind === "page" ? "e" : "t",
    pageOwn: kind === "page" ? own : parent.own,
    html: "", index: kind === "tab" ? 1 : 2, create: [], patch: [], ctl: [], rowCtl: [], rowTag: sc.section.length,
    reads: {}, counts: {},
    name(prefix) { this.counts[prefix] = (this.counts[prefix] ?? 0) + 1; return prefix + this.counts[prefix]; },
  };
  compileView(cx, comp.view);
  if (JSON.stringify(cx.ctl) !== JSON.stringify(sc.section)) throw new Error(`${cx.id}: controls out of order`);
  const tags = new Map();
  sc.section.forEach((c, i) => tags.set(c, i));
  let next = sc.section.length;
  for (const row of sc.rows) for (const c of row) tags.set(c, next++);
  if (tags.size !== next) throw new Error(`${cx.id}: a message sent by two controls`);

  // Messages with a control: an arm for the component's own model, a command for the rest.
  const arms = [];
  const cmds = {};
  const names = [];
  for (const m of comp.messages) {
    const tag = tags.get(m.name);
    if (tag === undefined) throw new Error(`${cx.id}: message ${m.name} has no control`);
    const { arm, cmd } = message(cx, m);
    if (arm) arms[tag] = arm;
    if (cmd) cmds[tag] = cmd;
    names[tag] = cap(m.name);
  }
  if (kind === "page") {
    sc.section.forEach((c, i) => {
      if (c[0] === ">") {
        cmds[i] = `() => shell.send(${env.go}, ${q(c.slice(1))})`;
        names[i] = "Go " + c.slice(1);
      } else if (c[0] === "#") {
        const k = +c.slice(1);
        arms[i] = arrow("m", `m.tab === ${k} ? m : { ...m, tab: ${k}, tk: m.tk + 1 }`);
        names[i] = "Tab" + (k + 1);
      }
    });
  }

  // The page's children, compiled now: they add messages to the page.
  const body = [];
  if (kind === "page") {
    const me = { comp, own, cx };
    if (comp.tabs) {
      cx.reads.m = true;
      cx.patch.push(`panel(m.tk, () => tabs[m.tab]());`);
    }
    if (comp.modal) {
      cx.reads.m = true;
      cx.patch.push(`dialog(m.modal && m.mid, modal);`);
    }
    if (comp.tabs) {
      const tabs = comp.tabs.map((t) => indent(`() => {\n${indent(compileComponent(env, "tab", t, me))}\n},`));
      body.push(`const panel = slot(self);`, `const tabs = [\n${tabs.join("\n")}\n];`);
    }
    if (comp.modal) body.push(`const dialog = slot(self);`, `const modal = () => {\n${indent(compileComponent(env, "modal", comp.modal, me))}\n};`);
  }

  // The time-driven field's Tick and the feed's Notify.
  const timed = comp.fields.find((f) => f.every);
  const feed = comp.fields.find((f) => f.feed);
  const tickTag = timed && own.add("Tick", arrow("m", `m.${timed.name} < ${timed.max} ? { ...m, ${timed.name}: Math.min(${timed.max}, m.${timed.name} + ${timed.by}) } : m`));
  const notifyTag = feed && own.add("Notify Item", arrow("m, value", `{ ...m, ${feed.name}: [...m.${feed.name}, value] }`));
  own.arms.forEach((a, i) => (arms[own.base + i] = a));
  names.push(...own.names);

  const sources = [];
  if (cx.reads.p) sources.push("self");
  if (cx.reads.g) sources.push("global");
  const decl = [];
  if (cx.reads.m) decl.push(`m = ${cx.self}.m`);
  if (cx.reads.p) decl.push(`p = self.m`);
  if (cx.reads.g) decl.push(`g = global.m`);

  const fields = Object.fromEntries(comp.fields.map((f) => [f.name, f.initial]));
  if (kind === "page" && ["tab", "tk", "modal", "mid"].some((k) => k in fields)) throw new Error(`${cx.id}: a field named like the page's own keys`);
  // `tk` and `mid` count tab changes and modal opens: a slot's key, so a change that comes back
  // to where it was within one task (tab A to B to A, a modal closed and opened) still remounts.
  const init = kind === "page" ? { ...fields, ...(comp.tabs ? { tab: 0, tk: 0 } : {}), ...(comp.modal ? { modal: false, mid: 0 } : {}) } : fields;
  // A page with a feed also starts with the items pushed to it before it mounted (see receive).
  const feedField = kind === "page" && comp.fields.find((f) => f.feed);
  if (feedField) init[feedField.name] = "@@pushes@@";
  const initCode = feedField ? lit(init).replace('"@@pushes@@"', `[...${lit(feedField.initial)}, ...shell.m.pushes]`) : lit(init);

  const root = kind === "page" ? `<main data-key=${comp.id} data-role=page><h1>${esc(comp.title)}</h1>`
    : kind === "tab" ? `<section data-key=${comp.id} data-role=panel>`
      : `<aside data-key=modal data-role=dialog><h2>${esc(comp.title)}</h2>`;
  const host = kind === "page" ? `app, "beforeend"` : kind === "tab" ? `${parent.cx.tabsNav}, "afterend"` : `e[0], "beforeend"`;
  const cmdKeys = Object.keys(cmds);
  const label = kind === "page" ? `${comp.id}: ${comp.title}` : kind === "tab" ? `${comp.id}: ${comp.label}` : `modal: ${comp.title}`;

  const lines = [`// ${label}`, `const patch = () => {`];
  if (decl.length) lines.push(`  const ${decl.join(", ")};`);
  lines.push(...cx.patch.map((l) => "  " + l), `};`);
  lines.push(`// type Msg = ${Array.from({ length: next + own.arms.length }, (_, i) => names[i] ?? `Msg${i}`).join(" | ")}`);
  lines.push(`const ${cx.self} = component([${sources.join(", ")}], ${initCode}, ${table(arms, next + own.arms.length)}, patch${cmdKeys.length ? `, {\n${cmdKeys.map((k) => indent(`${k}: ${cmds[k]},`, 4)).join("\n")}\n  }` : ""});`);
  // A message to an instance that the model has already replaced (its slot's key moved on, but the
  // flush that destroys it has not run) does nothing: its node is as good as gone.
  if (kind === "page") lines.push(`const gen = shell.m.gen;`, `self.stale = () => shell.m.gen !== gen;`);
  else if (kind === "tab") lines.push(`const tk = self.m.tk;`, `me.stale = () => self.stale() || self.m.tk !== tk;`);
  else lines.push(`const mid = self.m.mid;`, `me.stale = () => self.stale() || self.m.mid !== mid || !self.m.modal;`);
  lines.push(`const ${cx.el} = frame(${host}, ${q(trim(root + cx.html))}, ${cx.self});`);
  lines.push(...cx.create, ...body);
  if (timed) lines.push(`${cx.self}.every(${tickTag}, ${timed.every});`);
  if (feed) lines.push(`${cx.self}.notify = ${notifyTag}; // the tag of Notify, sent by the app`);
  lines.push(`return ${cx.self};`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------

const FRAME_FILE = `import { wire } from "./routed.js";

// A property write, skipped if unchanged: a form control's value, unless \`key\` names another.
export function setProp(node, value, key = "value") {
  if (node[key] !== value) node[key] = value;
}

// A component's root, inserted at \`where\` of \`host\` from its markup, its controls wired to the
// messages 0, 1, 2, … (see \`wire\`). Returns the template's elements in document order.
export function frame(host, where, html, self) {
  host.insertAdjacentHTML(where, html);
  self.root = where === "afterend" ? host.nextElementSibling : host.lastElementChild;
  return wire(self.root, self, 0);
}

// Conditional content, built in the template: while hidden, an empty text node holds its place
// (and takes it back when shown), so its siblings are never touched.
export function place(node, shown) {
  if (!shown) node.replaceWith((node.mark ??= new Text()));
  else node.mark?.replaceWith(node);
}

// A list row from its template (parsed once): each new row is a clone, its controls wired to
// the messages \`first\`, … with the item's id (see \`wire\`). Returns its elements, in document
// order (the row first).
export function row(html, self, first) {
  const t = document.createElement("template");
  t.innerHTML = html;
  return (item) => wire(t.content.firstChild.cloneNode(true), self, first, item.id);
}

export const nextId = (items) => items.reduce((max, item) => Math.max(max, item.id), 0) + 1;

// The "All pages" menu, built when it opens: a button for every page, one click listener on
// the list sending message \`tag\` with the page's id.
export function menuList(header, self, tag, titles) {
  header.insertAdjacentHTML("afterend", "<nav data-role=menuList>" + titles.map((title, i) => \`<button data-key=p\${i + 1} data-role=menuLink>\${title}</button>\`).join(""));
  const list = header.nextElementSibling;
  list.addEventListener("click", (event) => {
    const id = event.target.dataset.key;
    if (id) self.send(tag, id);
  });
  return list;
}
`;

export function emit(spec) {
  if (spec.pages.some((p, i) => p.id !== `p${i + 1}`)) throw new Error("page ids are not p1, p2, … in order");
  const G = globalRegistry(spec);
  const K = spec.pinned.length;
  const env = { spec, G, go: K + 1 };
  const pages = spec.pages.map((p) => indent(`(app) => {\n${indent(compileComponent(env, "page", p))}\n},`));
  const gInit = spec.initialState.global;

  // The shell: the nav bar of the pinned pages, the three counters, the menu and the page slot.
  const titles = spec.pages.map((p) => esc(p.title));
  const shellHtml = `<header data-key=shell data-role=shell><strong>${esc(spec.app)}</strong><nav data-role=nav>`
    + spec.pinned.map((id) => `<button data-key=${id} data-role=navLink>${esc(spec.pages.find((p) => p.id === id).title)}</button>`).join("")
    + `<button data-role=menu aria-expanded=false>All pages</button></nav><p><span data-role=user> </span> · <span data-role=cartCount> </span> · <span data-role=noticeCount> </span>`;
  const navArms = spec.pinned.map((id) => `    (m) => go(m, ${q(id)}),`);
  const shell = `
  // The shell. type Msg = ${spec.pinned.map((id) => "Go " + id).join(" | ")} | Menu | Go Route
  // \`gen\` counts route changes: the page slot's key, so a route left and returned to within one
  // task still remounts. \`pushes\` holds the items pagePush sent to the route before its page
  // mounted; the page starts with them.
  const go = (m, route) => (m.route === route ? (m.menu ? { ...m, menu: false } : m) : { route, menu: false, gen: m.gen + 1, pushes: [] });
  const patch = () => {
    const m = self.m, g = global.m;
${spec.pinned.map((id, i) => `    setProp(e[${3 + i}], m.route === ${q(id)} ? "page" : null, "ariaCurrent");`).join("\n")}
    setProp(e[${3 + K}], String(m.menu), "ariaExpanded");
    if (m.menu) menu ??= menuList(e[0], self, ${K + 1}, titles);
    else if (menu) (menu.remove(), (menu = null));
    setText(e[${5 + K}], \`Signed in as \${g.user}\`);
    setText(e[${6 + K}], \`Cart: \${g.cart.length}\`);
    setText(e[${7 + K}], \`\${g.notices.length} notices\`);
    route(m.gen, () => pages[m.route.slice(1) - 1](app));
  };
  let menu;
  const self = (shell = component([global], { route: ${q(spec.initialState.route)}, menu: false, gen: 0, pushes: [] }, [
${navArms.join("\n")}
    (m) => ({ ...m, menu: !m.menu }),
    go,
    (m, item) => ({ ...m, pushes: [...m.pushes, item] }),
  ], patch));
  const e = frame(app, "beforeend", ${q(shellHtml)}, self);
  const route = slot(self);`;

  const code = pages.join("\n") + shell + G.table().join("\n");
  const used = (names) => names.filter((h) => new RegExp(`\\b${h}\\(`).test(code));
  const files = {
    ...templateFiles({ name: "routed-app", title: "Routed app" }),
    "src/routed.js": runtimeFile("routed.js"),
    "src/frame.js": FRAME_FILE,
  };
  files["src/app.js"] = `import { ${used(["setText", "list"]).join(", ")} } from "./runtime.js";
import { component, slot } from "./routed.js";
import { ${used(["frame", "place", "row", "menuList", "setProp", "nextId"]).join(", ")} } from "./frame.js";

// The two instances every page reads or writes: the global state (no DOM of its own) and the
// shell. They are made when the app mounts.
let global, shell;

// The titles of the pages, for the "All pages" menu.
const titles = ${lit(titles)};

// The pages, each its own factory: it builds the page's DOM and makes its instance, which the
// shell's slot destroys when the route changes.
const pages = [
${pages.join("\n")}
];

export function App(root) {
  root.insertAdjacentHTML("beforeend", "<div data-role=app>");
  const app = root.lastChild;
  global = component([], ${lit(gInit)}, [
${G.table().map((a) => indent(a + ",", 4)).join("\n")}
  ]);
${shell}

  const item = ({ id, text }) => ({ id, text });
  return {
    // External events, routed to the instances they concern.
    receive(msg) {
      switch (msg.type) {
        case "deepLink":
          self.send(${K + 1}, msg.route);
          break;
        case "serverSet":
          global.send(["user", "currency", "balance", "online"].indexOf(msg.field), msg.value);
          break;
        case "notify":
          global.send(4, item(msg.item));
          break;
        case "pagePush":
          // Whether the page is shown is the shell's model now, not the DOM: a deepLink sent
          // earlier in the same task already counts. The page mounted for that model gets the
          // item at once; one that is still to mount (its slot runs in the next flush) finds it
          // in \`pushes\`.
          if (self.m.route === msg.page) {
            if (route.key === self.m.gen) route.c.send(route.c.notify, item(msg.item));
            else self.send(${K + 2}, item(msg.item));
          }
          break;
        case "snapshot": {
          // Copied: the message's objects are not the app's to keep.
          const g = msg.global;
          global.set({ user: g.user, cart: g.cart.map(item), notices: g.notices.map(item), currency: g.currency, balance: g.balance, online: g.online });
          break;
        }
      }
    },
    dispose() {
      self.destroy();
      global.destroy();
      app.remove();
      global = shell = undefined;
    },
  };
}
`;
  return {
    files,
    style: {
      components: "the shell, every page, every tab panel and every modal is a component instance (src/routed.js) with its model in a closure, its reducer (a jump table by message tag, one arm per message, written out from its kind and ops), its own static template and binding list; pages are factories in a table, tab panels and modals factories nested in their page's, the way a child component is written inside its parent",
      lifetime: "the shell's patch calls the page slot with the route, the page's patch calls a slot with the tab and another with the modal flag: a new key destroys the child instance (unwatches the instances it reads, clears its timers, destroys its own slots) and removes its node, then makes the next; page, tab and modal state therefore start fresh each time, and only the shell and the page shown exist",
      globalState: "one instance with no DOM; the shell and every mounted component that reads a global field watch it; writes are messages to it (a generic arm per operation, numbered in order of first use, after serverSet's four and Notify)",
      crossInstance: "commands run before the reducer arm: a link sends the shell Go, a control that writes global state sends the global instance its message, a modal's confirm sends its page a Confirm message carrying the modal's values (the page closes the modal); reducers stay pure",
      time: "a time-driven field is one setInterval started when its component is made and cleared by its destroy; its message is its own Tick",
      externalEvents: "deepLink sends the shell Go; serverSet, notify send the global instance its messages and snapshot replaces its model; pagePush sends the page shown its Notify (and nothing when another page is shown)",
      lists: "runtime keyed list by item.id: patch changed rows, one forward placement pass when order or membership changes; the global lists are bound the same way where a page shows them",
      dom: "one static template per component (trailing end tags left out) inserted by insertAdjacentHTML at its place (a page at the end of the app, a panel after its tab bar, a modal at the end of its page), elements addressed by document order; one template per list row, cloned per new item; the menu is built when opened",
      conditionals: "node in the template; while hidden, an empty text node holds its place",
      events: "tags 0, 1, 2, … for the template's controls in document order (then each list row's), attached by position by the runtime's wire; messages are sent as send(tag, value); number inputs send valueAsNumber and the reducer takes integers within range only",
      build: "Vite production build, no framework plugin, hidden source maps",
    },
  };
}
