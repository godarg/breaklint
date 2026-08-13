/**
 * The decision logic of the evidence path, driven through its own injected seams.
 *
 * This file exists because an audit reverted four repairs one at a time and watched the entire
 * suite — 104 unit tests, 15 live tests, the mutation guard — stay green through all four. The
 * repairs were real; the gates were not there. The reason is structural rather than careless: the
 * live corpus is made of real documents, and a real document cannot be made to produce a
 * rasteriser page error, a PNG that fails its own header check, or a page whose marks were all
 * refound but sit forty millimetres from where the DOM said they were. Those branches decide
 * whether a finding counts as evidenced, and nothing could reach them.
 *
 * **Where the fakes sit, and why that is not the mock this project warns about.** `Rasterizer` and
 * `PageLike` are interfaces the module already takes as arguments; the fakes stand exactly there
 * and nowhere deeper. The real browser, the real paginator and the real rasteriser are covered by
 * `tests/live/`, which fails rather than skips when they are absent. What is checked here is the
 * judgement — which is the part that cannot be provoked otherwise — and not the plumbing.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { PageLike } from "../../src/acquire/browser.ts";
import { IS } from "../../src/core/enums.ts";
import { produceEvidence } from "../../src/render/evidence.ts";
import { OVERLAY_GLOBALS, OVERLAY_SOURCE } from "../../src/render/overlay.ts";
import type { PlacedMark } from "../../src/render/overlay.ts";
import type { PdfTextPage, RasterDiff, RasterPage, Rasterizer } from "../../src/render/rasterizer.ts";

const PX_PER_MM = 96 / 25.4;
const PT_PER_MM = 72 / 25.4;
const PAGE_HEIGHT_PT = 105 * PT_PER_MM;

/** A real, minimal PNG: 1x1 white, so the header check has something valid to accept. */
const VALID_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

interface OverlayState {
  marks: PlacedMark[];
  layers: number;
  staticPageAreas: number;
  detached: number;
  violations: { token: string; why: string }[];
}

function mark(sid: string, token: string, xMm: number, yMm: number, page = 1): PlacedMark {
  return {
    token,
    sid,
    fragmentOrdinal: Number(token.slice(5, 8)),
    side: token.endsWith("A") ? "start" : "end",
    page,
    xPx: xMm * PX_PER_MM,
    yPx: yMm * PX_PER_MM,
  };
}

/** Stands where the browser page stands: it answers the four calls the overlay module makes. */
class FakePage implements PageLike {
  closed = false;
  private readonly state: OverlayState;
  // Written out rather than as a parameter property: node's strip-only TypeScript mode has no
  // transform step, so a constructor parameter property never becomes a field.
  constructor(state: OverlayState) {
    this.state = state;
  }
  async goto(): Promise<unknown> {
    return undefined;
  }
  async setContent(): Promise<void> {}
  // `PageLike.evaluate` is overloaded (string or function). This fake only ever sees the string
  // form; the return is deliberately loose because each call site asks for a different shape.
  async evaluate(fn: unknown): Promise<unknown> {
    if (typeof fn !== "string") return undefined;
    if (fn === OVERLAY_SOURCE) return "fake-overlay-capability";
    if (fn.includes(OVERLAY_GLOBALS.control) && fn.includes('"install"')) {
      return { value: {
        marks: this.state.marks, layers: this.state.layers, staticPageAreas: this.state.staticPageAreas,
      }, unauthorizedCalls: 0 };
    }
    if (fn.includes(OVERLAY_GLOBALS.control) && fn.includes('"readback"')) {
      return { value: this.state.violations, unauthorizedCalls: 0 };
    }
    if (fn.includes(OVERLAY_GLOBALS.control) && fn.includes('"detach"')) {
      return { value: this.state.detached, unauthorizedCalls: 0 };
    }
    if (fn.includes(OVERLAY_GLOBALS.control) && fn.includes('"remove"')) {
      return { value: 0, unauthorizedCalls: 0 };
    }
    return undefined;
  }
  async waitForFunction(): Promise<unknown> {
    return undefined;
  }
  async emulateMediaType(): Promise<void> {}
  async setViewport(): Promise<void> {}
  async pdf(): Promise<Uint8Array> {
    // The two calls have to be distinguishable, because the whole point of several cases below
    // is WHICH of the two bytes came out.
    return Uint8Array.from([this.closed ? 0 : 0x25, 0x50, 0x44, 0x46, this.pdfCalls++]);
  }
  private pdfCalls = 0;
  on(): void {}
  async close(): Promise<void> {
    this.closed = true;
  }
}

