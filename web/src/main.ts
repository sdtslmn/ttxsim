import "./style.css";
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
  LEVELS,
  loadScenario,
  reportMarkdown,
  ScenarioError,
  Sim,
  buildFlow,
  mselCsv,
  mselMarkdown,
  overlayPath,
  attackUrl,
  applyTailoring,
  tailorSummary,
  variantSummary,
  hasVariation,
  randomSeed,
  DEFAULT_ROLES,
  requestFeedback,
  feedbackMarkdown,
  AI_MODEL,
  memberLabel,
  type Member,
  type Delivered,
  type LogEntry,
  type Scenario,
} from "../../src/core/index.js";
import { esc, md } from "./md.js";
import { renderFlow } from "./flowview.js";

const REPO = "https://github.com/sdtslmn/ttxsim";
const app = document.getElementById("app")!;

type Reader =
  | { kind: "briefing" }
  | { kind: "message"; index: number }
  | { kind: "phase"; id: string }
  | { kind: "decide"; action: string }
  | { kind: "vote"; options: string[] }
  | { kind: "update"; entries: LogEntry[]; note?: string };

let scenarios: Scenario[] = [];
let custom: Scenario | undefined;
let sim: Sim | undefined;
let reader: Reader = { kind: "briefing" };
let view: "home" | "setup" | "play" | "debrief" | "map" = "home";
let mapScenario: Scenario | undefined;
let setupScenario: Scenario | undefined;
let setupTeam = false;
let setupSeed = 0;
/** Team play: action ids picked as vote options, while picking. */
let picking: string[] | undefined;
let facilOpen = true;
let presenter = false;
/** Optional AI feedback. The key lives only in memory for this page. */
let aiKey = "";
let aiFeedback: { sim: Sim; text: string } | undefined;

// ---- progress (per browser) ---------------------------------------------------

function progress(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem("ttxsim.progress") ?? "{}");
  } catch {
    return {};
  }
}

function saveProgress(id: string, score: number): void {
  try {
    const p = progress();
    if ((p[id] ?? -1) < score) {
      p[id] = score;
      localStorage.setItem("ttxsim.progress", JSON.stringify(p));
    }
  } catch {
    // Storage can be unavailable (private mode, embedded views). Progress is optional.
  }
}

// ---- saved setup (per browser) -------------------------------------------------

type Settings = Record<string, string | boolean>;

function savedSettings(id: string): Settings {
  try {
    return JSON.parse(localStorage.getItem("ttxsim.setup") ?? "{}")[id] ?? {};
  } catch {
    return {};
  }
}

function saveSettings(id: string, values: Settings): void {
  try {
    const all = JSON.parse(localStorage.getItem("ttxsim.setup") ?? "{}");
    all[id] = values;
    localStorage.setItem("ttxsim.setup", JSON.stringify(all));
  } catch {
    // Optional: the setup still applies to this run.
  }
}

type Seat = Member & { on: boolean };

function savedSeats(): Seat[] {
  let saved: Seat[] = [];
  try {
    saved = JSON.parse(localStorage.getItem("ttxsim.team") ?? "[]");
  } catch {
    saved = [];
  }
  const firstFour = new Set(["lead", "ops", "security", "comms"]);
  return DEFAULT_ROLES.map((r) => saved.find((x) => x.role === r.id) ?? { role: r.id, name: "", on: firstFour.has(r.id) });
}

function saveSeats(seats: Seat[]): void {
  try {
    localStorage.setItem("ttxsim.team", JSON.stringify(seats));
  } catch {
    // Optional.
  }
}

/** A run number given in the address, as ?run=4821. */
function urlRun(): number | undefined {
  const v = new URLSearchParams(location.search).get("run") ?? new URLSearchParams(location.search).get("seed");
  return v && /^\d+$/.test(v) ? Number(v) : undefined;
}

/** A built-in scenario with the settings last used in this browser, and a run number if it varies. */
function withSaved(s: Scenario): Scenario {
  const varies = hasVariation(s);
  if (!s.tailor.length && !varies) return s;
  return applyTailoring(s, savedSettings(s.id), varies ? (urlRun() ?? randomSeed()) : undefined);
}

function indexOfId(s: Scenario): number {
  return scenarios.findIndex((x) => x.id === s.id);
}

/** Play goes through the setup screen when a scenario has settings, or for team play. */
function begin(s: Scenario, team = false): void {
  if (team || (s.template ?? s).tailor.length || hasVariation(s)) openSetup(s, team);
  else startScenario(s);
}

function setupLine(s: Scenario): string {
  const changed = tailorSummary(s).filter((t) => t.changed);
  const parts = [changed.length ? `Setup: ${changed.map((t) => `${t.label}: ${t.value}`).join("; ")}` : "", s.seed !== undefined ? `Run ${s.seed}` : ""];
  return parts.filter(Boolean).join(" · ");
}

// ---- helpers --------------------------------------------------------------------

function meterClass(value: number, good: "high" | "low"): string {
  const ok = good === "high" ? value >= 60 : value <= 40;
  const bad = good === "high" ? value < 35 : value > 65;
  return ok ? "ok" : bad ? "bad" : "warn";
}

const channelIcon: Record<string, string> = {
  email: "✉",
  alert: "⚠",
  call: "☎",
  chat: "💬",
  ticket: "🎫",
  news: "📰",
  team: "👥",
  letter: "📄",
};

function setView(v: typeof view): void {
  view = v;
  if (v !== "play" && v !== "debrief") document.body.classList.remove("presenter");
  else document.body.classList.toggle("presenter", presenter);
  render();
  window.scrollTo({ top: 0 });
}

function startScenario(s: Scenario, team?: Member[]): void {
  sim = new Sim(s);
  if (team?.length) sim.team = team;
  picking = undefined;
  facilOpen = true;
  reader = { kind: "briefing" };
  history.replaceState(null, "", `#${s.id}`);
  setView("play");
}

// ---- home -----------------------------------------------------------------------

