export * from "./types.js";
export * from "./expr.js";
export * from "./load.js";
export * from "./engine.js";
export * from "./report.js";

import { SCENARIO_FILES } from "./generated/scenarios.js";
import { loadScenario } from "./load.js";
import type { Scenario } from "./types.js";

let cached: Scenario[] | undefined;

/** The raw scenario files that ship with TTXSim. */
export function builtinScenarioFiles(): { file: string; source: string }[] {
  return SCENARIO_FILES;
}

/** The scenarios that ship with TTXSim, in learning order (file name order). */
export function builtinScenarios(): Scenario[] {
  if (!cached) cached = SCENARIO_FILES.map((f) => loadScenario(f.source, f.file));
  return cached;
}
