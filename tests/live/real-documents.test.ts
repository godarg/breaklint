/**
 * Two structures every real paged document has sooner or later — a page Paged.js inserts for
 * parity, and footnotes — through the real browser, paginator, loopback server and rasteriser.
 *
 * Measured before the repair, with the real paginator (Paged.js 0.4.3, patched Chromium 141):
 *
 *   - `blank-right-running-header.html`: the inserted page 2 has no source block and so no mark,
 *     a page binds only on marks it carries, and required evidence is complete only when every page
 *     binds — so the default run (evidence binding on) ended exit 4, as every document with a
 *     parity-blank page did (G-78).
 *   - `footnotes-block.html`, `footnotes-inline.html`: the paired control run read the footnote
 *     call's per-run random `href` as a changed resource and ended the run
 *     `injection-interference` (exit 3) before any rule (G-79). Once through, the block notes'
 *     evidence marks were refused (6 unplaced on two pages, both pages unbound), and on
 *     `footnotes-named-page.html` the footnote was read as the end of the page's flow and made an
 *     overflow boundary inside a named-page chapter `forced` (exit 4: `layout/widow` below floor).
 *
 * The two negative controls must keep failing: `blank-generated-content.html` (a blank-marked
 * page that prints a sentence) at exit 4, `footnotes-planted-call.html` (a look-alike footnote
 * call) and `footnotes-sid-swap.html` (source ids swapped after pagination) at exit 3.
 *
 * WHAT ONLY CI CAN SETTLE. Every assertion on `bindsFinding`, on `evidenceCoverage` being complete
 * and on exit 0 needs a browser whose PDF carries the evidence marks. The Chromium 141 build these
 * repairs were developed on writes a PDF with no mark in it, so there nothing binds and those
 * assertions fail; they are placed last in each case, after everything that is observable on any
 * browser — including the blank-page decision itself, which reads the raster and the text layer
 * and not the marks.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { renderDocuments, type RenderResult } from "../../src/acquire/render-run.ts";
import { resolveBrowser, resolvePackageRoot } from "../../src/acquire/browser.ts";
import { coverageFloorMap, resolveConfig } from "../../src/config/resolve.ts";
import { exitCodeFor, runDocument, type DocumentInput } from "../../src/core/engine.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURES = join(REPO, "tests", "fixtures");
const optional = process.env.BREAKLINT_LIVE_OPTIONAL === "1";
const missing = [
  resolveBrowser().path ? null : "a browser",
  resolvePackageRoot("pagedjs", REPO) ? null : "pagedjs",
  resolvePackageRoot("pdfjs-dist", REPO) ? null : "pdfjs-dist",
].filter((value): value is string => value !== null);

const FIXTURE_ORDER = [
  "blank-right-running-header.html",
  "blank-generated-content.html",
  "footnotes-block.html",
  "footnotes-inline.html",
  "footnotes-planted-call.html",
  "footnotes-sid-swap.html",
  "footnotes-named-page.html",
  "footnotes-heading-in-note.html",
  "footnotes-clipped-max-height.html",
] as const;

/** The whole registry under the default profile, as the CLI runs it. */
function withProfile(document: DocumentInput) {
  const config = resolveConfig({ file: {}, cli: {} });
  return runDocument(document, {
    failOn: config.failOn, activeRules: config.activeRules, optionsByRule: config.optionsByRule,
    coverageFloors: coverageFloorMap(config),
  }).report;
}

/**
 * Why each page did or did not bind, for the failure message: every page's evidence record, every
 * mark's fate in the delivered PDF (found or not, merged into a neighbour or not, its offsets and
 * its residual against the page's reference) and every refused mark with the bound that refused
 * it. Only a browser whose PDF carries the marks can answer this, so it is printed where the
 * assertion that needs one fails — in CI.
 */
