// The big-component form (one big component plus a small companion) in Marko 6 (the Tags API).
//
// Style (recorded in every generated app's rr.json):
// - The form is one tag (`src/tags/settings-form.marko`: a `<let>` per field, the whole view as
//   one template, handlers in markup), the companion another (`companion-card.marko`), written
//   from the description alone. The form is not split into sub-tags: its bindings cross groups,
//   so a split would only pass fields down. Nothing is interpreted at runtime.
// - State (`--state`, default "local"): each tag owns its fields as `<let>`s and `<return>`s an
//   API: the form returns the three fields the companion reads, `set` (serverSet and snapshot),
//   `tick` and `notify`; the companion returns `set`. The root names the tags with tag variables
//   (`<companion-card/w2 w1OfficeHours=w1.officeHours …/>`) and routes the external events
//   through the APIs. That is what an expert would write for a self-contained form: the outside
//   world and the companion need a handle on the state, and Marko's handle is the returned tag
//   variable (it has no context and no refs). "root" lifts every field into the root as a `<let>`
//   bound down with `:=` to a controllable `<let/x:=input.x>` in the tag (the cheat sheet's
//   pattern for state a parent owns). `--form inline` writes the form in the root template itself.
//   Measured (seeds 1-3, all sizes), baseline + slope per field:
//     local, form tag (default)  5.1 KB + 101.3 B
//     local, form inline         5.1 KB + 101.4 B
//     root, form inline          4.9 KB + 101.2 B
//     root, form tag             5.0 KB + 126.9 B  (a `:=` binding per field)
//   With local state the form tag costs nothing over writing it in the root.
//   A function at the template root that reads the tag variables does not compile in 6.4.6, so
//   the router sits in the page element after the tags (frameworks/marko/README.md).
// - External events: the root `<return>`s the router; `tick` is written out per time-driven int
//   in the form's own `tick()`. Lists are copied out of messages, so no dispatched object is
//   adopted.
// - Lists with `<for … by="id">`; immutable updates (`concat`, `filter`, `map`, `slice`) that find
//   an item by id, so a stale id is a no-op. Conditional sections and validation errors with
//   `<if>`; derived values are plain expressions in the markup.
// - Events as handlers in markup; text inputs, selects and checkboxes are controlled with `:=`;
//   a number input keeps an invalid edit in a local `<let>` that remembers the value it was made
//   over, and commits only integers within the field's range.

import { templateFiles } from "../../frameworks/marko/framework.js";
import { widgetFiles } from "../../frameworks/marko/widgets.js";

export const framework = "marko";

export const params = {
  state: {
    default: "local",
    choices: ["local", "root"],
    help: "where state lives: in each tag, which <return>s its API for the root (local), or in the root template, bound down with := (root)",
  },
  form: {
    default: "tag",
    choices: ["tag", "inline"],
    help: "where the form is written: its own tag (tag), or in the root template itself (inline)",
  },
  layout: {
    default: "fields",
    choices: ["fields", "object"],
    help: "root state only: one <let> per field (fields), or one <let> per component holding its object (object)",
  },
};

const TAGS = { form: "settings-form", companion: "companion-card" };

export function emit(spec, options = {}) {
  const state = options.state ?? "local";
  const inline = options.form === "inline" ? "w1" : null;
  const layout = state === "local" ? "fields" : (options.layout ?? "fields");
  const files = {
    ...templateFiles({ name: "big-component", title: "Settings form" }),
    ...widgetFiles(spec, { tagName: (w) => TAGS[w.kind], pageRole: "page", inline, layout, state }),
  };
  return {
    files,
    style: {
      components: inline
        ? "the form is the root template itself (a <let> per field, one template), plus the companion tag; no sub-tags, no field table"
        : "the form is one tag (settings-form) in one file, a <let> per field and one template, plus the companion tag; no sub-tags, no field table",
      state: state === "local"
        ? "each tag owns its fields as <let>s and <return>s an API (the form: the fields the companion reads, set, tick, notify; the companion: set); the root names the tags with tag variables and passes the companion the fields it reads"
        : `every field of the form and the companion as <let>s in the root template (${layout === "object" ? "one object per component" : "one per field"}), bound down with := to controllable <let>s in the tags (the form's own when written in the root); the companion reads the form's fields as attributes`,
      externalEvents: state === "local"
        ? "app.marko <return>s a router (a <const> in the page element, after the tags) that calls the tags' set, tick and notify; lists copied out of messages"
        : "app.marko <return>s a function that assigns the root's <let>s; tick written out per time-driven int; lists copied out of messages",
      lists: "<for by=\"id\">; immutable updates that find items by id",
      conditionals: "<if> for sections and validation errors",
      derived: "plain expressions in the markup",
      events: "handlers in markup (onClick, valueChange, checkedChange); := for text inputs, checkboxes and selects; number inputs commit only integers within range, keeping an invalid edit in a local pending <let>",
      build: "Vite + @marko/vite (linked: false), production mode, client-only mount, hidden source maps",
    },
  };
}
