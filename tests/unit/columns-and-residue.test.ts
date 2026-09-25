/**
 * Multi-column content found through its ancestor, fragmented boxes in the geometry cross-check,
 * and pages withdrawn because Paged.js left content past the page box.
 *
 * THREE DEFECTS, ONE CLASS. Each is a box the browser split into fragments, and each was handled
 * as if it were one box:
 *
 *   - The geometry cross-check compared `getBoundingClientRect` — the UNION of a box's fragments —
 *     with CDP's box model, which describes a fragmented box as none of them. A paragraph split
 *     across two author columns, or into Paged.js's overflow column, ended the whole run in exit 3,
 *     and the event could blame another page than the one the failing sample was on.
 *   - The multi-column decline was keyed on the block's OWN `column-count`, which is not inherited:
 *     the paragraphs inside a two-column section were measured on their column union, or killed the
 *     run through the cross-check.
 *   - Text Paged.js stranded in its overflow column is missing from the PDF (20 of 1136 words on the
 *     public residue fixture, measured with pdftotext) and was never reported: once the cross-check
 *     no longer refused such a document, it came back measured, clean if nothing else fired.
 *
 * What runs here is the production code: `crossCheckPage` against a fake CDP session answering the
 * numbers Chromium 141 measured, the real in-page `SNAPSHOT_SOURCE` over a hand-authored Paged.js
 * page tree (`tests/fixtures/paged-dom.ts`), `assembleSnapshot`, every registered rule and the
 * engine. The live halves are in `tests/live/render-run.test.ts` and `tests/live/measure.test.ts`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { crossCheckPage, pdfReconciliationDetail } from "../../src/acquire/render-run.ts";
import type { PageLike } from "../../src/acquire/browser.ts";
import { runDocument } from "../../src/core/engine.ts";
import { fingerprint } from "../../src/core/fingerprint.ts";
import type { BlockRecord, NotMeasured, PageRecord, Snapshot, SvgRecord, TextLine } from "../../src/core/types.ts";
import { coverageFloorMap, resolveConfig } from "../../src/config/resolve.ts";
import {
  compareGeometry, crossCheckEvent, fragmentUnion, type GeometrySample, type GeometrySampleBatch,
} from "../../src/measure/cross-check.ts";
import type { FragmentainerReport } from "../../src/measure/fragmentainer.ts";
import {
  assembleSnapshot, buildSourceModel, inputIdentity, pageResidueWithdrawal, rootColumnsWithdrawal, SNAPSHOT_SOURCE,
  validateSnapshotInvariants, type RawSnapshot,
} from "../../src/measure/snapshot.ts";
import { COLLECTOR_SOURCE, type CollectorResult } from "../../src/paginate/collector.ts";
import { ALL_RULES } from "../../src/rules/index.ts";
import { straightQuotes } from "../../src/rules/type/straight-quotes.ts";
import { excessiveWordSpacing } from "../../src/rules/type/excessive-word-spacing.ts";
import { blockOutOfScope, pageWithdrawal } from "../../src/rules/shared.ts";
import { buildReport } from "../../src/core/build-report.ts";
import { toReportConfig } from "../../src/config/resolve.ts";
import { render } from "../../src/report/index.ts";
import { injectSourceIds } from "../../src/source/inject.ts";
import { evaluatePayload, fakeDocument, pagedDocument, pagedPage, runCollector } from "../fixtures/paged-dom.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));

// ---- the cross-check through crossCheckPage, against a fake CDP session -------------------------

type Rect = readonly [number, number, number, number];
const quad = ([x, y, w, h]: Rect) => [x, y, x + w, y, x + w, y + h, x, y + h];
const boxOf = ([x, y, width, height]: Rect) => ({ x, y, width, height });

interface FakeNode { border: Rect; quads: readonly Rect[] | "throws" }

/**
 * A page whose in-page sample and whose CDP answers are both authored. The in-page batch is what
 * `geometrySampleSource` returns in the browser; the session answers the four DOM methods
 * `crossCheckPage` calls. Nothing is stubbed inside the function under test.
 */
function fakePage(samples: readonly GeometrySample[], nodes: Readonly<Record<string, FakeNode>>): PageLike {
  const batch: GeometrySampleBatch = {
    samples: [...samples], candidates: samples.length, eligible: samples.length,
    excludedSvgDescendants: 0, excludedInlineBlockContainers: 0,
  };
  const ids = Object.keys(nodes);
  const session = {
    async send<R>(method: string, params: Record<string, unknown> = {}): Promise<R> {
      if (method === "DOM.enable") return {} as R;
      if (method === "DOM.getDocument") return { root: { nodeId: 1 } } as R;
      if (method === "DOM.querySelectorAll") {
        const key = ids.find((id) => (params.selector as string).includes(JSON.stringify(id)));
        return { nodeIds: key ? [ids.indexOf(key) + 2] : [] } as R;
      }
      const node = nodes[ids[(params.nodeId as number) - 2]!]!;
      if (method === "DOM.getBoxModel") return { model: { border: quad(node.border) } } as R;
      if (method === "DOM.getContentQuads") {
        if (node.quads === "throws") throw new Error("Could not compute content quads.");
        return { quads: node.quads.map(quad) } as R;
      }
      throw new Error(`fake CDP: unexpected ${method}`);
    },
    async detach(): Promise<void> {},
  };
  return {
    evaluate: async <T>() => batch as T,
    createCDPSession: async () => session,
  } as unknown as PageLike;
}

/** An in-page sample the way the in-page probe builds it: the union and every fragment. */
function sample(id: string, page: number, fragments: readonly Rect[]): GeometrySample {
  const union = fragmentUnion(fragments.map(boxOf))!;
  return {
    key: `data-bl-sid:${id}#0`, ...union, selector: `.pagedjs_page [data-bl-sid=${JSON.stringify(id)}]`,
    occurrence: 0, page, fragments: fragments.map(boxOf),
  };
}

/**
 * Measured on Chromium 141 on `tests/fixtures/fragmentainer-residue.html`, page 1: the paragraph
 * whose last two lines Paged.js left in the overflow column. `getClientRects()` and CDP's
 * `DOM.getContentQuads` agree exactly; CDP's border quad has the first fragment's x and width and
 * the height of the whole unfragmented flow (154.25 + 59.375).
 */
const STRANDED: readonly Rect[] = [[120, 805.75, 576, 154.25], [1936, 96, 576, 59.375]];
const STRANDED_BORDER: Rect = [120, 805.75, 576, 213.625];
/** An unfragmented heading on page 2 (binary-exact numbers, so the comparison can demand 0). */
const PLAIN: Rect = [120, 1170, 576, 29.703125];

