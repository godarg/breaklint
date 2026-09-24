/**
 * The SVG local frame, end to end without a browser: the collector's raw facts (computed-style
 * strings, CTMs and getBBox rectangles, shaped like what Chromium 141 returned for the same
 * documents) through `assembleSnapshot` and the real rule to a report.
 *
 * Each case is built the way the live fixtures are: one label at least 3 px inside the real clip
 * edge and one at least 3 px outside it, so that a reconstruction wrong by less than 3 px is
 * still caught and a correct one is never borderline. The three named mutants of the design —
 * inset from the border box instead of the content box, a dropped clip margin, and a nested
 * viewport taken from getBoundingClientRect — each turn one of these red.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { exitCodeFor, runDocument } from "../../src/core/engine.ts";
import { SNAPSHOT_SCHEMA_VERSION, SVG_VIEWPORT_DIAGNOSTICS } from "../../src/core/enums.ts";
import type { AffineMatrix, Box, Snapshot } from "../../src/core/types.ts";
import {
  assembleSnapshot,
  inputIdentity,
  validateSnapshotInvariants,
  type RawSnapshot,
  type RawSvg,
} from "../../src/measure/snapshot.ts";
import {
  SVG_FRAME_TOLERANCE_PX,
  apply,
  axisAligned,
  cssPx,
  envelope,
  multiply,
  nestedViewportGeometry,
  oracleDelta,
  outerViewportGeometry,
  quadDelta,
  overshootBeyond,
  parseClipMargin,
  parseCornerRadius,
  threeDimensional,
  type RawSvgFrame,
  type SvgBoxModel,
  type SvgBoxStyle,
} from "../../src/measure/svg-viewport.ts";
import { textOverflowsViewport } from "../../src/rules/svg/text-overflows-viewport.ts";

const I: AffineMatrix = [1, 0, 0, 1, 0, 0];
const translate = (x: number, y: number): AffineMatrix => [1, 0, 0, 1, x, y];
const scale = (sx: number, sy = sx): AffineMatrix => [sx, 0, 0, sy, 0, 0];
const rotate = (degrees: number): AffineMatrix => {
  const r = (degrees * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
};
const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });

function style(over: Partial<SvgBoxStyle> = {}): SvgBoxStyle {
  return {
    width: "200px", height: "80px", boxSizing: "content-box",
    borderTopWidth: "0px", borderRightWidth: "0px", borderBottomWidth: "0px", borderLeftWidth: "0px",
    paddingTop: "0px", paddingRight: "0px", paddingBottom: "0px", paddingLeft: "0px",
    borderTopLeftRadius: "0px", borderTopRightRadius: "0px", borderBottomRightRadius: "0px", borderBottomLeftRadius: "0px",
    overflowX: "hidden", overflowY: "hidden", overflowClipMargin: "content-box",
    ...over,
  };
}
const edges = (top: number, right = top, bottom = top, left = right) => ({ top, right, bottom, left });
const padding = (p: ReturnType<typeof edges>): Partial<SvgBoxStyle> =>
  ({ paddingTop: `${p.top}px`, paddingRight: `${p.right}px`, paddingBottom: `${p.bottom}px`, paddingLeft: `${p.left}px` });
const border = (b: ReturnType<typeof edges>): Partial<SvgBoxStyle> =>
  ({ borderTopWidth: `${b.top}px`, borderRightWidth: `${b.right}px`, borderBottomWidth: `${b.bottom}px`, borderLeftWidth: `${b.left}px` });

/** CDP's content quad for a content box through the frame's map to the screen, corner order TL TR BR BL. */
function quadOf(content: Box, localToScreen: AffineMatrix, shift = 0): number[] {
  return [[content.x, content.y], [content.x + content.width, content.y], [content.x + content.width, content.y + content.height], [content.x, content.y + content.height]]
    .flatMap(([x, y]) => apply(localToScreen, x!, y!)).map((value) => value + shift);
}

/** CDP's box model for an outermost SVG whose boxes are these, in the frame. */
function modelOf(localToScreen: AffineMatrix, content: Box, padding = content, border = padding, shift = 0): SvgBoxModel {
  return { content: quadOf(content, localToScreen, shift), padding: quadOf(padding, localToScreen, shift), border: quadOf(border, localToScreen, shift) };
}

interface TextSpec { id: string; bbox: Box; ctm?: AffineMatrix }

function outerFrame(over: Partial<RawSvgFrame> & { localToScreen: AffineMatrix; viewBox?: AffineMatrix }): RawSvgFrame {
  const viewBox = over.viewBox ?? I;
  return {
    kind: "outer", parentIndex: -1, anchorIndex: -1, anchorCtm: null,
    ctm: [...viewBox], screenCtm: [...multiply(over.localToScreen, viewBox)],
    style: style(), transforms: [], lengths: null, computed: null, attributes: null,
    ...over,
  };
}

