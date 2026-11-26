import { clockLabel, groupLabel, type Flow, type PathOverlay } from "../../src/core/index.js";
import { esc } from "./md.js";

const BRANCH_LABEL = { trap: "Trap", missed: "If you skip it", fail: "Failure" } as const;

/** Render a scenario flow as HTML. With an overlay, mark the player's own path on it. */
export function renderFlow(flow: Flow, overlay?: PathOverlay): string {
  const s = flow.scenario;
  const rows = flow.steps
    .map((step) => {
      const tag =
        step.kind === "inject" ? "Message" : step.kind === "end" ? "End" : esc(groupLabel(step.group));
      let state = "";
      let badge = "";
      if (overlay && step.kind === "action") {
        state = overlay.done.has(step.id) ? " done" : " missed";
        badge = overlay.done.has(step.id) ? `<span class="flow-badge ok">You did this</span>` : `<span class="flow-badge bad">You missed this</span>`;
      } else if (overlay && step.kind === "inject" && !overlay.done.has(step.id)) {
        state = " faded";
      }
      const branches = step.branches
        .map((b) => {
          const hit = overlay?.happened.has(b.id);
          const cls = overlay ? (hit ? " happened" : " faded") : "";
          const note = overlay && hit ? `<span class="flow-badge bad">${b.kind === "trap" ? "You chose this" : "This happened to you"}</span>` : "";
          const detail = b.detail && b.detail !== b.title ? `<p>${esc(b.detail)}</p>` : "";
          return `<div class="branch b-${b.kind}${cls}"><span class="branch-kind">${BRANCH_LABEL[b.kind]}</span>${note}<strong>${esc(b.title)}</strong>${detail}</div>`;
        })
        .join("");
      return `<li class="flow-row">
        <div class="flow-time">${esc(clockLabel(s, step.time))}</div>
        <div class="flow-step k-${step.kind}${state}">
          <span class="flow-tag">${tag}</span>${badge}
          <strong>${esc(step.title)}</strong>
          ${step.detail ? `<p>${esc(step.detail)}</p>` : ""}
        </div>
        <div class="flow-branches">${branches}</div>
      </li>`;
    })
    .join("");
  const extra =
    overlay && overlay.extra.length
      ? `<p class="muted flow-extra">Other actions you took: ${overlay.extra.map((a) => esc(a.label)).join("; ")}.</p>`
      : "";
  return `<div class="flow-legend">
      <span><i class="lg lg-step"></i>Model response</span>
      <span><i class="lg lg-missed"></i>Consequence if a step is skipped</span>
      <span><i class="lg lg-trap"></i>Trap</span>
      <span><i class="lg lg-fail"></i>Failure</span>
    </div>
    <ol class="flow">${rows}</ol>${extra}`;
}
