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
import { PRIMITIVES_SOURCE } from "../../src/measure/primitives.ts";
import { excessiveWordSpacing } from "../../src/rules/type/excessive-word-spacing.ts";
import { loadCorpus } from "../fixtures/corpus.ts";
import { evaluatePayload, pagedDocument, pagedPage } from "../fixtures/paged-dom.ts";

function collected(paragraphs: string): RawSnapshot["blocks"] {
  const document = pagedDocument([pagedPage({ pageBox: [0, 0, 500, 700], contentBox: [20, 20, 460, 660], content: paragraphs })]);
  return evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, document).blocks;
}

const para = (sid: string, style: string, slot: number) =>
  `<p data-bl-sid="${sid}" data-test-box="20 ${20 + slot * 20} 200 20" style="${style}">aaa bbb ccc</p>`;

describe("the natural space the collector records", () => {
  it("is the block's own font's space advance, not a space rendered on the page", () => {
    const blocks = collected(
      para("s1", "text-align: justify; font-family: monospace; font-size: 12px", 0) +
      para("s2", "font-size: 16px; letter-spacing: 1.5px", 1) +
      para("s3", "font-size: 20px; font-style: italic; font-weight: 700; font-stretch: 75%; font-variant-caps: small-caps", 2),
    );
    // The fake's rendered range for one space is 4 px wide: the value the old code recorded.
    assert.deepEqual(blocks.map((block) => block.spaceWidth), [3, 5.5, 5]);
  });

  it("is 0 — never a fraction of the font size — when the font cannot be reproduced or is not loaded", () => {
    const blocks = collected(
      para("s1", "font-family: unloaded-face; font-size: 12px", 0) +
      para("s2", "font-size: 12px; font-stretch: 93%", 1) +
      para("s3", "font-size: 12px; font-variation-settings: 'wdth' 80", 2) +
      para("s4", "font-size: 12px; font-size-adjust: 0.5", 3),
    );
    assert.deepEqual(blocks.map((block) => block.spaceWidth), [0, 0, 0, 0]);
  });

  it("is read through the captured primitive, and the primitive checks the font is loaded before it measures", () => {
    assert.match(SNAPSHOT_SOURCE, /P\.spaceAdvance\(font, letterSpacing\)/u);
    assert.doesNotMatch(SNAPSHOT_SOURCE, /fontSize \* 0\.33/u, "the guessed fallback is back");
    const at = PRIMITIVES_SOURCE.indexOf("spaceAdvance: (font, letterSpacing) =>");
    const body = PRIMITIVES_SOURCE.slice(at, PRIMITIVES_SOURCE.indexOf("styleSheets: () =>", at));
    assert.ok(at >= 0, "spaceAdvance is not a captured primitive");
    assert.ok(body.indexOf("fontCheckFn") >= 0 && body.indexOf("fontCheckFn") < body.indexOf("measureTextFn"),
      "the font must be known to be loaded before the canvas is asked: asking for an unloaded one starts a font load after the measured state");
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
