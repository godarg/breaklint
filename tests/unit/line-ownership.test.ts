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
    // Fragments of one source block share a sid, as the collector records them: "sec:0" and "sec:1"
    // are the two fragments of `s-sec`.
    ...template, nodeKey, sid: `s-${nodeKey.split(":")[0]}`, blockSignature: `signature of ${nodeKey}`, lines: [],
    fragmentIndex: 0, fragmentCount: 1, ...over,
    effectiveStyle: { ...template.effectiveStyle, widows: 2, orphans: 2, ...over.effectiveStyle },
  };
  snapshot.blocks.push(block);
  return block;
}

/**
 * Record one line box under a block, the way the collector records it under each ancestor too.
 * `own` is `TextLine.ownText`: whether some text on the line has this record as its block container
 * — false for a wrapper's copy of a nested block's line, and for a display: contents record's line.
 */
function lineOf(snapshot: Snapshot, block: BlockRecord, page: number, slot: number, x = 48, width = 120, own = true): TextLine {
  const index = block.lines!.length;
  const line: TextLine = { blockKey: block.nodeKey, index, box: { x, y: y(page, slot), width, height: 14 }, visible: true, ownText: own, width, wordBoxes: null };
  block.lines!.push(index);
  snapshot.textLines.push(line);
  return line;
}

const WITH_BOX = (page: number, from: number, to: number) => ({ x: 48, y: y(page, from), width: 399, height: (to - from) * LINE });
const NO_BOX = { x: 0, y: 0, width: 0, height: 0 };

/** Record a line box of any geometry under a block. */
function rowOf(snapshot: Snapshot, block: BlockRecord, box: { x: number; y: number; width: number; height: number }, own = true): TextLine {
  const index = block.lines!.length;
  const line: TextLine = { blockKey: block.nodeKey, index, box, visible: true, ownText: own, width: box.width, wordBoxes: null };
  block.lines!.push(index);
  snapshot.textLines.push(line);
  return line;
}

function findings(snapshot: Snapshot, extraLines = 0) {
  const report = runDocument(
    { path: "doc.html", snapshot, infrastructure: [] },
    { failOn: "never", activeRules: [widow, orphan], optionsByRule: { "layout/widow": { extraLines }, "layout/orphan": { extraLines } }, coverageFloors: {} },
  ).report;
  return { report, list: report.findings.map((finding) => `${finding.ruleId} ${finding.target.nodeKey}`) };
}

/**
 * wrapper-widow: `<section><p lead/><div spacer/><p inner, widows 1>9 lines</p></section>`, the inner
 * paragraph split 8+1 on page 1 → 2. `innerWidows` 1 is the recorded case; 2 turns the inner split
 * into a real widow, which must be reported on the paragraph and nowhere else.
 */
