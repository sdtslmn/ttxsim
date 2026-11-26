import type { Inject, Scenario } from "./types.js";

export interface Role {
  id: string;
  label: string;
}

/** Seats commonly filled in an OT or IT tabletop exercise. */
export const DEFAULT_ROLES: Role[] = [
  { id: "lead", label: "Incident lead" },
  { id: "ops", label: "Operations or plant manager" },
  { id: "security", label: "IT and OT security" },
  { id: "engineering", label: "Control systems engineering" },
  { id: "safety", label: "Safety (HSE)" },
  { id: "comms", label: "Communications" },
  { id: "legal", label: "Legal and compliance" },
  { id: "exec", label: "Executive sponsor" },
];

export interface Member {
  role: string;
  name: string;
}

export function roleLabel(id: string): string {
  return DEFAULT_ROLES.find((r) => r.id === id)?.label ?? id;
}

/** Display name for a seat: "Sara (Incident lead)" or just the role. */
export function memberLabel(m: Member): string {
  return m.name.trim() ? `${m.name.trim()} (${roleLabel(m.role)})` : roleLabel(m.role);
}

export interface VoteOption {
  action: string;
  label: string;
  votes: number;
}

export interface Decision {
  time: number;
  action: string;
  label: string;
  by?: string;
  rationale?: string;
  vote?: VoteOption[];
}

const empty = { set: [], clear: [], meters: {}, inject: [] };

/**
 * Pressure injects that fit any scenario. They change nothing in the score;
 * they are there to test how the team handles distraction and outside pressure.
 */
export function genericInjects(s: Scenario): Inject[] {
  const org = s.org.replace(/\s*\(fictional\)\s*$/, "");
  const make = (id: string, from: string, via: Inject["via"], subject: string, body: string, note: string): Inject => ({
    id,
    from,
    via,
    subject,
    body: [{ text: body }],
    effects: empty,
    optional: true,
    note,
  });
  return [
    make("fac_media", "Local news desk", "call", "A reporter wants a comment", `"We've heard there's a cyber incident at ${org}. Can you confirm it? We're publishing within the hour."`, "Tests who speaks for the company and what they can say."),
    make("fac_exec", "Chief executive", "call", "The CEO wants a yes or no", `"I've got the board on the phone in ten minutes. Are we back to normal by the end of the day? Yes or no."`, "Tests how the team gives an honest status under pressure."),
    make("fac_unreachable", "Duty manager", "chat", "A key person can't be reached", "Your most experienced engineer is on a flight and can't be reached for the next six hours. Whoever was counting on them needs a plan B.", "Removes a person the team leans on. Use when one role is doing all the work."),
    make("fac_rumour", "HR", "email", "Staff are posting about it", `Several employees are posting on social media that ${org} has been hacked. One post shows a photo of a control room screen.`, "Tests internal communications and staff guidance."),
    make("fac_distraction", "Security operations", "alert", "A second, unrelated alert", "A print server in the office is beaconing to an unknown address. It may be nothing, or it may be related. Someone has to decide whether to chase it.", "A distraction. Watch whether the team splits its attention or assigns it."),
    make("fac_regulator", "Regulator", "call", "The regulator heard it elsewhere", `"We've been told by a third party that ${org} has an incident. Why haven't we heard from you?"`, "Use if the team has not notified anyone yet."),
  ];
}
