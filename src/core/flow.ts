import { Sim, type LogEntry } from "./engine.js";
import { identifiers, parse } from "./expr.js";
import { clockLabel, elapsedLabel } from "./clock.js";
import { attackMarkdown } from "./attack.js";
import { CHANNEL_LABELS, GROUP_INFO, type Action, type Group, type Scenario } from "./types.js";

/**
 * The flow of a scenario, worked out by playing it:
 *  - the spine is what happens when you follow the scenario's own solution
 *  - "missed" branches are what happens instead if you skip one of those actions
 *  - "trap" branches are tempting actions with a lesson, attached where they first appear
 */

export type BranchKind = "trap" | "missed" | "fail";

export interface FlowBranch {
  kind: BranchKind;
  /** Inject, rule or action id, or "fail". */
  id: string;
  title: string;
  detail: string;
}

export interface FlowStep {
  kind: "inject" | "action" | "end";
  id: string;
  time: number;
  title: string;
  detail: string;
  group?: Group;
  branches: FlowBranch[];
}

export interface Flow {
  scenario: Scenario;
  steps: FlowStep[];
}

const firstSentence = (s: string) => {
  const flat = s.replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(flat);
  return m ? m[1] : flat;
};

/** Play a list of steps, skipping any that aren't available (or are named in `skip`). */
function playLoose(s: Scenario, steps: string[], skip?: string): { sim: Sim; availability: { at: number; ids: Set<string> }[] } {
  const sim = new Sim(s);
  const availability = [{ at: sim.log.length, ids: new Set(sim.availableActions().map((a) => a.id)) }];
  for (const step of steps) {
    if (sim.ended) break;
    const w = /^wait(?:\s+(\S+))?$/.exec(step);
    if (w) {
      sim.wait(w[1] === undefined ? undefined : minutes(w[1]));
    } else if (step === "end") {
      sim.finish();
    } else {
      const id = step.replace(/^\?/, "");
      if (id === skip) continue;
      if (!sim.availableActions().some((a) => a.id === id)) continue;
      sim.act(id);
    }
    availability.push({ at: sim.log.length, ids: new Set(sim.availableActions().map((a) => a.id)) });
  }
  if (!sim.ended) sim.finish();
  return { sim, availability };
}

function minutes(v: string): number {
  const m = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m?)?$/.exec(v);
  return m ? Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 30;
}

/** A key for "something visible happened": an inject, a rule message or a failed ending. */
function eventKey(e: LogEntry): string | undefined {
  if (e.kind === "inject" && e.ref) return `inject:${e.ref}`;
  if (e.kind === "rule" && e.ref) return `rule:${e.ref}`;
  if (e.kind === "end" && e.ref === "fail") return "fail";
  return undefined;
}

function describeEvent(s: Scenario, e: LogEntry, sim: Sim): FlowBranch | undefined {
  if (e.kind === "inject" && e.ref) {
    const inj = s.injects.find((i) => i.id === e.ref);
    const d = sim.inbox.find((x) => x.inject.id === e.ref);
    if (!inj) return undefined;
    return { kind: "missed", id: inj.id, title: inj.subject, detail: `${CHANNEL_LABELS[inj.via]} from ${inj.from}. ${firstSentence(d?.body ?? "")}` };
  }
  if (e.kind === "rule" && e.ref) return { kind: "missed", id: e.ref, title: firstSentence(e.title), detail: e.title };
  if (e.kind === "end" && e.ref === "fail") return { kind: "fail", id: "fail", title: "The exercise fails", detail: firstSentence(e.text ?? "") };
  return undefined;
}

