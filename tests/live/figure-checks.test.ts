/** Real built CLI, delivered PDF text, and authored expectations are independent seams. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, copyFileSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import type { Report } from "../../src/core/types.ts";
import { launchBrowser, resolvePackageRoot } from "../../src/acquire/browser.ts";
import * as renderRun from "../../src/acquire/render-run.ts";
import { PRIMITIVES_SOURCE, TEST_PRIMITIVES_CAPABILITY } from "../../src/measure/primitives.ts";
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
it("runtime-verifies figure index for data/inert scripts and fails closed on DOM-mutating scripts", () => {
  const inertDir = join(root, "runtime-inert"); mkdirSync(inertDir);
  symlinkSync(join(repo, "node_modules"), join(inertDir, "node_modules"));
  writeFileSync(join(inertDir, "doc.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Inert Script Figure</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article"}</script>
<style>@page { size: 120mm 140mm; margin: 10mm; } body { font: 14px/1.5 serif; } figure { margin: 0; } figcaption { break-before: page; }</style></head>
<body><p>See <a href="#fig-1">Figure 1</a> and <a href="#missing-fig" onclick="void 0">Figure 2</a>.</p>
<figure id="fig-1"><svg width="100" height="80"><rect width="100" height="80" fill="#eee"/></svg><figcaption>Figure 1: Inert test</figcaption></figure>
<script>window.__inertFlag = 1;</script></body></html>`);
  const inertRun = spawnSync(process.execPath, [
    join(repo, "dist/cli/index.js"), "--only", "figure/caption-separated,figure/dangling-reference",
    "--fail-on", "warn", "--format", "json", "--out", "report.json", "--out-dir", "evidence", "doc.html",
  ], { cwd: inertDir, encoding: "utf8", timeout: 300_000 });
  assert.equal(inertRun.status, 1, `${inertRun.stdout}${inertRun.stderr}`);
  const inertReport = JSON.parse(readFileSync(join(inertDir, "report.json"), "utf8")) as Report;
  assert.equal(inertReport.documents[0]!.coverage["figure/caption-separated"]!.measured, 1);
  assert.equal(inertReport.documents[0]!.coverage["figure/dangling-reference"]!.measured, 1);
  assert.equal(inertReport.findings.filter(f => f.ruleId === "figure/caption-separated").length, 1);
  assert.equal(inertReport.findings.filter(f => f.ruleId === "figure/dangling-reference").length, 1);
  assert.equal(inertReport.documents[0]!.notMeasured.some(n => n.reason === "env/figure-index-unavailable"), false);

  const mutDir = join(root, "runtime-mutating"); mkdirSync(mutDir);
  symlinkSync(join(repo, "node_modules"), join(mutDir, "node_modules"));
  writeFileSync(join(mutDir, "doc.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Mutating Script Figure</title>
<style>@page { size: 120mm 140mm; margin: 10mm; } body { font: 14px/1.5 serif; }</style></head>
<body><p>See <a href="#fig-1">Figure 1</a>.</p>
<figure id="fig-1"><svg width="80" height="60"><rect width="80" height="60" fill="#eee"/></svg><figcaption>Figure 1</figcaption></figure>
<script>const p = document.createElement("p"); p.id = "injected-target"; document.body.appendChild(p);</script></body></html>`);
  const mutRun = spawnSync(process.execPath, [
    join(repo, "dist/cli/index.js"), "--only", "figure/dangling-reference",
    "--fail-on", "warn", "--format", "json", "--out", "report.json", "--out-dir", "evidence", "doc.html",
  ], { cwd: mutDir, encoding: "utf8", timeout: 300_000 });
  assert.equal(mutRun.status, 4, `mutating script must decline figure index: ${mutRun.stdout}${mutRun.stderr}`);
  const mutReport = JSON.parse(readFileSync(join(mutDir, "report.json"), "utf8")) as Report;
  assert.ok(mutReport.documents[0]!.notMeasured.some(n => n.reason === "env/figure-index-unavailable"));
});
it("observes script mutations up to the guarded preview call and keeps a clean scripted figure verified (P3)", () => {
  const runCase = (name: string, script: string, expectedExit: number) => {
    const dir = join(root, name); mkdirSync(dir);
    symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"));
    writeFileSync(join(dir, "doc.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Guarded preview ${name}</title>
<style>@page { size: 120mm 140mm; margin: 10mm; } body { font: 14px/1.5 serif; } figure { margin: 0; }</style></head>
<body><p id="lead">See <a href="#fig-1">Figure 1</a>.</p>
<figure id="fig-1"><svg width="80" height="60"><rect width="80" height="60" fill="#eee"/></svg><figcaption>Figure 1: Guarded</figcaption></figure>
<p id="tail">End.</p><script>${script}</script></body></html>`);
    const res = spawnSync(process.execPath, [
      join(repo, "dist/cli/index.js"), "--only", "figure/dangling-reference",
      "--fail-on", "warn", "--format", "json", "--out", "report.json", "--out-dir", "evidence", "doc.html",
    ], { cwd: dir, encoding: "utf8", timeout: 300_000 });
    assert.equal(res.status, expectedExit, `${name}: ${res.stdout}${res.stderr}`);
    return JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as Report;
  };
  // Positive control: an inert script leaves the figure index runtime-verified and measured.
  const clean = runCase("guarded-clean", "window.__guardedClean = 1;", 0);
  assert.equal(clean.documents[0]!.coverage["figure/dangling-reference"]!.measured, 1);
  // Red control (CODE-PRINT-2): an attribute set by a timer after DOMContentLoaded on a
  // non-figure element. Only the mutation counter can see it (no element, id or link changes).
  const timer = runCase("guarded-timer-attribute",
    'document.addEventListener("DOMContentLoaded", () => setTimeout(() => document.getElementById("tail").setAttribute("data-state", "late"), 0));', 4);
  assert.ok(timer.documents[0]!.notMeasured.some(n => n.reason === "env/figure-index-unavailable"));
  // P5: the decline keeps its code and names the observed sub-cause.
  assert.ok(timer.documents[0]!.notMeasured.some(n => n.reason === "env/figure-index-unavailable"
    && /^script mutated DOM: [1-9]\d* records? before pagination$/u.test((n as { detail?: string }).detail ?? "")), JSON.stringify(timer.documents[0]!.notMeasured));
  // The window between apparatus install and preview() (CDX-11) cannot be hit deterministically by
  // a page script through the CLI (print media change events only fire on a rendering update, and
  // then again during page.pdf()); the next test drives that window directly.
  // Red control (CODE-PRINT-2b): the page stops DOMContentLoaded at window capture, then rewrites
  // caption text. Parse-end detection must not depend on a listener the page can suppress.
  const suppressed = runCase("guarded-suppressed-dcl",
    'window.addEventListener("DOMContentLoaded", e => e.stopImmediatePropagation(), true); window.addEventListener("load", () => { document.querySelector("figcaption").firstChild.data = "Figure 9: rewritten"; });', 4);
  assert.ok(suppressed.documents[0]!.notMeasured.some(n => n.reason === "env/figure-index-unavailable"));
});
it("counts mutations between apparatus install and the guarded preview call, including pending records (P3)", async () => {
  const pagedjs = readFileSync(join(resolvePackageRoot("pagedjs", repo)!, "dist", "paged.js"), "utf8");
  const launched = await launchBrowser(repo);
  assert.ok(launched.browser, launched.detail);
  const browser = launched.browser;
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Window</title></head><body>' +
    '<p id="lead">See <a href="#fig-1">Figure 1</a>.</p><figure id="fig-1"><svg width="80" height="60"><rect width="80" height="60"/></svg>' +
    '<figcaption>Figure 1</figcaption></figure><p id="tail">End.</p></body></html>';
  // The test plays the page script: it mutates in the window after the apparatus is installed
  // and before Paged.js starts, which is where print-media handlers and timers can act.
  const run = async (mutate: string, beforePreview: string) => {
    const page = await browser.newPage();
    try {
      await (page as unknown as { evaluateOnNewDocument(s: string): Promise<unknown> }).evaluateOnNewDocument(PRIMITIVES_SOURCE);
      await (page as unknown as { evaluateOnNewDocument(s: string): Promise<unknown> }).evaluateOnNewDocument(renderRun.integritySource([]));
      await page.goto(`data:text/html,${encodeURIComponent(html)}`, { waitUntil: "load", timeout: 30_000 });
      await page.evaluate<void>(renderRun.paginationBundleSource(pagedjs));
      await page.evaluate<void>(renderRun.paginationApparatusSource(TEST_PRIMITIVES_CAPABILITY, { figureTree: true }));
      if (mutate) await page.evaluate<void>(mutate);
      const preview = await page.evaluate<{ paginationError: string | null }>(`(async () => { ${beforePreview} try { await new Paged.Previewer().preview(); return { paginationError: null }; } catch (error) { return { paginationError: String(error) }; } })()`);
      assert.equal(preview.paginationError, null);
      const status = await page.evaluate<renderRun.RuntimeIntegrityStatus>(renderRun.integrityStatusSource(TEST_PRIMITIVES_CAPABILITY));
      const probe = (renderRun as { integrityPreviewFigureTreeSource?: (capability: string) => string }).integrityPreviewFigureTreeSource;
      const tree = probe ? await page.evaluate<{ ids: Record<string, number> } | null>(probe(TEST_PRIMITIVES_CAPABILITY)) : null;
      return { status, tree };
    } finally { await page.close(); }
  };
  try {
    // Positive control: no author mutation, counter stays zero and the preview-time tree is read.
    const clean = await run("", "");
    assert.equal(clean.status.prePaginationScriptMutations, 0);
    assert.equal(clean.status.paginationPreviewCalls, 1);
    // Red control: an id rename in the window after install (CDX-11).
    const renamed = await run('document.getElementById("fig-1").id = "fig-renamed"', "");
    assert.ok((renamed.status.prePaginationScriptMutations ?? 0) > 0, `renamed: ${renamed.status.prePaginationScriptMutations}`);
    // Red control: a mutation still pending as an observer record when preview() is called.
    const pending = await run("", 'document.getElementById("tail").setAttribute("data-state", "pending");');
    assert.ok((pending.status.prePaginationScriptMutations ?? 0) > 0, `pending: ${pending.status.prePaginationScriptMutations}`);
    // The last tree probe runs synchronously inside the guarded preview call.
    assert.deepEqual(clean.tree?.ids, { "fig-1": 1, lead: 1, tail: 1 });
    assert.equal(renamed.tree?.ids["fig-renamed"], 1);
  } finally { await browser.close(); }
});
it("treats <foreignObject> HTML as part of its SVG in source index, runtime probe and snapshot (P9)", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const runFo = (name: string, extraBody: string, script: string, expectedExit: number) => {
    const dir = join(root, name); mkdirSync(dir);
    symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"));
    writeFileSync(join(dir, "doc.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>foreignObject ${name}</title>
<style>@page { size: 120mm 140mm; margin: 10mm; } body { font: 14px/1.5 serif; } figure { margin: 0; } .print-variant { display: none; }</style></head>
<body><p>See <a href="#fo-fig">Figure 1</a>.</p>
<figure id="fo-fig"><svg class="screen-variant" width="160" height="80" viewBox="0 0 160 80"><rect width="160" height="80" fill="#ddd"/>
<foreignObject x="10" y="10" width="40" height="40"><img xmlns="http://www.w3.org/1999/xhtml" src="${png}" width="20" height="20" alt=""/></foreignObject></svg>
<svg class="print-variant" width="160" height="80"><rect width="160" height="80" fill="#ccc"/></svg>${extraBody}
<figcaption>Figure 1: SVG with embedded HTML</figcaption></figure>${script}</body></html>`);
    const res = spawnSync(process.execPath, [
      join(repo, "dist/cli/index.js"), "--only", "figure/caption-separated,figure/dangling-reference",
      "--fail-on", "warn", "--format", "json", "--out", "report.json", "--out-dir", "evidence", "doc.html",
    ], { cwd: dir, encoding: "utf8", timeout: 300_000 });
    assert.equal(res.status, expectedExit, `${name}: ${res.stdout}${res.stderr}`);
    return JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as Report;
  };
  // Without scripts: static source index and snapshot must agree that the img belongs to the SVG.
  const plain = runFo("foreign-object-static", "", "", 0);
  assert.equal(plain.documents[0]!.coverage["figure/caption-separated"]!.measured, 1, JSON.stringify(plain.documents[0]!.notMeasured));
  assert.equal(plain.documents[0]!.coverage["figure/dangling-reference"]!.measured, 1);
  // With an inert script: the runtime probe must agree as well.
  const scripted = runFo("foreign-object-scripted", "", "<script>window.__fo = 1;</script>", 0);
  assert.equal(scripted.documents[0]!.coverage["figure/caption-separated"]!.measured, 1, JSON.stringify(scripted.documents[0]!.notMeasured));
  // Negative control: an img that is a real second body (outside the SVG) still declines.
  const second = runFo("foreign-object-second-body", `<img src="${png}" width="20" height="20" alt="">`, "", 4);
  assert.ok(second.documents[0]!.notMeasured.some(n => n.reason === "env/figure-body-unsupported"), JSON.stringify(second.documents[0]!.notMeasured));
});
it("measures responsive dual-SVG figures when one variant is display:none and fails closed otherwise", () => {
  const runInline = (name: string, html: string, expectedExit: number) => {
    const dir = join(root, name); mkdirSync(dir);
    symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"));
    writeFileSync(join(dir, "doc.html"), html);
    const res = spawnSync(process.execPath, [
      join(repo, "dist/cli/index.js"), "--only", "figure/caption-separated",
      "--fail-on", "warn", "--format", "json", "--out", "report.json", "--out-dir", "evidence", "doc.html",
    ], { cwd: dir, encoding: "utf8", timeout: 300_000 });
    assert.equal(res.status, expectedExit, `${name}: ${res.stdout}${res.stderr}`);
    return JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as Report;
  };
  const bodyHtml = `<figure id="resp-fig">
    <svg class="fig-wide" width="160" height="70"><rect width="160" height="70" fill="#ddd"/><text x="10" y="30">WIDE</text></svg>
    <svg class="fig-narrow" width="80" height="120"><rect width="80" height="120" fill="#ccc"/><text x="10" y="30">NARROW</text></svg>
    <figcaption>Figure 1: Responsive dual-SVG test</figcaption>
  </figure>`;

  // Green/finding control: wide visible, narrow display:none, caption forced to page 2 -> Exit 1, measured=1
  const separated = runInline("responsive-separated", `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Responsive Separated</title>
<style>@page { size: 120mm 140mm; margin: 10mm; } body { font: 14px/1.5 serif; } figure { margin: 0; } .fig-narrow { display: none; } figcaption { break-before: page; }</style></head>
<body>${bodyHtml}</body></html>`, 1);
  assert.equal(separated.documents[0]!.coverage["figure/caption-separated"]!.measured, 1);
  assert.equal(separated.findings.length, 1);
  assert.equal(separated.findings[0]!.evidence.bindsFinding, true);

  // Clean control with inert script: verifies runtime figure tree parity with bodyCandidates -> Exit 0, measured=1
  const clean = runInline("responsive-clean-script", `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Responsive Clean</title>
<style>@page { size: 120mm 140mm; margin: 10mm; } body { font: 14px/1.5 serif; } figure { margin: 0; } .fig-narrow { display: none; }</style></head>
<body>${bodyHtml}<script>window.__inertResponsive = true;</script></body></html>`, 0);
  assert.equal(clean.documents[0]!.coverage["figure/caption-separated"]!.measured, 1);
  assert.deepEqual(clean.findings, []);

  // Fail-closed red control 1: both SVGs visible -> Exit 4, env/figure-body-unsupported
  const bothVisible = runInline("responsive-both-visible", `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Responsive Both Visible</title>
<style>@page { size: 120mm 140mm; margin: 10mm; } body { font: 14px/1.5 serif; } figure { margin: 0; }</style></head>
<body>${bodyHtml}</body></html>`, 4);
  assert.equal(bothVisible.documents[0]!.coverage["figure/caption-separated"]!.measured, 0);
  assert.ok(bothVisible.documents[0]!.notMeasured.some(n => n.reason === "env/figure-body-unsupported"));

  // Fail-closed red control 2: narrow hidden via opacity:0 instead of display:none -> Exit 4, env/figure-body-unsupported
  const opacityHidden = runInline("responsive-opacity-hidden", `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Responsive Opacity Hidden</title>
<style>@page { size: 120mm 140mm; margin: 10mm; } body { font: 14px/1.5 serif; } figure { margin: 0; } .fig-narrow { opacity: 0; }</style></head>
<body>${bodyHtml}</body></html>`, 4);
  assert.equal(opacityHidden.documents[0]!.coverage["figure/caption-separated"]!.measured, 0);
  assert.ok(opacityHidden.documents[0]!.notMeasured.some(n => n.reason === "env/figure-body-unsupported"));

  // Mixed responsive controls: table visible + display:none SVG, SVG visible + display:none table, and caption-between-candidates decline
  const tableVisible = runInline("responsive-table-visible", `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Responsive Table Visible</title>
<style>@page { size: 120mm 140mm; margin: 10mm; } body { font: 14px/1.5 serif; } figure { margin: 0; } .fig-narrow { display: none; } figcaption { break-before: page; }</style></head>
<body><figure id="resp-tbl"><table class="fig-wide"><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table><svg class="fig-narrow" width="80" height="120"><rect width="80" height="120" fill="#ccc"/><text x="10" y="30">NARROW</text></svg><figcaption>Figure 2: Table visible</figcaption></figure></body></html>`, 1);
  assert.equal(tableVisible.documents[0]!.coverage["figure/caption-separated"]!.measured, 1);
  assert.equal(tableVisible.findings.length, 1);

  const svgVisibleTableHidden = runInline("responsive-svg-table-hidden", `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Responsive SVG Table Hidden</title>
<style>@page { size: 120mm 140mm; margin: 10mm; } body { font: 14px/1.5 serif; } figure { margin: 0; } .fig-narrow { display: none; } figcaption { break-before: page; }</style></head>
<body><figure id="resp-svg-tbl"><svg class="fig-wide" width="160" height="70"><rect width="160" height="70" fill="#ddd"/><text x="10" y="30">WIDE</text></svg><table class="fig-narrow"><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table><figcaption>Figure 3: SVG visible</figcaption></figure></body></html>`, 1);
  assert.equal(svgVisibleTableHidden.documents[0]!.coverage["figure/caption-separated"]!.measured, 1);
  assert.equal(svgVisibleTableHidden.findings.length, 1);

  const captionBetween = runInline("responsive-caption-between", `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Responsive Caption Between</title>
<style>@page { size: 120mm 140mm; margin: 10mm; } body { font: 14px/1.5 serif; } figure { margin: 0; } .fig-narrow { display: none; } figcaption { break-before: page; }</style></head>
<body><figure id="resp-between"><table class="fig-wide"><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table><figcaption>Figure 4: Caption between</figcaption><svg class="fig-narrow" width="80" height="120"><rect width="80" height="120" fill="#ccc"/><text x="10" y="30">NARROW</text></svg></figure></body></html>`, 4);
  assert.equal(captionBetween.documents[0]!.coverage["figure/caption-separated"]!.measured, 0);
  assert.ok(captionBetween.documents[0]!.notMeasured.some(n => n.reason === "env/figure-body-unsupported"));
});
after(() => { if (process.env.BREAKLINT_FIGURE_LIVE_KEEP !== "1") rmSync(root, { recursive: true, force: true }); });
});
