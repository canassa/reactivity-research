// What the derived-graph scenario itself asks of the app, beside the runtime: the items' PRNG
// step, the number formatters, the collection helpers formulas are written with (each takes the
// formula's own code as a function), and the typed-number handler. It is the scenario's code
// (every implementation ships its equivalent), so it is counted as app code, not runtime.

// ---------------------------------------------------------------------------------------------
// The item builder's PRNG (Park-Miller): one draw advances the state, then uses it.

export const next = (r) => (r * 48271) % 2147483647;
export const pick = (r, list) => list[r % list.length];
export const between = (r, min, max) => min + (r % (max - min + 1));

// ---------------------------------------------------------------------------------------------
// Formatters: no locale APIs.

export const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export const grp = (v) => (v < 0 ? "-" : "") + group(Math.abs(v));
export const cash = (symbol, cents) => {
  const a = Math.abs(cents);
  return (cents < 0 ? "-" : "") + symbol + group(Math.floor(a / 100)) + "." + String(a % 100).padStart(2, "0");
};

// ---------------------------------------------------------------------------------------------
// Collections: aggregates, a top list and group sums over items.

export const sum = (xs, f) => {
  let total = 0;
  for (const x of xs) total += f(x);
  return total;
};
export const avg = (xs, f) => (xs.length ? Math.floor(sum(xs, f) / xs.length) : 0);
export const maxOf = (xs, f) => (xs.length ? xs.reduce((m, x) => Math.max(m, f(x)), -Infinity) : 0);
export const minOf = (xs, f) => (xs.length ? xs.reduce((m, x) => Math.min(m, f(x)), Infinity) : 0);
// The first `k` items by `f`, ascending when `sign` is 1 and descending when it is -1, ties by id.
export const top = (xs, f, sign, k) =>
  xs.map((x) => [f(x), x]).sort((a, b) => sign * (a[0] - b[0]) || a[1].id - b[1].id).slice(0, k).map((p) => p[1]);
// The sum of `f` per category, in the order of `cats`.
export const byCat = (xs, f, cats) => {
  const out = cats.map(() => 0);
  for (const x of xs) out[cats.indexOf(x.category)] += f(x);
  return out;
};

// ---------------------------------------------------------------------------------------------
// A number input's handler: `put` gets the value only while the input holds an integer in range.

export const typed = (put, min, max) => (e) => {
  const n = e.target.valueAsNumber;
  if (Number.isInteger(n) && n >= min && n <= max) put(n);
};
