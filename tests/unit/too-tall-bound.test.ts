/**
 * `layout/unbreakable-block-too-tall` on a split block: the lower bound it reports, and the cases in
 * which it refuses to report one.
 *
 * A split block's fragment boxes do not add up to its height. Paged.js 0.4.3 repeats borders and
 * `!important` padding at a split, pushes the last line before the split into the hidden overflow
 * column beside the page, and then reads that fragment as a union box one page tall. What the rule
 * reports instead is the extent of the text lines in each fragment, summed: a number the block is
 * provably at least as tall as, under premises the rule checks where the snapshot lets it. The
 * shapes below are page geometry as measured on 2026-09-24 (150 x 120 mm pages, 15 mm margins,
 * pages 800 px apart, 10pt/1.4 text: glyph boxes 15 px on an 18.66 px pitch) — the frame-ancestor
 * case is the measured snapshot itself, record for record.
 *
 * Each case names the defect it catches; tests/unit/fragment-contract.test.ts holds the same rule to
 * split-invariance on the corpus.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fingerprint } from "../../src/core/fingerprint.ts";
import type { BlockRecord, Box, PageRecord, Snapshot, TextLine } from "../../src/core/types.ts";
import { unbreakableBlockTooTall } from "../../src/rules/layout/unbreakable-block-too-tall.ts";
import { loadCorpus } from "../fixtures/corpus.ts";
import { splitSnapshot } from "../fixtures/fragments.ts";

const STRIDE = 800;
const PITCH = 18.66;
const GLYPH = 15;
const LIMIT = 340.16;
const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });
const top = (page: number) => 56.69 + (page - 1) * STRIDE;

function page(n: number, width = 453.53): PageRecord {
  const base = structuredClone(loadCorpus().find((entry) => entry.name === "too-tall-trigger")!.snapshot.pages[0]!);
  return {
    ...base, pageNumber: n, nodeKey: `pg${n}`, firstSemanticBlockKey: `sig:page${n}`,
    contentBox: box(56.69, top(n), width, LIMIT),
  };
}

/** A record; `avoid` blocks are the candidates, everything else is content inside them. */
function record(nodeKey: string, over: Partial<BlockRecord> & Pick<BlockRecord, "page" | "box">): BlockRecord {
  const base = structuredClone(loadCorpus().find((entry) => entry.name === "too-tall-trigger")!.snapshot.blocks[0]!);
  return {
    ...base, nodeKey, sid: `s-${nodeKey.split(":")[0]}`, blockSignature: `signature of ${nodeKey.split(":")[0]}`,
    tag: "div", fragmentIndex: 0, fragmentCount: 1, lineHeight: 18.6667, lines: [],
    effectiveStyle: { ...base.effectiveStyle, breakInside: "auto", lineHeight: 18.6667 }, ...over,
  };
}
const avoid = (nodeKey: string, over: Partial<BlockRecord> & Pick<BlockRecord, "page" | "box">): BlockRecord => {
  const made = record(nodeKey, over);
  return { ...made, effectiveStyle: { ...made.effectiveStyle, breakInside: "avoid" } };
};

function lines(blockKey: string, count: number, y: number, x = 116.69, height = GLYPH, pitch = PITCH, width = 101.42): TextLine[] {
  return Array.from({ length: count }, (_, i) => ({
    blockKey, index: i, visible: true, width, wordBoxes: null,
    box: box(x, Math.round((y + i * pitch) * 100) / 100, width, height),
  }));
}

function snapshot(parts: { pages: PageRecord[]; blocks: BlockRecord[]; textLines: TextLine[] }): Snapshot {
  const base = structuredClone(loadCorpus().find((entry) => entry.name === "too-tall-trigger")!.snapshot);
  return { ...base, ...parts };
}

const run = (s: Snapshot) =>
  unbreakableBlockTooTall.run(s, { documentPath: "bound.html", options: unbreakableBlockTooTall.defaultOptions, fingerprint });