class InstallFailurePage extends FakePage {
  override async evaluate(fn: unknown): Promise<unknown> {
    if (typeof fn === "string" && fn !== OVERLAY_SOURCE &&
        fn.includes(OVERLAY_GLOBALS.control) && fn.includes('"install"')) {
      throw new Error("install boundary failed before completion");
    }
    return super.evaluate(fn);
  }
}

class UnauthorizedOverlayRacePage extends FakePage {
  override async evaluate(fn: unknown): Promise<unknown> {
    const result = await super.evaluate(fn);
    if (typeof fn === "string" && fn !== OVERLAY_SOURCE &&
        fn.includes(OVERLAY_GLOBALS.control) && fn.includes('"install"') &&
        result && typeof result === "object") {
      return { ...(result as { value: unknown }), unauthorizedCalls: 1 };
    }
    return result;
  }
}

interface FakeRasterizerOptions {
  diff: number;
  pages?: number;
  png?: Uint8Array;
  textItems?: PdfTextPage[];
  /** Errors already present when this document starts — i.e. left over from an earlier one. */
  initialErrors?: string[];
  /** An error the rasteriser page raises during PNG encoding, i.e. AFTER the comparison. */
  errorDuringEncode?: string;
}

function fakeRasterizer(options: FakeRasterizerOptions): Rasterizer {
  const errors = [...(options.initialErrors ?? [])];
  const pageCount = options.pages ?? 1;
  const dims: RasterPage[] = Array.from({ length: pageCount }, () => ({ width: 1, height: 1 }));
  return {
    name: "pdfjs-dist",
    version: "6.2.108",
    declaredVersion: "6.2.108",
    async rasterise(): Promise<RasterPage[]> {
      return dims;
    },
    async diff(): Promise<RasterDiff> {
      return { pagesA: pageCount, pagesB: pageCount, pixels: options.diff };
    },
    async dropPixels(): Promise<void> {},
    async encodePng(): Promise<Uint8Array> {
      if (options.errorDuringEncode) errors.push(options.errorDuringEncode);
      return options.png ?? VALID_PNG;
    },
    async textItems(): Promise<PdfTextPage[]> {
      return options.textItems ?? [];
    },
    pageErrors(): readonly string[] {
      return errors;
    },
    async release(): Promise<void> {},
    async close(): Promise<void> {},
  };
}

function textPage(items: { token: string; xMm: number; yMm: number }[]): PdfTextPage {
  return {
    heightPt: PAGE_HEIGHT_PT,
    items: items.map((i) => ({ text: i.token, x: i.xMm * PT_PER_MM, y: PAGE_HEIGHT_PT - i.yMm * PT_PER_MM })),
  };
}

/** Two targets on one page, both exactly where they should be. The baseline for every case. */
const MARKS = [
  mark("b1", "BLSID000A", 20, 30),
  mark("b1", "BLSID000E", 20, 36),
  mark("b2", "BLSID001A", 20, 50),
  mark("b2", "BLSID001E", 20, 56),
];
const MATCHING_TEXT = [
  textPage([
    { token: "BLSID000A", xMm: 20, yMm: 30 },
    { token: "BLSID000E", xMm: 20, yMm: 36 },
    { token: "BLSID001A", xMm: 20, yMm: 50 },
    { token: "BLSID001E", xMm: 20, yMm: 56 },
  ]),
];

