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
}