describe("the geometry cross-check compares a fragmented box fragment by fragment", () => {
  it("passes a column-split box whose fragments agree, where comparing the union with the box model failed", async () => {
    // RED BEFORE THIS CHANGE: the union (120, 96, 2392 x 864) was compared with the border quad,
    // and the width alone differed by 1816 px -- one column pitch.
    const result = await crossCheckPage(fakePage(
      [sample("s0001", 1, STRANDED), sample("s0002", 2, [PLAIN])],
      { s0001: { border: STRANDED_BORDER, quads: STRANDED }, s0002: { border: PLAIN, quads: [PLAIN] } },
    ));
    assert.equal(result.ok, true, JSON.stringify(result.disagreements));
    assert.equal(result.checked, 2);
    assert.equal(result.fragmentedSamples, 1, "the split box was not compared fragment by fragment");
    assert.equal(result.maxDelta, 0);
  });

  it("catches a fragment the layout tree places elsewhere, although the union and the box model agree", async () => {
    // The second fragment is 9.375 px shorter in the probe. It is not the fragment that sets the
    // union's top or bottom, so the union -- and anything compared only against it -- agrees.
    const probe = sample("s0001", 1, [STRANDED[0]!, [1936, 96, 576, 50]]);
    assert.deepEqual(boxOf([probe.x, probe.y, probe.width, probe.height]), fragmentUnion(STRANDED.map(boxOf)));
    const result = await crossCheckPage(fakePage([probe], { s0001: { border: STRANDED_BORDER, quads: STRANDED } }));
    assert.equal(result.ok, false, "a fragment disagreement was absorbed");
    assert.deepEqual(
      result.disagreements.map((d) => [d.field, d.fragment, d.page]),
      [["height", 1, 1]],
    );
  });

  it("fails when the two sources do not agree on how many fragments a box has", async () => {
    // The probe saw one box where the layout tree has two: it is describing another layout.
    const probe = sample("s0001", 1, [[120, 96, 2392, 864]]);
    const result = await crossCheckPage(fakePage([probe], { s0001: { border: STRANDED_BORDER, quads: STRANDED } }));
    assert.equal(result.ok, false);
    assert.ok(result.disagreements.some((d) => d.field === "fragments" && d.inPage === 1 && d.outOfProcess === 2),
      JSON.stringify(result.disagreements));
    assert.match(crossCheckEvent(result).detail, /do not even agree on how many fragments/u);
  });

  it("fails when CDP cannot list the fragments, instead of falling back to the box model", async () => {
    const result = await crossCheckPage(fakePage([sample("s0002", 2, [PLAIN])], { s0002: { border: PLAIN, quads: "throws" } }));
    assert.equal(result.ok, false, "a missing fragment list passed on the border quad alone");
    assert.equal(result.disagreements[0]?.field, "fragments");
  });

  it("still compares an unfragmented box with CDP's border quad, at the same tolerance", async () => {
    const off: Rect = [PLAIN[0] + 0.06, PLAIN[1], PLAIN[2], PLAIN[3]];
    const result = await crossCheckPage(fakePage([sample("s0002", 2, [PLAIN])], { s0002: { border: off, quads: [PLAIN] } }));
    assert.equal(result.ok, false, "the box-model oracle for an ordinary box was lost");
    assert.deepEqual(result.disagreements.map((d) => [d.field, d.fragment]), [["x", undefined]]);
  });

  it("forms the union as Chromium does: an empty fragment does not enlarge it", () => {
    // Measured: the Paged.js wrapper of page 1 has fragments (96, 96, 624 x 864) and
    // (1912, 96, 624 x 0) and a bounding rect 624 px wide.
    assert.deepEqual(fragmentUnion([boxOf([96, 96, 624, 864]), boxOf([1912, 96, 624, 0])]), boxOf([96, 96, 624, 864]));
    assert.equal(fragmentUnion([boxOf([1912, 96, 624, 0])]), null);
  });

  it("names the page of the disagreeing samples and attaches residue only from that page", () => {
    const probe = [{ key: "a", x: 0, y: 0, width: 10, height: 10, page: 1 }];
    const other = [{ key: "a", x: 5, y: 0, width: 10, height: 10 }];
    const result = compareGeometry(probe, other);
    const residue = (pages: number[]): FragmentainerReport => ({
      pages, count: 1, atomicCount: 1, pitchPx: 1816,
      sample: [{ page: pages[0]!, column: 1, tag: "TR", display: "table-row", sourceId: "s9", text: "row" }],
    });
    // Before this change the sentence named the residue probe's page 4 for a failure on page 1.
    const elsewhere = crossCheckEvent(result, residue([4]));
    assert.match(elsewhere.detail, /sampled on page\(s\) 1,/u);
    assert.doesNotMatch(elsewhere.detail, /Paged\.js left/u, "a cause from another page was attached");
    assert.deepEqual((elsewhere.measured as { failedPages: number[] }).failedPages, [1]);
    const here = crossCheckEvent(result, residue([1]));
    assert.match(here.detail, /Paged\.js left 1 element\(s\) \(TR\) in an overflow column of page\(s\) 1/u);
  });
});

// ---- the collector over a hand-authored Paged.js page tree ---------------------------------------

const STRIDE = 700;
const pageBox = (index: number) => [0, index * STRIDE, 566.93, 453.54] as const;
const contentBox = (index: number) => [56.69, 56.69 + index * STRIDE, 453.53, 340.16] as const;
const at = (index: number, line: number, x = 56.69, width = 200) => `${x} ${56.69 + index * STRIDE + line * 18.66} ${width} 18.66`;

function sources(html: string): { injected: ReturnType<typeof injectSourceIds>; sid: Record<string, string> } {
  const injected = injectSourceIds(html, "columns.html");
  const sid: Record<string, string> = {};
  for (const [id, ref] of Object.entries(injected.map)) {
    const author = /\bid="([^"]+)"/u.exec(html.slice(ref.offset, ref.offset + 200))?.[1];
    if (author) sid[author] = id;
  }
  return { injected, sid };
}

function assemble(raw: RawSnapshot, collector: CollectorResult, injected: ReturnType<typeof injectSourceIds>): Snapshot {
  const snapshot = assembleSnapshot({
    raw, collector,
    sourceModel: buildSourceModel(injected.html, "columns.html"),
    sourceMap: injected.map, sourceMapInjection: true,
    renderer: "fake", browserVersion: "fake", pagedjsVersion: "0.4.3", platform: "test", locale: "en-US",
    freezeSignature: "fake", freezeRetries: 0,
    inputIdentity: inputIdentity({ html: injected.html, browserVersion: "fake", platform: "test", fontFamilies: [], resources: [] }),
    evidenceOverlayApplied: false, resources: [],
  });
  const invariants = validateSnapshotInvariants(snapshot, { sourceMapInjection: true });
  assert.equal(invariants.ok, true, invariants.issues.join("; "));
  return snapshot;
}

const COLUMNS_SOURCE = `<!doctype html><html lang="en"><body>
<p id="plain">Plain paragraph.</p>
<section id="duo"><h2 id="span">Across</h2><p id="in-duo">In two columns.</p><div id="deep"><h3 id="deep-span">Deep spanner</h3></div><h2 id="float-span">Floated</h2></section>
<section id="narrow"><p id="in-narrow">In width-only columns.</p></section>
<section id="one"><p id="in-one">In one column.</p></section>
</body></html>`;

function columnsPage(sid: Record<string, string>): string {
  const s = (id: string, style = "", line = 0) =>
    `id="${id}" data-bl-sid="${sid[id]}" data-ref="ref-${id}" data-test-box="${at(0, line)}"${style ? ` style="${style}"` : ""}`;
  return pagedPage({
    pageBox: pageBox(0), contentBox: contentBox(0),
    content:
      `<p ${s("plain")}>Plain paragraph.</p>` +
      `<section ${s("duo", "column-count: 2", 1)}>` +
      `<h2 ${s("span", "column-span: all", 1)}>Across</h2>` +
      `<p ${s("in-duo", "", 2)}>In two columns.</p>` +
      `<div ${s("deep", "", 3)}><h3 ${s("deep-span", "column-span: all", 3)}>Deep spanner</h3></div>` +
      `<h2 ${s("float-span", "column-span: all; float: left", 4)}>Floated</h2>` +
      `</section>` +
      `<section ${s("narrow", "column-width: 11em", 5)}><p ${s("in-narrow", "", 5)}>In width-only columns.</p></section>` +
      `<section ${s("one", "column-count: 1", 6)}><p ${s("in-one", "", 6)}>In one column.</p></section>`,
  });
}