function renderHome(): string {
  const p = progress();
  const groups = LEVELS.filter((l) => scenarios.some((s) => s.level === l));
  const cards = groups
    .map((level) => {
      const items = scenarios
        .filter((s) => s.level === level)
        .map((s) => {
          const best = p[s.id];
          const badge =
            best === undefined
              ? ""
              : `<span class="badge ${best >= s.passMark ? "ok" : "warn"}">${best >= s.passMark ? "Passed" : "Best"} ${best}%</span>`;
          return `<div class="card">
            <button class="card-main" data-start="${esc(s.id)}">
              <span class="card-top"><span class="sector">${esc(s.sector)}</span>${badge}</span>
              <span class="card-title">${esc(s.title)}</span>
              <span class="card-summary">${esc(s.summary)}</span>
              <span class="card-meta">About ${s.minutes} min · ${s.objectives.length} objectives${s.tailor.length ? " · can be tailored" : ""}</span>
            </button>
            <div class="card-foot">
              <button class="btn small primary" data-start="${esc(s.id)}">Play</button>
              <button class="btn small" data-team="${esc(s.id)}" title="Seats for each role, decisions with reasons, votes and facilitator injects">Run with a team</button>
              <button class="btn small ghost" data-map="${esc(s.id)}" title="Scenario map and MSEL for facilitators (contains spoilers)">Map and MSEL</button>
            </div>
          </div>`;
        })
        .join("");
      return `<section class="level"><h2>${esc(LEVEL_LABELS[level])}</h2><div class="cards">${items}</div></section>`;
    })
    .join("");
  return `
  <header class="topbar">
    <div class="brand"><span class="logo">T</span> TTXSim</div>
    <nav><a href="${REPO}" target="_blank" rel="noopener">GitHub</a></nav>
  </header>
  <main class="home">
    <section class="hero">
      <h1>Incident response tabletop exercises you can run on your own</h1>
      <p>Each scenario drops you into an incident at a fictional organization. Messages arrive on a clock, every action takes time, and the situation changes while you work. At the end you get a debrief and an after-action report mapped to NIST CSF 2.0.</p>
      <ul class="how">
        <li><strong>Read</strong> emails, alerts and calls as they arrive.</li>
        <li><strong>Decide</strong> what to do. Investigating, containing and communicating all take time.</li>
        <li><strong>See the consequences</strong>, then get a scored debrief and a report for your team.</li>
      </ul>
    </section>
    ${cards}
    <section class="level own">
      <h2>Your own scenario</h2>
      <p>Write a scenario in YAML and load it here. Nothing is uploaded: the file stays in your browser. See the <a href="${REPO}/blob/main/docs/scenario-format.md" target="_blank" rel="noopener">scenario format</a>.</p>
      <label class="btn">Load a scenario file<input type="file" id="file" accept=".yaml,.yml" hidden /></label>
      <div id="load-error"></div>
    </section>
    <footer class="foot">All organizations, people and events in these scenarios are fictional. TTXSim is a training tool, not a substitute for your own incident response plan. Apache 2.0.</footer>
  </main>`;
}

function bindHome(): void {
  app.querySelectorAll<HTMLButtonElement>("[data-start]").forEach((b) =>
    b.addEventListener("click", () => {
      const s = scenarios.find((x) => x.id === b.dataset.start);
      if (s) begin(withSaved(s));
    }),
  );
  app.querySelectorAll<HTMLButtonElement>("[data-map]").forEach((b) =>
    b.addEventListener("click", () => {
      const s = scenarios.find((x) => x.id === b.dataset.map);
      if (s) openMap(withSaved(s));
    }),
  );
  app.querySelectorAll<HTMLButtonElement>("[data-team]").forEach((b) =>
    b.addEventListener("click", () => {
      const s = scenarios.find((x) => x.id === b.dataset.team);
      if (s) begin(withSaved(s), true);
    }),
  );
  const input = app.querySelector<HTMLInputElement>("#file");
  input?.addEventListener("change", async () => {
    const f = input.files?.[0];
    if (!f) return;
    const box = app.querySelector("#load-error")!;
    try {
      custom = loadScenario(await f.text(), f.name);
      begin(custom);
    } catch (err) {
      const problems = err instanceof ScenarioError ? err.problems : [(err as Error).message];
      box.innerHTML = `<div class="error"><strong>${esc(f.name)} has ${problems.length} problem${problems.length === 1 ? "" : "s"}:</strong><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>`;
      input.value = "";
    }
  });
}

// ---- play -----------------------------------------------------------------------

function renderMeters(): string {
  const s = sim!.scenario;
  return s.meters
    .map((m) => {
      const v = sim!.meters[m.id];
      return `<div class="meter" title="${esc(m.help ?? `${m.good === "high" ? "Higher" : "Lower"} is better`)}">
        <div class="meter-label"><span>${esc(m.label)}</span><span>${v}</span></div>
        <div class="meter-track"><div class="meter-fill ${meterClass(v, m.good)}" style="width:${v}%"></div></div>
        <div class="meter-hint">${m.good === "high" ? "higher is better" : "lower is better"}</div>
      </div>`;
    })
    .join("");
}

function renderStatus(): string {
  const items = sim!.statusNow();
  if (!items.length) return "";
  return `<div class="status-row">${items
    .map((st) => `<span class="status-chip t-${st.tone}"><span class="status-label">${esc(st.item.label)}</span>${esc(st.text)}</span>`)
    .join("")}</div>`;
}

function renderInbox(): string {
  const s = sim!.scenario;
  const hm = (t: number) => esc(clockLabel(s, t).replace(/^\w{3} /, "").replace(/^Day \d+ /, ""));
  const entries: { time: number; order: number; html: string }[] = sim!.inbox.map((d, i) => {
    const active = reader.kind === "message" && reader.index === i ? " active" : "";
    return {
      time: d.time,
      order: i,
      html: `<button class="mail${d.read ? "" : " unread"}${active}" data-msg="${i}">
        <span class="mail-icon ch-${d.inject.via}" aria-hidden="true">${channelIcon[d.inject.via]}</span>
        <span class="mail-body"><span class="mail-from">${esc(d.inject.from)}</span><span class="mail-subject">${esc(d.inject.subject)}</span></span>
        <span class="mail-time">${hm(d.time)}</span>
      </button>`,
    };
  });
  sim!.phases.forEach((p, i) => {
    const active = reader.kind === "phase" && reader.id === p.phase.id ? " active" : "";
    const noted = sim!.notes[p.phase.id] ? " noted" : "";
    entries.push({
      time: p.time,
      order: -1 - i,
      html: `<button class="mail discuss${active}${noted}" data-phase="${esc(p.phase.id)}">
        <span class="mail-icon" aria-hidden="true">🗣</span>
        <span class="mail-body"><span class="mail-from">Discussion point${noted ? " · noted" : ""}</span><span class="mail-subject">${esc(p.phase.title)}</span></span>
        <span class="mail-time">${hm(p.time)}</span>
      </button>`,
    });
  });
  const items = entries
    .sort((a, b) => b.time - a.time || b.order - a.order)
    .map((e) => e.html)
    .join("");
  const active = reader.kind === "briefing" ? " active" : "";
  return `<button class="mail brief${active}" data-brief>
      <span class="mail-icon" aria-hidden="true">📋</span>
      <span class="mail-body"><span class="mail-from">Briefing</span><span class="mail-subject">Your role and objectives</span></span>
    </button>${items || `<p class="muted pad">No messages yet.</p>`}`;
}

