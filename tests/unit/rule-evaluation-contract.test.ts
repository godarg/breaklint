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

  /**
   * The height of a split block is the height of what it was split into — from the third fragment.
   *
   * Until 0.6.0 this rule read the first fragment and skipped the rest, and a six-page
   * `break-inside: avoid` section therefore came back clean: fragment 0 measured 596.36 px against
   * a 680.31 px page. The first case below is the same shape with round numbers, so the expected
   * value is arithmetic a reader can check rather than a recorded output — 320 + 300 + 260 = 880
   * against a 606 px content box.
   *
   * The other four cases are each a way the sum can lie, and each was named by an independent
   * review before this shipped:
   *   - two fragments whose heights sum above the page: NOT reported, because Paged.js repeats a
   *     block's border (and `!important` padding) at every split edge, so a block that fitted
   *     unsplit can sum above the page. From three fragments on that cannot happen — an
   *     intermediate fragment fills a whole content box and carries content before and after it.
   *   - boxes that start outside the content box: not part of the flow. `position: running(...)`
   *     is cloned into the margin box of every page and the clone keeps the source id.
   *   - a second page geometry: the boundary is the page the block was laid out on, not the
   *     largest page in the document. Taking the largest hides a real oversized block in any
   *     document that also has a landscape page.
   *   - one fragment: exactly the 0.5.0 behaviour, unchanged.
   */
  it("measures a split block over its fragments and refuses the three ways that sum can lie", () => {
    const run = (snapshot: Snapshot) =>
      unbreakableBlockTooTall.run(snapshot, { ...context, options: unbreakableBlockTooTall.defaultOptions, fingerprint });
    const fragmented = (boxes: readonly ({ height: number; y?: number })[]): Snapshot => {
      const snapshot = structuredClone(loadCorpus().find((item) => item.name === "too-tall-trigger")!.snapshot);
      const template = snapshot.blocks[0]!;
      snapshot.blocks = boxes.map((shape, index) => {
        const fragment = structuredClone(template);
        fragment.nodeKey = `t1:${index}`;
        fragment.fragmentIndex = index;
        fragment.fragmentCount = boxes.length;
        fragment.box = { ...template.box, height: shape.height, ...(shape.y === undefined ? {} : { y: shape.y }) };
        return fragment;
      });
      return snapshot;
    };
    const heights = (...values: readonly number[]) => values.map((height) => ({ height }));

    const tall = run(fragmented(heights(320, 300, 260)));
    assert.equal(tall.findings.length, 1, "a block split across three pages produced no finding");
    assert.equal(tall.findings[0]!.measurement.value, 880);
    assert.equal(tall.findings[0]!.measurement.threshold, 606);
    assert.match(tall.findings[0]!.message, /880\.00 px tall across the 3 fragments/u);
    assert.match(tall.findings[0]!.message, /content box of page 1 is 606\.00 px/u);
    const tallRows = tall.evaluations!.filter((row) => row.status === "measured");
    assert.equal(tallRows.length, 1, "one candidate per block, judged at its first fragment");
    assert.equal(tallRows[0]!.measurements[0]!.value, 880);
    assert.equal(tall.candidates, 1);
    assert.equal(tall.measured, 1);

    // Two fragments summing to 750 px on a 606 px page: not reported. Repeated border/padding at
    // the split edge can carry a block that fitted unsplit over the line, and two fragments alone
    // do not prove otherwise. The value recorded is the first fragment's, as in 0.5.0.
    const twoFragments = run(fragmented(heights(400, 350)));
    assert.deepEqual(twoFragments.findings, [], "two fragments are not proof: repeated decoration can inflate their sum");
    assert.equal(twoFragments.evaluations!.find((row) => row.status === "measured")!.measurements[0]!.value, 400);

    const short = run(fragmented(heights(200, 160)));
    assert.deepEqual(short.findings, [], "a block shorter than the page must stay silent when it is split");
    assert.equal(short.evaluations!.find((row) => row.status === "measured")!.measurements[0]!.value, 200);

    const whole = run(fragmented(heights(848)));
    assert.equal(whole.findings.length, 1);
    assert.equal(whole.findings[0]!.measurement.value, 848);
    assert.doesNotMatch(whole.findings[0]!.message, /fragments/u, "an unsplit block must not mention fragments");

    // A box that starts OUTSIDE the page content box is not a fragment of the flow. Paged.js
    // implements `position: running(...)` by cloning the element into the margin box of every
    // page, and the clone keeps the injected source id — measured on 2026-09-18, an ordinary
    // twelve-page document with a three-line running header reported this `error` rule at
    // 979.08 px against a 619.83 px page, for a header 81.59 px tall. The content box of this
    // fixture starts at y = 48; a margin box sits above it.
    const runningHeader = run(fragmented([
      { height: 90, y: 8 }, { height: 90, y: 8 }, { height: 90, y: 8 },
      { height: 90, y: 8 }, { height: 90, y: 8 }, { height: 90, y: 8 },
      { height: 90, y: 8 }, { height: 90, y: 8 },
    ]));
    assert.deepEqual(
      runningHeader.findings,
      [],
      "per-page clones of a running element were summed as if they were fragments of one flow",
    );
    assert.equal(runningHeader.evaluations!.find((row) => row.status === "measured")!.measurements[0]!.value, 90);

    // "It cannot fit on any page" is measured against any page. A document with a named landscape
    // page has two content boxes; a 700 px block on the 606 px page fits on the 900 px one, and
    // the rule may not print an all-pages claim from the page the first fragment happened to be on.
    const twoGeometries = fragmented(heights(700));
    const secondPage = structuredClone(twoGeometries.pages[0]!);
    secondPage.pageNumber = 2;
    secondPage.nodeKey = "pg2";
    secondPage.firstSemanticBlockKey = "sig:page2";
    secondPage.contentBox = { ...secondPage.contentBox, height: 900 };
    twoGeometries.pages = [twoGeometries.pages[0]!, secondPage];
    const acrossGeometries = run(twoGeometries);
    assert.equal(
      acrossGeometries.findings.length,
      1,
      "a 700 px block on a 606 px page stayed silent because a taller page existed elsewhere",
    );
    assert.equal(acrossGeometries.evaluations!.find((row) => row.status === "measured")!.measurements[0]!.threshold, 606);
    assert.match(acrossGeometries.findings[0]!.message, /content box of page 1 is 606\.00 px/u);
    assert.doesNotMatch(acrossGeometries.findings[0]!.message, /any page/u, "the rule may not make an all-pages claim from one page");
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