describe("multi-column content is found through the ancestor", () => {
  it("marks every block set in an ancestor's columns, and only those", () => {
    const { sid } = sources(COLUMNS_SOURCE);
    const raw = evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, pagedDocument([columnsPage(sid)]));
    const flag = (id: string) => {
      const block = raw.blocks.find((b) => b.sid === sid[id]);
      assert.ok(block, `${id} was not recorded`);
      return block.effectiveStyle.multicolAncestor;
    };
    // The Paged.js page content is itself a multi-column fragmentainer; a walk that did not stop at
    // the page structure would put every block of every document in columns.
    assert.equal(flag("plain"), false, "the page's own fragmentainer counted as an author multi-column container");
    // The container's OWN columns are its own column-count ("2"), not an ancestor's.
    assert.equal(flag("duo"), false);
    assert.equal(raw.blocks.find((b) => b.sid === sid.duo)!.effectiveStyle.columns, "2");
    // RED BEFORE THIS CHANGE: the field did not exist, and the paragraph's own column-count is auto.
    assert.equal(flag("in-duo"), true, "a paragraph inside a two-column section was not recognised");
    assert.equal(raw.blocks.find((b) => b.sid === sid["in-duo"])!.effectiveStyle.columns, "auto");
    // column-width alone makes a multi-column container; column-count stays auto.
    assert.equal(flag("in-narrow"), true, "width-only columns were not recognised");
    // column-count: 1 with an auto width is one column, as layoutOutOfScope has always read it.
    assert.equal(flag("in-one"), false);
    // A column-span: all direct child lies across the columns, outside them.
    assert.equal(flag("span"), false, "an honoured spanner was declined as in-column content");
    // A spanner one level down, and a floated one, are not recognised as honoured: declined.
    assert.equal(flag("deep"), true);
    assert.equal(flag("deep-span"), true, "a nested spanner was taken as honoured");
    assert.equal(flag("float-span"), true, "a floated spanner was taken as honoured");
  });

  it("the spanner's subtree is judged by the containers above it", () => {
    const html = `<!doctype html><html lang="en"><body><section id="outer"><div id="spanner"><p id="inside">Inside the spanner.</p></div></section></body></html>`;
    const { sid } = sources(html);
    const s = (id: string, style = "") => `id="${id}" data-bl-sid="${sid[id]}" data-ref="ref-${id}" data-test-box="${at(0, 0)}"${style ? ` style="${style}"` : ""}`;
    const tree = (outer: string) => pagedDocument([pagedPage({
      pageBox: pageBox(0), contentBox: contentBox(0),
      content: `<section ${s("outer", outer)}><div ${s("spanner", "column-span: all")}><p ${s("inside")}>Inside the spanner.</p></div></section>`,
    })]);
    const inside = (outer: string) => evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, tree(outer))
      .blocks.find((b) => b.sid === sid.inside)!.effectiveStyle.multicolAncestor;
    assert.equal(inside("column-count: 3"), false, "content of an honoured spanner was declined");
    // The spanner itself sets columns of its own here: its paragraph IS in columns again.
    const nested = pagedDocument([pagedPage({
      pageBox: pageBox(0), contentBox: contentBox(0),
      content: `<section ${s("outer", "column-count: 3")}><div ${s("spanner", "column-span: all; column-count: 2")}><p ${s("inside")}>Inside the spanner.</p></div></section>`,
    })]);
    assert.equal(evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, nested).blocks.find((b) => b.sid === sid.inside)!.effectiveStyle.multicolAncestor, true);
  });
});

// ---- the residue census and the page withdrawal ------------------------------------------------

const RESIDUE_SOURCE = `<!doctype html><html lang="en"><body>
<p id="p1">First page.</p><p id="stranded">A paragraph whose tail was left past the page.</p>
<p id="p2">Second page.</p><p id="note">A margin note inside the page box.</p>
<p id="p3">Third page.</p><img id="figure" alt="">
<p id="p4">Fourth page, right to left.</p><p id="left">Past the left edge.</p>
<p id="p5">Fifth page, right to left.</p><p id="right">Past the right edge of a right-to-left page.</p>
</body></html>`;

function residuePages(sid: Record<string, string>): string[] {
  // An <img> is not a source block and carries no injected id.
  const s = (id: string, box: string, tag = "p") => tag === "img"
    ? `<img id="${id}" data-test-box="${box}"`
    : `<${tag} id="${id}" data-bl-sid="${sid[id]}" data-ref="ref-${id}" data-test-box="${box}"`;
  const past = (index: number) => pageBox(index)[0] + pageBox(index)[2] + 1113.39; // one pitch past the page
  const rtl = (html: string) => html.replace('class="pagedjs_page_content"', 'class="pagedjs_page_content" style="direction: rtl"');
  return [
    pagedPage({ pageBox: pageBox(0), contentBox: contentBox(0),
      content: `${s("p1", at(0, 0))}>First page.</p>${s("stranded", at(0, 0, past(0)))}>A paragraph whose tail was left past the page.</p>` }),
    // Past the content box (right edge 510.22) but inside the page box (566.93): printed.
    pagedPage({ pageBox: pageBox(1), contentBox: contentBox(1),
      content: `${s("p2", at(1, 0))}>Second page.</p>${s("note", at(1, 1, 515, 50))}>A margin note inside the page box.</p>` }),
    pagedPage({ pageBox: pageBox(2), contentBox: contentBox(2),
      content: `${s("p3", at(2, 0))}>Third page.</p>${s("figure", at(2, 1, past(2)), "img")}>` }),
    rtl(pagedPage({ pageBox: pageBox(3), contentBox: contentBox(3),
      content: `${s("p4", at(3, 0))}>Fourth page, right to left.</p>${s("left", at(3, 1, -1400, 200))}>Past the left edge.</p>` })),
    rtl(pagedPage({ pageBox: pageBox(4), contentBox: contentBox(4),
      content: `${s("p5", at(4, 0))}>Fifth page, right to left.</p>${s("right", at(4, 1, past(4)))}>Past the right edge of a right-to-left page.</p>` })),
  ];
}