function messageHtml(d: Delivered): string {
  const s = sim!.scenario;
  return `<article class="message">
    <div class="msg-head">
      <span class="tag ch-${d.inject.via}">${channelIcon[d.inject.via]} ${esc(CHANNEL_LABELS[d.inject.via])}</span>
      <span class="muted">${esc(clockLabel(s, d.time))}</span>
    </div>
    <h3>${esc(d.inject.subject)}</h3>
    <div class="from">From: ${esc(d.inject.from)}</div>
    <div class="text">${md(d.body)}</div>
  </article>`;
}

function phaseHtml(id: string): string {
  const s = sim!.scenario;
  const reached = sim!.phases.find((p) => p.phase.id === id);
  if (!reached) return "";
  const ph = reached.phase;
  return `<article class="message phase">
    <div class="msg-head"><span class="tag discuss-tag">🗣 Discussion point</span><span class="muted">${esc(clockLabel(s, reached.time))}</span></div>
    <h3>${esc(ph.title)}</h3>
    ${ph.text ? `<div class="text">${md(ph.text)}</div>` : ""}
    <ol class="questions">${ph.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ol>
    <label class="note-label" for="note-${esc(ph.id)}">Your answer or the team's notes (saved in the report)</label>
    <textarea class="note" id="note-${esc(ph.id)}" data-note="${esc(ph.id)}" rows="4" placeholder="What does your plan say? Who decides? What would you do differently?">${esc(sim!.notes[ph.id] ?? "")}</textarea>
  </article>`;
}

function renderReader(): string {
  const s = sim!.scenario;
  if (reader.kind === "briefing") {
    return `<article class="message briefing">
      <div class="msg-head"><span class="tag">📋 Briefing</span><span class="muted">${esc(s.org)}${s.sector ? ` · ${esc(s.sector)}` : ""}</span></div>
      <h3>${esc(s.title)}</h3>
      <p class="role">${esc(s.role)}</p>
      <div class="text">${md(s.briefing)}</div>
      <h4>Objectives</h4>
      <ul class="objectives">${s.objectives.map((o) => `<li>${esc(o.text)}</li>`).join("")}</ul>
      <p class="muted">The exercise starts at ${esc(clockLabel(s, 0))} and runs for up to ${esc(duration(s.limit))}. Pick an action on the right, or wait to see what happens.</p>
    </article>`;
  }
  if (reader.kind === "message") {
    const d = sim!.inbox[reader.index];
    return d ? messageHtml(d) : "";
  }
  if (reader.kind === "phase") return phaseHtml(reader.id);
  if (reader.kind === "decide") return decideHtml(reader.action);
  if (reader.kind === "vote") return voteHtml(reader.options);
  const parts: string[] = [];
  if (reader.note) parts.push(`<p class="muted note">${esc(reader.note)}</p>`);
  for (const e of reader.entries) {
    if (e.kind === "action") {
      parts.push(`<article class="message done">
        <div class="msg-head"><span class="tag act">✓ ${esc(GROUP_INFO[(e.ref ?? "investigate") as keyof typeof GROUP_INFO]?.label ?? "Done")}</span><span class="muted">${esc(clockLabel(s, e.time))}</span></div>
        <h3>${esc(e.title)}</h3>
        <div class="text">${md(e.text ?? "")}</div>
      </article>`);
    } else if (e.kind === "inject") {
      const i = sim!.inbox.findIndex((d) => d.inject.id === e.ref);
      if (i >= 0) parts.push(messageHtml(sim!.inbox[i]));
    } else if (e.kind === "phase" && e.ref) {
      parts.push(phaseHtml(e.ref));
    } else if (e.kind === "rule") {
      parts.push(`<div class="notice"><span class="muted">${esc(clockLabel(s, e.time))}</span> ${esc(e.title)}</div>`);
    }
  }
  return parts.join("") || `<p class="muted pad">Nothing new happened.</p>`;
}

function teamBar(): string {
  if (!sim!.team.length) return "";
  if (!picking) return `<div class="vote-bar"><button class="btn small" data-vote-start title="Pick two to four actions and take a show of hands">Put options to a vote</button></div>`;
  return `<div class="vote-bar picking"><span>Pick 2 to 4 options. <strong>${picking.length} picked.</strong></span>
    <button class="btn small primary" data-vote-open ${picking.length < 2 ? "disabled" : ""}>Open the vote</button>
    <button class="btn small ghost" data-vote-cancel>Cancel</button></div>`;
}

function renderActions(): string {
  const list = sim!.availableActions();
  const groups = GROUPS.map((g) => {
    const items = list.filter((a) => a.group === g);
    if (!items.length) return "";
    return `<div class="group"><h4 title="${esc(GROUP_INFO[g].csf)}">${esc(GROUP_INFO[g].label)}</h4>${items
      .map(
        (a) => `<button class="action g-${g}${picking?.includes(a.id) ? " picked" : ""}" data-act="${esc(a.id)}"><span>${esc(a.label)}</span><span class="dur">${esc(duration(a.takes))}</span></button>`,
      )
      .join("")}</div>`;
  }).join("");
  const long = sim!.scenario.limit > 1440;
  return `${teamBar()}${groups}
    <div class="group waits">
      <h4>Let time pass</h4>
      <div class="wait-row">
        <button class="btn small" data-wait="next">Wait for news</button>
        <button class="btn small" data-wait="15">15 min</button>
        <button class="btn small" data-wait="60">1 h</button>
        ${long ? `<button class="btn small" data-wait="240">4 h</button><button class="btn small" data-wait="720">12 h</button>` : ""}
      </div>
    </div>
    <button class="btn ghost end" data-end>End the exercise now</button>`;
}

function renderPlay(): string {
  const s = sim!.scenario;
  const unread = sim!.unread();
  return `
  <header class="topbar play">
    <button class="brand link" data-home title="All scenarios"><span class="logo">T</span> TTXSim</button>
    <div class="scenario-name">${esc(s.title)}${sim!.team.length ? ` <span class="chip">Team</span>` : ""}</div>
    <button class="btn small ghost" data-presenter title="Bigger text for a projector">${presenter ? "Exit presenter view" : "Presenter view"}</button>
    <div class="clock" aria-live="polite"><strong>${esc(clockLabel(s, sim!.time))}</strong><span>${esc(elapsedLabel(sim!.time))}</span></div>
  </header>
  <div class="meters">${renderMeters()}</div>
  ${renderStatus()}
  <main class="board">
    <aside class="pane inbox"><h2>Inbox ${unread ? `<span class="count">${unread}</span>` : ""}</h2><div class="mails">${renderInbox()}</div></aside>
    <section class="pane reader" aria-live="polite">${renderReader()}</section>
    <aside class="pane actions"><h2>Actions</h2>${renderActions()}</aside>
  </main>
  ${sim!.team.length ? facilitatorHtml() : ""}`;
}

// ---- team play ------------------------------------------------------------------------

