#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MANIFEST_PATH = join(ROOT, "corpus/public/robustness-v1/manifest.json");
const MANIFEST_ROOT = dirname(MANIFEST_PATH);
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
assert.equal(manifest.contractVersion, "robustness-corpus-v1");
assert.equal(manifest.calibrationEvidenceEligible, false, "robustness evidence is not calibration evidence");
assert.equal(manifest.externalTrustRootClaimed, false, "the robustness corpus is not an external trust root");
assert.equal(manifest.documents?.length, 2, "the admitted robustness manifest must bind both corpus documents");
assert.deepEqual(
  new Set(manifest.documents.map((item) => item.sourceClass)),
  new Set(["public-domain-third-party", "public-first-party"]),
  "the gate needs one third-party breadth artifact and one first-party resource-packaging artifact",
);
const CASES = manifest.documents.map((item) => ({
  ...item,
  document: resolve(MANIFEST_ROOT, item.artifact),
  evidence: resolve(MANIFEST_ROOT, item.sourceEvidence),
}));

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const cli = resolve(argument("--cli") ?? join(ROOT, "dist/cli/index.js"));
const cwdArgument = argument("--cwd");
assert.ok(process.argv.includes("--cwd"), "--cwd is required; the CLI must not inherit this gate's checkout");
assert.ok(cwdArgument && !cwdArgument.startsWith("--"), "--cwd requires an explicit directory");
const cliCwd = resolve(cwdArgument);
assert.ok(existsSync(cliCwd) && statSync(cliCwd).isDirectory(), `CLI cwd is not a directory: ${cliCwd}`);
const temporary = mkdtempSync(join(tmpdir(), "breaklint-real-document-gate-"));

try {
  for (const corpusCase of CASES) {
    const evidence = JSON.parse(readFileSync(corpusCase.evidence, "utf8"));

    // Bind the admitted bytes and their rights/privacy review before Chrome starts. The external
    // case is the actual breadth gate; the first-party case separately exercises missing-resource
    // packaging without pretending that it supplies external validation.
    assert.equal(sha256(corpusCase.document), corpusCase.sha256, `${corpusCase.id}: admitted bytes drifted`);
    assert.equal(evidence.frozenArtifact.sha256, corpusCase.sha256);
    assert.equal(evidence.frozenArtifact.mediaType, "text/html");
    assert.equal(evidence.sourceClass, corpusCase.sourceClass);
    assert.equal(evidence.rightsBasis, corpusCase.rightsBasis);
    assert.equal(evidence.privacyReview.decision, "eligible");
    assert.equal(evidence.calibrationEvidenceEligible, false, "robustness evidence is not calibration evidence");

    const reportPath = join(temporary, `${corpusCase.id}.json`);
    const run = spawnSync(process.execPath, [
      cli,
      "--format",
      "json",
      "--out",
      reportPath,
      corpusCase.document,
    ], {
      // A packed consumer resolves optional peers from its own project, not from this checkout.
      // The v0.3.0 release gate was genuinely red on both supported Node versions because ROOT
      // silently replaced that consumer boundary here; mandatory --cwd preserves the boundary.
      cwd: cliCwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
    assert.equal(run.signal, null, `${corpusCase.id}: process was terminated by ${run.signal}`);
    assert.equal(
      run.status,
      corpusCase.expected.exitCode,
      `${corpusCase.id}: CLI exited ${run.status}, expected an exact clean measurement.\n` +
        `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
    );

    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    assert.equal(report.schemaVersion, 4);
    assert.equal(report.mode, "live");
    assert.equal(report.source, "rendered");
    assert.equal(report.inputsFound, 1);
    assert.equal(report.pagesAnalysed, corpusCase.expected.pagesAnalysed, `${corpusCase.id}: documented page count drifted`);
    assert.equal(report.rulesRun, corpusCase.expected.rulesRun, "real-document gate and public rule contract diverged");
    assert.equal(
      report.measuredRules,
      corpusCase.expected.measuredRules,
      `${corpusCase.id}: documented measured-rule count drifted`,
    );
    assert.equal(report.exitCode, corpusCase.expected.exitCode);
    assert.equal(report.documents.length, 1);
    const [document] = report.documents;
    assert.equal(document.inputIdentity.html, corpusCase.sha256);
    assert.equal(document.pages, corpusCase.expected.pagesAnalysed);
    assert.deepEqual(
      document.infrastructure.map((event) => event.kind),
      corpusCase.expected.infrastructureKinds,
      `${corpusCase.id}: infrastructure contract drifted`,
    );
    assert.equal(document.coverage["svg/text-clipped"], undefined);
    assert.equal(document.coverage["svg/text-ink-collision"], undefined);
    assert.ok(
      Object.values(document.coverage).some((coverage) => coverage.measured > 0),
      `${corpusCase.id}: coverage map contains no real measurement`,
    );

    const geometryEvent = document.infrastructure.find((event) => event.kind === "geometry-cross-check-passed");
    assert.ok(geometryEvent, `${corpusCase.id}: no positive geometry-oracle evidence was reported`);
    assert.deepEqual(
      geometryEvent.measured,
      corpusCase.expected.geometryCrossCheck,
      `${corpusCase.id}: positive geometry-oracle evidence drifted`,
    );
    if (corpusCase.id === "dargel-kleingewerbe") {
      const imageEvent = document.infrastructure.find((event) => event.kind === "image-content-unavailable");
      assert.ok(imageEvent);
      assert.deepEqual(imageEvent.measured, {
        images: [
          { resourceIndex: 1, widthPx: 36, heightPx: 36, declaredWidthPx: 36, declaredHeightPx: 36 },
          { resourceIndex: 2, widthPx: 36, heightPx: 36, declaredWidthPx: 36, declaredHeightPx: 36 },
          { resourceIndex: 3, widthPx: 1, heightPx: 1, declaredWidthPx: 1, declaredHeightPx: 1 },
        ],
      });
      assert.doesNotMatch(
        JSON.stringify(imageEvent),
        /(?:file:|\/assets\/|pixel\.gif)/u,
        "the named diagnostic persisted a resource URI",
      );
    }

    process.stdout.write(
      `real-document gate: ${corpusCase.id}; exit ${run.status}; ${report.pagesAnalysed} page(s); ` +
        `${report.measuredRules}/${report.rulesRun} rules measured; geometry ` +
        `${geometryEvent.measured.checked}/${geometryEvent.measured.required}; artifact ${corpusCase.sha256}\n`,
    );
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