describe("a page whose content lies past its page box is withdrawn", () => {
  const { injected, sid } = sources(RESIDUE_SOURCE);
  const document = pagedDocument(residuePages(sid));
  const raw = evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, document);
  const snapshot = assemble(raw, runCollector<CollectorResult>(COLLECTOR_SOURCE, document), injected);

  it("counts text and replaced elements past the page box in the column progression, and nothing inside it", () => {
    assert.deepEqual(raw.pages.map((page) => page.overflowResidue), [
      { textRects: 1, replacedElements: 0, clippedExempt: 0 },
      // The margin note is past the content box and inside the page box: printed, not residue.
      { textRects: 0, replacedElements: 0, clippedExempt: 0 },
      { textRects: 0, replacedElements: 1, clippedExempt: 0 },
      // Right to left, the overflow column lies to the LEFT of the page.
      { textRects: 1, replacedElements: 0, clippedExempt: 0 },
      { textRects: 0, replacedElements: 0, clippedExempt: 0 },
    ]);
  });

  it("withdraws exactly those pages, with a coverage-counted page row, and does not persist the census", () => {
    // RED BEFORE THIS CHANGE: pages[].notMeasured was always [].
    assert.deepEqual(
      snapshot.pages.map((page) => page.notMeasured.map((n) => [n.scope, n.ruleId, n.reason, n.target?.nodeKey, n.count])),
      [[["page", null, "env/pagination-residue", "page:1", 1]], [], [["page", null, "env/pagination-residue", "page:3", 1]],
        [["page", null, "env/pagination-residue", "page:4", 1]], []],
    );
    assert.ok(snapshot.pages.every((page) => !("overflowResidue" in page)), "the raw census leaked into the snapshot");
    assert.deepEqual(pageResidueWithdrawal(7, undefined), []);
    assert.deepEqual(pageResidueWithdrawal(7, { textRects: 0, replacedElements: 0 }), []);
    // An exemption leaves a trace: a page row that withdraws nothing.
    assert.deepEqual(pageResidueWithdrawal(7, { textRects: 0, replacedElements: 0, clippedExempt: 3 })
      .map((row) => [row.scope, row.ruleId, row.reason, row.count]), [["page", null, "env/clipped-past-page", 3]]);
  });

  it("every page-located rule declines its candidates there, and the document cannot end clean", () => {
    const config = resolveConfig({ file: {}, cli: {} });
    const outcome = runDocument({ path: "residue.html", snapshot, infrastructure: [] }, {
      failOn: config.failOn, activeRules: config.activeRules, optionsByRule: config.optionsByRule,
      coverageFloors: coverageFloorMap(config),
    });
    assert.equal(outcome.report.verdict, "insufficient-coverage");
    assert.equal(outcome.report.exitReason, "page(s) 1, 3, 4 withdrawn from measurement (env/pagination-residue)");
    // Pages 1, 3 and 4 themselves, and page 2 because the judgement reads page 3's opening lines.
    const continuation = outcome.report.coverage["layout/orphaned-continuation-page"]!;
    assert.deepEqual(continuation.notMeasured.map((n) => [n.reason, n.count]), [["env/pagination-residue", 4]]);
    assert.equal(continuation.measured, 1);
    assert.deepEqual(
      outcome.report.notMeasured.filter((n) => n.ruleId === null).map((n) => [n.scope, n.reason, n.count]),
      [["page", "env/pagination-residue", 3]],
    );
  });
});

// ---- the rules and the engine over a hand-authored snapshot ------------------------------------

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

function page(n: number, notMeasured: NotMeasured[] = []): PageRecord {
  return {
    pageNumber: n, nodeKey: `page:${n}`, epoch: 0, blank: false, isLast: n === 2,
    contentBox: box(48, 48 + (n - 1) * 700, 399, 606), pageBox: box(0, (n - 1) * 700, 495, 700), marginBoxes: [],
    incomingBreakCause: n === 1
      ? { kind: "document-start", determinedBy: "document-boundary", cascadeHint: null }
      : { kind: "overflow", determinedBy: "break-token", cascadeHint: null },
    outgoingBreakCause: n === 2
      ? { kind: "document-end", determinedBy: "document-boundary", cascadeHint: null }
      : { kind: "overflow", determinedBy: "break-token", cascadeHint: null },
    fill: { vertical: 0.9, topGap: 0.02, net: 0.3, area: 1 },
    firstSemanticBlockKey: `sig:page${n}`,
    notMeasured,
  };
}

const withdrawnRow = (n: number): NotMeasured => ({
  scope: "page", ruleId: null, reason: "env/pagination-residue", target: { keyType: "page", nodeKey: `page:${n}`, sid: null }, count: 1,
});

const tagDisplay = (_tag: string) => "block";

function block(id: string, over: Partial<BlockRecord> & { style?: Partial<BlockRecord["effectiveStyle"]> } = {}): BlockRecord {
  const { style, ...rest } = over;
  return {
    nodeKey: id, sid: `s-${id}`, authorId: null, blockSignature: `signature of ${id}`,
    fragmentIndex: 0, fragmentCount: 1, page: 1, box: box(48, 60, 399, 60), tag: "p", classList: [],
    lineHeight: 15.4, spaceWidth: 4.2,
    effectiveStyle: {
      breakInside: "auto", breakBefore: "auto", breakAfter: "auto", columns: "auto", columnWidth: "auto",
      multicolAncestor: false, writingMode: "horizontal-tb",
      visibility: "visible", widows: 2, orphans: 2, textAlign: "justify", wordSpacing: "normal", fontFamily: "serif",
      fontSize: 11, lineHeight: 15.4, lang: "en", ...style,
    },
    lines: [0], display: tagDisplay(rest.tag ?? "p"), marginCopies: 0, ...rest,
  };
}

function line(blockKey: string, index: number, y: number, width = 399): TextLine {
  return {
    blockKey, index, box: box(48, y, width, 15.4), visible: true, width,
    wordBoxes: [{ text: "word", x: 48, y, width: 30, height: 15.4 }, { text: "word", x: 48 + width - 30, y, width: 30, height: 15.4 }],
  };
}

/**
 * One snapshot that gives every registered rule at least one candidate: a justified
 * `break-inside: avoid` paragraph split across two pages (widow, orphan, hyphen-across-page,
 * unbreakable-block-too-tall, excessive-word-spacing, short-last-line), a heading, two pages, an SVG
 * label, a text run with a straight quote, a spaced hyphen, and a URI reference.
 */
function everyRuleSnapshot(input: { multicol: boolean; withdrawn: readonly number[] }): Snapshot {
  const style = { breakInside: "avoid", multicolAncestor: input.multicol };
  const svg: SvgRecord = {
    nodeKey: "svg:0:1", page: 1, sourceKey: "svgsig:chart", measurable: true, reason: null,
    viewportScreen: box(48, 300, 300, 200), overflow: "hidden", textTargetCount: 1, textTargetsCapped: false,
    unreadableTargets: 0, unsupportedTargets: 0, notRenderedTargets: 0,
    texts: [{
      targetKey: "bt0", svgTextKey: "svg:svgsig:chart|id:label", sourceAddressKey: null, boxScreen: box(60, 320, 80, 12),
      clipState: "none", ambiguityGroupSize: 1,
      ink: { T: { count: 0, maskHash: "" }, T0: { count: 0, maskHash: "" } },
    }],
    shapes: [], paths: [], inkPasses: { E: { count: 0, maskHash: "" }, S: { count: 0, maskHash: "" }, F: { count: 0, maskHash: "" } },
    inkCollected: false, inkStable: false,
  };
  return {
    schemaVersion: 5,
    meta: {
      renderer: null, browserVersion: "", pagedjsVersion: "0.4.3", platform: "", locale: "de-DE", inputIdentity: null,
      freezeSignature: "fixture", freezeRetries: 0, epochCount: 1, interventions: [],
    },
    source: {
      map: {}, parser: "fixture", complete: true, injectedAttribute: "data-bl-sid", collisionChecked: true,
      input: { identityStatus: "unknown", rawBytesSha256: null, byteLength: null, encoding: null, complete: false },
      provenance: { binding: "unavailable", copyIntegrity: "unavailable", sourceRole: "unknown", producerId: null, receiptHash: null, diagnostics: [] },
    },
    pages: [1, 2].map((n) => page(n, input.withdrawn.includes(n) ? [withdrawnRow(n)] : [])),
    blocks: [
      block("h", { tag: "h2", box: box(48, 40, 399, 20), style: { ...style, breakInside: "auto" } }),
      block("a", { fragmentIndex: 0, fragmentCount: 2, page: 1, box: box(48, 600, 399, 46.2), lines: [0, 1, 2], style }),
      block("b", { sid: "s-a", fragmentIndex: 1, fragmentCount: 2, page: 2, box: box(48, 748, 399, 30.8), lines: [3, 4], style }),
    ],
    textLines: [
      line("h", 0, 40), line("a", 0, 600), line("a", 1, 615.4), { ...line("a", 2, 630.8), wordBoxes: [{ text: "hy-", x: 48, y: 630.8, width: 30, height: 15.4 }] },
      line("b", 3, 748), line("b", 4, 763.4, 40),
    ],
    textRuns: [
      { blockKey: "a", text: "ein \"gerades\" Zeichen - und ein Bindestrich", nodeType: "text", ancestorTags: ["p", "body"], lang: "de", excluded: false },
    ],
    svg: [svg],
    uriRefs: [{
      nodeKey: "a", attribute: "href", rawValue: "file:///x", resolvedUri: "file:///x", scheme: "file", origin: "file://",
      requested: false, insideDistributionRoot: false,
    }],
    resources: [],
    notMeasured: [],
  } as Snapshot;
}

