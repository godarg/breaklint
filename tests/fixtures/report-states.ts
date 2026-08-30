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
    report.findings[1].evidence = {
      ref: "surface-demo-page-002.png",
      bindsFinding: false,
    };
    report.findings[1].ambiguity = { groupSize: 2, resolvable: false };
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

export function canonicalReportStates(): Record<ReportSurfaceState, Report> {
  return {
    clean: cleanReportState(),
    findings: findingsReportState(),
    infrastructure: infrastructureReportState(),
    "insufficient-coverage": insufficientCoverageReportState(),
  };
}
