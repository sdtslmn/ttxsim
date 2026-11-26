import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFlow, buildMsel, builtinScenarios, mselCsv, mselMarkdown, overlayPath, runSteps, Sim } from "../src/core/index.js";

const byId = (id: string) => builtinScenarios().find((s) => s.id === id)!;

describe("scenario flow", () => {
  it("follows the solution and finds what skipping a step causes", () => {
    const flow = buildFlow(byId("ot-ransomware"));
    const cut = flow.steps.find((x) => x.id === "cut_it_ot")!;
    assert.ok(cut, "the firewall cut is on the spine");
    assert.deepEqual(
      cut.branches.map((b) => b.id).sort(),
      ["ews_hit", "historian_hit", "hmi1_hit"],
    );
    const vendor = flow.steps.find((x) => x.id === "vendor_offer")!;
    assert.ok(vendor.branches.some((b) => b.kind === "trap" && b.id === "vendor_vpn"), "a trap unlocked by a message sits next to it");
    assert.equal(flow.steps[flow.steps.length - 1].kind, "end");
  });

  it("marks failure branches", () => {
    const flow = buildFlow(byId("sis-trip"));
    const reload = flow.steps.find((x) => x.id === "reload_logic")!;
    assert.ok(reload.branches.some((b) => b.kind === "fail"));
  });

  it("builds a flow for every scenario", () => {
    for (const s of builtinScenarios()) {
      const flow = buildFlow(s);
      assert.ok(flow.steps.length > 3, s.id);
    }
  });
});

describe("your path", () => {
  it("marks done, missed and what happened", () => {
    const s = byId("ot-ransomware");
    const flow = buildFlow(s);
    const sim = new Sim(s);
    sim.act("manual_ops");
    sim.wait(60);
    sim.finish();
    const o = overlayPath(flow, sim);
    assert.ok(o.done.has("manual_ops"));
    assert.ok(!o.done.has("cut_it_ot"));
    assert.ok(o.happened.has("historian_hit"));
  });

  it("marks everything done for the model path", () => {
    const s = byId("phishing-click");
    const flow = buildFlow(s);
    const o = overlayPath(flow, runSteps(s, s.solution));
    for (const step of flow.steps.filter((x) => x.kind === "action")) assert.ok(o.done.has(step.id), step.id);
    assert.equal(o.happened.size, 0);
  });
});

describe("MSEL", () => {
  it("lists injects with expected actions and contingent injects", () => {
    const flow = buildFlow(byId("setpoint-change"));
    const rows = buildMsel(flow);
    assert.equal(rows[0].kind, "Inject");
    assert.ok(rows[0].expected.length > 0, "the first message has expected actions");
    assert.ok(rows.some((r) => r.kind === "Contingent inject" && r.event === "It's happening again"));
    const md = mselMarkdown(flow);
    assert.match(md, /^# Master scenario events list: The cursor moved/);
    assert.match(md, /## Traps to watch for/);
    const csv = mselCsv(flow);
    assert.match(csv.split("\r\n")[0], /^"#","Time"/);
    assert.equal(csv.trim().split("\r\n").length, rows.length + 1);
  });
});