function declinedBy(snapshot: Snapshot, reason: string): { declining: string[]; withCandidates: string[] } {
  const declining: string[] = [];
  const withCandidates: string[] = [];
  for (const rule of ALL_RULES) {
    const result = rule.run(snapshot, { documentPath: "matrix.html", options: rule.defaultOptions, fingerprint });
    if (result.candidates > 0) withCandidates.push(rule.id);
    if (result.notMeasured.some((n) => n.reason === reason)) declining.push(rule.id);
  }
  return { declining: declining.sort(), withCandidates: withCandidates.sort() };
}

/** The support matrix as `docs/limitations.md` publishes it, between its markers. */
function publishedMatrix(): Map<string, { multicol: string; withdrawn: string }> {
  const text = readFileSync(`${REPO}/docs/limitations.md`, "utf8");
  const start = text.indexOf("<!-- breaklint-column-matrix-v1 -->");
  const end = text.indexOf("<!-- /breaklint-column-matrix-v1 -->");
  assert.ok(start >= 0 && end > start, "docs/limitations.md lost its column-support matrix markers");
  const rows = new Map<string, { multicol: string; withdrawn: string }>();
  for (const row of text.slice(start, end).split("\n")) {
    const cells = /^\| `([a-z]+\/[a-z-]+)` \| (\w+)[^|]*\| (\w+)[^|]*\|/u.exec(row);
    if (cells) rows.set(cells[1]!, { multicol: cells[2]!, withdrawn: cells[3]! });
  }
  return rows;
}

describe("which rules decline, rule by rule, as published", () => {
  const matrix = publishedMatrix();

  it("the published matrix names every registered rule once, with a decision in both columns", () => {
    assert.deepEqual([...matrix.keys()].sort(), ALL_RULES.map((rule) => rule.id).sort());
    for (const [id, row] of matrix) {
      assert.ok(["declined", "measured"].includes(row.multicol) && ["declined", "measured"].includes(row.withdrawn), `${id}: ${JSON.stringify(row)}`);
    }
  });

  it("content in an ancestor's columns is declined by exactly the rules the matrix names", () => {
    const control = declinedBy(everyRuleSnapshot({ multicol: false, withdrawn: [] }), "env/multicolumn");
    assert.deepEqual(control.declining, [], "the single-column control declined");
    assert.deepEqual(control.withCandidates, ALL_RULES.map((rule) => rule.id).sort(), "a rule has no candidate, so its row proves nothing");
    const inColumns = declinedBy(everyRuleSnapshot({ multicol: true, withdrawn: [] }), "env/multicolumn");
    assert.deepEqual(inColumns.declining, [...matrix].filter(([, row]) => row.multicol === "declined").map(([id]) => id).sort());
    assert.equal(inColumns.declining.length, 7);
  });

  it("a withdrawn page is declined by exactly the rules the matrix names", () => {
    const both = declinedBy(everyRuleSnapshot({ multicol: false, withdrawn: [1, 2] }), "env/pagination-residue");
    assert.deepEqual(both.declining, [...matrix].filter(([, row]) => row.withdrawn === "declined").map(([id]) => id).sort());
    assert.equal(both.declining.length, 9);
  });

  it("a split block is withdrawn from the height sum when any fragment's page is, and only there", () => {
    // Page 2 only: the continuation fragment of the avoid block lies there.
    const snapshot = everyRuleSnapshot({ multicol: false, withdrawn: [2] });
    const byRule = (id: string) => ALL_RULES.find((rule) => rule.id === id)!
      .run(snapshot, { documentPath: "x.html", options: ALL_RULES.find((rule) => rule.id === id)!.defaultOptions, fingerprint });
    // The height of a split block is judged across its fragments at fragment 0 (page 1).
    assert.deepEqual(byRule("layout/unbreakable-block-too-tall").notMeasured.map((n) => n.reason), ["env/pagination-residue"]);
    // The orphan fragment is on page 1 and is judged there: a withdrawn page 2 does not change it.
    assert.deepEqual(byRule("layout/orphan").notMeasured, []);
    // The continuation-page judgement of page 1 reads the opening lines of page 2.
    const continuation = byRule("layout/orphaned-continuation-page").evaluations!;
    assert.deepEqual(continuation.map((row) => [row.targetRef.nodeKey, row.reason]), [["page:1", "env/pagination-residue"], ["page:2", "env/pagination-residue"]]);
  });

  it("the engine refuses clean for a withdrawn page even when no active rule looks at pages", () => {
    const snapshot = everyRuleSnapshot({ multicol: false, withdrawn: [2] });
    const outcome = runDocument({ path: "x.html", snapshot, infrastructure: [] }, {
      failOn: "never", activeRules: [straightQuotes], optionsByRule: {}, coverageFloors: {},
    });
    assert.equal(outcome.report.coverage["type/straight-quotes"]?.ok, true);
    assert.equal(outcome.report.verdict, "insufficient-coverage", "content missing from the PDF ended clean");
    assert.equal(outcome.report.exitReason, "page(s) 2 withdrawn from measurement (env/pagination-residue)");
    const control = runDocument({ path: "x.html", snapshot: everyRuleSnapshot({ multicol: false, withdrawn: [] }), infrastructure: [] }, {
      failOn: "never", activeRules: [straightQuotes], optionsByRule: {}, coverageFloors: {},
    });
    assert.equal(control.report.verdict, "clean");
  });
});

// ---- round 2: writing modes, deliberate clipping, page edges, own and root columns ------------

/** One page with the given page-content style and content, and the raw census of it. */
function censusOf(content: string, contentStyle = ""): RawSnapshot["pages"][number]["overflowResidue"] {
  let html = pagedPage({ pageBox: pageBox(0), contentBox: contentBox(0), content });
  if (contentStyle) html = html.replace('class="pagedjs_page_content"', `class="pagedjs_page_content" style="${contentStyle}"`);
  return evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, pagedDocument([html])).pages[0]!.overflowResidue;
}
const text = (box: string, style = "") => `<span data-test-box="${box}"${style ? ` style="${style}"` : ""}>stranded words</span>`;
const PAGE_RIGHT = 566.93;

