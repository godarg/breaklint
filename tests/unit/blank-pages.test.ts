/**
 * A page Paged.js inserts for parity carries nothing to bind — and that has to be PROVEN, never
 * assumed, before it may stop blocking required evidence.
 *
 * THE DEFECT (G-78). A page binds only on the marks it carries (`src/render/evidence.ts`) and
 * required evidence is complete only when every page binds (`src/core/engine.ts`). The blank page
 * a `break-before: right`/`left`/`recto`/`verso` inserts has no source block and so no mark, so
 * every document with one ended `insufficient-coverage` (exit 4) under evidence binding, the
 * default — measured on `blank-right-running-header.html` and `margin-running-parity.html`
 * (evidence records `[true, false, true]` in CI, `[false, false, false]` locally where nothing
 * binds, and the blank page's record with `conformance: null` in both).
 *
 * THE DESIGN UNDER TEST. The page is not counted as bound. It is excused from the requirement,
 * with a declared `env/parity-blank-page` decline, only when (1) Paged.js marked it blank, (2) its
 * page area is exactly the empty template in the DOM, (3) the delivered PDF's text layer has no
 * text inside the page area, (4) the delivered PDF's raster of the page area is one flat colour,
 * and (5) the snapshot, independently, calls the page blank and has no block on it. The running
 * header and the page number in the margin boxes of a blank page are expected and do not count:
 * membership is decided by the page structure, not by coordinates.
 *
 * WHAT IS REAL HERE. The page tree is hand-authored in the structure Paged.js 0.4.3 produces — the
 * blank page's area as read back from the live fixture on 2026-09-25 (`pagedPage({ blank: true })`
 * in `tests/fixtures/paged-dom.ts`). The overlay payload, `SNAPSHOT_SOURCE`, the collector,
 * `assembleSnapshot`, `produceEvidence`, `finalizeEvidenceAcquisition` and `runDocument` are the
 * production code. The PDF is faked (`tests/fixtures/evidence-harness.ts`).
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { finalizeEvidenceAcquisition } from "../../src/acquire/render-run.ts";
import { coverageFloorMap, resolveConfig } from "../../src/config/resolve.ts";
import { exitCodeFor, runDocument, type DocumentInput } from "../../src/core/engine.ts";
import type { Evidence, Snapshot } from "../../src/core/types.ts";
import { assembleSnapshot, buildSourceModel, inputIdentity, SNAPSHOT_SOURCE, validateSnapshotInvariants, type RawSnapshot } from "../../src/measure/snapshot.ts";
import { COLLECTOR_SOURCE, type CollectorResult } from "../../src/paginate/collector.ts";
import { PAGE_AREA_EMPTY_SOURCE } from "../../src/paginate/pagedjs-structure.ts";
import { produceEvidence, verifyBlankPage, type BlankPageInput } from "../../src/render/evidence.ts";
import type { OverlayPageFacts } from "../../src/render/overlay.ts";
import { injectSourceIds } from "../../src/source/inject.ts";
import { faithfulRasterizer, OverlayPage, RASTER, textAt, type FaithfulPdf } from "../fixtures/evidence-harness.ts";
import { evaluatePayload, pagedDocument, pagedPage, runCollector, type FakeNode } from "../fixtures/paged-dom.ts";

/** Page geometry measured for a 150 x 120 mm page with 15 mm margins, pages 700 px apart. */
const STRIDE = 700;
const LINE = 18.66;
const pageBox = (index: number) => [0, index * STRIDE, 566.93, 453.54] as const;
const contentBox = (index: number) => [56.69, 56.69 + index * STRIDE, 453.53, 340.16] as const;
const lineBox = (index: number, line: number) => `56.69 ${56.69 + index * STRIDE + line * LINE} 453.53 ${LINE}`;

const SOURCE = `<!doctype html><html lang="en"><body>
<p class="title" id="running-title">A running header on every page, the blank one included</p>
<h2 id="chapter-one">Chapter one</h2>
<p id="c1p1">Chapter one opens on the first page.</p>
<p id="c1p2">Its second paragraph stays on that page.</p>
<h2 class="right" id="chapter-two">Chapter two</h2>
<p id="c2p1">Chapter two starts on page 3.</p>
</body></html>`;

function sids(): { injected: ReturnType<typeof injectSourceIds>; sid: Record<string, string> } {
  const injected = injectSourceIds(SOURCE, "blank.html");
  const sid: Record<string, string> = {};
  for (const [id, ref] of Object.entries(injected.map)) {
    const author = /\bid="([^"]+)"/u.exec(SOURCE.slice(ref.offset, ref.offset + 200))?.[1];
    if (author) sid[author] = id;
  }
  return { injected, sid };
}

