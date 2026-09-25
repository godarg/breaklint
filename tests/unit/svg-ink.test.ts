/**
 * The painted-ink bound of svg/text-overflows-viewport, without a browser.
 *
 * The first half drives the collector's raw facts — computed paint of the text and its
 * descendants, SVG text positions and the canvas raster, shaped like Chromium 141's — through
 * `assembleSnapshot`, the real engine and the rule (tests/fixtures/svg-ink-scenarios.ts). The second
 * half pins the arithmetic those cases rest on. What each number was measured against is written
 * next to the constant in src/measure/svg-ink.ts; tests/unit/svg-ink-mutants.test.ts shows that
 * removing each protection turns one of these cases.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { SVG_INK_DIAGNOSTICS } from "../../src/core/enums.ts";
import { SVG_OVERSHOOT_EPSILON_PX } from "../../src/measure/svg-viewport.ts";
import type { AffineMatrix, Box, SvgTextPaint } from "../../src/core/types.ts";
import { validateSnapshotInvariants } from "../../src/measure/snapshot.ts";
import {
  RASTER_MARGIN_CANVAS_PX,
  bracketVerdict,
  canvasSpecFor,
  classifyPaint,
  collapsedCharacters,
  lowerBoundOvershoot,
  paintOuterLocal,
  simpleLabelInk,
  textCanPaint,
  type RawPaintElement,
  unitsPerDevicePx,
  upperBoundOvershoot,
  type TargetFrameFacts,
} from "../../src/measure/svg-ink.ts";
import { SCENARIOS, runScenario } from "../fixtures/svg-ink-scenarios.ts";
import { NEUTRAL_LABEL_STYLE, assembleOneSvg, paintElement, rasterLabel, rawPaint } from "../fixtures/svg-raw.ts";

const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });
const I: AffineMatrix = [1, 0, 0, 1, 0, 0];
const near = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected} (±${tolerance})`);

describe("svg/text-overflows-viewport, collector facts to report", () => {
  it("reports a label whose ink leaves the viewport, with the overshoot the raster proves", () => {
    const outcome = runScenario("outside");
    assert.deepEqual([outcome.exit, outcome.candidates, outcome.measured, outcome.declines], [1, 1, 1, []]);
    assert.equal(outcome.findings.length, 1);
    near(outcome.findings[0]!.value, 10, 0.01);
    assert.match(outcome.findings[0]!.message, /glyph ink reaches at least 10\.00 px beyond the SVG viewport/u);
  });

  it("stays silent on a label inside", () => {
    const outcome = runScenario("inside");
    assert.deepEqual([outcome.exit, outcome.findings, outcome.candidates, outcome.measured, outcome.declines], [0, [], 1, 1, []]);
  });

  it("does not report the axis tick whose cell leaves the viewport while its ink stays inside", () => {
    // Released as a false error: the cell ends 1 px past the bottom edge, the digits 2 px inside.
    const outcome = runScenario("slack");
    assert.deepEqual([outcome.exit, outcome.findings.length, outcome.measured], [0, 0, 1]);
    const [lower, upper] = outcome.rows[0]!.measurements.map(([, value]) => value as number);
    assert.ok(lower! <= -2 && upper! < 0, `ink bounds ${lower} / ${upper}`);
  });

  it("declines the band a round-joined stroke may cross, per target and counted", () => {
    const outcome = runScenario("band-round");
    assert.deepEqual([outcome.exit, outcome.findings.length, outcome.candidates, outcome.measured], [4, 0, 1, 0]);
    assert.deepEqual(outcome.declines, ["env/svg-painted-bounds-inconclusive:1"]);
    assert.deepEqual(outcome.rows.map((row) => [row.status, row.reason]), [["not-measured", "env/svg-painted-bounds-inconclusive"]]);
    assert.deepEqual(outcome.rows[0]!.measurements.map(([name]) => name), ["viewport-overshoot", "viewport-overshoot-upper-bound"]);
  });

  it("puts a miter-joined label in the band although cell + stroke-width/2 is inside", () => {
    // The prototype's upper bound, cell + sw/2, ends 3 px inside; the default miter limit lets a
    // tip reach 4 · sw/2 = 8 px beyond the outline (measured on Chromium 141: up to 2.56 · sw/2 at
    // the default limit, 8.81 at limit 10). Never "inside".
    const outcome = runScenario("miter");
    assert.deepEqual([outcome.exit, outcome.declines], [4, ["env/svg-painted-bounds-inconclusive:1"]]);
    // The inner box is the cell, 5 px inside; the upper bound is the full 8 px pad beyond the ink
    // box, plus the raster and placement margins (well under a pixel here).
    const [lower, upper] = outcome.rows[0]!.measurements.map(([, value]) => value as number);
    near(lower!, -5, 1e-6);
    assert.ok(upper! >= 3 && upper! < 3.8, `upper bound ${upper}`);
  });

  it("stays silent on the halo idiom well inside the viewport", () => {
    const outcome = runScenario("halo");
    assert.deepEqual([outcome.exit, outcome.findings.length, outcome.measured, outcome.declines], [0, 0, 1, []]);
  });

  it("reads the paint of a tspan: its own stroke widens the bound", () => {
    // A <tspan> with its own stroke. Up to this build the collector read only the <text>, so the
    // tspan's stroke was never part of any bound.
    const outcome = runScenario("tspan-stroke");
    assert.deepEqual([outcome.exit, outcome.declines], [4, ["env/svg-painted-bounds-inconclusive:1"]]);
  });

  it("stretches the stroke pad with a spacingAndGlyphs run, and declines a stretch nothing measured", () => {
    // Measured on Chromium 141: the stroke of a stretched run is stretched with its glyphs.
    const stretched = runScenario("stretched-stroke");
    const upper = stretched.rows[0]!.measurements[1]![1] as number;
    assert.ok(upper >= -5 + 5, `the pad along the baseline must be 1.25 · 4 px, upper ${upper}`);
    assert.deepEqual(stretched.declines, ["env/svg-painted-bounds-inconclusive:1"]);
    assert.deepEqual(runScenario("stretched-tspan").declines, ["env/svg-painted-bounds-unsupported:1"]);
  });

  it("declines a tspan's text shadow, a percentage stroke width and a non-scaling stroke outright", () => {
    for (const name of ["tspan-shadow", "percent-stroke", "non-scaling"] as const) {
      const outcome = runScenario(name);
      assert.deepEqual([outcome.exit, outcome.candidates, outcome.measured, outcome.declines],
        [4, 1, 0, ["env/svg-painted-bounds-unsupported:1"]], name);
    }
  });

  it("measures a rotated label in the frame's own axes", () => {
    // Rastered through its CTM: the covered rows are the frame's, so the reach past the top edge is
    // the ink's, not the envelope of a rotated user-space box around it.
    const outcome = runScenario("rotated");
    assert.equal(outcome.exit, 1);
    const snapshot = assembleOneSvg(SCENARIOS.rotated());
    const text = snapshot.svg[0]!.texts[0]!;
    // The fabricated raster covers the rotated cell's frame envelope; the inner box is exactly it.
    near(text.paint.inkInnerLocal!.y, text.boxLocal.y, 0.01);
    near(outcome.findings[0]!.value, -text.paint.inkInnerLocal!.y, 0.01);
  });

  it("keeps every assembled bound inside the snapshot invariants", () => {
    for (const name of Object.keys(SCENARIOS) as (keyof typeof SCENARIOS)[]) {
      const snapshot = assembleOneSvg(SCENARIOS[name]());
      assert.deepEqual(validateSnapshotInvariants(snapshot, { sourceMapInjection: true }).issues, [], name);
    }
    const snapshot = assembleOneSvg([{ id: "a", bbox: box(20, 30, 40, 14) }, { id: "b", bbox: box(170, 30, 40, 14) }]);
    assert.deepEqual(validateSnapshotInvariants(snapshot, { sourceMapInjection: true }).issues, []);
    const broken = structuredClone(snapshot);
    broken.svg[0]!.texts[0]!.paint.inkInnerLocal = box(0, 0, 400, 400);
    assert.ok(validateSnapshotInvariants(broken, { sourceMapInjection: true }).issues.some((issue) => issue.includes("inner ink box")));
    const lying = structuredClone(snapshot);
    lying.svg[0]!.texts[0]!.paint = { ...lying.svg[0]!.texts[0]!.paint, inkSource: "cell", inkDiagnostic: null };
    assert.ok(validateSnapshotInvariants(lying, { sourceMapInjection: true }).issues.some((issue) => issue.includes("disagrees with its diagnostic")));
  });
});

function rotate(degrees: number, cx: number, cy: number): AffineMatrix {
  const r = (degrees * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}

describe("the stroke pad and what declines", () => {
  const pad = (text: Partial<RawPaintElement> = {}) => {
    const result = classifyPaint(rawPaint({ text }));
    return result.ok ? result.strokePad : result.reason;
  };

  it("pads k · stroke-width / 2, k the miter limit for miter joins and 1 for round and bevel", () => {
    const stroke = { stroke: "rgb(255, 255, 255)", strokeWidth: "4px" };
    assert.equal(pad({ ...stroke }), 8, "miter at the default limit 4");
    assert.equal(pad({ ...stroke, strokeMiterlimit: "10" }), 20);
    assert.equal(pad({ ...stroke, strokeMiterlimit: "1" }), 2);
    assert.equal(pad({ ...stroke, strokeMiterlimit: "0.5" }), "miter-limit");
    assert.equal(pad({ ...stroke, strokeLinejoin: "round" }), 2);
    assert.equal(pad({ ...stroke, strokeLinejoin: "bevel" }), 2);
    assert.equal(pad({ ...stroke, strokeLinejoin: "miter-clip" }), "line-join");
    near(pad({ ...stroke, strokeLinejoin: "round", strokeDasharray: "2px, 3px", strokeLinecap: "square" }) as number, 2 * Math.SQRT2);
    assert.equal(pad({ ...stroke, strokeLinejoin: "round", strokeDasharray: "2px, 3px", strokeLinecap: "round" }), 2);
    assert.equal(pad({ ...stroke, strokeLinejoin: "round", strokeLinecap: "square" }), 2, "outlines are closed: no cap without dashes");
  });

  it("pads nothing for a stroke that does not paint", () => {
    for (const text of [{ stroke: "none", strokeWidth: "9px" }, { stroke: "rgba(0, 0, 0, 0)", strokeWidth: "9px" },
      { stroke: "rgb(0, 0, 0)", strokeOpacity: "0", strokeWidth: "9px" }, { stroke: "rgb(0, 0, 0)", strokeWidth: "0px" }]) {
      assert.equal(pad(text), 0, JSON.stringify(text));
    }
  });

  it("declines what no bound here describes, on the text, a descendant or an ancestor", () => {
    const reason = (paint: ReturnType<typeof rawPaint>) => { const result = classifyPaint(paint); return result.ok ? "ok" : result.reason; };
    assert.equal(reason(rawPaint({ text: { stroke: "rgb(0, 0, 0)", strokeWidth: "5%" } })), "stroke-width");
    assert.equal(reason(rawPaint({ text: { stroke: "rgb(0, 0, 0)", strokeWidth: "calc(2px + 5%)" } })), "stroke-width");
    assert.equal(reason(rawPaint({ text: { stroke: "rgb(0, 0, 0)", strokeWidth: "2px", vectorEffect: "non-scaling-stroke" } })), "non-scaling-stroke");
    assert.equal(reason(rawPaint({ text: { fill: "url(\"#gradient\")" } })), "paint-server");
    assert.equal(reason(rawPaint({ text: { textDecorationLine: "underline" } })), "text-decoration");
    const tspan = (over: Partial<RawPaintElement>) => rawPaint({ elements: [paintElement(), paintElement({ tag: "tspan", ...over })] });
    assert.equal(reason(tspan({ stroke: "url(\"#pattern\")", strokeWidth: "1px" })), "paint-server");
    assert.equal(reason(tspan({ textShadow: "rgb(0, 0, 0) 1px 1px 2px" })), "text-shadow");
    assert.equal(reason(tspan({ textDecorationLine: "line-through" })), "text-decoration");
    assert.equal(reason(tspan({ filter: "blur(2px)" })), "clip-mask-filter");
    assert.equal(reason(rawPaint({ ancestors: [{ clipPath: "none", mask: "none", maskImage: "none", filter: "url(\"#glow\")", textDecorationLine: null }] })), "clip-mask-filter");
    assert.equal(reason(rawPaint({ ancestors: [{ clipPath: "none", mask: "none", maskImage: "none", filter: "none", textDecorationLine: "underline" }] })), "text-decoration");
    // An underline outside the SVG (the link around a figure) does not reach into it: null.
    assert.equal(reason(rawPaint({ ancestors: [{ clipPath: "none", mask: "none", maskImage: "none", filter: "none", textDecorationLine: null }] })), "ok");
    assert.equal(reason(tspan({ maskImage: "url(\"#fade\")" })), "clip-mask-filter");
    assert.equal(reason(rawPaint({ ancestors: [{ clipPath: "none", mask: "none", maskImage: "linear-gradient(black, transparent)", filter: "none", textDecorationLine: null }] })), "clip-mask-filter");
    // Per-glyph rotation is WP-S1's decline and comes first: one reason, whatever else the paint is.
    assert.equal(reason(rawPaint({ perGlyphRotate: true })), "per-glyph-rotate");
    assert.equal(reason(rawPaint({ perGlyphRotate: true, text: { fill: "url(\"#gradient\")" } })), "per-glyph-rotate");
    const deep = classifyPaint(tspan({ stroke: "rgb(0, 0, 0)", strokeWidth: "3px", strokeLinejoin: "round" }));
    assert.ok(deep.ok && deep.strokePad === 1.5, "the tspan's own stroke is the widest");
  });

  it("gives a dashed stroke on unfilled text no inner box", () => {
    const outlined = classifyPaint(rawPaint({ text: { fill: "none", stroke: "rgb(0, 0, 0)", strokeWidth: "2px", strokeDasharray: "1px, 1px" } }));
    assert.ok(outlined.ok && outlined.dashedStrokeOnly);
    const snapshot = assembleOneSvg([{ id: "d", bbox: box(20, 30, 40, 14), paint: rawPaint({ text: { fill: "none", stroke: "rgb(0, 0, 0)", strokeWidth: "2px", strokeDasharray: "1px, 1px" } }) }]);
    const paint = snapshot.svg[0]!.texts[0]!.paint;
    assert.deepEqual([paint.inkSource, paint.inkDiagnostic, paint.inkInnerLocal], ["canvas-raster", "dashed-stroke-only", null]);
  });
});

describe("when the raster is the label", () => {
  const facts = (cell: Box, ctm: AffineMatrix = I): TargetFrameFacts => ({ bboxUser: cell, ctm, userToLocal: ctm, localToScreen: [1, 0, 0, 1, 35, 35] });
  const cell = box(20, 30, 40, 14);
  const diagnostic = (label: ReturnType<typeof rasterLabel>, frame = facts(cell)) => {
    const result = simpleLabelInk(label, frame);
    return result.ok ? "ok" : result.diagnostic;
  };

  it("accepts one plain run and bounds it on both sides of its raster ink", () => {
    // Ink covering the cell and a raster margin beyond it: the inner box gives the margin back on
    // both axes and the placement allowance along the baseline — 1/64 px per glyph, half of it at
    // the middle of a 5-glyph word, plus 0.05 px.
    const result = simpleLabelInk(rasterLabel(cell), facts(cell));
    assert.ok(result.ok);
    const e = RASTER_MARGIN_CANVAS_PX / (128 / 14);
    const along = 5 / 64 / 2 + 0.05;
    near(result.innerLocal!.x, 20 + along); near(result.innerLocal!.width, 40 - 2 * along);
    near(result.innerLocal!.y, 30); near(result.innerLocal!.height, 14);
    near(result.outerLocal.x, 20 - 2 * e - along); near(result.outerLocal.width, 40 + 4 * e + 2 * along);
    near(result.outerLocal.y, 30 - 2 * e);
  });

  it("refuses a layout the canvas does not reproduce at a word boundary, and keeps one it does as margin", () => {
    // Kerning across a space: the canvas shapes word by word, the SVG the whole run (measured: the
    // "A " pair in DejaVu Serif moved every later glyph by 0.79 px). Checked at every boundary, not
    // only at the end, where drifts in opposite directions could cancel.
    const words = box(20, 30, 80, 14);
    const split = rasterLabel(words, { text: "A label", boundaryDrift: { 1: 0.79, 2: 0.79 } });
    assert.equal(diagnostic(split, facts(words)), "advance-mismatch");
    const cancelling = rasterLabel(words, { text: "ab cd ef", boundaryDrift: { 2: 0.4, 3: 0.4 } });
    assert.equal(diagnostic(cancelling, facts(words)), "advance-mismatch", "the end agrees; the middle does not");
    const small = rasterLabel(words, { text: "ab cd", boundaryDrift: { 2: 0.06, 3: 0.06 } });
    const kept = simpleLabelInk(small, facts(words));
    assert.ok(kept.ok, JSON.stringify(kept));
    // A 0.06 px drift at the boundary becomes margin: at least that much comes off each side.
    assert.ok(kept.innerLocal!.x >= words.x + 0.06 + 0.05 - 1e-9);
  });

  it("names the first condition that fails, and never guesses past it", () => {
    const with_ = (over: Partial<ReturnType<typeof rasterLabel>>) => ({ ...rasterLabel(cell), ...over });
    const label = rasterLabel(cell);
    const styled = (style: Partial<typeof NEUTRAL_LABEL_STYLE>) => rasterLabel(cell, { style });
    const cases: [string, ReturnType<typeof rasterLabel>][] = [
      ["element-children", with_({ elementChildren: 1 })],
      ["positioning-lists", with_({ attributes: { ...label.attributes, x: "20 30 40" } })],
      ["positioning-lists", with_({ attributes: { ...label.attributes, rotate: "0 15" } })],
      ["length-adjust", with_({ attributes: { ...label.attributes, textLength: "40", lengthAdjust: null } })],
      ["writing-direction", styled({ writingMode: "vertical-rl" })],
      ["writing-direction", rasterLabel(cell, { text: "שלום" })],
      ["baseline", styled({ dominantBaseline: "middle" })],
      ["baseline", styled({ baselineShift: "3px" })],
      ["font-properties", styled({ fontFeatureSettings: "\"smcp\"" })],
      ["font-properties", styled({ fontSynthesisStyle: "none" })],
      ["font-properties", styled({ textTransform: "uppercase" })],
      ["font-properties", styled({ fontStretch: "93%" })],
      ["white-space", styled({ whiteSpaceCollapse: "preserve" })],
      ["white-space", with_({ positions: { ...label.positions!, chars: 6 } })],
      ["positions", with_({ positions: { ...label.positions!, end: [60, 45] } })],
      ["positions", with_({ positions: { ...label.positions!, end: [61, label.positions!.end![1]] } })],
      ["raster-unavailable", with_({ raster: null })],
      ["raster-unavailable", with_({ raster: { ...label.raster!, applied: { ...label.raster!.applied, letterSpacing: "1px" } } })],
      ["raster-unavailable", with_({ raster: { ...label.raster!, applied: { ...label.raster!.applied, font: "1px serif" } } })],
      ["raster-unavailable", with_({ raster: { ...label.raster!, linear: [1, 0.1, 0, 1] } })],
      ["advance-mismatch", rasterLabel(cell, { advanceDelta: 0.2 })],
      ["raster-empty", with_({ raster: { ...label.raster!, ink: null } })],
      ["raster-edge", with_({ raster: { ...label.raster!, ink: [0, ...label.raster!.ink!.slice(1)] as [number, number, number, number] } })],
      ["raster-exceeds-cell", rasterLabel(cell, { ink: box(10, 25, 70, 30) })],
    ];
    for (const [expected, candidate] of cases) assert.equal(diagnostic(candidate), expected, JSON.stringify(candidate.style === NEUTRAL_LABEL_STYLE ? candidate.attributes : expected));
    assert.equal(diagnostic(label), "ok");
    for (const [expected] of cases) assert.ok((SVG_INK_DIAGNOSTICS as readonly string[]).includes(expected), expected);
  });

  it("accepts a spacingAndGlyphs scale and keeps the advance allowance as margin", () => {
    const stretched = rasterLabel(cell, { textLength: 40 });
    const result = simpleLabelInk(stretched, facts(cell));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(diagnostic(rasterLabel(cell, { textLength: 40, style: { letterSpacing: "2px" } })), "length-adjust");
    assert.equal(diagnostic(rasterLabel(cell, { textLength: 40, text: "日本語ab" })), "length-adjust");
  });

  it("maps the raster through a nested viewport's axis-aligned scale and refuses a rotated one", () => {
    const ctm: AffineMatrix = [1, 0, 0, 1, 0, 0];
    const nested: TargetFrameFacts = { ...facts(cell, ctm), userToLocal: [2, 0, 0, 2, 50, 50] };
    const scaled = simpleLabelInk(rasterLabel(cell, { ctm, userToScreen: [2, 0, 0, 2, 85, 85] }), nested);
    assert.ok(scaled.ok);
    near(scaled.innerLocal!.x, 90); near(scaled.innerLocal!.width, 80);
    assert.equal(diagnostic(rasterLabel(cell, { ctm }), { ...facts(cell, ctm), userToLocal: rotate(20, 0, 0) }), "raster-unavailable");
  });

  it("maps the canvas state the page sets from the computed style, or none", () => {
    assert.deepEqual(canvasSpecFor(NEUTRAL_LABEL_STYLE), {
      font: "normal 400 14px \"DejaVu Sans\"", fontSize: "14px", letterSpacing: "0px", wordSpacing: "0px", fontKerning: "auto",
      fontStretch: "normal", fontVariantCaps: "normal", textRendering: "auto", lang: "en",
    });
    assert.equal(canvasSpecFor({ ...NEUTRAL_LABEL_STYLE, fontStretch: "87.5%", textRendering: "geometricPrecision", webkitLocale: "auto" })?.lang, "inherit");
    assert.equal(canvasSpecFor({ ...NEUTRAL_LABEL_STYLE, fontStretch: "90%" }), null);
    assert.equal(collapsedCharacters("  axis\n\t label ", "collapse"), "axis label");
    assert.equal(collapsedCharacters("x", "preserve"), null);
    assert.equal(textCanPaint(" \u{200B}\u{00AD} "), false);
    assert.equal(textCanPaint(" 0 "), true);
  });
});

describe("the bracket against the clip", () => {
  const clips = [box(0, 0, 200, 80)];
  const paint = (inner: Box | null, outer: Box, strokePad = 0, paints = true): SvgTextPaint =>
    ({ inkSource: inner ? "canvas-raster" : "cell", inkDiagnostic: inner ? null : "element-children", inkInnerLocal: inner, inkOuterLocal: outer, strokePad, strokeScaleX: 1, paints });

  it("reports on the lower bound, stays silent on the upper, declines the band — at the rule's resolution", () => {
    const e = SVG_OVERSHOOT_EPSILON_PX;
    assert.equal(bracketVerdict(e * 1.5, 5, 0, e), "violated");
    assert.equal(bracketVerdict(e, 5, 0, e), "inconclusive", "a lower bound the frame cannot resolve from 0 is no finding");
    assert.equal(bracketVerdict(-3, e, 0, e), "clear", "an upper bound within the resolution of 0 is the frame decision's clean band");
    assert.equal(bracketVerdict(-3, e * 1.5, 0, e), "inconclusive", "an upper bound beyond the resolution is no silence");
    assert.equal(bracketVerdict(null, 4, 0, e), "inconclusive");
    assert.equal(bracketVerdict(null, -4, 0, e), "clear");
  });

  it("grows the glyph box by the stroke pad through the linear map, as an ellipse", () => {
    const scaled = paintOuterLocal(paint(null, box(10, 10, 20, 10), 2), [3, 0, 0, 0.5, 0, 0]);
    assert.deepEqual(scaled, box(4, 9, 32, 12));
    const turned = paintOuterLocal(paint(null, box(10, 10, 20, 10), 2), rotate(90, 0, 0));
    near(turned.x, 8); near(turned.y, 8);
  });

  it("claims separation only for text that paints, and only when the whole outer box misses the clip", () => {
    const far = paint(null, box(230, 10, 20, 10));
    assert.deepEqual(lowerBoundOvershoot(far, I, clips), { value: 30, claim: "separated" });
    assert.equal(lowerBoundOvershoot({ ...far, paints: false }, I, clips), null);
    assert.equal(lowerBoundOvershoot(paint(null, box(190, 10, 20, 10)), I, clips), null);
    assert.equal(lowerBoundOvershoot(paint(null, box(230, 10, 20, 10), 31), I, clips), null, "the stroke may reach back inside");
    assert.deepEqual(lowerBoundOvershoot(paint(box(195, 10, 8, 10), box(194, 9, 10, 12)), I, clips), { value: 3, claim: "ink" });
    assert.equal(upperBoundOvershoot(paint(box(195, 10, 8, 10), box(194, 9, 10, 12), 1), I, clips), 5);
  });

  it("converts a device px through the frame's smallest scale", () => {
    near(unitsPerDevicePx([2, 0, 0, 0.5, 0, 0]), 2);
    near(unitsPerDevicePx(rotate(33, 5, 5)), 1);
    assert.equal(unitsPerDevicePx([0, 0, 0, 0, 0, 0]), Infinity);
  });
});
