export const LEVELS = ["beginner", "intermediate", "ot", "capstone", "custom"] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABELS: Record<Level, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  ot: "OT and industrial",
  capstone: "Capstone",
  custom: "Custom",
};

export const GROUPS = ["investigate", "contain", "operations", "communicate", "coordinate", "recover"] as const;
export type Group = (typeof GROUPS)[number];

/** How each action group maps to the NIST CSF 2.0 categories used by SP 800-61r3. */
export const GROUP_INFO: Record<Group, { label: string; csf: string }> = {
  investigate: { label: "Investigate", csf: "RS.AN Incident Analysis" },
  contain: { label: "Contain", csf: "RS.MI Incident Mitigation" },
  operations: { label: "Operations", csf: "RS.MI Incident Mitigation" },
  communicate: { label: "Communicate", csf: "RS.CO Incident Response Reporting and Communication" },
  coordinate: { label: "Coordinate", csf: "RS.MA Incident Management" },
  recover: { label: "Recover", csf: "RC.RP Incident Recovery Plan Execution" },
};

export const CHANNELS = ["email", "alert", "call", "chat", "ticket", "news", "team", "letter"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<Channel, string> = {
  email: "Email",
  alert: "Alert",
  call: "Phone call",
  chat: "Chat",
  ticket: "Ticket",
  news: "News",
  team: "Team update",
  letter: "Letter",
};

export interface TextVariant {
  when?: string;
  text: string;
}

export interface Effects {
  set: string[];
  clear: string[];
  meters: Record<string, number>;
  inject: string[];
  end?: { outcome: "close" | "fail"; text?: string };
}

export interface Meter {
  id: string;
  label: string;
  start: number;
  good: "high" | "low";
  help?: string;
}

export interface Inject {
  id: string;
  at?: number;
  when?: string;
  /** Only delivered when a facilitator pushes it. "when" then limits when it can be pushed. */
  optional?: boolean;
  /** Facilitator note: when and why to push an optional inject. */
  note?: string;
  from: string;
  via: Channel;
  subject: string;
  body: TextVariant[];
  effects: Effects;
}

export interface Action {
  id: string;
  group: Group;
  label: string;
  takes: number;
  when?: string;
  repeatable: boolean;
  result: TextVariant[];
  effects: Effects;
  lesson?: string;
}

export interface Rule {
  id: string;
  when: string;
  every?: number;
  effects: Effects;
  text?: string;
}

export interface Objective {
  id: string;
  text: string;
  pass: string;
  weight: number;
  hit: string;
  miss: string;
}

export interface Phase {
  id: string;
  title: string;
  at?: number;
  when?: string;
  /** Background for the discussion, such as earlier warning signs. */
  text?: string;
  questions: string[];
}

export type Tone = "ok" | "warn" | "bad" | "info";

export interface StatusItem {
  id: string;
  label: string;
  states: { when?: string; text: string; tone: Tone }[];
}

export interface AttackStep {
  tactic: string;
  /** ATT&CK technique ID, for example T0859 or T1692.001. */
  technique: string;
  name: string;
  note?: string;
}

export interface TailorField {
  id: string;
  label: string;
  type: "text" | "toggle";
  default: string | boolean;
  help?: string;
}

export interface Scenario {
  id: string;
  title: string;
  level: Level;
  minutes: number;
  sector: string;
  org: string;
  role: string;
  summary: string;
  /** Minutes after midnight on day one when the exercise starts. */
  startMinute: number;
  /** Weekday index (0 = Monday) for day one, if the scenario names one. */
  startWeekday?: number;
  limit: number;
  passMark: number;
  briefing: string;
  meters: Meter[];
  flags: string[];
  injects: Inject[];
  actions: Action[];
  rules: Rule[];
  objectives: Objective[];
  solution: string[];
  references: string[];
  phases: Phase[];
  status: StatusItem[];
  attack: AttackStep[];
  /** Which ATT&CK matrix the attack path uses, for links and labels. */
  attackMatrix: "ics" | "enterprise";
  /** Fields a facilitator can set before play: text placeholders and yes/no toggles. */
  tailor: TailorField[];
  /** Values used for this copy of the scenario. */
  tailored: Record<string, string | boolean>;
  /** Flags switched on at the start (toggles set to yes). */
  initialFlags: string[];
  /** The scenario before tailoring, with {{placeholders}} intact. */
  template?: Scenario;
}
