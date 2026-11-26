import { evaluate, isTrue, parse, type Node, type Value } from "./expr.js";
import { GROUPS, type Action, type Effects, type Group, type Inject, type Objective, type Phase, type Scenario, type StatusItem, type TextVariant, type Tone } from "./types.js";

export const NOT_YET = 99999;

export interface Delivered {
  inject: Inject;
  time: number;
  body: string;
  read: boolean;
}

export type LogKind = "inject" | "action" | "rule" | "phase" | "system" | "end";

export interface LogEntry {
  time: number;
  kind: LogKind;
  title: string;
  text?: string;
  /** Action group or inject id, for display. */
  ref?: string;
}

export interface ActResult {
  ok: boolean;
  error?: string;
  action?: Action;
  text?: string;
  events: LogEntry[];
}

export interface Debrief {
  score: number;
  passed: boolean;
  failed: boolean;
  endText: string;
  time: number;
  objectives: { objective: Objective; passed: boolean }[];
  meters: { id: string; label: string; start: number; value: number; good: "high" | "low" }[];
  lessons: { action: Action; text: string }[];
  groups: Record<Group, number>;
  actionsTaken: number;
}

export class Sim {
  readonly scenario: Scenario;
  time = 0;
  meters: Record<string, number> = {};
  flags = new Set<string>();
  /** Action or inject id -> minute it completed or arrived. */
  done = new Map<string, number>();
  inbox: Delivered[] = [];
  log: LogEntry[] = [];
  ended = false;
  failed = false;
  endText = "";
  /** Discussion phases reached, in order. */
  phases: { phase: Phase; time: number }[] = [];
  /** Player or team notes, by phase id. */
  notes: Record<string, string> = {};
  private fired = new Set<string>();
  private cache = new Map<string, Node>();
  private pending: LogEntry[] = [];

  constructor(scenario: Scenario) {
    this.scenario = scenario;
    for (const m of scenario.meters) this.meters[m.id] = m.start;
    this.deliverDue();
    this.settle();
    this.flush();
  }

  // ---- conditions -------------------------------------------------------

  private resolve = (name: string): Value => {
    if (name === "time") return this.time;
    if (name in this.meters) return this.meters[name];
    const dot = name.indexOf(".");
    if (dot > 0) {
      const ns = name.slice(0, dot);
      const id = name.slice(dot + 1);
      if (ns === "did" || ns === "seen") return this.done.has(id);
      if (ns === "at") return this.done.get(id) ?? NOT_YET;
    }
    return this.flags.has(name);
  };

  test(src: string | undefined): boolean {
    if (src === undefined || src.trim() === "") return true;
    let node = this.cache.get(src);
    if (!node) {
      node = parse(src);
      this.cache.set(src, node);
    }
    return isTrue(evaluate(node, this.resolve));
  }

  pick(variants: TextVariant[]): string {
    for (const v of variants) if (this.test(v.when)) return v.text;
    return variants.length ? variants[variants.length - 1].text : "";
  }

  // ---- what the player can do ------------------------------------------

  availableActions(): Action[] {
    if (this.ended) return [];
    return this.scenario.actions
      .filter((a) => (a.repeatable || !this.done.has(a.id)) && this.test(a.when))
      .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
  }

  findAction(ref: string): Action | undefined {
    const list = this.availableActions();
    if (/^\d+$/.test(ref)) return list[Number(ref) - 1];
    return list.find((a) => a.id === ref);
  }

