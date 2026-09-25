/**
 * Which block's widows and orphans judge a split: the block whose own container holds the lines
 * the break split — never a wrapper around it (G-82).
 *
 * THE DEFECT. The collector records a block's lines from every text node beneath it, so a
 * `<section>` around a paragraph carries the paragraph's line boxes as well. `layout/widow` and
 * `layout/orphan` counted those, and judged them by the SECTION's own value. Measured on patched
 * Chromium 141 with Paged.js 0.4.3, no evidence binding: a paragraph that asked for single-line
 * widows and was split 8+1 was reported as a widow of the section around it, and a paragraph that
 * moved to the next page whole left the section's first fragment with one line — the intro
 * paragraph's — reported as an orphan. Neither unwrapped control produced a finding.
 *
 * The snapshots below reproduce the recorded shapes: the same line box recorded once under each
 * block that contains it, in collection order (ancestors first on a page). Each case goes through
 * the real rule chain (`runDocument`), which is what a report is made from.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runDocument } from "../../src/core/engine.ts";
import type { BlockRecord, Snapshot, TextLine } from "../../src/core/types.ts";
import { orphan } from "../../src/rules/layout/orphan.ts";
import { widow } from "../../src/rules/layout/widow.ts";
import { excessiveWordSpacing } from "../../src/rules/type/excessive-word-spacing.ts";
// A namespace import: on a tree without the helpers, the report-level cases still run and show
// the defect, and only the helper cases fail on the missing function.
import * as shared from "../../src/rules/shared.ts";
import { loadCorpus } from "../fixtures/corpus.ts";

const LINE = 15.4;
/** Screen y of a line slot: pages are 800 px apart, as page boxes are laid out one below the other. */
const y = (page: number, slot: number) => (page - 1) * 800 + 48 + slot * LINE;

function base(): Snapshot {
  // A real corpus snapshot for its meta and two overflow-connected pages; blocks and lines replaced.
  const snapshot = structuredClone(loadCorpus().find((entry) => entry.name === "widow-trigger")!.snapshot);
  snapshot.blocks = [];
  snapshot.textLines = [];
  return snapshot;
}

function record(snapshot: Snapshot, nodeKey: string, over: Partial<BlockRecord> & { page: number }): BlockRecord {
  const template = structuredClone(loadCorpus().find((entry) => entry.name === "widow-trigger")!.snapshot.blocks[0]!);
  const block: BlockRecord = {
    ...template, nodeKey, sid: `s-${nodeKey}`, blockSignature: `signature of ${nodeKey}`, lines: [],
    fragmentIndex: 0, fragmentCount: 1, ...over,
    effectiveStyle: { ...template.effectiveStyle, widows: 2, orphans: 2, ...over.effectiveStyle },
  };
  snapshot.blocks.push(block);
  return block;
}

/** Record one line box under a block, the way the collector records it under each ancestor too. */
function lineOf(snapshot: Snapshot, block: BlockRecord, page: number, slot: number, x = 48, width = 120): TextLine {
  const index = block.lines!.length;
  const line: TextLine = { blockKey: block.nodeKey, index, box: { x, y: y(page, slot), width, height: 14 }, visible: true, width, wordBoxes: null };
  block.lines!.push(index);
  snapshot.textLines.push(line);
  return line;
}

const WITH_BOX = (page: number, from: number, to: number) => ({ x: 48, y: y(page, from), width: 399, height: (to - from) * LINE });
const NO_BOX = { x: 0, y: 0, width: 0, height: 0 };

function findings(snapshot: Snapshot) {
  const report = runDocument(
    { path: "doc.html", snapshot, infrastructure: [] },
    { failOn: "never", activeRules: [widow, orphan], optionsByRule: {}, coverageFloors: {} },
  ).report;
  return { report, list: report.findings.map((finding) => `${finding.ruleId} ${finding.target.nodeKey}`) };
}

/**
 * wrapper-widow: `<section><p lead/><div spacer/><p inner, widows 1>9 lines</p></section>`, the inner
 * paragraph split 8+1 on page 1 → 2. `innerWidows` 1 is the recorded case; 2 turns the inner split
 * into a real widow, which must be reported on the paragraph and nowhere else.
 */
