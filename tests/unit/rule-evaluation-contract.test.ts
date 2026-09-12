import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defineRule } from "../../src/core/rule.ts";
import type { Snapshot } from "../../src/core/types.ts";
import { localUri } from "../../src/rules/artifact/local-uri.ts";
import { unbreakableBlockTooTall } from "../../src/rules/layout/unbreakable-block-too-tall.ts";
import { widow } from "../../src/rules/layout/widow.ts";
import { shortLastLine } from "../../src/rules/type/short-last-line.ts";
import { textOverflowsViewport } from "../../src/rules/svg/text-overflows-viewport.ts";
import { fingerprint } from "../../src/core/fingerprint.ts";
import { loadCorpus } from "../fixtures/corpus.ts";

const meta = {
  id: "type/evaluation-contract-test",
  severity: "warn" as const,
  proofSource: null,
  calibrated: false as const,
  experimental: false,
  unit: "test",
  defaultOptions: {},
  summary: "Test-only contract guard.",
  declines: ["env/multicolumn", "env/vertical-writing"] as const,
};

const context = {
  documentPath: "test.html",
  options: {},
  fingerprint: () => "test",
};

describe("target evaluation contract", () => {
  it("rejects a row attributed to a different rule", () => {
    const rule = defineRule(meta, () => ({
      findings: [],
      candidates: 1,
      measured: 1,
      notMeasured: [],
      evaluations: [{
        ruleId: "type/not-this-rule",
        semanticsVersion: "rule-decision-v1",
        targetRef: { keyType: "block", nodeKey: "n", sid: null, fragmentIndex: 0, boxScreen: null },
        status: "measured",
        reason: null,
        measurements: [],
        predicate: { connective: "single", violated: false },
      }],
    }));
    assert.throws(() => rule.run({} as Snapshot, context), /evaluation belongs to type\/not-this-rule/u);
  });

  it("rejects equal totals with the wrong per-reason decline distribution", () => {
    const rule = defineRule(meta, () => ({
      findings: [],
      candidates: 2,
      measured: 0,
      notMeasured: [
        { scope: "block", ruleId: meta.id, reason: "env/multicolumn", target: null, count: 1 },
        { scope: "block", ruleId: meta.id, reason: "env/vertical-writing", target: null, count: 1 },
      ],
      evaluations: [0, 1].map((index) => ({
        ruleId: meta.id,
        semanticsVersion: "rule-decision-v1" as const,
        targetRef: { keyType: "block" as const, nodeKey: `n${index}`, sid: null, fragmentIndex: 0, boxScreen: null },
        status: "not-measured" as const,
        reason: "env/multicolumn",
        measurements: [],
        predicate: { connective: "single" as const, violated: null },
      })),
    }));
    assert.throws(
      () => rule.run({} as Snapshot, context),
      /target decline evaluations do not reconcile to declared reasons\/counts/u,
    );
  });


  it("rejects a released rule that omits target evaluations", () => {
    const rule = defineRule({ ...meta, id: "layout/widow" }, () => ({
      findings: [], candidates: 0, measured: 0, notMeasured: [],
    }));
    assert.throws(() => rule.run({} as Snapshot, context), /rule returned no target evaluations/u);
  });

  it("rejects duplicate concrete targets but permits actual iterator occurrences", () => {
    const row = {
      ruleId: meta.id, semanticsVersion: "rule-decision-v1" as const,
      targetRef: { keyType: "resource" as const, nodeKey: "same-dom-node", sid: null, fragmentIndex: 0, boxScreen: null },
      status: "measured" as const, reason: null, measurements: [],
      predicate: { connective: "single" as const, violated: false },
    };
    const duplicate = defineRule(meta, () => ({
      findings: [], candidates: 2, measured: 2, notMeasured: [], evaluations: [row, { ...row }],
    }));
    assert.throws(() => duplicate.run({} as Snapshot, context), /duplicate target evaluation/u);

    const occurrences = defineRule(meta, () => ({
      findings: [], candidates: 2, measured: 2, notMeasured: [], evaluations: [
        { ...row, occurrenceKey: "0" }, { ...row, occurrenceKey: "1" },
      ],
    }));
    assert.doesNotThrow(() => occurrences.run({} as Snapshot, context));
  });

  it("does not serialize invalid short-line geometry as a clean measurement", () => {
    const base = loadCorpus().find((item) => item.name === "short-last-line-trigger")!.snapshot;
    const invalid = [
      (snapshot: typeof base) => { snapshot.blocks[0]!.effectiveStyle.fontSize = 0; },
      (snapshot: typeof base) => { snapshot.blocks[0]!.effectiveStyle.fontSize = -1; },
      (snapshot: typeof base) => { snapshot.textLines.at(-1)!.width = Number.POSITIVE_INFINITY; },
    ];
    for (const corrupt of invalid) {
      const snapshot = structuredClone(base);
      corrupt(snapshot);
      const row = shortLastLine.run(snapshot, { ...context, options: shortLastLine.defaultOptions, fingerprint }).evaluations![0]!;
      assert.equal(row.status, "not-measured");
      assert.equal(row.reason, "env/invalid-measurement");
      assert.equal(JSON.parse(JSON.stringify(row)).predicate.violated, null);
    }
  });

  it("records visible applicability separately from hiding the retained block", () => {
    const visible = structuredClone(loadCorpus().find((item) => item.name === "too-tall-trigger")!.snapshot);
    visible.blocks[0]!.effectiveStyle.breakInside = "auto";
    const hidden = structuredClone(visible);
    hidden.blocks[0]!.effectiveStyle.visibility = "hidden";
    const visibleRow = unbreakableBlockTooTall.run(visible, { ...context, options: unbreakableBlockTooTall.defaultOptions, fingerprint }).evaluations![0]!;
    const hiddenRow = unbreakableBlockTooTall.run(hidden, { ...context, options: unbreakableBlockTooTall.defaultOptions, fingerprint }).evaluations![0]!;
    assert.deepEqual(visibleRow.measurements, [
      { name: "break-inside-avoid", value: false, unit: null, operator: "=", threshold: true },
      { name: "target-visible", value: true, unit: null, operator: "=", threshold: true },
    ]);
    assert.equal(hiddenRow.reason, "rule/target-not-visible");
    assert.equal(hiddenRow.measurements[1]!.value, false);
  });

  it("records the actual SVG overflow state in visible-viewport declines", () => {
    const snapshot = structuredClone(loadCorpus().find((item) => item.snapshot.svg.length > 0)!.snapshot);
    snapshot.svg[0]!.overflow = "visible";
    const row = textOverflowsViewport.run(snapshot, { ...context, options: textOverflowsViewport.defaultOptions, fingerprint })
      .evaluations!.find((item) => item.reason === "env/svg-overflow-visible")!;
    assert.deepEqual(row.measurements[0], {
      name: "svg-overflow-visible", value: true, unit: null, operator: "=", threshold: true,
    });
  });

  it("retains a hidden or removed SVG aggregate as an excluded unknown scope", () => {
    const snapshot = structuredClone(loadCorpus().find((item) => item.snapshot.svg.length > 0)!.snapshot);
    snapshot.svg[0]!.notRenderedTargets = 2;
    snapshot.svg[0]!.textTargetCount = Math.max(snapshot.svg[0]!.textTargetCount, snapshot.svg[0]!.texts.length + 2);
    const rows = textOverflowsViewport.run(snapshot, { ...context, options: textOverflowsViewport.defaultOptions, fingerprint }).evaluations!;
    const removed = rows.find((row) => row.reason === "rule/svg-target-not-rendered")!;
    assert.equal(removed.status, "excluded");
    assert.equal(removed.targetCount, 2);
    assert.equal(removed.targetRef.sid, null);
    assert.equal(removed.measurements.find((measurement) => measurement.name === "svg-text-rendered")!.value, false);
  });

  it("rejects a positive target-count aggregate even when totals reconcile", () => {
    const rule = defineRule(meta, () => ({
      findings: [], candidates: 2, measured: 2, notMeasured: [], evaluations: [{
        ruleId: meta.id, semanticsVersion: "rule-decision-v1" as const,
        targetRef: { keyType: "block" as const, nodeKey: "one", sid: "s-one", fragmentIndex: 0, boxScreen: null },
        targetCount: 2, status: "measured" as const, reason: null, measurements: [],
        predicate: { connective: "single" as const, violated: false },
      }],
    }));
    assert.throws(() => rule.run({} as Snapshot, context), /targetCount.*unknown aggregate/u);
  });

  it("records the zero-line widow applicability condition in the real rule decision", () => {
    const snapshot = structuredClone(loadCorpus().find((item) => item.name === "widow-trigger")!.snapshot);
    snapshot.textLines = snapshot.textLines.filter((line) => line.blockKey !== "w2");
    const result = widow.run(snapshot, { ...context, options: widow.defaultOptions, fingerprint });
    const row = result.evaluations!.find((item) => item.targetRef.nodeKey === "w2")!;
    assert.equal(row.status, "measured");
    assert.equal(row.predicate.connective, "all");
    assert.equal(row.predicate.violated, false);
    assert.deepEqual(row.measurements[0], {
      name: "widow-applicable-opening-lines", value: false, unit: null, operator: "=", threshold: true,
    });
  });

  it("records the actual cumulative local URI predicate instead of a per-URI proxy", () => {
    const snapshot = structuredClone(loadCorpus().find((item) => item.name === "local-uri-trigger")!.snapshot);
    snapshot.uriRefs.push({ ...snapshot.uriRefs[0]!, nodeKey: "img2" });
    const result = localUri.run(snapshot, { ...context, options: { maxOccurrences: 1 }, fingerprint });
    const second = result.evaluations![1]!;
    assert.equal(second.predicate.connective, "all");
    assert.equal(second.predicate.violated, true);
    assert.deepEqual(second.measurements[1], {
      name: "local-uri-occurrence-index", value: 2, unit: "occurrences", operator: ">", threshold: 1,
    });
  });

  it("retains a non-applicable target when break-inside changes on the real rule", () => {
    const snapshot = structuredClone(loadCorpus().find((item) => item.name === "too-tall-trigger")!.snapshot);
    snapshot.blocks[0]!.effectiveStyle.breakInside = "auto";
    const result = unbreakableBlockTooTall.run(snapshot, {
      ...context, options: unbreakableBlockTooTall.defaultOptions, fingerprint,
    });
    assert.equal(result.candidates, 0, "historic coverage accounting remains unchanged");
    const row = result.evaluations![0]!;
    assert.equal(row.status, "not-applicable");
    assert.equal(row.countsTowardCoverage, false);
    assert.equal(row.reason, "rule/break-inside-not-avoid");
    assert.deepEqual(row.measurements.map((measurement) => measurement.name), ["break-inside-avoid", "target-visible"]);
    assert.equal(row.measurements[0]!.value, false);
    assert.equal(row.measurements[1]!.value, true);
  });
});