  act(ref: string): ActResult {
    if (this.ended) return { ok: false, error: "The exercise has ended.", events: [] };
    const action = this.findAction(ref);
    if (!action) {
      const exists = this.scenario.actions.find((a) => a.id === ref);
      const error = exists
        ? this.done.has(exists.id) && !exists.repeatable
          ? "You have already done that."
          : "That action is not available right now."
        : `There is no action "${ref}". Type actions to see what you can do.`;
      return { ok: false, error, events: [] };
    }
    const logStart = this.log.length;
    this.advance(action.takes);
    if (this.ended) {
      this.flush();
      return { ok: false, action, error: "The exercise ended before that action could finish.", events: this.log.slice(logStart) };
    }
    this.done.set(action.id, this.time);
    const text = this.pick(action.result);
    this.pending.push({ time: this.time, kind: "action", title: action.label, text, ref: action.group });
    this.apply(action.effects, action.label);
    this.settle();
    this.checkLimit();
    this.flush();
    return { ok: true, action, text, events: this.log.slice(logStart) };
  }

  /** Let time pass. With no argument, wait until something new arrives (at most 60 minutes). */
  wait(minutes?: number): LogEntry[] {
    if (this.ended) return [];
    const logStart = this.log.length;
    if (minutes === undefined) {
      const before = this.inbox.length;
      const until = Math.min(this.time + 60, this.scenario.limit);
      while (!this.ended && this.time < until && this.inbox.length === before) this.advance(1);
    } else {
      this.advance(Math.max(1, Math.round(minutes)));
    }
    this.flush();
    return this.log.slice(logStart);
  }

  /** End the exercise now. */
  finish(text = "You ended the exercise."): void {
    if (this.ended) return;
    this.end("close", text);
    this.flush();
  }

  markRead(index: number): void {
    const item = this.inbox[index];
    if (item) item.read = true;
  }

  unread(): number {
    return this.inbox.filter((d) => !d.read).length;
  }

  // ---- time ---------------------------------------------------------------

  private advance(minutes: number): void {
    const target = this.time + minutes;
    while (!this.ended && this.time < target) {
      this.time++;
      this.deliverDue();
      for (const r of this.scenario.rules) {
        if (this.ended) break;
        if (r.every && this.time % r.every === 0 && this.test(r.when)) {
          if (r.text) this.pending.push({ time: this.time, kind: "rule", title: r.text, ref: r.id });
          this.apply(r.effects, r.text ?? "");
        }
      }
      this.settle();
      this.checkLimit();
    }
  }

  private checkLimit(): void {
    if (!this.ended && this.time >= this.scenario.limit) {
      this.end("close", "Time is up. The exercise ends here and your response is scored as it stands.");
    }
  }

  private deliverDue(): void {
    for (const inj of this.scenario.injects) {
      if (inj.at !== undefined && inj.at <= this.time && !this.done.has(inj.id) && this.test(inj.when)) this.deliver(inj);
    }
    for (const ph of this.scenario.phases) {
      if (ph.at !== undefined && ph.at <= this.time && !this.phaseReached(ph.id) && this.test(ph.when)) this.reachPhase(ph);
    }
  }

  phaseReached(id: string): boolean {
    return this.phases.some((p) => p.phase.id === id);
  }

  private reachPhase(ph: Phase): void {
    this.phases.push({ phase: ph, time: this.time });
    this.pending.push({ time: this.time, kind: "phase", title: ph.title, ref: ph.id });
  }

  /** Save notes for a discussion phase. */
  setNote(phaseId: string, text: string): void {
    if (text.trim()) this.notes[phaseId] = text;
    else delete this.notes[phaseId];
  }

  /** Current value of each status indicator. */
  statusNow(): { item: StatusItem; text: string; tone: Tone }[] {
    return this.scenario.status.map((item) => {
      const st = item.states.find((x) => this.test(x.when)) ?? item.states[item.states.length - 1];
      return { item, text: st.text, tone: st.tone };
    });
  }