function decideHtml(id: string): string {
  const a = sim!.scenario.actions.find((x) => x.id === id);
  if (!a) return "";
  const people = sim!.team.map((m) => `<option>${esc(memberLabel(m))}</option>`).join("");
  return `<article class="message decide">
    <div class="msg-head"><span class="tag act">Decision</span><span class="muted">${esc(clockLabel(sim!.scenario, sim!.time))}</span></div>
    <h3>${esc(a.label)}</h3>
    <p class="muted">${esc(GROUP_INFO[a.group].label)} · takes ${esc(duration(a.takes))}</p>
    <label class="note-label" for="dec-by">Who made the call?</label>
    <select class="note" id="dec-by"><option>The team</option>${people}<option>Facilitator</option></select>
    <label class="note-label" for="dec-why">Why this, and why now?</label>
    <textarea class="note" id="dec-why" rows="3" placeholder="One or two lines for the report"></textarea>
    <div class="debrief-actions">
      <button class="btn primary" data-decide="${esc(a.id)}">Do it</button>
      <button class="btn" data-decide-vote="${esc(a.id)}">Vote on it against other options</button>
      <button class="btn ghost" data-back>Back</button>
    </div>
  </article>`;
}

function voteHtml(options: string[]): string {
  const acts = options.map((id) => sim!.scenario.actions.find((x) => x.id === id)!).filter(Boolean);
  return `<article class="message vote">
    <div class="msg-head"><span class="tag">Vote</span><span class="muted">${esc(clockLabel(sim!.scenario, sim!.time))}</span></div>
    <h3>What do we do next?</h3>
    <p class="muted">Read the options out, take a show of hands and enter the count for each.</p>
    <div class="vote-options">${acts
      .map(
        (a) => `<div class="vote-opt"><div class="vote-label">${esc(a.label)} <span class="dur">${esc(duration(a.takes))}</span></div>
          <input type="number" min="0" max="999" value="0" class="vote-count" data-votes="${esc(a.id)}" aria-label="Votes for ${esc(a.label)}" />
          <div class="vote-track"><div class="vote-fill" data-fill="${esc(a.id)}"></div></div></div>`,
      )
      .join("")}</div>
    <label class="note-label" for="vote-choice">Go with</label>
    <select class="note" id="vote-choice">${acts.map((a) => `<option value="${esc(a.id)}">${esc(a.label)}</option>`).join("")}</select>
    <label class="note-label" for="dec-why">Why? Note the minority view too.</label>
    <textarea class="note" id="dec-why" rows="3" placeholder="For the report and the hot wash"></textarea>
    <div class="debrief-actions">
      <button class="btn primary" data-vote-decide>Decide</button>
      <button class="btn ghost" data-vote-cancel>Cancel the vote</button>
    </div>
  </article>`;
}

function facilitatorHtml(): string {
  const list = sim!.pushable();
  const pushRow = (i: (typeof list)[number]) => `<div class="push"><div><strong>${esc(i.subject)}</strong><span class="muted small"> ${esc(i.from)} · ${esc(CHANNEL_LABELS[i.via])}</span>${i.note ? `<small>${esc(i.note)}</small>` : ""}</div><button class="btn small" data-push="${esc(i.id)}">Push</button></div>`;
  const own = list.filter((i) => !i.id.startsWith("fac_"));
  const generic = list.filter((i) => i.id.startsWith("fac_"));
  const decisions = sim!.decisions
    .slice()
    .reverse()
    .map(
      (d) => `<li><span class="muted">${esc(clockLabel(sim!.scenario, d.time))}</span> ${esc(d.label)}<small>${esc(d.by ?? "")}${d.vote ? ` · vote ${d.vote.map((o) => o.votes).join(" to ")}` : ""}${d.rationale ? ` · ${esc(d.rationale)}` : ""}</small></li>`,
    )
    .join("");
  return `<details class="facil" ${facilOpen ? "open" : ""}>
    <summary>Facilitator controls <span class="muted small">Close this before projecting: notes here are spoilers.</span></summary>
    <div class="facil-grid">
      <section><h4>Push an inject</h4>
        ${own.length ? `<p class="muted small">From this scenario</p>${own.map(pushRow).join("")}` : ""}
        ${generic.length ? `<p class="muted small">For any scenario</p>${generic.map(pushRow).join("")}` : ""}
        ${list.length ? "" : `<p class="muted">Nothing left to push.</p>`}
      </section>
      <section><h4>Write your own</h4>
        <input class="note" id="c-from" placeholder="From (for example: Plant manager)" maxlength="60" />
        <input class="note" id="c-subj" placeholder="Subject" maxlength="100" />
        <textarea class="note" id="c-body" rows="3" placeholder="Message"></textarea>
        <select class="note" id="c-via">${(["chat", "call", "email", "alert", "news"] as const).map((v) => `<option value="${v}">${esc(CHANNEL_LABELS[v])}</option>`).join("")}</select>
        <button class="btn small" data-csend>Send to the team</button>
      </section>
      <section><h4>Seats</h4><p class="seats">${sim!.team.map((m) => `<span class="chip">${esc(memberLabel(m))}</span>`).join(" ")}</p>
        <h4>Decisions so far</h4>${decisions ? `<ul class="decisions">${decisions}</ul>` : `<p class="muted">None yet.</p>`}
      </section>
    </div>
  </details>`;
}

