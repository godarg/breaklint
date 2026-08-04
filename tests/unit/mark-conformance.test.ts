/**
 * `matchMarks` is a pure function over plain data, so it belongs here and not only in the live
 * suite. That distinction is not bookkeeping: the live corpus is a real document, and in a real
 * document every paragraph starts at the same left margin and every page carries twenty marks.
 * Two defects hid in exactly that shadow — a page with a single pair, and a mark far out of
 * tolerance that was still reported as "verified" — and neither could have been provoked by any
 * document the corpus contained.
 *
 * The truth of each case here is CONSTRUCTED, not read back from the function under test: the
 * fixtures state a millimetre displacement, convert it to the units the two sides actually use,
 * and the assertion is about the displacement that was put in.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CONFORMANCE_TOLERANCE_MM, matchMarks } from "../../src/render/evidence.ts";
import type { PlacedMark } from "../../src/render/overlay.ts";
import type { PdfTextPage } from "../../src/render/rasterizer.ts";

const PX_PER_MM = 96 / 25.4;
const PT_PER_MM = 72 / 25.4;
/** A5 landscape in points, the page size the live corpus uses. Only the height matters here. */
const PAGE_HEIGHT_PT = 105 * PT_PER_MM;

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

/**
 * The PDF side. `offsetMm` displaces the extracted item relative to where the mark says it is —
 * so a case with `offsetMm.y = 40` describes a mark that is 40 mm from its glyph, and nothing
 * in the function under test was consulted to arrive at that number.
 */
function textPage(items: { token: string; xMm: number; yMm: number }[]): PdfTextPage {
  return {
    heightPt: PAGE_HEIGHT_PT,
    items: items.map((i) => ({
      text: i.token,
      x: i.xMm * PT_PER_MM,
      // The extractor reports y from the bottom; `matchMarks` flips it back.
      y: PAGE_HEIGHT_PT - i.yMm * PT_PER_MM,
    })),
  };
}

