#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  builtinScenarios,
  CHANNEL_LABELS,
  clockLabel,
  duration,
  elapsedLabel,
  grade,
  GROUP_INFO,
  GROUPS,
  LEVEL_LABELS,
  loadScenario,
  applyTailoring,
  parseTailorArgs,
  tailorSummary,
  reportMarkdown,
  ScenarioError,
  Sim,
  buildFlow,
  groupLabel,
  mselCsv,
  mselMarkdown,
  overlayPath,
  type LogEntry,
  type Scenario,
} from "../core/index.js";
import { bar, c, md, rule } from "./term.js";
import { validate } from "./validate.js";

const VERSION = "0.1.0";

// ---- progress ---------------------------------------------------------------

const progressFile = join(process.env.TTXSIM_HOME ?? join(homedir(), ".ttxsim"), "progress.json");

function loadProgress(): Record<string, number> {
  try {
    return JSON.parse(readFileSync(progressFile, "utf8"));
  } catch {
    return {};
  }
}

function saveProgress(id: string, score: number): void {
  const p = loadProgress();
  if ((p[id] ?? -1) >= score) return;
  p[id] = score;
  try {
    mkdirSync(join(progressFile, ".."), { recursive: true });
    writeFileSync(progressFile, JSON.stringify(p, null, 2));
  } catch {
    // Progress is a convenience. Ignore a read-only home folder.
  }
}

// ---- state -------------------------------------------------------------------

let scenarios: Scenario[] = [];
let sim: Sim | undefined;
let reported = false;

function say(s = ""): void {
  console.log(s);
}

function header(): string {
  if (!sim) return "";
  const s = sim.scenario;
  return `${c.bold(clockLabel(s, sim.time))} ${c.dim(elapsedLabel(sim.time))}`;
}

function listScenarios(): void {
  const progress = loadProgress();
  let level = "";
  scenarios.forEach((s, i) => {
    if (s.level !== level) {
      level = s.level;
      say();
      say(c.bold(LEVEL_LABELS[s.level]));
    }
    const best = progress[s.id];
    const mark = best === undefined ? "  " : best >= s.passMark ? c.green("✔ ") : c.yellow("· ");
    const num = String(i + 1).padStart(2);
    say(`  ${mark}${num}. ${s.title} ${c.dim(`(about ${s.minutes} min${best !== undefined ? `, best ${best}%` : ""})`)}`);
    say(`        ${c.dim(s.summary)}`);
  });
  say();
  say(`Type ${c.cyan("play 1")} to start, or ${c.cyan("load my-scenario.yaml")} for your own.`);
}

function start(s: Scenario): void {
  sim = new Sim(s);
  reported = false;
  say();
  say(rule(s.title));
  say(c.dim(`${s.org}${s.sector ? ` · ${s.sector}` : ""} · ${LEVEL_LABELS[s.level]}`));
  say();
  say(md(`**${s.role}**`));
  say();
  say(md(s.briefing));
  say();
  say(c.bold("Objectives"));
  for (const o of s.objectives) say(`  - ${o.text}`);
  say();
  const setup = tailorSummary(s);
  if (setup.length) {
    say(c.dim(`Setup: ${setup.map((t) => `${t.label}: ${t.value}`).join("; ")}. Type setup to see what you can change.`));
  }
  say(c.dim(`The exercise starts at ${clockLabel(s, 0)} and runs for up to ${duration(s.limit)}.`));
  say(c.dim(`Useful commands: inbox, read, actions, do <n>, wait, status, log, help.`));
  say();
  showEvents(sim.log);
}

function showMessage(i: number): void {
  if (!sim) return;
  const d = sim.inbox[i];
  if (!d) {
    say(c.red("No message with that number."));
    return;
  }
  sim.markRead(i);
  say(rule(`${CHANNEL_LABELS[d.inject.via]} · ${clockLabel(sim.scenario, d.time)}`));
  say(`${c.bold("From:")} ${d.inject.from}`);
  say(`${c.bold("Subject:")} ${d.inject.subject}`);
  say();
  say(md(d.body));
  say();
}

