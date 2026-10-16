// The unique-components dashboard in Marko 6 (the Tags API).
//
// Style (recorded in every generated app's rr.json):
// - One tag per widget (`src/tags/widget-w1.marko`, …, auto-discovered), each used once by the
//   root, written from the widget's description alone: its handlers, bindings and derived
//   expressions are that tag's own code. Nothing is interpreted at runtime.
// - State (`--state`, default "local"): each widget tag owns its fields as `<let>`s, the way
//   Marko's tags are meant to be written (a self-contained widget), and `<return>`s an API: the
//   fields other widgets read, `set` (serverSet and snapshot), and `tick` or `notify` where the
//   widget has a time-driven int or a feed. The root names each widget with a tag variable
//   (`<widget-w8/w8 w6Miles=w6.miles/>`), passes a reader the fields it reads as attributes, and
//   routes the external events through the APIs. That is what an expert would write: the outside
//   world and the readers need a handle on the state, and Marko's handle is the returned tag
//   variable (it has no context and no refs). The alternative, "root", lifts every field into the
//   root as a `<let>` bound down with `:=` to a controllable `<let/x:=input.x>` in the tag, as
//   the cheat sheet does for state a parent owns. Measured (seeds 1-3, all sizes): local 5.8 KB +
//   341 B per widget, root 5.9 KB + 399 B per widget. `--layout object` (root state only, one
//   `<let>` per widget) is 3.5% smaller than one `<let>` per field.
//   A function at the template root that reads the tag variables does not compile in 6.4.6, so
//   the router sits in the dashboard element after the widgets (frameworks/marko/README.md).
// - External events: the root `<return>`s the router; `tick` is written out per time-driven int
//   in that widget's own `tick()`. Lists are copied out of messages, so no dispatched object is
//   adopted.
// - Lists with `<for … by="id">`; immutable updates (`concat`, `filter`, `map`, `slice`) that find
//   an item by id, so a stale id is a no-op. Conditional sections and validation errors with
//   `<if>`; derived values are plain expressions in the markup.
// - Events as handlers in markup (`onClick`); text inputs, selects and checkboxes are controlled
//   with `:=`; a number input keeps an invalid edit in a local `<let>` that remembers the value it
//   was made over, and commits only integers within the field's range.

import { templateFiles } from "../../frameworks/marko/framework.js";
import { widgetFiles } from "../../frameworks/marko/widgets.js";

export const framework = "marko";

export const params = {
  state: {
    default: "local",
    choices: ["local", "root"],
    help: "where widget state lives: in each tag, which <return>s its API for the root (local), or in the root template, bound down with := (root)",
  },
  layout: {
    default: "fields",
    choices: ["fields", "object"],
    help: "root state only: one <let> per field, each bound down with := (fields), or one <let> holding the widget's object, bound once (object)",
  },
};

export function emit(spec, options = {}) {
  const state = options.state ?? "local";
  const layout = state === "local" ? "fields" : (options.layout ?? "fields");
  const files = {
    ...templateFiles({ name: "unique-components", title: "Dashboard" }),
    ...widgetFiles(spec, { tagName: (w) => `widget-${w.id}`, pageRole: "dashboard", layout, state }),
  };
  return {
    files,
    style: {
      components: "one tag per widget (src/tags/widget-<id>.marko), each used once, written from the widget's description; no shared kinds",
      state: state === "local"
        ? "each widget tag owns its fields as <let>s and <return>s an API (the fields others read, set, tick, notify); the root names the tags with tag variables and passes readers the fields they read"
        : `every widget's state as <let>s in the root template (${layout === "object" ? "one object per widget" : "one per field"}), bound down with := to controllable <let>s in the tags; readers receive the fields they read as attributes`,
      externalEvents: state === "local"
        ? "app.marko <return>s a router (a <const> in the dashboard element, after the widgets) that calls the tags' set, tick and notify; lists copied out of messages"
        : "app.marko <return>s a function that assigns the root's <let>s; tick written out per time-driven int; lists copied out of messages",
      lists: "<for by=\"id\">; immutable updates that find items by id",
      conditionals: "<if> for sections and validation errors",
      derived: "plain expressions in the markup",
      events: "handlers in markup (onClick, valueChange, checkedChange); := for text inputs, checkboxes and selects; number inputs commit only integers within range, keeping an invalid edit in a local pending <let>",
      build: "Vite + @marko/vite (linked: false), production mode, client-only mount, hidden source maps",
    },
  };
}