/**
 * Three pages: chapter one, the page Paged.js inserted for `break-before: right`, chapter two. The
 * running header is cloned into the top-centre margin box of all three and every page prints its
 * number in the bottom-centre box. `page2` replaces the inserted page, for the negative controls.
 */
function document(sid: Record<string, string>, page2?: Parameters<typeof pagedPage>[0]): FakeNode {
  const header = (index: number) =>
    `<p class="title" id="running-title" data-bl-sid="${sid["running-title"]}" data-ref="ref-title" ` +
    `data-test-box="56.69 ${19.02 + index * STRIDE} 453.53 ${LINE}">A running header on every page, the blank one included</p>`;
  const margins = (index: number) => ({ "top-center": header(index), "bottom-center": String(index + 1) });
  const p = (id: string, tag: string, text: string, index: number, line: number, extra = "") =>
    `<${tag} id="${id}" data-bl-sid="${sid[id]}" data-ref="ref-${id}" ${extra} data-test-box="${lineBox(index, line)}">${text}</${tag}>`;
  return pagedDocument([
    pagedPage({
      pageBox: pageBox(0), contentBox: contentBox(0), margins: margins(0),
      content:
        `<p class="title" id="running-title" data-bl-sid="${sid["running-title"]}" data-ref="ref-title" style="display: none;">A running header on every page, the blank one included</p>` +
        p("chapter-one", "h2", "Chapter one", 0, 0) + p("c1p1", "p", "Chapter one opens on the first page.", 0, 1) +
        p("c1p2", "p", "Its second paragraph stays on that page.", 0, 2),
    }),
    pagedPage(page2 ?? { pageBox: pageBox(1), contentBox: contentBox(1), margins: margins(1), content: "", blank: true }),
    pagedPage({
      pageBox: pageBox(2), contentBox: contentBox(2), margins: margins(2), pageAttributes: 'data-break-before="right"',
      content: p("chapter-two", "h2", "Chapter two", 2, 0, 'class="right" data-break-before="right"') +
        p("c2p1", "p", "Chapter two starts on page 3.", 2, 1),
    }),
  ]);
}

function assemble(doc: FakeNode, injected: ReturnType<typeof injectSourceIds>): Snapshot {
  const snapshot = assembleSnapshot({
    raw: evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, doc),
    collector: runCollector<CollectorResult>(COLLECTOR_SOURCE, doc),
    sourceModel: buildSourceModel(injected.html, "blank.html"),
    sourceMap: injected.map,
    sourceMapInjection: true,
    renderer: "fake", browserVersion: "fake", pagedjsVersion: "0.4.3", platform: "test", locale: "en-US",
    freezeSignature: "fake", freezeRetries: 0,
    inputIdentity: inputIdentity({ html: injected.html, browserVersion: "fake", platform: "test", fontFamilies: [], resources: [] }),
    evidenceOverlayApplied: true,
    resources: [],
  });
  const invariants = validateSnapshotInvariants(snapshot, { sourceMapInjection: true });
  assert.equal(invariants.ok, true, invariants.issues.join("; "));
  return snapshot;
}

/** Margin text every page of the PDF carries: the header at 5 mm, the page number at 113 mm. */
const MARGIN_TEXT = (pages: number) => Object.fromEntries(Array.from({ length: pages }, (_, i) =>
  [i + 1, [textAt("A running header on every page, the blank one included", 36, 5), textAt(String(i + 1), 75, 113)]]));

function areaEmpty(doc: FakeNode, pageIndex: number): boolean {
  return evaluatePayload<boolean>(
    `(${PAGE_AREA_EMPTY_SOURCE})(window.__blPrimitives, window.__blPrimitives.all(document, ".pagedjs_page")[${pageIndex}])`, doc);
}

