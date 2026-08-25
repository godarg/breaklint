#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const FIGURES_MARKER = /<!-- breaklint-status-figures-v1 unitTests=(\d+) liveReportLeaves=(\d+) s1RasterDiffPx=(\d+) s1ForeignRasterDiffPx=(\d+) -->/u;

function leafCount(value) {
  if (value !== null && typeof value === "object") {
    const entries = Array.isArray(value) ? value : Object.values(value);
    return entries.length === 0 ? 1 : entries.reduce((sum, child) => sum + leafCount(child), 0);
  }
  return 1;
}

function lastTapTestCount(tapText) {
  const matches = [...tapText.matchAll(/^# tests (\d+)$/gmu)];
  if (!matches.length) throw new Error("unit TAP contains no final test count");
  return Number(matches.at(-1)[1]);
}

function documentedFigures(statusText) {
  const match = FIGURES_MARKER.exec(statusText);
  if (!match) throw new Error("docs/status.md has no unique breaklint-status-figures-v1 marker");
  if ([...statusText.matchAll(new RegExp(FIGURES_MARKER.source, "gu"))].length !== 1) throw new Error("docs/status.md has more than one figures marker");
  return {
    unitTests: Number(match[1]),
    liveReportLeaves: Number(match[2]),
    s1RasterDiffPx: Number(match[3]),
    s1ForeignRasterDiffPx: Number(match[4]),
  };
}

export function evaluateDocumentedFigures({ statusText, unitTapText, liveReport }) {
  const documented = documentedFigures(statusText);
  const measured = {
    unitTests: lastTapTestCount(unitTapText),
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
  const liveReportPath = argument(process.argv, "live-report");
  if (!unitTapPath || !liveReportPath) {
    process.stderr.write("usage: node tests/tools/documented-figures.mjs --unit-tap <tap> --live-report <json> [--status <md>]\n");
    process.exitCode = 2;
    return;
  }
  const result = evaluateDocumentedFigures({
    statusText: readFileSync(statusPath, "utf8"),
    unitTapText: readFileSync(unitTapPath, "utf8"),
    liveReport: JSON.parse(readFileSync(liveReportPath, "utf8")),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.valid ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