describe("the residue census follows the fragmentainer's writing mode, and exempts deliberate clipping", () => {
  // Measured on Chromium 141 with Paged.js 0.4.3 (the verifier's res-vertical fixture and three
  // variants): vertical-rl and sideways-rl strand to the LEFT of the page, vertical-lr to the
  // RIGHT, and vertical-rl with direction rtl also ABOVE it. RED BEFORE THIS ROUND: only x against
  // the right edge (left for rtl) was tested, so the vertical-rl page was never withdrawn.
  const LEFT = "-900 10 200 18.66";
  const RIGHT = `${PAGE_RIGHT + 200} 10 200 18.66`;
  const ABOVE = "56.69 -300 200 18.66";
  const BELOW = "56.69 900 200 18.66";
  for (const [mode, expected] of [
    ["writing-mode: vertical-rl", { LEFT: 1, RIGHT: 0, ABOVE: 0, BELOW: 1 }],
    ["writing-mode: sideways-rl", { LEFT: 1, RIGHT: 0, ABOVE: 0, BELOW: 1 }],
    ["writing-mode: vertical-lr", { LEFT: 0, RIGHT: 1, ABOVE: 0, BELOW: 1 }],
    ["writing-mode: vertical-lr; direction: rtl", { LEFT: 0, RIGHT: 1, ABOVE: 1, BELOW: 0 }],
    // sideways-lr runs its inline axis bottom to top: its inline end is the TOP for ltr.
    ["writing-mode: sideways-lr", { LEFT: 0, RIGHT: 1, ABOVE: 1, BELOW: 0 }],
    ["writing-mode: sideways-lr; direction: rtl", { LEFT: 0, RIGHT: 1, ABOVE: 0, BELOW: 1 }],
    ["writing-mode: vertical-rl; direction: rtl", { LEFT: 1, RIGHT: 0, ABOVE: 1, BELOW: 0 }],
    ["", { LEFT: 0, RIGHT: 1, ABOVE: 0, BELOW: 0 }],
    ["direction: rtl", { LEFT: 1, RIGHT: 0, ABOVE: 0, BELOW: 0 }],
  ] as const) {
    it(`counts the column-progression side for ${mode || "horizontal ltr"}`, () => {
      for (const [side, box] of Object.entries({ LEFT, RIGHT, ABOVE, BELOW })) {
        assert.equal(censusOf(text(box), mode)!.textRects, expected[side as keyof typeof expected], `${mode}: ${side}`);
      }
    });
  }

  it("also counts the side a box's OWN writing mode overflows to", () => {
    // The verifier's wm-htb-main-vrl: a vertical-rl main in a horizontal page strands its lines to
    // the LEFT of the page; the PDF was one page long and exit 0. RED BEFORE THIS ROUND.
    const own = (style: string, box: string) => `<p data-test-box="${box}" style="${style}">stranded words</p>`;
    assert.equal(censusOf(own("writing-mode: vertical-rl", "-900 10 18.66 200"))!.textRects, 1, "a vertical-rl box's residue was missed");
    assert.equal(censusOf(own("writing-mode: vertical-lr", "900 10 18.66 200"))!.textRects, 1);
    assert.equal(censusOf(own("direction: rtl", "-900 10 200 18.66"))!.textRects, 1);
    // Horizontal left-to-right text off the LEFT of a left-to-right page is off neither side.
    assert.equal(censusOf(own("", "-900 10 200 18.66"))!.textRects, 0);
    assert.equal(censusOf(own("writing-mode: vertical-rl", "900 10 18.66 200"))!.textRects, 1, "the page's own side still counts");
  });

  it("counts a line box that starts exactly at the page edge, and not one that still overlaps the page by a pixel", () => {
    // Pins the edge from both sides: `>` instead of `>=`, or any slack, moves one of the two.
    assert.equal(censusOf(text(`${PAGE_RIGHT} 10 200 18.66`))!.textRects, 1, "a line starting at the edge has no pixel on the page");
    assert.equal(censusOf(text(`${PAGE_RIGHT - 1} 10 200 18.66`))!.textRects, 0, "a line overlapping the page by 1 px prints");
    assert.equal(censusOf(text(`-200 10 201 18.66`), "direction: rtl")!.textRects, 0, "rtl: 1 px on the page prints");
    assert.equal(censusOf(text(`-200 10 200 18.66`), "direction: rtl")!.textRects, 1, "rtl: ending at the edge is off the page");
  });

  it("exempts the visually-hidden idiom, and only a box that really clips its content away", () => {
    // The verifier's fp-sronly-rtl: a skip link at left: -10000px in a 1 px, overflow: hidden box.
    const skip = (style: string, box = "-10000 10 1 1") =>
      `<a data-test-box="0 10 30 18.66"><span data-test-box="${box}" style="${style}">Skip to content</span></a>`;
    const sronly = censusOf(skip("position: absolute; width: 1px; height: 1px; overflow: hidden"), "direction: rtl")!;
    assert.deepEqual(sronly, { textRects: 0, replacedElements: 0, clippedExempt: 1 }, "a skip link withdrew its page");
    // clip applies to an absolutely positioned element; its px edges bound the region.
    assert.equal(censusOf(skip("position: absolute; clip: rect(0px, 0px, 0px, 0px)", "-10000 10 120 18.66"), "direction: rtl")!.textRects, 0);
    assert.equal(censusOf(skip("clip-path: inset(50%)", "-10000 10 120 18.66"), "direction: rtl")!.textRects, 0);
    assert.equal(censusOf(skip("clip-path: inset(0px); width: 1px", "-10000 10 1 18.66"), "direction: rtl")!.textRects, 0);
    // What does NOT exempt, each a real loss. RED IN ROUND 2: any clip-path or clip on the text's
    // element or an ancestor exempted it; the verifier's l1-anc-clippath-round (main { clip-path:
    // inset(0 round 12px) }) ended exit 0 with 7 paragraph tails missing from the PDF.
    const counted = (html: string) => censusOf(html, "direction: rtl")!;
    const ancestor = (style: string) =>
      `<main data-test-box="-2000 10 600 600" style="${style}"><p data-test-box="-2000 10 600 18.66">A stranded tail.</p></main>`;
    assert.deepEqual(counted(ancestor("clip-path: inset(0px round 12px)")), { textRects: 1, replacedElements: 0, clippedExempt: 0 },
      "an ancestor's rounded clip-path hid stranded text");
    assert.equal(counted(ancestor("clip-path: circle(50%)")).textRects, 1, "a non-inset clip-path hid stranded text");
    assert.equal(counted(ancestor("clip-path: inset(0px) margin-box; width: 1px")).textRects, 1);
    assert.equal(counted(skip("clip: rect(0px, 0px, 0px, 0px)", "-10000 10 120 18.66")).textRects, 1,
      "clip on a box that is not absolutely positioned clips nothing");
    assert.equal(counted(skip("position: absolute; clip: rect(0px, 200px, 20px, 0px)", "-10000 10 120 18.66")).textRects, 1);
    assert.equal(counted(skip("overflow: hidden; overflow-clip-margin: 40px", "-10000 10 1 1")).textRects, 1,
      "a clip margin lets the content show past the one-pixel box");
    // Overflow hidden on a box that is NOT one pixel does not hide what lies outside it here: the
    // residue of an ordinary scroll-less container is still residue.
    const wide = censusOf(skip("overflow: hidden", "-10000 10 120 18.66"), "direction: rtl")!;
    assert.deepEqual(wide, { textRects: 1, replacedElements: 0, clippedExempt: 0 }, "an ordinary box's residue was exempted");
    // Replaced elements follow the same rule.
    const image = (style: string, box: string) => `<span data-test-box="${box}" style="${style}"><img data-test-box="-10000 10 40 40"></span>`;
    assert.deepEqual(counted(image("position: absolute; width: 1px; height: 1px; overflow: hidden", "-10000 10 1 1")),
      { textRects: 0, replacedElements: 0, clippedExempt: 1 });
    assert.deepEqual(counted(image("clip-path: inset(0px round 12px)", "-10000 10 400 400")),
      { textRects: 0, replacedElements: 1, clippedExempt: 0 });
  });
});