describe("a parity-blank page is excused from binding only when it is proven empty", () => {
  let outDir = "";
  beforeEach(() => { outDir = mkdtempSync(join(tmpdir(), "breaklint-blank-pages-")); });
  afterEach(() => { rmSync(outDir, { recursive: true, force: true }); });

  let runs = 0;
  const run = async (doc: FakeNode, injected: ReturnType<typeof injectSourceIds>, pdf: Omit<FaithfulPdf, "pages">) => {
    const snapshot = assemble(doc, injected);
    const page = new OverlayPage(doc);
    const evidence = await produceEvidence({
      page, closePage: async () => page.close(),
      rasterizer: faithfulRasterizer(page, { pages: snapshot.pages.length, extraText: MARGIN_TEXT(snapshot.pages.length), ...pdf }),
      options: { outDir, documentKey: `blank-${runs++}`, binding: true },
    });
    const input: DocumentInput = finalizeEvidenceAcquisition("blank.html", snapshot, [], evidence, true);
    const config = resolveConfig({ file: {}, cli: {} });
    const report = runDocument(input, {
      failOn: config.failOn, activeRules: config.activeRules, optionsByRule: config.optionsByRule,
      coverageFloors: coverageFloorMap(config),
    }).report;
    return { snapshot, evidence, installation: page.installation!, report };
  };

  it("excuses the inserted page under a running header and a page number, declares it, and binds the rest", async () => {
    const { injected, sid } = sids();
    const asked: NonNullable<FaithfulPdf["asked"]> = [];
    const { snapshot, evidence, installation, report } = await run(document(sid), injected, { asked });
    assert.deepEqual(snapshot.pages.map((page) => page.blank), [false, true, false], "premise: the snapshot calls page 2 blank");
    assert.equal(installation.marks.some((mark) => mark.page === 2), false, "premise: page 2 carries no mark");
    assert.deepEqual(installation.pageFacts?.map((facts) => [facts.pagedBlank, facts.areaEmpty]),
      [[false, false], [true, true], [false, false]]);
    // The raster was asked about the page AREA only — rounded inward to whole pixels — never about
    // the margin boxes where the header and the page number are printed.
    assert.deepEqual(asked, [{ page: 2, region: { x0: 57, y0: 57, x1: 510, y1: 396 } }]);
    assert.deepEqual(evidence.verifiedBlankPages, [2]);
    // Not bound: the page's own record says it evidences nothing.
    assert.deepEqual(report.evidence.map((page: Evidence) => [page.bindsFinding, page.pdfConformance]),
      [[true, "verified"], [false, "unverified"], [true, "verified"]]);
    assert.deepEqual(report.evidenceCoverage, {
      required: true, expectedPages: 2, writtenPages: 2, boundPages: 2, status: "complete", reason: null,
    });
    assert.ok(report.notMeasured.some((row) =>
      row.scope === "page" && row.ruleId === null && row.reason === "env/parity-blank-page" &&
      row.target?.nodeKey === "page:2" && row.count === 1), `the excuse is not declared: ${JSON.stringify(report.notMeasured)}`);
    assert.equal(report.pages, 3);
    assert.equal(report.verdict, "clean");
    assert.equal(exitCodeFor(report.verdict), 0);
  });

  it("does not excuse the page when the raster shows ink inside its page area", async () => {
    const { injected, sid } = sids();
    const { evidence, report } = await run(document(sid), injected, { ink: { 2: 1 } });
    assert.deepEqual(evidence.verifiedBlankPages, []);
    assert.equal(report.evidenceCoverage?.status, "partial");
    assert.equal(report.evidenceCoverage?.expectedPages, 3);
    assert.equal(report.notMeasured.some((row) => row.reason === "env/parity-blank-page" && row.ruleId === null), false);
    assert.equal(exitCodeFor(report.verdict), 4);
  });

  it("does not excuse the page when the PDF has text inside its page area, although the DOM area is empty", async () => {
    // Generated content — `.pagedjs_blank_page .pagedjs_page_content::after { content: "…" }` —
    // is printed without ever being a DOM node. Here it is invisible ink (none on the raster) but
    // still text in the PDF.
    const { injected, sid } = sids();
    const { evidence, report } = await run(document(sid), injected, {
      extraText: { ...MARGIN_TEXT(3), 2: [...MARGIN_TEXT(3)[2]!, textAt("This page is intentionally left blank.", 50, 60)] },
    });
    assert.deepEqual(evidence.verifiedBlankPages, []);
    assert.equal(exitCodeFor(report.verdict), 4);
  });

  it("does not excuse a blank-marked page whose area carries generated content, text or an element without a source id", async () => {
    const { injected, sid } = sids();
    const blank = { pageBox: pageBox(1), contentBox: contentBox(1), blank: true };
    const cases: [string, Parameters<typeof pagedPage>[0], boolean][] = [
      ["generated ::after content", { ...blank, content: "", contentAttributes: 'data-test-after="This page is intentionally left blank."' }, true],
      ["an unsourced element with text", { ...blank, content: `<div data-test-box="${lineBox(1, 3)}">Printed, but no source block owns it.</div>` }, false],
      ["a bare text node", { ...blank, content: "Printed, but no source block owns it." }, false],
      ["an unsourced empty element", { ...blank, content: `<div class="rule" data-test-box="${lineBox(1, 3)}"></div>` }, true],
      ["an element in the footnote area", { ...blank, content: "", footnotes: `<div data-test-box="${lineBox(1, 12)}">Unsourced note.</div>` }, true],
    ];
    for (const [name, page2, snapshotBlank] of cases) {
      const doc = document(sid, page2);
      assert.equal(areaEmpty(doc, 1), false, `${name}: the DOM called the page area empty`);
      const { evidence, report } = await run(doc, injected, {});
      assert.equal(evidence.verifiedBlankPages?.length ?? 0, 0, `${name}: the page was excused`);
      assert.equal(exitCodeFor(report.verdict), 4, `${name}: ${report.exitReason}`);
      // Some of these the snapshot calls blank on its own, which is why it is not the only witness.
      const snapshot = assemble(doc, injected);
      assert.equal(snapshot.pages[1]!.blank, snapshotBlank, `${name}: premise on the snapshot's own blank flag`);
    }
  });

  it("does not excuse an empty page that Paged.js did not insert as blank", async () => {
    const { injected, sid } = sids();
    const doc = document(sid, { pageBox: pageBox(1), contentBox: contentBox(1), content: "", blank: false });
    const { snapshot, evidence, report } = await run(doc, injected, {});
    assert.equal(snapshot.pages[1]!.blank, true, "premise: the snapshot sees nothing on the page");
    assert.deepEqual(evidence.verifiedBlankPages, []);
    assert.equal(exitCodeFor(report.verdict), 4);
  });
});

