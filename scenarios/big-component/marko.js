// The big-component form (one big component plus a small companion) in Marko 6 (the Tags API).
//
// Style (recorded in every generated app's rr.json):
// - The form is written from the description alone, as one template with a `<let>` per field,
//   the whole view and handlers in markup (`--form inline`, the default: it is the root template
//   itself, `src/app.marko`; `--form tag`: `src/tags/settings-form.marko`, used by the root).
//   The companion is its own tag (`companion-card.marko`). The form is not split into sub-tags:
//   its bindings cross groups, so a split would only pass fields down. Nothing is interpreted at
//   runtime.
// - State lives in the root template: one `<let>` per field of the form and the companion. The
//   companion's are bound down with `:=` to controllable `<let/x:=input.x>` (the cheat sheet's
//   pattern for state a parent may own); the form's are the root's own when it is written in the
//   root, and bound the same way when it is a tag. Why not state in a form tag, as the tags API
//   would suggest for a self-contained form? The outside world sets the form's whole state
//   (`serverSet`, `snapshot`) and advances its time-driven ints (`tick`), and the companion reads
//   three of its fields. Marko 6 has no handle on a child's state (no refs, no context), and the
//   one way to reach a tag from its parent, the tag variable `<return>`ed by the child and called
//   from the root's `<return>`ed function, does not compile correctly in 6.4.6 (the root's
//   function is emitted at module level with an undefined `$scope`). So the form is the page's
//   root, and a separate form tag only adds one `:=` binding per field: measured at N=256
//   (seed 1-3 median) the tag costs 37.0 KB against 29.7 KB inline (slope 126.9 against 98.6 B
//   per unit). `--layout object` (one `<let>` holding the object) is 8% worse still.
//   The companion reads the form's fields as attributes (`<companion-card … w1OfficeHours=officeHours/>`).
// - External events: the root `<return>`s a function that assigns the `<let>`s; `tick` is written
//   out per time-driven int. Lists copied out of a message, so no dispatched object is adopted.
// - Lists with `<for … by="id">`; immutable updates (`concat`, `filter`, `map`, `slice`) that find
//   an item by id, so a stale id is a no-op. Conditional sections and validation errors with
//   `<if>`; derived values are plain expressions in the markup.
// - Events as handlers in markup; text inputs, selects and checkboxes are controlled with `:=`;
//   a number input keeps an invalid edit in a local `<let>` and commits only integers within the
//   field's range.

import { templateFiles } from "../../frameworks/marko/framework.js";
import { widgetFiles } from "../../frameworks/marko/widgets.js";

export const framework = "marko";

export const params = {
  form: {
    default: "inline",
    choices: ["tag", "inline"],
    help: "where the form is written: its own tag, with its fields bound down from the root's <let>s (tag), or in the root template itself, whose <let>s are the form's state (inline)",
  },
  layout: {
    default: "fields",
    choices: ["fields", "object"],
    help: "the shape of the state: one <let> per field (fields), or one <let> per component holding its object (object)",
  },
};

const TAGS = { form: "settings-form", companion: "companion-card" };

export function emit(spec, options = {}) {
  const inline = options.form === "inline" ? "w1" : null;
  const files = {
    ...templateFiles({ name: "big-component", title: "Settings form" }),
    ...widgetFiles(spec, { tagName: (w) => TAGS[w.kind], pageRole: "page", inline, layout: options.layout ?? "fields" }),
  };
  return {
    files,
    style: {
      components: inline ? "the form is the root template itself (a <let> per field, one template), plus the companion tag; no sub-tags, no field table" : "the form is one tag (settings-form) in one file, a controllable <let> per field and one template, plus the companion tag; no sub-tags, no field table",
      state: "every field of the form and the companion as <let>s in the root template (the form written in it, or bound down with := to controllable <let>s in its tag); the companion reads the form's fields as attributes",
      externalEvents: "app.marko <return>s a function that assigns the root's <let>s; tick written out per time-driven int; lists copied out of messages",
      lists: "<for by=\"id\">; immutable updates that find items by id",
      conditionals: "<if> for sections and validation errors",
      derived: "plain expressions in the markup",
      events: "handlers in markup (onClick, valueChange, checkedChange); := for text inputs, checkboxes and selects; number inputs commit only integers within range, keeping an invalid edit in a local pending <let>",
      build: "Vite + @marko/vite (linked: false), production mode, client-only mount, hidden source maps",
    },
  };
}
