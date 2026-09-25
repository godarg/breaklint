import { readFileSync } from "node:fs";

import { buildReport } from "../../src/core/build-report.ts";
import { runDocument } from "../../src/core/engine.ts";
import type { Report, Snapshot } from "../../src/core/types.ts";
import { resolveConfig, toReportConfig } from "../../src/config/resolve.ts";
import { ALL_RULES } from "../../src/rules/index.ts";

export type ReportSurfaceState = "clean" | "findings" | "infrastructure" | "insufficient-coverage";

const PACKAGE_VERSION = (JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string }).version;

function clone(report: Report): Report {
  return JSON.parse(JSON.stringify(report)) as Report;
}

function findingsBase(): Report {
  const parsed = JSON.parse(readFileSync(new URL("../../examples/demo-snapshot.json", import.meta.url), "utf8")) as {
    snapshot: Snapshot;
  };
  const resolved = resolveConfig({ file: undefined, cli: {} });
  const outcome = runDocument(
    { path: "examples/demo.html", snapshot: parsed.snapshot, infrastructure: [] },
    {
      failOn: "error",
      activeRules: [...ALL_RULES],
      optionsByRule: {},
      coverageFloors: resolved.coverageFloorsByRule,
    },
  );
  const report = buildReport({
    outcomes: [outcome],
    mode: "demo",
    source: "handwritten snapshot fixture",
    toolVersion: PACKAGE_VERSION,
    commit: "8e8491e",
    startedAt: "2026-08-22T12:00:00.000Z",
    durationMs: 184,
    rulesRun: ALL_RULES.length,
    // A real CLI run id has this shape (randomUUID). The canonical surfaces print it in the tool
    // line, the running head of every printed page after the first, and the end mark.
    runId: "3f6c1a2e-8b4d-4f7a-9c21-5e0b7d9a4c68",
    failOn: "error",
    environment: {
      browserVersion: "",
      platform: "test",
      rendererPath: null,
      rendererPresent: false,
      pagedjsVersion: "0.4.3",
      rasterizer: null,
      rasterizerVersion: null,
      textPositionExtractor: null,
      fontFamiliesResolved: [],
      locale: "en-US",
    },
    config: toReportConfig(resolved, { interventions: [], networkBlocked: 0 }),
  });
  if (report.findings[0]) {
    report.findings[0].evidence = {
      ref: "evidence/surface-demo-page-001.png",
      bindsFinding: true,
    };
  }
  if (report.findings[1]) {
    // Real-shaped: the name the evidence writer gives a page (`<run>-<document>-<source hash>-page-NNN.png`),
    // 52 characters without a slash, so on a phone it is one segment wider than its line.
    report.findings[1].evidence = {
      ref: "1f5788f1e439-0001-demo-472f73b732bb5453-page-002.png",
      bindsFinding: false,
    };
    report.findings[1].ambiguity = { groupSize: 2, resolvable: false };
  }
  if (report.findings[2]) {
    // A long basename behind a slash: wider than a phone line and than the A4 content box's
    // evidence line would be at half width, so the slash break alone cannot save it.
    report.findings[2].evidence = {
      ref: "evidence/2c9d41a07be3-0003-annual-report-typeset-final-revision-9f14e2c7a0b35d61-page-003.png",
      bindsFinding: true,
    };
  }
  return report;
}

export function findingsReportState(): Report {
  return findingsBase();
}

