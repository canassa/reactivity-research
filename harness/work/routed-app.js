// The actions ./rr work performs on routed-app: one step each, on the first five pages, which the
// generator forces to carry the targets (spec.js FORCED, README "The first pages") and keeps the
// same at every size (prefix stability). The app starts on p1.
//
// Three kinds of work, all local (enforced on prototypes by ./rr check's locality rule):
//   - an event on the shown page, and external events while a page is shown (a global field the
//     page does not read must cost almost nothing; one it reads must update it);
//   - navigation: unmounting one page and mounting another must not grow with N;
//   - the app's own dispose and mount: only the shell and the shown page may be built.
// The "All pages" menu lists every page, so opening and closing it is global by nature.
//
// An action is { name, scope, step(state) → step }. `step` builds a script step (click, type,
// dispatch, clock, dispose, mount) from the reference state, which the runner advances with the
// reference `update` between actions. Actions run in this order; `setup: true` marks one that only
// prepares the next.

export function actions(spec, ref) {
  if (spec.pages.length < 5) throw new Error("routed-app work: needs at least 5 pages (p1 to p5 carry the actions' targets)");
  const [p1, p2, p3, p4, p5] = spec.pages;
  const t = targets(spec, ref);
  const click = (page, name, extra = {}, item) => ({ do: "click", target: ref.target(page.id, name, item), msg: { page: page.id, type: name, ...extra } });
  const type = (page, name, value) => ({ do: "type", target: ref.target(page.id, name), value, msg: { page: page.id, type: name, value } });
  const nav = (route) => ({ do: "click", target: ref.navTarget(route), msg: { type: "navigate", route } });
  const dispatch = (msg) => ({ do: "dispatch", msg });
  const tab = (page, id) => ({ do: "click", target: ref.tabTarget(page.id, id), msg: { page: page.id, type: "tab", tab: id } });

  return [
    // The first page, as mounted.
    { name: "p1: add to an int", scope: "local", step: () => click(p1, t.add.name) },
    { name: "p1: type a character", scope: "local", step: (s) => type(p1, t.text.name, s.page.fields[t.text.field[1]] + "k") },
    { name: "dispatch: serverSet a global the page does not read (currency)", scope: "local", step: (s) => dispatch(ref.serverSetMsg(spec, s, "currency", "work")) },
    { name: "dispatch: serverSet a global the page reads (balance)", scope: "local", step: (s) => dispatch(ref.serverSetMsg(spec, s, "balance", "work")) },
    { name: "dispatch: notify (the shell reads it)", scope: "local", step: (s) => dispatch(ref.notifyMsg(spec, s, "work")) },
    { name: "dispatch: pagePush to a page not shown", scope: "local", step: (s) => dispatch(ref.pagePushMsg(spec, s, p2.id, "work-hidden")) },
    // Navigation and the pages behind it.
    { name: "navigate: p1 → p2 (nav bar)", scope: "local", step: () => nav(p2.id) },
    { name: "p2: add to the cart (the shell reads it)", scope: "local", step: () => click(p2, t.cart.name) },
    { name: "dispatch: pagePush to the page shown", scope: "local", step: (s) => dispatch(ref.pagePushMsg(spec, s, p2.id, "work")) },
    { name: "navigate: p2 → p3 (nav bar)", scope: "local", step: () => nav(p3.id) },
    { name: "p3: select another tab", scope: "local", step: () => tab(p3, p3.tabs[1].id) },
    { name: "p3: select the first tab again", scope: "local", step: () => tab(p3, p3.tabs[0].id) },
    { name: "navigate: p3 → p4 (starts its timer)", scope: "local", step: () => nav(p4.id) },
    { name: "clock: one tick of the running timer", scope: "local", step: () => ({ do: "clock", msg: { type: "clock" } }) },
    { name: "navigate: p4 → p5 (deep link; stops the timer)", scope: "local", step: () => dispatch({ type: "deepLink", route: p5.id }) },
    { name: "p5: open the modal", scope: "local", step: () => click(p5, t.open.name) },
    { name: "p5: type in the modal", scope: "local", step: (s) => type(p5, t.modalText.name, s.page.modal[t.modalText.field[1]] + "k") },
    { name: "p5: close the modal", scope: "local", step: () => click(p5, t.close.name) },
    { name: "menu: open (lists every page)", scope: "global", step: () => ({ do: "click", target: ref.MENU_BUTTON, msg: { type: "menu" } }) },
    { name: "menu: close", scope: "global", step: () => ({ do: "click", target: ref.MENU_BUTTON, msg: { type: "menu" } }) },
    { name: "navigate: p5 → p1 (nav bar)", scope: "local", step: () => nav(p1.id) },
    { name: "dispatch: whole-global snapshot", scope: "local", step: (s) => dispatch({ type: "snapshot", global: ref.snapshot(spec, s, "work") }) },
    // The app's own lifetime: dispose what is shown, then mount the shell and p1 from scratch.
    { name: "app: dispose", scope: "local", step: () => ({ do: "dispose" }) },
    { name: "app: mount (shell and p1)", scope: "local", step: () => ({ do: "mount" }) },
  ];
}

// The messages the actions use, found on the forced pages (and shared with the bench actions).
export function targets(spec, ref) {
  const [p1, p2, , , p5] = spec.pages;
  const shown = (comp, name) => { const c = ref.controls(comp).get(name); return c && !c.inWhen ? c.node : null; };
  const find = (what, comp, pred) => {
    const m = comp.messages.find((x) => { const node = shown(comp, x.name); return node && pred(x, node); });
    if (!m) throw new Error(`routed-app work: no ${what} (the generator forces one)`);
    return m;
  };
  const isLocal = (ref1) => ref1[0] === "f";
  const drafts = (comp) => new Set(comp.messages.flatMap((m) => (m.ops || []).filter((op) => op[0] === "push").map((op) => op[2][1])));
  const add = find("add button on p1", p1, (m, node) => m.kind === "click" && m.ops.length === 1 && m.ops[0][0] === "add" && isLocal(m.ops[0][1]) && m.ops[0][2] > 0 && !node.disabled);
  const reset = find("reset button on p1", p1, (m) => m.kind === "click" && m.ops.length === 1 && m.ops[0][0] === "reset" && m.ops[0][1][1] === add.ops[0][1][1]);
  const text = find("text input on p1", p1, (m) => m.kind === "input" && isLocal(m.field) && ref.fieldOf(p1, m.field[1]).type === "text" && !drafts(p1).has(m.field[1]));
  const cart = find("add-to-cart button on p2", p2, (m, node) => m.kind === "click" && m.ops.length === 1 && m.ops[0][0] === "pushText" && m.ops[0][1][1] === "cart" && !node.disabled);
  const feed = ref.feedField(p2);
  const dismiss = find("feed dismiss on p2", p2, (m) => m.kind === "item" && m.op === "remove" && m.field[0] === "f" && m.field[1] === feed.name);
  if (!spec.pages[2].tabs || !spec.pages[3].fields.some((f) => f.every) || !p5.modal) throw new Error("routed-app work: p3 needs tabs, p4 a time-driven field, p5 a modal (the generator forces them)");
  const open = find("modal open button on p5", p5, (m) => m.kind === "open");
  const modalText = find("text input in p5's modal", p5.modal, (m) => m.kind === "input" && isLocal(m.field) && ref.fieldOf(p5.modal, m.field[1]).type === "text");
  const close = find("modal close button on p5", p5.modal, (m) => m.kind === "close");
  return { add, reset, text, cart, dismiss, open, modalText, close };
}
