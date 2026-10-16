// What the big-table scenario itself asks of every table, beside the runtime: a table's state, the
// row builder's PRNG step, and the number and date formatters. It is the scenario's code (every
// implementation ships its equivalent), so it is counted as app code, not runtime.

// ---------------------------------------------------------------------------------------------
// A table's state: its rows, the selected row's id, and the row builder's counters.

export const state = (rng) => ({ rows: [], selected: null, nextId: 1, rng });

// The selection goes with its row.
export const keepSelected = (s) => {
  if (s.selected != null && !s.rows.some((item) => item.id === s.selected)) s.selected = null;
};

// ---------------------------------------------------------------------------------------------
// The row builder's PRNG (Park-Miller): one draw advances the state, then uses it.

export const next = (r) => (r * 48271) % 2147483647;
export const pick = (r, list) => list[r % list.length];
export const between = (r, min, max) => min + (r % (max - min + 1));

// ---------------------------------------------------------------------------------------------
// Formatters: no locale APIs.

export const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export const money = (symbol, cents) => symbol + group(Math.floor(cents / 100)) + "." + String(cents % 100).padStart(2, "0");
export const percent = (tenths) => group(Math.floor(tenths / 10)) + "." + (tenths % 10) + "%";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// A day of the year (1-365) as [month index, day of the month].
const monthDay = (day) => {
  let m = 0;
  while (day > DAYS[m]) day -= DAYS[m++];
  return [m, day];
};
export const monD = (day) => {
  const [m, d] = monthDay(day);
  return MONTHS[m] + " " + d;
};
export const dMon = (day) => {
  const [m, d] = monthDay(day);
  return d + " " + MONTHS[m];
};
export const mmDd = (day) => {
  const [m, d] = monthDay(day);
  return String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
};
