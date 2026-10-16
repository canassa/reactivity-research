// The events ./rr bench times on routed-app: ./rr work's actions (harness/work/routed-app.js) on
// the same forced pages, made repeatable as do/undo pairs. See harness/bench/shared-components.js
// for what a bench action is.
//
// Every action first brings the app to the page it needs with an untimed deep link. Undo:
//   add to an int        repeated; untimed reset (p1's reset button) before it would pass the max
//   type a character     then delete it (one Backspace)
//   serverSet            to another value and back
//   notify, add to cart  repeated; untimed reset (a snapshot of the global state with the list put
//                        back) after 8 reps
//   pagePush (shown)     then dismiss the pushed entry      pagePush (not shown): changes nothing
//   navigate             there and back (p1 ↔ p2, and p3 ↔ p4, which starts and stops p4's timer)
//   tabs, modal, menu    select another tab and back; open and close; open and close
//   snapshot             global states A and B, alternated
// Not timed here: the clock (bench pages have no virtual clock, so p4's interval runs in real time,
// once a second at most) and the app's mount, which ./rr bench's startup loads already time.

import { targets } from "../work/routed-app.js";

export function benchActions(spec, ref) {
  const [p1, p2, p3, p4, p5] = spec.pages;
  const t = targets(spec, ref);
  const click = (page, name, extra = {}, item) => ({ do: "click", target: ref.target(page.id, name, item), msg: { page: page.id, type: name, ...extra } });
  const type = (page, name, value) => ({ do: "type", target: ref.target(page.id, name), value, msg: { page: page.id, type: name, value } });
  const nav = (route) => () => ({ do: "click", target: ref.navTarget(route), msg: { type: "navigate", route } });
  const dispatch = (msg) => ({ do: "dispatch", msg });
  const at = (page, more = () => []) => (s) => [...(s.route === page.id ? [] : [dispatch({ type: "deepLink", route: page.id })]), ...more(s)];
  const tab = (id) => () => ({ do: "click", target: ref.tabTarget(p3.id, id), msg: { page: p3.id, type: "tab", tab: id } });
  const menu = () => ({ do: "click", target: ref.MENU_BUTTON, msg: { type: "menu" } });
  // A global list put back to its length in s0, through a snapshot (untimed), every 8 reps.
  const restoreList = (name) => (s, s0) => (s.global[name].length - s0.global[name].length >= 8 ? dispatch({ type: "snapshot", global: { ...s.global, [name]: s0.global[name] } }) : null);
  const serverPair = (field) => (s0) => {
    const a = ref.serverSetMsg(spec, s0, field, "bench-a");
    return [{ name: `dispatch: serverSet ${field}`, step: () => dispatch(a) }, { name: `dispatch: serverSet ${field} back`, step: () => dispatch({ ...a, value: s0.global[field] }) }];
  };
  const addField = t.add.ops[0][1][1], addBy = t.add.ops[0][2], addMax = ref.fieldOf(p1, addField).max;

  return [
    { name: "p1: add to an int", scope: "local", setup: at(p1),
      halves: () => [{ name: "p1: add to an int", step: () => click(p1, t.add.name) }],
      reset: (s) => (s.page.fields[addField] + addBy > addMax ? click(p1, t.reset.name) : null) },
    { name: "p1: type a character", scope: "local", setup: at(p1), halves: (s0) => {
      const was = s0.page.fields[t.text.field[1]];
      return [{ name: "p1: type a character", step: () => type(p1, t.text.name, was + "k") }, { name: "p1: delete it", step: () => type(p1, t.text.name, was) }];
    } },
    { name: "dispatch: serverSet a global the page does not read (currency)", scope: "local", setup: at(p1), halves: serverPair("currency") },
    { name: "dispatch: serverSet a global the page reads (balance)", scope: "local", setup: at(p1), halves: serverPair("balance") },
    { name: "dispatch: notify (the shell reads it)", scope: "local", setup: at(p1),
      halves: () => [{ name: "dispatch: notify", step: (s) => dispatch(ref.notifyMsg(spec, s, "bench")) }], reset: restoreList("notices") },
    { name: "dispatch: pagePush to a page not shown", scope: "local", setup: at(p1),
      halves: () => [{ name: "dispatch: pagePush to a page not shown", step: (s) => dispatch(ref.pagePushMsg(spec, s, p2.id, "bench")) }] },
    { name: "navigate: p1 ↔ p2 (nav bar)", scope: "local", setup: at(p1),
      halves: () => [{ name: "navigate: p1 → p2", step: nav(p2.id) }, { name: "navigate: p2 → p1", step: nav(p1.id) }] },
    { name: "p2: add to the cart (the shell reads it)", scope: "local", setup: at(p2),
      halves: () => [{ name: "p2: add to the cart", step: () => click(p2, t.cart.name) }], reset: restoreList("cart") },
    { name: "dispatch: pagePush to the page shown", scope: "local", setup: at(p2), halves: () => [
      { name: "dispatch: pagePush to the page shown", step: (s) => dispatch(ref.pagePushMsg(spec, s, p2.id, "bench")) },
      { name: "p2: dismiss the pushed entry", step: (s) => click(p2, t.dismiss.name, { id: s.page.fields[t.dismiss.field[1]].at(-1).id }, s.page.fields[t.dismiss.field[1]].at(-1).id) },
    ] },
    { name: "p3: select a tab", scope: "local", setup: at(p3),
      halves: () => [{ name: "p3: select another tab", step: tab(p3.tabs[1].id) }, { name: "p3: select the first tab again", step: tab(p3.tabs[0].id) }] },
    { name: "navigate: p3 ↔ p4 (its timer starts and stops)", scope: "local", setup: at(p3),
      halves: () => [{ name: "navigate: p3 → p4", step: nav(p4.id) }, { name: "navigate: p4 → p3", step: nav(p3.id) }] },
    { name: "p5: open and close the modal", scope: "local", setup: at(p5),
      halves: () => [{ name: "p5: open the modal", step: () => click(p5, t.open.name) }, { name: "p5: close the modal", step: () => click(p5, t.close.name) }] },
    { name: "p5: type in the modal", scope: "local", setup: at(p5, (s) => (s.page.modal ? [] : [click(p5, t.open.name)])), halves: () => [
      { name: "p5: type in the modal", step: () => type(p5, t.modalText.name, "k") },
      { name: "p5: delete it", step: () => type(p5, t.modalText.name, "") },
    ] },
    { name: "menu: open and close (lists every page)", scope: "global", setup: at(p1),
      halves: () => [{ name: "menu: open", step: menu }, { name: "menu: close", step: menu }] },
    { name: "dispatch: whole-global snapshot", scope: "local", setup: at(p1), halves: (s0) => {
      const a = ref.snapshot(spec, s0, "bench-a");
      const b = ref.snapshot(spec, { ...s0, global: a }, "bench-b");
      return [{ name: "dispatch: whole-global snapshot", step: () => dispatch({ type: "snapshot", global: a }) },
        { name: "dispatch: whole-global snapshot (again)", step: () => dispatch({ type: "snapshot", global: b }) }];
    } },
  ];
}
