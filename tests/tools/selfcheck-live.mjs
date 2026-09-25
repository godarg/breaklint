#!/usr/bin/env node

/**
 * Real self-application gate.
 *
 * This does not trust HTML wording or the child process alone. It creates the report through the
 * public CLI, runs that exact HTML through the real browser/paginator/evidence/engine path, and
 * checks the canonical JSON. A transformed unbreakable finding tail is the paired red control.
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

  // Fault injection: each finding's tail (remediation, note and evidence) promises
  // `break-inside: avoid` in print. Giving the first tail a fixed height beyond the page content box
  // makes that promise arithmetically impossible without touching the rule threshold. If the exact
  // same browser chain stays green, the selfcheck is theatre.
  //
  // The target moved from the whole finding card to one of its units when findings started to
  // fragment between their units: the card itself is `break-inside: auto` now, so it is no longer a
  // candidate of the rule and injecting into it would prove nothing. The tail still asks not to be
  // broken, so the control keeps testing what it tested before — a block that promises not to break
  // and cannot keep the promise. Measured locally (patched Chromium 141, no evidence binding): the
  // tail, the report header and the findings section heading each give one error finding at
  // exactly 1600 px; the finding HEAD does not qualify — Paged.js 0.4.3 dropped 117 of 331 source
  // ids after an oversized head that also carries `break-after: avoid`, and the run ended exit 3.
  //
  // The injected height is absolute, and that is the point. This control used to multiply the
  // card's own height with `transform: scaleY(20)`, which made the fault a MULTIPLE of the card's
  // content — so it moved whenever the card's content moved. Measured on 2026-09-18: once each
  // card gained a remediation box, the same injection produced a card the paginator fragmented
  // into nineteen pieces, the rule measured fragment 0 at 895.9 px against a 1031.8 px page, and
  // the control went green on a real fault. A control calibrated to today's content is a control
  // with an expiry date. (That the rule measures a FRAGMENT rather than the block when the
  // paginator splits it is a separate open question about the rule, not about this control.)
  const source = readFileSync(ownHtml, "utf8");
  const needle = '<div class="finding-tail">';
  assert.ok(source.includes(needle), "the own report contains no finding tail for the red control");
  const INJECTED_CARD_HEIGHT_PX = 1600;
  const brokenHtml = join(scratch, "breaklint-own-report-broken.html");
  writeFileSync(
    brokenHtml,
    source.replace(
      needle,
      `<div style="height:${INJECTED_CARD_HEIGHT_PX}px;overflow:hidden" class="finding-tail">`,
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
  const redReport = readReport(redJson);
  const redDocument = redReport.documents[0];
  const coverage = redDocument.evidenceCoverage;
  // Evidence binding stays on here, as in the clean run, and the report says which of two
  // outcomes it reached; the control accepts neither on faith. The oversized tail starts on its
  // page and its START mark is placed there; only its end mark (and the end marks of its
  // ancestors) lies below the content box and is refused. A refused end mark does not unbind a
  // page on which the same block's start mark is placed (src/render/evidence.ts, `hasUnplacedTarget`),
  // so whether that page binds depends only on whether the browser's PDF returns every placed mark
  // there. Measured in CI on current Chrome: at ed84d2c every page bound and the run ended exit 1;
  // on the previous surface layout the same injection ended exit 4, with no per-page record of why.
  // An earlier comment here said the box "cannot receive an in-page evidence mark"; the code never
  // did that. Both outcomes are therefore checked completely, and the per-page evidence is printed
  // so the phase CI reached is on record instead of inferred.
  const pageEvidence = redDocument.evidence.map((entry) => ({
    page: entry.page,
    binds: entry.bindsFinding,
    conformance: entry.pdfConformance,
    marks: entry.conformance ? `${entry.conformance.marksMatched}/${entry.conformance.marksTotal}` : null,
    unplaced: entry.unplacedMarks.map((mark) => `${mark.sid}:${mark.side}`),
  }));
  process.stdout.write(`live self-application red control: exit ${red.status}; evidence ${coverage.status} ` +
    `(${coverage.boundPages}/${coverage.expectedPages} pages bound): ${JSON.stringify(pageEvidence)}\n`);
  assert.equal(coverage.required, true, "the red control must run with evidence binding on, as the clean run does");
  // The coverage summary and the per-page records must tell the same story.
  assert.equal(pageEvidence.length, coverage.expectedPages, "the red run did not record evidence for every page");
  assert.equal(pageEvidence.filter((entry) => entry.binds).length, coverage.boundPages, "the per-page evidence and the coverage summary disagree");
  assert.equal(redReport.summary.gateCandidate, "error");
  assert.equal(redDocument.coverage["layout/unbreakable-block-too-tall"].coverage, 1);
  if (coverage.status === "complete") {
    // Every page bound: the injected error is a gating finding bound to page evidence.
    assert.equal(red.status, 1, `evidence is complete, so the injected error must fail the build with exit 1\n${diagnostic(red)}`);
    assert.equal(redReport.runVerdict, "findings");
    assert.equal(redReport.exitCode, 1);
    assert.equal(redReport.summary.gateTriggeredBy, "error");
    assert.equal(coverage.boundPages, coverage.expectedPages);
  } else {
    // A page did not bind: the stricter coverage verdict wins, and the arithmetic error must
    // remain visible beside it. Each unbound page must name a cause the report carries.
    assert.equal(red.status, 4, `evidence is ${coverage.status}, so the run must end insufficient-coverage (exit 4)\n${diagnostic(red)}`);
    assert.equal(redReport.runVerdict, "insufficient-coverage");
    assert.equal(redReport.exitCode, 4);
    assert.equal(redReport.summary.gateTriggeredBy, null);
    assert.equal(coverage.status, "partial", `evidence must be partial, not ${coverage.status}: a red control without any bound page proves nothing about binding`);
    assert.ok(coverage.boundPages < coverage.expectedPages);
  }
  assert.ok(
    redReport.findings.some(
      (finding) => finding.ruleId === "layout/unbreakable-block-too-tall" && finding.severity === "error",
    ),
    "the red control failed for a reason other than the injected proof-A violation",
  );
  // And it must be the INJECTED block that was measured, at its whole height. Without this, a
  // future change that makes the paginator fragment the injected card would leave the control
  // exiting 4 for an unrelated reason while the injected fault went unreported.
  const injected = redReport.findings.find(
    (finding) => finding.ruleId === "layout/unbreakable-block-too-tall" && finding.severity === "error",
  );
  // Within a pixel rather than exactly: the height is an authored CSS length and measured 1600.00
  // here, but a box height is a rounded measurement and an exact comparison would make this
  // control fail for a reason that has nothing to do with what it guards.
  assert.ok(
    Math.abs((injected?.target?.boxScreen?.height ?? 0) - INJECTED_CARD_HEIGHT_PX) < 1,
    `the red control reported a block other than the injected card; the paginator probably split it\n${JSON.stringify(injected?.target ?? null)}`,
  );

  process.stdout.write(
    `live self-application: ${PROOF_A_RULES.length} proof-A rules clean with full candidate coverage; ` +
      "oversized unbreakable finding-tail control caught\n",
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
