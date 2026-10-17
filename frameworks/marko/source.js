// Helpers for emitters that write Marko 6 templates. Shared by every Marko emitter.
//
// Marko attribute values are plain JavaScript expressions (`<tag count=3 items=["a", "b"]>`), so
// data goes in as JavaScript literals. Watch the syntax traps from Marko's cheat sheet
// (node_modules/marko/cheatsheet.md, rules 1-2): a `>` that hugs an attribute value ends the tag,
// so comparisons in attribute values are parenthesised (`disabled=(n >= max)`), and text at the
// root of a template must sit inside an element.

import { literal } from "../shared/jsx.js";

export { literal, tplText, camelCase, pascal } from "../shared/jsx.js";

// One attribute value for plain data: a string literal or any other JavaScript literal.
export function attrValue(value, indent = "") {
  return literal(value, indent);
}

// ` name=value` pairs for plain data, in the given order (`attrs({ id: "w1", step: 2 })`).
export function attrs(obj, indent = "") {
  return Object.entries(obj).map(([k, v]) => ` ${k}=${attrValue(v, indent)}`).join("");
}

// The number input every emitter with integer fields shares: `src/tags/int-field.marko`.
// It is controllable (`value:=name`, or `value=… valueChange(n) { … }`) and commits only integers
// in `min`..`max`. An edit that is not one stays in the input as `pending` (the cheat sheet's
// pattern for uncommitted edits), tagged with the parent's revision `input.rev`. The parent bumps
// its revision on every write to the value that does not come from this tag (an external event, a
// button, a confirm), so any such write drops the typed text, even one that leaves the value as it was.
export const INT_FIELD = `<let/value:=input.value>
<let/pending=null>
<const/draft=(pending?.rev === input.rev ? pending.text : value)>

<input type="number" data-role=input.msg value=draft valueChange(text) {
  const n = Number(text);
  if (text.trim() !== "" && Number.isInteger(n) && n >= input.min && n <= input.max) {
    value = n;
    pending = null;
  } else {
    pending = { rev: input.rev, text };
  }
}>
`;
