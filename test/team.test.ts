import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFlow, builtinScenarios, loadScenario, mselMarkdown, reportMarkdown, ScenarioError, Sim } from "../src/core/index.js";

const byId = (id: string) => builtinScenarios().find((s) => s.id === id)!;

describe("team play and the facilitator", () => {
  it("optional injects never arrive on their own", () => {
    for (const s of builtinScenarios()) {
      const sim = new Sim(s);
      while (!sim.ended) sim.wait(60);
      for (const i of s.injects.filter((x) => x.optional)) assert.ok(!sim.done.has(i.id), `${s.id}: ${i.id}`);
    }
  });

  it("every OT scenario has optional injects of its own", () => {
    for (const s of builtinScenarios().filter((x) => x.level === "ot")) {
      assert.ok(s.injects.filter((i) => i.optional && i.note).length >= 2, s.id);
    }
  });

  it("pushes scenario and generic injects once, respecting when", () => {
    const sim = new Sim(byId("historian-pivot"));
    const ids = () => sim.pushable().map((i) => i.id);
    assert.ok(!ids().includes("opt_soc_pushback"), "needs the link cut first");
    assert.ok(ids().includes("fac_media"));
    sim.act("cut_replication");
    assert.ok(ids().includes("opt_soc_pushback"));
    const events = sim.push("opt_soc_pushback");
    assert.equal(events[0]?.kind, "inject");
    assert.ok(sim.inbox.some((d) => d.inject.id === "opt_soc_pushback"));
    assert.ok(!ids().includes("opt_soc_pushback"), "only once");
    assert.deepEqual(sim.push("opt_soc_pushback"), []);
    sim.push("fac_media");
    assert.match(sim.inbox.at(-1)!.body, /Gulfside Power and Water/);
    sim.pushCustom("Facilities", "Fire alarm test", "At 11:30.");
    assert.equal(sim.inbox.at(-1)!.inject.from, "Facilities");
    assert.deepEqual(
      sim.pushed.map((p) => [p.id, p.custom]),
      [
        ["opt_soc_pushback", false],
        ["fac_media", false],
        ["facilitator_1", true],
      ],
    );
  });

  it("records decisions at the time they were made, with votes and reasons", () => {
    const sim = new Sim(byId("historian-pivot"));
    sim.team = [
      { role: "lead", name: "Sara" },
      { role: "ops", name: "" },
    ];
    sim.decide("cut_replication", { by: "Sara (Incident lead)", rationale: "Path still open" });
    sim.decide("isolate_ews", {
      by: "Team vote",
      rationale: "Engineering wanted the account first",
      vote: [
        { action: "isolate_ews", label: "Disconnect EWS-1", votes: 4 },
        { action: "disable_hist_sync", label: "Disable hist_sync", votes: 2 },
      ],
    });
    assert.deepEqual(
      sim.decisions.map((d) => [d.time, d.action, d.by]),
      [
        [0, "cut_replication", "Sara (Incident lead)"],
        [5, "isolate_ews", "Team vote"],
      ],
    );
    sim.push("fac_exec");
    sim.finish();
    const report = reportMarkdown(sim);
    assert.match(report, /## Team\n/);
    assert.match(report, /\| Incident lead \| Sara \|/);
    assert.match(report, /\| Operations or plant manager \| _not named_ \|/);
    assert.match(report, /## Team decisions/);
    assert.match(report, /Disconnect EWS-1: 4; Disable hist_sync: 2/);
    assert.match(report, /1 decision was not unanimous/);
    assert.match(report, /## Injects pushed by the facilitator\n\n- Tue 10:40: The CEO wants a yes or no/);
  });

  it("leaves team sections out of a solo report", () => {
    const sim = new Sim(byId("historian-pivot"));
    sim.act("cut_replication");
    sim.finish();
    assert.doesNotMatch(reportMarkdown(sim), /## Team/);
  });

  it("lists optional injects in the MSEL", () => {
    const msel = mselMarkdown(buildFlow(byId("pump-station-intrusion")));
    assert.match(msel, /## Optional injects for the facilitator/);
    assert.match(msel, /\| The technician wants to go in \| Phone call \| On-call technician \| Tests the lone worker rule/);
    assert.match(msel, /\| A reporter wants a comment \|/);
  });

  it("rejects an optional inject with a fixed time", () => {
    const src = `
id: t
title: T
level: custom
summary: s
role: r
org: o
start: Mon 09:00
limit: 1h
briefing: b
meters: { m: { label: M, start: 50, good: low } }
injects:
  - { id: a, at: 0, from: x, via: email, subject: s, body: b }
  - { id: b, at: 10, optional: true, from: x, via: email, subject: s, body: b }
actions:
  - { id: x, group: contain, label: X, takes: 5, result: ok, effects: { m: -50 } }
objectives:
  - { text: t, pass: did.x, weight: 1, hit: h, miss: m }
solution: [x]
`;
    assert.throws(() => loadScenario(src, "t.yaml"), (e: unknown) => e instanceof ScenarioError && e.problems.some((p) => p.includes("optional inject has no")));
  });
});
