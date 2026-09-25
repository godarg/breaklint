/**
 * Evidence binding on documents with margin-box content and with fragments that bleed into the
 * margin — the real overlay payload deciding where marks go, the real evidence decision deciding
 * which pages bind.
 *
 * THE DEFECT. The overlay was a third reader of the whole page: it tried to mark every source
 * element on it, including the `position: running(...)` clones in the margin boxes and the
 * `position: fixed` clones in the page box. Those lie outside the content box the marks hang in,
 * so they were recorded unplaced, and a page with an unplaced element that has no placed mark on
 * it never binds. Required evidence then never completes: measured on 2026-09-24 with evidence
 * binding on, `margin-running-elements.html`, `margin-running-parity.html` and
 * `fullbleed-avoid.html` ended exit 4 with 24, 6 and 212 unplaced marks. The full-bleed case is the
 * second half of the same defect: its fragments are IN the flow, printed in the side margin, and the
 * overlay refused every mark left of the content box.
 *
 * WHAT IS REAL HERE, AND WHAT IS NOT. The overlay's `install` runs as the page would run it, over a
 * hand-authored Paged.js 0.4.3 page tree (`tests/fixtures/paged-dom.ts`), and its result is handed
 * to the production `produceEvidence`. The PDF side is faked exactly where
 * `tests/unit/evidence-decision.test.ts` fakes it: a rasteriser whose text layer returns each placed
 * token at the position the overlay recorded. Whether Chrome's PDF and pdfjs really put the token
 * there is the live suite's question (`tests/live/render-run.test.ts`), and on a browser where the
 * text layer cannot be read it is not answered here.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { PageLike } from "../../src/acquire/browser.ts";
import { produceEvidence } from "../../src/render/evidence.ts";
import { OVERLAY_GLOBALS, OVERLAY_SOURCE, type OverlayInstallation } from "../../src/render/overlay.ts";
import type { PdfTextPage, RasterPage, Rasterizer } from "../../src/render/rasterizer.ts";
import { overlayController, pagedDocument, pagedPage, type FakeNode } from "../fixtures/paged-dom.ts";

const STRIDE = 700;
const LINE = 18.66;
const PAGE_HEIGHT_PX = 453.54;
const PX_PER_MM = 96 / 25.4;
const PT_PER_MM = 72 / 25.4;
const pageBox = (index: number) => [0, index * STRIDE, 566.93, PAGE_HEIGHT_PX] as const;
const contentBox = (index: number) => [56.69, 56.69 + index * STRIDE, 453.53, 340.16] as const;
const lineBox = (index: number, line: number, x = 56.69, width = 453.53) =>
  `${x} ${56.69 + index * STRIDE + line * LINE} ${width} ${LINE}`;
const body = (index: number, from: number, count: number) => Array.from({ length: count }, (_, i) =>
  `<p data-bl-sid="b${from + i}" data-ref="ref-b${from + i}" data-test-box="${lineBox(index, i)}">Body ${from + i}.</p>`).join("");

/** Running title, eight-line side element and a `position: fixed` stamp on three pages. */
function runningDocument(): FakeNode {
  const title = (index: number) =>
    `<p class="title" data-bl-sid="rt" data-ref="ref-rt" data-test-box="56.69 ${19.02 + index * STRIDE} 453.53 ${LINE}">Running title</p>`;
  const side = (index: number) =>
    `<div class="side" data-bl-sid="rs" data-ref="ref-rs" data-test-box="0 ${178.27 + index * STRIDE} 56.69 97">Side</div>`;
  const stamp = (index: number) =>
    `<div class="stamp" data-bl-sid="st" data-ref="ref-st" style="position: absolute;" data-test-box="523.22 ${index * STRIDE} 43.7 ${LINE}">DRAFT</div>`;
  return pagedDocument([0, 1, 2].map((index) => pagedPage({
    pageBox: pageBox(index), contentBox: contentBox(index), fixed: stamp(index),
    margins: { "top-center": title(index), "left-middle": side(index) },
    content: (index === 0
      ? `<p class="title" data-bl-sid="rt" data-ref="ref-rt" style="display: none;">Running title</p>` +
        `<div class="side" data-bl-sid="rs" data-ref="ref-rs" style="display: none;">Side</div>`
      : "") + body(index, index * 10, 10),
  })));
}

