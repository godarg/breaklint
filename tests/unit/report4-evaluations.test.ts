import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildReport } from "../../src/core/build-report.ts";
import { runDocument } from "../../src/core/engine.ts";
import { resolveConfig, toReportConfig } from "../../src/config/resolve.ts";
import { shortLastLine } from "../../src/rules/type/short-last-line.ts";
import { loadCorpus } from "../fixtures/corpus.ts";

const resolved = resolveConfig({ file: undefined, cli: {} });

function run(snapshot: ReturnType<typeof loadCorpus>[number]["snapshot"]) {
  const outcome = runDocument(
    { path: "chapter.html", snapshot, infrastructure: [] },
    {
      failOn: resolved.failOn,
      activeRules: [shortLastLine],
      optionsByRule: { [shortLastLine.id]: shortLastLine.defaultOptions },
      coverageFloors: { [shortLastLine.id]: resolved.coverageFloorsByRule[shortLastLine.id]! },
    },
  );
  return buildReport({
    outcomes: [outcome], mode: "demo", source: "handwritten snapshot fixture", toolVersion: "test", commit: null,
    startedAt: "2026-09-12T00:00:00.000Z", durationMs: 0, rulesRun: 1,
    environment: {
      browserVersion: "test", platform: "test", rendererPath: null, rendererPresent: false,
      pagedjsVersion: "0.4.3", rasterizer: null, rasterizerVersion: null,
      textPositionExtractor: null, fontFamiliesResolved: [], locale: "en",
    },
    config: toReportConfig(resolved, { interventions: [], networkBlocked: 0 }), failOn: resolved.failOn,
  });
}