export function buildFlow(s: Scenario): Flow {
  const solutionIds = s.solution.filter((x) => !/^wait|^end$/.test(x)).map((x) => x.replace(/^\?/, ""));
  const { sim: base, availability } = playLoose(s, s.solution);
  const baseKeys = new Set(base.log.map(eventKey).filter(Boolean) as string[]);

  // The spine: injects and actions from the solution run, in order.
  const steps: FlowStep[] = [];
  const stepAtLog: number[] = [];
  base.log.forEach((e, i) => {
    if (e.kind === "inject" && e.ref) {
      const inj = s.injects.find((x) => x.id === e.ref)!;
      steps.push({ kind: "inject", id: inj.id, time: e.time, title: inj.subject, detail: `${CHANNEL_LABELS[inj.via]} from ${inj.from}`, branches: [] });
      stepAtLog.push(i);
    } else if (e.kind === "action") {
      const a = s.actions.find((x) => x.label === e.title);
      if (!a) return;
      steps.push({ kind: "action", id: a.id, time: e.time, title: a.label, detail: firstSentence(e.text ?? ""), group: a.group, branches: [] });
      stepAtLog.push(i);
    } else if (e.kind === "end") {
      steps.push({ kind: "end", id: "end", time: e.time, title: "The exercise ends", detail: firstSentence(e.text ?? ""), branches: [] });
      stepAtLog.push(i);
    }
  });

  // Missed branches: skip each solution action in turn and see what happens instead.
  const owner = new Map<string, { branch: FlowBranch; action: string }>();
  for (const id of solutionIds) {
    const { sim } = playLoose(s, s.solution, id);
    for (const e of sim.log) {
      const key = eventKey(e);
      if (!key || baseKeys.has(key)) continue;
      const branch = describeEvent(s, e, sim);
      if (branch) owner.set(key, { branch, action: id }); // the last action whose absence causes it wins
    }
  }
  for (const { branch, action } of owner.values()) {
    const step = steps.find((x) => x.kind === "action" && x.id === action);
    if (step && !step.branches.some((b) => b.id === branch.id)) step.branches.push(branch);
  }

  // Trap branches: actions with a lesson that the solution doesn't take, placed where they first appear.
  const traps = s.actions.filter((a) => a.lesson && !solutionIds.includes(a.id));
  for (const t of traps) {
    const seen = availability.find((x) => x.ids.has(t.id));
    if (!seen) continue;
    // A trap unlocked by a message belongs next to that message.
    let enabler = -1;
    try {
      const ids = t.when ? identifiers(parse(t.when)) : new Set<string>();
      enabler = steps.findIndex((x) => x.kind === "inject" && ids.has(`seen.${x.id}`));
    } catch {
      enabler = -1;
    }
    let idx = enabler >= 0 ? enabler : stepAtLog.findIndex((logIndex) => logIndex >= seen.at) - 1;
    if (idx < 0) idx = enabler >= 0 ? enabler : steps.length - 1;
    while (idx > 0 && steps[idx].kind === "end") idx--;
    steps[idx].branches.push({ kind: "trap", id: t.id, title: t.label, detail: firstSentence(t.lesson!) });
  }
  return { scenario: s, steps };
}

// ---- the player's own path ---------------------------------------------------------

export interface PathOverlay {
  /** Spine step ids the player also completed (actions) or received (injects). */
  done: Set<string>;
  /** Branch ids that happened in the player's run (missed consequences, failure, traps taken). */
  happened: Set<string>;
  /** Actions the player took that are not on the spine and not traps. */
  extra: Action[];
}

export function overlayPath(flow: Flow, sim: Sim): PathOverlay {
  const done = new Set<string>();
  for (const step of flow.steps) {
    if (step.kind === "end" ? sim.ended : sim.done.has(step.id)) done.add(step.id);
  }
  const happened = new Set<string>();
  for (const step of flow.steps) {
    for (const b of step.branches) {
      if (b.kind === "fail" ? sim.failed : b.kind === "trap" ? sim.done.has(b.id) : sim.done.has(b.id) || sim.log.some((e) => e.kind === "rule" && e.ref === b.id)) {
        happened.add(b.id);
      }
    }
  }
  const onMap = new Set(flow.steps.flatMap((x) => [x.id, ...x.branches.map((b) => b.id)]));
  const extra = flow.scenario.actions.filter((a) => sim.done.has(a.id) && !onMap.has(a.id));
  return { done, happened, extra };
}

// ---- MSEL (master scenario events list) ---------------------------------------------

export interface MselRow {
  n: number;
  time: string;
  elapsed: string;
  kind: "Inject" | "Contingent inject";
  via: string;
  from: string;
  event: string;
  message: string;
  trigger: string;
  expected: string[];
  objectives: string[];
}

