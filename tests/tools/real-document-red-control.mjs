#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DOCUMENT = join(ROOT, "corpus/public/robustness-v1/documents/project-gutenberg-gettysburg-address.html");
const DOCUMENT_SHA256 = "2da09414df2cfbe8f48420abd73067e3e08182d152d3d13bcdd1d26ff30535d9";
const EVIDENCE = JSON.parse(readFileSync(join(ROOT, "docs/validation/real-document-red-control-v0.2.3.json"), "utf8"));

const cliIndex = process.argv.indexOf("--cli");
const cliArgument = cliIndex >= 0 ? process.argv[cliIndex + 1] : process.env.BREAKLINT_023_CLI;
assert.ok(
  cliArgument,
  "usage: BREAKLINT_023_CLI=<breaklint-0.2.3/dist/cli/index.js> npm run test:real-document:red-control",
);
const cli = resolve(cliArgument);
const packageRoot = resolve(dirname(cli), "../..");
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
assert.deepEqual({ name: manifest.name, version: manifest.version }, { name: "breaklint", version: "0.2.3" });
assert.equal(createHash("sha256").update(readFileSync(DOCUMENT)).digest("hex"), DOCUMENT_SHA256);
assert.equal(EVIDENCE.package.name, manifest.name);
assert.equal(EVIDENCE.package.version, manifest.version);
assert.equal(EVIDENCE.document.sha256, DOCUMENT_SHA256);

const temporary = mkdtempSync(join(tmpdir(), "breaklint-0.2.3-red-control-"));
try {
  const reportPath = join(temporary, "report.json");
  const run = spawnSync(process.execPath, [cli, "--format", "json", "--out", reportPath, DOCUMENT], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  assert.equal(run.signal, null, `0.2.3 red control was terminated by ${run.signal}`);
  assert.equal(run.status, 3, `0.2.3 no longer produces the required red control\n${run.stdout}\n${run.stderr}`);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.deepEqual(
    {
      exitCode: report.exitCode,
      inputsFound: report.inputsFound,
      pagesAnalysed: report.pagesAnalysed,
      rulesRun: report.rulesRun,
      measuredRules: report.measuredRules,
      runVerdict: report.runVerdict,
    },
    { exitCode: 3, inputsFound: 1, pagesAnalysed: 0, rulesRun: 15, measuredRules: 0, runVerdict: "infrastructure" },
  );
  const event = report.documents?.[0]?.infrastructure?.find((item) => item.kind === "geometry-cross-check-failed");
  assert.ok(event, "0.2.3 red control lacks the geometry-cross-check-failed event");
  assert.deepEqual(
    { checked: event.measured.checked, maxDeltaPx: event.measured.maxDeltaPx, tolerancePx: event.measured.tolerancePx },
    { checked: 8, maxDeltaPx: 18, tolerancePx: 0.05 },
  );
  const deterministicObserved = {
      exitCode: report.exitCode,
      inputsFound: report.inputsFound,
      pagesAnalysed: report.pagesAnalysed,
      rulesRun: report.rulesRun,
      measuredRules: report.measuredRules,
      runVerdict: report.runVerdict,
      infrastructureKind: event.kind,
      checked: event.measured.checked,
      maxDeltaPx: event.measured.maxDeltaPx,
      tolerancePx: event.measured.tolerancePx,
  };
  assert.deepEqual(
    deterministicObserved,
    {
      exitCode: EVIDENCE.observed.exitCode,
      inputsFound: EVIDENCE.observed.inputsFound,
      pagesAnalysed: EVIDENCE.observed.pagesAnalysed,
      rulesRun: EVIDENCE.observed.rulesRun,
      measuredRules: EVIDENCE.observed.measuredRules,
      runVerdict: EVIDENCE.observed.runVerdict,
      infrastructureKind: EVIDENCE.observed.infrastructureKind,
      checked: EVIDENCE.observed.checked,
      maxDeltaPx: EVIDENCE.observed.maxDeltaPx,
      tolerancePx: EVIDENCE.observed.tolerancePx,
    },
    "the executable red control diverged from its recorded deterministic observation",
  );
  assert.equal(
    createHash("sha256").update(JSON.stringify(deterministicObserved)).digest("hex"),
    EVIDENCE.observed.deterministicSummarySha256,
    "the deterministic red-control summary hash drifted",
  );
  process.stdout.write(
    `0.2.3 red control: exit ${run.status}; ${report.pagesAnalysed} pages; ` +
      `${report.measuredRules}/${report.rulesRun} rules measured; max delta ${event.measured.maxDeltaPx} px; ` +
      `artifact ${DOCUMENT_SHA256}\n`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