const rowOf = (result: ReturnType<typeof run>, nodeKey: string) =>
  result.evaluations!.find((row) => row.targetRef.nodeKey === nodeKey)!;
const measurement = (result: ReturnType<typeof run>, nodeKey: string, name: string) =>
  rowOf(result, nodeKey).measurements.find((m) => m.name === name)?.value;

/** 18 + 9 lines of 18.66 px on two pages: 503.82 px of text against a 340.16 px page. */
function twoFragments(): Snapshot {
  return snapshot({
    pages: [page(1), page(2), page(3)],
    blocks: [
      avoid("big:0", { page: 2, fragmentCount: 2, box: box(56.69, top(2), 453.53, 18 * PITCH), lineHeight: PITCH }),
      avoid("big:1", { page: 3, fragmentIndex: 1, fragmentCount: 2, box: box(56.69, top(3), 453.53, 9 * PITCH), lineHeight: PITCH }),
    ],
    textLines: [...lines("big:0", 18, top(2), 56.69, PITCH), ...lines("big:1", 9, top(3), 56.69, PITCH)],
  });
}

/**
 * The measured frame-ancestor snapshot: a block 301.19 px tall unsplit (14 lines in a 20 px border)
 * inside a wrapper with a 40 px border, split 2 ways because the wrapper's border leaves it 300 px on
 * a fresh page. Fragment 0 is a union box one page tall (its 12th line is in the overflow column, at
 * x = 1683.59); the boxes sum to 417.47 px.
 */
function frameAncestor(): Snapshot {
  const at = (blockKey: string, ys: readonly number[], width = 101.42): TextLine[] =>
    ys.map((y, index) => ({ blockKey, index, visible: true, width, wordBoxes: null, box: box(116.69, y, width, GLYPH) }));
  const p2 = at("inner:0", [917.69, 936.34, 955, 973.66, 992.31, 1010.97, 1029.63, 1048.28, 1066.94, 1085.59, 1104.25]);
  const residue: TextLine = { blockKey: "inner:0", index: 11, visible: true, width: 101.42, wordBoxes: null, box: box(1683.59, 857.69, 101.42, GLYPH) };
  const p3 = at("inner:1", [1717.69, 1736.34], 101.44);
  const paragraphs = [...p2, ...p3].map((line, i) =>
    record(`para${i}:0`, { page: line.box.y > STRIDE * 2 ? 3 : 2, box: box(116.69, line.box.y - 1, 333.53, 18.66) }));
  const paragraphLines = [...p2, ...p3].map((line, i) => ({ ...line, blockKey: `para${i}:0`, index: 0 }));
  const frameLines = (key: string, from: readonly TextLine[]) => from.map((line) => ({ ...line, blockKey: key }));
  return snapshot({
    pages: [page(1), page(2), page(3)],
    blocks: [
      record("frame:0", { page: 2, fragmentCount: 2, box: box(56.69, 856.69, 2020.44, 340.16) }),
      avoid("inner:0", { page: 2, fragmentCount: 2, box: box(96.69, 856.69, 1940.44, 340.16) }),
      ...paragraphs.filter((p) => p.page === 2),
      record("residue:0", { page: 2, box: box(1683.59, 856.69, 333.53, 18.66) }),
      record("frame:1", { page: 3, fragmentIndex: 1, fragmentCount: 2, box: box(56.69, 1656.69, 453.53, 157.31) }),
      avoid("inner:1", { page: 3, fragmentIndex: 1, fragmentCount: 2, box: box(96.69, 1696.69, 373.53, 77.31) }),
      ...paragraphs.filter((p) => p.page === 3),
    ],
    textLines: [
      ...p2, residue, ...p3, ...paragraphLines,
      { ...residue, blockKey: "residue:0", index: 0 },
      ...frameLines("frame:0", [...p2, residue]), ...frameLines("frame:1", p3),
    ],
  });
}