function wrapperWidow(innerWidows: number): Snapshot {
  const snapshot = base();
  const section0 = record(snapshot, "sec:0", { page: 1, tag: "section", fragmentIndex: 0, fragmentCount: 2, box: WITH_BOX(1, 0, 10) });
  const lead = record(snapshot, "lead", { page: 1, box: WITH_BOX(1, 0, 1) });
  const inner0 = record(snapshot, "inner:0", { page: 1, fragmentIndex: 0, fragmentCount: 2, box: WITH_BOX(1, 2, 10), effectiveStyle: { widows: innerWidows } as BlockRecord["effectiveStyle"] });
  lineOf(snapshot, section0, 1, 0, 48, 41);
  lineOf(snapshot, lead, 1, 0, 48, 41);
  for (let slot = 2; slot < 10; slot += 1) { lineOf(snapshot, section0, 1, slot); lineOf(snapshot, inner0, 1, slot); }
  const section1 = record(snapshot, "sec:1", { page: 2, tag: "section", fragmentIndex: 1, fragmentCount: 2, box: WITH_BOX(2, 0, 1) });
  const inner1 = record(snapshot, "inner:1", { page: 2, fragmentIndex: 1, fragmentCount: 2, box: WITH_BOX(2, 0, 1), effectiveStyle: { widows: innerWidows } as BlockRecord["effectiveStyle"] });
  lineOf(snapshot, section1, 2, 0);
  lineOf(snapshot, inner1, 2, 0);
  return snapshot;
}

