/**
 * The fragmentainer-residue report's pure half.
 *
 * The collection runs in a browser and is covered live; what is decided here is the sentence a
 * reader gets and the boundary between "residue" and "the whole document". Both were wrong once
 * in the same direction: the reconciliation that this report feeds used to say `freezeChanged:
 * true` beside four zeroes and three empty arrays, which is a measurement of nothing.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  ATOMIC_DISPLAYS,
  FRAGMENTAINER_RESIDUE_SOURCE,
  MAX_RESIDUE_SAMPLE,
  residueDetail,
  type FragmentainerReport,
} from "../../src/measure/fragmentainer.ts";

function report(over: Partial<FragmentainerReport> = {}): FragmentainerReport {
  return {
    pages: [2],
    count: 3,
    atomicCount: 3,
    pitchPx: 1816,
    sample: [
      { page: 2, column: 1, tag: "TR", display: "table-row", sourceId: "s0048", text: "row" },
      { page: 2, column: 1, tag: "TD", display: "table-cell", sourceId: "s0049", text: "left" },
      { page: 2, column: 1, tag: "TD", display: "table-cell", sourceId: "s0050", text: "right" },
    ],
    ...over,
  };
}

describe("the fragmentainer residue report", () => {
  /**
   * Every geometry and attribute read goes through the captured primitives.
   *
   * Same property, same reason as the freeze collector: a document that replaces
   * `getBoundingClientRect` would otherwise decide whether its own overflow is reported.
   */
  it("routes every page read through the captured primitives", () => {
    for (const seam of ["P.all(", "P.rect(", "P.style(", "P.attr(", "P.text("]) {
      assert.ok(FRAGMENTAINER_RESIDUE_SOURCE.includes(seam), `${seam} left the primitive boundary`);
    }
    assert.equal(/\bdocument\.querySelectorAll\b/u.test(FRAGMENTAINER_RESIDUE_SOURCE), false);
    assert.equal(/\.getBoundingClientRect\(/u.test(FRAGMENTAINER_RESIDUE_SOURCE), false);
  });

  /**
   * The cap lives in the page.
   *
   * One document of the reference corpus put 156 residual elements across 7 pages into the report.
   * A cap applied in the reporter would still have carried all 156 across the CDP boundary and
   * into the JSON, which is the canonical format and is not truncated.
   */
  it("caps the sample inside the collector rather than in a reporter", () => {
    assert.ok(FRAGMENTAINER_RESIDUE_SOURCE.includes(`const LIMIT = ${MAX_RESIDUE_SAMPLE};`));
    assert.ok(FRAGMENTAINER_RESIDUE_SOURCE.includes("into.length < LIMIT"));
  });

  /**
   * The tool's own marks are excluded.
   *
   * Measured: on a page whose only real residue was one paragraph, four `bl-mark` spans followed
   * the text they mark into the overflow column. Reporting them would attribute this tool's
   * injection to the user's document.
   */
  it("excludes the source-id marks this tool injects", () => {
    assert.ok(FRAGMENTAINER_RESIDUE_SOURCE.includes('P.attr(el, "class") === "bl-mark"'));
  });

  /**
   * The cap must not hide the elements that decide the outcome.
   *
   * Measured: on the largest document of the reference corpus — 156 residual elements over 7 pages,
   * 82 of them table boxes — a sample filled in document order held twelve spans and not one table
   * box, beside a headline reading "82 unsplittable table boxes". The reader was shown the noise
   * and told about the signal.
   */
  it("fills the sample with the atomic residue before anything else", () => {
    assert.ok(FRAGMENTAINER_RESIDUE_SOURCE.includes("const into = atomic ? atomicSample : otherSample;"));
    assert.ok(FRAGMENTAINER_RESIDUE_SOURCE.includes("atomicSample.concat(otherSample).slice(0, LIMIT)"));
  });

  it("names the count, the tags and the pages", () => {
    const detail = residueDetail(report());
    assert.match(detail, /3 element\(s\)/u);
    assert.match(detail, /TR, TD/u);
    assert.match(detail, /page\(s\) 2/u);
    assert.match(detail, /3 of them are unsplittable table boxes/u);
  });

  /**
   * A page list that grows with the document is the defect `report/infra.ts` exists to stop, and
   * `detail` is truncated at 220 characters in five of the six formats — so the summary has to
   * happen before the truncation, not instead of it.
   */
  it("summarises a long page list instead of printing it", () => {
    const detail = residueDetail(report({ pages: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], count: 40 }));
    assert.match(detail, /1, 2, 3, 4 and 6 more/u);
    assert.equal(detail.includes("10"), false, detail);
  });

  it("says nothing at all when there is no residue", () => {
    assert.equal(residueDetail(report({ pages: [], count: 0, atomicCount: 0, sample: [] })), "");
  });

  /**
   * The atomic clause is what distinguishes the six documents that could not be measured from the
   * two that carried residue and measured cleanly, so it must be absent when the count is zero
   * rather than reading "0 of them".
   */
  it("omits the atomic clause when nothing atomic is in the overflow column", () => {
    const detail = residueDetail(report({ atomicCount: 0 }));
    assert.equal(/unsplittable/u.test(detail), false, detail);
    assert.match(detail, /content it could not place on a page\./u);
  });

  it("the atomic display list is the set of table boxes a fragmentainer cannot split", () => {
    assert.deepEqual([...ATOMIC_DISPLAYS].sort(), [
      "table", "table-caption", "table-cell", "table-footer-group",
      "table-header-group", "table-row", "table-row-group",
    ]);
  });
});