/**
 * The same kind of decorated split, built so the line in the overflow column is what decides:
 * fragment 0 begins 100 px down the page and reads as a union box from the top of the column; its
 * last line sits in the overflow column at the TOP of that column. 16 lines in a 20 px border fit an
 * empty page (16 x 18.66 + 40 = 338.56 px).
 */
function overflowColumn(): Snapshot {
  const residue: TextLine = { blockKey: "late:0", index: 9, visible: true, width: 101.42, wordBoxes: null, box: box(1683.59, 857.69, 101.42, GLYPH) };
  return snapshot({
    pages: [page(1), page(2), page(3)],
    blocks: [
      avoid("late:0", { page: 2, fragmentCount: 2, box: box(96.69, 856.69, 1940.44, 340.16) }),
      avoid("late:1", { page: 3, fragmentIndex: 1, fragmentCount: 2, box: box(96.69, 1696.69, 373.53, 133.28) }),
    ],
    textLines: [...lines("late:0", 9, 957.69), residue, ...lines("late:1", 6, 1717.69)],
  });
}

describe("layout/unbreakable-block-too-tall on a split block", () => {
  it("reports a block split into exactly two fragments, as at least the extent of their lines", () => {
    const result = run(twoFragments());
    assert.equal(result.findings.length, 1, "a block split into two fragments, each below the page, was not reported");
    const finding = result.findings[0]!;
    // 18 x 18.66 - 0.01 + 9 x 18.66 - 0.01: the snapshot's rounding is given back once per fragment.
    assert.equal(finding.measurement.value, 503.8);
    assert.equal(finding.measurement.threshold, LIMIT);
    assert.equal(finding.severity, "error");
    assert.equal(finding.measurement.proofSource, "A");
    assert.match(finding.message, /is at least 503\.80 px tall across the 2 fragments the paginator split it into/u);
    assert.match(finding.message, /counting only their text lines and replaced content, not borders, padding or the space around them/u);
    assert.match(finding.message, /content box of page 2 is 340\.16 px/u);
    assert.doesNotMatch(finding.message, /height its content needed/u);
    assert.equal(measurement(result, "big:0", "block-height-lower-bound"), 503.8);
    assert.equal(measurement(result, "big:0", "fragment-count"), 2);
    assert.equal(measurement(result, "big:0", "fragments-left-out"), 0);
    assert.equal(result.measured, 1);
  });

  it("declines the measured decorated-ancestor split as inconclusive: no false error, and no clean pass", () => {
    const result = run(frameAncestor());
    assert.deepEqual(result.findings, [], "a block 301.19 px tall that fits an empty page was reported");
    const row = rowOf(result, "inner:0");
    // The bound is below the page, so it proves nothing; the fragment boxes (417.47 px) are no upper
    // bound either. The block may well fit — the rule cannot show it, and says so.
    assert.equal(row.status, "not-measured");
    assert.equal(row.reason, "env/invalid-measurement");
    assert.equal(result.measured, 0);
    assert.deepEqual(result.notMeasured.map((entry) => [entry.reason, entry.count]), [["env/invalid-measurement", 1]]);
    // 11 lines on page 2 (917.69 to 1119.25) and 2 on page 3 (1717.69 to 1751.34), each less 0.01.
    assert.equal(measurement(result, "inner:0", "block-height-lower-bound"), 235.19);
    assert.ok(235.19 <= 301.19, "the bound is below the measured unsplit height");
  });

  it("does not count a line in the overflow column as part of the page", () => {
    const result = run(overflowColumn());
    assert.deepEqual(result.findings, [], "the line Paged.js pushed into the hidden column stretched fragment 0 to the column top");
    // 8 x 18.66 + 15 on page 2 and 5 x 18.66 + 15 on page 3, each less 0.01. Reading the overflow
    // line as part of page 2 would stretch that fragment to the column top: 372.56, above the page.
    assert.equal(measurement(result, "late:0", "block-height-lower-bound"), 272.56);
  });

  it("gives back the overhang of glyph boxes taller than the line height", () => {
    // 28 lines at line-height 12.05 px in a font whose glyph boxes are 15 px, in a 1 px border:
    // 339.4 px unsplit, which fits. Each glyph box sticks 1.475 px out of its line box above and
    // below; at the split the repeated 1 px border does not clip that, so the lines of the two
    // pieces read 341.38 px. The overhang (2.95 px per fragment) is given back.
    const pitch = 12.05;
    const piece = (key: string, pageNumber: number, fragmentIndex: number) =>
      avoid(key, { page: pageNumber, fragmentIndex, fragmentCount: 2, box: box(56.69, top(pageNumber), 453.53, 1 + 14 * pitch + 1), lineHeight: pitch });
    const glyphs = (key: string, pageNumber: number) => lines(key, 14, top(pageNumber) + 1 - (GLYPH - pitch) / 2, 56.69, GLYPH, pitch);
    const result = run(snapshot({
      pages: [page(1), page(2), page(3)],
      blocks: [piece("tight:0", 2, 0), piece("tight:1", 3, 1)],
      textLines: [...glyphs("tight:0", 2), ...glyphs("tight:1", 3)],
    }));
    assert.deepEqual(result.findings, [], "overhanging glyph boxes were counted on both sides of the split");
    assert.equal(measurement(result, "tight:0", "block-height-lower-bound"), 335.48);
  });

  it("leaves out a fragment on a page of another width", () => {
    // Fragment 1 is on a landscape page: its text would break into other lines at the first page's
    // width, so it cannot be placed in the unsplit block. Without it the bound is fragment 0 alone.
    const base = twoFragments();
    base.pages[2] = page(3, 700);
    const result = run(base);
    assert.deepEqual(result.findings, []);
    assert.equal(measurement(result, "big:0", "block-height-lower-bound"), 335.87);
    assert.equal(measurement(result, "big:0", "fragments-left-out"), 1, "a fragment was dropped without a word");
    assert.equal(rowOf(result, "big:0").status, "not-measured");
  });

  it("keeps the unsplit case exact, with the 0.5.0 message", () => {
    const result = run(loadCorpus().find((entry) => entry.name === "too-tall-trigger")!.snapshot);
    assert.equal(result.findings[0]!.measurement.value, 848);
    assert.equal(
      result.findings[0]!.message,
      "This block asks not to be broken and is 848.00 px tall; the content box of page 1 is 606.00 px. It did not fit there unbroken.",
    );
    assert.equal(measurement(result, "t1", "block-height"), 848);
  });

  it("reports the corpus trigger split 600.6 + 247.4 px, neither piece above the 606 px page", () => {
    // 39 lines on page 1 and 16 on page 2; the second box also holds the 1 px below the last line.
    const split = splitSnapshot(loadCorpus().find((entry) => entry.name === "too-tall-trigger")!.snapshot, "t1", 2, { lineCounts: [39, 16] });
    assert.deepEqual(split.blocks.map((block) => Math.round(block.box.height * 100) / 100), [600.6, 247.4]);
    const result = run(split);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0]!.measurement.value, 846.98);
  });
});

