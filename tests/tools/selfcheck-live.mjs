#!/usr/bin/env node

/**
 * Real self-application gate.
 *
 * This does not trust HTML wording or the child process alone. It creates the report through the
 * public CLI, runs that exact HTML through the real browser/paginator/evidence/engine path, and
 * checks the canonical JSON. A transformed unbreakable finding card is the paired red control.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../..", import.meta.url);
const CLI = resolve(fileURLToPath(ROOT), "src/cli/index.ts");
const PROOF_A_RULES = [
  "layout/unbreakable-block-too-tall",
  "svg/text-overflows-viewport",
];
const scratch = mkdtempSync(join(tmpdir(), "breaklint-live-selfcheck-"));

function run(args) {
  return spawnSync(process.execPath, ["--experimental-strip-types", CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
}

function diagnostic(result) {
  return `status=${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}

function readReport(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

try {
  const ownHtml = join(scratch, "breaklint-own-report.html");
  const generated = run(["--demo", "--format", "html", "--out", ownHtml]);
  assert.equal(generated.status, 1, `the demo report must contain its documented findings\n${diagnostic(generated)}`);

  const cleanJson = join(scratch, "selfcheck-clean.json");
  const clean = run([
    "--only",
    PROOF_A_RULES.join(","),
    "--format",
    "json",
    "--out",
    cleanJson,
    ownHtml,
  ]);
  assert.equal(clean.status, 0, `breaklint's own report did not pass the live proof-A path\n${diagnostic(clean)}`);
  const cleanReport = readReport(cleanJson);
  assert.equal(cleanReport.runVerdict, "clean");
  assert.equal(cleanReport.exitCode, 0);
  assert.equal(cleanReport.rulesRun, PROOF_A_RULES.length);
  assert.equal(cleanReport.findings.filter((finding) => finding.severity === "error").length, 0);
  assert.ok(cleanReport.documents.length > 0, "the selfcheck judged no document");
  for (const document of cleanReport.documents) {
    assert.deepEqual(
      document.infrastructure.map((event) => event.kind),
      ["geometry-cross-check-passed"],
      "the selfcheck either hid its positive oracle evidence or retained another infrastructure event",
    );
    const geometry = document.infrastructure[0].measured;
    assert.equal(geometry.checked, 8);
    assert.equal(geometry.required, 8);
    assert.ok(geometry.candidates >= geometry.eligible && geometry.eligible >= geometry.required);
    assert.equal(geometry.maxDeltaPx, 0);
    assert.equal(geometry.tolerancePx, 0.05);
    for (const ruleId of PROOF_A_RULES) {
      const coverage = document.coverage[ruleId];
      assert.ok(coverage, `${ruleId} produced no structured coverage row`);
      assert.equal(coverage.measured, coverage.candidates, `${ruleId} left a candidate unmeasured`);
      assert.equal(coverage.notMeasuredCount, 0, `${ruleId} declined part of the own report`);
      assert.equal(coverage.ok, true, `${ruleId} did not meet its effective floor`);
    }
  }

  // Fault injection: the report's finding cards promise `break-inside: avoid-page`. Scaling the
  // first card beyond a page makes that promise arithmetically impossible without changing the
  // rule threshold. If the exact same browser chain stays green, the selfcheck is theatre.
  const source = readFileSync(ownHtml, "utf8");
  const needle = '<article class="finding ';
  assert.ok(source.includes(needle), "the own report contains no finding card for the red control");
  const brokenHtml = join(scratch, "breaklint-own-report-broken.html");
  writeFileSync(
    brokenHtml,
    source.replace(
      needle,
      '<article style="transform:scaleY(20);transform-origin:top" class="finding ',
    ),
  );
  const redJson = join(scratch, "selfcheck-red.json");
  const red = run([
    "--only",
    "layout/unbreakable-block-too-tall",
    "--format",
    "json",
    "--out",
    redJson,
    brokenHtml,
  ]);
  assert.equal(red.status, 1, `the live selfcheck fault injection stayed green\n${diagnostic(red)}`);
  const redReport = readReport(redJson);
  assert.equal(redReport.runVerdict, "findings");
  assert.equal(redReport.exitCode, 1);
  assert.ok(
    redReport.findings.some(
      (finding) => finding.ruleId === "layout/unbreakable-block-too-tall" && finding.severity === "error",
    ),
    "the red control failed for a reason other than the injected proof-A violation",
  );

  process.stdout.write(
    `live self-application: ${PROOF_A_RULES.length} proof-A rules clean with full candidate coverage; ` +
      "oversized unbreakable-card control caught\n",
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