describe("the page-area template test reads structure, never coordinates", () => {
  it("accepts the recorded blank page with a running header and a page number in its margin boxes", () => {
    const { sid } = sids();
    const doc = document(sid);
    assert.deepEqual([0, 1, 2].map((index) => areaEmpty(doc, index)), [false, true, false]);
  });

  it("rejects generated content on the area itself, a missing footnote area, and a second area", () => {
    const empty = `<div class="pagedjs_page_content"></div>`;
    const footnotes = `<div class="pagedjs_footnote_area"><div class="pagedjs_footnote_content"><div class="pagedjs_footnote_inner_content"></div></div></div>`;
    const tree = (area: string) => pagedDocument([
      `<div class="pagedjs_page pagedjs_blank_page"><div class="pagedjs_sheet"><div class="pagedjs_pagebox">${area}</div></div></div>`,
    ]);
    assert.equal(areaEmpty(tree(`<div class="pagedjs_area">${empty}${footnotes}</div>`), 0), true, "premise: the bare template is empty");
    assert.equal(areaEmpty(tree(`<div class="pagedjs_area" data-test-before="Blank">${empty}${footnotes}</div>`), 0), false);
    assert.equal(areaEmpty(tree(`<div class="pagedjs_area">${empty}</div>`), 0), false);
    assert.equal(areaEmpty(tree(`<div class="pagedjs_area">${footnotes}${empty}</div>`), 0), false, "the containers out of order");
    assert.equal(areaEmpty(tree(`<div class="pagedjs_area">${empty}${footnotes}</div><div class="pagedjs_area">${empty}${footnotes}</div>`), 0), false);
    assert.equal(areaEmpty(tree(`<div class="pagedjs_margin"><div class="pagedjs_area">${empty}${footnotes}</div></div>`), 0), false,
      "an area that is not a child of the page box is not the page's area");
  });
});

describe("verifyBlankPage, one oracle at a time", () => {
  const facts: OverlayPageFacts = { page: 2, pagedBlank: true, areaEmpty: true, areaPx: { x: 56.69, y: 56.69, width: 453.53, height: 340.16 } };
  const base = (over: Partial<BlankPageInput> = {}): BlankPageInput => ({
    facts, page: 2, dpi: 96, raster: RASTER,
    textPage: { heightPt: (RASTER.height / 96) * 72, items: [textAt("Header", 36, 5), textAt("2", 75, 113)] },
    ink: async (region) => ({ pixels: (region.x1 - region.x0) * (region.y1 - region.y0), ink: 0 }),
    ...over,
  });

  it("is true only when all four answers agree", async () => {
    assert.equal(await verifyBlankPage(base()), true);
    assert.equal(await verifyBlankPage(base({ facts: { ...facts, pagedBlank: false } })), false, "not inserted by Paged.js");
    assert.equal(await verifyBlankPage(base({ facts: { ...facts, areaEmpty: false } })), false, "the DOM area holds something");
    assert.equal(await verifyBlankPage(base({ facts: { ...facts, areaPx: null } })), false, "no page area");
    assert.equal(await verifyBlankPage(base({ facts: null })), false, "no facts for the page");
    assert.equal(await verifyBlankPage(base({ facts: { ...facts, page: 3 } })), false, "facts about another page");
    assert.equal(await verifyBlankPage(base({ textPage: null })), false, "no text layer");
    assert.equal(await verifyBlankPage(base({ textPage: { ...base().textPage!, items: [textAt("x", 60, 60)] } })), false, "text in the area");
    assert.equal(await verifyBlankPage(base({ textPage: { ...base().textPage!, items: [textAt("  ", 60, 60)] } })), true,
      "an item of whitespace is not printed text");
    assert.equal(await verifyBlankPage(base({ ink: async () => ({ pixels: 153_567, ink: 1 }) })), false, "one pixel of ink");
    assert.equal(await verifyBlankPage(base({ ink: async () => ({ pixels: 10, ink: 0 }) })), false, "a raster that measured another region");
    assert.equal(await verifyBlankPage(base({ ink: async () => { throw new Error("no page"); } })), false, "a raster that could not answer");
    assert.equal(await verifyBlankPage(base({ raster: { width: 300, height: 300 } })), false, "an area the raster does not contain");
  });
});

