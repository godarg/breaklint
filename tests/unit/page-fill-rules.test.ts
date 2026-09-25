/**
 * The two page-fill rules, through the real engine: what they judge, and what they say.
 *
 * `layout/orphaned-continuation-page` used to judge every page on which all blocks are
 * continuations. That is also true of every MIDDLE page of a block that spans three pages or
 * more, and when what goes on is running text such a page is full — its next line did not fit —
 * while its net fill, which counts glyph boxes and not line boxes, reads far below 1 at a
 * generous line height. The rule now judges a page only when what it carries ends on it
 * (`ends-on-page`): the next page does not open with text running on from it. Anything else
 * that opens the next page — a carried child, an image that did not fit, a forced break — ends it.
 *
 * The decision reads text lines, the blocks' fragment positions and their document order: a
 * wrapper's lines include its children's, and only a block that starts on the next page AFTER a
 * continuation, in document order, can own the continuation's lines. The live suite checks that
 * the real collector produces that order (tests/live/render-run.test.ts); the cases here check
 * that the rule reads it, and that blocks outside the page's flow — a margin-box clone, a block
 * with no box — move nothing.
 *
 * `layout/half-empty-page` stated in every finding that its threshold sat "0.086 below the
 * measured ceiling of a full text page". Net fill has no ceiling: full prose pages at
 * line-height 1.5 were measured at 0.58–0.72 with this collector. The message now says what the
 * quantity is, and quotes nothing that was not measured.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { runDocument } from "../../src/core/engine.ts";
import type { BlockRecord, Snapshot, TargetEvaluation, TextLine } from "../../src/core/types.ts";
import { halfEmptyPage } from "../../src/rules/layout/half-empty-page.ts";
import { orphanedContinuationPage } from "../../src/rules/layout/orphaned-continuation-page.ts";
import { loadCorpus } from "../fixtures/corpus.ts";

const corpusSnapshot = (name: string): Snapshot => {
  const entry = loadCorpus().find((item) => item.name === name);
  assert.ok(entry, `no corpus fixture named ${name}`);
  return structuredClone(entry.snapshot);
};

function run(snapshot: Snapshot, rule = orphanedContinuationPage) {
  return runDocument(
    { path: "fill.html", snapshot, infrastructure: [] },
    { failOn: "never", activeRules: [rule], optionsByRule: {}, coverageFloors: {} },
  ).report;
}

function measurementsOf(evaluations: readonly TargetEvaluation[], pageNodeKey: string) {
  const row = evaluations.find((item) => item.targetRef.nodeKey === pageNodeKey);
  assert.ok(row, `no evaluation for ${pageNodeKey}`);
  assert.equal(row.status, "measured");
  return {
    names: row.measurements.map((m) => m.name),
    values: Object.fromEntries(row.measurements.map((m) => [m.name, m.value])),
    violated: row.predicate.violated,
  };
}

/** One visible text line of a block, in page coordinates. */
function textLine(blockKey: string, index: number, box: TextLine["box"]): TextLine {
  return { blockKey, index, box, visible: true, ownText: true, width: box.width, wordBoxes: null };
}

/** A continuation fragment with an explicit source id and fragment position. */
function fragment(template: BlockRecord, over: Partial<BlockRecord> & Pick<BlockRecord, "nodeKey" | "sid" | "page" | "fragmentIndex" | "fragmentCount">): BlockRecord {
  return { ...structuredClone(template), ...over };
}

