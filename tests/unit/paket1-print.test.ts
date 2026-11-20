import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { injectSourceIds } from "../../src/source/inject.ts";
import { assembleSnapshot, buildSourceModel, inputIdentity, type AssembleSnapshotInput } from "../../src/measure/snapshot.ts";
import { figureIndexTreeFingerprint, isExecutableScript } from "../../src/source/figure-index.ts";
import { runtimeFigureTreeMatches } from "../../src/acquire/render-run.ts";
import { sourceTableMatches, tableGridColumns } from "../../src/source/table-index.ts";
import { RULES_BY_ID } from "../../src/rules/index.ts";
import { runDocument } from "../../src/core/engine.ts";
import { produceEvidence } from "../../src/render/evidence.ts";
import type { PageLike } from "../../src/acquire/browser.ts";
import type { Rasterizer } from "../../src/render/rasterizer.ts";
import { loadCorpus } from "../fixtures/corpus.ts";

const corpus = loadCorpus();

function baseAssembleInput(html: string, runtimeVerified?: boolean): AssembleSnapshotInput {
  const injected = injectSourceIds(html, "doc.html");
  const model = buildSourceModel(injected.html, "doc.html");
  const base = structuredClone(corpus.find(entry => entry.name === "straight-quotes-trigger")!.snapshot);
  return {
    raw: {
      pages: base.pages,
      blocks: [],
      textLines: [],
      svg: [],
      figureBodies: [],
      requestedUrls: [],
      fontFamilies: [],
      control: { pages: 1, geometry: "", text: "", style: "", resources: "" },
    },
    collector: {
      pages: [{ index: 0, reconciled: true, hasBreakToken: false, decisionAtLayout: null, decisionAfterRender: null, firstSid: null, lastSid: null, startSid: null, blank: false, epoch: 0 }],
      hooks: {}, discardedRecords: 0, unreconciledPages: 0, attributeDrift: [], epochCount: 1,
    },
    sourceModel: model,
    sourceMap: injected.map,
    sourceMapInjection: true,
    ...(runtimeVerified !== undefined ? { runtimeFigureVerification: { verified: runtimeVerified } } : {}),
    renderer: "unit", browserVersion: "unit", pagedjsVersion: "0.4.3", platform: "test", locale: "en-US",
    freezeSignature: "unit", freezeRetries: 0,
    inputIdentity: inputIdentity({ html: injected.html, browserVersion: "unit", platform: "test", fontFamilies: [], resources: [] }),
    evidenceOverlayApplied: false, resources: [],
  };
}