function showEvents(events: LogEntry[]): void {
  if (!sim) return;
  for (const e of events) {
    if (e.kind === "inject") {
      const i = sim.inbox.findIndex((d) => d.inject.id === e.ref);
      if (i >= 0) showMessage(i);
    } else if (e.kind === "action") {
      say(rule(`${clockLabel(sim.scenario, e.time)} · Done: ${e.title}`));
      if (e.text) say(md(e.text));
      say();
    } else if (e.kind === "phase") {
      showPhase(e.ref!);
    } else if (e.kind === "rule") {
      say(c.yellow(`  ${clockLabel(sim.scenario, e.time)}  ${e.title}`));
    } else if (e.kind === "end") {
      showDebrief();
    }
  }
}

function showPhase(id: string): void {
  if (!sim) return;
  const ph = sim.scenario.phases.find((x) => x.id === id);
  if (!ph) return;
  say(rule(`Discussion: ${ph.title}`));
  if (ph.text) {
    say(md(ph.text));
    say();
  }
  ph.questions.forEach((q, i) => say(`  ${c.cyan(`${i + 1}.`)} ${q}`));
  say();
  say(c.dim("  Talk it through, then type note <text> to record your answer. It goes into your report."));
  say();
}

function statusLine(): string {
  if (!sim || !sim.scenario.status.length) return "";
  const tone = (t: string, x: string) => (t === "ok" ? c.green(x) : t === "bad" ? c.red(x) : t === "warn" ? c.yellow(x) : c.cyan(x));
  return sim
    .statusNow()
    .map((st) => `${c.dim(st.item.label + ":")} ${tone(st.tone, st.text)}`)
    .join(c.dim("  ·  "));
}

function showInbox(): void {
  if (!sim) return;
  if (!sim.inbox.length) {
    say("Your inbox is empty.");
    return;
  }
  sim.inbox.forEach((d, i) => {
    const mark = d.read ? "  " : c.cyan("● ");
    say(`${mark}${String(i + 1).padStart(2)}. ${c.dim(clockLabel(sim!.scenario, d.time))}  ${c.dim(CHANNEL_LABELS[d.inject.via].padEnd(11))} ${d.inject.from}: ${d.read ? d.inject.subject : c.bold(d.inject.subject)}`);
  });
}

function showActions(): void {
  if (!sim) return;
  const list = sim.availableActions();
  if (!list.length) {
    say(sim.ended ? "The exercise has ended. Type report, or next." : "Nothing to do right now. Try wait.");
    return;
  }
  for (const g of GROUPS) {
    const items = list.map((a, i) => ({ a, i })).filter((x) => x.a.group === g);
    if (!items.length) continue;
    say(c.bold(GROUP_INFO[g].label));
    for (const { a, i } of items) say(`  ${String(i + 1).padStart(2)}. ${a.label} ${c.dim(`(${duration(a.takes)})`)}`);
  }
  say();
  say(c.dim("Type do <number>. Each action takes the time shown, and the world keeps moving while you work."));
}

function showStatus(): void {
  if (!sim) {
    say("No exercise running. Type scenarios.");
    return;
  }
  const s = sim.scenario;
  say(`${header()}  ${c.dim(`ends at ${clockLabel(s, s.limit)} at the latest`)}`);
  for (const m of s.meters) {
    say(`  ${m.label.padEnd(22)} ${bar(sim.meters[m.id], m.good)} ${String(sim.meters[m.id]).padStart(3)}  ${c.dim(m.good === "high" ? "higher is better" : "lower is better")}`);
  }
  if (s.status.length) {
    say();
    say(`  ${statusLine()}`);
  }
  say();
  say(c.bold("Objectives"));
  for (const o of s.objectives) say(`  - ${o.text}`);
  const unread = sim.unread();
  if (unread) say(c.cyan(`\n${unread} unread message${unread === 1 ? "" : "s"}. Type read.`));
}