describe("a block's own column width, an author class name and root columns", () => {
  it("declines a block whose only column property is its own column-width", () => {
    // The verifier's mc-own-width-only: `columns: 8em` on a justified paragraph, measured 4.28x.
    assert.equal(blockOutOfScope({ pages: [] } as unknown as Snapshot, {
      page: 1, sid: null, effectiveStyle: { columns: "auto", columnWidth: "128px", multicolAncestor: false, writingMode: "horizontal-tb" },
    } as unknown as BlockRecord), "env/multicolumn");
    const html = `<!doctype html><html lang="en"><body><p id="own">Own columns.</p></body></html>`;
    const { sid } = sources(html);
    const raw = evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, pagedDocument([pagedPage({
      pageBox: pageBox(0), contentBox: contentBox(0),
      content: `<p id="own" data-bl-sid="${sid.own}" data-ref="r" data-test-box="${at(0, 0)}" style="column-width: 8em">Own columns.</p>`,
    })]));
    assert.equal(raw.blocks[0]!.effectiveStyle.columnWidth, "8em", "the collector did not record the block's own column width");
    assert.equal(raw.blocks[0]!.effectiveStyle.columns, "auto");
  });

  it("an author element named like the page structure does not end the walk", () => {
    // The verifier's mc-fakeclass: <section class="pagedjs_area" style="column-count:2">.
    const html = `<!doctype html><html lang="en"><body><section id="fake"><p id="inside">Inside.</p></section></body></html>`;
    const { sid } = sources(html);
    const raw = evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, pagedDocument([pagedPage({
      pageBox: pageBox(0), contentBox: contentBox(0),
      content: `<section class="pagedjs_area pagedjs_page_content" id="fake" data-bl-sid="${sid.fake}" data-ref="f" data-test-box="${at(0, 0)}" style="column-count: 2">` +
        `<p id="inside" data-bl-sid="${sid.inside}" data-ref="i" data-test-box="${at(0, 0)}">Inside.</p></section>`,
    })]));
    assert.equal(raw.blocks.find((b) => b.sid === sid.inside)!.effectiveStyle.multicolAncestor, true,
      "a class name stopped the multi-column walk");
  });

  it("columns on body put every block in columns and withdraw every page", () => {
    // The verifier's mc-body: two pages reported, the PDF printed one, clipped.
    const html = `<!doctype html><html lang="en"><body><p id="a">A.</p></body></html>`;
    const { sid } = sources(html);
    const page = pagedPage({ pageBox: pageBox(0), contentBox: contentBox(0),
      content: `<p id="a" data-bl-sid="${sid.a}" data-ref="a" data-test-box="${at(0, 0)}">A.</p>` });
    const tree = fakeDocument(`<!doctype html><html lang="en"><body style="column-count: 2"><div class="pagedjs_pages">${page}</div></body></html>`);
    const raw = evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, tree);
    assert.equal(raw.rootMulticol, true);
    assert.equal(raw.blocks[0]!.effectiveStyle.multicolAncestor, true);
    assert.deepEqual(rootColumnsWithdrawal(1, true).map((row) => [row.scope, row.reason]), [["page", "env/multicolumn"]]);
    assert.deepEqual(rootColumnsWithdrawal(1, false), []);
    const control = evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, pagedDocument([page]));
    assert.equal(control.rootMulticol, false);
  });
});

describe("a snapshot that does not say whether a block is in columns is not read as single-column", () => {
  it("the invariants reject a block without multicolAncestor or columnWidth", () => {
    const snapshot = everyRuleSnapshot({ multicol: false, withdrawn: [] });
    const without = (field: "multicolAncestor" | "columnWidth") => ({
      ...snapshot, blocks: snapshot.blocks.map((b, i) => i === 0 ? { ...b, effectiveStyle: { ...b.effectiveStyle, [field]: undefined } } : b),
    }) as Snapshot;
    for (const field of ["multicolAncestor", "columnWidth"] as const) {
      const result = validateSnapshotInvariants(without(field), { sourceMapInjection: false });
      assert.ok(result.issues.some((issue) => issue.includes(field)), `${field}: ${result.issues.join("; ")}`);
    }
  });

  it("a rule declines such a block as env/invalid-measurement instead of measuring it", () => {
    const snapshot = everyRuleSnapshot({ multicol: false, withdrawn: [] });
    const legacy = { ...snapshot, blocks: snapshot.blocks.map((b) => ({ ...b, effectiveStyle: { ...b.effectiveStyle, multicolAncestor: undefined } })) } as unknown as Snapshot;
    const result = excessiveWordSpacing.run(legacy, { documentPath: "x.html", options: excessiveWordSpacing.defaultOptions, fingerprint });
    assert.ok(result.candidates > 0);
    assert.equal(result.measured, 0, "a block with no multicolAncestor was measured");
    assert.ok(result.notMeasured.every((row) => row.reason === "env/invalid-measurement"));
  });
});

describe("only a coverage-counted page row withdraws a page", () => {
  const rowed = (reason: NotMeasured["reason"]): Snapshot => {
    const snapshot = everyRuleSnapshot({ multicol: false, withdrawn: [] });
    snapshot.pages[1]!.notMeasured = [{ ...withdrawnRow(2), reason }];
    return snapshot;
  };
  it("a build-capability or not-applicable page row does not withdraw, in the rules or in the engine", () => {
    for (const reason of ["env/pixel-oracle-unavailable", "env/svg-overflow-visible", "env/clipped-past-page"] as const) {
      const snapshot = rowed(reason);
      assert.equal(pageWithdrawal(snapshot, 2), null, `${reason} withdrew the page`);
      const outcome = runDocument({ path: "x.html", snapshot, infrastructure: [] }, {
        failOn: "never", activeRules: [straightQuotes], optionsByRule: {}, coverageFloors: {},
      });
      assert.equal(outcome.report.verdict, "clean", `${reason} kept the document from ending clean`);
    }
    assert.equal(pageWithdrawal(rowed("env/pagination-residue"), 2), "env/pagination-residue");
    assert.equal(pageWithdrawal(rowed("env/multicolumn"), 2), "env/multicolumn");
  });
});

