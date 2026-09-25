/**
 * svg/text-overflows-viewport decides on the two-sided bound of painted ink, not on the cell.
 *
 * Record level: each case is an SVG record as the collector emits it — cell box, local frame and
 * the `paint` bound — driven through the real engine to a report. The cases are the ones the
 * released rule got wrong or could not decide:
 *
 *   - an axis tick whose cell leaves the viewport by 1 px while its ink stays 2 px inside (the
 *     released rule reported it as "not drawn": a false error from a gating rule);
 *   - a stroked label whose glyphs are inside while its stroke can reach past the edge (the band:
 *     declined, counted, never silent and never a finding);
 *   - a clipped label, whose reported value is what the INNER box proves, not the cell;
 *   - a label bounded only by its cell (tspans, per-glyph positioning): reported only when all of
 *     its possible ink lies beyond an edge, declined when the cell merely crosses it.
 *
 * This file imports nothing but the engine and the rule, so it runs unchanged against the build
 * before the bound existed — which is how it was seen red.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { exitCodeFor, runDocument } from "../../src/core/engine.ts";
import type { Box, Snapshot, SvgRecord, SvgTextTarget } from "../../src/core/types.ts";
import { textOverflowsViewport } from "../../src/rules/svg/text-overflows-viewport.ts";
import { loadCorpus } from "../fixtures/corpus.ts";

const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });
const VIEWPORT = box(0, 0, 200, 80);

function target(id: string, cell: Box, paint: SvgTextTarget["paint"]): SvgTextTarget {
  return {
    targetKey: `bt-${id}`, svgTextKey: `svg:svgid:figure|id:${id}`, sourceAddressKey: `bt-${id}`,
    boxScreen: box(cell.x + 48, cell.y + 48, cell.width, cell.height), boxLocal: cell, bboxUser: cell,
    userToLocal: [1, 0, 0, 1, 0, 0], paint, clipState: "none", ambiguityGroupSize: 1,
    ink: { T: { count: 0, maskHash: "" }, T0: { count: 0, maskHash: "" } },
  };
}

function snapshotWith(texts: SvgTextTarget[]): Snapshot {
  const base = structuredClone(loadCorpus().find((entry) => entry.name === "svg-overflow-clean-inside")!.snapshot);
  const record: SvgRecord = {
    ...base.svg[0]!,
    nodeKey: "svg:0:0", sourceKey: "svgid:figure", measurable: true, reason: null, clipped: true, overflow: "hidden",
    viewportScreen: box(48, 48, 200, 80),
    viewportLocal: { viewport: VIEWPORT, clips: [VIEWPORT], localToScreen: [1, 0, 0, 1, 48, 48], oracleDeltaPx: 0, modelDeltaPx: 0, uncertaintyPx: 0 },
    viewportDiagnostic: null, textTargetCount: texts.length, textTargetsCapped: false,
    unreadableTargets: 0, unsupportedTargets: 0, notRenderedTargets: 0, texts,
  };
  base.svg = [record];
  base.source.map = Object.fromEntries(texts.map((text) => [text.sourceAddressKey!, { file: "figure.html", line: 1, column: 1, byteOffset: 0, byteLength: 1 }])) as never;
  return base;
}

function run(texts: SvgTextTarget[]) {
  const report = runDocument(
    { path: "figure.html", snapshot: snapshotWith(texts), infrastructure: [] },
    { failOn: "error", activeRules: [textOverflowsViewport], optionsByRule: {}, coverageFloors: {} },
  ).report;
  const coverage = report.coverage["svg/text-overflows-viewport"];
  const rows = report.evaluations.filter((row) => row.ruleId === "svg/text-overflows-viewport");
  return { report, coverage, rows, exit: exitCodeFor(report.verdict) };
}

/** A raster-bounded label: its glyph ink reaches `ink` on every side, to within `margin`. */
function raster(ink: Box, strokePad = 0, margin = 0.2): SvgTextTarget["paint"] {
  return {
    inkSource: "canvas-raster", inkDiagnostic: null,
    inkInnerLocal: box(ink.x + margin, ink.y + margin, ink.width - 2 * margin, ink.height - 2 * margin),
    inkOuterLocal: box(ink.x - margin, ink.y - margin, ink.width + 2 * margin, ink.height + 2 * margin),
    strokePad, strokeScaleX: 1, paints: true,
  };
}