function showLog(): void {
  if (!sim) return;
  for (const e of sim.log) {
    const t = c.dim(clockLabel(sim.scenario, e.time).padEnd(10));
    const what = e.kind === "inject" ? `Received  ${e.title}` : e.kind === "action" ? c.green(`Action    ${e.title}`) : e.kind === "rule" ? c.yellow(`          ${e.title}`) : c.bold(e.title);
    say(`${t} ${what}`);
  }
}

function showDebrief(): void {
  if (!sim) return;
  const s = sim.scenario;
  const d = sim.debrief();
  saveProgress(s.id, d.score);
  say();
  say(rule("Debrief"));
  say(md(d.endText));
  say();
  const g = grade(d, s);
  say(`  ${c.bold("Result:")} ${d.passed ? c.green(g) : c.red(g)}  ${c.bold(`${d.score}%`)} ${c.dim(`(pass mark ${s.passMark}%)`)}`);
  say(`  ${c.bold("Time used:")} ${duration(d.time)}, ending at ${clockLabel(s, d.time)}`);
  say();
  for (const o of d.objectives) {
    say(`  ${o.passed ? c.green("✔") : c.red("✘")} ${c.bold(o.objective.text)}`);
    say(md(o.passed ? o.objective.hit : o.objective.miss, "      "));
  }
  if (d.lessons.length) {
    say();
    say(c.bold("  Notes on your decisions"));
    for (const l of d.lessons) {
      say(`  ${c.yellow("•")} ${l.action.label}`);
      say(md(l.text, "      "));
    }
  }
  if (s.attack.length) {
    say();
    say(c.bold(`  Attack path (MITRE ATT&CK${s.attackMatrix === "ics" ? " for ICS" : ""})`));
    s.attack.forEach((a, i) => say(`  ${i + 1}. ${c.dim(a.tactic.padEnd(26))} ${a.technique} ${a.name}`));
  }
  say();
  say(c.dim(`Type report to save an after-action report, map to see your path, play ${[scenarios.findIndex((x) => x.id === s.id) + 1, settingArgs(s)].filter(Boolean).join(" ")} to try again, or next.`));
}

function writeReport(file?: string): void {
  if (!sim) return;
  if (!sim.ended) {
    say("The report is ready once the exercise ends. Type end to finish now.");
    return;
  }
  const out = resolve(file ?? `ttxsim-report-${sim.scenario.id}.md`);
  writeFileSync(out, reportMarkdown(sim));
  reported = true;
  say(`Saved ${out}`);
}

function parseWait(arg: string | undefined): number | undefined | null {
  if (!arg) return undefined;
  const m = /^(?:(\d+)h)?(?:(\d+)m?)?$/.exec(arg.trim());
  if (!m || (!m[1] && !m[2])) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}

function showMap(s: Scenario): void {
  const flow = buildFlow(s);
  const overlay = sim && sim.scenario.id === s.id && sim.ended ? overlayPath(flow, sim) : undefined;
  say(rule(`Scenario map: ${s.title}`));
  say(c.dim(overlay ? "Your path is marked: ✔ you did it, ✘ you missed it, ! it happened to you." : "Spoilers: this is the model response, with traps and the consequences of skipping steps."));
  say();
  for (const step of flow.steps) {
    const kind = step.kind === "inject" ? "Message" : step.kind === "end" ? "End" : groupLabel(step.group);
    let mark = "  ";
    if (overlay && step.kind === "action") mark = overlay.done.has(step.id) ? c.green("✔ ") : c.red("✘ ");
    say(`${c.dim(clockLabel(s, step.time).padEnd(10))} ${mark}${c.dim(kind.padEnd(12))} ${step.kind === "action" ? c.bold(step.title) : step.title}`);
    for (const b of step.branches) {
      const hit = overlay?.happened.has(b.id) ? c.red("! ") : "  ";
      const label = b.kind === "trap" ? c.red("trap") : b.kind === "fail" ? c.red("fail") : c.yellow("if skipped");
      say(`${" ".repeat(13)}${hit}└─ ${label}: ${b.title}`);
    }
  }
  say();
  say(c.dim(`Type msel ${[scenarios.findIndex((x) => x.id === s.id) + 1 || s.id, settingArgs(s)].filter(Boolean).join(" ")} to save the master scenario events list for facilitators.`));
}

