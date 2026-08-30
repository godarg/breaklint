import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  compareGeometry,
  crossCheckEvent,
  CROSS_CHECK_MEASURED_MAX_PX,
  CROSS_CHECK_TOLERANCE_PX,
  quadEnvelope,
  type GeometrySample,
} from "../../src/measure/cross-check.ts";

const box = (key: string, x: number, y: number, w = 100, h = 20): GeometrySample => ({
  key,
  x,
  y,
  width: w,
  height: h,
});

describe("the geometry cross-check", () => {
  it("uses all four CDP quad corners for a transformed element's axis-aligned box", () => {
    // 126 x 46 including border, rotated 30 degrees. The first edge is not horizontal, so the
    // former q[0]/q[1]/q[2]/q[5] shortcut produces x=219.94 and width=109.12 instead of the
    // getBoundingClientRect envelope below. This exact shape was measured in Chrome 152.
    const quad = [
      219.94039916992188, 121.58141326904297,
      329.0596008300781, 184.58141326904297,
      306.0596008300781, 224.4185791015625,
      196.94039916992188, 161.4185791015625,
    ];
    assert.deepEqual(quadEnvelope(quad), {
      x: 196.94039916992188,
      y: 121.58141326904297,
      width: 132.11920166015625,
      height: 102.83716583251953,
    });
  });

  /**
   * The bound, pinned as a literal AND from both sides.
   *
   * A constant gated only by its existence was a CONFIRMED finding in this repo: `MAX_REFERENCE_DY_MM`
   * was raised from 1.0 to 39 — the 429-fold of its measured maximum — with the whole battery
   * green, because the only fixture that touched it used 40 and pinned it to "somewhere under 40".
   * The pair of cases below sit either side of the boundary, so the value is fixed and not merely
   * bounded above by the absurd.
   */
  it("the tolerance is pinned from both directions, and is not confused with the measurement", () => {
    assert.equal(CROSS_CHECK_TOLERANCE_PX, 0.05);
    // Zero, and that is the point. It was nearly written down as 0.005, measured by a probe that
    // rounded its own inputs to two decimals and then attributed the rounding to the browser.
    // Unrounded, the two sources agree exactly, so the live suite can demand exact agreement.
    assert.equal(CROSS_CHECK_MEASURED_MAX_PX, 0);
    assert.ok(
      CROSS_CHECK_TOLERANCE_PX > CROSS_CHECK_MEASURED_MAX_PX,
      "a tolerance below the measured maximum would fail on a correct document",
    );

    const inside = compareGeometry([box("a", 10, 10)], [box("a", 10 + 0.049, 10)]);
    assert.equal(inside.ok, true, "0.049 px is inside the tolerance and must pass");

    const outside = compareGeometry([box("a", 10, 10)], [box("a", 10 + 0.051, 10)]);
    assert.equal(outside.ok, false, "0.051 px is outside the tolerance and must fail");
    assert.equal(outside.disagreements[0]?.field, "x");
  });

  it("agreement within tolerance on every field passes", () => {
    const probe = [box("a", 10, 20, 100, 30), box("b", 10, 60, 100, 30)];
    const cdp = [box("a", 10.004, 20.003, 100.002, 30.004), box("b", 9.998, 60.001, 100, 30)];
    const result = compareGeometry(probe, cdp);
    assert.equal(result.ok, true, JSON.stringify(result.disagreements));
    assert.equal(result.checked, 2);
    assert.ok(result.maxDelta < CROSS_CHECK_TOLERANCE_PX);
  });

  /** Each of the four fields is compared, not just position. */
  for (const field of ["x", "y", "width", "height"] as const) {
    it(`a disagreement in ${field} alone is caught`, () => {
      const probe = [box("a", 10, 20, 100, 30)];
      const other = { ...box("a", 10, 20, 100, 30), [field]: box("a", 10, 20, 100, 30)[field] + 5 };
      const result = compareGeometry(probe, [other]);
      assert.equal(result.ok, false, `${field} is not compared`);
      assert.equal(result.disagreements[0]?.field, field);
    });
  }

  /**
   * A cross-check over nothing is not a passed cross-check.
   *
   * This is the same shape as the live runner refusing to promote a report with zero cases, and
   * the same shape as the source-collision gate reporting what it scanned: a verdict computed
   * over an empty set looks exactly like a verdict that held.
   */
  it("an empty sample fails rather than passing vacuously", () => {
    const result = compareGeometry([], []);
    assert.equal(result.ok, false, "checking nothing must not report ok");
    assert.equal(result.checked, 0);
    assert.match(crossCheckEvent(result).detail, /measured no elements/u);
  });

  it("a truncated production sample fails even when every returned box agrees", () => {
    const one = [box("a", 10, 10)];
    const result = compareGeometry(one, one, CROSS_CHECK_TOLERANCE_PX, 8);
    assert.equal(result.ok, false, "one agreeing element cannot stand in for the eight-element oracle");
    assert.equal(result.checked, 1);
    assert.equal(result.required, 8);
    assert.match(crossCheckEvent(result).detail, /1 of 8 required elements/u);
  });

  /** A key the second source does not have at all is a disagreement, not a quiet skip. */
  it("an element the layout tree does not know about is a disagreement", () => {
    const result = compareGeometry([box("a", 10, 10)], []);
    assert.equal(result.ok, false);
    assert.equal(result.disagreements.length, 1);
    assert.equal(result.maxDelta, Infinity);
    // and the event must survive a non-finite delta rather than printing NaN at a reader
    const event = crossCheckEvent(result);
    assert.equal((event.measured as { maxDeltaPx: number | null }).maxDeltaPx, null);
  });

  it("the event is fatal in shape and names the worst offenders", () => {
    const probe = [box("a", 0, 0), box("b", 0, 100), box("c", 0, 200), box("d", 0, 300)];
    const cdp = [box("a", 9, 0), box("b", 0, 105), box("c", 3, 200), box("d", 0, 300)];
    const event = crossCheckEvent(compareGeometry(probe, cdp));
    assert.equal(event.kind, "geometry-cross-check-failed");
    const worst = (event.measured as { worst: { key: string }[] }).worst;
    assert.equal(worst.length, 3, "the listing is capped");
    assert.equal(worst[0]?.key, "a", "the largest disagreement comes first");
    assert.match(event.detail, /the report is not written/u);
  });
});
