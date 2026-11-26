import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  builtinScenarios,
  evaluate,
  loadScenario,
  parse,
  reportMarkdown,
  runSteps,
  ScenarioError,
  Sim,
} from "../src/core/index.js";
import { checkPlayable } from "../src/cli/validate.js";

const ev = (src: string, vars: Record<string, number | boolean> = {}) => evaluate(parse(src), (n) => vars[n] ?? false);

describe("conditions", () => {
  it("follows the usual precedence", () => {
    assert.equal(ev("1 + 2 >= 3 and not false"), true);
    assert.equal(ev("a or b and c", { a: false, b: true, c: false }), false);
    assert.equal(ev("(a or b) and c", { a: true, b: false, c: true }), true);
    assert.equal(ev("-2 + 5"), 3);
  });

  it("reads durations as minutes", () => {
    assert.equal(ev("3h"), 180);
    assert.equal(ev("2d"), 2880);
    assert.equal(ev("time >= at.x + 30m", { time: 100, "at.x": 70 }), true);
  });

  it("rejects broken expressions with a clear message", () => {
    assert.throws(() => parse("a and"), /ends too early/);
    assert.throws(() => parse("a $ b"), /unexpected character/);
    assert.throws(() => parse("(a or b"), /missing/);
  });
});

const MINIMAL = `
id: tiny
title: Tiny
role: You
summary: A test
briefing: Test
start: Mon 23:30
limit: 2h
meters:
  spread: { label: Spread, start: 50, good: low }
injects:
  - id: hello
    at: 0
    from: Someone
    subject: Hi
    body: Hello
  - id: later
    at: 30
    when: not fixed
    from: Someone
    subject: Still broken
    body: It is still broken
  - id: reacts
    when: did.fix
    from: Someone
    subject: Thanks
    body: Thanks for fixing it
actions:
  - id: fix
    group: contain
    label: Fix it
    takes: 10
    result:
      - when: seen.later
        text: Fixed late
      - text: Fixed early
    effects: { set: [fixed], spread: -100 }
  - id: close
    group: coordinate
    when: fixed
    label: Close
    takes: 5
    result: Closed
    effects: { end: close }
rules:
  - id: grows
    when: not fixed
    every: 15
    effects: { spread: 10 }
objectives:
  - text: Fix it in time
    pass: fixed and at.fix <= 20
    hit: yes
    miss: no
solution: [fix, close]
`;

describe("loading", () => {
  it("loads a minimal scenario", () => {
    const s = loadScenario(MINIMAL);
    assert.equal(s.id, "tiny");
    assert.equal(s.limit, 120);
    assert.equal(s.startMinute, 23 * 60 + 30);
  });

  it("lists every problem at once", () => {
    const bad = MINIMAL.replace("title: Tiny", "").replace("pass: fixed and at.fix <= 20", "pass: fixd and did.nothing");
    try {
      loadScenario(bad);
      assert.fail("expected an error");
    } catch (err) {
      assert.ok(err instanceof ScenarioError);
      const all = err.problems.join("\n");
      assert.match(all, /title is missing/);
      assert.match(all, /"fixd" is not a known/);
      assert.match(all, /"did.nothing" is not a known/);
    }
  });

  it("catches ids used twice and unknown meters", () => {
    const bad = MINIMAL.replace("id: later", "id: fix").replace("spread: -100", "speed: -100");
    assert.throws(() => loadScenario(bad), (err: ScenarioError) => {
      const all = err.problems.join("\n");
      return /used twice/.test(all) && /meter "speed"/.test(all);
    });
  });
});

describe("the engine", () => {
  it("delivers timed and conditional injects and applies rules", () => {
    const sim = new Sim(loadScenario(MINIMAL));
    assert.equal(sim.inbox.length, 1);
    sim.wait(30);
    assert.equal(sim.time, 30);
    assert.equal(sim.meters.spread, 70, "two ticks of +10");
    assert.ok(sim.done.has("later"));
    const r = sim.act("fix");
    assert.ok(r.ok);
    assert.equal(r.text, "Fixed late");
    assert.equal(sim.meters.spread, 0, "meters stay between 0 and 100");
    assert.ok(sim.done.has("reacts"), "condition injects fire right after the action");
  });

  it("uses action time and scores objectives", () => {
    const s = loadScenario(MINIMAL);
    const sim = runSteps(s, s.solution);
    assert.ok(sim.ended);
    const d = sim.debrief();
    assert.equal(d.score, 100);
    assert.equal(d.passed, true);
    assert.equal(sim.done.get("fix"), 10);
  });

  it("refuses unknown or repeated actions", () => {
    const sim = new Sim(loadScenario(MINIMAL));
    assert.equal(sim.act("nope").ok, false);
    assert.equal(sim.act("close").ok, false, "not available until fixed");
    sim.act("fix");
    assert.equal(sim.act("fix").error, "You have already done that.");
  });

  it("ends on its own when time runs out", () => {
    const sim = new Sim(loadScenario(MINIMAL));
    while (!sim.ended) sim.wait(60);
    assert.equal(sim.time, 120);
    assert.equal(sim.debrief().passed, false);
  });

  it("shows the day once the clock passes midnight", async () => {
    const { clockLabel } = await import("../src/core/report.js");
    const s = loadScenario(MINIMAL);
    assert.equal(clockLabel(s, 0), "Mon 23:30");
    assert.equal(clockLabel(s, 45), "Tue 00:15");
  });
});

describe("built-in scenarios", () => {
  const scenarios = builtinScenarios();

  it("ships fifteen scenarios with unique ids", () => {
    assert.equal(scenarios.length, 15);
    assert.equal(new Set(scenarios.map((s) => s.id)).size, 15);
  });

  for (const s of scenarios) {
    it(`${s.id}: the solution scores 100% and doing nothing fails`, () => {
      const r = checkPlayable(s);
      assert.deepEqual(r.problems, []);
    });
  }

  it("writes an after-action report", () => {
    const s = scenarios[0];
    const md = reportMarkdown(runSteps(s, s.solution), new Date("2026-01-01"));
    assert.match(md, /^# After-action report: /);
    assert.match(md, /RS\.MI Incident Mitigation/);
    assert.match(md, /\[x\]/);
  });

  it("uses no em or en dashes in scenario text", async () => {
    const { builtinScenarioFiles } = await import("../src/core/index.js");
    for (const f of builtinScenarioFiles()) assert.doesNotMatch(f.source, /[\u2013\u2014]/, f.file);
  });
});
