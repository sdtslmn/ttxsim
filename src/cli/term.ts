const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const wrap = (open: number, close: number) => (s: string) => (useColor ? `\x1b[${open}m${s}\x1b[${close}m` : s);

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
};

export function width(): number {
  return Math.max(40, Math.min(process.stdout.columns || 80, 100));
}

function inline(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, (_, x) => c.bold(x)).replace(/`([^`]+)`/g, (_, x) => c.cyan(x));
}

const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

function wrapLine(text: string, max: number, indent = "", firstIndent = indent): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = firstIndent;
  let lineLen = visible(firstIndent).length;
  let empty = true;
  for (const w of words) {
    const wl = visible(w).length;
    if (!empty && lineLen + 1 + wl > max) {
      lines.push(line);
      line = indent + w;
      lineLen = indent.length + wl;
    } else {
      line += (empty ? "" : " ") + w;
      lineLen += (empty ? 0 : 1) + wl;
    }
    empty = false;
  }
  if (!empty) lines.push(line);
  return lines;
}

/** Render the small Markdown subset used in scenarios for a terminal. */
export function md(text: string, indent = "  "): string {
  const max = width() - 2;
  const out: string[] = [];
  const paras = text.trim().split(/\n\s*\n/);
  for (const p of paras) {
    const lines = p.split("\n");
    if (lines.every((l) => /^\s*(-|\d+\.)\s+/.test(l) || /^\s{2,}\S/.test(l))) {
      let item = "";
      const flush = () => {
        if (!item) return;
        const m = /^\s*(-|\d+\.)\s+(.*)$/.exec(item)!;
        const bullet = m[1] === "-" ? "•" : m[1];
        out.push(...wrapLine(inline(m[2]), max, indent + "  ", `${indent}${bullet} `));
        item = "";
      };
      for (const l of lines) {
        if (/^\s*(-|\d+\.)\s+/.test(l)) {
          flush();
          item = l;
        } else item += " " + l.trim();
      }
      flush();
    } else {
      out.push(...wrapLine(inline(lines.join(" ")), max, indent));
    }
    out.push("");
  }
  return out.join("\n").replace(/\n+$/, "");
}

export function bar(value: number, good: "high" | "low", size = 20): string {
  const filled = Math.round((value / 100) * size);
  const s = "█".repeat(filled) + "░".repeat(size - filled);
  const ok = good === "high" ? value >= 60 : value <= 40;
  const bad = good === "high" ? value < 35 : value > 65;
  return ok ? c.green(s) : bad ? c.red(s) : c.yellow(s);
}

export function rule(title = ""): string {
  const w = width();
  if (!title) return c.dim("─".repeat(w));
  return c.dim("── ") + c.bold(title) + " " + c.dim("─".repeat(Math.max(3, w - visible(title).length - 4)));
}
