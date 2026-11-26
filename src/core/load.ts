import { parse as parseYaml } from "yaml";
import { ExprError, identifiers, parse as parseExpr } from "./expr.js";
import {
  CHANNELS,
  GROUPS,
  LEVELS,
  type Action,
  type Channel,
  type Effects,
  type Group,
  type Inject,
  type Level,
  type Meter,
  type AttackStep,
  type Objective,
  type Phase,
  type Rule,
  type Scenario,
  type StatusItem,
  type TailorField,
  type TextVariant,
  type Tone,
} from "./types.js";

export class ScenarioError extends Error {
  constructor(public readonly problems: string[], public readonly file = "") {
    super(`${file ? `${file}: ` : ""}${problems.length} problem${problems.length === 1 ? "" : "s"} found\n  - ${problems.join("\n  - ")}`);
  }
}

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const ID = /^[a-z][a-z0-9_]*$/;
const SPECIAL_EFFECT_KEYS = new Set(["set", "clear", "inject", "end"]);

/** "45", 45, "30m", "2h", "1h30m", "1d" -> minutes */
export function parseDuration(v: unknown, where: string, problems: string[]): number {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.round(v);
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (/^\d+$/.test(s)) return Number(s);
    const m = /^(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m(?:in)?)?$/.exec(s);
    if (m && (m[1] || m[2] || m[3])) {
      return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
    }
  }
  problems.push(`${where}: "${String(v)}" is not a duration (use minutes, or forms like 30m, 2h, 1h30m, 1d)`);
  return 0;
}

function str(v: unknown, where: string, problems: string[], required = true): string {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  if (required) problems.push(`${where} is missing`);
  return "";
}

function list(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function texts(v: unknown, where: string, problems: string[], required = true): TextVariant[] {
  if (typeof v === "string") return [{ text: v.trim() }];
  if (Array.isArray(v)) {
    const out: TextVariant[] = [];
    v.forEach((item, i) => {
      if (typeof item === "string") out.push({ text: item.trim() });
      else if (item && typeof item === "object" && typeof (item as any).text === "string") {
        const when = (item as any).when;
        out.push({ text: (item as any).text.trim(), when: typeof when === "string" ? when : undefined });
      } else problems.push(`${where}[${i + 1}] needs a "text" field`);
    });
    if (out.length) return out;
  }
  if (required) problems.push(`${where} is missing`);
  return [];
}

function effects(v: unknown, where: string, problems: string[]): Effects {
  const e: Effects = { set: [], clear: [], meters: {}, inject: [] };
  if (v === undefined || v === null) return e;
  if (typeof v !== "object" || Array.isArray(v)) {
    problems.push(`${where} must be a map, like { set: [flag], spread: 10 }`);
    return e;
  }
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (k === "set") e.set = list(val).map(String);
    else if (k === "clear") e.clear = list(val).map(String);
    else if (k === "inject") e.inject = list(val).map(String);
    else if (k === "end") {
      if (val === "close" || val === "fail") e.end = { outcome: val };
      else if (val && typeof val === "object" && ((val as any).outcome === "close" || (val as any).outcome === "fail")) {
        e.end = { outcome: (val as any).outcome, text: typeof (val as any).text === "string" ? (val as any).text.trim() : undefined };
      } else problems.push(`${where}.end must be "close" or "fail", or { outcome, text }`);
    } else if (typeof val === "number") e.meters[k] = val;
    else problems.push(`${where}.${k} should be a number (a meter change) or one of set, clear, inject, end`);
  }
  return e;
}

function parseStart(v: unknown, problems: string[]): { minute: number; weekday?: number } {
  if (v === undefined) return { minute: 9 * 60 };
  const s = String(v).trim().toLowerCase();
  const m = /^(?:([a-z]{3})[a-z]*\s+)?(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) {
    problems.push(`start "${String(v)}" should look like "09:15" or "Tue 09:15"`);
    return { minute: 9 * 60 };
  }
  const weekday = m[1] ? WEEKDAYS.indexOf(m[1]) : undefined;
  if (m[1] && weekday === -1) problems.push(`start "${String(v)}" has an unknown weekday`);
  return { minute: Number(m[2]) * 60 + Number(m[3]), weekday: weekday === -1 ? undefined : weekday };
}