function writeMsel(s: Scenario, file?: string): void {
  const out = resolve(file ?? `ttxsim-msel-${s.id}.md`);
  const flow = buildFlow(s);
  writeFileSync(out, out.endsWith(".csv") ? mselCsv(flow) : mselMarkdown(flow));
  say(`Saved ${out}`);
}

function help(): void {
  say(`${c.bold("Before an exercise")}
  scenarios              list the scenarios
  play <n|id> [k=v ...]  start one, optionally with your own settings
  setup <n|id>           show the settings a scenario can take
  load <file.yaml>       start your own scenario file

${c.bold("During an exercise")}
  inbox                  list the messages you have received
  read [n]               read message n, or the next unread one
  actions                list what you can do right now
  do <n|id>              take an action (each one takes time)
  wait [30m|1h]          let time pass; on its own, waits for the next message
  status                 clock, measures and objectives
  brief                  show the briefing again
  log                    timeline so far
  discuss                show the current discussion questions again
  note <text>            record your answer to the current discussion point
  notes                  show your notes
  end                    finish now and see your debrief

${c.bold("After an exercise")}
  report [file]          save a Markdown after-action report
  map                    show the scenario map with your path marked
  next                   start the next scenario

${c.bold("For facilitators")}
  map <n|id>             show a scenario's map (spoilers)
  msel <n|id> [file]     save the master scenario events list (.md, or .csv)

  help, quit`);
}

function pickScenario(ref: string): Scenario | undefined {
  if (/^\d+$/.test(ref)) return scenarios[Number(ref) - 1];
  return scenarios.find((s) => s.id === ref);
}

