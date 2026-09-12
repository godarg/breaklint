/**
 * Which declines count against coverage, and which do not.
 *
 * The defect this file exists for: in 0.2.2 a document holding one harmless inline SVG could not
 * be checked at all. `svg/text-overflows-viewport` declined with a reason it had not declared and
 * the run ended `checker-crashed`; remove that and the two ink rules declined every target, drove
 * their coverage to 0 and the run ended `insufficient-coverage`. Both answers are about the tool,
 * and both were delivered as answers about the document.
 *
 * The repair moves two decline classes out of the coverage base. That is a dangerous direction —
 * "we stop counting what we cannot do" is how a checker goes quietly green — so the tests here
 * are written in pairs. Each one that shows a decline LEAVING the base is followed by one showing
 * a decline that must STAY in it, on the same machinery. If the exception is ever widened to
 * cover the second kind, the second test of the pair goes red.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { runDocument } from "../../src/core/engine.ts";
import { defineRule } from "../../src/core/rule.ts";
import { NON_APPLICABLE_ENV_IDS, TOOL_CAPABILITY_ENV_IDS } from "../../src/core/enums.ts";
import type { EnvId } from "../../src/core/enums.ts";
import type { Snapshot } from "../../src/core/types.ts";
import { declined, targetEvaluation } from "../../src/rules/shared.ts";
import { textClipped } from "../../src/rules/svg/text-clipped.ts";
import { textInkCollision } from "../../src/rules/svg/text-ink-collision.ts";
import { textOverflowsViewport } from "../../src/rules/svg/text-overflows-viewport.ts";
import { loadCorpus } from "../fixtures/corpus.ts";

/**
 * A rule that declines everything for one stated reason. It measures nothing on purpose: the
 * question here is what a decline does to the ratio, not what any real rule finds.
 */
function decliningRule(id: string, reason: EnvId, severity: "error" | "warn", count = 4) {
  return defineRule(
    {
      id,
      severity,
      proofSource: severity === "error" ? "A" : null,
      calibrated: false,
      experimental: false,
      unit: "px",
      defaultOptions: {},
      summary: `test double declining with ${reason}`,
      declines: [reason],
    },
    () => ({
      findings: [],
      candidates: count,
      measured: 0,
      notMeasured: [declined({ scope: "svg", ruleId: id, reason, count })],
      evaluations: Array.from({ length: count }, (_, index) => targetEvaluation({
        ruleId: id, keyType: "svg-text", nodeKey: `test-decline-${index}`, sid: null,
        status: "not-measured", reason,
      })),
    }),
  );
}

/**
 * A rule that measures one candidate and finds nothing.
 *
 * It runs alongside every case below, and it is not decoration. `documentVerdict` answers
 * `insufficient-coverage` when NO rule measured a single candidate — a separate and correct
 * guard, and one that would answer for every test here if the declining double ran alone. With
 * this rule present, the verdict reflects the coverage ratios and nothing else, which is what
 * these cases are about.
 */
const measuresOne = defineRule(
  {
    id: "layout/measures-one", severity: "warn", proofSource: null, calibrated: false,
    experimental: false, unit: "px", defaultOptions: {}, summary: "measures one candidate", declines: [],
  },
  () => ({ findings: [], candidates: 1, measured: 1, notMeasured: [], evaluations: [
    targetEvaluation({ ruleId: "layout/measures-one", keyType: "block", nodeKey: "test-measured", sid: null, status: "measured" }),
  ] }),
);

function reportFor(rule: ReturnType<typeof defineRule>, snapshot: Snapshot) {
  return runDocument(
    { path: "coverage-base.html", snapshot, infrastructure: [] },
    { failOn: "error", activeRules: [rule, measuresOne], optionsByRule: {}, coverageFloors: {} },
  ).report;
}

