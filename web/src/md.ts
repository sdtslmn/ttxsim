/** HTML-escape a string. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

function inline(s: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/** Render the small Markdown subset used in scenario files: paragraphs, lists, bold and code. */
export function md(text: string): string {
  const out: string[] = [];
  for (const block of text.trim().split(/\n\s*\n/)) {
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*(-|\d+\.)\s+/.test(l) || /^\s{2,}\S/.test(l))) {
      const ordered = /^\s*\d+\./.test(lines[0]);
      const items: string[] = [];
      for (const l of lines) {
        if (/^\s*(-|\d+\.)\s+/.test(l)) items.push(l.replace(/^\s*(-|\d+\.)\s+/, ""));
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
