#!/usr/bin/env node
/**
 * The gate for documents whose paginator left content off the page.
 *
 * WHY THIS IS ITS OWN GATE AND NOT A ROW IN THE ROBUSTNESS MANIFEST. `real-document-gate.mjs`
 * admits documents that must measure CLEANLY, and its assertions are written in that direction:
 * exit 0, a page count, a cross-check that passed. These six must NOT measure. They are the
 * negative half of the same property, and the thing being checked is not that a run fails — a run
 * can fail for any reason at all — but that it fails with the CAUSE NAMED, at the element, on the
 * right page.
 *
 * WHAT WENT WRONG WITHOUT IT. Six of the eighteen chapters of a shipped HTML bundle ended with
 * `checker-crashed` and a payload reading `freezeChanged: true` beside four zeroes and three empty
 * arrays. Every fixture in this repository paginated cleanly, so nothing was red, and the class was
 * not visible until the tool was pointed at a corpus that was not its own.
 *
 * WHY THE BYTES ARE NOT IN THE REPOSITORY, AND WHAT THAT COSTS. They are chapters of a paid
 * product — 27 492 of that bundle's 69 017 words — and this repository is public and MIT. The
 * public record is therefore hash-only, exactly the `private_nonredistributable` shape
 * `docs/validation/corpus-contract-v1.md` defines. Two consequences are load-bearing here:
 *
 *   1. WITHOUT AN ARTIFACT ROOT THIS GATE MAKES NO SUCCESS CLAIM. It prints `SKIPPED` and says how
 *      many documents it did not read. A gate that printed a tick over zero documents would be the
 *      green-over-nothing shape this repository has already had to repair once.
 *   2. THE REGRESSION PROTECTION IS NOT THIS GATE. It is `tests/fixtures/fragmentainer-residue.html`
 *      in the live suite, which is public, carries no product text and runs everywhere. A check
 *      that can only run on bytes most contributors cannot obtain is not a check.
 *
 * With a root, nothing is softened: every admitted byte is hashed before Chrome starts, and the
 * per-document residue pages, counts and column pitch are compared exactly.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MANIFEST_PATH = join(ROOT, "corpus/public/pagination-residue-v1/manifest.json");
const MANIFEST_ROOT = dirname(MANIFEST_PATH);
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

assert.equal(manifest.contractVersion, "pagination-residue-corpus-v2");
assert.equal(manifest.calibrationEvidenceEligible, false, "residue evidence is not calibration evidence");
assert.equal(manifest.externalTrustRootClaimed, false, "this corpus is not an external trust root");
assert.equal(manifest.artifactsInRepository, false, "the public copy must not carry the admitted bytes");
assert.equal(manifest.documents?.length, 6, "the admitted manifest must bind all six documents");

const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

// --- the public half, which runs everywhere ---------------------------------------------------
// The record is checked for internal consistency whether or not the bytes are reachable: a
// manifest whose evidence files disagree with it is broken even when nobody can open the artifact.
for (const entry of manifest.documents) {
  const evidence = JSON.parse(readFileSync(resolve(MANIFEST_ROOT, entry.sourceEvidence), "utf8"));
  assert.equal(entry.artifact, null, `${entry.id}: the public copy names a repository path it does not contain`);
  assert.equal(evidence.frozenArtifact.repositoryPath, null, `${entry.id}: evidence names a repository path`);
  assert.equal(evidence.frozenArtifact.sha256, entry.sha256, `${entry.id}: manifest and evidence disagree on the bytes`);
  assert.equal(evidence.frozenArtifact.byteLength, entry.byteLength, `${entry.id}: manifest and evidence disagree on the size`);
  assert.equal(evidence.frozenArtifact.externalArtifact, entry.externalArtifact, entry.id);
  assert.equal(evidence.privacyReview.decision, "eligible", entry.id);
  assert.equal(evidence.calibrationEvidenceEligible, false, entry.id);
  assert.match(entry.sha256, /^[0-9a-f]{64}$/u, `${entry.id}: recorded digest is not SHA-256`);
  // A residue corpus whose expectation carries no atomic residue would be about a different
  // property, and the six were admitted for exactly this one.
  assert.ok(entry.expected.fragmentainerResidue.atomicCount > 0, `${entry.id}: expectation names no table residue`);
  assert.equal(entry.expected.exitReason, "render-unstable", entry.id);
}
const digests = manifest.documents.map((entry) => entry.sha256);
assert.equal(new Set(digests).size, digests.length, "one artifact is admitted twice under two ids");
// The public substitute must exist, because it is what carries this property in CI.
assert.ok(existsSync(join(ROOT, "tests/fixtures/fragmentainer-residue.html")),
  "the public fixture named by this manifest is missing; nothing would test this class in CI");

const artifactRoot = argument("--artifact-root") ?? process.env[manifest.artifactRootEnvironmentVariable];
if (!artifactRoot) {
  console.log(
    `pagination-residue gate: SKIPPED — no ${manifest.artifactRootEnvironmentVariable}. ` +
    `${manifest.documents.length} document(s) are recorded by digest and were NOT read, so nothing ` +
    `about them is verified here. The class is covered in CI by ` +
    `tests/fixtures/fragmentainer-residue.html; see corpus/public/pagination-residue-v1/README.md.`,
  );
  process.exit(0);
}

// --- the private half, which softens nothing --------------------------------------------------
const artifacts = resolve(artifactRoot);
assert.ok(existsSync(artifacts) && statSync(artifacts).isDirectory(),
  `${manifest.artifactRootEnvironmentVariable} is not a directory: ${artifacts}`);
for (const resource of manifest.sharedResources) {
  const path = join(artifacts, resource.externalArtifact);
  assert.ok(existsSync(path), `shared resource missing from the artifact root: ${resource.externalArtifact}`);
  assert.equal(sha256(path), resource.sha256, `${resource.externalArtifact}: admitted bytes drifted`);
}

assert.ok(process.argv.includes("--cwd"), "--cwd is required; the CLI must not inherit this gate's checkout");
const cli = resolve(argument("--cli") ?? join(ROOT, "dist/cli/index.js"));
const cliCwd = resolve(argument("--cwd"));
assert.ok(existsSync(cliCwd) && statSync(cliCwd).isDirectory(), `CLI cwd is not a directory: ${cliCwd}`);
const temporary = mkdtempSync(join(tmpdir(), "breaklint-pagination-residue-gate-"));

try {
  for (const entry of manifest.documents) {
    const document = join(artifacts, entry.externalArtifact);
    assert.ok(existsSync(document), `${entry.id}: not in the artifact root as ${entry.externalArtifact}`);
    assert.equal(sha256(document), entry.sha256, `${entry.id}: admitted bytes drifted`);
    assert.equal(statSync(document).size, entry.byteLength, `${entry.id}: admitted size drifted`);

    const reportPath = join(temporary, `${entry.id}.json`);
    const run = spawnSync(process.execPath, [cli, "--format", "json", "--out", reportPath, document], {
      cwd: cliCwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180_000,
    });
    assert.equal(run.signal, null, `${entry.id}: process was terminated by ${run.signal}`);
    assert.equal(
      run.status,
      entry.expected.exitCode,
      `${entry.id}: CLI exited ${run.status}, expected ${entry.expected.exitCode}.\n` +
        `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
    );

    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    assert.equal(report.runVerdict, entry.expected.runVerdict, entry.id);
    const [documentReport] = report.documents;
    assert.equal(documentReport.exitReason, entry.expected.exitReason, entry.id);
    assert.equal(documentReport.snapshot ?? null, null, `${entry.id}: a withdrawn state stayed reportable`);
    assert.deepEqual(
      documentReport.infrastructure.map((event) => event.kind),
      entry.expected.infrastructureKinds,
      entry.id,
    );

    // The whole point. An exit 3 whose cause is not in the report is the state this corpus was
    // admitted to end: the reader has to be told WHICH elements, on WHICH pages, and by how far.
    const event = documentReport.infrastructure.find((item) => item.kind === entry.expected.exitReason);
    const residue = event.measured?.fragmentainerResidue;
    assert.ok(residue, `${entry.id}: the fatal event names no cause: ${JSON.stringify(event.measured)}`);
    assert.deepEqual(residue.pages, entry.expected.fragmentainerResidue.pages, entry.id);
    assert.equal(residue.count, entry.expected.fragmentainerResidue.count, entry.id);
    assert.equal(residue.atomicCount, entry.expected.fragmentainerResidue.atomicCount, entry.id);
    assert.equal(residue.pitchPx, entry.expected.fragmentainerResidue.pitchPx, entry.id);
    // Attributability is required of the TABLE residue and of nothing else. Source ids are injected
    // over a fixed element list, so a residual <span>, <strong>, <label> or <input> legitimately
    // carries none — measured on the appendix and on chapter 06. Demanding an id from those would
    // make this gate assert the injector's element list rather than the report's usefulness; the
    // table boxes decide the outcome and they are the ones that must be nameable.
    const tableResidue = residue.sample.filter((item) => item.display.startsWith("table"));
    assert.ok(tableResidue.length > 0, `${entry.id}: the sample carries no table residue at all`);
    assert.ok(
      tableResidue.every((item) => item.sourceId !== null),
      `${entry.id}: a residual table box carried no source id: ${JSON.stringify(tableResidue)}`,
    );
    assert.match(event.detail, /in an overflow column of page\(s\)/u, entry.id);
    // `driftSample` is the other half: which box entries moved, with both values. A component name
    // alone ("boxes") is every element of every page and answers nothing.
    assert.ok(Array.isArray(event.measured.driftSample) && event.measured.driftSample.length > 0,
      `${entry.id}: the drift is unnamed at the entry level`);
    console.log(
      `${entry.id}: exit ${run.status}, ${entry.expected.exitReason}, ` +
      `${residue.count} residual element(s) (${residue.atomicCount} atomic) on page(s) ${residue.pages.join(", ")}`,
    );
  }
  console.log(`pagination-residue gate: ${manifest.documents.length} document(s) named their cause`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
