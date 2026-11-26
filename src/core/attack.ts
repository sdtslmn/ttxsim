import type { Scenario } from "./types.js";

/** Link to a technique on attack.mitre.org. */
export function attackUrl(technique: string): string {
  return `https://attack.mitre.org/techniques/${technique.replace(".", "/")}/`;
}

export function attackMarkdown(s: Scenario): string {
  const lines = [`## Attack path (MITRE ATT&CK${s.attackMatrix === "ics" ? " for ICS" : ""})`, ""];
  lines.push("| Step | Tactic | Technique | In this scenario |");
  lines.push("| ---: | --- | --- | --- |");
  s.attack.forEach((a, i) => lines.push(`| ${i + 1} | ${a.tactic} | [${a.technique} ${a.name}](${attackUrl(a.technique)}) | ${(a.note ?? "").replace(/\|/g, "/")} |`));
  lines.push("");
  return lines.join("\n");
}