describe("svg/text-overflows-viewport on the two-sided paint bound", () => {
  it("does not report an axis tick whose cell leaves the viewport while its ink stays inside", () => {
    // The released rule's false error. DejaVu Sans 12 px "100" at y = height − 2: the cell carries
    // 3 px of descent slack below the digits, so it ends 1 px past the bottom edge while the ink
    // ends 2 px inside it (measured on Chromium 141, pixels and canvas raster agreeing).
    const { report, coverage, exit } = run([target("tick", box(20, 67, 23, 14), raster(box(21.5, 69.2, 20.4, 8.8)))]);
    assert.deepEqual(report.findings, [], "an ink-inside tick was reported as not drawn");
    assert.deepEqual([coverage?.candidates, coverage?.measured, coverage?.notMeasured.length], [1, 1, 0]);
    assert.equal(exit, 0);
  });

  it("declines a stroked label whose stroke may reach past the edge, counted against coverage", () => {
    // Glyphs 4 px inside, a 3 px miter-joined stroke: k·sw/2 = 4·1.5 = 6 px of possible stroke
    // beyond the outlines. Neither "drawn" nor "not drawn" is proven; up to this build the label
    // was declined outright, and a rule on the cell would have called it drawn.
    const { report, coverage, rows, exit } = run([target("halo", box(156, 30, 40, 14), raster(box(156, 32, 40, 10), 6))]);
    assert.deepEqual(report.findings, []);
    assert.deepEqual(coverage?.notMeasured.map((entry) => [entry.reason, entry.count]), [["env/svg-painted-bounds-inconclusive", 1]]);
    assert.deepEqual([coverage?.candidates, coverage?.measured, coverage?.ok], [1, 0, false]);
    assert.equal(exit, 4, "the band must take an error rule below its coverage floor of 1");
    // One evaluation per target, addressable across runs, carrying both bounds.
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.deepEqual([row!.status, row!.reason, row!.targetRef.sid, row!.occurrenceKey], ["not-measured", "env/svg-painted-bounds-inconclusive", "bt-halo", "0"]);
    assert.deepEqual(row!.measurements.map((m) => m.name), ["viewport-overshoot", "viewport-overshoot-upper-bound"]);
    assert.ok((row!.measurements[0]!.value as number) < 0 && (row!.measurements[1]!.value as number) > 0, JSON.stringify(row!.measurements));
  });

  it("stays silent on a stroked label only when the stroke cannot reach the edge", () => {
    const { report, coverage, exit } = run([target("halo", box(150, 30, 40, 14), raster(box(150, 32, 40, 10), 6))]);
    assert.deepEqual(report.findings, []);
    assert.deepEqual([coverage?.candidates, coverage?.measured], [1, 1]);
    assert.equal(exit, 0);
  });

  it("reports a clipped label with the overshoot its INNER box proves", () => {
    // The cell ends 10 px past the edge; the glyphs stop 2.5 px short of the cell's trailing edge
    // (the side bearing and trailing letter-spacing the cell carries). The finding states what is
    // proven: 7.3 px, the inner box's overshoot, rounded down.
    const { report, rows, exit } = run([target("out", box(170, 30, 40, 14), raster(box(170, 32, 37.5, 10)))]);
    assert.equal(report.findings.length, 1);
    const [finding] = report.findings;
    assert.equal(finding!.ruleId, "svg/text-overflows-viewport");
    assert.equal(finding!.measurement.value, 7.3);
    assert.match(finding!.message, /glyph ink reaches at least 7\.30 px beyond the SVG viewport/u);
    assert.deepEqual(rows.map((row) => [row.status, row.predicate.violated]), [["measured", true]]);
    assert.equal(exit, 1);
  });

  it("bounds a cell-only label from both sides: reported when all of it is outside, declined when it crosses", () => {
    // tspans, per-glyph positions, textPath: no raster, so the ink is only known to lie inside the
    // cell grown by the overhang margin. All of it beyond the edge is proven not drawn; the cell
    // crossing the edge proves nothing about the glyphs.
    const cell = (outer: Box): SvgTextTarget["paint"] => ({ inkSource: "cell", inkDiagnostic: "element-children", inkInnerLocal: null, inkOuterLocal: outer, strokePad: 0, strokeScaleX: 1, paints: true });
    const gone = run([target("gone", box(232, 30, 40, 14), cell(box(230, 28, 44, 18)))]);
    assert.deepEqual(gone.report.findings.map((f) => f.measurement.value), [30]);
    assert.match(gone.report.findings[0]!.message, /lies entirely outside the SVG viewport, at least 30\.00 px beyond its edge/u);
    const crossing = run([target("crossing", box(187, 30, 40, 14), cell(box(185, 28, 44, 18)))]);
    assert.deepEqual(crossing.report.findings, [], "a crossing cell is not ink past the edge");
    assert.deepEqual(crossing.coverage?.notMeasured.map((entry) => entry.reason), ["env/svg-painted-bounds-inconclusive"]);
    assert.equal(crossing.exit, 4);
    const inside = run([target("inside", box(20, 30, 40, 14), cell(box(18, 28, 44, 18)))]);
    assert.deepEqual([inside.report.findings.length, inside.coverage?.measured, inside.exit], [0, 1, 0]);
  });

  it("never claims text that paints nothing is not drawn", () => {
    const blank: SvgTextTarget["paint"] = { inkSource: "cell", inkDiagnostic: "white-space", inkInnerLocal: null, inkOuterLocal: box(230, 28, 44, 18), strokePad: 0, strokeScaleX: 1, paints: false };
    const { report, coverage, exit } = run([target("blank", box(232, 30, 40, 14), blank)]);
    assert.deepEqual(report.findings, []);
    assert.deepEqual(coverage?.notMeasured.map((entry) => entry.reason), ["env/svg-painted-bounds-inconclusive"]);
    assert.equal(exit, 4);
  });
});
