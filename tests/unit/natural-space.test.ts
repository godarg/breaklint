/**
 * The natural space `type/excessive-word-spacing` divides by (G-83).
 *
 * THE DEFECT. The collector read a block's natural space from its FIRST rendered whitespace. Measured
 * on patched Chromium 141 (Paged.js 0.4.3, no evidence binding): in a justified monospace block whose
 * first space falls at a line end, that space is collapsed to 0.02 px, and an ordinary justified gap
 * was reported as "540.50× the natural space". Where the first space falls inside a justified line it
 * is stretched, 10.84 px against a 7.22 px font space, which hides wide gaps instead. Neither is the
 * natural space.
 *
 * THE FIX, under test here as the real in-page payload over the fake page tree
 * (`tests/fixtures/paged-dom.ts`): the collector asks the captured primitive `spaceAdvance` for the
 * block's own font's space advance — a canvas measurement in production, a quarter of the pixel size
 * plus the letter-spacing in the fake, so a test can tell it from the 4 px the fake's rendered ranges
 * give per character — and records 0 when the font cannot be reproduced or is not loaded. The rule
 * declines a block with no natural space instead of dividing by a guess.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runDocument } from "../../src/core/engine.ts";
import type { RawSnapshot } from "../../src/measure/snapshot.ts";
import { SNAPSHOT_SOURCE } from "../../src/measure/snapshot.ts";
import { PRIMITIVES_SOURCE, SPACE_ADVANCE_FACTORY_SOURCE } from "../../src/measure/primitives.ts";
import { excessiveWordSpacing } from "../../src/rules/type/excessive-word-spacing.ts";
import { loadCorpus } from "../fixtures/corpus.ts";
import { evaluatePayload, pagedDocument, pagedPage } from "../fixtures/paged-dom.ts";

function collected(paragraphs: string): RawSnapshot["blocks"] {
  const document = pagedDocument([pagedPage({ pageBox: [0, 0, 500, 700], contentBox: [20, 20, 460, 660], content: paragraphs })]);
  return evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, document).blocks;
}

const para = (sid: string, style: string, slot: number) =>
  `<p data-bl-sid="${sid}" data-test-box="20 ${20 + slot * 20} 200 20" style="${style}">aaa bbb ccc</p>`;

const words = (raw: RawSnapshot, sid: string) => {
  const block = raw.blocks.find((item) => item.sid === sid)!;
  return raw.textLines.filter((line) => line.blockKey === block.nodeKey).map((line) => line.wordBoxes?.map((box) => box.text) ?? null);
};

describe("the natural space the collector records", () => {
  it("is the block's own font's space advance, not a space rendered on the page", () => {
    const blocks = collected(
      para("s1", "text-align: justify; font-family: monospace; font-size: 12px", 0) +
      para("s2", "font-size: 16px; letter-spacing: 1.5px", 1) +
      para("s3", "font-size: 20px; font-style: italic; font-weight: 700; font-stretch: 75%; font-variant-caps: small-caps", 2),
    );
    // The fake's rendered space is 4 px wide: the value the old code recorded.
    assert.deepEqual(blocks.map((block) => block.spaceWidth), [3, 5.5, 5]);
  });

  it("keys the canvas measurement by letter-spacing too, so one font's spacings do not share a value", () => {
    const blocks = collected(para("s1", "font-size: 12px", 0) + para("s2", "font-size: 12px; letter-spacing: 2px", 1));
    assert.deepEqual(blocks.map((block) => block.spaceWidth), [3, 5]);
  });

  it("scales the canvas advance by the effective zoom, which computed font sizes do not carry", () => {
    // 12 px under zoom 2 × 1.25: the canvas answers 3 for the unzoomed size, the page prints 7.5.
    const blocks = collected(`<div style="zoom: 2">${para("s1", "font-size: 12px; zoom: 1.25", 0)}</div>` + para("s2", "font-size: 12px", 1));
    assert.deepEqual(blocks.map((block) => block.spaceWidth), [7.5, 3]);
  });

  it("takes variation settings that only restate the computed weight to the canvas, and nothing else", () => {
    const blocks = collected(
      para("s1", "font-size: 12px; font-variation-settings: 'wght' 400", 0) +
      para("s2", "font-size: 12px; font-weight: 700; font-variation-settings: 'wght' 700", 1) +
      para("s3", "font-size: 12px; font-variation-settings: 'wght' 700", 2) +
      para("s4", "font-size: 12px; font-variation-settings: 'wght' 400, 'opsz' 12", 3),
    );
    assert.deepEqual(blocks.map((block) => block.spaceWidth), [3, 3, 0, 0]);
  });

  it("is 0 — never a fraction of the font size — when neither the canvas nor the layout can say", () => {
    const blocks = collected(
      para("s1", "font-family: unloaded-face; font-size: 12px", 0) +
      para("s2", "font-size: 12px; font-stretch: 93%", 1) +
      para("s3", "font-size: 12px; font-variation-settings: 'wdth' 80", 2) +
      para("s4", "font-size: 12px; font-size-adjust: 0.5", 3) +
      para("s5", "font-size: 12px; font-variant-caps: all-small-caps", 4) +
      para("s6", "font-size: 12px; font-variant-caps: petite-caps", 5),
    );
    assert.deepEqual(blocks.map((block) => block.spaceWidth), [0, 0, 0, 0, 0, 0]);
  });

  it("falls back to the gaps of unjustified last lines in the same font, and to nothing else", () => {
    const opsz = "font-size: 12px; font-variation-settings: 'opsz' 12";
    const raw = evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, pagedDocument([pagedPage({
      pageBox: [0, 0, 500, 700], contentBox: [20, 20, 460, 660], content:
        // justified, a canvas cannot reproduce it: its own last line's gaps (4 px in the fake) are the space;
        para("s1", `text-align: justify; ${opsz}`, 0) +
        // the same font, not justified: no line of its own to read, the pooled value applies;
        para("s2", opsz, 1) +
        // the same size but another font: nothing to pool from;
        para("s3", "font-size: 12px; font-family: monospace; font-variation-settings: 'opsz' 12", 2) +
        // justified with a justified last line: that line is stretched and is no sample;
        para("s4", "text-align: justify; text-align-last: justify; font-size: 13px; font-variation-settings: 'opsz' 13", 3) +
        // a justified block with a nested source block is no sample: its last line may be the nested block's;
        `<div data-bl-sid="s5" data-test-box="20 100 200 20" style="text-align: justify; font-size: 14px; font-variation-settings: 'opsz' 14">aaa bbb ${para("s6", "font-size: 15px", 5)}</div>`,
    })]));
    assert.deepEqual(["s1", "s2", "s3", "s4", "s5"].map((sid) => raw.blocks.find((block) => block.sid === sid)!.spaceWidth), [4, 4, 0, 0, 0]);
  });

  it("reads the gaps of justified lines, and takes justification from the block container for display: contents", () => {
    const raw = evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, pagedDocument([pagedPage({
      pageBox: [0, 0, 500, 700], contentBox: [20, 20, 460, 660], content:
        `<div style="text-align: justify"><p data-bl-sid="s1" data-test-box="20 20 200 20" style="display: contents; text-align: left">aaa bbb ccc</p></div>` +
        para("s2", "text-align: left", 1),
    })]));
    assert.deepEqual(words(raw, "s1"), [["aaa", "bbb", "ccc"]], "the lines of a display: contents paragraph in a justified container carry no word boxes");
    assert.deepEqual(words(raw, "s2"), [null]);
  });

  it("keeps the gaps of an inline element with its own word-spacing out of the word boxes", () => {
    const raw = evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, pagedDocument([pagedPage({
      pageBox: [0, 0, 500, 700], contentBox: [20, 20, 460, 660], content:
        `<p data-bl-sid="s1" data-test-box="20 20 200 20" style="text-align: justify">aaa <span data-test-box="40 20 40 20" style="word-spacing: 10px">xx yy</span> ccc</p>`,
    })]));
    // The author's spaced run is one unit: no gap inside it is judged.
    assert.deepEqual(words(raw, "s1"), [["aaa", "xx yy", "ccc"]]);
  });

  it("is read through the captured primitive, which is the factory the unit suite runs", () => {
    assert.match(SNAPSHOT_SOURCE, /P\.spaceAdvance\(facts\.font, facts\.letterSpacing\)/u);
    assert.doesNotMatch(SNAPSHOT_SOURCE, /fontSize \* 0\.33/u, "the guessed fallback is back");
    assert.ok(PRIMITIVES_SOURCE.includes(`spaceAdvance: (${SPACE_ADVANCE_FACTORY_SOURCE})(`), "the primitive is not the factory under test");
  });
});

describe("the captured natural-space measurement over a fake canvas", () => {
  type Deps = {
    loaded: (font: string) => boolean; context: () => unknown; setFont: (context: unknown, value: string) => void;
    getFont: (context: unknown) => string; setLetterSpacing: ((context: unknown, value: string) => void) | null;
    getLetterSpacing: (context: unknown) => string; measureSpace: (context: unknown) => number; sentinel: string;
  };
  const factory = new Function(`return ${SPACE_ADVANCE_FACTORY_SOURCE};`)() as (deps: Deps) => (font: string, letterSpacing: string) => number | null;
  function canvas(over: Partial<Deps> & { accepts?: boolean; width?: number; spacingReadBack?: (value: string) => string } = {}) {
    const calls: string[] = [];
    let font = "10px sans-serif";
    let spacing = "0px";
    const deps: Deps = {
      loaded: () => true,
      context: () => { calls.push("context"); return {}; },
      setFont: (_c, value) => { calls.push(`font=${value}`); if (value === "7px __breaklint_space_sentinel__" || over.accepts !== false) font = value; },
      getFont: () => font,
      setLetterSpacing: (_c, value) => { spacing = value; },
      getLetterSpacing: () => (over.spacingReadBack ? over.spacingReadBack(spacing) : spacing),
      measureSpace: () => over.width ?? 3.25,
      sentinel: "7px __breaklint_space_sentinel__",
      ...over,
    };
    return { measure: factory(deps), calls };
  }

  it("answers the canvas width, having set the sentinel before the font", () => {
    const { measure, calls } = canvas();
    assert.equal(measure("normal normal 400 normal 12px serif", "1px"), 3.25);
    assert.deepEqual(calls, ["context", "font=7px __breaklint_space_sentinel__", "font=normal normal 400 normal 12px serif"]);
  });

  it("does not ask the canvas for a font that is not loaded", () => {
    const { measure, calls } = canvas({ loaded: () => false });
    assert.equal(measure("normal normal 400 normal 12px serif", "0px"), null);
    assert.deepEqual(calls, []);
  });

  it("answers null when the canvas rejected the shorthand and kept the sentinel", () => {
    assert.equal(canvas({ accepts: false }).measure("oblique 400deg 12px serif", "0px"), null);
  });

  it("answers null when the letter-spacing does not read back as set, or cannot be set", () => {
    assert.equal(canvas({ spacingReadBack: () => "0px" }).measure("12px serif", "2px"), null);
    assert.equal(canvas({ setLetterSpacing: null }).measure("12px serif", "2px"), null);
    assert.equal(canvas({ setLetterSpacing: null }).measure("12px serif", "0px"), 3.25);
  });

  it("answers null for a width that is not a positive finite number, and when anything throws", () => {
    for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(canvas({ width }).measure("12px serif", "0px"), null, String(width));
    assert.equal(canvas({ measureSpace: () => { throw new Error("tainted"); } }).measure("12px serif", "0px"), null);
  });
});

describe("type/excessive-word-spacing without a natural space", () => {
  it("declines the block as env/invalid-measurement and counts it, instead of leaving it out", () => {
    const snapshot = structuredClone(loadCorpus().find((entry) => entry.name === "word-spacing-trigger")!.snapshot);
    snapshot.blocks[0]!.spaceWidth = 0;
    const report = runDocument(
      { path: "doc.html", snapshot, infrastructure: [] },
      { failOn: "never", activeRules: [excessiveWordSpacing], optionsByRule: {}, coverageFloors: {} },
    ).report;
    assert.deepEqual(report.findings, []);
    assert.deepEqual(
      { candidates: report.coverage["type/excessive-word-spacing"]?.candidates, measured: report.coverage["type/excessive-word-spacing"]?.measured },
      { candidates: 1, measured: 0 },
    );
    assert.deepEqual(report.notMeasured.map((entry) => [entry.ruleId, entry.reason]), [["type/excessive-word-spacing", "env/invalid-measurement"]]);
    const row = report.evaluations.find((item) => item.ruleId === "type/excessive-word-spacing")!;
    assert.equal(row.status, "not-measured");
    assert.equal(row.reason, "env/invalid-measurement");
  });
});