  /** Fire condition-based injects and one-shot rules until nothing else changes. */
  private settle(): void {
    for (let pass = 0; pass < 25 && !this.ended; pass++) {
      let changed = false;
      for (const inj of this.scenario.injects) {
        if (this.ended) break;
        if (inj.at === undefined && !this.done.has(inj.id) && this.test(inj.when)) {
          this.deliver(inj);
          changed = true;
        }
      }
      for (const ph of this.scenario.phases) {
        if (ph.at === undefined && !this.phaseReached(ph.id) && this.test(ph.when)) {
          this.reachPhase(ph);
          changed = true;
        }
      }
      for (const r of this.scenario.rules) {
        if (this.ended) break;
        if (!r.every && !this.fired.has(r.id) && this.test(r.when)) {
          this.fired.add(r.id);
          if (r.text) this.pending.push({ time: this.time, kind: "rule", title: r.text, ref: r.id });
          this.apply(r.effects, r.text ?? "");
          changed = true;
        }
      }
      if (!changed) return;
    }
  }

  private deliver(inj: Inject): void {
    this.done.set(inj.id, this.time);
    const body = this.pick(inj.body);
    this.inbox.push({ inject: inj, time: this.time, body, read: false });
    this.pending.push({ time: this.time, kind: "inject", title: `${inj.from}: ${inj.subject}`, ref: inj.id });
    this.apply(inj.effects, inj.subject);
  }

  private apply(e: Effects, source: string): void {
    for (const f of e.set) this.flags.add(f);
    for (const f of e.clear) this.flags.delete(f);
    for (const [m, delta] of Object.entries(e.meters)) {
      if (m in this.meters) this.meters[m] = Math.max(0, Math.min(100, this.meters[m] + delta));
    }
    for (const id of e.inject) {
      const inj = this.scenario.injects.find((i) => i.id === id);
      if (inj && !this.done.has(id)) this.deliver(inj);
    }
    if (e.end) this.end(e.end.outcome, e.end.text ?? (e.end.outcome === "fail" ? source : "You closed the incident."));
  }

  private end(outcome: "close" | "fail", text: string): void {
    if (this.ended) return;
    this.ended = true;
    this.failed = outcome === "fail";
    this.endText = text;
    this.pending.push({ time: this.time, kind: "end", title: outcome === "fail" ? "The exercise ended badly" : "The exercise has ended", text, ref: outcome });
  }

  private flush(): void {
    this.log.push(...this.pending);
    this.pending = [];
  }

  // ---- scoring --------------------------------------------------------------

  debrief(): Debrief {
    const objectives = this.scenario.objectives.map((objective) => ({ objective, passed: this.test(objective.pass) }));
    const total = objectives.reduce((s, o) => s + o.objective.weight, 0);
    const got = objectives.reduce((s, o) => s + (o.passed ? o.objective.weight : 0), 0);
    const score = total ? Math.round((100 * got) / total) : 0;
    const groups = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<Group, number>;
    const lessons: { action: Action; text: string }[] = [];
    let actionsTaken = 0;
    for (const a of this.scenario.actions) {
      if (!this.done.has(a.id)) continue;
      actionsTaken++;
      groups[a.group]++;
      if (a.lesson) lessons.push({ action: a, text: a.lesson });
    }
    return {
      score,
      passed: !this.failed && score >= this.scenario.passMark,
      failed: this.failed,
      endText: this.endText,
      time: this.time,
      objectives,
      meters: this.scenario.meters.map((m) => ({ id: m.id, label: m.label, start: m.start, value: this.meters[m.id], good: m.good })),
      lessons,
      groups,
      actionsTaken,
    };
  }
}

/** Play a scenario's solution (or any list of steps). Used by tests and the validator. */
export function runSteps(scenario: Scenario, steps: string[]): Sim {
  const sim = new Sim(scenario);
  for (const step of steps) {
    if (sim.ended) break;
    const w = /^wait(?:\s+(\S+))?$/.exec(step);
    if (w) {
      sim.wait(w[1] === undefined ? undefined : toMinutes(w[1]));
      continue;
    }
    if (step === "end") {
      sim.finish();
      break;
    }
    const r = sim.act(step);
    if (!r.ok) throw new Error(`step "${step}" at ${sim.time} min: ${r.error}`);
  }
  return sim;
}

function toMinutes(s: string): number {
  const m = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m?)?$/.exec(s);
  if (!m) return 30;
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}