describe("line ownership: a split is judged at the block whose own container holds the split lines", () => {
  it("does not report a wrapper's widow for a paragraph split exactly as that paragraph asked", () => {
    const { list, report } = findings(wrapperWidow(1));
    assert.deepEqual(list, [], "the section was judged by its own value against its paragraph's lines");
    // Still candidates, still measured: the wrapper is accounted for, with its nested lines named.
    assert.equal(report.coverage["layout/widow"]?.candidates, 2);
    assert.equal(report.coverage["layout/widow"]?.measured, 2);
    const row = report.evaluations.find((item) => item.ruleId === "layout/widow" && item.targetRef.nodeKey === "sec:1")!;
    assert.equal(row.predicate.violated, false);
    assert.deepEqual(row.measurements.map((m) => [m.name, m.value]), [
      ["widow-applicable-opening-lines", false], ["opening-fragment-lines", 0],
      ["widows-requirement-exceeds-one", 2], ["opening-fragment-lines-of-nested-blocks", 1],
    ]);
  });

  it("reports a real widow once, on the paragraph that owns the line, not also on its wrapper", () => {
    assert.deepEqual(findings(wrapperWidow(2)).list, ["layout/widow inner:1"]);
  });

  it("does not report a wrapper's orphan when its first fragment holds only a nested paragraph's line", () => {
    // wrapper-orphan: `<section><p intro/><div spacer/><p inner>9 lines</p></section>`; the inner
    // paragraph moved whole to page 2, so the section's page-1 fragment holds the intro line only.
    const snapshot = base();
    const section0 = record(snapshot, "sec:0", { page: 1, tag: "section", fragmentIndex: 0, fragmentCount: 2, box: WITH_BOX(1, 0, 10) });
    const intro = record(snapshot, "intro", { page: 1, box: WITH_BOX(1, 0, 1) });
    record(snapshot, "spacer", { page: 1, tag: "div", box: WITH_BOX(1, 1, 10) });
    lineOf(snapshot, section0, 1, 0, 48, 44);
    lineOf(snapshot, intro, 1, 0, 48, 44);
    const section1 = record(snapshot, "sec:1", { page: 2, tag: "section", fragmentIndex: 1, fragmentCount: 2, box: WITH_BOX(2, 0, 9) });
    const inner = record(snapshot, "inner", { page: 2, box: WITH_BOX(2, 0, 9) });
    for (let slot = 0; slot < 9; slot += 1) { lineOf(snapshot, section1, 2, slot); lineOf(snapshot, inner, 2, slot); }
    assert.deepEqual(findings(snapshot).list, []);
  });

  it("counts the run of the wrapper's own lines next to the break, not every line it owns", () => {
    // `<section>own text<p>6 lines, split 3+3</p></section>`: the section owns one line on page 1,
    // at the top. Counting owned lines would report it as an orphan; the break split the paragraph.
    const snapshot = base();
    const section0 = record(snapshot, "sec:0", { page: 1, tag: "section", fragmentIndex: 0, fragmentCount: 2, box: WITH_BOX(1, 0, 4) });
    const p0 = record(snapshot, "p:0", { page: 1, fragmentIndex: 0, fragmentCount: 2, box: WITH_BOX(1, 1, 4) });
    lineOf(snapshot, section0, 1, 0);
    for (let slot = 1; slot < 4; slot += 1) { lineOf(snapshot, section0, 1, slot); lineOf(snapshot, p0, 1, slot); }
    const section1 = record(snapshot, "sec:1", { page: 2, tag: "section", fragmentIndex: 1, fragmentCount: 2, box: WITH_BOX(2, 0, 3) });
    const p1 = record(snapshot, "p:1", { page: 2, fragmentIndex: 1, fragmentCount: 2, box: WITH_BOX(2, 0, 3) });
    for (let slot = 0; slot < 3; slot += 1) { lineOf(snapshot, section1, 2, slot); lineOf(snapshot, p1, 2, slot); }
    const own = shared.lineOwnership(snapshot, { containers: true });
    assert.deepEqual(own(section0).lines.map((entry) => entry.owned), [true, false, false, false]);
    assert.equal(shared.closingOwnLines(own(section0)), 0);
    assert.equal(shared.openingOwnLines(own(section1)), 0);
    assert.deepEqual(findings(snapshot).list, []);
  });

  it("still reports the wrapper's own text when the break splits it", () => {
    // `<section><p>one line</p>own text over two lines</section>`, the own text split 1+1. The old
    // count added the paragraph's line and missed the orphan; the widow was reported either way.
    const snapshot = base();
    const section0 = record(snapshot, "sec:0", { page: 1, tag: "section", fragmentIndex: 0, fragmentCount: 2, box: WITH_BOX(1, 0, 2) });
    const p = record(snapshot, "p", { page: 1, box: WITH_BOX(1, 0, 1) });
    lineOf(snapshot, section0, 1, 0);
    lineOf(snapshot, p, 1, 0);
    lineOf(snapshot, section0, 1, 1);
    const section1 = record(snapshot, "sec:1", { page: 2, tag: "section", fragmentIndex: 1, fragmentCount: 2, box: WITH_BOX(2, 0, 1) });
    lineOf(snapshot, section1, 2, 0);
    assert.deepEqual(findings(snapshot).list.sort(), ["layout/orphan sec:0", "layout/widow sec:1"]);
  });

  it("keeps a line that carries the wrapper's own text beside a nested block's", () => {
    // A float beside the section's own text: the section's line box is wider than the float's.
    const snapshot = base();
    const section = record(snapshot, "sec", { page: 1, tag: "section", box: WITH_BOX(1, 0, 1) });
    const float = record(snapshot, "float", { page: 1, tag: "aside", box: { x: 48, y: y(1, 0), width: 100, height: LINE } });
    lineOf(snapshot, section, 1, 0, 48, 300);
    lineOf(snapshot, float, 1, 0, 48, 90);
    assert.deepEqual(shared.lineOwnership(snapshot, { containers: true })(section).lines.map((entry) => entry.owned), [true]);
  });

  it("gives a line spanned by two nested blocks side by side to them, not to the wrapper", () => {
    const snapshot = base();
    const row = record(snapshot, "row", { page: 1, tag: "div", box: WITH_BOX(1, 0, 1) });
    const left = record(snapshot, "left", { page: 1, box: { x: 48, y: y(1, 0), width: 150, height: LINE } });
    const right = record(snapshot, "right", { page: 1, box: { x: 250, y: y(1, 0), width: 150, height: LINE } });
    lineOf(snapshot, row, 1, 0, 48, 352);
    lineOf(snapshot, left, 1, 0, 48, 100);
    lineOf(snapshot, right, 1, 0, 250, 150);
    const own = shared.lineOwnership(snapshot, { containers: true });
    assert.deepEqual([own(row), own(left), own(right)].map((o) => o.lines.map((entry) => entry.owned)), [[false], [true], [true]]);
  });

  it("never lets a record without a box of its own (display: contents) take a line, or keep one its container holds", () => {
    // `<section><p style="display: contents">…</p></section>`: the paragraph generates no box, so its
    // lines are the section's, and the section's value judges the split.
    const snapshot = base();
    const section0 = record(snapshot, "sec:0", { page: 1, tag: "section", fragmentIndex: 0, fragmentCount: 2, box: WITH_BOX(1, 0, 8) });
    const contents0 = record(snapshot, "contents:0", { page: 1, fragmentIndex: 0, fragmentCount: 2, box: NO_BOX, effectiveStyle: { widows: 1, orphans: 1 } as BlockRecord["effectiveStyle"] });
    for (let slot = 0; slot < 8; slot += 1) { lineOf(snapshot, section0, 1, slot); lineOf(snapshot, contents0, 1, slot); }
    const section1 = record(snapshot, "sec:1", { page: 2, tag: "section", fragmentIndex: 1, fragmentCount: 2, box: WITH_BOX(2, 0, 1) });
    const contents1 = record(snapshot, "contents:1", { page: 2, fragmentIndex: 1, fragmentCount: 2, box: NO_BOX, effectiveStyle: { widows: 1, orphans: 1 } as BlockRecord["effectiveStyle"] });
    lineOf(snapshot, section1, 2, 0);
    lineOf(snapshot, contents1, 2, 0);
    const own = shared.lineOwnership(snapshot, { containers: true });
    assert.equal(shared.openingOwnLines(own(section1)), 1, "a box-less record took the line of the section around it");
    assert.equal(shared.openingOwnLines(own(contents1)), 0, "a box-less record kept a line its container holds");
    assert.deepEqual(findings(snapshot).list, ["layout/widow sec:1"]);
  });

  it("gives the lines of a box-less wrapper to the boxed block inside it", () => {
    const snapshot = base();
    const wrapper = record(snapshot, "contents-section", { page: 1, tag: "section", box: NO_BOX });
    const p = record(snapshot, "p", { page: 1, box: WITH_BOX(1, 0, 2) });
    for (let slot = 0; slot < 2; slot += 1) { lineOf(snapshot, wrapper, 1, slot); lineOf(snapshot, p, 1, slot); }
    const own = shared.lineOwnership(snapshot, { containers: true });
    assert.deepEqual([own(wrapper).delegated, shared.openingOwnLines(own(p))], [2, 2]);
  });

  it("gives a justified line's gaps to the element whose font sets them, box or not, never to a wrapper", () => {
    // `<div style="text-align: justify">` in a 3 px-space serif around a justified monospace
    // paragraph (7.22 px space) whose gap is seven spaces wide: judged by the div, the paragraph's
    // gap read 16.84 of the div's spaces (measured on patched Chromium 141).
    const snapshot = base();
    const justified = { textAlign: "justify", wordSpacing: "normal" } as BlockRecord["effectiveStyle"];
    const div = record(snapshot, "div", { page: 1, tag: "div", box: WITH_BOX(1, 0, 1), spaceWidth: 3, effectiveStyle: justified });
    const p = record(snapshot, "p", { page: 1, box: WITH_BOX(1, 0, 1), spaceWidth: 7.22, effectiveStyle: justified });
    const contents = record(snapshot, "contents", { page: 1, box: NO_BOX, spaceWidth: 7.22, effectiveStyle: justified });
    const words = (slot: number) => [
      { text: "cccccc", x: 48, y: y(1, slot), width: 43.36, height: 14 },
      { text: "dddd", x: 48 + 43.36 + 50.54, y: y(1, slot), width: 28.92, height: 14 },
    ];
    for (const owner of [div, p]) lineOf(snapshot, owner, 1, 0, 48, 122.82).wordBoxes = words(0);
    // A `display: contents` paragraph inside the div, on the next line: its own font's gaps too.
    const inContents = record(snapshot, "div-2", { page: 1, tag: "div", box: WITH_BOX(1, 1, 2), spaceWidth: 3, effectiveStyle: justified });
    snapshot.blocks.splice(snapshot.blocks.indexOf(contents), 1);
    snapshot.blocks.push(contents);
    for (const owner of [inContents, contents]) lineOf(snapshot, owner, 1, 1, 48, 122.82).wordBoxes = words(1);
    const report = runDocument(
      { path: "doc.html", snapshot, infrastructure: [] },
      { failOn: "never", activeRules: [excessiveWordSpacing], optionsByRule: {}, coverageFloors: {} },
    ).report;
    assert.deepEqual(
      report.findings.map((finding) => [finding.target.nodeKey, Number(finding.measurement.value.toFixed(2))]),
      [["p", 7], ["contents", 7]],
    );
  });

  it("changes nothing for a block without nested blocks: every line of the fragment counts", () => {
    // Every widow and orphan fixture except the wrapper ones, which are about nested blocks.
    for (const entry of loadCorpus().filter((item) => /^(widow|orphan)-/u.test(item.name) && !/wrapper/u.test(item.name))) {
      const own = shared.lineOwnership(entry.snapshot, { containers: true });
      for (const block of entry.snapshot.blocks) {
        const visible = entry.snapshot.textLines.filter((line) => line.blockKey === block.nodeKey && line.visible).length;
        assert.equal(shared.openingOwnLines(own(block)), visible, `${entry.name} ${block.nodeKey}`);
        assert.equal(shared.closingOwnLines(own(block)), visible, `${entry.name} ${block.nodeKey}`);
      }
    }
  });
});