describe("page-fill rules", () => {
  it("judges a continuation page only when what it carries ends there, and records ends-on-page", () => {
    // One paragraph over four pages, pages 2 and 3 at net fill 0.49 against 0.50: the numbers of
    // a real full page at line-height 2.2. Before the guard both pages were reported.
    const snapshot = corpusSnapshot("orphaned-continuation-clean-full-middle-page");
    const report = run(snapshot);
    assert.deepEqual(report.findings.map((f) => f.page), [], "a middle page of a continuing block was reported");

    const rows = ["pg1", "pg2", "pg3", "pg4"].map((key) => measurementsOf(report.evaluations, key));
    for (const row of rows) assert.deepEqual(row.names, ["continuation-only", "ends-on-page", "net-fill"]);
    assert.deepEqual(rows.map((row) => row.values["continuation-only"]), [false, true, true, true]);
    assert.deepEqual(rows.map((row) => row.values["ends-on-page"]), [false, false, false, true]);
    assert.deepEqual(rows.map((row) => row.values["net-fill"]), [0.46, 0.49, 0.49, 0.73]);
    assert.deepEqual(rows.map((row) => row.violated), [false, false, false, false]);
    assert.equal(report.coverage["layout/orphaned-continuation-page"]!.measured, 4);

    // The page the rule exists for is still judged: the same paragraph ending on page 4 in two
    // lines reports page 4, and only page 4.
    snapshot.pages[3]!.fill.net = 0.06;
    const tail = run(snapshot);
    assert.deepEqual(tail.findings.map((f) => [f.ruleId, f.page]), [["layout/orphaned-continuation-page", 4]]);
    assert.equal(
      tail.findings[0]!.message,
      "Page 4 carries only content continued from an earlier page, which ends there, and its net fill " +
        "is 6.0 %; threshold 50 %. The break into it was an overflow, not a request.",
    );
    assert.equal(measurementsOf(tail.evaluations, "pg4").violated, true);
  });

  it("judges a wrapper's page when its fresh child was carried over, whatever the wrapper's box", () => {
    // A <section>: its paragraph ends on page 1, its own 200 px SVG sits on page 2, and its next
    // child, a break-inside: avoid figure, did not fit and opens page 3. The section continues, but
    // page 3 opens with no running text, and page 2 is two thirds empty. Measured live with the
    // same shape: net fill 0.31.
    const snapshot = corpusSnapshot("orphaned-continuation-trigger-carried-child");
    const report = run(snapshot);
    assert.deepEqual(report.findings.map((f) => f.page), [2]);
    assert.deepEqual(measurementsOf(report.evaluations, "pg2").values, { "continuation-only": true, "ends-on-page": true, "net-fill": 0.31 });

    // The figure's caption opens page 3 — and is recorded twice, as the figure's line and as the
    // section's, because a wrapper's lines include its children's. Neither is running text: the
    // figure starts on page 3, and the section's copy lies inside it.
    const captioned = structuredClone(snapshot);
    captioned.textLines.push(
      textLine("figure", 0, { x: 60, y: 56, width: 300, height: 16 }),
      textLine("section:2", 0, { x: 60, y: 56, width: 300, height: 16 }),
    );
    assert.deepEqual(run(captioned).findings.map((f) => f.page), [2], "a caption of the carried figure counted as running text");

    // The wrapper's box plays no part: a 2 px border that Paged.js keeps at the split puts the
    // figure 2 px below the wrapper's continuation, and a full-bleed figure is wider than it.
    // Both were measured live (0.6.0 reported them; a box-based wrapper test silenced them).
    const bordered = structuredClone(snapshot);
    for (const b of bordered.blocks.filter((b) => b.page === 3 && b.fragmentIndex === 0)) b.box = { ...b.box, y: b.box.y + 2 };
    assert.deepEqual(run(bordered).findings.map((f) => f.page), [2]);
    const bleed = structuredClone(snapshot);
    const figure = bleed.blocks.find((b) => b.nodeKey === "figure")!;
    figure.box = { ...figure.box, x: figure.box.x - 76, width: figure.box.width + 152 };
    assert.deepEqual(run(bleed).findings.map((f) => f.page), [2]);

    // So is the wrapper's own replaced content: its SVG opening page 3 above the figure means the
    // break fell before an element that does not split, not inside running text.
    const ownSvgFirst = structuredClone(snapshot);
    for (const b of ownSvgFirst.blocks.filter((b) => b.page === 3 && b.fragmentIndex === 0)) b.box = { ...b.box, y: b.box.y + 200 };
    assert.deepEqual(run(ownSvgFirst).findings.map((f) => f.page), [2]);

    // Nor is the wrapper's own text when it RESUMES below the carried figure: it does not open
    // the page, the figure does.
    const resumes = structuredClone(snapshot);
    resumes.blocks.find((b) => b.nodeKey === "figure")!.box.height = 400;
    resumes.textLines.push(textLine("section:2", 0, { x: 48, y: 460, width: 380, height: 16 }));
    assert.deepEqual(run(resumes).findings.map((f) => f.page), [2], "text below the carried figure counted as running on");

    // The top of the next page is where its first block starts, even when that block paints
    // nothing the fill bands see (an empty bordered box, carried over like the figure): text that
    // resumes a whole line below it did not run on.
    const spacer = structuredClone(snapshot);
    const fig = spacer.blocks.find((b) => b.nodeKey === "figure")!;
    fig.box = { ...fig.box, height: 100 };
    spacer.pages[2]!.fill.topGap = 0.18;
    spacer.textLines.push(textLine("section:2", 0, { x: 48, y: 156, width: 380, height: 16 }));
    assert.deepEqual(run(spacer).findings.map((f) => f.page), [2], "the next page's top was read from its fill bands alone");

    // With no block starting on page 3 at all, its top is its first fill band: the section's own
    // 300 px image opens it and the section's text resumes below — the break fell before the image.
    const ownImage = structuredClone(snapshot);
    ownImage.blocks = ownImage.blocks.filter((b) => !(b.page === 3 && b.fragmentIndex === 0));
    ownImage.pages[2]!.fill.topGap = 0;
    ownImage.textLines.push(textLine("section:2", 0, { x: 48, y: 356, width: 380, height: 16 }));
    assert.deepEqual(run(ownImage).findings.map((f) => f.page), [2], "text below the section's own image counted as running on");

    // A parity blank page between them: it carries no text, so the page before it is judged.
    const withBlank = structuredClone(snapshot);
    const blank = structuredClone(withBlank.pages[2]!);
    Object.assign(blank, {
      pageNumber: 3, nodeKey: "pg3", isLast: false, blank: true, firstSemanticBlockKey: null,
      fill: { vertical: 0, topGap: 0, net: 0, area: 0 },
      incomingBreakCause: { kind: "parity", determinedBy: "page-blank", cascadeHint: null },
      outgoingBreakCause: { kind: "parity", determinedBy: "page-blank", cascadeHint: null },
    });
    withBlank.pages[2] = { ...withBlank.pages[2]!, pageNumber: 4, nodeKey: "pg4" };
    withBlank.pages.splice(2, 0, blank);
    withBlank.blocks = withBlank.blocks.map((b) => b.page === 3 ? { ...b, page: 4 } : b);
    assert.deepEqual(run(withBlank).findings.map((f) => f.page), [2]);
  });

  it("keeps a page silent when the next page opens with text running on", () => {
    // The wrapper's OWN text at the top of page 3, above the figure: the section's text ran on.
    const ownText = corpusSnapshot("orphaned-continuation-trigger-carried-child");
    for (const b of ownText.blocks.filter((b) => b.page === 3 && b.fragmentIndex === 0)) b.box = { ...b.box, y: b.box.y + 64 };
    ownText.textLines.push(textLine("section:2", 0, { x: 48, y: 56, width: 380, height: 16 }), textLine("section:2", 1, { x: 48, y: 88, width: 200, height: 16 }));
    assert.deepEqual(run(ownText).findings, []);
    assert.equal(measurementsOf(run(ownText).evaluations, "pg2").values["ends-on-page"], false);

    // The same text in a first column, with the figure opening a second one beside it.
    const columns = corpusSnapshot("orphaned-continuation-trigger-carried-child");
    for (const b of columns.blocks.filter((b) => b.page === 3)) {
      b.box = b.fragmentIndex === 0 ? { ...b.box, x: 257, width: 190 } : { ...b.box, width: 190 };
    }
    columns.textLines.push(textLine("section:2", 0, { x: 48, y: 56, width: 180, height: 16 }));
    assert.deepEqual(run(columns).findings, []);

    // A wrapper whose own text follows a child that ENDS on the page and runs on to the next one:
    // the page's last block in document order is that child's final fragment, but the page is full.
    // Measured live (a <section> with bare text after its paragraph; and a float split into an
    // empty first fragment): the last-block condition reported such pages.
    const mixed = corpusSnapshot("orphaned-continuation-clean-full-middle-page");
    const inner = fragment(mixed.blocks[0]!, { nodeKey: "inner:1", sid: "s-inner", page: 2, fragmentIndex: 1, fragmentCount: 2, box: { x: 48, y: 48, width: 399, height: 96 } });
    mixed.blocks.splice(mixed.blocks.findIndex((b) => b.page === 2) + 1, 0, inner);
    assert.deepEqual(run(mixed).findings, [], "the final fragment of a nested child hid the wrapper's running text");

    // A fresh block positioned at the top of the next page — an absolutely positioned badge, a
    // relatively offset aside — beside the paragraph's running text: measured live, the full page
    // before it was reported by the box-based test. The running text still opens the page.
    const badge = corpusSnapshot("orphaned-continuation-clean-full-middle-page");
    badge.blocks.push(fragment(badge.blocks[0]!, {
      nodeKey: "badge", sid: "s-badge", tag: "aside", page: 3, fragmentIndex: 0, fragmentCount: 1,
      box: { x: 400, y: 48, width: 47, height: 14 },
    }));
    assert.deepEqual(run(badge).findings, []);
  });

  // Page 3 of the long paragraph, rebuilt from live records (Chromium 141, Paged.js 0.4.3): the
  // content box's top is 48; the page's first fill band is at the top; the paragraph's glyph boxes
  // start `glyphTop` below it, one line height apart; `svgs` are the SVG records laid out on page 3
  // (x, y relative to the content box).
  const nextPageShape = (lineHeight: number, glyphTop: number, glyphHeight: number, svgs: { x: number; y: number; width: number; height: number }[]) => {
    const snapshot = corpusSnapshot("orphaned-continuation-clean-full-middle-page");
    const long2 = snapshot.blocks.find((b) => b.nodeKey === "long:2")!;
    long2.lineHeight = lineHeight;
    snapshot.pages[2]!.fill.topGap = 0;
    snapshot.textLines = snapshot.textLines.filter((l) => l.blockKey !== "long:2");
    for (let k = 0; k < 10; k++) {
      snapshot.textLines.push(textLine("long:2", 36 + k, { x: 48, y: 48 + glyphTop + k * lineHeight, width: 399, height: glyphHeight }));
    }
    const template = corpusSnapshot("svg-overflow-trigger").svg[0]!;
    snapshot.svg = svgs.map((box, i) => ({ ...structuredClone(template), nodeKey: `svg:${i}`, page: 3, viewportScreen: { ...box, x: 48 + box.x, y: 48 + box.y } }));
    return snapshot;
  };
  const pagesOf = (snapshot: Snapshot) => run(snapshot).findings.map((f) => f.page);

  it("counts an inline SVG on the next page's first line as part of that line", () => {
    // q2 / vf10: an inline SVG on the first line's baseline (70 px; 100 px) under 48 px lines, the
    // glyph box starting 56 px (86 px) down. The line did not fit on page 2, which is full.
    assert.deepEqual(pagesOf(nextPageShape(48, 56, 17, [{ x: 0, y: 0, width: 60, height: 70 }])), []);
    assert.deepEqual(pagesOf(nextPageShape(48, 86, 17, [{ x: 0, y: 0, width: 40, height: 100 }])), [], "a 100 px inline SVG made its full page a tail");
  });

  // Text that resumes BELOW a block-level SVG shares no line with it, so the one-line window
  // holds and the page before — measured two thirds empty or more — is judged.
  it("keeps one line height below a block-level SVG (vf1a: 60 px icon, glyph at 75 px)", () => {
    assert.deepEqual(pagesOf(nextPageShape(48, 75, 17, [{ x: 0, y: 0, width: 40, height: 60 }])), [2]);
  });

  it("keeps one line height below a block-level SVG (vf3: 22 px lines, 24 px icon, glyph at 27 px)", () => {
    assert.deepEqual(pagesOf(nextPageShape(22, 27, 16, [{ x: 0, y: 0, width: 40, height: 24 }])), [2]);
  });

  it("keeps one line height below a block-level SVG (vf7: 64 px wrapper lines, 80 px icon, glyph at 81 px)", () => {
    // One pixel below the icon, so no shared line. The window uses the recorded block's line
    // height — the wrapper's — not the line's own: the snapshot carries no other.
    assert.deepEqual(pagesOf(nextPageShape(64, 81, 17, [{ x: 0, y: 0, width: 40, height: 80 }])), [2]);
  });

  it("gives the extra room only to an SVG across the first line on the next page itself", () => {
    // Beside the line's block, not across it — a side-margin element — shares no line.
    assert.deepEqual(pagesOf(nextPageShape(48, 66, 17, [{ x: -44, y: 0, width: 40, height: 80 }])), [2], "side SVG");
    // An inline SVG on a LATER line does not make the first one open the page.
    assert.deepEqual(pagesOf(nextPageShape(48, 66, 17, [{ x: 0, y: 100, width: 40, height: 30 }])), [2], "SVG on the second line");
    // An SVG recorded on another page is not on this line (the fixture's pages share coordinates).
    const elsewhere = nextPageShape(48, 56, 17, [{ x: 0, y: 0, width: 60, height: 70 }]);
    elsewhere.svg[0]!.page = 2;
    assert.deepEqual(pagesOf(elsewhere), [2], "SVG on another page");
    // The collector records SVGs in margin boxes too (WP-F1 excludes margin-box BLOCKS only): a
    // running header's SVG in the top margin box of page 3 lies above the content box and shares
    // no line with the paragraph's first line.
    assert.deepEqual(pagesOf(nextPageShape(48, 66, 17, [{ x: 150, y: -40, width: 100, height: 30 }])), [2], "running-header SVG");
  });

  it("reports the page before an inline img or canvas line: only SVGs are recorded with a box", () => {
    // q2f / q2e: an 80 px inline <img> or <canvas> on the first line, glyph box at 66 px under
    // 48 px lines. The snapshot records a box for SVGs only, so the one-line window applies and
    // the full page before it IS reported: the round-3 false alarm, kept deliberately — it errs
    // toward reporting, and a snapshot field for replaced boxes is the follow-up.
    assert.deepEqual(pagesOf(nextPageShape(48, 66, 17, [])), [2]);
  });

  it("keeps the one-line window strict", () => {
    // A glyph box starting exactly one line height below the top does not open the page; half a
    // pixel less does.
    assert.deepEqual(pagesOf(nextPageShape(48, 48, 17, [])), [2]);
    assert.deepEqual(pagesOf(nextPageShape(48, 47.5, 17, [])), []);
  });

  it("lets only a block that STARTS on the next page own a continuation's line", () => {
    // A later block in document order that itself continues there — a split panel, fragment 1 of
    // 2 — and covers the paragraph's first line: the paragraph's text still runs on.
    const snapshot = corpusSnapshot("orphaned-continuation-clean-full-middle-page");
    const template = snapshot.blocks[0]!;
    const at = snapshot.blocks.findIndex((b) => b.page === 3);
    snapshot.blocks.splice(at + 1, 0, fragment(template, {
      nodeKey: "panel:1", sid: "s-panel", tag: "aside", page: 3, fragmentIndex: 1, fragmentCount: 2,
      box: { x: 48, y: 48, width: 399, height: 200 }, lines: [],
    }));
    snapshot.blocks.splice(0, 0, fragment(template, {
      nodeKey: "panel:0", sid: "s-panel", tag: "aside", page: 1, fragmentIndex: 0, fragmentCount: 2,
      box: { x: 48, y: 600, width: 399, height: 40 }, lines: [],
    }));
    assert.deepEqual(run(snapshot).findings, []);
  });

  it("gives a line's centre 1 px of slack against the box that owns it", () => {
    // Rounded geometry: the section's copy of the carried figure's caption, its centre 0.5 px above
    // the figure's box, is still the figure's line.
    const snapshot = corpusSnapshot("orphaned-continuation-trigger-carried-child");
    snapshot.textLines.push(textLine("section:2", 0, { x: 60, y: 39.5, width: 300, height: 16 }));
    assert.deepEqual(run(snapshot).findings.map((f) => f.page), [2]);
    // Two pixels outside is outside: the line is the section's own, and it runs on.
    const outside = corpusSnapshot("orphaned-continuation-trigger-carried-child");
    outside.textLines.push(textLine("section:2", 0, { x: 60, y: 38, width: 300, height: 16 }));
    assert.deepEqual(run(outside).findings, [], "a line 2 px outside the figure was taken as its own");
  });

  it("reads document order to decide which block owns a line", () => {
    // A wrapper's lines include its children's. A line whose centre lies in a block that starts on
    // the next page AND follows the continuation in document order is that block's (its child's),
    // not text running on; a block that PRECEDES the continuation cannot own its lines.
    const base = corpusSnapshot("orphaned-continuation-clean-full-middle-page");
    const template = base.blocks[0]!;
    const cover = fragment(template, {
      nodeKey: "cover", sid: "s-cover", tag: "div", page: 3, fragmentIndex: 0, fragmentCount: 1,
      box: { x: 48, y: 48, width: 399, height: 600 },
    });
    const at = base.blocks.findIndex((b) => b.page === 3);

    const after = structuredClone(base);
    after.blocks.splice(at + 1, 0, cover);
    assert.deepEqual(run(after).findings.map((f) => f.page), [2], "a later block did not own the lines it contains");

    const before = structuredClone(base);
    before.blocks.splice(at, 0, cover);
    assert.deepEqual(run(before).findings, [], "a block before the continuation took its running text");
  });

  it("keeps full middle pages silent when the next page opens with the continuation", () => {
    // The long paragraph again, with a fresh block on page 4 BELOW the paragraph's last lines:
    // page 4 opens with running text, so page 3, which it continues, was full.
    const snapshot = corpusSnapshot("orphaned-continuation-clean-full-middle-page");
    const template = snapshot.blocks[0]!;
    snapshot.blocks.push(fragment(template, {
      nodeKey: "after", sid: "s-after", page: 4, fragmentIndex: 0, fragmentCount: 1, box: { ...template.box, y: 400 },
    }));
    const report = run(snapshot);
    assert.deepEqual(report.findings, []);
    assert.deepEqual(
      ["pg2", "pg3"].map((key) => measurementsOf(report.evaluations, key).values["ends-on-page"]),
      [false, false],
    );
  });

  it("counts only the page's flow: a margin-box clone or a box-less original moves nothing", () => {
    // Paged.js clones a `position: running()` element into a margin box on every page, and the
    // clone keeps its source id, so the collector may record it as a fragment; the in-flow
    // original stays in the page content with `display: none` and no box. Neither is content of
    // the page. The fixture's content box starts at y = 48; the margin box sits above it.
    const base = corpusSnapshot("orphaned-continuation-clean-full-middle-page");
    const template = base.blocks[0]!;
    const clone = (page: number, fragmentIndex: number, fragmentCount: number) =>
      fragment(template, {
        nodeKey: `header:${page}`, sid: "s-header", tag: "header", page, fragmentIndex, fragmentCount,
        box: { ...template.box, y: 8, height: 20 },
      });
    const original = (page: number, fragmentIndex: number, fragmentCount: number) =>
      fragment(template, {
        nodeKey: `header-original:${page}`, sid: "s-header-2", tag: "header", page, fragmentIndex, fragmentCount,
        box: { x: 0, y: 0, width: 0, height: 0 }, lines: [], display: "none", marginCopies: 3,
      });
    base.pages[3]!.fill.net = 0.06;
    // Pages 1–3: a clone first. Page 4, the tail: the FIRST clone of a second running element
    // (fragment 0, so the page would not be "continuation-only"), the paragraph's final fragment,
    // and after it that element's box-less original. Measured live in that order.
    base.blocks = [
      clone(1, 0, 3), base.blocks[0]!,
      clone(2, 1, 3), base.blocks[1]!,
      clone(3, 2, 3), base.blocks[2]!,
      { ...clone(4, 0, 3), sid: "s-header-2", nodeKey: "header-2:4" }, base.blocks[3]!, original(4, 1, 3),
    ];
    const report = run(base);
    assert.deepEqual(report.findings.map((f) => f.page), [4], "the tail page was hidden by blocks outside its flow");
    assert.deepEqual(
      ["pg2", "pg3", "pg4"].map((key) => measurementsOf(report.evaluations, key).values),
      [
        { "continuation-only": true, "ends-on-page": false, "net-fill": 0.49 },
        { "continuation-only": true, "ends-on-page": false, "net-fill": 0.49 },
        { "continuation-only": true, "ends-on-page": true, "net-fill": 0.06 },
      ],
    );

    // A block with no box at all is not content even where the content box reaches it. Measured
    // live on a page with `@page { margin: 0 }`: a running element's display: none original reads
    // (0, 0, 0, 0), which the vertical test already excludes even with the content box starting at
    // y = 0; an empty absolutely positioned marker reads (100, 20, 0, 0), inside the content box,
    // and only the box test excludes it. Starting on the tail page, it would make that page look
    // like one that does not carry continuations only.
    const marker = structuredClone(base);
    marker.blocks.push(fragment(template, {
      nodeKey: "marker", sid: "s-marker", tag: "div", page: 4, fragmentIndex: 0, fragmentCount: 1,
      box: { x: 200, y: 300, width: 0, height: 0 }, lines: [],
    }));
    assert.deepEqual(run(marker).findings.map((f) => f.page), [4], "a box-less marker hid the tail page");
  });

  it("gives the round-2 repro's answers in the shape WP-F1's collector produces", () => {
    // WP-F1's collector change keeps margin-box content out of the snapshot (running and
    // fixed-position clones); this rule relies on that for side margin boxes, which its own
    // vertical test does not exclude. Without clones: the tail page of the long paragraph, the
    // carried child, and the carried child under a 2 px wrapper border.
    const tail = corpusSnapshot("orphaned-continuation-clean-full-middle-page");
    tail.pages[3]!.fill.net = 0.06;
    assert.deepEqual(run(tail).findings.map((f) => f.page), [4]);
    const carried = corpusSnapshot("orphaned-continuation-trigger-carried-child");
    assert.deepEqual(run(carried).findings.map((f) => f.page), [2]);
    for (const b of carried.blocks.filter((b) => b.page === 3 && b.fragmentIndex === 0)) b.box = { ...b.box, y: b.box.y + 2 };
    assert.deepEqual(run(carried).findings.map((f) => f.page), [2]);

    // What WP-F1's collector keeps of a running element: its in-flow original, `display: none`,
    // a 0 x 0 box and no lines, in the page content where the source puts it. Here, the last
    // block on the tail page. It moves nothing.
    const withOriginal = corpusSnapshot("orphaned-continuation-clean-full-middle-page");
    withOriginal.pages[3]!.fill.net = 0.06;
    withOriginal.blocks.push(fragment(withOriginal.blocks[0]!, {
      nodeKey: "running-original", sid: "s-running", tag: "header", page: 4, fragmentIndex: 0, fragmentCount: 1,
      box: { x: 0, y: 0, width: 0, height: 0 }, lines: [], display: "none", marginCopies: 4,
    }));
    assert.deepEqual(run(withOriginal).findings.map((f) => f.page), [4]);
  });

  it("counts a display: contents block by its lines", () => {
    // No box of its own, but printed: its text is recorded as lines (the shared renderedBox).
    // Starting on the tail page, it is content that does not continue from an earlier page.
    const snapshot = corpusSnapshot("orphaned-continuation-clean-full-middle-page");
    snapshot.pages[3]!.fill.net = 0.06;
    snapshot.blocks.push(fragment(snapshot.blocks[0]!, {
      nodeKey: "contents", sid: "s-contents", tag: "div", page: 4, fragmentIndex: 0, fragmentCount: 1,
      box: { x: 0, y: 0, width: 0, height: 0 }, lines: [99], display: "contents",
    }));
    snapshot.textLines.push(textLine("contents", 99, { x: 48, y: 400, width: 200, height: 16 }));
    assert.deepEqual(run(snapshot).findings, [], "a printed display: contents block was not counted");
    assert.equal(measurementsOf(run(snapshot).evaluations, "pg4").values["continuation-only"], false);
  });

  it("half-empty-page says what net fill is and claims no ceiling", () => {
    const report = run(corpusSnapshot("half-empty-trigger"), halfEmptyPage);
    assert.equal(report.findings.length, 1);
    const message = report.findings[0]!.message;
    assert.equal(
      message,
      "Page 1 is 5.0 % filled; threshold 60 %. Experimental: net fill sums the glyph boxes of text, " +
        "not its line boxes, so a page a reader calls full can read below this threshold.",
    );
    assert.doesNotMatch(message, /ceiling|0\.086|0\.686/u);
    // The same sentence on the last page, after the likely-intended note.
    const lastPage = corpusSnapshot("half-empty-trigger-foot-line");
    lastPage.pages[0]!.isLast = true;
    const lastMessage = run(lastPage, halfEmptyPage).findings[0]!.message;
    assert.match(lastMessage, /^Page 1 is 4\.9 % filled; threshold 60 %\. This is the last page and carries no continuation — likely intended\. Experimental: net fill sums the glyph boxes/u);
    assert.doesNotMatch(lastMessage, /ceiling|0\.086|0\.686/u);
  });

  it("no rule page or contract document states a net-fill ceiling", () => {
    // The claim was copied into five places. It was never a bound — full prose pages at
    // line-height 1.5 read 0.58–0.72 — and a page that repeats it tells an agent to trust a
    // threshold margin that does not exist.
    const FALSE_CEILING = /0\.686|0\.086|measured ceiling|ceiling of `?net ?fill`?|eighty-six thousandths/iu;
    for (const file of [
      "README.md",
      "docs/agent-contract.md",
      "docs/limitations.md",
      "docs/rules/layout-half-empty-page.md",
      "docs/rules/layout-orphaned-continuation-page.md",
    ]) {
      const text = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      assert.equal(FALSE_CEILING.exec(text)?.[0] ?? null, null, `${file} still states a net-fill ceiling`);
    }
  });
});
