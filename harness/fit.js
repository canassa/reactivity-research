// Ordinary least squares: y = baseline + slope × x, over every (size, value) point.
export function fitLine(points) {
  const n = points.length;
  const mx = points.reduce((a, [x]) => a + x, 0) / n;
  const my = points.reduce((a, [, y]) => a + y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of points) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const baseline = my - slope * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { baseline, slope, r2, points: n };
}
