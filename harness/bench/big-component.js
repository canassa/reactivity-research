// The events ./rr bench times on big-component: ./rr work's actions (harness/work/
// big-component.js) on the same fields of the big component, made repeatable (lib/fields.js says
// how). The untimed reset of the add button and the tick is a serverSet of the big component, so
// it costs O(N), but it is not timed and runs only every few reps.

import { actions as workActions } from "../work/big-component.js";
import { fieldBenchActions } from "./lib/fields.js";

export function benchActions(spec, ref) {
  return fieldBenchActions(spec, ref, workActions(spec, ref), "big-component");
}
