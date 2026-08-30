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

const cliIndex = process.argv.indexOf("--cli");
assert.ok(cliIndex >= 0 && process.argv[cliIndex + 1], "usage: real-document-red-control.mjs --cli <breaklint-0.2.3/dist/cli/index.js>");
const cli = resolve(process.argv[cliIndex + 1]);
const packageRoot = resolve(dirname(cli), "../..");
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
assert.deepEqual({ name: manifest.name, version: manifest.version }, { name: "breaklint", version: "0.2.3" });
assert.equal(createHash("sha256").update(readFileSync(DOCUMENT)).digest("hex"), DOCUMENT_SHA256);

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
  process.stdout.write(
    `0.2.3 red control: exit ${run.status}; ${report.pagesAnalysed} pages; ` +
      `${report.measuredRules}/${report.rulesRun} rules measured; max delta ${event.measured.maxDeltaPx} px; ` +
      `artifact ${DOCUMENT_SHA256}\n`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
