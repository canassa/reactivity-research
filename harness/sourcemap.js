// Byte attribution from source maps (v3), with no dependencies.
//
// Every character of the generated file is assigned to the source of the mapping segment that
// covers it (a segment runs to the next segment on its line). Characters with no mapping are
// assigned to the source that follows them: compilers hoist module-scope declarations without
// mappings (Solid's `template(...)` calls, for one) right before the module's own code. Only
// what comes before the first or after the last mapped character stays "unmapped": bundler glue
// such as Vite's modulepreload polyfill, which it prepends to the entry chunk.

const B64 = Object.fromEntries([..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"].map((c, i) => [c, i]));

function decodeSegment(str) {
  const out = [];
  let value = 0, shift = 0;
  for (const c of str) {
    const d = B64[c];
    value += (d & 31) << shift;
    if (d & 32) shift += 5;
    else {
      out.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return out;
}

// → an Int32Array with, for each UTF-16 unit of `code`, the index of its source or -1.
export function attributeChars(code, map) {
  const owner = new Int32Array(code.length).fill(-1);
  const lineStarts = [0];
  for (let i = 0; i < code.length; i++) if (code.charCodeAt(i) === 10) lineStarts.push(i + 1);
  let src = 0;
  const lines = map.mappings.split(";");
  for (let li = 0; li < lines.length && li < lineStarts.length; li++) {
    const start = lineStarts[li];
    const end = li + 1 < lineStarts.length ? lineStarts[li + 1] - 1 : code.length;
    let col = 0;
    const segs = [];
    for (const s of lines[li].split(",")) {
      if (!s) continue;
      const f = decodeSegment(s);
      col += f[0];
      if (f.length >= 4) {
        src += f[1];
        segs.push([col, src]);
      } else segs.push([col, -1]);
      // f[2], f[3], f[4] (source line, column, name) are not needed here, but the source
      // index is relative across the whole file, so it must be tracked as above.
    }
    for (let k = 0; k < segs.length; k++) {
      const from = start + segs[k][0];
      const to = k + 1 < segs.length ? start + segs[k + 1][0] : end;
      owner.fill(segs[k][1], Math.min(from, end), Math.min(to, end));
    }
  }
  let first = 0;
  while (first < owner.length && owner[first] < 0) first++;
  let next = -1;
  for (let i = owner.length - 1; i >= first; i--) {
    if (owner[i] >= 0) next = owner[i];
    else owner[i] = next;
  }
  return owner;
}

// Assign each character of `code` to a bucket (via its source), and return a function giving
// the code made of the chosen buckets only, in file order (deletion accounting).
export function bucketer(code, map, bucketOfSource, unmappedBucket) {
  const owner = attributeChars(code, map);
  const buckets = map.sources.map((s) => bucketOfSource(s));
  const runs = [];
  let i = 0;
  while (i < code.length) {
    let j = i;
    while (j < code.length && owner[j] === owner[i]) j++;
    runs.push([owner[i] < 0 ? unmappedBucket : buckets[owner[i]], code.slice(i, j)]);
    i = j;
  }
  return (...keep) => runs.filter(([b]) => keep.includes(b)).map(([, s]) => s).join("");
}

// Raw minified bytes per source, for a breakdown by file.
export function bytesPerSource(code, map) {
  const owner = attributeChars(code, map);
  const out = {};
  let i = 0;
  while (i < code.length) {
    let j = i;
    while (j < code.length && owner[j] === owner[i]) j++;
    const key = owner[i] < 0 ? "(unmapped)" : map.sources[owner[i]];
    out[key] = (out[key] || 0) + Buffer.byteLength(code.slice(i, j));
    i = j;
  }
  return out;
}