/** Parse scenario YAML into a Scenario. Throws ScenarioError listing every problem found. */
export function loadScenario(source: string, file = ""): Scenario {
  const problems: string[] = [];
  let raw: any;
  try {
    raw = parseYaml(source);
  } catch (err) {
    throw new ScenarioError([`YAML could not be read: ${(err as Error).message}`], file);
  }
  if (!raw || typeof raw !== "object") throw new ScenarioError(["the file is empty or not a YAML map"], file);

  const level = (raw.level ?? "custom") as Level;
  if (!LEVELS.includes(level)) problems.push(`level "${raw.level}" must be one of ${LEVELS.join(", ")}`);
  const start = parseStart(raw.start, problems);

  const meters: Meter[] = [];
  if (raw.meters && typeof raw.meters === "object") {
    for (const [id, m] of Object.entries(raw.meters as Record<string, any>)) {
      if (!ID.test(id)) problems.push(`meter id "${id}" should use lower case letters, digits and _`);
      const startVal = typeof m?.start === "number" ? m.start : 0;
      if (m?.good !== "high" && m?.good !== "low") problems.push(`meter ${id}: "good" must be high or low`);
      meters.push({
        id,
        label: str(m?.label, `meter ${id}: label`, problems),
        start: Math.max(0, Math.min(100, startVal)),
        good: m?.good === "low" ? "low" : "high",
        help: typeof m?.help === "string" ? m.help.trim() : undefined,
      });
    }
  }

  const injects: Inject[] = list(raw.injects).map((x: any, i) => {
    const where = `inject ${x?.id ?? i + 1}`;
    const via = (x?.via ?? "email") as Channel;
    if (!CHANNELS.includes(via)) problems.push(`${where}: via "${x?.via}" must be one of ${CHANNELS.join(", ")}`);
    const optional = x?.optional === true;
    if (!optional && x?.at === undefined && x?.when === undefined) problems.push(`${where} needs "at" (a time) or "when" (a condition), or "optional: true" for a facilitator inject`);
    if (optional && x?.at !== undefined) problems.push(`${where}: an optional inject has no "at". The facilitator decides when to push it.`);
    return {
      id: str(x?.id, `${where}: id`, problems),
      at: x?.at === undefined || optional ? undefined : parseDuration(x.at, `${where}: at`, problems),
      when: typeof x?.when === "string" ? x.when : undefined,
      optional: optional || undefined,
      note: typeof x?.note === "string" ? x.note.trim() : undefined,
      from: str(x?.from, `${where}: from`, problems),
      via,
      subject: str(x?.subject, `${where}: subject`, problems),
      body: texts(x?.body, `${where}: body`, problems),
      effects: effects(x?.effects, `${where}: effects`, problems),
    };
  });

  const actions: Action[] = list(raw.actions).map((x: any, i) => {
    const where = `action ${x?.id ?? i + 1}`;
    const group = x?.group as Group;
    if (!GROUPS.includes(group)) problems.push(`${where}: group "${x?.group}" must be one of ${GROUPS.join(", ")}`);
    return {
      id: str(x?.id, `${where}: id`, problems),
      group: GROUPS.includes(group) ? group : "investigate",
      label: str(x?.label, `${where}: label`, problems),
      takes: x?.takes === undefined ? 10 : parseDuration(x.takes, `${where}: takes`, problems),
      when: typeof x?.when === "string" ? x.when : undefined,
      repeatable: x?.repeatable === true,
      result: texts(x?.result, `${where}: result`, problems),
      effects: effects(x?.effects, `${where}: effects`, problems),
      lesson: typeof x?.lesson === "string" ? x.lesson.trim() : undefined,
    };
  });

  const rules: Rule[] = list(raw.rules).map((x: any, i) => ({
    id: typeof x?.id === "string" ? x.id : `rule_${i + 1}`,
    when: str(x?.when, `rule ${i + 1}: when`, problems),
    every: x?.every === undefined ? undefined : parseDuration(x.every, `rule ${i + 1}: every`, problems),
    effects: effects(x?.effects, `rule ${i + 1}: effects`, problems),
    text: typeof x?.text === "string" ? x.text.trim() : undefined,
  }));

  const objectives: Objective[] = list(raw.objectives).map((x: any, i) => {
    const where = `objective ${i + 1}`;
    const weight = x?.weight === undefined ? 1 : Number(x.weight);
    if (!(weight > 0)) problems.push(`${where}: weight must be a positive number`);
    return {
      id: typeof x?.id === "string" ? x.id : `objective_${i + 1}`,
      text: str(x?.text, `${where}: text`, problems),
      pass: str(x?.pass, `${where}: pass`, problems),
      weight: weight > 0 ? weight : 1,
      hit: str(x?.hit, `${where}: hit`, problems),
      miss: str(x?.miss, `${where}: miss`, problems),
    };
  });

  const phases: Phase[] = list(raw.phases).map((x: any, i) => {
    const where = `phase ${x?.id ?? i + 1}`;
    if (x?.at === undefined && x?.when === undefined) problems.push(`${where} needs "at" (a time) or "when" (a condition)`);
    const questions = list(x?.questions).map(String);
    if (!questions.length) problems.push(`${where} needs at least one question`);
    return {
      id: str(x?.id, `${where}: id`, problems),
      title: str(x?.title, `${where}: title`, problems),
      at: x?.at === undefined ? undefined : parseDuration(x.at, `${where}: at`, problems),
      when: typeof x?.when === "string" ? x.when : undefined,
      text: typeof x?.text === "string" ? x.text.trim() : undefined,
      questions,
    };
  });

  const TONES = ["ok", "warn", "bad", "info"];
  const status: StatusItem[] = list(raw.status).map((x: any, i) => {
    const where = `status ${x?.id ?? i + 1}`;
    const states = list(x?.states).map((st: any, n) => {
      if (!TONES.includes(st?.tone)) problems.push(`${where}: state ${n + 1} needs tone ok, warn, bad or info`);
      return { when: typeof st?.when === "string" ? st.when : undefined, text: str(st?.text, `${where}: state ${n + 1} text`, problems), tone: (TONES.includes(st?.tone) ? st.tone : "info") as Tone };
    });
    if (!states.length) problems.push(`${where} needs at least one state`);
    else if (states[states.length - 1].when) problems.push(`${where}: the last state should have no "when"`);
    return { id: str(x?.id, `${where}: id`, problems), label: str(x?.label, `${where}: label`, problems), states };
  });

  const attack: AttackStep[] = list(raw.attack).map((x: any, i) => {
    const where = `attack step ${i + 1}`;
    const technique = str(x?.technique, `${where}: technique`, problems);
    if (technique && !/^T\d{4}(\.\d{3})?$/.test(technique)) problems.push(`${where}: technique "${technique}" should look like T0859 or T1692.001`);
    return { tactic: str(x?.tactic, `${where}: tactic`, problems), technique, name: str(x?.name, `${where}: name`, problems), note: typeof x?.note === "string" ? x.note.trim() : undefined };
  });

  const tailor: TailorField[] = list(raw.tailor).map((x: any, i) => {
    const where = `tailor field ${x?.id ?? i + 1}`;
    const type = x?.type === "toggle" ? "toggle" : x?.type === "text" || x?.type === undefined ? "text" : null;
    if (!type) problems.push(`${where}: type must be text or toggle`);
    const def = type === "toggle" ? x?.default === true : x?.default === undefined ? "" : String(x.default);
    if (type === "text" && !String(def).trim()) problems.push(`${where} needs a default value`);
    return { id: str(x?.id, `${where}: id`, problems), label: str(x?.label, `${where}: label`, problems), type: type ?? "text", default: def, help: typeof x?.help === "string" ? x.help.trim() : undefined };
  });

  const scenario: Scenario = {
    id: str(raw.id, "id", problems),
    title: str(raw.title, "title", problems),
    level: LEVELS.includes(level) ? level : "custom",
    minutes: typeof raw.minutes === "number" ? raw.minutes : 20,
    sector: str(raw.sector, "sector", problems, false),
    org: str(raw.org, "org", problems, false),
    role: str(raw.role, "role", problems),
    summary: str(raw.summary, "summary", problems),
    startMinute: start.minute,
    startWeekday: start.weekday,
    limit: parseDuration(raw.limit ?? "8h", "limit", problems),
    passMark: typeof raw.pass === "number" ? raw.pass : 70,
    briefing: str(raw.briefing, "briefing", problems),
    meters,
    flags: list(raw.flags).map(String),
    injects,
    actions,
    rules,
    objectives,
    solution: list(raw.solution).map(String),
    references: list(raw.references).map(String),
    phases,
    status,
    attack,
    attackMatrix: raw.attack_matrix === "enterprise" ? "enterprise" : "ics",
    tailor,
    tailored: {},
    initialFlags: [],
  };
  const tailorIds = new Set(tailor.map((t) => t.id));
  for (const m of source.matchAll(/\{\{\s*[#^/]?([A-Za-z0-9_]+)\s*\}\}/g)) {
    if (!tailorIds.has(m[1])) problems.push(`placeholder {{${m[1]}}} has no matching tailor field`);
  }
  for (const m of source.matchAll(/\{\{[#^]([A-Za-z0-9_]+)\}\}/g)) {
    const f = tailor.find((t) => t.id === m[1]);
    if (f && f.type !== "toggle") problems.push(`{{#${m[1]}}} sections need a toggle field, but ${m[1]} is text`);
  }

  problems.push(...checkScenario(scenario));
  if (problems.length) throw new ScenarioError(problems, file || scenario.id);
  return applyTailoring(scenario);
}

/** Turn "yes", "no", "true", "1" and so on into a boolean. */
export function toBool(v: string | boolean): boolean {
  return typeof v === "boolean" ? v : /^(y|yes|true|1|on)$/i.test(v.trim());
}

/**
 * Fill in {{placeholders}} and switch on toggle flags. Values not given use the
 * field defaults. Works on an already tailored scenario too (it starts from the template).
 */
export function applyTailoring(s: Scenario, values: Record<string, string | boolean> = {}): Scenario {
  const template = s.template ?? s;
  const merged: Record<string, string | boolean> = {};
  for (const f of template.tailor) {
    const v = values[f.id];
    merged[f.id] = f.type === "toggle" ? (v === undefined ? (f.default as boolean) : toBool(v)) : v === undefined || String(v).trim() === "" ? String(f.default) : String(v).trim();
  }
  if (!template.tailor.length) return { ...template, tailored: {}, initialFlags: [], template };
  const { template: _drop, ...plain } = template;
  // {{#flag}}shown when yes{{/flag}} and {{^flag}}shown when no{{/flag}}
  const sections = /\{\{([#^])([A-Za-z0-9_]+)\}\}([\s\S]*?)\{\{\/\2\}\}/g;
  let json = JSON.stringify(plain);
  for (let i = 0; i < 5 && sections.test(json); i++) {
    json = json.replace(sections, (_, kind, id, body) => ((merged[id] === true) === (kind === "#") ? body : ""));
  }
  json = json.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (whole, id) => {
    if (!(id in merged)) return whole;
    const v = merged[id];
    return JSON.stringify(typeof v === "boolean" ? (v ? "yes" : "no") : v).slice(1, -1);
  });
  const out = JSON.parse(json) as Scenario;
  out.tailored = merged;
  out.initialFlags = template.tailor.filter((f) => f.type === "toggle" && merged[f.id] === true).map((f) => f.id);
  out.template = template;
  return out;
}

/** Cross-reference checks: ids, meters, flags and every condition. */
export function checkScenario(s: Scenario): string[] {
  const problems: string[] = [];
  if (s.id && !/^[a-z0-9][a-z0-9-]*$/.test(s.id)) problems.push(`id "${s.id}" should use lower case letters, digits and -`);
  if (s.limit <= 0) problems.push("limit must be more than zero");
  if (!s.objectives.length) problems.push("add at least one objective");
  if (!s.actions.length) problems.push("add at least one action");

  const ids = new Map<string, string>();
  for (const [kind, items] of [
    ["inject", s.injects],
    ["action", s.actions],
  ] as const) {
    for (const item of items) {
      if (!item.id) continue;
      if (!ID.test(item.id)) problems.push(`${kind} id "${item.id}" should use lower case letters, digits and _`);
      if (ids.has(item.id)) problems.push(`id "${item.id}" is used twice (${ids.get(item.id)} and ${kind}); action and inject ids share one namespace`);
      ids.set(item.id, kind);
    }
  }
  const ruleIds = new Set<string>();
  for (const r of s.rules) {
    if (ruleIds.has(r.id)) problems.push(`rule id "${r.id}" is used twice`);
    ruleIds.add(r.id);
  }

  const meterIds = new Set(s.meters.map((m) => m.id));
  const actionIds = new Set(s.actions.map((a) => a.id));
  const injectIds = new Set(s.injects.map((i) => i.id));
  const flags = new Set([...s.flags, ...s.tailor.filter((t) => t.type === "toggle").map((t) => t.id)]);
  const allEffects: [string, Effects][] = [
    ...s.injects.map((i) => [`inject ${i.id}`, i.effects] as [string, Effects]),
    ...s.actions.map((a) => [`action ${a.id}`, a.effects] as [string, Effects]),
    ...s.rules.map((r) => [`rule ${r.id}`, r.effects] as [string, Effects]),
  ];
  for (const [, e] of allEffects) [...e.set, ...e.clear].forEach((f) => flags.add(f));
  for (const f of flags) {
    if (!ID.test(f)) problems.push(`flag "${f}" should use lower case letters, digits and _`);
    if (meterIds.has(f) || f === "time") problems.push(`flag "${f}" clashes with a meter or with "time"`);
  }
  for (const [where, e] of allEffects) {
    for (const m of Object.keys(e.meters)) if (!meterIds.has(m)) problems.push(`${where}: changes meter "${m}", which is not defined`);
    for (const i of e.inject) if (!injectIds.has(i)) problems.push(`${where}: injects "${i}", which is not defined`);
  }

  const known = (name: string): boolean => {
    if (name === "time" || meterIds.has(name) || flags.has(name)) return true;
    const [ns, id] = name.split(".");
    if (ns === "did") return actionIds.has(id);
    if (ns === "seen") return injectIds.has(id);
    if (ns === "at") return actionIds.has(id) || injectIds.has(id);
    return false;
  };
  const checkExpr = (src: string | undefined, where: string) => {
    if (src === undefined) return;
    try {
      for (const name of identifiers(parseExpr(src))) {
        if (!known(name)) {
          const hint = name.includes(".") ? "" : " (flags are created by set or clear, or listed under flags:)";
          problems.push(`${where}: "${name}" is not a known meter, flag, action or inject${hint}`);
        }
      }
    } catch (err) {
      problems.push(`${where}: ${err instanceof ExprError ? err.message : String(err)}`);
    }
  };
  for (const i of s.injects) {
    checkExpr(i.when, `inject ${i.id}: when`);
    i.body.forEach((b, n) => checkExpr(b.when, `inject ${i.id}: body ${n + 1}`));
  }
  for (const a of s.actions) {
    checkExpr(a.when, `action ${a.id}: when`);
    a.result.forEach((b, n) => checkExpr(b.when, `action ${a.id}: result ${n + 1}`));
    if (a.result.length && a.result[a.result.length - 1].when) {
      problems.push(`action ${a.id}: the last result should have no "when", so there is always something to show`);
    }
  }
  for (const r of s.rules) checkExpr(r.when, `rule ${r.id}: when`);
  const phaseIds = new Set<string>();
  for (const ph of s.phases) {
    if (phaseIds.has(ph.id)) problems.push(`phase id "${ph.id}" is used twice`);
    phaseIds.add(ph.id);
    checkExpr(ph.when, `phase ${ph.id}: when`);
  }
  for (const st of s.status) st.states.forEach((x, n) => checkExpr(x.when, `status ${st.id}: state ${n + 1}`));
  for (const o of s.objectives) checkExpr(o.pass, `objective ${o.id}: pass`);

  for (const step of s.solution) {
    if (/^wait(\s+\S+)?$/.test(step)) continue;
    if (step === "end") continue;
    if (!actionIds.has(step.replace(/^\?/, ""))) problems.push(`solution step "${step}" is not an action id (or "?id" for an optional step, "wait 30m", or "end")`);
  }
  return problems;
}

/** The tailoring choices of a scenario as label and display value, for reports and MSELs. */
export function tailorSummary(s: Scenario): { id: string; label: string; value: string; changed: boolean }[] {
  const fields = (s.template ?? s).tailor;
  return fields.map((f) => {
    const v = s.tailored[f.id] ?? f.default;
    return { id: f.id, label: f.label, value: typeof v === "boolean" ? (v ? "yes" : "no") : String(v), changed: v !== f.default };
  });
}

/** Read key=value words, as typed after "play 8". Unknown keys are reported. */
export function parseTailorArgs(s: Scenario, words: string[]): { values: Record<string, string>; problems: string[] } {
  const fields = (s.template ?? s).tailor;
  const values: Record<string, string> = {};
  const problems: string[] = [];
  for (const w of words) {
    const i = w.indexOf("=");
    if (i < 1) {
      problems.push(`"${w}" is not a setting. Use name=value, for example ${fields[0] ? `${fields[0].id}=...` : "org=Acme"}.`);
      continue;
    }
    const key = w.slice(0, i);
    const f = fields.find((x) => x.id === key);
    if (!f) {
      problems.push(fields.length ? `${s.title} has no setting "${key}". Settings: ${fields.map((x) => x.id).join(", ")}.` : `${s.title} has no settings to change.`);
      continue;
    }
    const value = w.slice(i + 1);
    if (f.type === "toggle" && !/^(y|yes|true|1|on|n|no|false|0|off)$/i.test(value)) problems.push(`${key} takes yes or no.`);
    else values[key] = value;
  }
  return { values, problems };
}