/** A `break-inside: avoid` block with negative side margins: every fragment starts at x = 18.91. */
function fullBleedDocument(): FakeNode {
  return pagedDocument([0, 1, 2].map((index) => pagedPage({
    pageBox: pageBox(index), contentBox: contentBox(index),
    content: `<div class="bleed" data-bl-sid="fb" data-ref="ref-fb" data-test-box="18.91 ${56.69 + index * STRIDE} 529.09 ${18 * LINE}">` +
      Array.from({ length: 18 }, (_, i) =>
        `<p data-bl-sid="f${index * 18 + i}" data-ref="ref-f${index * 18 + i}" data-test-box="${lineBox(index, i, 18.91, 529.09)}">Bleed.</p>`).join("") +
      "</div>",
  })));
}

/** A block whose top was pulled above the content box: its start mark cannot be placed. */
function pulledUpDocument(): FakeNode {
  return pagedDocument([pagedPage({
    pageBox: pageBox(0), contentBox: contentBox(0),
    content: `<div data-bl-sid="up" data-ref="ref-up" data-test-box="56.69 40 453.53 200">Pulled up.</div>`,
  })]);
}

/** Answers the overlay calls with the REAL payload's results, and fakes nothing about placement. */
class OverlayPage implements PageLike {
  private readonly controller: ReturnType<typeof overlayController>;
  installation: OverlayInstallation | null = null;
  constructor(document: FakeNode) {
    this.controller = overlayController(OVERLAY_SOURCE, document);
  }
  async goto(): Promise<unknown> { return undefined; }
  async setContent(): Promise<void> {}
  async evaluate(fn: unknown): Promise<unknown> {
    if (typeof fn !== "string") return undefined;
    if (fn === OVERLAY_SOURCE) return this.controller.capability;
    if (!fn.includes(OVERLAY_GLOBALS.control)) return undefined;
    if (fn.includes('"install"')) {
      const result = this.controller.control(this.controller.capability, "install");
      this.installation = result.value as OverlayInstallation;
      return result;
    }
    // Readback and detach are about the marks being invisible and removable, which the fake tree
    // cannot answer and this file does not claim; they report a clean overlay.
    if (fn.includes('"readback"')) return { value: [], unauthorizedCalls: 0 };
    if (fn.includes('"detach"')) return { value: this.installation?.layers ?? 0, unauthorizedCalls: 0 };
    return { value: 0, unauthorizedCalls: 0 };
  }
  async waitForFunction(): Promise<unknown> { return undefined; }
  async emulateMediaType(): Promise<void> {}
  async setViewport(): Promise<void> {}
  async pdf(): Promise<Uint8Array> { return Uint8Array.from([0x25, 0x50, 0x44, 0x46]); }
  on(): void {}
  async close(): Promise<void> {}
}

const VALID_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

