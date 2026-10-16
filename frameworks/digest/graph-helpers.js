// derived-graph's own helpers for digest apps (shipped as app code, like big-table's): reading a
// number input, and the generic collection helpers a formula's own code is passed to. The runtime
// holds only digest's generic machinery.

// The integer typed in a number input (text `t`) when it lies in [lo, hi], else `d`, the value
// the state already has.
export const num = (t, lo, hi, d) => (/^-?\d+$/.test(t) && t >= lo && t <= hi ? +t : d);

// The sum of f over the items of a list; the floor of their mean, the largest and the smallest
// (0 for an empty list).
export const sum = (l, f) => l.reduce((s, i) => s + f(i), 0);
export const avg = (l, f) => (l.length ? Math.floor(sum(l, f) / l.length) : 0);
export const maxOf = (l, f) => (l.length ? l.reduce((m, i) => Math.max(m, f(i)), -Infinity) : 0);
export const minOf = (l, f) => (l.length ? l.reduce((m, i) => Math.min(m, f(i)), Infinity) : 0);

// The first k items of a list ordered by f, ascending (s = 1) or descending (s = -1); ties by id
// ascending.
export const top = (l, f, s, k) =>
  l
    .map((i) => [f(i), i])
    .sort(([a, x], [b, y]) => (a != b ? s * (a < b ? -1 : 1) : x.id - y.id))
    .slice(0, k)
    .map(([, i]) => i);

// For every category, the sum of f over its items of a list.
export const grp = (cats, l, f) => {
  const g = {};
  for (const c of cats) g[c] = 0;
  for (const i of l) g[i.category] += f(i);
  return g;
};
