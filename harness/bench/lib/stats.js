// Order statistics for ./rr bench: median, quartiles, and a bootstrap interval of the median.

export const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

export const median = (xs) => quantile(xs, 0.5);

// A small seeded generator (mulberry32), so the same samples always give the same interval.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The 95% percentile-bootstrap interval of the median: resample `xs` with replacement B times.
export function bootstrapMedianCI(xs, { B = 2000, seed = 1 } = {}) {
  const n = xs.length;
  if (n < 2) return [NaN, NaN];
  const r = rng(seed + n);
  const meds = new Float64Array(B);
  const buf = new Float64Array(n);
  for (let b = 0; b < B; b++) {
    for (let i = 0; i < n; i++) buf[i] = xs[(r() * n) | 0];
    buf.sort();
    meds[b] = n % 2 ? buf[(n - 1) / 2] : (buf[n / 2 - 1] + buf[n / 2]) / 2;
  }
  meds.sort();
  return [meds[Math.floor(0.025 * (B - 1))], meds[Math.ceil(0.975 * (B - 1))]];
}

// median, quartiles, n and the median's 95% interval, rounded to `d` decimals.
export function describe(xs, d = 1) {
  const r = (x) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
  const [lo, hi] = bootstrapMedianCI(xs);
  return { median: r(median(xs)), p25: r(quantile(xs, 0.25)), p75: r(quantile(xs, 0.75)), n: xs.length, ci: [r(lo), r(hi)] };
}

// Is the median's interval within ±tol of the median?
export function precise(xs, tol) {
  const m = median(xs);
  const [lo, hi] = bootstrapMedianCI(xs);
  return m > 0 && lo >= m * (1 - tol) && hi <= m * (1 + tol);
}
