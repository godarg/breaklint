#!/usr/bin/env node
/**
 * The assertion step of the `action` job in `.github/workflows/ci.yml`.
 *
 * That job calls the composite Action (`uses: ./`) several times over this repository's own
 * fixtures, against the tarball the same commit packs, with real Chrome. The arms that must fail
 * run with `continue-on-error`, so the job's colour says nothing by itself. This script is what
 * makes it say something: it reads each arm's recorded outcome and outputs (`toJSON(steps.<id>)`,
 * passed in the environment as `ARM_<NAME>`) and fails unless every arm did what the Action
 * promises — the right step outcome for the exit code, the right exit code and verdict for the
 * fixture, and SARIF, JUnit and Markdown files that pass `report-format-checks.mjs`.
 *
 * It also checks that the injection canary written into one arm's `paths` was not executed.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { junitProblems, markdownProblems, sarifProblems } from "./report-format-checks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

/** What each arm of the job must have produced. */
export const ARMS = Object.freeze({
  CLEAN: { outcome: "success", exitCode: 0, verdict: "clean", report: true, inputsFound: 1 },
  FINDINGS: { outcome: "failure", exitCode: 1, verdict: "findings", report: true, inputsFound: 2 },
  UNGATED: { outcome: "success", exitCode: 1, verdict: "findings", report: true, inputsFound: 1 },
  INFRASTRUCTURE: { outcome: "failure", exitCode: 3, verdict: "infrastructure", report: true, inputsFound: 1 },
  USAGE: { outcome: "failure", exitCode: 2, verdict: "usage", report: false },
  REFUSED: { outcome: "failure", exitCode: 2, verdict: "not-run", report: false },
});

export function checkArm(name, step, expected) {
  const problems = [];
  const expect = (condition, message) => {
    if (!condition) problems.push(`${name}: ${message}`);
  };
  const outputs = step?.outputs ?? {};
  expect(step?.outcome === expected.outcome, `step outcome ${step?.outcome}, expected ${expected.outcome}`);
  expect(outputs["exit-code"] === String(expected.exitCode), `exit-code output ${JSON.stringify(outputs["exit-code"])}, expected ${expected.exitCode}`);
  expect(outputs.verdict === expected.verdict, `verdict output ${JSON.stringify(outputs.verdict)}, expected ${expected.verdict}`);
  if (!expected.report) {
    for (const output of ["report-json", "sarif-file", "junit-file", "markdown-file"]) {
      expect(!outputs[output], `${output} is set although no report may exist`);
    }
    return problems;
  }
  expect(outputs["breaklint-version"] === VERSION, `breaklint-version ${outputs["breaklint-version"]}, expected this commit's ${VERSION}`);
  for (const output of ["report-json", "sarif-file", "junit-file", "markdown-file"]) {
    expect(Boolean(outputs[output]) && existsSync(outputs[output]), `${output} names no file: ${outputs[output]}`);
  }
  if (problems.length > 0) return problems;

  const report = JSON.parse(readFileSync(outputs["report-json"], "utf8"));
  expect(report.exitCode === expected.exitCode, `the report says exit ${report.exitCode}`);
  expect(report.runVerdict === expected.verdict, `the report says ${report.runVerdict}`);
  expect(report.mode === "live" && report.source === "rendered", `not a live render: mode ${report.mode}, source ${report.source}`);
  expect(report.inputsFound === expected.inputsFound, `inputsFound ${report.inputsFound}, expected ${expected.inputsFound}`);
  if (expected.verdict !== "infrastructure") {
    // A pass or a finding must rest on measurement, not on an empty page.
    expect(report.pagesAnalysed > 0 && report.measuredRules > 0, `pagesAnalysed ${report.pagesAnalysed}, measuredRules ${report.measuredRules}`);
  }

  const sarif = JSON.parse(readFileSync(outputs["sarif-file"], "utf8"));
  for (const problem of sarifProblems(sarif)) expect(false, `SARIF: ${problem}`);
  const invocation = sarif.runs?.[0]?.invocations?.[0];
  expect(invocation?.exitCode === expected.exitCode, `SARIF invocation exitCode ${invocation?.exitCode}`);
  expect(invocation?.executionSuccessful === (expected.verdict === "clean" || expected.verdict === "findings"), "SARIF executionSuccessful disagrees with the verdict");
  expect(sarif.runs[0].results.length === report.findings.length, `SARIF has ${sarif.runs[0].results.length} results for ${report.findings.length} findings`);
  if (expected.verdict === "findings") {
    const located = sarif.runs[0].results.find((result) =>
      result.ruleId === "svg/text-overflows-viewport" && result.level === "error" &&
      result.locations?.[0]?.physicalLocation?.artifactLocation?.uri === "tests/fixtures/action/findings.html" &&
      result.locations[0].physicalLocation.region?.startLine >= 1);
    expect(Boolean(located), "no error result for svg/text-overflows-viewport located in tests/fixtures/action/findings.html");
  }
  if (expected.verdict === "infrastructure") {
    expect((invocation?.toolExecutionNotifications ?? []).some((n) => n.level === "error"), "an exit-3 SARIF names no error notification");
  }

  const junit = readFileSync(outputs["junit-file"], "utf8");
  for (const problem of junitProblems(junit)) expect(false, `JUnit: ${problem}`);
  const failures = Number(/<testsuites [^>]*failures="(\d+)"/u.exec(junit)?.[1]);
  expect(expected.verdict === "clean" ? failures === 0 : failures > 0, `JUnit failures="${failures}" for a ${expected.verdict} run`);

  for (const problem of markdownProblems(readFileSync(outputs["markdown-file"], "utf8"), expected.verdict)) expect(false, `Markdown: ${problem}`);
  return problems;
}

function main() {
  const problems = [];
  let checked = 0;
  for (const [name, expected] of Object.entries(ARMS)) {
    const raw = process.env[`ARM_${name}`];
    if (!raw) {
      problems.push(`${name}: ARM_${name} is not set; the workflow no longer runs this arm`);
      continue;
    }
    problems.push(...checkArm(name, JSON.parse(raw), expected));
    checked += 1;
  }
  const canary = process.env.INJECTION_CANARY;
  if (!canary) problems.push("INJECTION_CANARY is not set");
  else if (existsSync(canary)) problems.push(`the injection canary ${canary} exists: a 'paths' line was executed`);
  if (checked === 0) problems.push("no arm was checked");
  if (problems.length > 0) {
    process.stderr.write(`the Action did not behave as specified:\n${problems.map((p) => `  ${p}\n`).join("")}`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`the Action behaved as specified in all ${checked} arms; SARIF, JUnit and Markdown validated\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