function wrapperWidow(innerWidows: number, innerWidth = 120): Snapshot {
  const snapshot = base();
  const section0 = record(snapshot, "sec:0", { page: 1, tag: "section", fragmentIndex: 0, fragmentCount: 2, box: WITH_BOX(1, 0, 10) });
  const lead = record(snapshot, "lead", { page: 1, box: WITH_BOX(1, 0, 1) });
  const inner0 = record(snapshot, "inner:0", { page: 1, fragmentIndex: 0, fragmentCount: 2, box: WITH_BOX(1, 2, 10), effectiveStyle: { widows: innerWidows } as BlockRecord["effectiveStyle"] });
  lineOf(snapshot, section0, 1, 0, 48, 41, false);
  lineOf(snapshot, lead, 1, 0, 48, 41);
  for (let slot = 2; slot < 10; slot += 1) { lineOf(snapshot, section0, 1, slot, 48, 120, false); lineOf(snapshot, inner0, 1, slot, 48, innerWidth); }
  const section1 = record(snapshot, "sec:1", { page: 2, tag: "section", fragmentIndex: 1, fragmentCount: 2, box: WITH_BOX(2, 0, 1) });
  const inner1 = record(snapshot, "inner:1", { page: 2, fragmentIndex: 1, fragmentCount: 2, box: WITH_BOX(2, 0, 1), effectiveStyle: { widows: innerWidows } as BlockRecord["effectiveStyle"] });
  lineOf(snapshot, section1, 2, 0, 48, 120, false);
  lineOf(snapshot, inner1, 2, 0, 48, innerWidth);
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
      ["previous-fragment-closing-lines", 0],
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
    lineOf(snapshot, section0, 1, 0, 48, 44, false);
    lineOf(snapshot, intro, 1, 0, 48, 44);
    const section1 = record(snapshot, "sec:1", { page: 2, tag: "section", fragmentIndex: 1, fragmentCount: 2, box: WITH_BOX(2, 0, 9) });
    const inner = record(snapshot, "inner", { page: 2, box: WITH_BOX(2, 0, 9) });
    for (let slot = 0; slot < 9; slot += 1) { lineOf(snapshot, section1, 2, slot, 48, 120, false); lineOf(snapshot, inner, 2, slot); }
    assert.deepEqual(findings(snapshot).list, []);
  });

  it("counts the run of the wrapper's own lines next to the break, not every line it owns", () => {
    // `<section>own text<p>6 lines, split 3+3</p></section>`: the section owns one line on page 1,
    // at the top. Counting owned lines would report it as an orphan; the break split the paragraph.
    const snapshot = base();
    const section0 = record(snapshot, "sec:0", { page: 1, tag: "section", fragmentIndex: 0, fragmentCount: 2, box: WITH_BOX(1, 0, 4) });
    const p0 = record(snapshot, "p:0", { page: 1, fragmentIndex: 0, fragmentCount: 2, box: WITH_BOX(1, 1, 4) });
    lineOf(snapshot, section0, 1, 0);
    for (let slot = 1; slot < 4; slot += 1) { lineOf(snapshot, section0, 1, slot, 48, 120, false); lineOf(snapshot, p0, 1, slot); }
    const section1 = record(snapshot, "sec:1", { page: 2, tag: "section", fragmentIndex: 1, fragmentCount: 2, box: WITH_BOX(2, 0, 3) });
    const p1 = record(snapshot, "p:1", { page: 2, fragmentIndex: 1, fragmentCount: 2, box: WITH_BOX(2, 0, 3) });
    for (let slot = 0; slot < 3; slot += 1) { lineOf(snapshot, section1, 2, slot, 48, 120, false); lineOf(snapshot, p1, 2, slot); }
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
    lineOf(snapshot, section0, 1, 0, 48, 120, false);
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
    lineOf(snapshot, row, 1, 0, 48, 352, false);
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
    const contents0 = record(snapshot, "contents:0", { page: 1, fragmentIndex: 0, fragmentCount: 2, box: NO_BOX, display: "contents", effectiveStyle: { widows: 1, orphans: 1 } as BlockRecord["effectiveStyle"] });
    for (let slot = 0; slot < 8; slot += 1) { lineOf(snapshot, section0, 1, slot); lineOf(snapshot, contents0, 1, slot, 48, 120, false); }
    const section1 = record(snapshot, "sec:1", { page: 2, tag: "section", fragmentIndex: 1, fragmentCount: 2, box: WITH_BOX(2, 0, 1) });
    const contents1 = record(snapshot, "contents:1", { page: 2, fragmentIndex: 1, fragmentCount: 2, box: NO_BOX, display: "contents", effectiveStyle: { widows: 1, orphans: 1 } as BlockRecord["effectiveStyle"] });
    lineOf(snapshot, section1, 2, 0);
    lineOf(snapshot, contents1, 2, 0, 48, 120, false);
    const own = shared.lineOwnership(snapshot, { containers: true });
    assert.equal(shared.openingOwnLines(own(section1)), 1, "a box-less record took the line of the section around it");
    assert.equal(shared.openingOwnLines(own(contents1)), 0, "a box-less record kept a line its container holds");
    const { list, report } = findings(snapshot);
    assert.deepEqual(list, ["layout/widow sec:1"]);
    // The display: contents record whose lines its container holds is measured (with no line of its
    // own), not declined: only one whose lines NO recorded block holds is declined.
    assert.deepEqual([report.coverage["layout/widow"]?.candidates, report.coverage["layout/widow"]?.measured], [2, 2]);
    assert.deepEqual(report.notMeasured, []);
  });

  it("gives the lines of a box-less wrapper to the boxed block inside it", () => {
    const snapshot = base();
    const wrapper = record(snapshot, "contents-section", { page: 1, tag: "section", box: NO_BOX });
    const p = record(snapshot, "p", { page: 1, box: WITH_BOX(1, 0, 2) });
    for (let slot = 0; slot < 2; slot += 1) { lineOf(snapshot, wrapper, 1, slot, 48, 120, false); lineOf(snapshot, p, 1, slot); }
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
    const contents = record(snapshot, "contents", { page: 1, box: NO_BOX, display: "contents", spaceWidth: 7.22, effectiveStyle: justified });
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

  it("gives a justified line to the nested block within the collector's rounding, and not beyond it", () => {
    // Word spacing asks whose text a line is by geometry (containers: false): the paragraph's line
    // box 0.3 px narrower than the div's is rounding; 1 px is text of the div's own beyond it.
    const build = (width: number) => {
      const snapshot = base();
      const justified = { textAlign: "justify", wordSpacing: "normal" } as BlockRecord["effectiveStyle"];
      const div = record(snapshot, "div", { page: 1, tag: "div", box: WITH_BOX(1, 0, 1), spaceWidth: 3, effectiveStyle: justified });
      const p = record(snapshot, "p", { page: 1, box: WITH_BOX(1, 0, 1), spaceWidth: 7.22, effectiveStyle: justified });
      const words = [
        { text: "cccccc", x: 48, y: y(1, 0), width: 43.36, height: 14 },
        { text: "dddd", x: 48 + 43.36 + 50.54, y: y(1, 0), width: 28.92, height: 14 },
      ];
      lineOf(snapshot, div, 1, 0, 48, 122.82, false).wordBoxes = words;
      lineOf(snapshot, p, 1, 0, 48, width).wordBoxes = words;
      return runDocument({ path: "doc.html", snapshot, infrastructure: [] },
        { failOn: "never", activeRules: [excessiveWordSpacing], optionsByRule: {}, coverageFloors: {} }).report
        .findings.map((finding) => finding.target.nodeKey);
    };
    assert.deepEqual(build(122.52), ["p"]);
    assert.deepEqual(build(121.82), ["div", "p"]);
  });

  it("counts the opening run of own lines, not every own line of the continuation", () => {
    // `<section>own a<p>own b… </p>…` split so the continuation opens with ONE own line, then a nested
    // paragraph's line, then two more own lines. The break split the one-line run.
    const snapshot = base();
    const section0 = record(snapshot, "sec:0", { page: 1, tag: "section", fragmentIndex: 0, fragmentCount: 2, box: WITH_BOX(1, 0, 2) });
    for (let slot = 0; slot < 2; slot += 1) lineOf(snapshot, section0, 1, slot);
    const section1 = record(snapshot, "sec:1", { page: 2, tag: "section", fragmentIndex: 1, fragmentCount: 2, box: WITH_BOX(2, 0, 4) });
    const p = record(snapshot, "p", { page: 2, box: WITH_BOX(2, 1, 2) });
    for (let slot = 0; slot < 4; slot += 1) lineOf(snapshot, section1, 2, slot, 48, 120, slot !== 1);
    lineOf(snapshot, p, 2, 1);
    assert.equal(shared.openingOwnLines(shared.lineOwnership(snapshot, { containers: true })(section1)), 1);
    assert.deepEqual(findings(snapshot).list, ["layout/widow sec:1"]);
  });

  it("does not end the own run at a float beside it", () => {
    // f09d: a float with padding-top beside the continuation of the section's own text. The float's
    // lines are recorded under the section as separate rows, 6 px below its own.
    const snapshot = base();
    const w0 = record(snapshot, "w:0", { page: 1, tag: "div", fragmentIndex: 0, fragmentCount: 2, box: WITH_BOX(1, 0, 5) });
    for (let slot = 0; slot < 5; slot += 1) lineOf(snapshot, w0, 1, slot);
    const w1 = record(snapshot, "w:1", { page: 2, tag: "div", fragmentIndex: 1, fragmentCount: 2, box: WITH_BOX(2, 0, 6) });
    const float = record(snapshot, "float", { page: 2, tag: "div", float: "right", box: { x: 347, y: y(2, 0), width: 100, height: 3 * LINE + 6 } });
    for (let slot = 0; slot < 6; slot += 1) {
      lineOf(snapshot, w1, 2, slot, 48, 20);
      if (slot < 3) for (const owner of [w1, float]) rowOf(snapshot, owner, { x: 347, y: y(2, slot) + 6, width: 20, height: 14 }, owner === float);
    }
    const own = shared.lineOwnership(snapshot, { containers: true });
    assert.deepEqual(own(w1).lines.map((entry) => entry.role).filter((role) => role !== "own"), ["beside", "beside", "beside"]);
    assert.equal(shared.openingOwnLines(own(w1)), 6);
    assert.deepEqual(findings(snapshot).list, []);
  });

  it("keeps a line whose own text sits between two floats, which together span it", () => {
    // n01 / f09c: floats on both sides at the top of the continuation page, the div's own text
    // between them. The floats' boxes span the line; the collector's own-text flag decides.
    const snapshot = base();
    const w0 = record(snapshot, "w:0", { page: 1, tag: "div", fragmentIndex: 0, fragmentCount: 2, box: WITH_BOX(1, 0, 5) });
    for (let slot = 0; slot < 5; slot += 1) lineOf(snapshot, w0, 1, slot);
    const w1 = record(snapshot, "w:1", { page: 2, tag: "div", fragmentIndex: 1, fragmentCount: 2, box: WITH_BOX(2, 0, 6) });
    const left = record(snapshot, "left", { page: 2, tag: "div", float: "left", box: { x: 48, y: y(2, 0), width: 60, height: 3 * LINE } });
    const right = record(snapshot, "right", { page: 2, tag: "div", float: "right", box: { x: 387, y: y(2, 0), width: 60, height: 3 * LINE } });
    for (let slot = 0; slot < 6; slot += 1) {
      // The div's line spans from the left float's text to the right float's; its own text is between.
      lineOf(snapshot, w1, 2, slot, 48, slot < 3 ? 399 : 20);
      if (slot < 3) { lineOf(snapshot, left, 2, slot, 48, 20); lineOf(snapshot, right, 2, slot, 427, 20); }
    }
    const own = shared.lineOwnership(snapshot, { containers: true });
    assert.equal(shared.openingOwnLines(own(w1)), 6);
    assert.deepEqual(findings(snapshot).list, []);
  });

  it("tells a full-line inline-block from a block child by the recorded display, not by geometry", () => {
    // f10b: `w1<br>w2<br><div style="display:inline-block; width:100%">ib1</div><br>x1…x4`. The
    // inline-block's line is geometrically a block child's; it is on the wrapper's own line run.
    const build = (display: string) => {
      const snapshot = base();
      const w0 = record(snapshot, "w:0", { page: 1, tag: "div", fragmentIndex: 0, fragmentCount: 2, box: WITH_BOX(1, 0, 3) });
      const ib = record(snapshot, "ib", { page: 1, tag: "div", display, box: WITH_BOX(1, 2, 3) });
      for (let slot = 0; slot < 3; slot += 1) lineOf(snapshot, w0, 1, slot, 48, slot === 2 ? 399 : 20, slot !== 2);
      lineOf(snapshot, ib, 1, 2, 48, 399);
      const w1 = record(snapshot, "w:1", { page: 2, tag: "div", fragmentIndex: 1, fragmentCount: 2, box: WITH_BOX(2, 0, 4) });
      for (let slot = 0; slot < 4; slot += 1) lineOf(snapshot, w1, 2, slot, 48, 20);
      return snapshot;
    };
    // orphans 2 + 1 extra line = 3: the run at the break is w1, w2 — the inline-block is passed over.
    assert.deepEqual(findings(build("inline-block"), 1).list, ["layout/orphan w:0"]);
    // As an in-flow block child the same geometry ends the run: the wrapper's own run at the foot is
    // empty, and a block child that fits whole is no orphan of anything.
    assert.deepEqual(findings(build("block"), 1).list, []);
  });

  it("does not report a wrapper's own text as split when a nested block meets the break on the other side", () => {
    // f03: `<section><p>5 lines</p>own line<p break-inside: avoid>8 lines</p></section>`: the own line
    // ends page 1 and the second paragraph moved whole. The own line is a complete run.
    const own = base();
    const s0 = record(own, "sec:0", { page: 1, tag: "section", fragmentIndex: 0, fragmentCount: 2, box: WITH_BOX(1, 0, 6) });
    const a = record(own, "a", { page: 1, box: WITH_BOX(1, 0, 5) });
    for (let slot = 0; slot < 6; slot += 1) lineOf(own, s0, 1, slot, 48, 120, slot === 5);
    for (let slot = 0; slot < 5; slot += 1) lineOf(own, a, 1, slot);
    const s1 = record(own, "sec:1", { page: 2, tag: "section", fragmentIndex: 1, fragmentCount: 2, box: WITH_BOX(2, 0, 8) });
    const b = record(own, "b", { page: 2, box: WITH_BOX(2, 0, 8) });
    for (let slot = 0; slot < 8; slot += 1) { lineOf(own, s1, 2, slot, 48, 120, false); lineOf(own, b, 2, slot); }
    assert.deepEqual(findings(own).list, []);
    // f04, the mirror: the nested paragraph ends page 1 and the section's own line opens page 2.
    const mirror = base();
    const m0 = record(mirror, "sec:0", { page: 1, tag: "section", fragmentIndex: 0, fragmentCount: 2, box: WITH_BOX(1, 0, 11) });
    const ma = record(mirror, "a", { page: 1, box: WITH_BOX(1, 0, 11) });
    for (let slot = 0; slot < 11; slot += 1) { lineOf(mirror, m0, 1, slot, 48, 120, false); lineOf(mirror, ma, 1, slot); }
    const m1 = record(mirror, "sec:1", { page: 2, tag: "section", fragmentIndex: 1, fragmentCount: 2, box: WITH_BOX(2, 0, 4) });
    const mb = record(mirror, "b", { page: 2, box: WITH_BOX(2, 1, 4) });
    for (let slot = 0; slot < 4; slot += 1) lineOf(mirror, m1, 2, slot, 48, 120, slot === 0);
    for (let slot = 1; slot < 4; slot += 1) lineOf(mirror, mb, 2, slot);
    const report = findings(mirror).report;
    assert.deepEqual(report.findings, []);
    const row = report.evaluations.find((item) => item.ruleId === "layout/widow" && item.targetRef.nodeKey === "sec:1")!;
    assert.deepEqual(row.measurements.filter((m) => /opening-fragment-lines$|previous-fragment/u.test(m.name)).map((m) => [m.name, m.value]),
      [["opening-fragment-lines", 1], ["previous-fragment-closing-lines", 0]]);
  });

  it("declines a display: contents record whose lines no recorded block holds, instead of judging them by its own value", () => {
    // f11c: `<body><p style="display: contents; widows: 5">8 lines</p>` split 5+3. The lines are the
    // body's, whose widows is the initial 2; the paragraph's 5 does not govern them.
    const snapshot = base();
    const p0 = record(snapshot, "p:0", { page: 1, fragmentIndex: 0, fragmentCount: 2, box: NO_BOX, display: "contents", effectiveStyle: { widows: 5 } as BlockRecord["effectiveStyle"] });
    for (let slot = 0; slot < 5; slot += 1) lineOf(snapshot, p0, 1, slot, 48, 120, false);
    const p1 = record(snapshot, "p:1", { page: 2, fragmentIndex: 1, fragmentCount: 2, box: NO_BOX, display: "contents", effectiveStyle: { widows: 5 } as BlockRecord["effectiveStyle"] });
    for (let slot = 0; slot < 3; slot += 1) lineOf(snapshot, p1, 2, slot, 48, 120, false);
    const { list, report } = findings(snapshot);
    assert.deepEqual(list, []);
    for (const ruleId of ["layout/widow", "layout/orphan"]) {
      assert.deepEqual([report.coverage[ruleId]?.candidates, report.coverage[ruleId]?.measured], [1, 0], ruleId);
    }
    assert.deepEqual(report.notMeasured.map((entry) => [entry.ruleId, entry.reason]).sort(),
      [["layout/orphan", "env/invalid-measurement"], ["layout/widow", "env/invalid-measurement"]]);
  });

  it("takes whether a display: contents record's lines are justified from the block container around it", () => {
    const build = (containerAlign: string, ownAlign: string) => {
      const snapshot = base();
      const div = record(snapshot, "div", { page: 1, tag: "div", box: WITH_BOX(1, 0, 1), spaceWidth: 7.22, effectiveStyle: { textAlign: containerAlign, wordSpacing: "normal" } as BlockRecord["effectiveStyle"] });
      const p = record(snapshot, "p", { page: 1, box: NO_BOX, display: "contents", spaceWidth: 7.22, effectiveStyle: { textAlign: ownAlign, wordSpacing: "normal" } as BlockRecord["effectiveStyle"] });
      const words = [
        { text: "cccccc", x: 48, y: y(1, 0), width: 43.36, height: 14 },
        { text: "dddd", x: 48 + 43.36 + 50.54, y: y(1, 0), width: 28.92, height: 14 },
      ];
      for (const owner of [div, p]) lineOf(snapshot, owner, 1, 0, 48, 122.82).wordBoxes = words;
      return runDocument({ path: "doc.html", snapshot, infrastructure: [] },
        { failOn: "never", activeRules: [excessiveWordSpacing], optionsByRule: {}, coverageFloors: {} }).report;
    };
    // `text-align: left` on the paragraph does not unjustify lines its justified container sets.
    assert.deepEqual(build("justify", "left").findings.map((finding) => finding.target.nodeKey), ["p"]);
    // And `justify` on it does not justify lines a left-aligned container sets: not a candidate.
    const left = build("left", "justify");
    assert.deepEqual([left.findings.length, left.coverage["type/excessive-word-spacing"]?.candidates ?? 0], [0, 0]);
  });

  it("keeps the one-sided count when a block's fragments cannot be joined by source id", () => {
    // f04 again, but the source id accounts for 2 of 3 fragments: the fragment before is unknown, so
    // the continuation's own opening line is judged on its own side, and the evaluation says so.
    const snapshot = base();
    const m0 = record(snapshot, "sec:0", { page: 1, tag: "section", fragmentIndex: 0, fragmentCount: 3, box: WITH_BOX(1, 0, 2) });
    const a = record(snapshot, "a", { page: 1, box: WITH_BOX(1, 0, 2) });
    for (let slot = 0; slot < 2; slot += 1) { lineOf(snapshot, m0, 1, slot, 48, 120, false); lineOf(snapshot, a, 1, slot); }
    const m1 = record(snapshot, "sec:1", { page: 2, tag: "section", fragmentIndex: 1, fragmentCount: 3, box: WITH_BOX(2, 0, 1) });
    lineOf(snapshot, m1, 2, 0);
    const { list, report } = findings(snapshot);
    // Unjoined, both sides of the one own line are judged on their own: a widow of the continuation
    // and, since a third fragment is counted, an orphan of it too.
    assert.deepEqual(list.sort(), ["layout/orphan sec:1", "layout/widow sec:1"]);
    const row = report.evaluations.find((item) => item.ruleId === "layout/widow" && item.targetRef.nodeKey === "sec:1")!;
    assert.equal(row.measurements.find((m) => m.name === "previous-fragment-closing-lines")!.value, null);
  });

  it("lets the OUTERMOST nested record on a line decide: a block inside an inline-block is beside", () => {
    // An inline-block alone on a full line holding a block paragraph: the paragraph is in the flow of
    // the inline-block, not of the div, whose run passes over the line (orphans 2 + 1 = 3: w1, w2).
    const snapshot = base();
    const w0 = record(snapshot, "w:0", { page: 1, tag: "div", fragmentIndex: 0, fragmentCount: 2, box: WITH_BOX(1, 0, 3) });
    const ib = record(snapshot, "ib", { page: 1, tag: "div", display: "inline-block", box: WITH_BOX(1, 2, 3) });
    const inner = record(snapshot, "inner", { page: 1, tag: "p", box: WITH_BOX(1, 2, 3) });
    for (let slot = 0; slot < 3; slot += 1) lineOf(snapshot, w0, 1, slot, 48, slot === 2 ? 399 : 20, slot !== 2);
    lineOf(snapshot, ib, 1, 2, 48, 399, false);
    lineOf(snapshot, inner, 1, 2, 48, 399);
    const w1 = record(snapshot, "w:1", { page: 2, tag: "div", fragmentIndex: 1, fragmentCount: 2, box: WITH_BOX(2, 0, 4) });
    for (let slot = 0; slot < 4; slot += 1) lineOf(snapshot, w1, 2, slot, 48, 20);
    assert.deepEqual(findings(snapshot, 1).list, ["layout/orphan w:0"]);
  });

  it("passes over an absolutely or fixed positioned nested block, and ends the run at a relative one", () => {
    for (const [position, expected] of [["absolute", ["layout/orphan w:0"]], ["fixed", ["layout/orphan w:0"]], ["relative", []]] as const) {
      const snapshot = base();
      const w0 = record(snapshot, "w:0", { page: 1, tag: "div", fragmentIndex: 0, fragmentCount: 2, box: WITH_BOX(1, 0, 3) });
      const box = record(snapshot, "box", { page: 1, tag: "div", position, box: WITH_BOX(1, 2, 3) });
      for (let slot = 0; slot < 3; slot += 1) lineOf(snapshot, w0, 1, slot, 48, slot === 2 ? 399 : 20, slot !== 2);
      lineOf(snapshot, box, 1, 2, 48, 399);
      const w1 = record(snapshot, "w:1", { page: 2, tag: "div", fragmentIndex: 1, fragmentCount: 2, box: WITH_BOX(2, 0, 4) });
      for (let slot = 0; slot < 4; slot += 1) lineOf(snapshot, w1, 2, slot, 48, 20);
      assert.deepEqual(findings(snapshot, 1).list, expected, position);
    }
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