describe("the reporters say that pages were withdrawn", () => {
  it("console, Markdown and HTML state the withdrawn pages and the exit reason, and do not offer --disable for them", () => {
    const snapshot = everyRuleSnapshot({ multicol: false, withdrawn: [2] });
    const outcome = runDocument({ path: "residue.html", snapshot, infrastructure: [] }, {
      failOn: "never", activeRules: [straightQuotes], optionsByRule: {}, coverageFloors: {},
    });
    assert.equal(outcome.report.verdict, "insufficient-coverage");
    const report = buildReport({
      outcomes: [outcome], mode: "live", source: "rendered", toolVersion: "0.0.0", commit: null,
      startedAt: new Date(0).toISOString(), durationMs: 0, rulesRun: 1, failOn: "never",
      environment: {
        browserVersion: "", platform: "test", rendererPath: null, rendererPresent: false, pagedjsVersion: "0.4.3",
        rasterizer: null, rasterizerVersion: null, textPositionExtractor: null, fontFamiliesResolved: [], locale: "de-DE",
      },
      config: toReportConfig(resolveConfig({ file: undefined, cli: {} }), { interventions: [], networkBlocked: 0 }),
    });
    const exit = "page(s) 2 withdrawn from measurement (env/pagination-residue)";
    const consoleText = render(report, "console", { colour: false });
    // RED BEFORE THIS ROUND: "The run declared insufficient coverage without a per-rule shortfall."
    assert.doesNotMatch(consoleText, /without a per-rule shortfall/u);
    assert.match(consoleText, /1 page\(s\) of residue\.html withdrawn from measurement/u);
    assert.ok(consoleText.includes(exit), consoleText);
    assert.doesNotMatch(consoleText, /--disable type\/straight-quotes/u, "a --disable was offered for a rule that is not short");
    const markdown = render(report, "markdown");
    assert.match(markdown, /## Withdrawn pages/u);
    assert.ok(markdown.includes(exit));
    const html = render(report, "html");
    assert.doesNotMatch(html, /without a per-rule shortfall/u);
    assert.ok(html.includes(exit), "the HTML report does not state the exit reason");
    assert.match(html, /Withdrawn pages/u);
  });
});

describe("render-unstable names the pages the census withdrew", () => {
  it("the sentence names page 1's stranded content beside page 4's table", () => {
    const residue: FragmentainerReport = {
      pages: [4], count: 4, atomicCount: 4, pitchPx: 1816,
      sample: [{ page: 4, column: 1, tag: "TR", display: "table-row", sourceId: "s9", text: "Row 1" }],
    };
    const detail = pdfReconciliationDetail("baseline", ["boxes"], residue, [1, 4]);
    assert.match(detail, /overflow column of page\(s\) 4/u);
    assert.match(detail, /Page\(s\) 1, 4 also lay content out past the page box/u);
    assert.doesNotMatch(pdfReconciliationDetail("baseline", ["boxes"], residue), /also lay content/u);
  });
});

describe("round 3: root columns of any kind, distinct pages, absent column width, --disable", () => {
  const bodyDocument = (bodyStyle: string, htmlStyle = "") => {
    // German, so that type/straight-quotes (default locale de-DE) measures the two paragraphs.
    const html = `<!doctype html><html lang="de"><body><p id="a">A.</p><p id="b">B.</p></body></html>`;
    const { injected, sid } = sources(html);
    const pages = [0, 1].map((index) => pagedPage({ pageBox: pageBox(index), contentBox: contentBox(index),
      content: `<p id="${index ? "b" : "a"}" data-bl-sid="${sid[index ? "b" : "a"]}" data-ref="r${index}" data-test-box="${at(index, 0)}">${index ? "B." : "A."}</p>` }));
    const tree = fakeDocument(`<!doctype html><html lang="de"${htmlStyle ? ` style="${htmlStyle}"` : ""}><body${bodyStyle ? ` style="${bodyStyle}"` : ""}>` +
      `<div class="pagedjs_pages">${pages.join("")}</div></body></html>`, "de");
    return { injected, tree };
  };

  it("any column property on html or body is root columns, column-count 1 included", () => {
    // The verifier's mcb-body-count1 / mcb-body-columns1: exit 0 with half the PDF missing.
    for (const [body, html, expected] of [
      ["column-count: 1", "", true], ["column-count: 2", "", true], ["column-width: 12em", "", true],
      ["", "column-count: 1", true], ["column-count: auto", "", false], ["", "", false],
    ] as const) {
      const { tree } = bodyDocument(body, html);
      assert.equal(evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, tree).rootMulticol, expected, `body "${body}", html "${html}"`);
    }
    // Inside the page, column-count 1 stays one column, as layoutOutOfScope has always read it.
    assert.equal(blockOutOfScope({ pages: [] } as unknown as Snapshot, {
      page: 1, sid: null, effectiveStyle: { columns: "1", columnWidth: "auto", multicolAncestor: false, writingMode: "horizontal-tb" },
    } as unknown as BlockRecord), null);
  });

  it("root columns withdraw every page through assembleSnapshot, and a text-only rule set cannot end clean", () => {
    // The verifier's mc-body, end to end through the production assembly and engine.
    const { injected, tree } = bodyDocument("column-count: 2");
    const snapshot = assemble(evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, tree), runCollector<CollectorResult>(COLLECTOR_SOURCE, tree), injected);
    assert.deepEqual(snapshot.pages.map((page) => page.notMeasured.map((n) => n.reason)), [["env/multicolumn"], ["env/multicolumn"]]);
    assert.ok(snapshot.blocks.every((block) => block.effectiveStyle.multicolAncestor));
    const outcome = runDocument({ path: "body.html", snapshot, infrastructure: [] }, {
      failOn: "never", activeRules: [straightQuotes], optionsByRule: {}, coverageFloors: {},
    });
    assert.equal(outcome.report.verdict, "insufficient-coverage");
    assert.equal(outcome.report.exitReason, "page(s) 1, 2 withdrawn from measurement (env/multicolumn)");
    const control = bodyDocument("");
    const clean = assemble(evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, control.tree), runCollector<CollectorResult>(COLLECTOR_SOURCE, control.tree), control.injected);
    assert.equal(runDocument({ path: "body.html", snapshot: clean, infrastructure: [] }, {
      failOn: "never", activeRules: [straightQuotes], optionsByRule: {}, coverageFloors: {},
    }).report.verdict, "clean");
  });

  it("a page withdrawn for two reasons is one page in the report", () => {
    const snapshot = everyRuleSnapshot({ multicol: false, withdrawn: [2] });
    snapshot.pages[1]!.notMeasured.push({ ...withdrawnRow(2), reason: "env/multicolumn" });
    const outcome = runDocument({ path: "x.html", snapshot, infrastructure: [] }, {
      failOn: "never", activeRules: [straightQuotes], optionsByRule: {}, coverageFloors: {},
    });
    const pageRows = outcome.report.notMeasured.filter((n) => n.scope === "page" && n.ruleId === null);
    assert.equal(pageRows.reduce((sum, n) => sum + n.count, 0), 1, JSON.stringify(pageRows));
    assert.equal(outcome.report.exitReason, "page(s) 2 withdrawn from measurement (env/multicolumn, env/pagination-residue)");
  });

  it("a block whose snapshot does not record its own column width is declined, not measured", () => {
    for (const style of [
      { columns: "auto", multicolAncestor: false, writingMode: "horizontal-tb" },
      { columns: "auto", columnWidth: "auto", writingMode: "horizontal-tb" },
    ]) {
      assert.equal(blockOutOfScope({ pages: [] } as unknown as Snapshot, { page: 1, sid: null, effectiveStyle: style } as unknown as BlockRecord),
        "env/invalid-measurement", JSON.stringify(style));
    }
  });

  it("the console does not offer --disable for a shortfall caused by withdrawn pages", () => {
    const snapshot = everyRuleSnapshot({ multicol: false, withdrawn: [1, 2] });
    const config = resolveConfig({ file: {}, cli: {} });
    const outcome = runDocument({ path: "residue.html", snapshot, infrastructure: [] }, {
      failOn: config.failOn, activeRules: config.activeRules, optionsByRule: config.optionsByRule, coverageFloors: coverageFloorMap(config),
    });
    assert.ok(Object.values(outcome.report.coverage).some((c) => !c.ok), "no rule fell short, so the case is not exercised");
    const report = buildReport({
      outcomes: [outcome], mode: "live", source: "rendered", toolVersion: "0.0.0", commit: null,
      startedAt: new Date(0).toISOString(), durationMs: 0, rulesRun: config.activeRules.length, failOn: config.failOn,
      environment: {
        browserVersion: "", platform: "test", rendererPath: null, rendererPresent: false, pagedjsVersion: "0.4.3",
        rasterizer: null, rasterizerVersion: null, textPositionExtractor: null, fontFamiliesResolved: [], locale: "de-DE",
      },
      config: toReportConfig(config, { interventions: [], networkBlocked: 0 }),
    });
    const text = render(report, "console", { colour: false });
    assert.doesNotMatch(text, /--disable [a-z]+\//u, "a --disable was offered for a withdrawn page's shortfall");
    assert.match(text, /No --disable clears a withdrawn page/u);
    assert.doesNotMatch(render(report, "html"), /--disable [a-z]+\//u);
  });
});