function whyUnbound(document: DocumentInput): string {
  const d = document.evidenceDiagnostics;
  const lines = (document.evidence ?? []).map((page) =>
    `page ${page.page}: bindsFinding=${page.bindsFinding} conformance=${JSON.stringify(page.conformance)}`);
  if (!d) return [...lines, "no mark diagnostics (the PDF text layer was not read)"].join("\n");
  for (const page of d.pages) {
    lines.push(`page ${page.page}: targets ${page.targetsBound}/${page.targetsTotal} bound, reference ${page.referenceDyMm} mm from ${page.referenceFrom}` +
      `${page.referenceOutOfRange ? " (out of range)" : ""}${page.divergent ? " DIVERGENT" : ""}, tolerance ${d.toleranceMm} mm`);
  }
  for (const mark of d.marks) {
    lines.push(`  ${mark.token} p${mark.page} ${mark.sid} ${mark.side}: hits=${mark.hits} mergedInto=${mark.containedIn} ` +
      `dx=${mark.dxMm} dy=${mark.dyMm} residual=${mark.residualDyMm} ${mark.bound ? "BOUND" : "unbound"}`);
  }
  for (const mark of d.unplaced) lines.push(`  refused p${mark.page} ${mark.sid} ${mark.side}: ${mark.detail ?? mark.reason}`);
  return lines.join("\n");
}

const fatal = (document: DocumentInput) =>
  document.infrastructure.filter((event) => !["geometry-cross-check-passed", "image-content-unavailable"].includes(event.kind));