function rawSvg(index: number, frame: RawSvgFrame, texts: TextSpec[], screenOf: AffineMatrix, over: Partial<RawSvg> = {}): RawSvg {
  return {
    nodeKey: `svg:0:${index}`, page: 1, sourceIdentity: `svg-${index}`, outerHtml: `<svg id="svg-${index}"></svg>`,
    measurable: true, reason: null, unreadableTargets: 0, unsupportedTargets: 0, notRenderedTargets: 0,
    viewportScreen: box(0, 0, 1, 1), overflow: frame.style.overflowX === frame.style.overflowY ? frame.style.overflowX : `${frame.style.overflowX} ${frame.style.overflowY}`,
    textTargetCount: texts.length, textTargetsCapped: false,
    texts: texts.map((text) => ({
      sourceIdentity: text.id, sourceAddressKey: null, signature: text.id, clipState: "none" as const,
      geometry: { bbox: [text.bbox.x, text.bbox.y, text.bbox.width, text.bbox.height], ctm: [...(text.ctm ?? I)], screenCtm: [...multiply(screenOf, text.ctm ?? I)] },
    })),
    shapes: [], paths: [], geometry: frame, oracleIndex: frame.kind === "outer" ? index : -1,
    inkPasses: { E: { count: 0, maskHash: "" }, S: { count: 0, maskHash: "" }, F: { count: 0, maskHash: "" } },
    inkCollected: false, inkStable: false,
    ...over,
  };
}

function assemble(svg: RawSvg[], models: readonly (SvgBoxModel | null)[] | undefined): Snapshot {
  const raw: RawSnapshot = {
    pages: [{ pageNumber: 1, nodeKey: "page:1", epoch: 0, blank: false, isLast: true, contentBox: box(0, 0, 800, 1000),
      pageBox: box(0, 0, 816, 1056), marginBoxes: [], fill: { vertical: 0.5, topGap: 0, net: 0.5, area: 0.2 }, notMeasured: [] }],
    blocks: [], textLines: [], svg, svgRendered: svg.length, requestedUrls: [], fontFamilies: [],
    control: { pages: 1, geometry: "", text: "", style: "", resources: "" },
  };
  const unset = { breakBefore: null, previousBreakAfter: null, page: null };
  return assembleSnapshot({
    raw,
    collector: { pages: [{ index: 0, reconciled: true, hasBreakToken: false, attributesAtLayout: unset, attributesAfterRender: unset,
      firstSid: null, lastSid: null, lastNodePage: null, blank: false, epoch: 0 }], hooks: {}, discardedRecords: 0,
      unreconciledPages: 0, attributeDrift: [], epochCount: 1 },
    sourceModel: { blocks: {}, orderedBlocks: [], runs: [], uriRefs: [], scriptBearing: false },
    sourceMap: {}, sourceMapInjection: true, renderer: null, browserVersion: "fixture", pagedjsVersion: "0.4.3",
    platform: "fixture", locale: "en", freezeSignature: "fixture", freezeRetries: 0,
    inputIdentity: inputIdentity({ html: "<svg></svg>", browserVersion: "fixture", platform: "fixture", fontFamilies: [], resources: [] }),
    evidenceOverlayApplied: false, resources: [],
    ...(models === undefined ? {} : { svgBoxModels: models }),
  });
}

function verdictOf(snapshot: Snapshot) {
  const report = runDocument(
    { path: "svg-frame.html", snapshot, infrastructure: [] },
    { failOn: "error", activeRules: [textOverflowsViewport], optionsByRule: {}, coverageFloors: {} },
  ).report;
  const labels = report.findings.map((finding) => {
    const record = snapshot.svg.find((svg) => svg.nodeKey === finding.target.nodeKey)!;
    const text = record.texts.find((item) => JSON.stringify(item.boxScreen) === JSON.stringify(finding.target.boxScreen));
    return text?.svgTextKey.split(":").at(-1);
  }).sort();
  return { report, labels, exit: exitCodeFor(report.verdict), coverage: report.coverage["svg/text-overflows-viewport"] };
}

/** A 40 x 14 label whose left edge sits at x, in the SVG's user space. */
function inside(id: string, x: number, width = 40): TextSpec {
  return { id, bbox: box(x, 30, width, 14) };
}

/** One outermost SVG, its oracle answered from its own geometry. */
function single(frame: RawSvgFrame, texts: TextSpec[], localToScreen: AffineMatrix, content: Box, padding = content, border = padding) {
  const snapshot = assemble([rawSvg(0, frame, texts, localToScreen)], [modelOf(localToScreen, content, padding, border)]);
  assert.deepEqual(validateSnapshotInvariants(snapshot, { sourceMapInjection: true }).issues, []);
  return { snapshot, ...verdictOf(snapshot) };
}

