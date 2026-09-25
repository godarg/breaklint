/**
 * Each protection of the painted-ink bracket, removed one at a time, turns a case.
 *
 * A case that passes says nothing until it is seen to fail when the property it pins is gone. The
 * generic mutation guard (tests/tools/mutants.ts) moves thresholds and swaps ids; it cannot reach
 * these, because they are not options: they are the choice of bound itself. So this test copies
 * `src/` and the scenario fixtures into `.tmp/`, applies ONE textual mutation to the copy — the
 * original text must occur exactly once, or the mutation has silently stopped applying — imports
 * the copy, and runs the same case as tests/unit/svg-ink.test.ts. The production code carries no
 * hook for any of this.
 */

import { strict as assert } from "node:assert";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runScenario, type ScenarioName, type ScenarioOutcome } from "../fixtures/svg-ink-scenarios.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const WORK = join(REPO, ".tmp", `svg-ink-mutants-${process.pid}`);
const RULE = "src/rules/svg/text-overflows-viewport.ts";
const INK = "src/measure/svg-ink.ts";

interface Mutant {
  id: string;
  what: string;
  file: string;
  from: string;
  to: string;
  scenario: ScenarioName;
  /** What the case must show on the real build and what it shows on the mutant, as one comparable fact. */
  fact: (outcome: ScenarioOutcome) => unknown;
}

const verdict = (outcome: ScenarioOutcome) => ({ exit: outcome.exit, findings: outcome.findings.length, declines: outcome.declines, crashed: outcome.crashed });

const MUTANTS: Mutant[] = [
  {
    id: "report-on-upper-bound",
    what: "the finding is decided on the box around all possible ink instead of the ink proven there",
    file: RULE, from: "bracketVerdict(lower?.value ?? null, upper, permitted, epsilon)", to: "bracketVerdict(upper, upper, permitted, epsilon)",
    scenario: "band-round", fact: verdict,
  },
  {
    id: "miter-k-one",
    what: "a miter join padded like a round one (k = 1): cell + sw/2, the prototype's claim",
    file: INK, from: 'let k = element.strokeLinejoin === "miter" ? Math.max(1, limit) : 1;', to: "let k = 1;",
    scenario: "miter", fact: verdict,
  },
  {
    id: "band-not-declined",
    what: "the band is dropped from the per-target evaluations",
    file: RULE,
    from: '          evaluations.push(targetEvaluation({ ...base, status: "not-measured", reason: "env/svg-painted-bounds-inconclusive", violated: null }));\n',
    to: "",
    scenario: "band-round", fact: verdict,
  },
  {
    id: "lower-bound-is-cell",
    what: "the inner box is the typographic cell instead of the raster's ink",
    file: INK, from: "inkInnerLocal: classified.dashedStrokeOnly ? null : simple.innerLocal,", to: "inkInnerLocal: envelope(facts.bboxUser, facts.userToLocal),",
    scenario: "slack", fact: verdict,
  },
  {
    id: "descendants-ignored",
    what: "only the <text> element's own paint is read, as up to this build",
    file: INK, from: "for (const element of paint.elements) {", to: "for (const element of paint.elements.slice(0, 1)) {",
    scenario: "tspan-stroke", fact: verdict,
  },
  {
    id: "descendant-shadow-ignored",
    what: "the same mutant, seen through a tspan's text shadow",
    file: INK, from: "for (const element of paint.elements) {", to: "for (const element of paint.elements.slice(0, 1)) {",
    scenario: "tspan-shadow", fact: verdict,
  },
  {
    id: "stroke-stretch-ignored",
    what: "the stroke of a spacingAndGlyphs run padded as if it were not stretched",
    file: INK, from: "const s = paint.strokeScaleX;", to: "const s = 1;",
    scenario: "stretched-stroke", fact: verdict,
  },
  {
    id: "unmeasured-stretch-bounded",
    what: "a stretched stroke no raster measured bounded by the unstretched pad",
    file: INK, from: '  if (classified.stretched && classified.strokePad > 0) return "unsupported";\n', to: "",
    scenario: "stretched-tspan", fact: verdict,
  },
];

/** The real build's answer for each case, and what a correct build must answer. */
const EXPECTED: Record<string, unknown> = {
  "report-on-upper-bound": { exit: 4, findings: 0, declines: ["env/svg-painted-bounds-inconclusive:1"], crashed: false },
  "miter-k-one": { exit: 4, findings: 0, declines: ["env/svg-painted-bounds-inconclusive:1"], crashed: false },
  "band-not-declined": { exit: 4, findings: 0, declines: ["env/svg-painted-bounds-inconclusive:1"], crashed: false },
  "lower-bound-is-cell": { exit: 0, findings: 0, declines: [], crashed: false },
  "descendants-ignored": { exit: 4, findings: 0, declines: ["env/svg-painted-bounds-inconclusive:1"], crashed: false },
  "descendant-shadow-ignored": { exit: 4, findings: 0, declines: ["env/svg-painted-bounds-unsupported:1"], crashed: false },
  "stroke-stretch-ignored": { exit: 4, findings: 0, declines: ["env/svg-painted-bounds-inconclusive:1"], crashed: false },
  "unmeasured-stretch-bounded": { exit: 4, findings: 0, declines: ["env/svg-painted-bounds-unsupported:1"], crashed: false },
};

function mutatedCopy(mutant: Mutant): string {
  const root = join(WORK, mutant.id);
  rmSync(root, { recursive: true, force: true });
  cpSync(join(REPO, "src"), join(root, "src"), { recursive: true });
  for (const fixture of ["svg-raw.ts", "svg-ink-scenarios.ts"]) {
    mkdirSync(join(root, "tests", "fixtures"), { recursive: true });
    cpSync(join(REPO, "tests", "fixtures", fixture), join(root, "tests", "fixtures", fixture));
  }
  const target = join(root, mutant.file);
  const source = readFileSync(target, "utf8");
  assert.equal(source.split(mutant.from).length - 1, 1, `${mutant.id}: the text it mutates no longer occurs exactly once in ${mutant.file}`);
  writeFileSync(target, source.replace(mutant.from, mutant.to));
  mkdirSync(dirname(target), { recursive: true });
  return join(root, "tests", "fixtures", "svg-ink-scenarios.ts");
}

describe("the painted-ink bracket's protections, each removed", () => {
  after(() => rmSync(WORK, { recursive: true, force: true }));

  for (const mutant of MUTANTS) {
    it(`${mutant.id}: ${mutant.what}`, async () => {
      assert.deepEqual(mutant.fact(runScenario(mutant.scenario)), EXPECTED[mutant.id], `the real build no longer answers ${mutant.scenario} as expected`);
      const copy = await import(pathToFileURL(mutatedCopy(mutant)).href) as { runScenario: typeof runScenario };
      const mutated = mutant.fact(copy.runScenario(mutant.scenario));
      assert.notDeepEqual(mutated, EXPECTED[mutant.id], `${mutant.id} survived: ${mutant.scenario} still answers ${JSON.stringify(mutated)}`);
    });
  }
});