describe("real-document structures, live", () => {
  let root = "";
  let result: RenderResult | null = null;

  const doc = (t: TestContext, name: (typeof FIXTURE_ORDER)[number]): DocumentInput | null => {
    if (result?.documents.length !== FIXTURE_ORDER.length) {
      t.skip(`the run stopped early, already reported by the first subtest: ${result?.documents.length ?? 0} documents`);
      return null;
    }
    return result.documents[FIXTURE_ORDER.indexOf(name)]!;
  };

  before(async () => {
    if (missing.length > 0) {
      if (optional) return;
      assert.fail(`this suite cannot run without: ${missing.join(", ")}. Set BREAKLINT_LIVE_OPTIONAL=1 to skip.`);
    }
    root = mkdtempSync(join(tmpdir(), "breaklint-real-documents-"));
    result = await renderDocuments(FIXTURE_ORDER.map((name) => join(FIXTURES, name)), {
      outDir: join(root, "evidence"),
      evidenceBinding: true,
      sourceMapInjection: true,
      network: { mode: "offline", allowed: [] },
      locale: "en-US",
    });
  });

  after(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("renders every fixture", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    assert.equal(result?.fatal ?? null, null);
    assert.equal(result?.documents.length, FIXTURE_ORDER.length,
      `the run stopped before every document: ${JSON.stringify(result?.documents.map((d) => d.infrastructure.map((e) => e.kind)))}`);
  });

  it("excuses a proven-blank `break-before: right` page from binding, declares it, and does not count it as bound", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const document = doc(t, "blank-right-running-header.html");
    if (!document) return;
    const snapshot = document.snapshot;
    assert.ok(snapshot, `no snapshot: ${JSON.stringify(document.infrastructure)}`);
    assert.equal(snapshot.pages.length, 3, "chapter one, the inserted left-hand page, chapter two");
    // Independent of the blank flag and of the block records: the measured fill of each page CONTENT.
    assert.deepEqual(snapshot.pages.map((page) => page.fill.net > 0), [true, false, true], "premise: page 2 has nothing in its content");
    assert.deepEqual(snapshot.pages.map((page) => page.blank), [false, true, false]);
    const blankRecord = document.evidence?.find((page) => page.page === 2);
    assert.equal(blankRecord?.conformance, null, "premise: the blank page carries no mark");
    assert.equal(blankRecord?.bindsFinding, false, "the blank page was counted as bound");
    // The blank-page decision: Paged.js' marker, the DOM page area, the PDF text layer and the PDF
    // raster of the page area — none of them the marks. Observable on any browser.
    assert.deepEqual(document.evidenceRequirement, { required: true, expectedPages: 3, blankPages: [2] },
      "the inserted page was not proven blank under its running header and page number");
    const report = withProfile(document);
    assert.ok(report.notMeasured.some((row) => row.scope === "page" && row.ruleId === null &&
      row.reason === "env/parity-blank-page" && row.target?.nodeKey === "page:2"), `undeclared: ${JSON.stringify(report.notMeasured)}`);
    assert.equal(report.evidenceCoverage?.expectedPages, 2);
    assert.deepEqual(report.findings.map((finding) => `${finding.ruleId}@${finding.page}`), []);
    // Everything below needs a browser whose PDF carries the marks (CI's current Chrome).
    assert.deepEqual(document.evidence?.map((page) => page.bindsFinding), [true, false, true]);
    assert.deepEqual(report.evidenceCoverage,
      { required: true, expectedPages: 2, writtenPages: 2, boundPages: 2, status: "complete", reason: null }, whyUnbound(document));
    assert.equal(exitCodeFor(report.verdict), 0, `${report.verdict}: ${report.exitReason}`);
  });

  it("does not excuse a blank-marked page that prints generated content (negative control)", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const document = doc(t, "blank-generated-content.html");
    if (!document) return;
    const snapshot = document.snapshot;
    assert.ok(snapshot, `no snapshot: ${JSON.stringify(document.infrastructure)}`);
    // The snapshot's own blank flag is fooled — generated content is not a text node — which is
    // exactly why it is not the witness the excuse rests on.
    assert.deepEqual(snapshot.pages.map((page) => page.blank), [false, true, false], "premise: the snapshot alone calls page 2 blank");
    assert.deepEqual(document.evidenceRequirement, { required: true, expectedPages: 3 }, "a page that prints a sentence was excused");
    const report = withProfile(document);
    assert.equal(report.notMeasured.some((row) => row.ruleId === null && row.reason === "env/parity-blank-page"), false);
    assert.equal(report.exitReason, "evidence/required-page-binding-incomplete");
    assert.equal(exitCodeFor(report.verdict), 4);
    // Needs a browser whose PDF carries the marks (CI's current Chrome): pages 1 and 3 bind.
    assert.deepEqual({ status: report.evidenceCoverage?.status, boundPages: report.evidenceCoverage?.boundPages, expectedPages: report.evidenceCoverage?.expectedPages },
      { status: "partial", boundPages: 2, expectedPages: 3 }, whyUnbound(document));
  });

  it("measures block footnotes on the page they are printed on, and marks them in the footnote area", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const document = doc(t, "footnotes-block.html");
    if (!document) return;
    assert.deepEqual(fatal(document), [], "the run did not reach the rules");
    const snapshot = document.snapshot;
    assert.ok(snapshot);
    const notes = ["fn-one", "fn-two", "fn-three"].map((id) => snapshot.blocks.filter((block) => block.authorId === id));
    assert.deepEqual(notes.map((records) => records.map((record) => record.page)), [[1], [1], [2]], "a footnote is not recorded once, on its page");
    for (const [record] of notes) {
      const box = snapshot.pages[record!.page - 1]!.contentBox;
      assert.ok(record!.box.y >= box.y + box.height - 0.5, `premise: ${record!.authorId} sits below the content box`);
    }
    // Both marks of every note are placed, the end mark of the note that ends on the footnote
    // area's bottom edge included: the footnote layer hangs in the page box, which does not clip.
    // Before round 1 both marks of every note were refused; in round 1 (layer in the clipping
    // footnote area) that end mark was refused.
    assert.deepEqual((document.evidence ?? []).flatMap((page) => page.unplacedMarks ?? []), [], whyUnbound(document));
    const report = withProfile(document);
    assert.deepEqual(report.findings.map((finding) => `${finding.ruleId}@${finding.page}`), []);
    // Everything below needs a browser whose PDF carries the marks (CI's current Chrome).
    assert.equal(report.evidenceCoverage?.status, "complete", `evidence: ${JSON.stringify(report.evidenceCoverage)}\n${whyUnbound(document)}`);
    assert.equal(exitCodeFor(report.verdict), 0, `${report.verdict}: ${report.exitReason}`);
  });

  it("measures inline footnotes, whose notes carry no source id of their own", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const document = doc(t, "footnotes-inline.html");
    if (!document) return;
    assert.deepEqual(fatal(document), [], "the run did not reach the rules");
    assert.ok(document.snapshot);
    assert.deepEqual((document.evidence ?? []).flatMap((page) => page.unplacedMarks ?? []), []);
    const report = withProfile(document);
    assert.deepEqual(report.findings.map((finding) => `${finding.ruleId}@${finding.page}`), []);
    // Everything below needs a browser whose PDF carries the marks (CI's current Chrome).
    assert.equal(report.evidenceCoverage?.status, "complete", `evidence: ${JSON.stringify(report.evidenceCoverage)}\n${whyUnbound(document)}`);
    assert.equal(exitCodeFor(report.verdict), 0, `${report.verdict}: ${report.exitReason}`);
  });

  it("still stops a look-alike footnote call that changes between runs (negative control)", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const document = doc(t, "footnotes-planted-call.html");
    if (!document) return;
    assert.equal(document.snapshot, null);
    const interference = document.infrastructure.filter((event) => event.kind === "injection-interference");
    assert.equal(interference.length, 1, JSON.stringify(document.infrastructure));
    assert.deepEqual((interference[0]!.measured as { changed: string[] }).changed, ["resources"]);
    assert.equal(exitCodeFor(withProfile(document).verdict), 3);
  });

  it("still stops source ids swapped after pagination on a footnote page (negative control)", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const document = doc(t, "footnotes-sid-swap.html");
    if (!document) return;
    assert.equal(document.snapshot, null);
    assert.ok(document.infrastructure.some((event) => event.kind === "checker-crashed" &&
      (event.measured as { stage?: string } | null)?.stage === "source-id-integrity"), JSON.stringify(document.infrastructure));
    assert.equal(exitCodeFor(withProfile(document).verdict), 3);
  });

  it("keeps an overflow boundary inside a named-page chapter an overflow when its page carries a footnote", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const document = doc(t, "footnotes-named-page.html");
    if (!document) return;
    assert.deepEqual(fatal(document), [], "the run did not reach the rules");
    const snapshot = document.snapshot;
    assert.ok(snapshot);
    assert.ok(snapshot.pages.length >= 2, "premise: the chapter runs over two pages");
    assert.ok(snapshot.blocks.some((block) => block.authorId === "fn-chapter" && block.page === 1), "premise: the footnote is on page 1");
    assert.equal(snapshot.pages[0]!.outgoingBreakCause.kind, "overflow", "the footnote turned the boundary into a forced break");
    const report = withProfile(document);
    assert.equal(report.notMeasured.some((row) => row.reason === "env/forced-break"), false, JSON.stringify(report.notMeasured));
    assert.ok(report.coverage["layout/widow"]?.ok, `widow coverage: ${JSON.stringify(report.coverage["layout/widow"])}`);
    assert.deepEqual(report.findings.map((finding) => `${finding.ruleId}@${finding.page}`), []);
    // Needs a browser whose PDF carries the marks (CI's current Chrome).
    assert.equal(report.evidenceCoverage?.status, "complete", `evidence: ${JSON.stringify(report.evidenceCoverage)}\n${whyUnbound(document)}`);
    assert.equal(exitCodeFor(report.verdict), 0, `${report.verdict}: ${report.exitReason}`);
  });

  it("does not report a heading printed inside a block footnote as stranded", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const document = doc(t, "footnotes-heading-in-note.html");
    if (!document) return;
    assert.deepEqual(fatal(document).filter((event) => event.kind !== "break-cause-undetermined"), [], "the run did not reach the rules");
    const snapshot = document.snapshot;
    assert.ok(snapshot);
    const headings = snapshot.blocks.filter((block) => block.authorId === "fn-heading");
    assert.ok(headings.length > 0, "premise: the note's heading is recorded");
    for (const heading of headings) {
      const box = snapshot.pages[heading.page - 1]!.contentBox;
      assert.ok(heading.box.y >= box.y + box.height - 0.5, `premise: the note's heading sits below the content box on page ${heading.page}`);
    }
    const report = withProfile(document);
    assert.deepEqual(report.findings.map((finding) => `${finding.ruleId}@${finding.page}: ${finding.message.slice(0, 60)}`), []);
    const rows = report.evaluations.filter((row) => row.ruleId === "layout/heading-at-page-bottom" &&
      headings.some((heading) => heading.nodeKey === row.targetRef.nodeKey));
    assert.deepEqual([...new Set(rows.map((row) => `${row.status}:${row.reason}`))], ["excluded:rule/target-outside-content-box"]);
    // A page that prints only the carried-over note is declined by the fill rule, not measured.
    for (const page of snapshot.pages.filter((p) => !snapshot.blocks.some((b) => b.page === p.pageNumber &&
      b.box.y < p.contentBox.y + p.contentBox.height && b.box.y + b.box.height > p.contentBox.y) && snapshot.blocks.some((b) => b.page === p.pageNumber))) {
      const row = report.evaluations.find((r) => r.ruleId === "layout/orphaned-continuation-page" && r.targetRef.nodeKey === page.nodeKey);
      assert.equal(row?.reason, "env/invalid-measurement", `page ${page.pageNumber}: ${JSON.stringify(row)}`);
    }
    // Needs a browser whose PDF carries the marks (CI's current Chrome).
    assert.equal(report.evidenceCoverage?.status, "complete", `evidence: ${JSON.stringify(report.evidenceCoverage)}\n${whyUnbound(document)}`);
    assert.equal(exitCodeFor(report.verdict), 0, `${report.verdict}: ${report.exitReason}`);
  });

  it("does not bind a page on which a footnote fragment is clipped away at the footnote area's edge", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const document = doc(t, "footnotes-clipped-max-height.html");
    if (!document) return;
    assert.deepEqual(fatal(document).filter((event) => event.kind !== "break-cause-undetermined"), [], "the run did not reach the rules");
    const snapshot = document.snapshot;
    assert.ok(snapshot);
    // Premise, observable on any browser: some footnote fragment starts inside the capped area's
    // last pixel, so its start mark is refused as well as its end mark.
    const refused = document.evidenceDiagnostics?.unplaced.filter((mark) => mark.footnote === true) ?? [];
    assert.ok(refused.some((mark) => mark.side === "start"), `no clipped footnote start: ${whyUnbound(document)}`);
    const clippedPages = [...new Set(refused.map((mark) => mark.page))];
    for (const page of clippedPages) {
      assert.equal(document.evidence?.find((record) => record.page === page)?.bindsFinding, false,
        `page ${page} bound a footnote fragment that is partly not printed`);
    }
    const report = withProfile(document);
    assert.equal(report.exitReason, "evidence/required-page-binding-incomplete");
    assert.equal(exitCodeFor(report.verdict), 4);
    // Needs a browser whose PDF carries the marks (CI's current Chrome): every page without a
    // refused footnote mark binds.
    assert.deepEqual({ status: report.evidenceCoverage?.status, boundPages: report.evidenceCoverage?.boundPages },
      { status: "partial", boundPages: snapshot.pages.length - clippedPages.length }, whyUnbound(document));
  });
});