describe("SVG local frame: computed-style arithmetic", () => {
  it("reads only plain computed px lengths", () => {
    assert.equal(cssPx("10.5px"), 10.5);
    assert.equal(cssPx("1e-05px"), 0.00001);
    assert.equal(cssPx("0px"), 0);
    for (const value of ["auto", "10%", "calc(1px + 2px)", "10", "", "10pt"]) assert.equal(cssPx(value), null, value);
  });

  it("parses every overflow-clip-margin serialisation Chromium 141 produced", () => {
    // Measured serialisations: padding-box alone serialises as "0px", a padding-box with a length as
    // the bare length, and lengths arrive resolved.
    assert.deepEqual(parseClipMargin("content-box"), { box: "content-box", margin: 0 });
    assert.deepEqual(parseClipMargin("0px"), { box: "padding-box", margin: 0 });
    assert.deepEqual(parseClipMargin("10px"), { box: "padding-box", margin: 10 });
    assert.deepEqual(parseClipMargin("4px"), { box: "padding-box", margin: 4 });
    assert.deepEqual(parseClipMargin("content-box 20px"), { box: "content-box", margin: 20 });
    assert.deepEqual(parseClipMargin("20px content-box"), { box: "content-box", margin: 20 });
    assert.deepEqual(parseClipMargin("border-box"), { box: "border-box", margin: 0 });
    assert.deepEqual(parseClipMargin("border-box 5px"), { box: "border-box", margin: 5 });
    assert.deepEqual(parseClipMargin("padding-box 2.5px"), { box: "padding-box", margin: 2.5 });
    // The 0.6.0 reading: parseFloat of the keyword form is NaN, so the margin silently became 0.
    assert.ok(Number.isNaN(parseFloat("content-box 20px")));
    for (const value of ["", "10%", "-5px", "calc(2px + 3px)", "content-box padding-box", "10px 20px", "auto", "content-box 1em"]) {
      assert.equal(parseClipMargin(value), null, value);
    }
  });

  it("resolves corner radii in px and percent of the border box", () => {
    assert.deepEqual(parseCornerRadius("12px", 224, 104), [12, 12]);
    assert.deepEqual(parseCornerRadius("20px 5px", 224, 104), [20, 5]);
    assert.deepEqual(parseCornerRadius("10% 30px", 200, 80), [20, 30]);
    assert.equal(parseCornerRadius("auto", 200, 80), null);
  });

  it("insets fractional padding and snapped borders from a border-box width", () => {
    // Chromium 141: box-sizing border-box, width 230.5px, height 103.25px, padding 10.5/12.25,
    // border 3.25px computed as 3px. The CDP content box was 200 x 76.25 at the reconstructed place.
    const result = outerViewportGeometry(style({
      boxSizing: "border-box", width: "230.5px", height: "103.25px",
      ...padding(edges(10.5, 12.25)), ...border(edges(3)),
    }));
    assert.ok(result.ok);
    assert.deepEqual(result.content, box(0, 0, 200, 76.25));
    assert.deepEqual(result.clip, box(0, 0, 200, 76.25), "the UA clip margin is the content box");
  });

  it("clips at the reference box each clip-margin form names, grown by its length", () => {
    const base = { ...padding(edges(8)), ...border(edges(4)) };
    const clipFor = (overflowClipMargin: string) => {
      const result = outerViewportGeometry(style({ ...base, overflowClipMargin }));
      assert.ok(result.ok, overflowClipMargin);
      return result.clip;
    };
    // Pixel-measured on Chromium 141 with the same box (content 200 x 80 at 62,62 on screen):
    assert.deepEqual(clipFor("content-box"), box(0, 0, 200, 80));
    assert.deepEqual(clipFor("0px"), box(-8, -8, 216, 96), "padding-box serialises as 0px and clips at the padding box");
    assert.deepEqual(clipFor("10px"), box(-18, -18, 236, 116), "a bare length grows the PADDING box");
    assert.deepEqual(clipFor("content-box 10px"), box(-10, -10, 220, 100));
    assert.deepEqual(clipFor("4px"), box(-12, -12, 224, 104));
    assert.deepEqual(clipFor("border-box"), box(-12, -12, 224, 104));
    assert.deepEqual(clipFor("border-box 5px"), box(-17, -17, 234, 114));
    assert.deepEqual(clipFor("content-box 15px"), box(-15, -15, 230, 110));
  });

  it("models overflow on both axes together or not at all", () => {
    assert.deepEqual(outerViewportGeometry(style({ overflowX: "visible", overflowY: "visible" })),
      { ok: true, content: box(0, 0, 200, 80), padding: box(0, 0, 200, 80), border: box(0, 0, 200, 80), clip: null, reference: null });
    for (const overflow of ["hidden", "clip", "auto", "scroll"]) {
      const result = outerViewportGeometry(style({ overflowX: overflow, overflowY: overflow }));
      assert.ok(result.ok && result.clip, overflow);
    }
    assert.deepEqual(outerViewportGeometry(style({ overflowX: "visible", overflowY: "clip" })), { ok: false, diagnostic: "overflow-axes-differ" });
    assert.deepEqual(outerViewportGeometry(style({ overflowX: "auto", overflowY: "hidden" })), { ok: false, diagnostic: "overflow-axes-differ" });
    assert.deepEqual(outerViewportGeometry(style({ overflowX: "overlay", overflowY: "overlay" })), { ok: false, diagnostic: "overflow-unrecognised" });
  });

  it("declines a rounded clip and any radius with a clip margin, and keeps a squared one", () => {
    const base = { ...padding(edges(8)), ...border(edges(4)) };
    // Radius 12 over border 4 + padding 8: the content corner is square (measured: clip = content box).
    assert.ok(outerViewportGeometry(style({ ...base, borderTopLeftRadius: "12px", borderTopRightRadius: "12px", borderBottomRightRadius: "12px", borderBottomLeftRadius: "12px" })).ok);
    assert.deepEqual(outerViewportGeometry(style({ ...base, borderTopRightRadius: "20px" })), { ok: false, diagnostic: "rounded-clip" });
    // Percentages resolve against the border box (224 x 104): 10% is 22.4 x 10.4, and 10.4 does not
    // reach past border + padding (12), so that corner is square; 20% (44.8 x 20.8) rounds it.
    assert.ok(outerViewportGeometry(style({ ...base, borderBottomLeftRadius: "10%" })).ok);
    assert.deepEqual(outerViewportGeometry(style({ ...base, borderBottomLeftRadius: "20%" })), { ok: false, diagnostic: "rounded-clip" });
    // A radius whose one side is zero is a square corner.
    assert.ok(outerViewportGeometry(style({ ...base, borderTopLeftRadius: "40px 0px" })).ok);
    assert.deepEqual(outerViewportGeometry(style({ ...base, borderTopLeftRadius: "4px", overflowClipMargin: "content-box 10px" })), { ok: false, diagnostic: "radius-with-clip-margin" });
    assert.deepEqual(outerViewportGeometry(style({ ...base, borderTopLeftRadius: "4px", overflowClipMargin: "0px" })), { ok: false, diagnostic: "radius-with-clip-margin" });
  });

  it("declines a box it cannot read", () => {
    assert.deepEqual(outerViewportGeometry(style({ width: "auto" })), { ok: false, diagnostic: "box-unreadable" });
    assert.deepEqual(outerViewportGeometry(style({ boxSizing: "padding-box" })), { ok: false, diagnostic: "box-unreadable" });
    assert.deepEqual(outerViewportGeometry(style({ boxSizing: "border-box", width: "10px", ...padding(edges(8)) })), { ok: false, diagnostic: "box-unreadable" });
  });

  it("tells 2D transform facts from 3D ones", () => {
    const none = { transform: "none", rotate: "none", scale: "none", translate: "none", perspective: "none", offsetPath: "none" };
    for (const facts of [
      { transform: "matrix(1.23101, 0.21706, -0.21706, 1.23101, 0, 0)" }, { rotate: "15deg" }, { rotate: "-0.5turn" },
      { scale: "2" }, { scale: "2 3" }, { translate: "10px 20px" }, { translate: "calc(10% + 2px) 3px" },
    ]) assert.equal(threeDimensional({ ...none, ...facts }), false, JSON.stringify(facts));
    for (const facts of [
      { transform: "matrix3d(1, 0, 0, 0, 0, 0.77, 0.64, 0, 0, -0.64, 0.77, 0, 0, 0, 0, 1)" }, { perspective: "300px" },
      { offsetPath: "path(\"M 0 0 L 10 10\")" }, { rotate: "x 45deg" }, { rotate: "1 1 0 45deg" }, { scale: "1 1 2" },
      { translate: "1px 2px 3px" },
    ]) assert.equal(threeDimensional({ ...none, ...facts }), true, JSON.stringify(facts));
  });

  it("only takes a nested viewport the computed style agrees with", () => {
    const nested = (over: Partial<RawSvgFrame> = {}): RawSvgFrame => ({
      kind: "nested", parentIndex: 0, anchorIndex: -1, anchorCtm: [...I], ctm: null, screenCtm: null,
      style: style({ overflowClipMargin: "content-box" }), transforms: [], lengths: [50, 50, 100, 60],
      computed: { x: "50px", y: "50px", width: "100px", height: "60px", transform: "none" }, attributes: { x: "50", y: "50" },
      ...over,
    });
    assert.deepEqual(nestedViewportGeometry(nested(), translate(10, 5)), { ok: true, viewport: box(60, 55, 100, 60), clip: box(60, 55, 100, 60) });
    // Chromium 141: CSS `x: 30px; width: 40px` on the nested SVG — the clip used width 40 and x 50.
    assert.deepEqual(nestedViewportGeometry(nested({ computed: { x: "30px", y: "50px", width: "40px", height: "60px", transform: "none" } }), I),
      { ok: false, diagnostic: "nested-lengths-disagree" });
    assert.deepEqual(nestedViewportGeometry(nested({ lengths: [40, 50, 200, 50], computed: { x: "10%", y: "25%", width: "200px", height: "50px", transform: "none" }, attributes: { x: "10%", y: "25%" } }), I),
      { ok: true, viewport: box(40, 50, 200, 50), clip: box(40, 50, 200, 50) });
    assert.deepEqual(nestedViewportGeometry(nested({ computed: { x: "20%", y: "50px", width: "100px", height: "60px", transform: "none" }, attributes: { x: "10%", y: "50" } }), I),
      { ok: false, diagnostic: "nested-lengths-disagree" });
    assert.deepEqual(nestedViewportGeometry(nested({ computed: { x: "50px", y: "50px", width: "100px", height: "60px", transform: "matrix(1, 0, 0, 1, 30, 10)" } }), I),
      { ok: false, diagnostic: "nested-transform" });
    assert.deepEqual(nestedViewportGeometry(nested({ style: style({ overflowClipMargin: "20px" }) }), I), { ok: false, diagnostic: "nested-clip-margin" });
    assert.deepEqual(nestedViewportGeometry(nested(), rotate(20)), { ok: false, diagnostic: "nested-viewport-rotated" });
    assert.equal(nestedViewportGeometry(nested({ style: style({ overflowX: "visible", overflowY: "visible" }) }), I).ok, true);
    assert.equal(axisAligned(rotate(90)), true, "a quarter turn keeps a rectangle a rectangle");
    assert.equal(axisAligned(multiply(scale(-1, 1), translate(3, 4))), true);
  });

  it("measures the oracle in frame px and rejects a shifted quad", () => {
    const localToScreen = multiply(translate(64.95, 29.8), rotate(15));
    const content = box(0, 0, 200, 80);
    assert.ok(quadDelta(content, localToScreen, quadOf(content, localToScreen))! < 1e-9);
    // A 0.01 px screen shift on both axes, rotated back into the frame: 0.01·(cos 15° + sin 15°).
    const shifted = quadDelta(content, localToScreen, quadOf(content, localToScreen, 0.01))!;
    assert.ok(Math.abs(shifted - 0.01 * (Math.cos(Math.PI / 12) + Math.sin(Math.PI / 12))) < 1e-9);
    assert.ok(shifted > SVG_FRAME_TOLERANCE_PX);
    // Under zoom 2 a 0.004 px screen shift is 0.002 frame px: the tolerance is stated in the frame.
    assert.ok(Math.abs(quadDelta(content, scale(2), quadOf(content, scale(2), 0.004))! - 0.002) < 1e-9);
    assert.equal(quadDelta(content, [0, 0, 0, 0, 1, 1], quadOf(content, I)), null);
    // Chromium serialises computed lengths with six significant digits: 1234.515625 px of used
    // width reads "1234.52px". That is inside the tolerance; a missing padding is not.
    const wide = box(0, 0, 1234.515625, 80);
    assert.ok(quadDelta(box(0, 0, 1234.52, 80), I, quadOf(wide, I))! <= SVG_FRAME_TOLERANCE_PX);
  });

  it("confirms the reference box a clip margin grows, and only that one", () => {
    // Computed padding is the specified length: 3.333333px reads "3.33333px", layout uses 3.328125.
    const fractional = style({ ...padding(edges(3.33333)), ...border(edges(4)) });
    const used = { content: box(0, 0, 200, 80), padding: box(-3.328125, -3.328125, 206.65625, 86.65625), border: box(-7.328125, -7.328125, 214.65625, 94.65625) };
    const cdp = modelOf(I, used.content, used.padding, used.border);
    const plain = outerViewportGeometry(fractional);
    assert.ok(plain.ok);
    assert.equal(plain.reference, "content-box");
    assert.equal(oracleDelta(plain, I, cdp), 0, "the content-box clip does not rest on the padding");
    const grown = outerViewportGeometry({ ...fractional, overflowClipMargin: "0px" });
    assert.ok(grown.ok);
    assert.equal(grown.reference, "padding-box");
    assert.ok(oracleDelta(grown, I, cdp)! > SVG_FRAME_TOLERANCE_PX, "a clip on an unconfirmed padding box must not pass");
    const border8 = outerViewportGeometry({ ...fractional, overflowClipMargin: "border-box 2px" });
    assert.ok(border8.ok);
    assert.ok(oracleDelta(border8, I, cdp)! > SVG_FRAME_TOLERANCE_PX);
    assert.equal(oracleDelta(border8, I, modelOf(I, used.content, used.padding, border8.border)), 0);
  });

  it("takes the worst overshoot over the whole clip chain", () => {
    const text = box(130, 60, 23, 10);
    assert.equal(overshootBeyond(text, [box(60, 55, 100, 60)]), -5, "the nearest edge is the top, 5 px away");
    assert.equal(overshootBeyond(text, [box(60, 55, 100, 60), box(0, 0, 150, 200)]), 3);
  });
});