export function cleanReportState(): Report {
  const report = clone(findingsBase());
  report.mode = "live";
  report.source = "rendered";
  report.runVerdict = "clean";
  report.exitCode = 0;
  report.findings = [];
  report.documents = report.documents.map((document) => ({
    ...document,
    verdict: "clean",
    exitReason: null,
    findings: [],
    // A real live success state includes the non-fatal CDP second opinion. Keeping it in the
    // canonical clean surface makes the newly public reporter branch a rendered review artifact,
    // not merely a string assertion hidden behind the collector boundary.
    infrastructure: [
      {
        kind: "geometry-cross-check-passed",
        detail:
          "the in-page probe matched the browser's layout tree for 8 of 12 eligible CSS box(es); " +
          "0 SVG graphics descendant(s) and 0 inline block-container(s) used different box semantics.",
        measured: {
          checked: 8,
          required: 8,
          candidates: 12,
          eligible: 12,
          excludedSvgDescendants: 0,
          excludedInlineBlockContainers: 0,
          maxDeltaPx: 0,
          tolerancePx: 0.05,
        },
      },
    ],
  }));
  report.summary = {
    error: 0,
    warn: 0,
    info: 0,
    experimental: 0,
    suppressed: 0,
    ambiguousGroups: 0,
    gateTriggeredBy: null,
    gateCandidate: null,
  };
  return report;
}

export function infrastructureReportState(): Report {
  const report = clone(findingsBase());
  report.runVerdict = "infrastructure";
  report.exitCode = 3;
  report.summary.gateTriggeredBy = null;
  report.summary.gateCandidate = "error";
  const document = report.documents[0];
  if (!document) throw new Error("surface fixture requires one document");
  document.verdict = "infrastructure";
  document.exitReason = "checker-crashed";
  document.infrastructure.push({
    kind: "checker-crashed",
    detail: "The evidence rasterizer stopped before the final page could be verified.",
    measured: { stage: "evidence", pagesCompleted: 2 },
  });
  return report;
}

export function insufficientCoverageReportState(): Report {
  const report = clone(findingsBase());
  report.runVerdict = "insufficient-coverage";
  report.exitCode = 4;
  report.summary.gateTriggeredBy = null;
  report.summary.gateCandidate = "error";
  const document = report.documents[0];
  if (!document) throw new Error("surface fixture requires one document");
  document.verdict = "insufficient-coverage";
  document.exitReason = "coverage-below-floor";
  const [ruleId, coverage] = Object.entries(document.coverage)[0] ?? [];
  if (!ruleId || !coverage) throw new Error("surface fixture requires one coverage row");
  coverage.candidates = 2;
  coverage.measured = 1;
  coverage.notMeasuredCount = 1;
  coverage.coverage = 0.5;
  coverage.floor = 1;
  coverage.ok = false;
  return report;
}

/**
 * Technical probe, not a review cell. Complication: thirteen coverage rows fit on one A4 page, so no
 * canonical state ever has to repeat the table header on a continuation page — a table whose header
 * stopped repeating would pass every canonical cell. Sixty synthetic rows force the table across
 * pages. The rule ids are synthetic and never reach a rule registry; only the HTML projection reads
 * them.
 */
export function longCoverageReportState(): Report {
  const report = cleanReportState();
  const document = report.documents[0];
  if (!document) throw new Error("surface fixture requires one document");
  for (let index = 1; index <= 60; index += 1) {
    const candidates = (index % 7) + 1;
    document.coverage[`probe/long-table-rule-${String(index).padStart(2, "0")}`] = {
      candidates,
      measured: candidates,
      notMeasured: [],
      notMeasuredCount: 0,
      coverage: 1,
      floor: 0.5,
      ok: true,
    };
  }
  return report;
}

/**
 * The findings state with a long document path whose last segment alone is wider than a printed
 * line: the print probe for a caption, fact or path that must wrap rather than widen the page.
 */
export const LONG_DOCUMENT_PATH = "reports/2026/q3/annual-report-typeset-final-revision-with-appendices-glossary-and-index-v12.html";
export function longDocumentPathReportState(): Report {
  const report = findingsReportState();
  const document = report.documents[0];
  if (!document) throw new Error("surface fixture requires one document");
  const previous = document.path;
  document.path = LONG_DOCUMENT_PATH;
  for (const finding of report.findings) if (finding.document === previous) finding.document = LONG_DOCUMENT_PATH;
  return report;
}

export function canonicalReportStates(): Record<ReportSurfaceState, Report> {
  return {
    clean: cleanReportState(),
    findings: findingsReportState(),
    infrastructure: infrastructureReportState(),
    "insufficient-coverage": insufficientCoverageReportState(),
  };
}
