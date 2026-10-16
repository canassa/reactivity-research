// big-table's own helpers for digest apps (shipped as app code, like every
// js-framework-benchmark entry ships its own buildData): select a row, apply to every k-th row,
// swap, sort order, the next option, and the number and date formats. The runtime holds only
// digest's generic machinery.
import { go } from "./runtime.js";

// Selecting row `r`: the row that was selected is digested (the event digests `r`).
export const sel = (o, m, r, q = m.get(o.selected)) => ((o.selected = r.i.id), q && go(q.b));

// Apply `f` to every k-th row, from the first, and digest those rows.
export const every = (o, m, k, f) => {
  for (let i = 0; i < o.rows.length; i += k) f(o.rows[i]), go(m.get(o.rows[i].id).b);
};

// Swap rows i and j, if there are more than j.
export const swap = (a, i, j) => a.length > j && ([a[i], a[j]] = [a[j], a[i]]);

// The order of rows by f(row), ascending (s = 1) or descending (s = -1); ties by id ascending.
export const by = (f, s) => (a, b) => {
  const x = f(a), y = f(b);
  return x < y ? -s : x > y ? s : a.id - b.id;
};

// The option after v (the first after the last).
export const nx = (v, a) => a[(a.indexOf(v) + 1) % a.length];

// Number and date formats. Values are never negative; no locale APIs.
export const g = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const z = (n) => String(n).padStart(2, "0");
export const cur = (s, v) => s + g(Math.floor(v / 100)) + "." + z(v % 100);
export const pct = (v) => g(Math.floor(v / 10)) + "." + (v % 10) + "%";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
// The month (0 to 11) and day of the day of the year v.
const cal = (v, m = 0) => {
  while (v > DAYS[m]) v -= DAYS[m++];
  return [m, v];
};
export const md = (v, [m, d] = cal(v)) => MON[m] + " " + d;
export const dm = (v, [m, d] = cal(v)) => d + " " + MON[m];
export const nd = (v, [m, d] = cal(v)) => z(m + 1) + "-" + z(d);
