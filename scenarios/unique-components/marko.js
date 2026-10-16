// The unique-components dashboard in Marko 6 (the Tags API).
//
// Style (recorded in every generated app's rr.json):
// - One tag per widget (`src/tags/widget-w1.marko`, …, auto-discovered), each used once by the
//   root, written from the widget's description alone: its handlers, bindings and derived
//   expressions are that tag's own code. Nothing is interpreted at runtime.
// - State lives in the root template: one `<let>` per field of every widget, bound down with `:=`
//   to the controllable `<let/x:=input.x>` in the widget's tag (the cheat sheet's pattern for
//   state a parent may own). Why not state in each widget tag, with the root routing external
//   events to it? That is what the tags API suggests for a self-contained widget, but every
//   widget's whole state is set from outside (`serverSet`, `snapshot`), time-driven ints advance
//   by `tick`, and readers read other widgets' fields. Marko 6 has no handle on a child's state
//   (no refs, no context), and the one way to reach a tag from its parent, the tag variable the
//   child `<return>`s, called from the root's `<return>`ed function, does not compile correctly
//   in 6.4.6 (the root's function is emitted at module level with an undefined `$scope`, and a
//   `<const>` collecting the tag variables holds the hoisting getters rather than the values).
//   So state the outside sets or a sibling reads belongs to the common parent, which here is all
//   of it. `--layout object` keeps one `<let>` per widget instead of one per field: 3.5% smaller
//   slope (377 against 391 B per widget), but one `<let>` per field is the idiom. A reader receives the fields it reads as attributes (`<widget-w8 w6Miles=w6Miles/>`).
// - External events: the root `<return>`s a function that assigns the `<let>`s; `tick` is written
//   out per time-driven int. Lists are copied out of messages, so no dispatched object is adopted.
// - Lists with `<for … by="id">`; immutable updates (`concat`, `filter`, `map`, `slice`) that find
//   an item by id, so a stale id is a no-op. Conditional sections and validation errors with
//   `<if>`; derived values are plain expressions in the markup.
// - Events as handlers in markup (`onClick`); text inputs, selects and checkboxes are controlled
//   with `:=`; a number input keeps an invalid edit in a local `<let>` and commits only integers
//   within the field's range.

import { templateFiles } from "../../frameworks/marko/framework.js";
import { widgetFiles } from "../../frameworks/marko/widgets.js";

export const framework = "marko";

export const params = {
  layout: {
    default: "fields",
    choices: ["fields", "object"],
    help: "the shape of a widget's state in the root: one <let> per field, each bound down with := (fields), or one <let> holding the widget's object, bound once (object)",
  },
};

export function emit(spec, options = {}) {
  const layout = options.layout ?? "fields";
  const files = {
    ...templateFiles({ name: "unique-components", title: "Dashboard" }),
    ...widgetFiles(spec, { tagName: (w) => `widget-${w.id}`, pageRole: "dashboard", layout }),
  };
  return {
    files,
    style: {
      components: "one tag per widget (src/tags/widget-<id>.marko), each used once, written from the widget's description; no shared kinds",
      state: "every widget's fields as <let>s in the root template, bound down with := to controllable <let>s in the tags; readers receive the fields they read as attributes",
      externalEvents: "app.marko <return>s a function that assigns the root's <let>s; tick written out per time-driven int; lists copied out of messages",
      lists: "<for by=\"id\">; immutable updates that find items by id",
      conditionals: "<if> for sections and validation errors",
      derived: "plain expressions in the markup",
      events: "handlers in markup (onClick, valueChange, checkedChange); := for text inputs, checkboxes and selects; number inputs commit only integers within range, keeping an invalid edit in a local pending <let>",
      build: "Vite + @marko/vite (linked: false), production mode, client-only mount, hidden source maps",
    },
  };
}
