/**
 * The mutation guard.
 *
 * A test suite that passes tells you nothing until you know it can fail. This tool breaks each
 * rule on purpose, five ways, and requires that the assertion notices every time.
 *
 * What counts as noticing is the whole point, and it is narrower than it looks. An assertion on
 * the *threshold* is not enough: measured against five mutants, a threshold-only test kills
 * two. The three survivors are exactly the dangerous ones — a rule that emits nothing, a rule
 * with an inverted comparator, and a rule that attributes findings to the wrong id. So a mutant
 * counts as killed only when an assertion on the triple **(count, rule id, target)** fails.
 *
 * The mutation happens through a test-only wrapper that reconstructs the rule with different
 * options or a wrapped run function. There is no test hook in the production code: a hook is a
 * branch that only ever runs in tests, and a branch nobody exercises in anger is a branch
 * nobody has checked.
 */

import { runDocument } from "../../src/core/engine.ts";
import { ALL_RULES } from "../../src/rules/index.ts";
import type { Rule, RuleOptions } from "../../src/core/rule.ts";
import type { Finding, Snapshot } from "../../src/core/types.ts";
import { loadCorpus } from "../fixtures/corpus.ts";

export type MutantName =
  | "emits-nothing"
  | "comparator-inverted"
  | "threshold-shifted"
  | "threshold-multiplied"
  | "rule-id-swapped"
  | "isolation-pass-swapped";

/** The observable triple. Anything coarser lets the dangerous mutants through. */
export interface Observation {
  count: number;
  ruleIds: string[];
  targets: string[];
}

export function observe(findings: readonly Finding[]): Observation {
  return {
    count: findings.length,
    ruleIds: [...new Set(findings.map((f) => f.ruleId))].sort(),
    targets: findings.map((f) => `${f.target.keyType}:${f.fingerprint.slice(0, 12)}`).sort(),
  };
}

export function differs(a: Observation, b: Observation): boolean {
  return (
    a.count !== b.count ||
    a.ruleIds.join(",") !== b.ruleIds.join(",") ||
    a.targets.join(",") !== b.targets.join(",")
  );
}

/**
 * Builds the mutated copies of a rule. The original is never touched.
 *
 * A threshold mutation has to CROSS the boundary, not scale it. The first version multiplied
 * every numeric option — and against a threshold of `0` (occurrences permitted, overshoot
 * permitted) multiplication changes nothing at all. Ten of fifteen rules then "survived" a
 * mutant that had not mutated anything. That is the failure class of this whole project,
 * inverted: a test that cannot fail because the change under test was never made.
 *
 * So each threshold mutant is a SET of candidate perturbations, and the mutant counts as killed
 * when at least one of them changes the observation. A rule whose behaviour is unchanged by
 * moving its threshold in either direction is not using its threshold — and that survival is a
 * real finding, not an artefact of the harness.
 */
export function mutate(rule: Rule, mutant: MutantName, observedValues: readonly number[] = []): Rule[] {
  const numeric = Object.entries(rule.defaultOptions).filter(([, v]) => typeof v === "number") as [
    string,
    number,
  ][];

  switch (mutant) {
    case "emits-nothing":
      return [{ ...rule, run: (s, c) => ({ ...rule.run(s, c), findings: [] }) }];

    case "comparator-inverted":
      return perOption(rule, numeric, () => [-1e9, 1e9]);

    case "threshold-shifted":
      // Candidates include the values the rule actually measured on this fixture. A step of ±1
      // crosses nothing when the threshold is 0.05 and the measurement is 0.63; putting the
      // threshold ON the observed value flips a strict comparison for any rule, whichever
      // direction it runs.
      return perOption(rule, numeric, (v) => [
        v + 1,
        v - 1,
        ...observedValues.flatMap((o) => [o, o + Math.abs(o) * 0.001 + 1e-9, o - Math.abs(o) * 0.001 - 1e-9]),
      ]);

    case "threshold-multiplied":
      return perOption(rule, numeric, (v) => [v * 1000 + 1000, v / 1000 - 1000]);

    case "rule-id-swapped":
      return [
        {
          ...rule,
          run: (s, c) => {
            const r = rule.run(s, c);
            return { ...r, findings: r.findings.map((f) => ({ ...f, ruleId: `${f.ruleId}-swapped` })) };
          },
        },
      ];

    case "isolation-pass-swapped":
      // Only meaningful for the two ink rules: T against T0, S against F. This is the guard
      // against the `<defs>` mistake, which reported every clipped graphic as fully destroyed.
      return [{ ...rule, run: (s, c) => rule.run(swapInkPasses(s), c) }];
  }
}

/**
 * One option at a time.
 *
 * Perturbing every threshold together hides rules whose conditions are OR-ed: moving both sides
 * of `netFill < a || topGap > b` in the same direction leaves the page firing through the other
 * branch, and the mutant looks dead when nothing was tested. A real defect shifts one number.
 */
