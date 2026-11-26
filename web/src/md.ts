/** HTML-escape a string. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

function inline(s: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/** Render a small Markdown subset: headings, paragraphs, lists, bold and code. */
export function md(text: string): string {
  const out: string[] = [];
  // Headings stand on their own, even without blank lines around them.
  const blocks = text
    .trim()
    .replace(/\r/g, "")
    .replace(/^(#{1,4} .*)$/gm, "\n$1\n")
    .split(/\n\s*\n/)
    .map((b) => b.replace(/^\n+|\n+$/g, ""))
    .filter((b) => b.trim());
  for (const block of blocks) {
    const lines = block.split("\n");
    const heading = /^(#{1,4}) (.*)$/.exec(lines[0]);
    if (heading && lines.length === 1) {
      const level = Math.min(6, heading[1].length + 2);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l) || /^\s{2,}\S/.test(l))) {
      const ordered = /^\s*\d+\./.test(lines[0]);
      const items: string[] = [];
      for (const l of lines) {
        if (/^\s*([-*]|\d+\.)\s+/.test(l)) items.push(l.replace(/^\s*([-*]|\d+\.)\s+/, ""));
        else items[items.length - 1] += " " + l.trim();
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((i) => `<li>${inline(i)}</li>`).join("")}</${tag}>`);
    } else {
      out.push(`<p>${inline(lines.join(" "))}</p>`);
    }
  }
  return out.join("");
}