describe("the evidence requirement's blank-page excuse, at the engine", () => {
  const snapshot: Snapshot = (() => {
    const { injected, sid } = sids();
    return assemble(document(sid), injected);
  })();
  const record = (page: number, bindsFinding: boolean): Evidence => ({
    key: `doc#${page}`, page, path: `page-${page}.png`, origin: "pdf-raster",
    pdfConformance: bindsFinding ? "verified" : "unverified", conformance: null, bindsFinding,
    overlayCheck: { styleViolations: 0, rasterDiffPx: 0, removed: false },
  });
  const coverage = (blankPages: number[] | undefined, evidence: Evidence[]) => runDocument({
    path: "doc.html", snapshot, infrastructure: [], evidence,
    evidenceRequirement: { required: true, expectedPages: 3, ...(blankPages ? { blankPages } : {}) },
  }, { failOn: "error", activeRules: [], optionsByRule: {}, coverageFloors: {} }).report.evidenceCoverage;

  it("counts a page it excuses neither as expected nor as bound", () => {
    assert.deepEqual(coverage([2], [record(1, true), record(2, false), record(3, true)]),
      { required: true, expectedPages: 2, writtenPages: 2, boundPages: 2, status: "complete", reason: null });
    assert.deepEqual(coverage(undefined, [record(1, true), record(2, false), record(3, true)])?.status, "partial",
      "premise: without the excuse the blank page blocks the requirement");
  });

  it("does not excuse a page without exactly one evidence record, or one whose record binds", () => {
    assert.equal(coverage([2], [record(1, true), record(3, true)])?.status, "partial", "no record for the page");
    assert.equal(coverage([2], [record(1, true), record(2, false), record(2, false), record(3, true)])?.status, "partial", "two records");
    assert.deepEqual(coverage([2], [record(1, true), record(2, true), record(3, true)]),
      { required: true, expectedPages: 3, writtenPages: 3, boundPages: 3, status: "complete", reason: null },
      "a bound page stays in the requirement and counts as bound");
    assert.equal(coverage([0, 4, 2.5], [record(1, true), record(2, false), record(3, true)])?.expectedPages, 3, "pages that do not exist");
  });

  it("never completes on excused pages alone", () => {
    assert.equal(coverage([1, 2, 3], [record(1, false), record(2, false), record(3, false)])?.status, "unavailable");
  });

  it("finalizeEvidenceAcquisition excuses only pages the snapshot independently calls blank", () => {
    const outcome = { evidence: [], infrastructure: [], notMeasured: [], boundSids: new Set<string>(), marks: [],
      ambiguousMarks: 0, deliveredPdf: new Uint8Array(), deliveredWithOverlay: true, overlayInstalled: true,
      candidates: { marked: null, baseline: new Uint8Array() } };
    const input = finalizeEvidenceAcquisition("doc.html", snapshot, [], { ...outcome, verifiedBlankPages: [1, 2, 3] }, true);
    assert.deepEqual(input.evidenceRequirement, { required: true, expectedPages: 3, blankPages: [2] });
    assert.deepEqual(input.notMeasured?.filter((row) => row.reason === "env/parity-blank-page").map((row) => row.target?.nodeKey), ["page:2"]);
    const off = finalizeEvidenceAcquisition("doc.html", snapshot, [], { ...outcome, verifiedBlankPages: [] }, true);
    assert.deepEqual(off.evidenceRequirement, { required: true, expectedPages: 3 });
  });
});