describe("SVG local frame: collector facts through assembleSnapshot and the rule", () => {

  it("measures a padded and bordered SVG against its content box, not its border box", () => {
    // padding 10, border 5, placed at (20, 20): the content box starts at (35, 35) on screen.
    const localToScreen = translate(35, 35);
    const frame = outerFrame({ localToScreen, style: style({ ...padding(edges(10)), ...border(edges(5)) }) });
    // Content right edge at 200. `in` ends 3 px inside it; `out` ends 3 px outside it but still
    // inside the border box (215) — the case an inset from the border box calls clean.
    const { labels, exit, coverage, snapshot } = single(frame, [inside("in", 157), inside("out", 163)], localToScreen,
      box(0, 0, 200, 80), box(-10, -10, 220, 100), box(-15, -15, 230, 110));
    assert.deepEqual(labels, ["out"]);
    assert.equal(exit, 1);
    assert.deepEqual([coverage?.candidates, coverage?.measured, coverage?.notMeasured.length], [2, 2, 0]);
    assert.equal(snapshot.schemaVersion, SNAPSHOT_SCHEMA_VERSION);
    assert.deepEqual(snapshot.svg[0]!.viewportLocal?.clips, [box(0, 0, 200, 80)]);
  });

  it("measures a label under a rotated ancestor in the SVG's own frame, and reports frame px", () => {
    const localToScreen = multiply(translate(64.95, 29.8), rotate(15));
    const frame = outerFrame({ localToScreen, transforms: [{ transform: "matrix(0.965926, 0.258819, -0.258819, 0.965926, 0, 0)", rotate: "none", scale: "none", translate: "none", perspective: "none", offsetPath: "none" }] });
    const { labels, exit, report, snapshot } = single(frame, [inside("in", 157), inside("out", 163)], localToScreen, box(0, 0, 200, 80));
    assert.deepEqual(labels, ["out"]);
    assert.equal(exit, 1);
    assert.equal(report.findings[0]!.measurement.value, 3);
    // Why the screen could not answer this: under the rotation the viewport's screen envelope is so
    // much larger than the viewport that the clipped label's own envelope sits inside it. Envelope
    // against envelope calls `out` drawn; it is 3 px past the edge.
    const out = snapshot.svg[0]!.texts.find((item) => item.svgTextKey.endsWith("out"))!;
    const viewportEnvelope = envelope(box(0, 0, 200, 80), localToScreen);
    assert.ok(overshootBeyond(out.boxScreen, [viewportEnvelope]) < 0, "the screen envelopes would have missed the clipped label");
  });

  it("measures under ancestor zoom in unzoomed px", () => {
    const localToScreen = multiply(translate(36, 36), scale(2));
    const frame = outerFrame({ localToScreen, style: style({ ...padding(edges(5)), ...border(edges(3)) }) });
    const { labels, report } = single(frame, [inside("in", 157), inside("out", 163)], localToScreen, box(0, 0, 200, 80));
    assert.deepEqual(labels, ["out"]);
    assert.equal(report.findings[0]!.measurement.value, 3, "frame px, not the 6 zoomed screen px");
  });

  it("does not report text the clip margin still draws", () => {
    const localToScreen = translate(62, 62);
    const base = { ...padding(edges(8)), ...border(edges(4)) };
    // content-box 10px: clip right edge at 210. `margin-in` ends at 207, `margin-out` at 213.
    const boxes = [box(0, 0, 200, 80), box(-8, -8, 216, 96), box(-12, -12, 224, 104)] as const;
    const keyword = single(outerFrame({ localToScreen, style: style({ ...base, overflowClipMargin: "content-box 10px" }) }),
      [inside("margin-in", 167), inside("margin-out", 173)], localToScreen, ...boxes);
    assert.deepEqual(keyword.labels, ["margin-out"]);
    assert.equal(keyword.report.findings[0]!.measurement.value, 3);
    // 10px: padding box + 10, right edge at 218.
    const bare = single(outerFrame({ localToScreen, style: style({ ...base, overflowClipMargin: "10px" }) }),
      [inside("pad-in", 175), inside("pad-out", 181)], localToScreen, ...boxes);
    assert.deepEqual(bare.labels, ["pad-out"]);
    // padding-box: serialised "0px", right edge at 208.
    const padded = single(outerFrame({ localToScreen, style: style({ ...base, overflowClipMargin: "0px" }) }),
      [inside("pb-in", 165), inside("pb-out", 171)], localToScreen, ...boxes);
    assert.deepEqual(padded.labels, ["pb-out"]);
  });

  describe("nested viewports", () => {
    // Outer 400 x 200 at (20, 20), viewBox the same size. Inner x=50 y=50 w=100 h=60 with
    // viewBox 0 0 50 30, so its user space is scaled 2 into the outer frame: getCTM() of a text in
    // it is translate(50, 50)·scale(2), and its client rect is the union of its CONTENT.
    const outerToScreen = translate(20, 20);
    const nestedTextCtm = multiply(translate(50, 50), scale(2));
    const nestedFrame = (over: Partial<RawSvgFrame> = {}): RawSvgFrame => ({
      kind: "nested", parentIndex: 0, anchorIndex: -1, anchorCtm: [...I], ctm: [...nestedTextCtm], screenCtm: [...multiply(outerToScreen, nestedTextCtm)],
      style: style(), transforms: [], lengths: [50, 50, 100, 60],
      computed: { x: "50px", y: "50px", width: "100px", height: "60px", transform: "none" }, attributes: { x: "50", y: "50" },
      ...over,
    });
    const build = (nested: RawSvgFrame, texts: TextSpec[], outerStyle = style({ width: "400px", height: "200px" })) => {
      const outer = rawSvg(0, outerFrame({ localToScreen: outerToScreen, style: outerStyle }), [], outerToScreen);
      // What getBoundingClientRect answers for the inner <svg> (measured on Chromium 141): the
      // union of its content on screen, not its viewport. A clipped label can never leave it.
      const boxes = texts.map((text) => envelope(text.bbox, multiply(outerToScreen, text.ctm ?? I)));
      const left = Math.min(...boxes.map((b) => b.x));
      const top = Math.min(...boxes.map((b) => b.y));
      const union = box(left, top, Math.max(...boxes.map((b) => b.x + b.width)) - left, Math.max(...boxes.map((b) => b.y + b.height)) - top);
      const inner = rawSvg(1, nested, texts, outerToScreen, { viewportScreen: union });
      const snapshot = assemble([outer, inner], [modelOf(outerToScreen, box(0, 0, 400, 200)), null]);
      assert.deepEqual(validateSnapshotInvariants(snapshot, { sourceMapInjection: true }).issues, []);
      return { snapshot, ...verdictOf(snapshot) };
    };

    it("clips a label at the nested viewport, not at the union of its content", () => {
      // In the inner user space (scale 2): `n-in` ends at local 147, 3 px inside the inner right edge
      // (150); `n-out` ends at local 153, 3 px beyond it — and far inside the outer viewport.
      const { labels, exit, coverage, snapshot } = build(nestedFrame(), [
        { id: "n-in", bbox: box(5, 5, 43.5, 7), ctm: nestedTextCtm },
        { id: "n-out", bbox: box(40, 15, 11.5, 7), ctm: nestedTextCtm },
      ]);
      assert.deepEqual(labels, ["n-out"]);
      assert.equal(exit, 1);
      assert.deepEqual([coverage?.candidates, coverage?.measured], [2, 2]);
      assert.deepEqual(snapshot.svg[1]!.viewportLocal?.clips, [box(50, 50, 100, 60), box(0, 0, 400, 200)]);
      assert.ok(overshootBeyond(snapshot.svg[1]!.texts.find((t) => t.svgTextKey.endsWith("n-out"))!.boxScreen, [snapshot.svg[1]!.viewportScreen]) <= 0,
        "against its client rect the clipped label is inside: the 0.6.0 false clean");
    });

    it("clips a nested label with overflow visible at the enclosing SVG", () => {
      // Inner overflow visible: its own viewport does not clip, the outer one (right edge 400) does.
      const nested = nestedFrame({ lengths: [300, 50, 100, 60], computed: { x: "300px", y: "50px", width: "100px", height: "60px", transform: "none" }, attributes: { x: "300", y: "50" },
        style: style({ overflowX: "visible", overflowY: "visible" }) });
      const ctm = multiply(translate(300, 50), scale(2));
      const { labels, snapshot } = build(nested, [
        { id: "v-in", bbox: box(10, 5, 38.5, 7), ctm },
        { id: "v-out", bbox: box(10, 15, 41.5, 7), ctm },
      ]);
      assert.deepEqual(labels, ["v-out"], "a visible inner overflow is not an unclipped label");
      assert.equal(snapshot.svg[1]!.clipped, true);
      assert.equal(snapshot.svg[1]!.overflow, "visible");
    });

    it("declines the nested record with the enclosing one", () => {
      const outer = rawSvg(0, outerFrame({ localToScreen: outerToScreen, style: style({ width: "400px", height: "200px", borderTopRightRadius: "30px" }) }), [], outerToScreen);
      const inner = rawSvg(1, nestedFrame(), [{ id: "x", bbox: box(5, 5, 20, 7), ctm: nestedTextCtm }], outerToScreen);
      const snapshot = assemble([outer, inner], [modelOf(outerToScreen, box(0, 0, 400, 200)), null]);
      assert.equal(snapshot.svg[1]!.measurable, false);
      assert.equal(snapshot.svg[1]!.viewportDiagnostic, "enclosing-viewport-unsupported");
      assert.deepEqual(validateSnapshotInvariants(snapshot, { sourceMapInjection: true }).issues, []);
      assert.equal(verdictOf(snapshot).exit, 4);
    });
  });

  it("declines, counted against coverage, whatever the CDP oracle does not confirm", () => {
    const localToScreen = translate(35, 35);
    const frame = outerFrame({ localToScreen, style: style({ ...padding(edges(10)), ...border(edges(5)) }) });
    const texts = [inside("in", 157), inside("out", 163)];
    const cases: [string, readonly (SvgBoxModel | null)[] | undefined][] = [
      ["oracle-unavailable", undefined],
      ["oracle-unavailable", [null]],
      ["oracle-disagreed", [modelOf(localToScreen, box(0, 0, 200, 80), box(-10, -10, 220, 100), box(-15, -15, 230, 110), 0.01)]],
      // The border box is not the content box: an inset taken from the wrong box is caught here.
      ["oracle-disagreed", [modelOf(localToScreen, box(-15, -15, 230, 110))]],
    ];
    for (const [diagnostic, quads] of cases) {
      const snapshot = assemble([rawSvg(0, frame, texts, localToScreen)], quads);
      assert.equal(snapshot.svg[0]!.measurable, false, diagnostic);
      assert.equal(snapshot.svg[0]!.reason, "env/svg-viewport-geometry-unsupported");
      assert.equal(snapshot.svg[0]!.viewportDiagnostic, diagnostic);
      assert.deepEqual(snapshot.svg[0]!.texts, []);
      assert.deepEqual(validateSnapshotInvariants(snapshot, { sourceMapInjection: true }).issues, []);
      const { exit, report } = verdictOf(snapshot);
      assert.equal(exit, 4, "an unproven frame is never a clean exit");
      assert.deepEqual(report.findings, []);
    }
    // Agreement just inside the stated tolerance is agreement.
    const within = assemble([rawSvg(0, frame, texts, localToScreen)], [modelOf(localToScreen, box(0, 0, 200, 80), box(-10, -10, 220, 100), box(-15, -15, 230, 110), SVG_FRAME_TOLERANCE_PX / 2)]);
    assert.equal(within.svg[0]!.measurable, true);
  });

  it("keeps 3D, perspective and rounded clips as declines", () => {
    const localToScreen = translate(24, 34);
    const none = { transform: "none", rotate: "none", scale: "none", translate: "none", perspective: "none", offsetPath: "none" };
    for (const [diagnostic, over] of [
      ["three-dimensional-transform", { transforms: [{ ...none, transform: "matrix3d(1, 0, 0, 0, 0, 0.766, 0.643, 0, 0, -0.643, 0.766, 0, 0, 0, 0, 1)" }] }],
      ["three-dimensional-transform", { transforms: [{ ...none, perspective: "300px" }] }],
      ["rounded-clip", { style: style({ ...padding(edges(2)), ...border(edges(2)), borderTopLeftRadius: "20px 5px" }) }],
      ["matrix-unavailable", { ctm: null }],
    ] as const) {
      const snapshot = assemble([rawSvg(0, outerFrame({ localToScreen, ...(over as Partial<RawSvgFrame>) }), [inside("t", 20)], localToScreen)], [modelOf(localToScreen, box(0, 0, 200, 80))]);
      assert.equal(snapshot.svg[0]!.viewportDiagnostic, diagnostic);
      assert.equal(verdictOf(snapshot).exit, 4, diagnostic);
    }
  });

  it("declines a record inside a foreignObject, and keeps overflow: visible non-applicable", () => {
    const localToScreen = translate(30, 30);
    const fo = assemble([rawSvg(0, outerFrame({ localToScreen, kind: "foreign-object" }), [inside("t", 20)], localToScreen, { oracleIndex: -1 })], [null]);
    assert.equal(fo.svg[0]!.viewportDiagnostic, "inside-foreign-object");
    assert.equal(verdictOf(fo).exit, 4);
    const visible = assemble([rawSvg(0, outerFrame({ localToScreen, style: style({ overflowX: "visible", overflowY: "visible" }) }), [inside("far", 900)], localToScreen)],
      [modelOf(localToScreen, box(0, 0, 200, 80))]);
    const { coverage } = verdictOf(visible);
    assert.equal(visible.svg[0]!.clipped, false);
    // Non-applicable, not declined: out of the coverage base, still named in notMeasured.
    assert.deepEqual([coverage?.candidates, coverage?.ok], [0, true]);
    assert.deepEqual(coverage?.notMeasured.map((entry) => entry.reason), ["env/svg-overflow-visible"]);
  });

  it("counts a target whose local matrix does not reach its own getScreenCTM() as unreadable", () => {
    const localToScreen = translate(35, 35);
    const frame = outerFrame({ localToScreen });
    const raw = rawSvg(0, frame, [inside("good", 20), inside("drift", 60)], localToScreen);
    raw.texts[1]!.geometry.screenCtm = [...translate(35.01, 35)];
    const snapshot = assemble([raw], [modelOf(localToScreen, box(0, 0, 200, 80))]);
    assert.equal(snapshot.svg[0]!.texts.length, 1);
    assert.equal(snapshot.svg[0]!.unreadableTargets, 1);
    const { coverage, exit } = verdictOf(snapshot);
    assert.deepEqual(coverage?.notMeasured.map((entry) => entry.reason), ["env/svg-ctm-unavailable"]);
    assert.equal(exit, 4);
  });

  it("rejects a local box that is not the envelope of its user box", () => {
    const localToScreen = translate(35, 35);
    const snapshot = assemble([rawSvg(0, outerFrame({ localToScreen }), [inside("t", 20)], localToScreen)], [modelOf(localToScreen, box(0, 0, 200, 80))]);
    const edited = structuredClone(snapshot);
    edited.svg[0]!.texts[0]!.boxLocal = box(10, 30, 40, 14);
    assert.ok(validateSnapshotInvariants(edited, { sourceMapInjection: true }).issues.some((issue) => issue.includes("local box")));
    const unframed = structuredClone(snapshot);
    unframed.svg[0]!.viewportLocal = null;
    assert.ok(validateSnapshotInvariants(unframed, { sourceMapInjection: true }).issues.some((issue) => issue.includes("no local frame")));
  });
});