/** Objectives whose pass condition refers to an action, directly or through a flag it sets. */
function objectivesFor(s: Scenario, action: Action): string[] {
  const flags = new Set([...action.effects.set]);
  return s.objectives
    .filter((o) => {
      try {
        const ids = identifiers(parse(o.pass));
        return ids.has(`did.${action.id}`) || ids.has(`at.${action.id}`) || [...flags].some((f) => ids.has(f));
      } catch {
        return false;
      }
    })
    .map((o) => o.text);
}

/** Turn a condition into something a facilitator can read. */
export function readableCondition(s: Scenario, src: string | undefined): string {
  if (!src) return "";
  const label = (id: string) => s.actions.find((a) => a.id === id)?.label ?? s.injects.find((i) => i.id === id)?.subject ?? id;
  return src
    .replace(/\btime\b/g, "\u0000")
    .replace(/\bdid\.([a-z0-9_]+)/g, (_, id) => `done "${label(id)}"`)
    .replace(/\bseen\.([a-z0-9_]+)/g, (_, id) => `received "${label(id)}"`)
    .replace(/\bat\.([a-z0-9_]+)/g, (_, id) => `time of "${label(id)}"`)
    .replace(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b(?=(?:[^"]*"[^"]*")*[^"]*$)/g, (m) => m.replace(/_/g, " "))
    .replace(/\u0000/g, "minutes elapsed")
    .replace(/(\d+)(?=\s|$|\))/g, "$1")
    .replace(/>=/g, "is at least")
    .replace(/<=/g, "is at most");
}

export function buildMsel(flow: Flow): MselRow[] {
  const s = flow.scenario;
  const { sim } = playLoose(s, s.solution);
  const rows: MselRow[] = [];
  const spine = flow.steps;
  // Credit each expected action to the message that was current when the action started.
  const injectSteps = spine.filter((x) => x.kind === "inject");
  const expectedFor = new Map<string, Action[]>();
  for (const step of spine) {
    if (step.kind !== "action") continue;
    const a = s.actions.find((x) => x.id === step.id);
    if (!a) continue;
    const started = step.time - a.takes;
    const current = [...injectSteps].reverse().find((x) => x.time <= started) ?? injectSteps[0];
    if (!current) continue;
    expectedFor.set(current.id, [...(expectedFor.get(current.id) ?? []), a]);
  }
  spine.forEach((step) => {
    if (step.kind !== "inject") return;
    const inj = s.injects.find((x) => x.id === step.id)!;
    const expected = expectedFor.get(inj.id) ?? [];
    rows.push({
      n: 0,
      time: clockLabel(s, step.time),
      elapsed: elapsedLabel(step.time),
      kind: "Inject",
      via: CHANNEL_LABELS[inj.via],
      from: inj.from,
      event: inj.subject,
      message: sim.inbox.find((d) => d.inject.id === inj.id)?.body ?? inj.body[inj.body.length - 1].text,
      trigger: inj.at !== undefined && !inj.when ? `At ${clockLabel(s, inj.at)}` : inj.at !== undefined ? `At ${clockLabel(s, inj.at)} if ${readableCondition(s, inj.when)}` : `When ${readableCondition(s, inj.when)}`,
      expected: expected.map((a) => a.label),
      objectives: [...new Set(expected.flatMap((a) => objectivesFor(s, a)))],
    });
  });
  // Contingent injects: things that only happen when players miss something.
  const contingent = new Map<string, string>();
  for (const step of spine) for (const b of step.branches) if (b.kind === "missed" && s.injects.some((x) => x.id === b.id)) contingent.set(b.id, step.title);
  for (const [id, preventedBy] of contingent) {
    const inj = s.injects.find((x) => x.id === id)!;
    rows.push({
      n: 0,
      time: inj.at !== undefined ? clockLabel(s, inj.at) : "",
      elapsed: inj.at !== undefined ? elapsedLabel(inj.at) : "",
      kind: "Contingent inject",
      via: CHANNEL_LABELS[inj.via],
      from: inj.from,
      event: inj.subject,
      message: inj.body[inj.body.length - 1].text,
      trigger: inj.at !== undefined && inj.when ? `At ${clockLabel(s, inj.at)} or later, if ${readableCondition(s, inj.when)}` : inj.when ? `When ${readableCondition(s, inj.when)}` : `At ${clockLabel(s, inj.at ?? 0)}`,
      expected: [`Prevented by: ${preventedBy}`],
      objectives: [],
    });
  }
  rows.forEach((r, i) => (r.n = i + 1));
  return rows;
}

const flat = (t: string) => t.replace(/\s+/g, " ").trim();

export function mselMarkdown(flow: Flow): string {
  const s = flow.scenario;
  const rows = buildMsel(flow);
  const out: string[] = [];
  out.push(`# Master scenario events list: ${s.title}`);
  out.push("");
  out.push(`Generated by TTXSim from the scenario file. For facilitators only: it shows the expected player actions. All organizations and events are fictional.`);
  out.push("");
  out.push(`- **Organization:** ${s.org}${s.sector ? ` (${s.sector})` : ""}`);
  out.push(`- **Player role:** ${s.role}`);
  out.push(`- **Exercise clock:** starts ${clockLabel(s, 0)}, ends by ${clockLabel(s, s.limit)}`);
  out.push("");
  out.push("## Objectives");
  out.push("");
  for (const o of s.objectives) out.push(`- ${o.text}`);
  out.push("");
  out.push("## Events");
  out.push("");
  out.push("| # | Time | Type | Via | From | Event | Trigger | Expected player actions | Objectives |");
  out.push("| ---: | --- | --- | --- | --- | --- | --- | --- | --- |");
  const cell = (t: string) => flat(t).replace(/\|/g, "/");
  for (const r of rows) {
    out.push(
      `| ${r.n} | ${r.time} ${r.elapsed ? `(${r.elapsed})` : ""} | ${r.kind} | ${r.via} | ${cell(r.from)} | ${cell(r.event)} | ${cell(r.trigger)} | ${r.expected.map(cell).join("<br>")} | ${r.objectives.map(cell).join("<br>")} |`,
    );
  }
  out.push("");
  out.push("## Inject text");
  out.push("");
  for (const r of rows) {
    out.push(`### ${r.n}. ${r.event} (${r.kind.toLowerCase()})`);
    out.push("");
    out.push(`${r.via} from ${r.from}${r.time ? `, ${r.time}` : ""}`);
    out.push("");
    out.push(r.message.trim());
    out.push("");
  }
  if (s.phases.length) {
    out.push("## Discussion phases");
    out.push("");
    for (const ph of s.phases) {
      const when = ph.at !== undefined && !ph.when ? `at ${clockLabel(s, ph.at)}` : ph.at !== undefined ? `at ${clockLabel(s, ph.at)} or later, when ${readableCondition(s, ph.when)}` : `when ${readableCondition(s, ph.when)}`;
      out.push(`### ${ph.title} (${when})`);
      out.push("");
      if (ph.text) {
        out.push(ph.text.trim());
        out.push("");
      }
      for (const q of ph.questions) out.push(`- ${q}`);
      out.push("");
    }
  }
  if (s.attack.length) out.push(attackMarkdown(s));
  const traps = flow.steps.flatMap((x) => x.branches.filter((b) => b.kind === "trap"));
  if (traps.length) {
    out.push("## Traps to watch for");
    out.push("");
    for (const t of traps) out.push(`- **${t.title}:** ${s.actions.find((a) => a.id === t.id)?.lesson?.replace(/\s+/g, " ").trim() ?? t.detail}`);
    out.push("");
  }
  return out.join("\n");
}

export function mselCsv(flow: Flow): string {
  const rows = buildMsel(flow);
  const q = (t: string) => `"${flat(t).replace(/"/g, '""')}"`;
  const lines = [["#", "Time", "Elapsed", "Type", "Via", "From", "Event", "Message", "Trigger", "Expected player actions", "Objectives"].map(q).join(",")];
  for (const r of rows) {
    lines.push([String(r.n), r.time, r.elapsed, r.kind, r.via, r.from, r.event, r.message, r.trigger, r.expected.join("; "), r.objectives.join("; ")].map(q).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export function groupLabel(g?: Group): string {
  return g ? GROUP_INFO[g].label : "";
}
