#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CASES = [
  {
    id: "project-gutenberg-gettysburg-address",
    document: join(ROOT, "corpus/public/robustness-v1/documents/project-gutenberg-gettysburg-address.html"),
    evidence: join(
      ROOT,
      "corpus/public/robustness-v1/source-evidence/source-project-gutenberg-gettysburg-address.json",
    ),
    sha256: "2da09414df2cfbe8f48420abd73067e3e08182d152d3d13bcdd1d26ff30535d9",
    sourceClass: "public-domain-third-party",
    rightsBasis: "public-domain-author-death-1865-and-upstream-public-domain-notice",
    pages: 9,
    measuredRules: 9,
    infrastructureKinds: [],
  },
  {
    id: "dargel-kleingewerbe",
    document: join(ROOT, "corpus/public/m3-1-pilot-v1/documents/dargel-kleingewerbe.html"),
    evidence: join(ROOT, "corpus/public/m3-1-pilot-v1/source-evidence/source-dargel-kleingewerbe.json"),
    sha256: "703acb5a78a6d3cd91133192938df218356034308440d9cbdf9764c2f9805df3",
    sourceClass: "public-first-party",
    rightsBasis: "first-party-founder-authorized",
    pages: 6,
    measuredRules: 11,
    infrastructureKinds: ["image-content-unavailable"],
  },
];

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const cli = resolve(argument("--cli") ?? join(ROOT, "dist/cli/index.js"));
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
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
    assert.equal(run.signal, null, `${corpusCase.id}: process was terminated by ${run.signal}`);
    assert.equal(
      run.status,
      0,
      `${corpusCase.id}: CLI exited ${run.status}, expected an exact clean measurement.\n` +
        `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
    );

    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    assert.equal(report.schemaVersion, 3);
    assert.equal(report.mode, "live");
    assert.equal(report.source, "rendered");
    assert.equal(report.inputsFound, 1);
    assert.equal(report.pagesAnalysed, corpusCase.pages, `${corpusCase.id}: documented page count drifted`);
    assert.equal(report.rulesRun, 13, "real-document gate and public rule contract diverged");
    assert.equal(
      report.measuredRules,
      corpusCase.measuredRules,
      `${corpusCase.id}: documented measured-rule count drifted`,
    );
    assert.equal(report.exitCode, 0);
    assert.equal(report.documents.length, 1);
    const [document] = report.documents;
    assert.equal(document.inputIdentity.html, corpusCase.sha256);
    assert.equal(document.pages, corpusCase.pages);
    assert.deepEqual(
      document.infrastructure.map((event) => event.kind),
      corpusCase.infrastructureKinds,
      `${corpusCase.id}: infrastructure contract drifted`,
    );
    assert.equal(document.coverage["svg/text-clipped"], undefined);
    assert.equal(document.coverage["svg/text-ink-collision"], undefined);
    assert.ok(
      Object.values(document.coverage).some((coverage) => coverage.measured > 0),
      `${corpusCase.id}: coverage map contains no real measurement`,
    );

    if (corpusCase.id === "dargel-kleingewerbe") {
      const [imageEvent] = document.infrastructure;
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
        `${report.measuredRules}/${report.rulesRun} rules measured; artifact ${corpusCase.sha256}\n`,
    );
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