/** A PDF whose text layer holds every placed token exactly where the overlay recorded it. */
function faithfulRasterizer(page: OverlayPage, pageCount: number): Rasterizer {
  const heightPt = (PAGE_HEIGHT_PX / PX_PER_MM) * PT_PER_MM;
  const dims: RasterPage[] = Array.from({ length: pageCount }, () => ({ width: 1, height: 1 }));
  return {
    name: "pdfjs-dist", version: "6.2.108", declaredVersion: "6.2.108",
    async rasterise() { return dims; },
    async diff() { return { pagesA: pageCount, pagesB: pageCount, pixels: 0 }; },
    async dropPixels() {},
    async encodePng() { return VALID_PNG; },
    async textItems(): Promise<PdfTextPage[]> {
      const marks = page.installation?.marks ?? [];
      return Array.from({ length: pageCount }, (_, index) => ({
        heightPt,
        items: marks.filter((mark) => mark.page === index + 1).map((mark) => ({
          text: mark.token,
          x: (mark.xPx / PX_PER_MM) * PT_PER_MM,
          y: heightPt - (mark.yPx / PX_PER_MM) * PT_PER_MM,
        })),
      }));
    },
    // None of these documents has a blank page; a page without marks reads as printed on.
    async regionInk() { return { pixels: 1, ink: 1 }; },
    pageErrors() { return []; },
    async release() {},
    async close() {},
  };
}

describe("evidence on margin-box content and on fragments that bleed into the margin", () => {
  let outDir = "";
  beforeEach(() => { outDir = mkdtempSync(join(tmpdir(), "breaklint-margin-evidence-")); });
  afterEach(() => { rmSync(outDir, { recursive: true, force: true }); });

  const evidenceFor = async (document: FakeNode, pages: number) => {
    const page = new OverlayPage(document);
    const outcome = await produceEvidence({
      page, closePage: async () => page.close(), rasterizer: faithfulRasterizer(page, pages),
      options: { outDir, documentKey: "margin", binding: true },
    });
    return { outcome, installation: page.installation! };
  };

  it("does not require marks for running or fixed clones, so every page of the document binds", async () => {
    const { outcome, installation } = await evidenceFor(runningDocument(), 3);
    const marked = new Set(installation.marks.map((mark) => mark.sid));
    for (const clone of ["rt", "rs", "st"]) {
      assert.equal(marked.has(clone), false, `a clone of ${clone} outside the content area was marked`);
    }
    assert.deepEqual(installation.unplacedMarks, [], "a margin-box or page-box clone was recorded as an unplaced flow fragment");
    assert.equal(outcome.notMeasured.some((row) => row.reason === "env/evidence-fragment-outside-page"), false);
    assert.deepEqual(outcome.evidence.map((page) => page.bindsFinding), [true, true, true],
      "a page with a running header, a side running element and a fixed stamp did not bind");
  });

  it("places marks for an in-flow fragment that bleeds into the side margin, inside the page box", async () => {
    const { outcome, installation } = await evidenceFor(fullBleedDocument(), 3);
    const starts = installation.marks.filter((mark) => mark.sid === "fb" && mark.side === "start");
    assert.equal(starts.length, 3, "a full-bleed fragment got no start mark on some page");
    for (const mark of starts) {
      assert.ok(Math.abs(mark.xPx - 18.91) < 0.01, `the start mark was moved off the fragment's edge: x = ${mark.xPx}`);
    }
    assert.deepEqual(installation.unplacedMarks, [], `marks left unplaced: ${JSON.stringify(installation.unplacedMarks.slice(0, 4))}`);
    assert.deepEqual(outcome.evidence.map((page) => page.bindsFinding), [true, true, true],
      "the pages of a full-bleed block did not bind");
  });

  it("still refuses a mark above the content box: the vertical bound is kept, conservatively", async () => {
    // Down the page the bound stays the content box. That is a conservative choice, not a
    // measured necessity — the marks hang in Paged.js' multi-column fragmentainer, and on Chromium
    // 141 a mark above or below it was measured printing at its DOM position. A block whose top
    // was pulled above the content box keeps its start mark unplaced and says so; its end mark is
    // inside and placed, so the page can still bind on it.
    const { installation } = await evidenceFor(pulledUpDocument(), 1);
    assert.deepEqual(installation.unplacedMarks, [{ sid: "up", page: 1, side: "start", reason: "fragment-outside-page" }]);
    assert.equal(installation.marks.filter((mark) => mark.sid === "up").length, 1);
  });
});