describe("layout/unbreakable-block-too-tall declines a split block it cannot bound", () => {
  const declinedFor = (s: Snapshot, nodeKey: string, name: string) => {
    const result = run(s);
    assert.deepEqual(result.findings, [], `${nodeKey}: reported although the bound's premise failed`);
    assert.equal(result.measured, 0);
    assert.deepEqual(result.notMeasured.map((row) => [row.reason, row.count]), [["env/invalid-measurement", 1]]);
    const row = rowOf(result, nodeKey);
    assert.equal(row.status, "not-measured");
    assert.equal(row.reason, "env/invalid-measurement");
    assert.ok(row.measurements.some((m) => m.name === name), `${nodeKey}: the row does not name ${name}: ${JSON.stringify(row.measurements)}`);
    return row;
  };

  it("declines side-by-side text: Paged.js re-lays each table fragment out and moves later cells whole", () => {
    // A two-cell row split inside its first cell (14 lines) whose second cell (12 lines) was moved to
    // the next page whole: unsplit the row is 14 lines tall (261.24 px, it fits), but page 2 carries
    // 12 lines of cell A and page 3 the rest of A beside all of B — 447.8 px of lines.
    const cell = (key: string, pageNumber: number, fragmentIndex: number, fragmentCount: number, x: number, count: number) =>
      record(key, { page: pageNumber, tag: "td", fragmentIndex, fragmentCount, box: box(x, top(pageNumber), 226.77, count * PITCH) });
    const aLines2 = lines("a:0", 12, top(2) + 1, 56.69);
    const aLines3 = lines("a:1", 2, top(3) + 1, 56.69);
    const bLines3 = lines("b:0", 12, top(3) + 1, 283.46);
    const merged = (key: string, from: readonly TextLine[]) => from.map((line) => ({ ...line, blockKey: key }));
    declinedFor(snapshot({
      pages: [page(1), page(2), page(3)],
      blocks: [
        avoid("table:0", { page: 2, fragmentCount: 2, box: box(56.69, top(2), 453.53, 12 * PITCH) }),
        cell("a:0", 2, 0, 2, 56.69, 12),
        avoid("table:1", { page: 3, fragmentIndex: 1, fragmentCount: 2, box: box(56.69, top(3), 453.53, 12 * PITCH) }),
        cell("a:1", 3, 1, 2, 56.69, 2),
        cell("b:0", 3, 0, 1, 283.46, 12),
      ],
      textLines: [...aLines2, ...aLines3, ...bLines3, ...merged("table:0", aLines2), ...merged("table:1", [...aLines3, ...bLines3])],
    }), "table:0", "fragment-text-in-one-column");
  });

  it("declines a split element whose piece does not sit at the fragment's edge: repeated content", () => {
    // The measured absolutely-positioned-caption case: Paged.js laid the block's lines out again on
    // the next page, so each of its one-line paragraphs became a "split" element with a piece in the
    // middle of both fragments. 11 + 11 lines read 403 px for a block 302.53 px tall.
    const once = lines("dup:0", 11, 917.69);
    const again = lines("dup:1", 11, 1717.69);
    const paragraph = (i: number, pageNumber: number, fragmentIndex: number, y: number) =>
      record(`p${i}:${fragmentIndex}`, { sid: `s-p${i}`, page: pageNumber, fragmentIndex, fragmentCount: 2, box: box(116.69, y - 1, 333.53, 18.66) });
    declinedFor(snapshot({
      pages: [page(1), page(2), page(3)],
      blocks: [
        avoid("dup:0", { page: 2, fragmentCount: 2, box: box(96.69, 856.69, 1940.44, 340.16) }),
        ...once.map((line, i) => paragraph(i, 2, 0, line.box.y)),
        avoid("dup:1", { page: 3, fragmentIndex: 1, fragmentCount: 2, box: box(96.69, 1656.69, 1940.44, 340.16) }),
        ...again.map((line, i) => paragraph(i, 3, 1, line.box.y)),
      ],
      textLines: [
        ...once, ...again,
        ...once.map((line, i) => ({ ...line, blockKey: `p${i}:0`, index: 0 })),
        ...again.map((line, i) => ({ ...line, blockKey: `p${i}:1`, index: 1 })),
      ],
    }), "dup:0", "split-pieces-at-fragment-edges");
  });

  it("declines text that reaches out of its own box: a fixed height repeated on every fragment", () => {
    // `height: 150px` and 18 lines: every fragment Paged.js makes is 150 px tall again, and the text
    // runs on below it. Clipped to the boxes, three fragments would read 450 px for a 150 px block.
    const fixed = (i: number) => avoid(`fixed:${i}`, { page: i + 2, fragmentIndex: i, fragmentCount: 3, box: box(56.69, top(i + 2), 453.53, 150) });
    declinedFor(snapshot({
      pages: [page(1), page(2), page(3), page(4)],
      blocks: [fixed(0), fixed(1), fixed(2)],
      textLines: [0, 1, 2].flatMap((i) => lines(`fixed:${i}`, 16, top(i + 2) + 1, 56.69)),
    }), "fixed:0", "fragment-content-inside-its-box");
  });

  it("declines a split block with no text line at all rather than bounding it at zero", () => {
    const pictures = twoFragments();
    pictures.textLines = [];
    pictures.blocks.forEach((block) => { block.atomicBoxes = []; });
    declinedFor(pictures, "big:0", "fragment-content-items");
  });
});

