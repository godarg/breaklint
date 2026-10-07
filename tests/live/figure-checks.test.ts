/** Real built CLI, delivered PDF text, and authored expectations are independent seams. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, copyFileSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import type { Report } from "../../src/core/types.ts";
const repo = fileURLToPath(new URL("../..", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "breaklint-figure-live-"));
const expected = JSON.parse(readFileSync(join(repo, "tests/fixtures/figures/expected.json"), "utf8")) as {
  cases: { fixture: string; captionCandidates: number; captionMeasured: number; captionFindings: number; independentPdfPaperClassification: string; independentPdfTextOracle: Record<string, number> }[];
  referenceFixture: { fixture: string; candidates: number; measured: number; declined: number; findings: number };
};
function run(fixture: string, id: string, expectedExit: number) {
  const cwd = join(root, fixture.replace(".html", "")); mkdirSync(cwd);
  symlinkSync(join(repo, "node_modules"), join(cwd, "node_modules"));
  copyFileSync(join(repo, "tests/fixtures/figures", fixture), join(cwd, "doc.html"));
  const argv = [join(repo, "dist/cli/index.js"), "--only", id, "--fail-on", "warn", "--format", "json", "--out", "report.json", "--out-dir", "evidence", "doc.html"];
  const native = spawnSync(process.execPath, argv, { cwd, encoding: "utf8", timeout: 300_000 });
  const exitCode = native.status;
  writeFileSync(join(cwd, "stdout.txt"), native.stdout); writeFileSync(join(cwd, "stderr.txt"), native.stderr);
  writeFileSync(join(cwd, "native-exit.json"), JSON.stringify({ argv, exitCode, signal: native.signal, node: process.version }));
  assert.equal(exitCode, expectedExit, `${fixture}: ${native.stdout}${native.stderr}`);
  const report = JSON.parse(readFileSync(join(cwd, "report.json"), "utf8")) as Report;
  const pdfs = readdirSync(join(cwd, "evidence")).filter(name => name.endsWith("-checked.pdf"));
  assert.equal(pdfs.length, 1);
  console.log(`retained evidence: ${cwd}`);
  return { cwd, report, pdf: join(cwd, "evidence", pdfs[0]!) };
}
describe("source-bound figure checks, live", () => {
before(() => {
  // The ordered release gate runs live checks before its later standalone build.
  const argv = ["run", "build"];
  const native = spawnSync("npm", argv, { cwd: repo, encoding: "utf8" });
  const exitCode = native.status;
  writeFileSync(join(root, "build.stdout.txt"), native.stdout ?? "");
  writeFileSync(join(root, "build.stderr.txt"), native.stderr ?? "");
  writeFileSync(join(root, "build-native-exit.json"), JSON.stringify({ argv, exitCode, signal: native.signal, error: native.error?.message, node: process.version }));
  console.log(`retained build evidence: ${root}`);
  assert.equal(exitCode, 0, `real CLI build failed: ${native.stdout}${native.stderr}${native.error?.message ?? ""}`);
});
for (const oracle of expected.cases) it(`caption placement and PDF witness: ${oracle.fixture}`, () => {
  const { cwd, report, pdf } = run(oracle.fixture, "figure/caption-separated", oracle.captionFindings ? 1 : 0);
  const coverage = report.documents[0]!.coverage["figure/caption-separated"]!;
  assert.deepEqual([coverage.candidates, coverage.measured, report.findings.length], [oracle.captionCandidates, oracle.captionMeasured, oracle.captionFindings]);
  for (const finding of report.findings) {
    assert.equal(finding.ruleId, "figure/caption-separated"); assert.ok(finding.source); assert.equal(finding.target.sid, "s0001");
    assert.equal(finding.evidence.bindsFinding, true);
  }
  const size = spawnSync("pdfinfo", ["-f", "1", "-l", String(report.pagesAnalysed), pdf], { encoding: "utf8" });
  const sizeCode = size.status;
  writeFileSync(join(cwd, "pdf-info.stdout.txt"), size.stdout); writeFileSync(join(cwd, "pdf-info.stderr.txt"), size.stderr);
  writeFileSync(join(cwd, "pdf-info-exit.json"), JSON.stringify({ exitCode: sizeCode }));
  assert.equal(sizeCode, 0, size.stderr);
  const sizes = [...size.stdout.matchAll(/^Page\s+\d+\s+size:\s+([0-9.]+) x ([0-9.]+) pts \(([^)]+)\)/gmu)]
    .map(match => ({ points: [Number(match[1]), Number(match[2])], paper: match[3] }));
  assert.equal(sizes.length, report.pagesAnalysed);
  for (const pageSize of sizes) assert.equal(pageSize.paper, oracle.independentPdfPaperClassification, "independent delivered PDF paper classification");
  writeFileSync(join(cwd, "pdf-page-sizes.json"), JSON.stringify(sizes));
  const native = spawnSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8" });
  const nativeExit = native.status;
  writeFileSync(join(cwd, "pdf-text.stdout.txt"), native.stdout); writeFileSync(join(cwd, "pdf-text.stderr.txt"), native.stderr);
  writeFileSync(join(cwd, "pdf-text-exit.json"), JSON.stringify({ exitCode: nativeExit }));
  assert.equal(nativeExit, 0, native.stderr);
  const pages = native.stdout.split("\f");
  for (const [marker, page] of Object.entries(oracle.independentPdfTextOracle)) {
    assert.deepEqual(pages.flatMap((text, i) => text.includes(marker) ? [i + 1] : []), [page], `independent PDF placement: ${marker}`);
  }
});
it("local href groups through the real source/evidence/CLI path", () => {
  const oracle = expected.referenceFixture; const { report } = run(oracle.fixture, "figure/dangling-reference", 1);
  const coverage = report.documents[0]!.coverage["figure/dangling-reference"]!;
  assert.deepEqual([coverage.candidates, coverage.measured, report.findings.length], [oracle.candidates, oracle.measured, oracle.findings]);
  assert.equal(report.findings[0]!.measurement.value, 2); assert.ok(report.findings[0]!.source);
  assert.equal(report.findings[0]!.evidence.bindsFinding, true);
  assert.ok(report.documents[0]!.notMeasured.some(n => n.reason === "env/figure-reference-ambiguous" && n.count === oracle.declined));
});
after(() => { if (process.env.BREAKLINT_FIGURE_LIVE_KEEP !== "1") rmSync(root, { recursive: true, force: true }); });
});