function bindTeam(): void {
  app.querySelector<HTMLButtonElement>("[data-presenter]")?.addEventListener("click", () => {
    presenter = !presenter;
    if (presenter) facilOpen = false;
    document.body.classList.toggle("presenter", presenter);
    render();
  });
  if (!sim!.team.length) return;
  app.querySelector<HTMLDetailsElement>(".facil")?.addEventListener("toggle", (e) => (facilOpen = (e.target as HTMLDetailsElement).open));
  app.querySelector("[data-vote-start]")?.addEventListener("click", () => {
    picking = [];
    render();
  });
  app.querySelectorAll("[data-vote-cancel]").forEach((b) =>
    b.addEventListener("click", () => {
      picking = undefined;
      if (reader.kind === "vote") reader = { kind: "briefing" };
      render();
    }),
  );
  app.querySelector("[data-vote-open]")?.addEventListener("click", () => {
    if (!picking || picking.length < 2) return;
    reader = { kind: "vote", options: picking };
    picking = undefined;
    render();
  });
  app.querySelector("[data-back]")?.addEventListener("click", () => {
    reader = { kind: "briefing" };
    render();
  });
  app.querySelector<HTMLButtonElement>("[data-decide]")?.addEventListener("click", (e) => {
    const id = (e.currentTarget as HTMLButtonElement).dataset.decide!;
    const by = app.querySelector<HTMLSelectElement>("#dec-by")?.value;
    const rationale = app.querySelector<HTMLTextAreaElement>("#dec-why")?.value;
    const r = sim!.decide(id, { by, rationale });
    after(r.events, r.ok ? undefined : r.error);
  });
  app.querySelector<HTMLButtonElement>("[data-decide-vote]")?.addEventListener("click", (e) => {
    picking = [(e.currentTarget as HTMLButtonElement).dataset.decideVote!];
    reader = { kind: "update", entries: [], note: "Pick at least one more option on the right, then open the vote." };
    render();
  });
  // Live tally while counts are typed in.
  let touched = false;
  const choice = app.querySelector<HTMLSelectElement>("#vote-choice");
  choice?.addEventListener("change", () => (touched = true));
  const counts = () => [...app.querySelectorAll<HTMLInputElement>("[data-votes]")].map((i) => ({ id: i.dataset.votes!, n: Math.max(0, Number(i.value) || 0) }));
  app.querySelectorAll<HTMLInputElement>("[data-votes]").forEach((input) =>
    input.addEventListener("input", () => {
      const c = counts();
      const total = c.reduce((n, x) => n + x.n, 0);
      for (const x of c) {
        const fill = app.querySelector<HTMLElement>(`[data-fill="${CSS.escape(x.id)}"]`);
        if (fill) fill.style.width = `${total ? Math.round((x.n / total) * 100) : 0}%`;
      }
      if (!touched && choice && total) choice.value = c.reduce((a, b) => (b.n > a.n ? b : a)).id;
    }),
  );
  app.querySelector("[data-vote-decide]")?.addEventListener("click", () => {
    if (reader.kind !== "vote") return;
    const c = counts();
    const vote = c.map((x) => ({ action: x.id, label: sim!.scenario.actions.find((a) => a.id === x.id)?.label ?? x.id, votes: x.n }));
    const rationale = app.querySelector<HTMLTextAreaElement>("#dec-why")?.value;
    const r = sim!.decide(choice!.value, { by: "Team vote", rationale, vote });
    after(r.events, r.ok ? undefined : r.error);
  });
  app.querySelectorAll<HTMLButtonElement>("[data-push]").forEach((b) =>
    b.addEventListener("click", () => {
      const events = sim!.push(b.dataset.push!);
      after(events);
    }),
  );
  app.querySelector("[data-csend]")?.addEventListener("click", () => {
    const val = (id: string) => app.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(id)?.value ?? "";
    if (!val("#c-subj").trim()) {
      app.querySelector<HTMLInputElement>("#c-subj")?.focus();
      return;
    }
    const events = sim!.pushCustom(val("#c-from"), val("#c-subj"), val("#c-body"), val("#c-via") as "chat");
    after(events);
  });
}

function after(entries: LogEntry[], note?: string): void {
  if (sim!.ended) {
    finish();
    return;
  }
  // Messages shown in the update view count as read.
  for (const e of entries) {
    if (e.kind !== "inject") continue;
    const i = sim!.inbox.findIndex((d) => d.inject.id === e.ref);
    if (i >= 0) sim!.markRead(i);
  }
  reader = { kind: "update", entries, note };
  render();
  app.querySelector(".reader")?.scrollTo({ top: 0 });
  if (window.innerWidth < 900) app.querySelector(".reader")?.scrollIntoView({ behavior: "smooth" });
}

function bindPlay(): void {
  const home = app.querySelector<HTMLButtonElement>("[data-home]");
  home?.addEventListener("click", () =>
    twoStep(home, "Leave this exercise? Click again", () => {
      history.replaceState(null, "", "#");
      setView("home");
    }),
  );
  app.querySelector("[data-brief]")?.addEventListener("click", () => {
    reader = { kind: "briefing" };
    render();
  });
  app.querySelectorAll<HTMLButtonElement>("[data-phase]").forEach((b) =>
    b.addEventListener("click", () => {
      reader = { kind: "phase", id: b.dataset.phase! };
      render();
      if (window.innerWidth < 900) app.querySelector(".reader")?.scrollIntoView({ behavior: "smooth" });
    }),
  );
  app.querySelectorAll<HTMLTextAreaElement>("[data-note]").forEach((t) =>
    t.addEventListener("input", () => sim!.setNote(t.dataset.note!, t.value)),
  );
  app.querySelectorAll<HTMLButtonElement>("[data-msg]").forEach((b) =>
    b.addEventListener("click", () => {
      const i = Number(b.dataset.msg);
      sim!.markRead(i);
      reader = { kind: "message", index: i };
      render();
      if (window.innerWidth < 900) app.querySelector(".reader")?.scrollIntoView({ behavior: "smooth" });
    }),
  );
  app.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.dataset.act!;
      if (picking) {
        picking = picking.includes(id) ? picking.filter((x) => x !== id) : picking.length < 4 ? [...picking, id] : picking;
        render();
        return;
      }
      if (sim!.team.length) {
        reader = { kind: "decide", action: id };
        render();
        if (window.innerWidth < 900) app.querySelector(".reader")?.scrollIntoView({ behavior: "smooth" });
        return;
      }
      const r = sim!.act(id);
      after(r.events, r.ok ? undefined : r.error);
    }),
  );
  bindTeam();
  app.querySelectorAll<HTMLButtonElement>("[data-wait]").forEach((b) =>
    b.addEventListener("click", () => {
      const before = sim!.time;
      const w = b.dataset.wait!;
      const events = sim!.wait(w === "next" ? undefined : Number(w));
      after(events, events.length ? undefined : `${duration(sim!.time - before)} pass. Nothing new happens.`);
    }),
  );
  const end = app.querySelector<HTMLButtonElement>("[data-end]");
  end?.addEventListener("click", () =>
    twoStep(end, "Click again to end and see your debrief", () => {
      sim!.finish("You ended the exercise.");
      finish();
    }),
  );
}

/** Ask for a second click instead of a modal dialog. */
function twoStep(button: HTMLButtonElement, prompt: string, run: () => void): void {
  if (button.dataset.armed === "1") {
    run();
    return;
  }
  const original = button.innerHTML;
  button.dataset.armed = "1";
  button.classList.add("armed");
  button.textContent = prompt;
  setTimeout(() => {
    if (!button.isConnected) return;
    button.dataset.armed = "";
    button.classList.remove("armed");
    button.innerHTML = original;
  }, 4000);
}

// ---- setup (tailoring) -------------------------------------------------------------

function openSetup(s: Scenario, team = false): void {
  setupScenario = s;
  setupTeam = team;
  setupSeed = s.seed ?? urlRun() ?? randomSeed();
  history.replaceState(null, "", `#setup/${s.id}`);
  setView("setup");
}