describe("Paket 1: runtime-verified figure index", () => {
  it("treats application/ld+json and application/json data scripts as non-executable while keeping JS/module/importmap executable", () => {
    assert.equal(isExecutableScript({ type: "application/ld+json" }), false);
    assert.equal(isExecutableScript({ type: "application/json; charset=utf-8" }), false);
    assert.equal(isExecutableScript({}), true);
    assert.equal(isExecutableScript({ type: "text/javascript" }), true);
    assert.equal(isExecutableScript({ type: "module" }), true);
    assert.equal(isExecutableScript({ type: "importmap" }), true);

    const jsonLd = '<!doctype html><html><head><script type="application/ld+json">{"@type":"Book"}</script></head><body><figure id="f1"><svg width="40" height="20"><text>A</text></svg><figcaption>Figure 1</figcaption></figure></body></html>';
    const model = buildSourceModel(injectSourceIds(jsonLd, "ld.html").html, "ld.html");
    assert.equal(model.scriptBearing, false);
    assert.equal(model.figureIndex.complete, true);
    const snapshot = assembleSnapshot(baseAssembleInput(jsonLd));
    assert.equal(snapshot.figureIndex?.complete, true);
  });

  it("unlocks executable-script figure index only with explicit runtime verification and never bypasses <base> or data-ref", () => {
    const withScript = '<!doctype html><html><body><figure id="f1"><svg width="40" height="20"><text>A</text></svg><figcaption>Figure 1</figcaption></figure><button onclick="noop()">ok</button><script>function noop(){}</script></body></html>';
    const staticModel = buildSourceModel(injectSourceIds(withScript, "s.html").html, "s.html");
    assert.equal(staticModel.scriptBearing, true);
    assert.equal(staticModel.figureIndex.complete, false);
    assert.equal(staticModel.figureIndexStructuralComplete, true);

    const unverified = assembleSnapshot(baseAssembleInput(withScript, false));
    assert.equal(unverified.figureIndex, undefined);

    const verified = assembleSnapshot(baseAssembleInput(withScript, true));
    assert.equal(verified.figureIndex?.complete, true);
    assert.equal(verified.figureIndex?.figures.length, 1);

    // Structural disqualifier (<base>) remains strictly fail-closed even if runtimeVerified is true.
    const withBase = '<!doctype html><html><head><base href="https://example.invalid/"></head><body><figure id="f1"><svg width="40" height="20"><text>A</text></svg><figcaption>Figure 1</figcaption></figure><script>void 0</script></body></html>';
    const baseBlocked = assembleSnapshot(baseAssembleInput(withBase, true));
    assert.equal(baseBlocked.figureIndex, undefined);
  });

  it("detects any figure/ID/anchor/reference mutation in runtimeFigureTreeMatches", () => {
    const html = '<!doctype html><html><body><figure id="f1"><svg width="40" height="20"><text>A</text></svg><figcaption>Figure 1</figcaption></figure><p><a href="#f1">Figure 1</a></p></body></html>';
    const injected = injectSourceIds(html, "t.html");
    const model = buildSourceModel(injected.html, "t.html");
    const fig = model.figureIndex.figures[0]!;
    const matching = {
      ids: { ...model.figureIndex.ids },
      namedAnchors: { ...(model.figureIndex.namedAnchors ?? {}) },
      figures: [{
        sid: fig.sid,
        captionSids: [...fig.captionSids],
        captionPosition: fig.captionPosition ?? null,
        body: { tag: "svg" as const, authorId: null, value: '<svg width="40" height="20"><text>A</text></svg>', tableSid: "" },
      }],
      referenceBlocks: model.figureIndex.referenceBlocks.map(g => ({ sid: g.sid, references: g.references.map(r => ({ ...r })) })),
    };
    assert.equal(runtimeFigureTreeMatches(model.figureIndex, { ...matching, elementCount: model.elementCount }, model.elementCount), true);
    assert.equal(runtimeFigureTreeMatches(model.figureIndex, { ...matching, elementCount: (model.elementCount ?? 0) + 1 }, model.elementCount), false);
    assert.equal(runtimeFigureTreeMatches(model.figureIndex, { ...matching, ids: { ...matching.ids, injectedByScript: 1 } }), false);
    assert.equal(runtimeFigureTreeMatches(model.figureIndex, {
      ...matching,
      figures: [{ ...matching.figures[0]!, body: { tag: "svg", authorId: null, value: '<svg width="40" height="20"><text>CHANGED</text></svg>', tableSid: "" } }],
    }), false);
    assert.equal(figureIndexTreeFingerprint(model.figureIndex).length, 64);
  });
});

