import type { Sim } from "./engine.js";
import { clockLabel } from "./clock.js";
import { memberLabel } from "./facilitator.js";

/**
 * Optional feedback on discussion notes and decisions from Claude, using the
 * player's own Anthropic API key. Nothing is sent unless the player asks for it.
 */
export const AI_MODEL = "claude-sonnet-5-5";
export const AI_API_VERSION = "2026-10-21";
export const AI_ENDPOINT = "https://api.anthropic.com/v1/messages";

const SYSTEM = `You are an experienced facilitator of incident response tabletop exercises for IT and OT (industrial control system) teams.
You are reviewing one exercise that has just ended. The organization and events are fictional.

Give feedback the team can use in its hot wash:
- Base everything on what they actually wrote and decided. Quote or refer to their notes. Do not invent facts about the team.
- Compare their choices with good practice for the situation, for example NIST SP 800-61r3 for incident response and NIST SP 800-82r3 or ISA/IEC 62443 for OT. Mention a standard only where it adds something.
- In OT scenarios, weigh safety and the physical process first, then availability, then data.
- Where notes are missing or thin, say what a good answer would have covered.
- Be direct and kind. Write plain English for a mixed audience. No em dashes, no hype, no filler.

Use exactly these three headings in Markdown, and keep the whole reply under 400 words:
### What went well
### What to look at
### Questions for the hot wash`;

/** The prompt for one finished exercise. */
export function feedbackPrompt(sim: Sim): { system: string; user: string } {
  const s = sim.scenario;
  const d = sim.debrief();
  const out: string[] = [];
  out.push(`Scenario: ${s.title}`);
  out.push(`Organization: ${s.org}${s.sector ? ` (${s.sector})` : ""}`);
  out.push(`Player role: ${s.role}`);
  out.push(`Summary: ${s.summary}`);
  out.push(`Result: ${d.passed ? "passed" : "not passed"}, score ${d.score}% (pass mark ${s.passMark}%). ${d.endText}`);
  out.push("");
  out.push("Objectives:");
  for (const o of d.objectives) out.push(`- [${o.passed ? "met" : "missed"}] ${o.objective.text}`);
  out.push("");
  out.push("What the team did, in order:");
  for (const e of sim.log) {
    if (e.kind === "action") out.push(`- ${clockLabel(s, e.time)} did: ${e.title}`);
    else if (e.kind === "inject") out.push(`- ${clockLabel(s, e.time)} received: ${e.title}`);
    else if (e.kind === "rule") out.push(`- ${clockLabel(s, e.time)} consequence: ${e.title}`);
  }
  if (d.lessons.length) {
    out.push("");
    out.push("Decisions flagged as mistakes by the scenario:");
    for (const l of d.lessons) out.push(`- ${l.action.label}: ${l.text.replace(/\s+/g, " ").trim()}`);
  }
  if (sim.team.length) {
    out.push("");
    out.push(`Team seats: ${sim.team.map(memberLabel).join(", ")}`);
  }
  if (sim.decisions.length) {
    out.push("");
    out.push("Recorded decisions:");
    for (const x of sim.decisions) {
      const vote = x.vote ? `; vote ${x.vote.map((o) => `${o.label} ${o.votes}`).join(", ")}` : "";
      out.push(`- ${clockLabel(s, x.time)} ${x.label}${x.by ? ` (decided by ${x.by})` : ""}${vote}${x.rationale ? `. Reason given: ${x.rationale}` : ""}`);
    }
  }
  if (s.phases.length) {
    out.push("");
    out.push("Discussion points and the team's notes:");
    for (const ph of s.phases) {
      const reached = sim.phaseReached(ph.id);
      out.push(`## ${ph.title}${reached ? "" : " (not reached)"}`);
      for (const q of ph.questions) out.push(`- Q: ${q}`);
      out.push(`Notes: ${sim.notes[ph.id]?.trim() || "(none)"}`);
    }
  }
  return { system: SYSTEM, user: out.join("\n") };
}

export interface FeedbackOptions {
  apiKey: string;
  model?: string;
  /** Set when calling from a web page: the API then accepts the request from the browser. */
  browser?: boolean;
  fetchImpl?: typeof fetch;
}

/** Ask Claude for feedback. Throws an Error with a readable message if the call fails. */
export async function requestFeedback(sim: Sim, opts: FeedbackOptions): Promise<string> {
  const key = opts.apiKey.trim();
  if (!key) throw new Error("Add an Anthropic API key first.");
  const { system, user } = feedbackPrompt(sim);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": AI_API_VERSION,
  };
  if (opts.browser) headers["anthropic-dangerous-direct-browser-access"] = "true";
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(AI_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: opts.model ?? AI_MODEL, max_tokens: 1200, system, messages: [{ role: "user", content: user }] }),
    });
  } catch (err) {
    throw new Error(`Could not reach the Anthropic API: ${(err as Error).message}`);
  }
  const body = (await res.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
  if (!res.ok) throw new Error(`The Anthropic API said: ${body.error?.message ?? `HTTP ${res.status}`}`);
  const text = (body.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("The reply had no text in it.");
  return text;
}

/** The feedback as a report section. */
export function feedbackMarkdown(text: string): string {
  return `\n## AI feedback on notes and decisions\n\n_Written by Claude from the notes and decisions in this report. Treat it as a second opinion for the hot wash, not a verdict._\n\n${text.trim()}\n`;
}