function renderSetup(): string {
  const s = setupScenario!;
  const fields = (s.template ?? s).tailor;
  const rows = fields
    .map((f) => {
      const v = s.tailored[f.id] ?? f.default;
      const help = f.help ? `<small>${esc(f.help)}</small>` : "";
      return f.type === "toggle"
        ? `<label class="field toggle"><input type="checkbox" name="${esc(f.id)}" ${v === true ? "checked" : ""} /><span><strong>${esc(f.label)}</strong>${help}</span></label>`
        : `<label class="field"><strong>${esc(f.label)}</strong><input type="text" name="${esc(f.id)}" value="${esc(String(v))}" placeholder="${esc(String(f.default))}" maxlength="80" />${help}</label>`;
    })
    .join("");
  return `
  <header class="topbar">
    <button class="brand link" data-home><span class="logo">T</span> TTXSim</button>
    <div class="scenario-name">${esc(s.title)}: setup</div>
  </header>
  <main class="setupview">
    <section class="setup-box">
      <h1>${esc(s.title)}</h1>
      <p class="muted">${esc(s.summary)}</p>
      <form id="setup-form">
        <fieldset class="mode">
          <legend>How are you playing?</legend>
          <label class="field toggle"><input type="radio" name="mode" value="solo" ${setupTeam ? "" : "checked"} /><span><strong>On my own</strong><small>You make every decision.</small></span></label>
          <label class="field toggle"><input type="radio" name="mode" value="team" ${setupTeam ? "checked" : ""} /><span><strong>As a team, with a facilitator</strong><small>Each decision records who made the call and why. Put options to a vote, and push extra injects when the room needs pressure. Works on a projector.</small></span></label>
        </fieldset>
        <div class="roster" ${setupTeam ? "" : "hidden"}>
          <h3>Seats at the table</h3>
          <p class="muted small">Tick the seats you have. Names are optional and go into the report.</p>
          ${savedSeats()
            .map(
              (seat) => `<div class="seat"><label><input type="checkbox" name="seat_${esc(seat.role)}" ${seat.on ? "checked" : ""} /> ${esc(DEFAULT_ROLES.find((r) => r.id === seat.role)!.label)}</label><input type="text" name="name_${esc(seat.role)}" value="${esc(seat.name)}" placeholder="Name (optional)" maxlength="40" /></div>`,
            )
            .join("")}
        </div>
        ${
          hasVariation(s)
            ? `<h3 class="setup-h">Run number</h3>
        <p class="muted small">This scenario changes from run to run${(s.template ?? s).variants.length ? `: ${esc((s.template ?? s).variants.map((g) => g.label.toLowerCase()).join(", "))}` : ""}, and some messages may or may not arrive. Give another group the same number to give them the same run.</p>
        <div class="runrow"><input type="number" name="run" value="${setupSeed}" min="0" max="999999" aria-label="Run number" /><button type="button" class="btn small ghost" data-newrun>New number</button></div>`
            : ""
        }
        ${fields.length ? `<h3 class="setup-h">Tailor the scenario</h3><p class="muted small">Names appear in the briefing and messages. Yes or no settings change what you have to work with, and the scenario plays out differently.</p>${rows}` : ""}
        <div class="debrief-actions">
          <button type="submit" class="btn primary">Start the exercise</button>
          <button type="button" class="btn" data-setup-map title="Contains spoilers">Map and MSEL with these settings</button>
          ${fields.length ? `<button type="button" class="btn ghost" data-reset>Back to defaults</button>` : ""}
          <button type="button" class="btn ghost" data-home>All scenarios</button>
        </div>
      </form>
      <p class="muted small">Settings stay in this browser only.</p>
    </section>
  </main>`;
}

function readTeam(): Member[] | undefined {
  const form = app.querySelector<HTMLFormElement>("#setup-form")!;
  const team = (form.elements.namedItem("mode") as RadioNodeList | null)?.value === "team";
  const seats: Seat[] = DEFAULT_ROLES.map((r) => ({
    role: r.id,
    name: (form.elements.namedItem(`name_${r.id}`) as HTMLInputElement | null)?.value.trim() ?? "",
    on: (form.elements.namedItem(`seat_${r.id}`) as HTMLInputElement | null)?.checked ?? false,
  }));
  saveSeats(seats);
  if (!team) return undefined;
  const used = seats.filter((x) => x.on).map(({ role, name }) => ({ role, name }));
  return used.length ? used : [{ role: "lead", name: "" }];
}

function readSetup(): Scenario {
  const s = setupScenario!;
  const form = app.querySelector<HTMLFormElement>("#setup-form")!;
  const values: Settings = {};
  for (const f of (s.template ?? s).tailor) {
    const el = form.elements.namedItem(f.id) as HTMLInputElement | null;
    if (!el) continue;
    values[f.id] = f.type === "toggle" ? el.checked : el.value.trim();
  }
  if (scenarios.some((x) => x.id === s.id)) saveSettings(s.id, values);
  const run = Number((form.elements.namedItem("run") as HTMLInputElement | null)?.value);
  if (hasVariation(s)) setupSeed = Number.isInteger(run) && run >= 0 ? run : randomSeed();
  return applyTailoring(s, values, hasVariation(s) ? setupSeed : undefined);
}

function bindSetup(): void {
  app.querySelectorAll("[data-home]").forEach((b) =>
    b.addEventListener("click", () => {
      history.replaceState(null, "", "#");
      setView("home");
    }),
  );
  app.querySelector<HTMLFormElement>("#setup-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const team = readTeam();
    startScenario(readSetup(), team);
  });
  app.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((r) =>
    r.addEventListener("change", () => {
      setupTeam = r.value === "team" && r.checked;
      app.querySelector<HTMLElement>(".roster")!.hidden = !setupTeam;
    }),
  );
  app.querySelector("[data-setup-map]")?.addEventListener("click", () => openMap(readSetup()));
  app.querySelector("[data-newrun]")?.addEventListener("click", () => {
    const input = app.querySelector<HTMLInputElement>('input[name="run"]');
    if (input) input.value = String(randomSeed());
  });
  app.querySelector("[data-reset]")?.addEventListener("click", () => {
    setupTeam = (app.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value ?? "solo") === "team";
    setupScenario = applyTailoring(setupScenario!, {});
    render();
  });
}

// ---- scenario map and MSEL -------------------------------------------------------

function openMap(s: Scenario): void {
  mapScenario = s;
  history.replaceState(null, "", `#map/${s.id}`);
  setView("map");
}

