import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { builtinScenarios, loadScenario, mselMarkdown, buildFlow, reportMarkdown, Sim, ScenarioError } from "../src/core/index.js";

const byId = (id: string) => builtinScenarios().find((s) => s.id === id)!;
const OT = builtinScenarios().filter((s) => s.level === "ot");

describe("OT scenario upgrades", () => {
  it("every OT scenario has phases, status indicators and an attack path", () => {
    assert.ok(OT.length >= 4);
    for (const s of OT) {
      assert.ok(s.phases.length >= 3, `${s.id} phases`);
      assert.ok(s.status.length >= 3, `${s.id} status`);
      assert.ok(s.attack.length >= 4, `${s.id} attack`);
      assert.equal(s.attackMatrix, "ics");
    }
  });

  it("reaches phases and keeps notes for the report", () => {
    const s = byId("sis-trip");
    const sim = new Sim(s);
    assert.ok(sim.phaseReached("earlier_signs"));
    assert.ok(!sim.phaseReached("hold"));
    sim.act("hold_restart");
    assert.ok(sim.phaseReached("hold"), "a condition phase opens as soon as it is true");
    sim.setNote("hold", "Ops manager has the authority, but it isn't written down.");
    assert.equal(sim.log.filter((e) => e.kind === "phase").length, 2);
    sim.finish();
    const md = reportMarkdown(sim);
    assert.match(md, /## Discussion notes/);
    assert.match(md, /isn't written down/);
    assert.match(md, /## Attack path \(MITRE ATT&CK for ICS\)/);
    assert.match(md, /\| Unit 2 \| On hold \|/);
  });

  it("status indicators follow the state of play", () => {
    const sim = new Sim(byId("ot-ransomware"));
    const link = () => sim.statusNow().find((x) => x.item.id === "link")!;
    assert.equal(link().text, "Open");
    sim.act("cut_it_ot");
    assert.equal(link().text, "Cut");
    assert.equal(link().tone, "ok");
  });

  it("puts phases and the attack path in the MSEL", () => {
    const md = mselMarkdown(buildFlow(byId("vendor-access")));
    assert.match(md, /## Discussion phases/);
    assert.match(md, /T0836 Modify Parameter/);
  });

  it("checks phase and status definitions", () => {
    const bad = `
id: x
title: X
role: r
summary: s
briefing: b
actions:
  - id: a
    group: contain
    label: A
    result: ok
objectives:
  - text: t
    pass: did.a
    hit: h
    miss: m
phases:
  - id: p
    title: P
    when: nonsense_flag
status:
  - id: st
    label: S
    states:
      - when: did.a
        text: Done
        tone: green
attack:
  - tactic: Impact
    technique: X1
    name: Bad
`;
    assert.throws(() => loadScenario(bad), (err: ScenarioError) => {
      const all = err.problems.join("\n");
      return /phase p needs at least one question/.test(all) && /tone ok, warn, bad or info/.test(all) && /last state should have no "when"/.test(all) && /should look like T0859/.test(all) && /"nonsense_flag" is not a known/.test(all);
    });
  });
});