function perOption(
  rule: Rule,
  numeric: [string, number][],
  candidates: (value: number) => number[],
): Rule[] {
  const out: Rule[] = [];
  for (const [key, value] of numeric) {
    for (const candidate of candidates(value)) {
      out.push(withOptions(rule, { ...rule.defaultOptions, [key]: candidate }));
    }
  }
  return out;
}

function withOptions(rule: Rule, options: RuleOptions): Rule {
  return { ...rule, run: (s, c) => rule.run(s, { ...c, options }) };
}

function swapInkPasses(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot,
    svg: snapshot.svg.map((svg) => ({
      ...svg,
      inkPasses: { E: svg.inkPasses.E, S: svg.inkPasses.F, F: svg.inkPasses.S },
      texts: svg.texts.map((t) => ({ ...t, ink: { T: { ...t.ink.T0 }, T0: { ...t.ink.T } } })),
    })),
  };
}

/** The five that apply to every rule, plus the sixth for the two ink rules. */
export function mutantsFor(rule: Rule): MutantName[] {
  const base: MutantName[] = [
    "emits-nothing",
    "comparator-inverted",
    "threshold-shifted",
    "threshold-multiplied",
    "rule-id-swapped",
  ];
  if (rule.id === "svg/text-clipped" || rule.id === "svg/text-ink-collision") {
    base.push("isolation-pass-swapped");
  }
  return base;
}

export interface KillReport {
  ruleId: string;
  killed: MutantName[];
  survived: MutantName[];
  /** The fixture the rule actually fires on. A rule with none cannot be mutation-tested. */
  triggerFixture: string | null;
}

export function runMutationGuard(): KillReport[] {
  const corpus = loadCorpus();
  const reports: KillReport[] = [];

  for (const rule of ALL_RULES) {
    // A mutant can only be killed on a fixture where the rule fires. If no fixture triggers the
    // rule, the guard has nothing to say and reports that honestly instead of counting 5/5 on
    // an empty set — which is exactly how a mutation score gets inflated.
    const trigger = corpus.find((c) => {
      const out = runDocument(
        { path: c.name, snapshot: c.snapshot, infrastructure: [] },
        { failOn: "never", activeRules: [rule], optionsByRule: {}, loweredFloors: {} },
      );
      return out.report.findings.length > 0;
    });

    if (!trigger) {
      reports.push({ ruleId: rule.id, killed: [], survived: mutantsFor(rule), triggerFixture: null });
      continue;
    }

    const baseline = observe(
      runDocument(
        { path: trigger.name, snapshot: trigger.snapshot, infrastructure: [] },
        { failOn: "never", activeRules: [rule], optionsByRule: {}, loweredFloors: {} },
      ).report.findings,
    );

    const observedValues = runDocument(
      { path: trigger.name, snapshot: trigger.snapshot, infrastructure: [] },
      { failOn: "never", activeRules: [rule], optionsByRule: {}, loweredFloors: {} },
    ).report.findings.map((f) => f.measurement.value);

    const killed: MutantName[] = [];
    const survived: MutantName[] = [];
    for (const mutant of mutantsFor(rule)) {
      const variants = mutate(rule, mutant, observedValues);
      const anyDiffers = variants.some((mutated) => {
        try {
          const observation = observe(
            runDocument(
              { path: trigger.name, snapshot: trigger.snapshot, infrastructure: [] },
              { failOn: "never", activeRules: [mutated], optionsByRule: {}, loweredFloors: {} },
            ).report.findings,
          );
          return differs(baseline, observation);
        } catch {
          // A mutant that makes the rule throw is a detected change: the engine turns it into
          // an infrastructure event, and the document is no longer clean.
          return true;
        }
      });
      if (anyDiffers) killed.push(mutant);
      else survived.push(mutant);
    }
    reports.push({ ruleId: rule.id, killed, survived, triggerFixture: trigger.name });
  }
  return reports;
}

const invokedDirectly = process.argv[1]?.endsWith("mutants.ts");
if (invokedDirectly) {
  const reports = runMutationGuard();
  let failed = false;
  for (const r of reports) {
    const total = r.killed.length + r.survived.length;
    const line = `${r.ruleId.padEnd(38)} ${r.killed.length}/${total}`;
    if (r.triggerFixture === null) {
      failed = true;
      console.log(`${line}  NO TRIGGER FIXTURE — the guard cannot say anything about this rule`);
    } else if (r.survived.length > 0) {
      failed = true;
      console.log(`${line}  SURVIVED: ${r.survived.join(", ")}   (fixture ${r.triggerFixture})`);
    } else {
      console.log(`${line}  (fixture ${r.triggerFixture})`);
    }
  }
  console.log(
    `\n${reports.filter((r) => r.survived.length === 0 && r.triggerFixture).length}/${reports.length} rules ` +
      `killed every mutant on a fixture that actually triggers them.`,
  );
  process.exit(failed ? 1 : 0);
}
