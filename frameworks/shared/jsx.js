// Helpers for emitters that write JavaScript or JSX source: literals, JSX text and attributes,
// names. Shared by every JSX-based framework.

const IDENT = /^[A-Za-z_$][\w$]*$/;

// A JavaScript literal for plain data, formatted the way a person would write it.
export function literal(value, indent = "") {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const inner = indent + "  ";
  if (Array.isArray(value)) {
    const items = value.map((v) => literal(v, inner));
    const flat = `[${items.join(", ")}]`;
    if (flat.length + indent.length <= 96 && !flat.includes("\n")) return flat;
    return `[\n${items.map((i) => inner + i + ",").join("\n")}\n${indent}]`;
  }
  const entries = Object.entries(value).map(([k, v]) => `${IDENT.test(k) ? k : JSON.stringify(k)}: ${literal(v, inner)}`);
  if (entries.length === 0) return "{}";
  const flat = `{ ${entries.join(", ")} }`;
  if (flat.length + indent.length <= 96 && !flat.includes("\n")) return flat;
  return `{\n${entries.map((e) => inner + e + ",").join("\n")}\n${indent}}`;
}

// A JSX attribute value: a plain string literal, or an expression for anything else.
export function jsxAttr(v, indent = "") {
  if (typeof v === "string" && !/["&\\{}]/.test(v)) return `"${v}"`;
  return `{${typeof v === "string" ? JSON.stringify(v) : literal(v, indent)}}`;
}

// Text inside a template literal.
export function tplText(s) {
  return String(s).replace(/[`\\]|\$\{/g, (c) => "\\" + c);
}

export function pascal(s) {
  const name = s.normalize("NFKD").replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1)).join("");
  return /^[A-Za-z]/.test(name) ? name : "W" + name;
}

export function camelCase(s) {
  const p = pascal(s);
  return p[0].toLowerCase() + p.slice(1);
}
