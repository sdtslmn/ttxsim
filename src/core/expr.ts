/**
 * A tiny, safe condition language used in scenario files.
 *
 *   did.isolate_host and at.isolate_host <= 30
 *   not seen.ransom_note or spread >= 80
 *   time >= at.vendor_call + 60
 *
 * Values are numbers or booleans. Booleans count as 1 and 0 in arithmetic
 * and comparisons. Nothing here can call code or touch the outside world.
 */

export type Value = number | boolean;

export type Node =
  | { kind: "num"; value: number }
  | { kind: "bool"; value: boolean }
  | { kind: "id"; name: string }
  | { kind: "not"; arg: Node }
  | { kind: "neg"; arg: Node }
  | { kind: "bin"; op: BinOp; left: Node; right: Node };

type BinOp = "and" | "or" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "+" | "-";

interface Token {
  type: "num" | "id" | "op" | "lp" | "rp" | "end";
  text: string;
  pos: number;
}

export class ExprError extends Error {}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      // Numbers, optionally with a duration unit: 45, 30m, 3h, 2d (all in minutes).
      const m = /^([0-9]+(?:\.[0-9]+)?)([dhm](?![A-Za-z0-9_]))?/.exec(src.slice(i))!;
      const factor = m[2] === "d" ? 1440 : m[2] === "h" ? 60 : 1;
      out.push({ type: "num", text: String(Number(m[1]) * factor), pos: i });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)?/.exec(src.slice(i))!;
      out.push({ type: "id", text: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["==", "!=", "<=", ">="].includes(two)) {
      out.push({ type: "op", text: two, pos: i });
      i += 2;
      continue;
    }
    if ("<>+-".includes(ch)) {
      out.push({ type: "op", text: ch, pos: i });
      i++;
      continue;
    }
    if (ch === "(") {
      out.push({ type: "lp", text: ch, pos: i });
      i++;
      continue;
    }
    if (ch === ")") {
      out.push({ type: "rp", text: ch, pos: i });
      i++;
      continue;
    }
    throw new ExprError(`unexpected character "${ch}" at position ${i + 1}`);
  }
  out.push({ type: "end", text: "", pos: src.length });
  return out;
}

export function parse(src: string): Node {
  const tokens = tokenize(src);
  let p = 0;
  const peek = () => tokens[p];
  const next = () => tokens[p++];
  const isWord = (w: string) => peek().type === "id" && peek().text === w;

  function orExpr(): Node {
    let left = andExpr();
    while (isWord("or")) {
      next();
      left = { kind: "bin", op: "or", left, right: andExpr() };
    }
    return left;
  }
  function andExpr(): Node {
    let left = notExpr();
    while (isWord("and")) {
      next();
      left = { kind: "bin", op: "and", left, right: notExpr() };
    }
    return left;
  }
  function notExpr(): Node {
    if (isWord("not")) {
      next();
      return { kind: "not", arg: notExpr() };
    }
    return cmpExpr();
  }
  function cmpExpr(): Node {
    const left = addExpr();
    const t = peek();
    if (t.type === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(t.text)) {
      next();
      return { kind: "bin", op: t.text as BinOp, left, right: addExpr() };
    }
    return left;
  }
  function addExpr(): Node {
    let left = primary();
    while (peek().type === "op" && (peek().text === "+" || peek().text === "-")) {
      const op = next().text as BinOp;
      left = { kind: "bin", op, left, right: primary() };
    }
    return left;
  }
  function primary(): Node {
    const t = next();
    if (t.type === "num") return { kind: "num", value: Number(t.text) };
    if (t.type === "op" && t.text === "-") return { kind: "neg", arg: primary() };
    if (t.type === "lp") {
      const inner = orExpr();
      if (next().type !== "rp") throw new ExprError(`missing ")" in "${src}"`);
      return inner;
    }
    if (t.type === "id") {
      if (["and", "or", "not"].includes(t.text)) {
        throw new ExprError(`"${t.text}" is in the wrong place in "${src}"`);
      }
      if (t.text === "true") return { kind: "bool", value: true };
      if (t.text === "false") return { kind: "bool", value: false };
      return { kind: "id", name: t.text };
    }
    if (t.type === "end") throw new ExprError(`"${src}" ends too early`);
    throw new ExprError(`unexpected "${t.text}" at position ${t.pos + 1} in "${src}"`);
  }

  const node = orExpr();
  if (peek().type !== "end") {
    throw new ExprError(`unexpected "${peek().text}" at position ${peek().pos + 1} in "${src}"`);
  }
  return node;
}

export type Resolver = (name: string) => Value;

const num = (v: Value) => (typeof v === "boolean" ? (v ? 1 : 0) : v);
const truthy = (v: Value) => (typeof v === "boolean" ? v : v !== 0);

export function evaluate(node: Node, resolve: Resolver): Value {
  switch (node.kind) {
    case "num":
    case "bool":
      return node.value;
    case "id":
      return resolve(node.name);
    case "not":
      return !truthy(evaluate(node.arg, resolve));
    case "neg":
      return -num(evaluate(node.arg, resolve));
    case "bin": {
      if (node.op === "and") return truthy(evaluate(node.left, resolve)) && truthy(evaluate(node.right, resolve));
      if (node.op === "or") return truthy(evaluate(node.left, resolve)) || truthy(evaluate(node.right, resolve));
      const a = num(evaluate(node.left, resolve));
      const b = num(evaluate(node.right, resolve));
      switch (node.op) {
        case "==":
          return a === b;
        case "!=":
          return a !== b;
        case "<":
          return a < b;
        case "<=":
          return a <= b;
        case ">":
          return a > b;
        case ">=":
          return a >= b;
        case "+":
          return a + b;
        case "-":
          return a - b;
      }
    }
  }
  throw new ExprError("bad expression");
}

export function identifiers(node: Node, out: Set<string> = new Set()): Set<string> {
  switch (node.kind) {
    case "id":
      out.add(node.name);
      break;
    case "not":
    case "neg":
      identifiers(node.arg, out);
      break;
    case "bin":
      identifiers(node.left, out);
      identifiers(node.right, out);
      break;
  }
  return out;
}

export function isTrue(v: Value): boolean {
  return truthy(v);
}
