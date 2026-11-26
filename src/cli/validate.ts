import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { builtinScenarioFiles, loadScenario, runSteps, Sim, ScenarioError, type Scenario } from "../core/index.js";
import { c } from "./term.js";

export interface CheckResult {
  id: string;
  ok: boolean;
  problems: string[];
  solutionScore?: number;
  idleScore?: number;
}

/**
 * Check one scenario:
 *  - its own solution must be playable step by step and score 100% without failing
 *  - doing nothing until time runs out must not pass
 */
export function checkPlayable(s: Scenario): CheckResult {
  const problems: string[] = [];
  let solutionScore: number | undefined;
  let idleScore: number | undefined;
  if (!s.solution.length) problems.push("no solution listed");
  else {
    try {
      const sim = runSteps(s, s.solution);
      if (!sim.ended) sim.finish();
      const d = sim.debrief();
      solutionScore = d.score;
      if (d.failed) problems.push(`the solution ends in failure: ${d.endText}`);
      const missed = d.objectives.filter((o) => !o.passed).map((o) => o.objective.text);
      if (missed.length) problems.push(`the solution misses: ${missed.join("; ")}`);
    } catch (err) {
      problems.push(`the solution cannot be played: ${(err as Error).message}`);
    }
  }
  const idle = new Sim(s);
  while (!idle.ended) idle.wait(60);
  const di = idle.debrief();
  idleScore = di.score;
  if (di.passed) problems.push(`doing nothing passes with ${di.score}%; make waiting cost something`);
  return { id: s.id, ok: problems.length === 0, problems, solutionScore, idleScore };
}

export function validate(files: string[]): number {
  const results: CheckResult[] = [];
  const scenarios: Scenario[] = [];
  if (files.length) {
    for (const f of files) {
      try {
        scenarios.push(loadScenario(readFileSync(f, "utf8"), basename(f)));
      } catch (err) {
        results.push({ id: basename(f), ok: false, problems: err instanceof ScenarioError ? err.problems : [(err as Error).message] });
      }
    }
  } else {
    for (const f of builtinScenarioFiles()) {
      try {
        scenarios.push(loadScenario(f.source, f.file));
      } catch (err) {
        results.push({ id: f.file, ok: false, problems: err instanceof ScenarioError ? err.problems : [(err as Error).message] });
      }
    }
    const ids = new Set<string>();
    for (const s of scenarios) {
      if (ids.has(s.id)) results.push({ id: s.id, ok: false, problems: ["two scenario files use this id"] });
      ids.add(s.id);
    }
  }
  for (const s of scenarios) results.push(checkPlayable(s));
  for (const r of results) {
    const scores = r.solutionScore !== undefined ? c.dim(` (solution ${r.solutionScore}%, doing nothing ${r.idleScore}%)`) : "";
    console.log(`${r.ok ? c.green("✔") : c.red("✘")} ${r.id}${scores}`);
    for (const p of r.problems) console.log(`    ${c.red("-")} ${p}`);
  }
  const bad = results.filter((r) => !r.ok).length;
  console.log(bad ? c.red(`\n${bad} of ${results.length} scenario(s) need work.`) : c.green(`\nAll ${results.length} scenario(s) are playable.`));
  return bad ? 1 : 0;
}
