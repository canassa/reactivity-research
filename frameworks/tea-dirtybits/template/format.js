// Cell formats of the tea-dirtybits big-table apps (scenario code, counted as app).
// Cell formats. No locale APIs, so every language formats alike.

export const group = (n) => ("" + n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export const money = (symbol, cents) => symbol + group(Math.floor(cents / 100)) + "." + ("" + (cents % 100)).padStart(2, "0");
export const pct = (tenths) => group(Math.floor(tenths / 10)) + "." + (tenths % 10) + "%";

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
  return ("" + (m + 1)).padStart(2, "0") + "-" + ("" + d).padStart(2, "0");
};