describe("the coverage base", () => {
  // The rules below are test doubles that ignore the snapshot entirely: what is under test is
  // what the ENGINE does with a decline, not what any rule reads. Borrowing a corpus snapshot
  // keeps the fixture honest — it is a real snapshot shape, not a hand-shaped stub.
  const corpus = loadCorpus();
  const snapshot = corpus[0]!.snapshot;
  const svgSnapshot = corpus.find((document) => document.snapshot.svg.length > 0)?.snapshot;
  assert.ok(svgSnapshot, "the corpus has no SVG record for real-rule coverage tests");

  it("keeps both exception lists small and disjoint", () => {
    // The lists are the whole of the exception. If a future reason joins one of them, it has to
    // be argued into it here as well, which is the point of asserting on their exact contents
    // rather than on their length.
    assert.deepEqual([...TOOL_CAPABILITY_ENV_IDS], ["env/pixel-oracle-unavailable"]);
    assert.deepEqual([...NON_APPLICABLE_ENV_IDS], ["env/svg-overflow-visible"]);
    const overlap = TOOL_CAPABILITY_ENV_IDS.filter((id) => (NON_APPLICABLE_ENV_IDS as readonly string[]).includes(id));
    assert.deepEqual(overlap, [], "a reason in both lists would make the distinction unreadable");
  });

  it("every SVG rule declares the viewport reason admitted by the receipt schema", () => {
    const projected = structuredClone(svgSnapshot);
    const svg = structuredClone(projected.svg[0]!);
    svg.measurable = false;
    svg.reason = "env/svg-viewport-geometry-unsupported";
    svg.inkCollected = true;
    svg.inkStable = true;
    projected.svg = [svg];
    const report = runDocument(
      { path: "receipt-projection.html", snapshot: projected, infrastructure: [] },
      {
        failOn: "error",
        activeRules: [textClipped, textInkCollision, textOverflowsViewport],
        optionsByRule: {},
        coverageFloors: {},
      },
    ).report;
    assert.deepEqual(report.infrastructure, [], "a schema-valid record-level decline crashed a real SVG rule");
    assert.equal(report.verdict, "insufficient-coverage");
  });

  for (const kind of ["paint-target", "whole-viewport"] as const) {
    it(`overflow visible stays non-applicable before ${kind} geometry declines`, () => {
      const projected = structuredClone(svgSnapshot);
      const svg = structuredClone(projected.svg[0]!);
      svg.overflow = "visible";
      svg.texts = [];
      svg.textTargetCount = 1;
      svg.notRenderedTargets = 0;
      svg.unreadableTargets = 0;
      svg.unsupportedTargets = kind === "paint-target" ? 1 : 0;
      svg.measurable = kind === "paint-target";
      svg.reason = kind === "whole-viewport" ? "env/svg-viewport-geometry-unsupported" : null;
      projected.svg = [svg];
      const report = runDocument(
        { path: `overflow-visible-${kind}.html`, snapshot: projected, infrastructure: [] },
        {
          failOn: "error",
          activeRules: [textOverflowsViewport, measuresOne],
          optionsByRule: {},
          coverageFloors: {},
        },
      ).report;
      assert.equal(report.coverage["svg/text-overflows-viewport"]?.candidates, 0);
      assert.equal(report.coverage["svg/text-overflows-viewport"]?.ok, true);
      assert.deepEqual(
        report.notMeasured.filter((entry) => entry.ruleId === "svg/text-overflows-viewport")
          .map((entry) => ({ reason: entry.reason, count: entry.count })),
        [{ reason: "env/svg-overflow-visible", count: 1 }],
      );
      assert.equal(report.verdict, "clean");
    });
  }

  for (const reason of [
    "env/svg-painted-bounds-unsupported",
    "env/svg-viewport-geometry-unsupported",
  ] as const) {
    it(`${reason} remains an input coverage failure`, () => {
      const report = reportFor(decliningRule(`svg/${reason}`, reason, "error"), snapshot);
      const coverage = report.coverage[`svg/${reason}`];
      assert.equal(coverage?.candidates, 4);
      assert.equal(coverage?.measured, 0);
      assert.equal(coverage?.coverage, 0);
      assert.equal(coverage?.ok, false);
      assert.equal(report.verdict, "insufficient-coverage");
    });
  }

  it("a capability this build lacks leaves the base rather than failing the document", () => {
    const report = reportFor(decliningRule("svg/capability", "env/pixel-oracle-unavailable", "warn"), snapshot);
    const coverage = report.coverage["svg/capability"];
    assert.equal(coverage?.candidates, 0, "the targets are not candidates for a measurement that does not exist");
    assert.equal(coverage?.coverage, null);
    assert.equal(coverage?.ok, true);
    assert.equal(report.verdict, "clean");
  });

  it("but still says so: the decline keeps its rule, reason and count in the report", () => {
    // Leaving the coverage base must not mean leaving the report. This is the difference between
    // the repair and simply hiding what the tool cannot do.
    const report = reportFor(decliningRule("svg/capability", "env/pixel-oracle-unavailable", "warn"), snapshot);
    assert.deepEqual(
      report.notMeasured.map((n) => ({ ruleId: n.ruleId, reason: n.reason, count: n.count })),
      [{ ruleId: "svg/capability", reason: "env/pixel-oracle-unavailable", count: 4 }],
    );
  });

  it("a question that does not arise leaves the base too", () => {
    const report = reportFor(decliningRule("svg/notapplicable", "env/svg-overflow-visible", "error"), snapshot);
    const coverage = report.coverage["svg/notapplicable"];
    assert.equal(coverage?.candidates, 0);
    assert.equal(coverage?.ok, true);
    assert.equal(report.verdict, "clean");
  });

  it("a document property the rule could not get past DOES fail the document", () => {
    // The negative control, and the reason exit 4 was built. `env/multicolumn` is a fact about
    // the input: another document would have been measured. Widening the exception to cover this
    // reason turns a blind run green again, and turns this test red first.
    const report = reportFor(decliningRule("layout/document-property", "env/multicolumn", "warn"), snapshot);
    const coverage = report.coverage["layout/document-property"];
    assert.equal(coverage?.candidates, 4, "the targets remain candidates: the rule ought to have judged them");
    assert.equal(coverage?.coverage, 0);
    assert.equal(coverage?.ok, false);
    assert.equal(report.verdict, "insufficient-coverage");
    assert.equal(report.exitReason, "layout/document-property below its coverage floor");
  });

  it("an error rule that reaches only part of a document still fails it", () => {
    // The second half of the same control, at the boundary that matters: a floor of 1 with one
    // unreachable target out of four. Partial coverage is not the exception, it is what exit 4
    // is for.
    const partial = defineRule(
      {
        id: "svg/partial", severity: "error", proofSource: "A", calibrated: false, experimental: false,
        unit: "px", defaultOptions: {}, summary: "measures three of four",
        declines: ["env/svg-ctm-unavailable"],
      },
      () => ({
        findings: [],
        candidates: 4,
        measured: 3,
        notMeasured: [declined({ scope: "svg", ruleId: "svg/partial", reason: "env/svg-ctm-unavailable", count: 1 })],
        evaluations: [0, 1, 2].map((index) => targetEvaluation({ ruleId: "svg/partial", keyType: "svg-text", nodeKey: `partial-${index}`, sid: null, status: "measured" })).concat([
          targetEvaluation({ ruleId: "svg/partial", keyType: "svg-text", nodeKey: "partial-3", sid: null, status: "not-measured", reason: "env/svg-ctm-unavailable" }),
        ]),
      }),
    );
    const report = reportFor(partial, snapshot);
    assert.equal(report.coverage["svg/partial"]?.candidates, 4);
    assert.equal(report.coverage["svg/partial"]?.coverage, 0.75);
    assert.equal(report.coverage["svg/partial"]?.ok, false);
    assert.equal(report.verdict, "insufficient-coverage");
  });

  it("mixed declines subtract only the exempt ones", () => {
    const mixed = defineRule(
      {
        id: "svg/mixed", severity: "warn", proofSource: null, calibrated: false, experimental: false,
        unit: "px", defaultOptions: {}, summary: "declines for two different kinds of reason",
        declines: ["env/pixel-oracle-unavailable", "env/multicolumn"],
      },
      () => ({
        findings: [],
        candidates: 10,
        measured: 4,
        notMeasured: [
          declined({ scope: "svg", ruleId: "svg/mixed", reason: "env/pixel-oracle-unavailable", count: 4 }),
          declined({ scope: "block", ruleId: "svg/mixed", reason: "env/multicolumn", count: 2 }),
        ],
        evaluations: [0, 1, 2, 3].map((index) => targetEvaluation({ ruleId: "svg/mixed", keyType: "svg-text", nodeKey: `mixed-${index}`, sid: null, status: "measured" })).concat(
          [0, 1, 2, 3].map((index) => targetEvaluation({ ruleId: "svg/mixed", keyType: "svg-text", nodeKey: `mixed-capability-${index}`, sid: null, status: "not-measured", reason: "env/pixel-oracle-unavailable" })),
          [0, 1].map((index) => targetEvaluation({ ruleId: "svg/mixed", keyType: "block", nodeKey: `mixed-column-${index}`, sid: null, status: "not-measured", reason: "env/multicolumn" })),
        ),
      }),
    );
    const report = reportFor(mixed, snapshot);
    // Ten candidates minus the four exempt ones. Four of the remaining six were measured, and
    // the two that were not are a document property — they stay in the denominator, which is
    // what keeps 0.67 an honest number rather than a flattering 1.0.
    assert.equal(report.coverage["svg/mixed"]?.candidates, 6);
    assert.equal(report.coverage["svg/mixed"]?.coverage, 4 / 6);
    assert.equal(report.coverage["svg/mixed"]?.ok, true, "4/6 clears the warn floor of 0.5");
    assert.equal(report.verdict, "clean");
  });
});
