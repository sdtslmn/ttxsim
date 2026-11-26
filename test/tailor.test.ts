import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyTailoring,
  buildFlow,
  builtinScenarios,
  loadScenario,
  mselMarkdown,
  parseTailorArgs,
  reportMarkdown,
  runSteps,
  ScenarioError,
  Sim,
  tailorSummary,
} from "../src/core/index.js";

const byId = (id: string) => builtinScenarios().find((s) => s.id === id)!;

const SMALL = `
id: tiny
title: Tiny
level: custom
summary: A test.
role: You.
org: "{{org}}"
start: Mon 09:00
limit: 2h
briefing: "{{org}} has one server.{{#backups}} Backups exist.{{/backups}}{{^backups}} There are no backups.{{/backups}}"
tailor:
  - id: org
    label: Organization name
    type: text
    default: Acme
  - id: backups
    label: Backups exist
    type: toggle
    default: true
meters:
  risk: { label: Risk, start: 50, good: low }
injects:
  - id: hello
    at: 0
    from: "{{org}} IT"
    via: email
    subject: Hello
    body: Something happened at {{org}}.
actions:
  - id: restore
    group: recover
    when: backups
    label: Restore from backup
    takes: 10
    result: Restored.
    effects: { set: [fixed] }
  - id: rebuild
    group: recover
    when: not backups
    label: Rebuild by hand
    takes: 60
    result: Rebuilt.
    effects: { set: [fixed] }
objectives:
  - text: Fix it
    pass: fixed
    weight: 1
    hit: Fixed.
    miss: Not fixed.
solution: [?restore, ?rebuild, end]
`;

describe("tailoring", () => {
  it("fills placeholders with defaults when nothing is given", () => {
    const s = loadScenario(SMALL, "tiny.yaml");
    assert.equal(s.org, "Acme");
    assert.match(s.briefing, /^Acme has one server\. Backups exist\.$/);
    assert.equal(s.injects[0].from, "Acme IT");
    assert.deepEqual(s.initialFlags, ["backups"]);
  });

  it("applies text values and yes/no sections", () => {
    const s = applyTailoring(loadScenario(SMALL, "tiny.yaml"), { org: 'Gulf "North" Plant', backups: false });
    assert.equal(s.org, 'Gulf "North" Plant');
    assert.match(s.briefing, /There are no backups\./);
    assert.doesNotMatch(s.briefing, /Backups exist/);
    assert.deepEqual(s.initialFlags, []);
    const again = applyTailoring(s, { org: "Other" });
    assert.equal(again.org, "Other", "re-tailoring starts from the template");
    assert.match(again.briefing, /Backups exist/);
  });

  it("toggles change which actions are available, and optional solution steps follow", () => {
    const yes = new Sim(loadScenario(SMALL, "tiny.yaml"));
    assert.ok(yes.findAction("restore"));
    assert.ok(yes.availableActions().some((a) => a.id === "restore"));
    assert.ok(!yes.availableActions().some((a) => a.id === "rebuild"));
    const base = loadScenario(SMALL, "tiny.yaml");
    for (const backups of [true, false]) {
      const sim = runSteps(applyTailoring(base, { backups }), base.solution);
      assert.equal(sim.debrief().score, 100, `backups=${backups}`);
    }
  });

  it("reads key=value words and reports bad ones", () => {
    const s = loadScenario(SMALL, "tiny.yaml");
    assert.deepEqual(parseTailorArgs(s, ["org=Foo", "backups=no"]), { values: { org: "Foo", backups: "no" }, problems: [] });
    assert.equal(parseTailorArgs(s, ["colour=red"]).problems.length, 1);
    assert.equal(parseTailorArgs(s, ["backups=maybe"]).problems.length, 1);
    assert.equal(parseTailorArgs(s, ["oops"]).problems.length, 1);
  });

  it("rejects placeholders without a field and sections on text fields", () => {
    assert.throws(() => loadScenario(SMALL.replace("one server.", "one {{site}} server."), "x.yaml"), (e: unknown) => e instanceof ScenarioError && e.problems.some((p) => p.includes("{{site}}")));
    assert.throws(() => loadScenario(SMALL.replace("{{#backups}} Backups", "{{#org}}{{/org}}{{#backups}} Backups"), "x.yaml"), (e: unknown) => e instanceof ScenarioError && e.problems.some((p) => p.includes("toggle")));
  });

  it("shows the setup in reports and MSELs", () => {
    const s = applyTailoring(byId("sis-trip"), { org: "Ras Plant", offline_master: false });
    assert.deepEqual(
      tailorSummary(s).map((t) => [t.id, t.value, t.changed]),
      [
        ["org", "Ras Plant", true],
        ["offline_master", "no", true],
      ],
    );
    const sim = runSteps(s, s.solution);
    assert.equal(sim.debrief().score, 100);
    assert.match(reportMarkdown(sim), /\*\*Setup:\*\* Organization name: Ras Plant; An offline master copy of the SIS logic exists: no/);
    const msel = mselMarkdown(buildFlow(s));
    assert.match(msel, /## Setup for this exercise/);
    assert.match(msel, /rebuild the safety logic/);
  });

  it("every OT scenario can take at least an organization name", () => {
    for (const s of builtinScenarios().filter((x) => x.level === "ot")) {
      assert.ok(s.tailor.some((t) => t.id === "org"), s.id);
      const t = applyTailoring(s, { org: "Zeta Utilities" });
      assert.equal(t.org, "Zeta Utilities");
      assert.match(t.briefing, /Zeta Utilities/, s.id);
    }
  });

  it("without golden images, the ransomware recovery takes longer but still passes", () => {
    const base = byId("ot-ransomware");
    const fast = runSteps(base, base.solution);
    const slow = runSteps(applyTailoring(base, { golden_images: false }), base.solution);
    assert.equal(slow.debrief().score, 100);
    assert.ok(slow.time > fast.time + 3 * 60, `${slow.time} vs ${fast.time}`);
  });
});