describe("the overlay's in-page contract", () => {
  /**
   * The capability-gated name the TypeScript side calls is the name the injected script defines.
   *
   * There is no compiler between those two: one side is a constant, the other is a string a
   * browser parses. Renaming one alone produces `window.<name> is not a function` at runtime, and
   * before this test only the live suite could have noticed — which means only on a machine with
   * Chrome, Paged.js, pdfjs and poppler all present.
   *
   * Red condition: rename any entry of `OVERLAY_GLOBALS` without renaming it inside
   * `OVERLAY_SOURCE`, and this names the one that no longer exists.
   */
  it("every name the module calls is a name the injected script defines", () => {
    const missing = Object.entries(OVERLAY_GLOBALS)
      .filter(([, global]) => global !== "__blOverlayControl" || !OVERLAY_SOURCE.includes("P.publishOverlay(\"breaklint-static-test-capability\", control)"))
      .map(([role, global]) => `${role} -> window.${global}`);
    assert.deepEqual(missing, [], `these are called but never defined in the page:\n${missing.join("\n")}`);
    // And the reverse count, so a global can neither be added without a caller nor silently lost.
    const defined = OVERLAY_SOURCE.includes("P.publishOverlay(\"breaklint-static-test-capability\", control)") ? ["__blOverlayControl"] : [];
    const uncalled = defined.filter((g) => !Object.values(OVERLAY_GLOBALS).includes(g as never));
    assert.deepEqual(uncalled, [], `defined in the page but never called: ${uncalled.join(", ")}`);
    assert.equal(defined.length, 1, "overlay exposed more than its single capability-gated controller");
    for (const hostileSurface of ["document.querySelectorAll", "pageEl.querySelector", "getComputedStyle(",
      ".getBoundingClientRect(", ".getClientRects(", ".getAttribute(", ".appendChild(", "layer.remove("]) {
      assert.equal(OVERLAY_SOURCE.includes(hostileSurface), false, `overlay bypasses captured primitive: ${hostileSurface}`);
    }
  });
});