describe("layout/unbreakable-block-too-tall counts replaced content, and not the page it did not print on", () => {
  /**
   * A figure of five 200 px panels and a one-line caption (the verifier's c-figure-caption shape,
   * 1018.66 px unsplit): one panel per page, the caption under the last. Counting text lines only,
   * the bound was the caption — 14.99 px — and the block passed silently.
   */
  function figure(): Snapshot {
    const panel = (pageNumber: number) => ({ tag: "svg", box: box(56.69, top(pageNumber), 300, 200) });
    const blocks = [0, 1, 2, 3, 4].map((i) => avoid(`fig:${i}`, {
      page: i + 2, fragmentIndex: i, fragmentCount: 5, tag: "figure",
      box: box(56.69, top(i + 2), 453.53, i === 4 ? 200 + PITCH : 200), atomicBoxes: [panel(i + 2)],
    }));
    blocks.push(record("cap:0", { page: 6, tag: "figcaption", box: box(56.69, top(6) + 200, 453.53, PITCH) }));
    const caption = lines("fig:4", 1, top(6) + 200 + (PITCH - GLYPH) / 2, 56.69);
    return snapshot({
      pages: [1, 2, 3, 4, 5, 6].map((n) => page(n)),
      blocks,
      textLines: [...caption, ...caption.map((line) => ({ ...line, blockKey: "cap:0" }))],
    });
  }

  it("bounds a split figure by its panels as well as its caption", () => {
    const result = run(figure());
    assert.equal(result.findings.length, 1, "a split figure five pages of panels tall was not reported");
    // 4 x (200 - 0.01) + (200 + 1.83 + 15 - 0.01): each panel, and the last with the caption under it.
    assert.equal(result.findings[0]!.measurement.value, 1016.78);
    assert.ok(1016.78 <= 1018.66, "the bound is below the measured unsplit height");
    assert.match(result.findings[0]!.message, /at least 1016\.78 px tall across the 5 fragments/u);
  });

  it("bounds a split block of panels alone, without any text line", () => {
    const panels = figure();
    panels.textLines = [];
    const result = run(panels);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0]!.measurement.value, 999.95);
  });

  it("does not count replaced content in the overflow column", () => {
    const hidden = figure();
    // Paged.js pushed the second panel into the hidden column beside page 3: printed nowhere.
    hidden.blocks[1]!.atomicBoxes = [{ tag: "svg", box: box(1683.59, top(3), 300, 200) }];
    assert.equal(run(hidden).findings[0]!.measurement.value, 816.79);
  });

  it("declines replaced content that reaches out of its record's box", () => {
    const spilling = figure();
    // A panel 30 px below its fragment's box: a fixed height the image overflows, repeated by the
    // paginator on every piece. It would be counted apart from what follows it in the flow.
    spilling.blocks[2]!.box = { ...spilling.blocks[2]!.box, height: 170 };
    const result = run(spilling);
    assert.deepEqual(result.findings, []);
    assert.equal(rowOf(result, "fig:0").status, "not-measured");
    assert.ok(rowOf(result, "fig:0").measurements.some((m) => m.name === "fragment-content-inside-its-box"));
  });
});

