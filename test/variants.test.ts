import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AI_API_VERSION,
  AI_MODEL,
  allPlans,
  applyTailoring,
  buildFlow,
  builtinScenarios,
  feedbackPrompt,
  hasVariation,
  loadScenario,
  mselMarkdown,
  mulberry32,
  planVariants,
  reportMarkdown,
  requestFeedback,
  runSteps,
  ScenarioError,
  Sim,
  variantSummary,
} from "../src/core/index.js";

const byId = (id: string) => builtinScenarios().find((s) => s.id === id)!;

describe("variants and run numbers", () => {
  it("the random generator is repeatable", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 5 }, () => a());
    assert.deepEqual(xs, Array.from({ length: 5 }, () => b()));
    assert.ok(xs.every((x) => x >= 0 && x < 1));
  });

  it("the same run number gives the same run", () => {
    const s = byId("substation-commands");
    assert.deepEqual(planVariants(s, 4821), planVariants(s, 4821));
    const seen = new Set<string>();
    for (let seed = 1; seed < 60; seed++) seen.add(planVariants(s, seed).choices.implant_site);
    assert.equal(seen.size, 3, "every option comes up across runs");
  });

  it("applies the chosen option to text and flags", () => {
    const s = applyTailoring(byId("substation-commands"), {}, { choices: { implant_site: "s4" }, chances: { wiped: true } });
    assert.ok(s.initialFlags.includes("implant_site_s4"));
    const n12 = s.injects.find((i) => i.id === "n12_hit")!;
    assert.match(n12.subject, /South-4/);
    const played = JSON.stringify({ i: s.injects, a: s.actions, p: s.phases, st: s.status, o: s.objectives, at: s.attack, b: s.briefing });
    assert.doesNotMatch(played, /North-12/);
    assert.doesNotMatch(played, /\{\{/);
  });

  it("a chance inject that is out of the run waits for the facilitator", () => {
    const s = applyTailoring(byId("pump-station-intrusion"), {}, { choices: { device: "wifi" }, chances: { vishing_call: false } });
    const sim = new Sim(s);
    while (!sim.ended) sim.wait(60);
    assert.ok(!sim.done.has("vishing_call"));
    const fresh = new Sim(s);
    assert.ok(fresh.pushable().some((i) => i.id === "vishing_call"));
    assert.equal(runSteps(s, s.solution).debrief().score, 100, "the optional ?verify_caller step is skipped");
  });

  it("re-tailoring keeps the run, and a new number changes it", () => {
    const run = applyTailoring(byId("historian-pivot"), {}, 1234);
    assert.equal(run.seed, 1234);
    const renamed = applyTailoring(run, { org: "Zeta" });
    assert.deepEqual(renamed.plan, run.plan);
    assert.equal(renamed.seed, 1234);
    assert.equal(renamed.org, "Zeta");
  });

  it("lists every combination for the validator", () => {
    assert.equal(allPlans(byId("setpoint-change")).length, 4);
    assert.equal(allPlans(byId("substation-commands")).length, 6);
    assert.ok(!hasVariation(byId("phishing-click")));
  });

  it("shows the run in reports and MSELs", () => {
    const s = applyTailoring(byId("setpoint-change"), {}, 2002);
    const v = variantSummary(s);
    assert.equal(v[0].label, "How the attacker reaches the HMI");
    const sim = runSteps(s, s.solution);
    assert.match(reportMarkdown(sim), /\*\*Variation \(run 2002\):\*\* How the attacker reaches the HMI: /);
    assert.match(mselMarkdown(buildFlow(s)), /## Variation in this run \(run 2002\)/);
  });

  it("rejects bad variant definitions", () => {
    const base = `
id: v
title: V
level: custom
summary: s
role: r
org: o
start: Mon 09:00
limit: 1h
briefing: "{{#who_a}}A{{/who_a}}{{#who_b}}B{{/who_b}}"
variants:
  - id: who
    label: Who
    options:
      - { id: a, label: A }
      - { id: b, label: B }
meters: { m: { label: M, start: 50, good: low } }
injects:
  - { id: i, at: 5, chance: 50%, from: x, via: email, subject: s, body: b }
actions:
  - { id: x, group: contain, label: X, takes: 5, result: ok, effects: { m: -50 } }
objectives:
  - { text: t, pass: did.x, weight: 1, hit: h, miss: m }
solution: [x]
`;
    const ok = loadScenario(base, "v.yaml");
    assert.equal(ok.briefing, "A");
    assert.equal(ok.injects[0].chance, 0.5);
    const bad = (src: string, text: string) =>
      assert.throws(() => loadScenario(src, "v.yaml"), (e: unknown) => e instanceof ScenarioError && e.problems.some((p) => p.includes(text)), text);
    bad(base.replace("      - { id: b, label: B }\n", ""), "at least two options");
    bad(base.replace("chance: 50%", "chance: 2"), "between 0 and 1");
    bad(base.replace("{{#who_a}}A{{/who_a}}", "{{#who}}A{{/who}}"), "yes or no value");
  });
});

describe("optional AI feedback", () => {
  const finished = () => {
    const s = byId("historian-pivot");
    const sim = new Sim(s);
    sim.team = [{ role: "lead", name: "Sara" }];
    sim.decide("cut_replication", { by: "Sara (Incident lead)", rationale: "The path is open" });
    sim.setNote("earlier_signs", "Nobody owns hist_sync. We accepted the risk two years ago.");
    sim.finish();
    return sim;
  };

  it("builds a prompt from the team's own notes and decisions", () => {
    const { system, user } = feedbackPrompt(finished());
    assert.match(system, /### What went well/);
    assert.doesNotMatch(system, /\u2014/);
    assert.match(user, /Nobody owns hist_sync/);
    assert.match(user, /Reason given: The path is open/);
    assert.match(user, /Team seats: Sara \(Incident lead\)/);
  });

  it("calls the Messages API with the current version and no sampling settings", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ content: [{ type: "text", text: "### What went well\n- Fast cut" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const text = await requestFeedback(finished(), { apiKey: " sk-test ", browser: true, fetchImpl: fake });
    assert.equal(text, "### What went well\n- Fast cut");
    assert.equal(seen!.url, "https://api.anthropic.com/v1/messages");
    const h = seen!.init.headers as Record<string, string>;
    assert.equal(h["x-api-key"], "sk-test");
    assert.equal(h["anthropic-version"], AI_API_VERSION);
    assert.equal(h["anthropic-dangerous-direct-browser-access"], "true");
    const body = JSON.parse(String(seen!.init.body));
    assert.equal(body.model, AI_MODEL);
    assert.ok(!("temperature" in body) && !("top_p" in body) && !("top_k" in body));
  });

  it("explains API errors and a missing key", async () => {
    const fake = (async () => new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 })) as unknown as typeof fetch;
    await assert.rejects(requestFeedback(finished(), { apiKey: "bad", fetchImpl: fake }), /invalid x-api-key/);
    await assert.rejects(requestFeedback(finished(), { apiKey: "  " }), /API key/);
  });
});