describe("the evidence verdict", () => {
  let outDir: string;
  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "breaklint-verdict-"));
  });
  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  const run = async (overlay: Partial<OverlayState>, raster: FakeRasterizerOptions) => {
    const state: OverlayState = {
      marks: MARKS,
      layers: 1,
      staticPageAreas: 0,
      detached: 1,
      violations: [],
      ...overlay,
    };
    const page = new FakePage(state);
    return produceEvidence({
      page,
      closePage: async () => page.close(),
      rasterizer: fakeRasterizer(raster),
      options: { outDir, documentKey: "case", binding: true },
    });
  };

  it("everything intact: the marked PDF is delivered and both targets bind", async () => {
    const r = await run({}, { diff: 0, textItems: MATCHING_TEXT });
    assert.equal(r.deliveredWithOverlay, true);
    assert.deepEqual([...r.boundSids].sort(), ["b1", "b2"]);
    assert.equal(r.evidence[0]?.pdfConformance, "verified");
    assert.equal(r.evidence[0]?.bindsFinding, true);
  });

  it("publishes an artifact-relative evidence reference even when the output directory is absolute", async () => {
    const r = await run({}, { diff: 0, textItems: MATCHING_TEXT });
    const reference = r.evidence[0]?.path;
    assert.ok(reference);
    assert.equal(isAbsolute(reference), false, "an absolute host path escaped into the evidence report");
    assert.equal(existsSync(join(outDir, reference)), true, "the reference does not resolve from the evidence artefact directory");
  });

  it("a target out of tolerance makes the page unverified even though every mark was refound", async () => {
    // The defect an audit found and the live corpus could not reach: asking "were all marks
    // refound?" is a question about the extractor. `b2` is displaced by 40 mm and both of its
    // marks are in the stream, so `marksMatched === marksTotal` holds.
    const r = await run({}, {
      diff: 0,
      textItems: [
        textPage([
          { token: "BLSID000A", xMm: 20, yMm: 30 },
          { token: "BLSID000E", xMm: 20, yMm: 36 },
          { token: "BLSID001A", xMm: 60, yMm: 50 },
          { token: "BLSID001E", xMm: 60, yMm: 56 },
        ]),
      ],
    });
    assert.deepEqual([...r.boundSids], ["b1"]);
    assert.equal(r.evidence[0]?.conformance?.marksMatched, 4, "all four refound — that is the trap");
    assert.equal(r.evidence[0]?.conformance?.marksTotal, 4);
    assert.equal(r.evidence[0]?.pdfConformance, "unverified");
    assert.equal(r.evidence[0]?.bindsFinding, false);
  });

  it("a page area that is not a containing block drops the binding", async () => {
    // The marks are absolutely positioned; without a containing block their coordinates mean
    // something else entirely, and a zero pixel difference would not notice.
    const r = await run({ staticPageAreas: 1 }, { diff: 0, textItems: MATCHING_TEXT });
    assert.equal(r.deliveredWithOverlay, false, "the marked PDF was delivered anyway");
    assert.equal(r.boundSids.size, 0);
    assert.equal(r.infrastructure.some((e) => e.kind === "checker-crashed"), true);
    assert.equal(r.notMeasured.some((n) => n.reason === "env/evidence-overlay-removed"), true);
  });

  it("a layer that could not be detached drops the binding", async () => {
    // A layer still in the tree means the marked PDF was compared against a document that is not
    // the delivered one. Recording that and binding anyway was the state an audit found.
    const r = await run({ layers: 2, detached: 1 }, { diff: 0, textItems: MATCHING_TEXT });
    assert.equal(r.deliveredWithOverlay, false);
    assert.equal(r.boundSids.size, 0);
    assert.equal(
      r.infrastructure.some((e) => e.kind === "checker-crashed" && e.detail.includes("detach incomplete")),
      true,
    );
  });

  it("an evidence file that is not a PNG of the reported size withdraws every binding", async () => {
    // Dropping the file and keeping the binding leaves a finding that claims evidence which does
    // not exist on disk.
    const r = await run({}, { diff: 0, textItems: MATCHING_TEXT, png: Uint8Array.from([1, 2, 3, 4]) });
    assert.equal(r.evidence.length, 0, "a file that failed its own check was still published");
    assert.equal(r.boundSids.size, 0, "a source block stayed bound with no evidence behind it");
    assert.equal(r.infrastructure.some((e) => e.kind === "checker-crashed"), true);
  });

  it("a rasteriser error raised AFTER the comparison still withdraws the bindings", async () => {
    // Encoding happens after the verdict. Reading the error list once, before that, made the
    // interface's promise — "a non-empty list invalidates every result" — untrue for exactly the
    // errors that arrive latest.
    const r = await run({}, { diff: 0, textItems: MATCHING_TEXT, errorDuringEncode: "TypeError: boom" });
    assert.equal(r.boundSids.size, 0);
    assert.equal(
      r.infrastructure.some((e) => e.kind === "checker-crashed" && e.detail.includes("while producing this document")),
      true,
    );
    assert.equal(r.evidence.every((e) => !e.bindsFinding && e.pdfConformance === "unverified"), true);
  });

  it("an error left over from an EARLIER document does not touch this one", async () => {
    // The error list runs for the lifetime of the rasteriser, not of one document. Charging
    // document three with document one's fault is fail-closed in direction and wrong in fact:
    // it is a ratchet that silently unbinds everything after the first hiccup.
    const r = await run({}, { diff: 0, textItems: MATCHING_TEXT, initialErrors: ["TypeError: from document 1"] });
    assert.deepEqual([...r.boundSids].sort(), ["b1", "b2"]);
    assert.equal(r.deliveredWithOverlay, true);
    assert.equal(r.infrastructure.length, 0, `unexpected: ${JSON.stringify(r.infrastructure)}`);
  });

  it("a divergent page raises render-unstable, which is a fatal infrastructure kind", async () => {
    // Both marks of both targets refound, all shifted 40 mm in x. The page carried its own
    // reference and bound nothing: the PDF does not reproduce what the rules measured. Unlike
    // `mark-raster-diff`, this one is meant to end the run.
    const r = await run({}, {
      diff: 0,
      textItems: [
        textPage([
          { token: "BLSID000A", xMm: 60, yMm: 30 },
          { token: "BLSID000E", xMm: 60, yMm: 36 },
          { token: "BLSID001A", xMm: 60, yMm: 50 },
          { token: "BLSID001E", xMm: 60, yMm: 56 },
        ]),
      ],
    });
    assert.equal(r.boundSids.size, 0);
    const event = r.infrastructure.find((e) => e.kind === "render-unstable");
    assert.ok(event, `no render-unstable event: ${JSON.stringify(r.infrastructure.map((e) => e.kind))}`);
    assert.match(event.detail, /dom-pdf-divergence/u);
    assert.equal(IS.nonFatalInfraEventKind.has("render-unstable"), false, "divergence must end the run");
    assert.equal(r.evidence[0]?.pdfConformance, "unverified");
  });

  it("one displaced target among good ones does NOT raise render-unstable", async () => {
    // The red condition for the case above. Without it, 'divergence' would just mean
    // 'something was out of tolerance' and every ordinary displaced mark would end the run.
    const r = await run({}, {
      diff: 0,
      textItems: [
        textPage([
          { token: "BLSID000A", xMm: 20, yMm: 30 },
          { token: "BLSID000E", xMm: 20, yMm: 36 },
          { token: "BLSID001A", xMm: 60, yMm: 50 },
          { token: "BLSID001E", xMm: 60, yMm: 56 },
        ]),
      ],
    });
    assert.deepEqual([...r.boundSids], ["b1"]);
    assert.equal(r.infrastructure.some((e) => e.kind === "render-unstable"), false);
  });

  it("a counted pixel difference delivers the baseline and binds nothing", async () => {
    const r = await run({}, { diff: 4711, textItems: MATCHING_TEXT });
    assert.equal(r.deliveredWithOverlay, false);
    assert.equal(r.boundSids.size, 0);
    assert.equal(r.infrastructure.some((e) => e.kind === "mark-raster-diff"), true);
  });

  it("an incomparable pair (-1) is not read as 'no difference'", async () => {
    const r = await run({}, { diff: -1, textItems: MATCHING_TEXT });
    assert.equal(r.deliveredWithOverlay, false);
    assert.equal(r.boundSids.size, 0);
  });

  it("with binding switched off nothing is installed and nothing is claimed", async () => {
    const page = new FakePage({ marks: MARKS, layers: 1, staticPageAreas: 0, detached: 1, violations: [] });
    const r = await produceEvidence({
      page,
      closePage: async () => page.close(),
      rasterizer: fakeRasterizer({ diff: 0 }),
      options: { outDir, documentKey: "case", binding: false },
    });
    assert.equal(r.boundSids.size, 0);
    assert.equal(r.marks.length, 0);
    // `env/evidence-overlay-removed` would make "the user switched it off" look like "the
    // overlay had an effect". The report carries `config.evidenceBinding` for the former.
    assert.equal(r.notMeasured.length, 0);
    assert.ok(r.evidence.length > 0, "the evidence image is still produced");
    assert.equal(r.overlayInstalled, false);
  });

  it("an install failure does not claim that the evidence overlay was installed", async () => {
    const page = new InstallFailurePage({ marks: MARKS, layers: 1, staticPageAreas: 0, detached: 1, violations: [] });
    const r = await produceEvidence({
      page,
      closePage: async () => page.close(),
      rasterizer: fakeRasterizer({ diff: 0 }),
      options: { outDir, documentKey: "case", binding: true },
    });
    assert.equal(r.overlayInstalled, false);
    assert.equal(r.notMeasured.some((item) => item.reason === "env/evidence-overlay-removed"), false);
    assert.ok(r.infrastructure.some((item) => item.kind === "checker-crashed"));
  });

  it("an author call racing the overlay capability fails closed before installation is trusted", async () => {
    const page = new UnauthorizedOverlayRacePage({
      marks: MARKS, layers: 1, staticPageAreas: 0, detached: 1, violations: [],
    });
    const r = await produceEvidence({
      page,
      closePage: async () => page.close(),
      rasterizer: fakeRasterizer({ diff: 0 }),
      options: { outDir, documentKey: "overlay-race", binding: true },
    });
    assert.equal(r.overlayInstalled, false);
    assert.equal(r.boundSids.size, 0);
    assert.ok(r.infrastructure.some((item) =>
      item.kind === "checker-crashed" && /raced by author code/u.test(item.detail)));
  });

  it("without a rasteriser the baseline is delivered and nothing binds", async () => {
    const page = new FakePage({ marks: MARKS, layers: 1, staticPageAreas: 0, detached: 1, violations: [] });
    const r = await produceEvidence({
      page,
      closePage: async () => page.close(),
      rasterizer: null,
      options: { outDir, documentKey: "case", binding: true },
    });
    assert.equal(r.deliveredWithOverlay, false);
    assert.equal(r.boundSids.size, 0);
    assert.equal(r.notMeasured.some((n) => n.reason === "env/evidence-overlay-removed"), true);
  });
});