describe("layout/unbreakable-block-too-tall declines what lays content out other than as one flow", () => {
  const hazardRow = (s: Snapshot, nodeKey: string) => {
    const result = run(s);
    assert.deepEqual(result.findings, [], `${nodeKey}: reported although a flow hazard was recorded`);
    assert.equal(result.measured, 0);
    const row = rowOf(result, nodeKey);
    assert.equal(row.status, "not-measured");
    assert.equal(row.reason, "env/invalid-measurement");
    return row.measurements.find((m) => m.name === "flow-hazards")?.value;
  };

  it("declines a split block with a relatively offset, a transformed, or a multi-column element inside it", () => {
    // Measured on 2026-09-25 (Paged.js 0.4.3, patched Chromium 141): a block 301.19 px tall with one
    // paragraph moved up 55 px and one down 70 px read 360.20 px of lines; a two-column paragraph
    // inside a block 335.81 px tall read 347.13 px. Both would be a false error.
    for (const inside of [["offset"], ["transformed"], ["multicol"], ["out-of-flow"], ["float"], ["negative-margin"], ["overflowing-content"]] as const) {
      const s = twoFragments();
      s.blocks[1]!.flowHazards = { inside: [...inside], self: [], around: [] };
      assert.equal(hazardRow(s, "big:0"), `inside:${inside[0]}`);
    }
  });

  it("declines a split block that is itself transformed, or sits in a flex, grid or transformed ancestor", () => {
    const self = twoFragments();
    self.blocks[0]!.flowHazards = { inside: [], self: ["transformed"], around: [] };
    assert.equal(hazardRow(self, "big:0"), "self:transformed");
    const around = twoFragments();
    around.blocks[0]!.flowHazards = { inside: [], self: [], around: ["flex-or-grid", "transformed"] };
    assert.equal(hazardRow(around, "big:0"), "around:flex-or-grid around:transformed");
  });

  it("declines a record that does not carry the Snapshot 5 field instead of reading it as empty", () => {
    const s = twoFragments();
    delete (s.blocks[1] as Partial<BlockRecord>).flowHazards;
    assert.equal(hazardRow(s, "big:0"), "around:unrecorded inside:unrecorded self:unrecorded");
  });

  it("keeps an unsplit block exact whatever is inside it, and declines one drawn transformed", () => {
    const trigger = structuredClone(loadCorpus().find((entry) => entry.name === "too-tall-trigger")!.snapshot);
    trigger.blocks[0]!.flowHazards = { inside: ["multicol", "offset", "out-of-flow", "transformed"], self: [], around: ["flex-or-grid"] };
    // The box of an unsplit block is its height, whatever its content does.
    assert.equal(run(trigger).findings[0]!.measurement.value, 848);
    trigger.blocks[0]!.flowHazards = { inside: [], self: [], around: ["transformed"] };
    // getBoundingClientRect returns the transformed box, not the height that was laid out.
    assert.equal(hazardRow(trigger, "t1"), "around:transformed");
  });

  it("declines an unsplit block whose box reaches past the sheet into the overflow column", () => {
    const s = snapshot({
      pages: [page(1), page(2)],
      blocks: [avoid("union:0", { page: 2, box: box(96.69, top(2) - 1, 1940.44, 340.16) })],
      textLines: lines("union:0", 16, top(2)),
    });
    const result = run(s);
    assert.deepEqual(result.findings, []);
    assert.equal(rowOf(result, "union:0").status, "not-measured");
    assert.ok(rowOf(result, "union:0").measurements.some((m) => m.name === "box-within-the-sheet" && m.value === false));
  });

  it("judges a split block whose first piece has no box at its first printed piece, never nowhere", () => {
    // A split element with a laid-out later piece WAS placed. It is judged at its lead fragment
    // (the first that printed as a visible box, WP-F1b) over all its fragments; the piece without a
    // box carries nothing to count. Here the printed piece alone is 9 lines, below the page: the
    // block is declined as inconclusive — never excluded, which would leave it judged nowhere.
    const s = twoFragments();
    s.blocks[0]!.box = box(0, 0, 0, 0);
    s.blocks[0]!.display = "none";
    s.blocks[0]!.lines = [];
    s.textLines = s.textLines.filter((line) => line.blockKey !== "big:0");
    const result = run(s);
    assert.equal(result.candidates, 1, "a placed split element was dropped from the candidates");
    assert.equal(result.measured, 0);
    assert.equal(rowOf(result, "big:0").reason, "rule/fragment-not-rendered");
    assert.equal(rowOf(result, "big:1").status, "not-measured");
    assert.equal(rowOf(result, "big:1").reason, "env/invalid-measurement");
    assert.equal(measurement(result, "big:1", "block-height-lower-bound"), 167.93);
  });
});