/** Split a typed line into words, keeping "quoted text" together. */
function words(line: string): string[] {
  return (line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map((w) => w.replace(/"([^"]*)"|'([^']*)'/g, "$1$2"));
}

/** Apply key=value settings to a scenario, or print what is wrong and return undefined. */
function tailored(s: Scenario, settings: string[]): Scenario | undefined {
  if (!settings.length) return s;
  const { values, problems } = parseTailorArgs(s, settings);
  if (problems.length) {
    for (const p of problems) say(c.red(p));
    return undefined;
  }
  return applyTailoring(s, values);
}

/** The key=value words that reproduce a scenario's non-default settings. */
function settingArgs(s: Scenario): string {
  return tailorSummary(s)
    .filter((t) => t.changed)
    .map((t) => `${t.id}=${/\s/.test(t.value) ? `"${t.value}"` : t.value}`)
    .join(" ");
}

function showSetup(s: Scenario): void {
  const fields = tailorSummary(s);
  const n = scenarios.findIndex((x) => x.id === s.id) + 1;
  say(rule(`Setup: ${s.title}`));
  if (!fields.length) {
    say("This scenario has no settings to change.");
    return;
  }
  const defs = (s.template ?? s).tailor;
  for (const t of fields) {
    const f = defs.find((x) => x.id === t.id)!;
    say(`  ${c.cyan(t.id.padEnd(16))} ${t.label}: ${c.bold(t.value)}${f.type === "toggle" ? c.dim(" (yes or no)") : ""}`);
    if (f.help) say(`  ${" ".repeat(16)} ${c.dim(f.help)}`);
  }
  say();
  const sample = defs.map((f) => (f.type === "toggle" ? `${f.id}=${f.default ? "no" : "yes"}` : `${f.id}="Your ${f.label.toLowerCase()}"`))[0];
  say(`Type ${c.cyan(`play ${n || s.id} ${sample}`)} to start with your own settings.`);
}

function loadFile(file: string): Scenario | undefined {
  try {
    return loadScenario(readFileSync(file, "utf8"), file);
  } catch (err) {
    if (err instanceof ScenarioError) say(c.red(err.message));
    else say(c.red(`Could not read ${file}: ${(err as Error).message}`));
    return undefined;
  }
}

function run(line: string): boolean {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  const typed = words(line.trim()).slice(1);
  const arg = rest.join(" ");
  switch ((cmd ?? "").toLowerCase()) {
    case "":
      return true;
    case "help":
    case "?":
      help();
      return true;
    case "quit":
    case "exit":
    case "q":
      return false;
    case "scenarios":
    case "list":
    case "ls":
      listScenarios();
      return true;
    case "play":
    case "start": {
      const [ref, ...settings] = typed;
      const base = ref ? pickScenario(ref) : scenarios[0];
      if (!base) say(c.red(`No scenario "${ref}". Type scenarios.`));
      else {
        const s = tailored(base, settings);
        if (s) start(s);
      }
      return true;
    }
    case "setup":
    case "tailor": {
      const s = typed[0] ? pickScenario(typed[0]) : sim?.scenario;
      if (!s) say(typed[0] ? c.red(`No scenario "${typed[0]}".`) : "Usage: setup <n|id>");
      else showSetup(s);
      return true;
    }
    case "load": {
      if (!arg) say("Usage: load <file.yaml>");
      else {
        const s = loadFile(arg);
        if (s) start(s);
      }
      return true;
    }
    case "map": {
      const [ref, ...settings] = typed;
      const base = ref ? pickScenario(ref) : sim?.scenario;
      if (!base) say(ref ? c.red(`No scenario "${ref}".`) : "Usage: map <n|id>");
      else {
        const s = tailored(base, settings);
        if (s) showMap(s);
      }
      return true;
    }
    case "msel": {
      const [ref, ...more] = typed;
      const file = more.find((w) => !w.includes("="));
      const base = ref ? pickScenario(ref) : sim?.scenario;
      if (!base) say("Usage: msel <n|id> [file.md|file.csv] [setting=value ...]");
      else {
        const s = tailored(base, more.filter((w) => w.includes("=")));
        if (s) writeMsel(s, file);
      }
      return true;
    }
    case "next": {
      const i = sim ? scenarios.findIndex((x) => x.id === sim!.scenario.id) : -1;
      const s = scenarios[i + 1];
      if (!s) say("That was the last scenario. Type scenarios to pick another.");
      else start(s);
      return true;
    }
  }
  if (!sim) {
    say(`Start an exercise first: type ${c.cyan("scenarios")}, then ${c.cyan("play 1")}.`);
    return true;
  }
  switch (cmd.toLowerCase()) {
    case "inbox":
    case "messages":
      showInbox();
      break;
    case "read": {
      if (arg) showMessage(Number(arg) - 1);
      else {
        const i = sim.inbox.findIndex((d) => !d.read);
        if (i < 0) say("No unread messages. Type inbox to see them all.");
        else showMessage(i);
      }
      break;
    }
    case "actions":
    case "a":
      showActions();
      break;
    case "do":
    case "act": {
      if (!arg) {
        say("Usage: do <number or id>. Type actions to see the list.");
        break;
      }
      const r = sim.act(arg);
      if (!r.ok && !r.events.length) say(c.red(r.error ?? "That didn't work."));
      else showEvents(r.events);
      if (!sim.ended && r.ok) {
        if (sim.scenario.status.length) say(`  ${statusLine()}`);
        say(c.dim(`${header()}  Type actions for what's next.`));
      }
      break;
    }
    case "wait":
    case "w": {
      const m = parseWait(arg);
      if (m === null) {
        say("Usage: wait, wait 30m, wait 2h");
        break;
      }
      const before = sim.time;
      const events = sim.wait(m);
      if (!events.length) say(c.dim(`${duration(sim.time - before)} pass quietly. ${header()}`));
      else showEvents(events);
      break;
    }
    case "status":
    case "s":
      showStatus();
      break;
    case "brief":
    case "briefing":
      say(md(sim.scenario.briefing));
      break;
    case "log":
    case "timeline":
      showLog();
      break;
    case "end":
    case "finish":
      if (sim.ended) showDebrief();
      else {
        sim.finish("You ended the exercise.");
        showEvents(sim.log.slice(-1));
      }
      break;
    case "report":
      writeReport(arg || undefined);
      break;
    case "note": {
      const current = sim.phases[sim.phases.length - 1];
      if (!current) say("There is no discussion point yet.");
      else if (!arg) say("Usage: note <your answer>");
      else {
        const prev = sim.notes[current.phase.id];
        sim.setNote(current.phase.id, prev ? `${prev}\n${arg}` : arg);
        say(c.dim(`Noted under "${current.phase.title}".`));
      }
      break;
    }
    case "notes":
      if (!sim.phases.length) say("No discussion points yet.");
      for (const p of sim.phases) {
        say(c.bold(p.phase.title));
        say(sim.notes[p.phase.id] ? md(sim.notes[p.phase.id]) : c.dim("  No notes yet."));
      }
      break;
    case "discuss":
      if (!sim.phases.length) say("No discussion points yet.");
      else showPhase(sim.phases[sim.phases.length - 1].phase.id);
      break;
    default:
      say(`Unknown command "${cmd}". Type help.`);
  }
  return true;
}

function interactive(first?: Scenario): void {
  say(c.bold(`TTXSim ${VERSION}`) + c.dim(" · incident response tabletop exercise simulator"));
  say(c.dim("All organizations, people and events in these scenarios are fictional."));
  if (first) start(first);
  else listScenarios();
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: c.cyan("ttx> ") });
  rl.prompt();
  rl.on("line", (line) => {
    let keep = true;
    try {
      keep = run(line);
    } catch (err) {
      say(c.red(`Something went wrong: ${(err as Error).message}`));
    }
    if (!keep) {
      rl.close();
      return;
    }
    rl.prompt();
  });
  rl.on("close", () => {
    if (sim?.ended && !reported) say(c.dim("Tip: next time, type report before quitting to keep an after-action report."));
    say("Bye.");
    process.exit(0);
  });
}