describe("Paket 1: tables with simple regular colspan rows", () => {
  const headerRule = RULES_BY_ID.get("layout/table-header-not-repeated")!;
  const driftRule = RULES_BY_ID.get("layout/table-column-drift")!;

  function makeColspanSnapshot(opts: { repeated?: boolean; drift?: number; groupedHeader?: boolean; irregular?: boolean; rowSpan?: number } = {}) {
    const snapshot = structuredClone(corpus[0]!.snapshot);
    const page = snapshot.pages[0]!;
    snapshot.pages = [{ ...page, pageNumber: 1, isLast: false }, { ...page, nodeKey: "p2", pageNumber: 2, isLast: true }];
    const block = snapshot.blocks[0]!;
    snapshot.blocks = [1, 2].map(n => ({
      ...block, tag: "table", sid: "s-table", nodeKey: `t${n}`, page: n,
      authorId: "grid", blockSignature: "Group Name Value Section Alpha 1", fragmentIndex: n - 1, fragmentCount: 2,
    }));
    const hGroup = {
      sid: "head-group",
      cells: [{ sid: "hg-0", tag: "th", text: "Group", box: { x: 48, y: 48, width: 360, height: 24 }, visible: true, colSpan: 2, rowSpan: 1 }],
    };
    const hCols = {
      sid: "head-cols",
      cells: [
        { sid: "hc-0", tag: "th", text: "Name", box: { x: 48, y: 72, width: 180, height: 24 }, visible: true, colSpan: 1, rowSpan: 1 },
        { sid: "hc-1", tag: "th", text: "Value", box: { x: 228, y: 72, width: 180, height: 24 }, visible: true, colSpan: 1, rowSpan: 1 },
      ],
    };
    const sepRow = {
      sid: "row-sep",
      cells: [{ sid: "rs-0", tag: "td", text: "Section A", box: { x: 48, y: 96, width: 360, height: 24 }, visible: true, colSpan: opts.irregular ? 3 : 2, rowSpan: opts.rowSpan ?? 1 }],
    };
    const shift = opts.drift ?? 0;
    const dataRow = {
      sid: "row-data",
      cells: [
        { sid: "rd-0", tag: "td", text: "Alpha", box: { x: 48, y: 48, width: 180 + shift, height: 24 }, visible: true, colSpan: 1, rowSpan: 1 },
        { sid: "rd-1", tag: "td", text: "1", box: { x: 228 + shift, y: 48, width: 180 - shift, height: 24 }, visible: true, colSpan: 1, rowSpan: 1 },
      ],
    };
    const headerRows = opts.groupedHeader ? [hGroup, hCols] : [hCols];
    const headerRowSids = headerRows.map(r => r.sid);
    snapshot.tableIndex = {
      complete: true,
      tables: [{
        sid: "s-table",
        headerRowSids,
        rows: structuredClone([...headerRows, sepRow, dataRow]),
        fragments: [
          { page: 1, flowReason: null, box: { x: 48, y: 48, width: 360, height: 96 }, rows: structuredClone([...headerRows, sepRow]), visible: true },
          { page: 2, flowReason: null, box: { x: 48, y: 48, width: 360, height: 72 }, rows: structuredClone(opts.repeated ? [...headerRows, dataRow] : [dataRow]), visible: true },
        ],
      }],
    };
    return snapshot;
  }

  it("measures full-width colspan separator rows and grouped headers cleanly", () => {
    const snap = makeColspanSnapshot({ repeated: false, groupedHeader: true, drift: 0 });
    assert.equal(tableGridColumns(snap.tableIndex!.tables[0]!), 2);
    assert.equal(sourceTableMatches(snap.tableIndex!.tables[0]!), true);

    const headerReport = runDocument({ path: "t.html", snapshot: snap, infrastructure: [] }, { activeRules: [headerRule], optionsByRule: {}, coverageFloors: {}, failOn: "warn" }).report;
    assert.equal(headerReport.coverage[headerRule.id]!.measured, 2);
    assert.equal(headerReport.findings.length, 1);
    assert.equal(headerReport.findings[0]!.page, 2);

    const alignedReport = runDocument({ path: "t.html", snapshot: snap, infrastructure: [] }, { activeRules: [driftRule], optionsByRule: {}, coverageFloors: {}, failOn: "warn" }).report;
    assert.equal(alignedReport.coverage[driftRule.id]!.measured, 2);
    assert.equal(alignedReport.findings.length, 0);

    const drifted = makeColspanSnapshot({ repeated: true, groupedHeader: true, drift: 24 });
    const driftReport = runDocument({ path: "t.html", snapshot: drifted, infrastructure: [] }, { activeRules: [driftRule], optionsByRule: {}, coverageFloors: {}, failOn: "warn" }).report;
    assert.equal(driftReport.findings.length, 1);
    assert.equal(driftReport.findings[0]!.measurement.value, 24);
  });

  it("declines irregular colspan sums and rowspan > 1 explicitly", () => {
    for (const snap of [makeColspanSnapshot({ irregular: true }), makeColspanSnapshot({ rowSpan: 2 })]) {
      assert.equal(sourceTableMatches(snap.tableIndex!.tables[0]!), false);
      const report = runDocument({ path: "t.html", snapshot: snap, infrastructure: [] }, { activeRules: [headerRule, driftRule], optionsByRule: {}, coverageFloors: {}, failOn: "warn" }).report;
      assert.equal(report.verdict, "insufficient-coverage");
      assert.equal(report.findings.length, 0);
      assert.ok(report.notMeasured.every(n => n.reason === "env/table-structure-unsupported"));
    }
  });
});