describe("layout/unbreakable-block-too-tall keeps every give-back of the bound", () => {
  it("rounds the bound down, never to the nearest hundredth", () => {
    // Line height 14.994 px under 15 px glyph boxes: 0.006 px of overhang per fragment. The extents
    // are 332.22 and 164.28 px; less the overhang and the rounding they are 496.468, which rounds to
    // 496.47 — a hundredth the block is not shown to have.
    const s = twoFragments();
    s.textLines = [...lines("big:0", 18, top(2)), ...lines("big:1", 9, top(3))];
    for (const block of s.blocks) block.lineHeight = 14.994;
    assert.equal(run(s).findings[0]!.measurement.value, 496.46);
  });

  it("gives the overhang back against the smallest line height of any element in the fragment", () => {
    // A paragraph inside each fragment sets its lines at 12 px: the glyph boxes (18.66 px) overhang
    // THOSE line boxes by 6.66 px, although the block's own line height would say none.
    const s = twoFragments();
    s.blocks.push(
      record("pa:0", { page: 2, box: box(56.69, top(2), 453.53, 18 * PITCH), lineHeight: 12 }),
      record("pb:0", { page: 3, box: box(56.69, top(3), 453.53, 9 * PITCH), lineHeight: 12 }),
    );
    s.textLines.push(...lines("pa:0", 18, top(2), 56.69, PITCH), ...lines("pb:0", 9, top(3), 56.69, PITCH));
    assert.equal(run(s).findings[0]!.measurement.value, 490.48);
  });

  it("declines a line that reaches out of its own box by more than its overhang", () => {
    // The last line runs 3 px below the fragment's box. Only an overhang of the glyph box over the
    // line height may do that, and at 18.66 px on 18.66 px there is none.
    const s = twoFragments();
    s.blocks[1]!.box = { ...s.blocks[1]!.box, height: 9 * PITCH - 3 };
    const result = run(s);
    assert.deepEqual(result.findings, []);
    assert.ok(rowOf(result, "big:0").measurements.some((m) => m.name === "fragment-content-inside-its-box"));
  });

  it("declines a piece of a split element that ends above the fragment's last line", () => {
    // A split paragraph inside fragment 0 whose piece stops three lines (55.98 px) short of the
    // fragment's end: after the break, everything in flow order is on the next page.
    const s = twoFragments();
    s.blocks.push(record("q:0", { page: 2, fragmentCount: 2, box: box(56.69, top(2), 453.53, 15 * PITCH) }));
    s.textLines.push(...lines("q:0", 15, top(2), 56.69, PITCH));
    const result = run(s);
    assert.deepEqual(result.findings, []);
    assert.ok(rowOf(result, "big:0").measurements.some((m) => m.name === "split-pieces-at-fragment-edges"));
  });

  it("declines a continued piece that does not begin the fragment", () => {
    const s = twoFragments();
    s.blocks.push(record("r:1", { page: 3, fragmentIndex: 1, fragmentCount: 2, box: box(56.69, top(3) + 4 * PITCH, 453.53, 5 * PITCH) }));
    s.textLines.push(...lines("r:1", 5, top(3) + 4 * PITCH, 56.69, PITCH));
    const result = run(s);
    assert.deepEqual(result.findings, []);
    assert.ok(rowOf(result, "big:0").measurements.some((m) => m.name === "split-pieces-at-fragment-edges"));
  });
});