function main(): void {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "validate") process.exit(validate(args));
  if (cmd === "--version" || cmd === "-v") {
    say(VERSION);
    return;
  }
  if (cmd === "--help" || cmd === "-h") {
    say("Usage: ttxsim                 interactive mode");
    say("       ttxsim play <n|id> [setting=value ...]  start a scenario");
    say("       ttxsim play <file>     start your own scenario file");
    say("       ttxsim list            list scenarios");
    say("       ttxsim validate [files] check scenario files");
    say("       ttxsim map <n|id>      show a scenario map");
    say("       ttxsim msel <n|id> [file] [setting=value ...] save the master scenario events list");
    say("       ttxsim setup <n|id>    show the settings a scenario can take");
    return;
  }
  try {
    scenarios = builtinScenarios();
  } catch (err) {
    say(c.red((err as Error).message));
    process.exit(1);
  }
  if (cmd === "list") {
    listScenarios();
    return;
  }
  const lookup = (ref: string) => pickScenario(ref) ?? (ref && existsSync(ref) && /\.ya?ml$/.test(ref) ? loadFile(ref) : undefined);
  if (cmd === "map" || cmd === "msel" || cmd === "setup") {
    const base = lookup(args[0] ?? "");
    if (!base) {
      say(c.red(`No scenario "${args[0] ?? ""}".`));
      process.exit(1);
    }
    if (cmd === "setup") {
      showSetup(base);
      return;
    }
    const more = args.slice(1);
    const s = tailored(base, more.filter((w) => w.includes("=")));
    if (!s) process.exit(1);
    if (cmd === "map") showMap(s);
    else writeMsel(s, more.find((w) => !w.includes("=")));
    return;
  }
  if (cmd === "play") {
    const ref = args[0] ?? "1";
    const base = lookup(ref);
    if (!base) {
      say(c.red(`No scenario "${ref}".`));
      process.exit(1);
    }
    const s = tailored(base, args.slice(1));
    if (!s) process.exit(1);
    interactive(s);
    return;
  }
  interactive();
}

main();