function download(name: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function renderMap(): string {
  const s = mapScenario!;
  const flow = buildFlow(s);
  return `
  <header class="topbar">
    <button class="brand link" data-home><span class="logo">T</span> TTXSim</button>
    <div class="scenario-name">${esc(s.title)}: scenario map</div>
  </header>
  <main class="mapview">
    <section class="map-intro">
      <h1>${esc(s.title)}</h1>
      <p class="muted">${esc(s.org)}${s.sector ? ` · ${esc(s.sector)}` : ""} · ${esc(s.summary)}</p>
      ${setupLine(s) ? `<p class="muted">${esc(setupLine(s))}</p>` : ""}
      <p class="spoiler">For facilitators: this map shows the model response, the traps and what happens when steps are skipped. Players should see it after the exercise.</p>
      <div class="debrief-actions">
        <button class="btn primary" data-start="${esc(s.id)}">Play this scenario</button>
        <button class="btn" data-msel-md>Download MSEL (Markdown)</button>
        <button class="btn" data-msel-csv>Download MSEL (CSV for Excel)</button>
        ${(s.template ?? s).tailor.length ? `<button class="btn ghost" data-change-setup>Change setup</button>` : ""}
        <button class="btn ghost" data-home>All scenarios</button>
      </div>
    </section>
    ${variationHtml(s)}
    <section class="block">${renderFlow(flow)}</section>
    ${phasesGuideHtml(s)}
    ${attackHtml(s)}
  </main>`;
}

function bindMap(): void {
  const s = mapScenario!;
  app.querySelectorAll("[data-home]").forEach((b) =>
    b.addEventListener("click", () => {
      history.replaceState(null, "", "#");
      setView("home");
    }),
  );
  app.querySelector("[data-start]")?.addEventListener("click", () => startScenario(s));
  app.querySelector("[data-change-setup]")?.addEventListener("click", () => openSetup(s));
  app.querySelector("[data-msel-md]")?.addEventListener("click", () => download(`ttxsim-msel-${s.id}.md`, mselMarkdown(buildFlow(s)), "text/markdown"));
  app.querySelector("[data-msel-csv]")?.addEventListener("click", () => download(`ttxsim-msel-${s.id}.csv`, mselCsv(buildFlow(s)), "text/csv"));
}

// ---- debrief --------------------------------------------------------------------

function finish(): void {
  const d = sim!.debrief();
  saveProgress(sim!.scenario.id, d.score);
  setView("debrief");
}

function renderDebrief(): string {
  const s = sim!.scenario;
  const d = sim!.debrief();
  const g = grade(d, s);
  const idx = indexOfId(s);
  const next = idx >= 0 ? scenarios[idx + 1] : undefined;
  const objectives = d.objectives
    .map(
      (o) => `<li class="${o.passed ? "hit" : "miss"}">
        <span class="mark">${o.passed ? "✓" : "✗"}</span>
        <div><strong>${esc(o.objective.text)}</strong><p>${esc(o.passed ? o.objective.hit : o.objective.miss)}</p></div>
      </li>`,
    )
    .join("");
  const meters = d.meters
    .map(
      (m) => `<tr><td>${esc(m.label)}</td><td>${m.start}</td><td><span class="pill ${meterClass(m.value, m.good)}">${m.value}</span></td><td class="muted">${m.good === "high" ? "higher" : "lower"} is better</td></tr>`,
    )
    .join("");
  const lessons = d.lessons.length
    ? `<section class="block"><h3>Notes on your decisions</h3><ul class="lessons">${d.lessons
        .map((l) => `<li><strong>${esc(l.action.label)}</strong><p>${esc(l.text)}</p></li>`)
        .join("")}</ul></section>`
    : "";
  const timeline = sim!.log
    .map((e) => {
      const label = e.kind === "inject" ? "Received" : e.kind === "action" ? "You did" : e.kind === "end" ? "End" : "Event";
      return `<tr class="k-${e.kind}"><td class="muted">${esc(clockLabel(s, e.time))}</td><td>${label}</td><td>${esc(e.title)}</td></tr>`;
    })
    .join("");
  return `
  <header class="topbar">
    <button class="brand link" data-home><span class="logo">T</span> TTXSim</button>
    <div class="scenario-name">${esc(s.title)}</div>
  </header>
  <main class="debrief">
    <section class="result ${d.passed ? "pass" : "fail"}">
      <div class="score">${d.score}<span>%</span></div>
      <div>
        <h1>${esc(g)}</h1>
        <p>${esc(d.endText)}</p>
        ${setupLine(s) ? `<p class="muted">${esc(setupLine(s))}</p>` : ""}
        <p class="muted">Pass mark ${s.passMark}%. You used ${esc(duration(d.time))} of exercise time, ending at ${esc(clockLabel(s, d.time))}, and took ${d.actionsTaken} actions.</p>
      </div>
    </section>
    <div class="debrief-actions">
      <button class="btn primary" data-report>Download after-action report</button>
      <button class="btn" data-retry>Try again${s.seed !== undefined ? " (same run)" : ""}</button>
      ${s.seed !== undefined ? `<button class="btn" data-newrun-retry>Try a new run</button>` : ""}
      ${next ? `<button class="btn" data-next>Next: ${esc(next.title)}</button>` : ""}
      <button class="btn ghost" data-map>Scenario map and MSEL</button>
      <button class="btn ghost" data-home>All scenarios</button>
    </div>
    <section class="block"><h3>Objectives</h3><ul class="objective-results">${objectives}</ul></section>
    ${lessons}
    <section class="block"><h3>Where things ended</h3><table class="table"><thead><tr><th>Measure</th><th>Start</th><th>End</th><th></th></tr></thead><tbody>${meters}</tbody></table></section>
    <section class="block"><details><summary>Timeline (${sim!.log.length} events)</summary><table class="table timeline"><tbody>${timeline}</tbody></table></details></section>
    ${teamHtml()}
    ${attackHtml(s)}
    ${notesHtml()}
    <section class="block"><h3>Your path against the model path</h3>${renderFlow(buildFlow(s), overlayPath(buildFlow(s), sim!))}</section>
    ${aiHtml()}
    <section class="block hotwash"><h3>Hot wash questions for your team</h3><ul>
      <li>What did we know at each decision point, and what did we assume?</li>
      <li>Which decision would we make differently, and what would have told us sooner?</li>
      <li>Does our real incident response plan cover this situation? Who owns each gap?</li>
    </ul></section>
  </main>`;
}

function aiHtml(): string {
  const done = aiFeedback && aiFeedback.sim === sim ? aiFeedback.text : "";
  return `<section class="block ai"><details ${done ? "open" : ""}>
    <summary>Optional: AI feedback on your notes and decisions</summary>
    <p class="muted small">This sends the scenario summary, your timeline, decisions and discussion notes to the Anthropic API with your own API key, and asks ${esc(AI_MODEL)} for feedback. The key stays in this page while it is open and is never saved or sent anywhere else. Nothing is sent unless you press the button.</p>
    <div class="airow"><input type="password" id="ai-key" value="${esc(aiKey)}" placeholder="Anthropic API key" autocomplete="off" spellcheck="false" aria-label="Anthropic API key" /><button class="btn" data-ai>${done ? "Ask again" : "Get feedback"}</button></div>
    <div id="ai-out" class="ai-out">${done ? `<div class="text">${md(done)}</div><p class="muted small">Written by Claude. Treat it as a second opinion for the hot wash, not a verdict. It is included when you download the report.</p>` : ""}</div>
  </details></section>`;
}

function variationHtml(s: Scenario): string {
  const v = variantSummary(s);
  if (!v.length) return "";
  return `<section class="block"><h3>Variation in this run${s.seed !== undefined ? ` (run ${s.seed})` : ""}</h3>
    <ul class="variation">${v.map((x) => `<li>${esc(x.label)}: <strong>${esc(x.value)}</strong></li>`).join("")}</ul>
    <p class="muted small">Start the exercise from this page, or with the same run number, so players get this run.</p></section>`;
}

function teamHtml(): string {
  if (!sim || (!sim.decisions.length && !sim.pushed.length)) return "";
  const s = sim.scenario;
  const rows = sim.decisions
    .map(
      (d) => `<tr><td class="muted">${esc(clockLabel(s, d.time))}</td><td>${esc(d.label)}</td><td>${esc(d.by ?? "")}</td><td>${d.vote ? esc(d.vote.map((o) => `${o.label}: ${o.votes}`).join("; ")) : ""}</td><td>${esc(d.rationale ?? "")}</td></tr>`,
    )
    .join("");
  const pushed = sim.pushed.map((p) => `<li><span class="muted">${esc(clockLabel(s, p.time))}</span> ${esc(p.subject)}${p.custom ? ` <span class="muted">(written on the day)</span>` : ""}</li>`).join("");
  return `<section class="block"><h3>Team decisions</h3>
    ${rows ? `<table class="table"><thead><tr><th>Time</th><th>Decision</th><th>Decided by</th><th>Vote</th><th>Why</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="muted">No decisions were recorded.</p>`}
    ${pushed ? `<h3>Injects pushed by the facilitator</h3><ul class="pushed">${pushed}</ul>` : ""}
  </section>`;
}

function attackHtml(s: Scenario): string {
  if (!s.attack.length) return "";
  return `<section class="block"><h3>Attack path (MITRE ATT&amp;CK${s.attackMatrix === "ics" ? " for ICS" : ""})</h3>
    <ol class="attack">${s.attack
      .map(
        (a) => `<li><span class="attack-tactic">${esc(a.tactic)}</span><a href="${attackUrl(a.technique)}" target="_blank" rel="noopener">${esc(a.technique)} ${esc(a.name)}</a>${a.note ? `<p>${esc(a.note)}</p>` : ""}</li>`,
      )
      .join("")}</ol></section>`;
}

function notesHtml(): string {
  if (!sim || !sim.scenario.phases.length) return "";
  const rows = sim.scenario.phases
    .map((ph) => {
      const note = sim!.notes[ph.id];
      return `<li><strong>${esc(ph.title)}</strong>${note ? `<p>${esc(note)}</p>` : `<p class="muted">${sim!.phaseReached(ph.id) ? "No notes recorded." : "Not reached."}</p>`}</li>`;
    })
    .join("");
  return `<section class="block"><h3>Your discussion notes</h3><ul class="lessons notes-list">${rows}</ul></section>`;
}

function phasesGuideHtml(s: Scenario): string {
  if (!s.phases.length) return "";
  return `<section class="block"><h3>Discussion phases</h3>${s.phases
    .map(
      (ph) => `<div class="guide-phase"><strong>${esc(ph.title)}</strong>${ph.text ? `<div class="text">${md(ph.text)}</div>` : ""}<ol class="questions">${ph.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ol></div>`,
    )
    .join("")}</section>`;
}

function bindDebrief(): void {
  app.querySelectorAll("[data-home]").forEach((b) =>
    b.addEventListener("click", () => {
      history.replaceState(null, "", "#");
      setView("home");
    }),
  );
  app.querySelector("[data-retry]")?.addEventListener("click", () => startScenario(sim!.scenario, sim!.team));
  app.querySelector("[data-newrun-retry]")?.addEventListener("click", () => startScenario(applyTailoring(sim!.scenario, sim!.scenario.tailored, randomSeed()), sim!.team));
  app.querySelector("[data-next]")?.addEventListener("click", () => {
    const next = scenarios[indexOfId(sim!.scenario) + 1];
    if (next) begin(withSaved(next), sim!.team.length > 0);
  });
  app.querySelector("[data-report]")?.addEventListener("click", () =>
    download(`ttxsim-report-${sim!.scenario.id}.md`, reportMarkdown(sim!) + (aiFeedback && aiFeedback.sim === sim ? feedbackMarkdown(aiFeedback.text) : ""), "text/markdown"),
  );
  app.querySelector<HTMLButtonElement>("[data-ai]")?.addEventListener("click", async (e) => {
    const button = e.currentTarget as HTMLButtonElement;
    const out = app.querySelector<HTMLElement>("#ai-out")!;
    aiKey = app.querySelector<HTMLInputElement>("#ai-key")?.value.trim() ?? "";
    if (!aiKey) {
      out.innerHTML = `<p class="muted">Paste your Anthropic API key first.</p>`;
      return;
    }
    const current = sim!;
    button.disabled = true;
    out.innerHTML = `<p class="muted">Asking for feedback...</p>`;
    try {
      const text = await requestFeedback(current, { apiKey: aiKey, browser: true });
      aiFeedback = { sim: current, text };
      if (sim === current && view === "debrief") render();
    } catch (err) {
      out.innerHTML = `<div class="error">${esc((err as Error).message)}</div>`;
      button.disabled = false;
    }
  });
  app.querySelector("[data-map]")?.addEventListener("click", () => openMap(sim!.scenario));
}

// ---- main -----------------------------------------------------------------------

function render(): void {
  if (view === "setup" && setupScenario) {
    app.innerHTML = renderSetup();
    bindSetup();
  } else if (view === "home" || (!sim && view !== "map")) {
    app.innerHTML = renderHome();
    bindHome();
  } else if (view === "map" && mapScenario) {
    app.innerHTML = renderMap();
    bindMap();
  } else if (view === "play") {
    app.innerHTML = renderPlay();
    bindPlay();
  } else {
    app.innerHTML = renderDebrief();
    bindDebrief();
  }
}

try {
  scenarios = builtinScenarios();
} catch (err) {
  app.innerHTML = `<pre class="error">${esc((err as Error).message)}</pre>`;
  throw err;
}
const hash = location.hash.slice(1);
const mapFromHash = hash.startsWith("map/") ? scenarios.find((s) => s.id === hash.slice(4)) : undefined;
const setupFromHash = hash.startsWith("setup/") ? scenarios.find((s) => s.id === hash.slice(6)) : undefined;
const fromHash = scenarios.find((s) => s.id === hash);
if (mapFromHash) openMap(withSaved(mapFromHash));
else if (setupFromHash) openSetup(withSaved(setupFromHash));
else if (fromHash) startScenario(withSaved(fromHash));
else render();
