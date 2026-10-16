// The events ./rr bench times on unique-components: ./rr work's actions (harness/work/
// unique-components.js) on the same widgets, made repeatable (lib/fields.js says how).

import { actions as workActions } from "../work/unique-components.js";
import { fieldBenchActions } from "./lib/fields.js";

export function benchActions(spec, ref) {
  return fieldBenchActions(spec, ref, workActions(spec, ref), "unique-components");
}
