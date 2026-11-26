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
  | { kind: "update"; entries: LogEntry[]; note?: string };

let scenarios: Scenario[] = [];
let custom: Scenario | undefined;
let sim: Sim | undefined;
let reader: Reader = { kind: "briefing" };
let view: "home" | "setup" | "play" | "debrief" | "map" = "home";
let mapScenario: Scenario | undefined;
let setupScenario: Scenario | undefined;

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

/** A built-in scenario with the settings last used in this browser. */
function withSaved(s: Scenario): Scenario {
  return s.tailor.length ? applyTailoring(s, savedSettings(s.id)) : s;
}

function indexOfId(s: Scenario): number {
  return scenarios.findIndex((x) => x.id === s.id);
}

/** Play goes through the setup screen when a scenario has settings. */
function begin(s: Scenario): void {
  if ((s.template ?? s).tailor.length) openSetup(s);
  else startScenario(s);
}

function setupLine(s: Scenario): string {
  const changed = tailorSummary(s).filter((t) => t.changed);
  return changed.length ? `Setup: ${changed.map((t) => `${t.label}: ${t.value}`).join("; ")}` : "";
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
  render();
  window.scrollTo({ top: 0 });
}

function startScenario(s: Scenario): void {
  sim = new Sim(s);
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

function renderActions(): string {
  const list = sim!.availableActions();
  const groups = GROUPS.map((g) => {
    const items = list.filter((a) => a.group === g);
    if (!items.length) return "";
    return `<div class="group"><h4 title="${esc(GROUP_INFO[g].csf)}">${esc(GROUP_INFO[g].label)}</h4>${items
      .map(
        (a) => `<button class="action g-${g}" data-act="${esc(a.id)}"><span>${esc(a.label)}</span><span class="dur">${esc(duration(a.takes))}</span></button>`,
      )
      .join("")}</div>`;
  }).join("");
  const long = sim!.scenario.limit > 1440;
  return `${groups}
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
    <div class="scenario-name">${esc(s.title)}</div>
    <div class="clock" aria-live="polite"><strong>${esc(clockLabel(s, sim!.time))}</strong><span>${esc(elapsedLabel(sim!.time))}</span></div>
  </header>
  <div class="meters">${renderMeters()}</div>
  ${renderStatus()}
  <main class="board">
    <aside class="pane inbox"><h2>Inbox ${unread ? `<span class="count">${unread}</span>` : ""}</h2><div class="mails">${renderInbox()}</div></aside>
    <section class="pane reader" aria-live="polite">${renderReader()}</section>
    <aside class="pane actions"><h2>Actions</h2>${renderActions()}</aside>
  </main>`;
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
      const r = sim!.act(b.dataset.act!);
      after(r.events, r.ok ? undefined : r.error);
    }),
  );
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

function openSetup(s: Scenario): void {
  setupScenario = s;
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
      <p>Tailor the exercise before you start. Names appear in the briefing and messages. Yes or no settings change what your team has to work with, and the scenario plays out differently.</p>
      <form id="setup-form">
        ${rows}
        <div class="debrief-actions">
          <button type="submit" class="btn primary">Start the exercise</button>
          <button type="button" class="btn" data-setup-map title="Contains spoilers">Map and MSEL with these settings</button>
          <button type="button" class="btn ghost" data-reset>Back to defaults</button>
          <button type="button" class="btn ghost" data-home>All scenarios</button>
        </div>
      </form>
      <p class="muted small">Settings stay in this browser only.</p>
    </section>
  </main>`;
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
  return applyTailoring(s, values);
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
    startScenario(readSetup());
  });
  app.querySelector("[data-setup-map]")?.addEventListener("click", () => openMap(readSetup()));
  app.querySelector("[data-reset]")?.addEventListener("click", () => {
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
      <button class="btn" data-retry>Try again</button>
      ${next ? `<button class="btn" data-next>Next: ${esc(next.title)}</button>` : ""}
      <button class="btn ghost" data-map>Scenario map and MSEL</button>
      <button class="btn ghost" data-home>All scenarios</button>
    </div>
    <section class="block"><h3>Objectives</h3><ul class="objective-results">${objectives}</ul></section>
    ${lessons}
    <section class="block"><h3>Where things ended</h3><table class="table"><thead><tr><th>Measure</th><th>Start</th><th>End</th><th></th></tr></thead><tbody>${meters}</tbody></table></section>
    <section class="block"><details><summary>Timeline (${sim!.log.length} events)</summary><table class="table timeline"><tbody>${timeline}</tbody></table></details></section>
    ${attackHtml(s)}
    ${notesHtml()}
    <section class="block"><h3>Your path against the model path</h3>${renderFlow(buildFlow(s), overlayPath(buildFlow(s), sim!))}</section>
    <section class="block hotwash"><h3>Hot wash questions for your team</h3><ul>
      <li>What did we know at each decision point, and what did we assume?</li>
      <li>Which decision would we make differently, and what would have told us sooner?</li>
      <li>Does our real incident response plan cover this situation? Who owns each gap?</li>
    </ul></section>
  </main>`;
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
  app.querySelector("[data-retry]")?.addEventListener("click", () => startScenario(sim!.scenario));
  app.querySelector("[data-next]")?.addEventListener("click", () => {
    const next = scenarios[indexOfId(sim!.scenario) + 1];
    if (next) begin(withSaved(next));
  });
  app.querySelector("[data-report]")?.addEventListener("click", () => download(`ttxsim-report-${sim!.scenario.id}.md`, reportMarkdown(sim!), "text/markdown"));
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
