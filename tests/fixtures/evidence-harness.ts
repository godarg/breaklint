/**
 * The evidence path over a hand-authored Paged.js page tree: the REAL overlay payload decides
 * where marks go and what each page's area holds, the REAL `produceEvidence` decides what binds
 * and which pages are blank, and only the PDF is faked.
 *
 * WHAT IS FAKED, EXACTLY. A rasteriser whose text layer returns every placed mark at the position
 * the overlay recorded (plus any extra items a test adds, such as a running header), whose pages
 * are `RASTER` device pixels at 96 dpi, and whose ink per page is whatever the test says it is.
 * Whether Chrome's PDF and pdfjs really answer that way is the live suite's question
 * (`tests/live/real-documents.test.ts`); this harness decides nothing about it.
 *
 * `tests/unit/margin-boxes-evidence.test.ts` has its own copy of the page double, older than this
 * file; it is left alone so that the two work packages stay independent.
 */

import type { PageLike } from "../../src/acquire/browser.ts";
import { OVERLAY_GLOBALS, OVERLAY_SOURCE, type OverlayInstallation } from "../../src/render/overlay.ts";
import type { DeviceRegion, PdfTextItem, PdfTextPage, RasterPage, Rasterizer, RegionInk } from "../../src/render/rasterizer.ts";
import { overlayController, type FakeNode } from "./paged-dom.ts";

export const PX_PER_MM = 96 / 25.4;
export const PT_PER_MM = 72 / 25.4;
/** A 150 x 120 mm page at 96 dpi, in device pixels, as the rasteriser reports it. */
export const RASTER: RasterPage = { width: 567, height: 454 };
const PAGE_HEIGHT_PT = (RASTER.height / 96) * 72;

/** Answers the overlay calls with the real payload's results; fakes nothing about placement. */
export class OverlayPage implements PageLike {
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
    // cannot answer and this harness does not claim; they report a clean overlay.
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

/**
 * A PNG signature and IHDR claiming `RASTER`'s size. `finish` reads the header back and refuses a
 * file whose size is not the size the rasteriser reported; nothing reads further.
 */
const PNG = (() => {
  const bytes = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0, 0, 0, 0, 0, 0, 0, 0, 0x08, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, RASTER.width);
  view.setUint32(20, RASTER.height);
  return bytes;
})();

/** A text item at a position in millimetres from the top-left of the page. */
export function textAt(text: string, xMm: number, yMm: number): PdfTextItem {
  return { text, x: xMm * PT_PER_MM, y: PAGE_HEIGHT_PT - yMm * PT_PER_MM };
}

export interface FaithfulPdf {
  pages: number;
  /** Extra text items per 1-based page, e.g. a running header. */
  extraText?: Readonly<Record<number, readonly PdfTextItem[]>>;
  /** Ink the raster shows inside any region of a 1-based page. Default 0: paper. */
  ink?: Readonly<Record<number, number>>;
  /** Regions the evidence path asked about, for assertions. */
  asked?: { page: number; region: DeviceRegion }[];
  /** A 1-based page whose PNG claims the wrong size, so the evidence of the document is incomplete. */
  badPngPage?: number;
}

/** A PDF whose text layer holds every placed token exactly where the overlay recorded it. */
export function faithfulRasterizer(page: OverlayPage, pdf: FaithfulPdf): Rasterizer {
  const dims: RasterPage[] = Array.from({ length: pdf.pages }, () => ({ ...RASTER }));
  return {
    name: "pdfjs-dist", version: "6.2.108", declaredVersion: "6.2.108",
    async rasterise() { return dims; },
    async diff() { return { pagesA: pdf.pages, pagesB: pdf.pages, pixels: 0 }; },
    async dropPixels() {},
    async encodePng(_key: string, pageIndex: number) {
      if (pdf.badPngPage !== pageIndex + 1) return PNG;
      const wrong = Uint8Array.from(PNG);
      new DataView(wrong.buffer).setUint32(16, RASTER.width + 1);
      return wrong;
    },
    async textItems(): Promise<PdfTextPage[]> {
      const marks = page.installation?.marks ?? [];
      return Array.from({ length: pdf.pages }, (_, index) => ({
        heightPt: PAGE_HEIGHT_PT,
        items: [
          ...marks.filter((mark) => mark.page === index + 1).map((mark) => ({
            text: mark.token,
            x: (mark.xPx / PX_PER_MM) * PT_PER_MM,
            y: PAGE_HEIGHT_PT - (mark.yPx / PX_PER_MM) * PT_PER_MM,
          })),
          ...(pdf.extraText?.[index + 1] ?? []),
        ],
      }));
    },
    async regionInk(_key: string, pageIndex: number, region: DeviceRegion): Promise<RegionInk> {
      pdf.asked?.push({ page: pageIndex + 1, region });
      return { pixels: (region.x1 - region.x0) * (region.y1 - region.y0), ink: pdf.ink?.[pageIndex + 1] ?? 0 };
    },
    pageErrors() { return []; },
    async release() {},
    async close() {},
  };
}
