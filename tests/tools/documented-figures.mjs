#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FIGURES_MARKER = /<!-- breaklint-status-figures-v1 unitTests=(\d+) aggregateTests=(\d+) liveTests=(\d+) liveReportLeaves=(\d+) s1RasterDiffPx=(\d+) s1ForeignRasterDiffPx=(\d+) -->/u;

function leafCount(value) {
  if (value !== null && typeof value === "object") {
    const entries = Array.isArray(value) ? value : Object.values(value);
    return entries.length === 0 ? 1 : entries.reduce((sum, child) => sum + leafCount(child), 0);
  }
  return 1;
}

function lastTapTestCount(tapText, label) {
  const matches = [...tapText.matchAll(/^# tests (\d+)$/gmu)];
  if (!matches.length) throw new Error(`${label} contains no final test count`);
  return Number(matches.at(-1)[1]);
}

function acceptedLiveTestCount(liveSummary) {
  if (liveSummary?.contractVersion !== "breaklint-live-summary-v1") return undefined;
  const suites = liveSummary.suites;
  const tests = liveSummary.tests;
  if (
    !Number.isInteger(suites?.passed) || !Number.isInteger(suites?.expected) ||
    !Number.isInteger(tests?.passed) || !Number.isInteger(tests?.expected) ||
    suites.passed <= 0 || tests.passed <= 0 ||
    suites.passed !== suites.expected || tests.passed !== tests.expected
  ) return undefined;
  return tests.passed;
}

function documentedFigures(statusText) {
  const match = FIGURES_MARKER.exec(statusText);
  if (!match) throw new Error("docs/status.md has no unique breaklint-status-figures-v1 marker");
  if ([...statusText.matchAll(new RegExp(FIGURES_MARKER.source, "gu"))].length !== 1) throw new Error("docs/status.md has more than one figures marker");
  return {
    unitTests: Number(match[1]),
    aggregateTests: Number(match[2]),
    liveTests: Number(match[3]),
    liveReportLeaves: Number(match[4]),
    s1RasterDiffPx: Number(match[5]),
    s1ForeignRasterDiffPx: Number(match[6]),
  };
}

export function evaluateDocumentedFigures({ statusText, unitTapText, aggregateTapText, liveSummary, liveReport }) {
  const documented = documentedFigures(statusText);
  const measured = {
    unitTests: lastTapTestCount(unitTapText, "unit TAP"),
    aggregateTests: lastTapTestCount(aggregateTapText, "aggregate TAP"),
    liveTests: acceptedLiveTestCount(liveSummary),
    liveReportLeaves: leafCount(liveReport),
    s1RasterDiffPx: liveReport?.cases?.S1_scriptRecoloursMarks?.rasterDiffPx,
    s1ForeignRasterDiffPx: liveReport?.cases?.S1_scriptRecoloursMarks?.foreignRasterDiffPx,
  };
  const issues = Object.keys(documented)
    .filter((key) => !Number.isFinite(measured[key]) || documented[key] !== measured[key])
    .map((key) => `${key}: documented=${documented[key]}, measured=${String(measured[key])}`);
  return { valid: issues.length === 0, documented, measured, issues };
}

function argument(argv, name) {
  const index = argv.indexOf(`--${name}`);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function main() {
  const statusPath = argument(process.argv, "status") ?? "docs/status.md";
  const unitTapPath = argument(process.argv, "unit-tap");
  const aggregateTapPath = argument(process.argv, "aggregate-tap");
  const liveSummaryPath = argument(process.argv, "live-summary");
  const liveReportPath = argument(process.argv, "live-report");
  if (!unitTapPath || !aggregateTapPath || !liveSummaryPath || !liveReportPath) {
    process.stderr.write("usage: node tests/tools/documented-figures.mjs --unit-tap <tap> --aggregate-tap <tap> --live-summary <json> --live-report <json> [--status <md>]\n");
    process.exitCode = 2;
    return;
  }
  const result = evaluateDocumentedFigures({
    statusText: readFileSync(statusPath, "utf8"),
    unitTapText: readFileSync(unitTapPath, "utf8"),
    aggregateTapText: readFileSync(aggregateTapPath, "utf8"),
    liveSummary: JSON.parse(readFileSync(liveSummaryPath, "utf8")),
    liveReport: JSON.parse(readFileSync(liveReportPath, "utf8")),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.valid ? 0 : 1;
}

export function isMainModule(argvPath, modulePath = fileURLToPath(import.meta.url)) {
  return Boolean(argvPath) && realpathSync(argvPath) === realpathSync(modulePath);
}

if (isMainModule(process.argv[1])) main();