describe("Report4 target evaluations", () => {
  it("retains actual clean and declined targets even when neither produces a finding", () => {
    const clean = structuredClone(loadCorpus().find((item) => item.name === "short-last-line-clean-sixty-percent")!.snapshot);
    const declined = structuredClone(clean);
    declined.blocks[0]!.effectiveStyle.columns = "2";

    const cleanReport = run(clean);
    const declinedReport = run(declined);
    const cleanRow = cleanReport.evaluations.find((row) => row.ruleId === shortLastLine.id)!;
    const declinedRow = declinedReport.evaluations.find((row) => row.ruleId === shortLastLine.id)!;

    assert.equal(cleanReport.findings.length, 0);
    assert.equal(declinedReport.findings.length, 0);
    assert.equal(cleanRow.status, "measured");
    assert.equal(cleanRow.predicate.violated, false);
    assert.equal(declinedRow.status, "not-measured");
    assert.equal(declinedRow.reason, "env/multicolumn");
    assert.notDeepEqual(cleanRow, declinedRow, "empty findings must not erase unlike target decisions");
  });

  it("uses the complete AND predicate for each short-last-line threshold combination", () => {
    const base = structuredClone(loadCorpus().find((item) => item.name === "short-last-line-trigger")!.snapshot);
    const block = base.blocks[0]!;
    const last = base.textLines.at(-1)!;
    const cases = [
      { width: 6, fontSize: 11, expected: true },   // ratio and em both below
      { width: 70, fontSize: 100, expected: false }, // ratio above, em below
      { width: 6, fontSize: 2, expected: false },   // ratio below, em above
      { width: 70, fontSize: 2, expected: false },  // both above
    ];
    for (const item of cases) {
      const snapshot = structuredClone(base);
      snapshot.blocks[0]!.effectiveStyle.fontSize = item.fontSize;
      snapshot.textLines.at(-1)!.width = item.width;
      const report = run(snapshot);
      const evaluation = report.evaluations.find((row) => row.ruleId === shortLastLine.id)!;
      assert.equal(evaluation.predicate.connective, "all");
      assert.equal(evaluation.predicate.violated, item.expected, `width=${item.width}, fontSize=${item.fontSize}`);
      const [ratio, ems] = evaluation.measurements;
      assert.equal(typeof ratio!.value, "number");
      assert.equal(typeof ratio!.threshold, "number");
      assert.equal(typeof ems!.value, "number");
      assert.equal(typeof ems!.threshold, "number");
      assert.equal((ratio!.value as number) < (ratio!.threshold as number), item.width < 59.85, "ratio operand must be observed");
      assert.equal((ems!.value as number) < (ems!.threshold as number), item.width / item.fontSize < 2, "em operand must be observed");
    }
    assert.equal(block.nodeKey, "p1");
    assert.equal(last.index, 1);
  });

 it("keeps unknown source explicit in the canonical consumer report", () => {
    const report = run(structuredClone(loadCorpus().find((item) => item.name === "short-last-line-trigger")!.snapshot));
    const finding = report.findings.find((item) => item.ruleId === shortLastLine.id)!;
    assert.equal(report.schemaVersion, 4);
    assert.equal(report.profileKind, "document");
    assert.equal(finding.originalSource.status, "unavailable");
    assert.equal(finding.actionability, "unknown-source");
    assert.ok(report.evaluations.some((item) => item.targetRef.nodeKey === finding.target.nodeKey));
  });

  it("keeps the inspected input location while resolving only exact producer originals", () => {
    const source = structuredClone(loadCorpus().find((item) => item.name === "short-last-line-trigger")!.snapshot);
    const sid = source.blocks[0]!.sid!;
    const inputLocation = { file: "produced.html", line: 4, column: 3, offset: 42, endLine: 4, endColumn: 18, endOffset: 57, coordinateSystem: "utf8-bytes-unicode-codepoints-v1" as const };
    const originalLocation = { file: "author/chapter.md", line: 9, column: 1, offset: 120, endLine: 9, endColumn: 16, endOffset: 135, coordinateSystem: "utf8-bytes-unicode-codepoints-v1" as const };
    source.source.map[sid] = inputLocation;
    source.source.originalMap = { [sid]: originalLocation };
    source.source.files = [{ file: "author/chapter.md", sha256: "a".repeat(64), byteLength: 135, role: "authoring" }];
    source.source.provenance = {
      binding: "producer-bound", copyIntegrity: "verified", sourceRole: "exact-original-range",
      producerId: "test-producer", receiptHash: "e".repeat(64), codeSha256: "b".repeat(64),
      optionsSha256: "c".repeat(64), diagnostics: [],
    };
    source.source.input = {
      identityStatus: "verified", rawBytesSha256: "d".repeat(64), byteLength: 57,
      encoding: "utf-8", complete: true,
    };

    const original = run(source).findings.find((item) => item.ruleId === shortLastLine.id)!;
    assert.deepEqual(original.source, inputLocation, "legacy source remains the inspected input artefact");
    assert.equal(original.originalSource.status, "verified");
    assert.deepEqual(original.originalSource.location, originalLocation);
    assert.deepEqual(original.originalSource.integrity, {
      sha256: "a".repeat(64), byteLength: 135, role: "authoring",
    });
    assert.deepEqual(run(source).documents[0]!.sourceBinding, {
      input: source.source.input,
      provenance: source.source.provenance,
      files: source.source.files,
    }, "the canonical report carries the bound input, producer metadata, and no source bytes");

    const generated = structuredClone(source);
    generated.source.originalMap = {};
    const noOriginal = run(generated).findings.find((item) => item.ruleId === shortLastLine.id)!;
    assert.deepEqual(noOriginal.source, inputLocation, "removing an original leaf cannot erase the input location");
    assert.equal(noOriginal.originalSource.status, "unavailable");
    assert.equal(noOriginal.originalSource.location, null);
    assert.equal(noOriginal.originalSource.role, "unknown");
    assert.equal(noOriginal.originalSource.integrity, null);
    assert.equal(noOriginal.actionability, "recheck-required");

    const dependency = structuredClone(source);
    dependency.source.files = [{ file: "author/chapter.md", sha256: "a".repeat(64), byteLength: 135, role: "dependency" }];
    const nonAuthoring = run(dependency).findings.find((item) => item.ruleId === shortLastLine.id)!;
    assert.equal(nonAuthoring.originalSource.status, "unavailable");
    assert.equal(nonAuthoring.originalSource.location, null);
    assert.equal(nonAuthoring.originalSource.integrity, null);
    assert.equal(nonAuthoring.actionability, "recheck-required");
  });
});
