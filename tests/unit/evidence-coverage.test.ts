import assert from "node:assert/strict";
import { it } from "node:test";
import { runDocument } from "../../src/core/engine.ts";
import { loadCorpus } from "../fixtures/corpus.ts";
import { spacedHyphen } from "../../src/rules/type/spaced-hyphen.ts";

const snapshot = loadCorpus().find(entry => entry.name === "spaced-hyphen-trigger")!.snapshot;
const config = { failOn: "never" as const, activeRules: [spacedHyphen], optionsByRule: {}, coverageFloors: {} };

it("a raster-diff with otherwise sufficient rule coverage cannot report clean when evidence is required", () => {
  const result = runDocument({ path: "doc.html", snapshot,
    evidenceRequirement: { required: true, expectedPages: snapshot.pages.length },
    infrastructure: [{ kind: "mark-raster-diff", detail: "independent comparison found changed pixels", measured: { pixels: 73 } }],
    evidence: [],
  }, config);
  assert.ok(result.report.coverage[spacedHyphen.id]!.ok);
  assert.equal(result.report.verdict, "insufficient-coverage");
  assert.equal(result.report.exitReason, "evidence/required-page-binding-incomplete");
  assert.equal(result.report.evidenceCoverage?.status, "unavailable");
});

it("explicitly disabling binding stays visible and does not pretend evidence was checked", () => {
  const result = runDocument({ path: "doc.html", snapshot, infrastructure: [],
    evidenceRequirement: { required: false, expectedPages: snapshot.pages.length }, evidence: [],
  }, config);
  assert.equal(result.report.verdict, "clean");
  assert.equal(result.report.evidenceCoverage?.status, "not-requested");
  assert.equal(result.report.evidenceCoverage?.boundPages, 0);
});

it("all actual page bindings satisfy the requirement without removing existing findings", () => {
  const result = runDocument({ path: "doc.html", snapshot, infrastructure: [],
    evidenceRequirement: { required: true, expectedPages: snapshot.pages.length },
    evidence: snapshot.pages.map((_, i) => ({ key: `doc#${i + 1}`, page: i + 1, path: `page-${i + 1}.png`,
      origin: "pdf-raster", pdfConformance: "verified", conformance: null, bindsFinding: true,
      overlayCheck: { styleViolations: 0, rasterDiffPx: 0, removed: false } })),
  }, config);
  assert.equal(result.report.verdict, "clean");
  assert.equal(result.report.evidenceCoverage?.status, "complete");
  assert.ok(result.report.findings.length > 0);
});