describe("matchMarks", () => {
  it("binds a target whose marks sit where the DOM said they do", () => {
    const marks = [mark("b1", "BLSID000A", 20, 30), mark("b1", "BLSID000E", 20, 36)];
    const result = matchMarks(marks, [textPage([
      { token: "BLSID000A", xMm: 20, yMm: 30 },
      { token: "BLSID000E", xMm: 20, yMm: 36 },
    ])]);
    assert.deepEqual([...result.boundSids], ["b1"]);
    const page = result.byPage.get(1)!;
    assert.equal(page.marksMatched, 2);
    assert.equal(page.targetsBound, 1);
    assert.equal(page.targetsTotal, 1);
    assert.equal(page.referenceFrom, "page");
    assert.ok(page.maxDxMm < 1e-9, `maxDxMm ${page.maxDxMm}`);
  });

  it("does NOT bind a page with a single pair, however far the mark is off", () => {
    // The degenerate case. With one pair the mean IS the value, so `|dy - mean|` is 0 for any
    // displacement whatsoever. Measured before the guard existed: a 40 mm error came out bound.
    const marks = [mark("b1", "BLSID000A", 20, 30)];
    const result = matchMarks(marks, [textPage([{ token: "BLSID000A", xMm: 20, yMm: 70 }])]);
    const page = result.byPage.get(1)!;
    assert.equal(page.marksMatched, 1, "the mark was found, so the guard is what has to refuse it");
    assert.equal(page.referenceFrom, "none", "a single pair in the whole document has no reference at all");
    assert.equal(page.targetsBound, 0);
    assert.deepEqual([...result.boundSids], []);
    // And the arithmetic of the self-referential criterion is shown, not just its consequence.
    assert.equal(page.maxDyMm, 0, "with one pair the residual around the reference is 0 by construction");
  });

  it("binds only the target that is in tolerance, not the page around it", () => {
    const marks = [
      mark("b1", "BLSID000A", 20, 30),
      mark("b1", "BLSID000E", 20, 36),
      mark("b2", "BLSID001A", 20, 50),
      mark("b2", "BLSID001E", 20, 56),
    ];
    const result = matchMarks(marks, [textPage([
      { token: "BLSID000A", xMm: 20, yMm: 30 },
      { token: "BLSID000E", xMm: 20, yMm: 36 },
      // b2 displaced 40 mm in x. Both of its marks are refound, so an implementation that asks
      // "were all marks found?" reports a fully conformant page.
      { token: "BLSID001A", xMm: 60, yMm: 50 },
      { token: "BLSID001E", xMm: 60, yMm: 56 },
    ])]);
    assert.deepEqual([...result.boundSids], ["b1"]);
    const page = result.byPage.get(1)!;
    assert.equal(page.marksMatched, 4, "all four were refound — that is the trap");
    assert.equal(page.marksTotal, 4);
    assert.equal(page.targetsTotal, 2);
    assert.equal(page.targetsBound, 1, "a page is only conformant when every target of it binds");
    assert.ok(Math.abs(page.maxDxMm - 40) < 1e-6, `maxDxMm ${page.maxDxMm}`);
  });

  it("one mark inside the tolerance is enough for its target", () => {
    // §11.4.3: a target binds if AT LEAST ONE of its marks is uniquely refound in tolerance.
    // Demanding both would drop a target for a reason that has nothing to do with its position.
    const marks = [
      mark("b1", "BLSID000A", 20, 30),
      mark("b1", "BLSID000E", 20, 36),
      mark("b2", "BLSID001A", 20, 50),
      mark("b2", "BLSID001E", 20, 56),
    ];
    const result = matchMarks(marks, [textPage([
      { token: "BLSID000A", xMm: 20, yMm: 30 },
      { token: "BLSID000E", xMm: 20, yMm: 36 },
      { token: "BLSID001A", xMm: 20, yMm: 50 },
      // the second mark of b2 is missing from the stream entirely
    ])]);
    assert.deepEqual([...result.boundSids].sort(), ["b1", "b2"]);
    const page = result.byPage.get(1)!;
    assert.equal(page.marksMatched, 3);
    assert.equal(page.marksTotal, 4);
    assert.equal(page.targetsBound, 2);
    assert.equal(result.ambiguous, 1);
  });

  it("a token found twice is not found", () => {
    // Two hits and zero hits are the same answer: the mark cannot stand for a position. Taking
    // the first of two would bind a finding to whichever the loop happened to reach.
    const marks = [mark("b1", "BLSID000A", 20, 30), mark("b1", "BLSID000E", 20, 36)];
    const result = matchMarks(marks, [textPage([
      { token: "BLSID000A", xMm: 20, yMm: 30 },
      { token: "BLSID000A", xMm: 20, yMm: 90 },
      { token: "BLSID000E", xMm: 20, yMm: 36 },
    ])]);
    assert.equal(result.ambiguous, 1);
    const page = result.byPage.get(1)!;
    assert.equal(page.marksMatched, 1);
    assert.equal(page.referenceFrom, "none", "one usable pair left in the whole document — no reference");
    assert.deepEqual([...result.boundSids], []);
  });

  it("the tolerance is the number the contract states", () => {
    // Stated as a literal on purpose. Deriving the fixtures from the exported constant makes the
    // test move with the defect: raising the threshold from 0.35 mm to 35 mm would leave every
    // case in this file green, because both sides of the comparison would have shifted.
    assert.equal(CONFORMANCE_TOLERANCE_MM, 0.35);
  });

  it("the tolerance is a real edge, not a formality", () => {
    const inside = 0.349;
    const outside = 0.351;
    for (const [displacement, expected] of [
      [inside, ["b2"]],
      [outside, []],
    ] as const) {
      const marks = [
        mark("b1", "BLSID000A", 20, 30),
        mark("b1", "BLSID000E", 20, 36),
        mark("b2", "BLSID001A", 20, 50),
        mark("b2", "BLSID001E", 20, 56),
      ];
      const result = matchMarks(marks, [textPage([
        { token: "BLSID000A", xMm: 20, yMm: 30 },
        { token: "BLSID000E", xMm: 20, yMm: 36 },
        { token: "BLSID001A", xMm: 20 + displacement, yMm: 50 },
        { token: "BLSID001E", xMm: 20 + displacement, yMm: 56 },
      ])]);
      const bound = [...result.boundSids].filter((s) => s === "b2");
      assert.deepEqual(bound, [...expected], `displacement ${displacement} mm in x`);
    }
  });

  it("a page with one pair borrows the document's reference and is judged, not waved through", () => {
    // The contract binds a target on ONE mark. Judging Δy against the page's own median makes
    // that vacuous when the page has a single pair — the median IS the value. The reference
    // therefore comes from the document, and the single mark is really judged.
    const marks = [
      mark("b1", "BLSID000A", 20, 30, 1),
      mark("b1", "BLSID000E", 20, 36, 1),
      mark("b2", "BLSID001A", 20, 50, 1),
      mark("b2", "BLSID001E", 20, 56, 1),
      mark("b3", "BLSID002A", 20, 20, 2),
    ];
    const good = matchMarks(marks, [
      textPage([
        { token: "BLSID000A", xMm: 20, yMm: 30 },
        { token: "BLSID000E", xMm: 20, yMm: 36 },
        { token: "BLSID001A", xMm: 20, yMm: 50 },
        { token: "BLSID001E", xMm: 20, yMm: 56 },
      ]),
      textPage([{ token: "BLSID002A", xMm: 20, yMm: 20 }]),
    ]);
    assert.equal(good.byPage.get(2)!.referenceFrom, "document");
    assert.ok(good.boundSids.has("b3"), "a correctly placed single mark lost its binding");

    // ... and the same page with the mark 40 mm out does NOT bind. Under the old rule it did.
    const bad = matchMarks(marks, [
      textPage([
        { token: "BLSID000A", xMm: 20, yMm: 30 },
        { token: "BLSID000E", xMm: 20, yMm: 36 },
        { token: "BLSID001A", xMm: 20, yMm: 50 },
        { token: "BLSID001E", xMm: 20, yMm: 56 },
      ]),
      textPage([{ token: "BLSID002A", xMm: 20, yMm: 60 }]),
    ]);
    assert.equal(bad.byPage.get(2)!.referenceFrom, "document");
    assert.ok(!bad.boundSids.has("b3"), "a mark 40 mm out was bound against a borrowed reference");
    assert.equal(bad.byPage.get(2)!.divergent, false, "a page without its own reference is never called divergent");
  });

  it("a page that has its own reference and binds nothing is divergent", () => {
    // Every mark shifted 40 mm in x. Δx is judged absolutely, so no target binds — while the
    // marks agree among themselves about where the reference is. That is the difference between
    // 'this document has an odd page' and 'the PDF does not reproduce what the rules measured'.
    const marks = [
      mark("b1", "BLSID000A", 20, 30),
      mark("b1", "BLSID000E", 20, 36),
      mark("b2", "BLSID001A", 20, 50),
      mark("b2", "BLSID001E", 20, 56),
    ];
    const result = matchMarks(marks, [
      textPage([
        { token: "BLSID000A", xMm: 60, yMm: 30 },
        { token: "BLSID000E", xMm: 60, yMm: 36 },
        { token: "BLSID001A", xMm: 60, yMm: 50 },
        { token: "BLSID001E", xMm: 60, yMm: 56 },
      ]),
    ]);
    assert.equal(result.byPage.get(1)!.referenceFrom, "page");
    assert.equal(result.byPage.get(1)!.targetsBound, 0);
    assert.equal(result.byPage.get(1)!.divergent, true);
    assert.equal(result.divergentPages, 1);
  });

  it("a page with one bad target among good ones is NOT divergent", () => {
    // The counterpart, and the reason divergence is not simply 'something is out of tolerance'.
    // One displaced target is a finding without evidence; it is not a broken apparatus.
    const marks = [
      mark("b1", "BLSID000A", 20, 30),
      mark("b1", "BLSID000E", 20, 36),
      mark("b2", "BLSID001A", 20, 50),
      mark("b2", "BLSID001E", 20, 56),
    ];
    const result = matchMarks(marks, [
      textPage([
        { token: "BLSID000A", xMm: 20, yMm: 30 },
        { token: "BLSID000E", xMm: 20, yMm: 36 },
        { token: "BLSID001A", xMm: 60, yMm: 50 },
        { token: "BLSID001E", xMm: 60, yMm: 56 },
      ]),
    ]);
    assert.equal(result.byPage.get(1)!.divergent, false);
    assert.equal(result.divergentPages, 0);
    assert.deepEqual([...result.boundSids], ["b1"]);
  });

  it("the reference is a median, so one grossly displaced mark cannot drag it", () => {
    // A mean would move by a quarter of the outlier's error and could pull correct marks out of
    // tolerance with it. Three good marks and one 40 mm out: the good ones must survive.
    const marks = [
      mark("b1", "BLSID000A", 20, 30),
      mark("b1", "BLSID000E", 20, 36),
      mark("b2", "BLSID001A", 20, 50),
      mark("b3", "BLSID002A", 20, 70),
    ];
    const result = matchMarks(marks, [
      textPage([
        { token: "BLSID000A", xMm: 20, yMm: 30 },
        { token: "BLSID000E", xMm: 20, yMm: 36 },
        { token: "BLSID001A", xMm: 20, yMm: 50 },
        { token: "BLSID002A", xMm: 20, yMm: 110 },
      ]),
    ]);
    assert.deepEqual([...result.boundSids].sort(), ["b1", "b2"]);
    assert.equal(result.byPage.get(1)!.divergent, false);
  });

  it("a mark on a page the PDF does not have is ambiguous, never bound", () => {
    const marks = [mark("b1", "BLSID000A", 20, 30, 3), mark("b1", "BLSID000E", 20, 36, 3)];
    const result = matchMarks(marks, [textPage([])]);
    assert.equal(result.ambiguous, 2);
    assert.deepEqual([...result.boundSids], []);
    assert.equal(result.byPage.get(3)!.marksMatched, 0);
    assert.equal(result.byPage.get(3)!.targetsTotal, 1);
  });

  /**
   * The residual is blind to a displacement every mark shares — the reference absorbs it exactly.
   * This is the one hole in the asymmetry that cannot be closed by any tolerance on the residual,
   * because the residual is 0 by construction however large the shift.
   *
   * Red condition: remove the `MAX_REFERENCE_DY_MM` bound and the first assertion fails, because
   * every target binds and `maxDyMm` reports 0 for a 40 mm displacement. The CONTROL below is the
   * other half — without it this case would also pass if `matchMarks` bound nothing at all.
   */
  it("a displacement shared by every mark on the page is caught, though the residual is zero", () => {
    const marks = [
      mark("b1", "BLSID000A", 20, 30),
      mark("b1", "BLSID000E", 20, 36),
      mark("b2", "BLSID001A", 20, 50),
      mark("b2", "BLSID001E", 20, 56),
    ];
    // Every glyph sits 40 mm below where the DOM says. The marks agree with each other perfectly.
    const result = matchMarks(marks, [
      textPage([
        { token: "BLSID000A", xMm: 20, yMm: 70 },
        { token: "BLSID000E", xMm: 20, yMm: 76 },
        { token: "BLSID001A", xMm: 20, yMm: 90 },
        { token: "BLSID001E", xMm: 20, yMm: 96 },
      ]),
    ]);
    const page = result.byPage.get(1)!;
    assert.deepEqual([...result.boundSids], [], "a 40 mm uniform displacement must bind nothing");
    assert.equal(page.referenceOutOfRange, true);
    assert.equal(page.divergent, true, "a displaced reference is a divergence, not a silent pass");
    assert.equal(result.divergentPages, 1);
    // The point of the case: the residual saw nothing. Only the reference did.
    assert.equal(page.maxDyMm, 0, "the residual is zero by construction — this is why it cannot gate");
    assert.equal(Math.round(page.referenceDyMm), -40);
  });

  it("CONTROL: the same four marks, undisplaced, bind and are not divergent", () => {
    const marks = [
      mark("b1", "BLSID000A", 20, 30),
      mark("b1", "BLSID000E", 20, 36),
      mark("b2", "BLSID001A", 20, 50),
      mark("b2", "BLSID001E", 20, 56),
    ];
    const result = matchMarks(marks, [
      textPage([
        { token: "BLSID000A", xMm: 20, yMm: 30 },
        { token: "BLSID000E", xMm: 20, yMm: 36 },
        { token: "BLSID001A", xMm: 20, yMm: 50 },
        { token: "BLSID001E", xMm: 20, yMm: 56 },
      ]),
    ]);
    const page = result.byPage.get(1)!;
    assert.deepEqual([...result.boundSids].sort(), ["b1", "b2"]);
    assert.equal(page.referenceOutOfRange, false);
    assert.equal(page.divergent, false);
  });

  /**
   * At two pairs the median IS the mean, so "a median resists one outlier" is false exactly at the
   * minimum. One correct mark beside one 40 mm outlier used to abort the whole run.
   *
   * Red condition: lower `MIN_PAIRS_FOR_DIVERGENCE` to 2 and `divergent` becomes true again.
   */
  it("two pairs, one correct and one wild, is unverified — never a fatal divergence", () => {
    const marks = [mark("b1", "BLSID000A", 20, 30), mark("b1", "BLSID000E", 20, 36)];
    const result = matchMarks(marks, [
      textPage([
        { token: "BLSID000A", xMm: 20, yMm: 30 },
        { token: "BLSID000E", xMm: 20, yMm: 76 },
      ]),
    ]);
    const page = result.byPage.get(1)!;
    assert.equal(page.marksMatched, 2, "both marks were refound; the disagreement is between them");
    assert.deepEqual([...result.boundSids], [], "neither mark can vouch for the other");
    assert.equal(page.divergent, false, "two pairs cannot carry a fatal verdict");
    assert.equal(result.divergentPages, 0);
  });

  /**
   * The divergence trigger is PAGE-scoped, and that is the decision ADR-040 E11 singles out: a
   * single accidental hit on page 1 must not mask a collapse on page 2. Every earlier divergence
   * fixture was a single-page document, where page scope and document scope are the same thing —
   * so the scoping was untested and a foreign verifier reverted it to document-wide with the
   * entire suite, live included, staying green.
   *
   * Red condition: make `divergent` depend on `boundSids.size === 0` (document-wide) instead of
   * this page's own bindings, and page 2 stops being divergent while page 1 keeps binding.
   */
  it("a bound page does not mask a collapsed one — divergence is per page", () => {
    const marks = [
      // page 1: three pairs, all correct
      mark("b1", "BLSID000A", 20, 30, 1),
      mark("b1", "BLSID000E", 20, 36, 1),
      mark("b2", "BLSID001A", 20, 50, 1),
      // page 2: three pairs, all shifted 40 mm HORIZONTALLY, so dx is absolute and none binds
      mark("b3", "BLSID002A", 20, 30, 2),
      mark("b3", "BLSID002E", 20, 36, 2),
      mark("b4", "BLSID003A", 20, 50, 2),
    ];
    const result = matchMarks(marks, [
      textPage([
        { token: "BLSID000A", xMm: 20, yMm: 30 },
        { token: "BLSID000E", xMm: 20, yMm: 36 },
        { token: "BLSID001A", xMm: 20, yMm: 50 },
      ]),
      textPage([
        { token: "BLSID002A", xMm: 60, yMm: 30 },
        { token: "BLSID002E", xMm: 60, yMm: 36 },
        { token: "BLSID003A", xMm: 60, yMm: 50 },
      ]),
    ]);
    assert.equal(result.byPage.get(1)!.divergent, false, "page 1 is fine and must stay fine");
    assert.deepEqual([...result.boundSids].sort(), ["b1", "b2"], "page 1 binds, so the document has bindings");
    assert.equal(result.byPage.get(2)!.divergent, true, "page 2 collapsed and must say so");
    assert.equal(result.divergentPages, 1, "a document-wide trigger would report 0 here");
  });
});