describe("snapshot schema 5", () => {
  it("the engine refuses a snapshot of any other stamp, as a fatal event", () => {
    const localToScreen = translate(35, 35);
    const snapshot = assemble([rawSvg(0, outerFrame({ localToScreen }), [inside("t", 20)], localToScreen)], [modelOf(localToScreen, box(0, 0, 200, 80))]);
    const stale = { ...structuredClone(snapshot), schemaVersion: 4 };
    const report = runDocument(
      { path: "stale.json", snapshot: stale, infrastructure: [] },
      { failOn: "error", activeRules: [textOverflowsViewport], optionsByRule: {}, coverageFloors: {} },
    ).report;
    assert.equal(report.verdict, "infrastructure");
    assert.equal(exitCodeFor(report.verdict), 3);
    assert.deepEqual(report.infrastructure.map((event) => [event.kind, event.measured?.["schemaVersion"]]), [["checker-crashed", 4]]);
    assert.deepEqual(report.findings, []);
  });

  it("the stored demo snapshot is migrated: current stamp, local frame, derivable boxes", () => {
    const demo = JSON.parse(readFileSync(new URL("../../examples/demo-snapshot.json", import.meta.url), "utf8")) as { snapshot: Snapshot };
    assert.equal(demo.snapshot.schemaVersion, SNAPSHOT_SCHEMA_VERSION);
    assert.equal(SNAPSHOT_SCHEMA_VERSION, 5);
    assert.ok(demo.snapshot.svg.length > 0, "the demo must still carry an SVG to show the migration on");
    for (const svg of demo.snapshot.svg) {
      assert.equal(typeof svg.clipped, "boolean");
      assert.ok(svg.viewportLocal, "a measurable demo SVG without its frame would decline every target");
      for (const text of svg.texts) assert.ok(text.boxLocal && text.bboxUser && text.userToLocal.length === 6);
    }
    assert.deepEqual(validateSnapshotInvariants(demo.snapshot, { sourceMapInjection: true }).issues
      .filter((issue) => issue.startsWith(demo.snapshot.svg[0]!.nodeKey)), []);
  });

  it("names every viewport diagnostic the resolver can produce", () => {
    assert.equal(new Set(SVG_VIEWPORT_DIAGNOSTICS).size, SVG_VIEWPORT_DIAGNOSTICS.length);
  });
});