describe("Paket 1: G-78 parity-blank page evidence verification", () => {
  const VALID_PNG = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);
  function fakePage(marks: unknown[], unplacedMarks: unknown[] = []): PageLike {
    return {
      async evaluate(source: string) {
        if (source.startsWith("window.__blOverlayControl(")) {
          if (source.includes('"install"')) return { value: { marks, unplacedMarks, layers: 2, staticPageAreas: 0 }, unauthorizedCalls: 0 };
          if (source.includes('"readback"')) return { value: [], unauthorizedCalls: 0 };
          if (source.includes('"detach"')) return { value: 2, unauthorizedCalls: 0 };
          if (source.includes('"remove"')) return { value: 2, unauthorizedCalls: 0 };
        }
        return "cap-token";
      },
      async pdf() { return new Uint8Array(Buffer.from("%PDF-1.4\n")); },
    } as unknown as PageLike;
  }
  function fakeRasterizer(textPages: { pageNumber: number; widthPt: number; heightPt: number; items: { text: string; x: number; y: number }[] }[]): Rasterizer {
    return {
      async rasterise() { return textPages.map(() => ({ width: 1, height: 1 })); },
      async diff() { return { pixels: 0, pagesA: textPages.length, pagesB: textPages.length }; },
      async textItems() { return textPages; },
      async encodePng() { return VALID_PNG; },
      async dropPixels() {},
      async release() {},
      pageErrors() { return []; },
      async close() {},
    } as unknown as Rasterizer;
  }

  it("verifies a confirmed parity-blank page alongside a verified content page and fails closed on negative controls", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "breaklint-g78-"));
    try {
      const marks = [
        { token: "BLSID000A", sid: "s1", fragmentOrdinal: 0, side: "start", page: 1, xPx: 96, yPx: 96 },
        { token: "BLSID000E", sid: "s1", fragmentOrdinal: 0, side: "end", page: 1, xPx: 96, yPx: 144 },
      ];
      const textPages = [
        { pageNumber: 1, widthPt: 595, heightPt: 842, items: [{ text: "BLSID000A", x: 72, y: 770 }, { text: "BLSID000E", x: 72, y: 734 }] },
        { pageNumber: 2, widthPt: 595, heightPt: 842, items: [] },
      ];
      const ok = await produceEvidence({
        page: fakePage(marks),
        closePage: async () => {},
        rasterizer: fakeRasterizer(textPages),
        options: { outDir, documentKey: "ok", binding: true, blankPages: new Set([2]) },
      });
      assert.equal(ok.evidence[0]!.bindsFinding, true);
      assert.equal(ok.evidence[1]!.bindsFinding, true);
      assert.equal(ok.evidence[1]!.pdfConformance, "verified");

      // Negative control 1: non-blank zero-mark page stays unverified.
      const nonBlank = await produceEvidence({
        page: fakePage(marks),
        closePage: async () => {},
        rasterizer: fakeRasterizer(textPages),
        options: { outDir, documentKey: "nonblank", binding: true, blankPages: new Set() },
      });
      assert.equal(nonBlank.evidence[1]!.bindsFinding, false);

      // Negative control 2: all-blank document with zero verified content pages stays unverified.
      const allBlank = await produceEvidence({
        page: fakePage([]),
        closePage: async () => {},
        rasterizer: fakeRasterizer([{ pageNumber: 1, widthPt: 595, heightPt: 842, items: [] }]),
        options: { outDir, documentKey: "allblank", binding: true, blankPages: new Set([1]) },
      });
      assert.equal(allBlank.evidence[0]!.bindsFinding, false);

      // Negative control 3: blank page with stray mark token in PDF stays unverified.
      const strayMark = await produceEvidence({
        page: fakePage(marks),
        closePage: async () => {},
        rasterizer: fakeRasterizer([textPages[0]!, { pageNumber: 2, widthPt: 595, heightPt: 842, items: [{ text: "BLSID999A", x: 72, y: 770 }] }]),
        options: { outDir, documentKey: "stray", binding: true, blankPages: new Set([2]) },
      });
      assert.equal(strayMark.evidence[1]!.bindsFinding, false);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
