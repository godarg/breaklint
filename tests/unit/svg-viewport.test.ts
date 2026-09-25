/**
 * The SVG local frame, end to end without a browser: the collector's raw facts (computed-style
 * strings, CTMs, getBBox rectangles and CDP quads, shaped like what Chromium 141 returned for the
 * same documents) through `assembleSnapshot` and the real rule to a report.
 *
 * Each case is built the way the live fixtures are: one label at least 3 px inside the real clip
 * edge and one at least 3 px outside it, so that a reconstruction wrong by less than 3 px is
 * still caught and a correct one is never borderline — except where the borderline IS the case
 * (the resolution tests, the used-box test). The named mutants of the design — inset from the
 * border box instead of the content box, a dropped clip margin, a nested viewport taken from
 * getBoundingClientRect, `auto` clipping a nested SVG, paint containment ignored, the clip rebuilt
 * from computed style instead of the used boxes — each turn one of these red.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { cdpAncestor, cdpTree, svgBoxModels } from "../../src/acquire/render-run.ts";
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
  SVG_FLOAT_NOISE_PX,
  SVG_FRAME_TOLERANCE_PX,
  SVG_MODEL_TOLERANCE_PX,
  SVG_OVERSHOOT_EPSILON_PX,
  ancestorClip,
  apply,
  axisAligned,
  contentModel,
  cssPx,
  envelope,
  float32HalfSpacing,
  ancestorContains,
  paintOffsetUnmodelled,
  paintedClip,
  parseViewBox,
  snapPixel,
  viewBoxTransform,
  localBoxes,
  localRectangle,
  multiply,
  nestedViewportGeometry,
  outerClip,
  overflowState,
  overshootBeyond,
  paintContainment,
  parseClipMargin,
  parseCornerRadius,
  serialisationHalfUnit,
  threeDimensional,
  unmodelledClip,
  type RawSvgFrame,
  type SvgAncestorFacts,
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
    contain: "none", contentVisibility: "visible", clipPath: "none", maskImage: "none", mask: "none",
    maskBoxImageSource: "none", maskBorderSource: "none", filter: "none", clip: "auto",
    ...over,
  };
}
const edges = (top: number, right = top, bottom = top, left = right) => ({ top, right, bottom, left });
const padding = (p: ReturnType<typeof edges>): Partial<SvgBoxStyle> =>
  ({ paddingTop: `${p.top}px`, paddingRight: `${p.right}px`, paddingBottom: `${p.bottom}px`, paddingLeft: `${p.left}px` });
const border = (b: ReturnType<typeof edges>): Partial<SvgBoxStyle> =>
  ({ borderTopWidth: `${b.top}px`, borderRightWidth: `${b.right}px`, borderBottomWidth: `${b.bottom}px`, borderLeftWidth: `${b.left}px` });
const visible = { overflowX: "visible", overflowY: "visible" } as const;

function ancestor(over: Partial<SvgAncestorFacts> = {}): SvgAncestorFacts {
  return {
    up: 1, overflowX: "hidden", overflowY: "hidden", contain: "none", contentVisibility: "visible",
    clipPath: "none", maskImage: "none", mask: "none", maskBoxImageSource: "none", maskBorderSource: "none",
    filter: "none", clip: "auto", radii: ["0px", "0px", "0px", "0px"],
    ...over,
  };
}

/** CDP's quad for a box through the frame's map to the screen, corner order TL TR BR BL. */
function quadOf(content: Box, localToScreen: AffineMatrix, shift = 0): number[] {
  return [[content.x, content.y], [content.x + content.width, content.y], [content.x + content.width, content.y + content.height], [content.x, content.y + content.height]]
    .flatMap(([x, y]) => apply(localToScreen, x!, y!)).map((value) => value + shift);
}

/** CDP's box model for an outermost SVG whose used boxes are these, in the frame. */
function modelOf(localToScreen: AffineMatrix, content: Box, padding = content, border = padding, shift = 0, ancestors?: (number[] | null)[]): SvgBoxModel {
  return {
    content: quadOf(content, localToScreen, shift), padding: quadOf(padding, localToScreen, shift), border: quadOf(border, localToScreen, shift),
    ...(ancestors ? { ancestors } : {}),
    scroll: [0, 0],
  };
}

interface TextSpec { id: string; bbox: Box; ctm?: AffineMatrix }

function outerFrame(over: Partial<RawSvgFrame> & { localToScreen: AffineMatrix; viewBox?: AffineMatrix }): RawSvgFrame {
  const { localToScreen, viewBox: vb, ...rest } = over;
  const viewBox = vb ?? I;
  return {
    kind: "outer", parentIndex: -1, anchorIndex: -1, anchorCtm: null,
    ctm: [...viewBox], screenCtm: [...multiply(localToScreen, viewBox)],
    style: style(), transforms: [], ancestors: [], slotted: false, scrolled: false, lengths: null, computed: null, attributes: null,
    ...rest,
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

/** One outermost SVG, its oracle answered from its own used boxes. */
function single(frame: RawSvgFrame, texts: TextSpec[], localToScreen: AffineMatrix, content: Box, padding = content, border = padding, ancestors?: (number[] | null)[]) {
  const snapshot = assemble([rawSvg(0, frame, texts, localToScreen)], [modelOf(localToScreen, content, padding, border, 0, ancestors)]);
  assert.deepEqual(validateSnapshotInvariants(snapshot, { sourceMapInjection: true }).issues, []);
  return { snapshot, ...verdictOf(snapshot) };
}

/** Content, padding and border boxes around a content box. */
const usedBoxes = (content: Box, pad = edges(0), bord = edges(0)): [Box, Box, Box] => {
  const paddingBox = box(content.x - pad.left, content.y - pad.top, content.width + pad.left + pad.right, content.height + pad.top + pad.bottom);
  const borderBox = box(paddingBox.x - bord.left, paddingBox.y - bord.top, paddingBox.width + bord.left + bord.right, paddingBox.height + bord.top + bord.bottom);
  return [content, paddingBox, borderBox];
};
const boxesOf = ([content, paddingBox, borderBox]: [Box, Box, Box]) => ({ content, padding: paddingBox, border: borderBox });

describe("SVG local frame: computed-style arithmetic", () => {
  it("reads only plain computed px lengths", () => {
    assert.equal(cssPx("10.5px"), 10.5);
    assert.equal(cssPx("1e-05px"), 0.00001);
    assert.equal(cssPx("0px"), 0);
    for (const value of ["auto", "10%", "calc(1px + 2px)", "10", "", "10pt"]) assert.equal(cssPx(value), null, value);
  });

  it("parses every overflow-clip-margin serialisation Chromium 141 produced, with its resolution", () => {
    // Measured serialisations: padding-box alone serialises as "0px", a padding-box with a length as
    // the bare length, and lengths arrive resolved and snapped (10.3px reads "10.2969px").
    const margin = (value: string) => {
      const parsed = parseClipMargin(value);
      return parsed ? { box: parsed.box, margin: parsed.margin } : null;
    };
    assert.deepEqual(margin("content-box"), { box: "content-box", margin: 0 });
    assert.deepEqual(margin("0px"), { box: "padding-box", margin: 0 });
    assert.deepEqual(margin("10px"), { box: "padding-box", margin: 10 });
    assert.deepEqual(margin("4px"), { box: "padding-box", margin: 4 });
    assert.deepEqual(margin("content-box 20px"), { box: "content-box", margin: 20 });
    assert.deepEqual(margin("20px content-box"), { box: "content-box", margin: 20 });
    assert.deepEqual(margin("border-box"), { box: "border-box", margin: 0 });
    assert.deepEqual(margin("border-box 5px"), { box: "border-box", margin: 5 });
    assert.deepEqual(margin("padding-box 2.5px"), { box: "padding-box", margin: 2.5 });
    // The 0.6.0 reading: parseFloat of the keyword form is NaN, so the margin silently became 0.
    assert.ok(Number.isNaN(parseFloat("content-box 20px")));
    for (const value of ["", "10%", "-5px", "calc(2px + 3px)", "content-box padding-box", "10px 20px", "auto", "content-box 1em"]) {
      assert.equal(parseClipMargin(value), null, value);
    }
    // Six significant digits: the used margin is within half a unit of the last one.
    assert.equal(parseClipMargin("content-box")!.resolution, 0);
    assert.ok(Math.abs(parseClipMargin("content-box 10.2969px")!.resolution - 5e-5) < 1e-12);
    assert.ok(Math.abs(parseClipMargin("1234.56px")!.resolution - 0.005) < 1e-12);
    assert.ok(Math.abs(serialisationHalfUnit(999.999) - 5e-4) < 1e-12);
  });

  it("resolves corner radii in px and percent of the border box", () => {
    assert.deepEqual(parseCornerRadius("12px", 224, 104), [12, 12]);
    assert.deepEqual(parseCornerRadius("20px 5px", 224, 104), [20, 5]);
    assert.deepEqual(parseCornerRadius("10% 30px", 200, 80), [20, 30]);
    assert.equal(parseCornerRadius("auto", 200, 80), null);
  });

  it("models the computed content box for the units check only", () => {
    // Chromium 141: box-sizing border-box, width 230.5px, height 103.25px, padding 10.5/12.25,
    // border 3.25px computed as 3px. The CDP content box was 200 x 76.25.
    assert.deepEqual(contentModel(style({ boxSizing: "border-box", width: "230.5px", height: "103.25px", ...padding(edges(10.5, 12.25)), ...border(edges(3)) })),
      { ok: true, width: 200, height: 76.25 });
    assert.deepEqual(contentModel(style({ width: "auto" })), { ok: false, diagnostic: "box-unreadable" });
    assert.deepEqual(contentModel(style({ boxSizing: "padding-box" })), { ok: false, diagnostic: "box-unreadable" });
    assert.deepEqual(contentModel(style({ boxSizing: "border-box", width: "10px", ...padding(edges(8)) })), { ok: false, diagnostic: "box-unreadable" });
  });

  it("clips at the used reference box each clip-margin form names, grown by its length", () => {
    const boxes = boxesOf(usedBoxes(box(0, 0, 200, 80), edges(8), edges(4)));
    const clipFor = (overflowClipMargin: string, over: Partial<SvgBoxStyle> = {}) => {
      const result = outerClip(style({ overflowClipMargin, ...over }), boxes);
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
    // Paint containment clips exactly where overflow does (measured with overflow: visible, every
    // clip-margin form): the same rectangles, from `contain` or `content-visibility`.
    assert.deepEqual(clipFor("border-box 5px", { ...visible, contain: "paint" }), box(-17, -17, 234, 114));
    assert.deepEqual(clipFor("content-box", { ...visible, contain: "strict" }), box(0, 0, 200, 80));
    assert.deepEqual(clipFor("6px", { ...visible, contentVisibility: "auto" }), box(-14, -14, 228, 108));
    assert.deepEqual(outerClip(style({ ...visible, contain: "layout size" }), boxes), { ok: true, clip: null, resolution: 0, reference: null, margin: 0 });
    assert.deepEqual(outerClip(style({ ...visible, contain: "paint unknown" }), boxes), { ok: false, diagnostic: "containment-unrecognised" });
  });

  it("models overflow per kind: `auto` clips an outermost SVG, not a nested one", () => {
    // Outermost, measured: hidden, clip, auto and scroll clip; any pair of scroll-container values
    // clips both axes (visible/hidden computes to `auto hidden` and clipped both); visible/clip not.
    for (const overflow of ["hidden", "clip", "auto", "scroll"]) assert.deepEqual(overflowState("outer", overflow, overflow), { clips: true }, overflow);
    assert.deepEqual(overflowState("outer", "visible", "visible"), { clips: false });
    for (const [x, y] of [["auto", "hidden"], ["hidden", "scroll"], ["scroll", "auto"], ["hidden", "auto"]]) {
      assert.deepEqual(overflowState("outer", x!, y!), { clips: true }, `${x} ${y}`);
    }
    assert.deepEqual(overflowState("outer", "visible", "clip"), { diagnostic: "overflow-axes-differ" });
    assert.deepEqual(overflowState("outer", "clip", "visible"), { diagnostic: "overflow-axes-differ" });
    assert.deepEqual(overflowState("outer", "overlay", "overlay"), { diagnostic: "overflow-unrecognised" });
    // Nested, measured: hidden, clip and scroll clip at the viewport; auto paints like visible, as
    // property and as attribute; auto hidden does not clip either, and is declined as mixed.
    for (const overflow of ["hidden", "clip", "scroll"]) assert.deepEqual(overflowState("nested", overflow, overflow), { clips: true }, overflow);
    assert.deepEqual(overflowState("nested", "auto", "auto"), { clips: false });
    assert.deepEqual(overflowState("nested", "visible", "visible"), { clips: false });
    assert.deepEqual(overflowState("nested", "auto", "hidden"), { diagnostic: "overflow-axes-differ" });
  });

  it("reads paint containment and the clips it does not rebuild", () => {
    assert.equal(paintContainment("none", "visible"), false);
    for (const contain of ["paint", "strict", "content", "layout paint", "size layout style paint"]) assert.equal(paintContainment(contain, "visible"), true, contain);
    for (const contain of ["layout", "size", "inline-size", "style", "layout style"]) assert.equal(paintContainment(contain, "visible"), false, contain);
    assert.equal(paintContainment("none", "auto"), true);
    assert.equal(paintContainment("none", "hidden"), true);
    for (const [contain, cv] of [["", "visible"], ["none paint", "visible"], ["paint", "sometimes"], ["view-transition", "visible"]]) {
      assert.equal(paintContainment(contain!, cv!), null, `${contain} / ${cv}`);
    }
    const none = { clipPath: "none", maskImage: "none", mask: "none", maskBoxImageSource: "none", maskBorderSource: "", filter: "none", clip: "auto" };
    assert.equal(unmodelledClip(none), false, "an empty value is a property this browser does not have");
    assert.equal(unmodelledClip({ ...none, filter: "drop-shadow(rgb(0, 0, 0) 2px 2px 0px)" }), false, "a CSS filter function extends ink, it does not clip");
    assert.equal(unmodelledClip({ ...none, filter: "blur(2px) brightness(1.2)" }), false);
    // An allow-list: the -webkit-mask-box-image the deny-list missed, a url() inside a function
    // list, and any value this code has never seen all count as clips.
    for (const over of [{ clipPath: "inset(10px)" }, { maskImage: "url(\"#m\")" }, { mask: "linear-gradient(rgb(0, 0, 0), rgba(0, 0, 0, 0))" },
      { maskBoxImageSource: "linear-gradient(to right, rgb(0, 0, 0) 50%, rgba(0, 0, 0, 0) 50%)" }, { maskBorderSource: "url(\"m.png\")" },
      { filter: "url(\"#f\")" }, { filter: "blur(1px) url(\"#f\")" }, { filter: "future-function(1)" }, { clipPath: "something-new" },
      { clip: "rect(10px, 100px, 50px, 20px)" }]) {
      assert.equal(unmodelledClip({ ...none, ...over }), true, JSON.stringify(over));
    }
    assert.equal(ancestorClip(ancestor()), "box");
    assert.equal(ancestorClip(ancestor({ ...visible })), "none");
    assert.equal(ancestorClip(ancestor({ ...visible, contain: "layout" })), "none");
    assert.equal(ancestorClip(ancestor({ ...visible, contain: "paint" })), "box");
    assert.equal(ancestorClip(ancestor({ overflowX: "visible", overflowY: "clip" })), "box", "one clipped axis is still held to the content box");
    assert.equal(ancestorClip(ancestor({ radii: ["0px", "4px", "0px", "0px"] })), "unsupported", "a rounded overflow clip");
    assert.equal(ancestorClip(ancestor({ ...visible, radii: ["9px", "9px", "9px", "9px"] })), "none", "a radius without a clip clips nothing");
    assert.equal(ancestorClip(ancestor({ ...visible, clipPath: "circle(50%)" })), "unsupported");
  });

  it("declines a rounded clip and any radius with a clip margin, and keeps a squared one", () => {
    const boxes = boxesOf(usedBoxes(box(0, 0, 200, 80), edges(8), edges(4)));
    const clip = (over: Partial<SvgBoxStyle>) => outerClip(style(over), boxes);
    // Radius 12 over border 4 + padding 8: the content corner is square (measured: clip = content box).
    assert.ok(clip({ borderTopLeftRadius: "12px", borderTopRightRadius: "12px", borderBottomRightRadius: "12px", borderBottomLeftRadius: "12px" }).ok);
    assert.deepEqual(clip({ borderTopRightRadius: "20px" }), { ok: false, diagnostic: "rounded-clip" });
    // Percentages resolve against the border box (224 x 104): 10% is 22.4 x 10.4, and 10.4 does not
    // reach past border + padding (12), so that corner is square; 20% (44.8 x 20.8) rounds it.
    assert.ok(clip({ borderBottomLeftRadius: "10%" }).ok);
    assert.deepEqual(clip({ borderBottomLeftRadius: "20%" }), { ok: false, diagnostic: "rounded-clip" });
    // A radius whose one side is zero is a square corner.
    assert.ok(clip({ borderTopLeftRadius: "40px 0px" }).ok);
    assert.deepEqual(clip({ borderTopLeftRadius: "4px", overflowClipMargin: "content-box 10px" }), { ok: false, diagnostic: "radius-with-clip-margin" });
    assert.deepEqual(clip({ borderTopLeftRadius: "4px", overflowClipMargin: "0px" }), { ok: false, diagnostic: "radius-with-clip-margin" });
    assert.deepEqual(clip({ borderTopLeftRadius: "auto" }), { ok: false, diagnostic: "box-unreadable" });
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

  it("places a nested viewport where the browser's own CTM puts it, sized by the computed style", () => {
    // Outer frame = screen here (S = I); the nested SVG's parent space is the frame (toOuter = I)
    // unless a test says otherwise. screenCtm is what getScreenCTM() of the nested <svg> answers:
    // translate(x, y) · viewBoxTransform(w, h).
    const nested = (over: Partial<RawSvgFrame> = {}): RawSvgFrame => ({
      kind: "nested", parentIndex: 0, anchorIndex: -1, anchorCtm: [...I], ctm: null, screenCtm: [...translate(50, 50)],
      style: style({ overflowClipMargin: "content-box" }), transforms: [], ancestors: [], slotted: false, scrolled: false, lengths: [50, 50, 100, 60],
      computed: { x: "50px", y: "50px", width: "100px", height: "60px", transform: "none" }, attributes: { x: "50", y: "50" },
      ...over,
    });
    const geometry = (raw: RawSvgFrame, toOuter: AffineMatrix = I, localToScreen: AffineMatrix = I) => {
      const result = nestedViewportGeometry(raw, toOuter, localToScreen);
      return result.ok ? { ok: true, viewport: result.viewport, clip: result.clip } : result;
    };
    assert.deepEqual(geometry(nested({ screenCtm: [...translate(60, 55)] }), translate(10, 5)), { ok: true, viewport: box(60, 55, 100, 60), clip: box(60, 55, 100, 60) });
    // Measured on Chromium 141: a CSS `x: 70px` is reported by the computed x and ignored by both
    // the viewport and the CTM (40 stays 40); a CSS `width: 100px` resizes the viewport and is what
    // the computed width says, while SVGLength keeps the attribute's 160. The CTM and the computed
    // width are what the clip is built from; neither the computed x nor SVGLength is read.
    assert.deepEqual(geometry(nested({ screenCtm: [...translate(40, 20)], lengths: [40, 20, 160, 60],
      computed: { x: "70px", y: "30px", width: "100px", height: "40px", transform: "none" } })), { ok: true, viewport: box(40, 20, 100, 40), clip: box(40, 20, 100, 40) });
    // A viewBox: translate(40, 20)·scale(2) for viewBox 0 0 80 30 in 160 x 60; meet with 0 0 40 30
    // centres (translation 80); slice aligned xMaxYMax overflows upward (-40). All measured.
    assert.deepEqual(geometry(nested({ screenCtm: [2, 0, 0, 2, 40, 20], attributes: { x: "40", y: "20", viewBox: "0 0 80 30" },
      computed: { x: "40px", y: "20px", width: "160px", height: "60px", transform: "none" } })), { ok: true, viewport: box(40, 20, 160, 60), clip: box(40, 20, 160, 60) });
    assert.deepEqual(geometry(nested({ screenCtm: [2, 0, 0, 2, 80, 20], attributes: { x: "40", y: "20", viewBox: "0 0 40 30" },
      computed: { x: "40px", y: "20px", width: "160px", height: "60px", transform: "none" } })).ok, true);
    assert.deepEqual(geometry(nested({ screenCtm: [4, 0, 0, 4, 40, -40], attributes: { x: "40", y: "20", viewBox: "0 0 40 30", preserveAspectRatio: "xMaxYMax slice" },
      computed: { x: "40px", y: "20px", width: "160px", height: "60px", transform: "none" } })), { ok: true, viewport: box(40, 20, 160, 60), clip: box(40, 20, 160, 60) });
    // A CTM scale the computed size does not produce: the size is not the one laid out.
    assert.deepEqual(geometry(nested({ screenCtm: [2, 0, 0, 2, 40, 20], attributes: { x: "40", y: "20", viewBox: "0 0 80 30" },
      computed: { x: "40px", y: "20px", width: "100px", height: "60px", transform: "none" } })), { ok: false, diagnostic: "nested-lengths-disagree" });
    for (const width of ["auto", "", "50%"]) {
      assert.deepEqual(geometry(nested({ computed: { x: "50px", y: "50px", width, height: "60px", transform: "none" } })), { ok: false, diagnostic: "nested-lengths-disagree" }, width);
    }
    assert.deepEqual(geometry(nested({ attributes: { x: "50", y: "50", viewBox: "0 0 0 30" } })), { ok: false, diagnostic: "nested-lengths-disagree" });
    assert.deepEqual(geometry(nested({ attributes: { x: "50", y: "50", viewBox: "0 0 50 30", preserveAspectRatio: "sideways" } })), { ok: false, diagnostic: "nested-lengths-disagree" });
    assert.deepEqual(geometry(nested({ screenCtm: [0.9, 0.1, -0.1, 0.9, 50, 50] })), { ok: false, diagnostic: "nested-lengths-disagree" });
    assert.deepEqual(geometry(nested({ screenCtm: null })), { ok: false, diagnostic: "matrix-unavailable" });
    assert.deepEqual(geometry(nested({ computed: { x: "50px", y: "50px", width: "100px", height: "60px", transform: "matrix(1, 0, 0, 1, 30, 10)" } })),
      { ok: false, diagnostic: "nested-transform" });
    assert.deepEqual(geometry(nested({ style: style({ overflowClipMargin: "20px" }) })), { ok: false, diagnostic: "nested-clip-margin" });
    assert.deepEqual(geometry(nested({ screenCtm: [...multiply(rotate(20), translate(50, 50))] }), rotate(20)), { ok: false, diagnostic: "nested-viewport-rotated" });
    assert.equal(geometry(nested({ style: style(visible) })).ok, true);
    // `auto` on a nested SVG draws everything: a viewport, and no clip.
    assert.deepEqual(geometry(nested({ style: style({ overflowX: "auto", overflowY: "auto" }) })),
      { ok: true, viewport: box(50, 50, 100, 60), clip: null });
    assert.equal(axisAligned(rotate(90)), true, "a quarter turn keeps a rectangle a rectangle");
    assert.equal(axisAligned(multiply(scale(-1, 1), translate(3, 4))), true);
    assert.equal(parseViewBox(null), null);
    assert.deepEqual(parseViewBox(" 0,0 80 30 "), [0, 0, 80, 30]);
    assert.equal(parseViewBox("0 0 -1 30"), "invalid");
    assert.deepEqual(viewBoxTransform([0, 0, 40, 30], "none", 160, 60), [4, 0, 0, 2, -0, -0]);
  });

  it("carries CDP's quads back into the frame and bounds their float32 quantisation", () => {
    const localToScreen = multiply(translate(64.95, 29.8), rotate(15));
    const [content, paddingBox, borderBox] = usedBoxes(box(0, 0, 200, 80), edges(3), edges(2));
    const exact = localBoxes(modelOf(localToScreen, content, paddingBox, borderBox), localToScreen)!;
    assert.ok(exact.residual < 1e-9);
    assert.ok(Math.abs(exact.content.width - 200) < 1e-9 && Math.abs(exact.padding.x + 3) < 1e-9 && Math.abs(exact.border.width - 210) < 1e-9);
    // A 0.01 px screen shift on both axes, rotated back into the frame: the content corner leaves
    // the origin by 0.01·(cos 15° + sin 15°) on its larger axis.
    const shifted = localBoxes(modelOf(localToScreen, content, paddingBox, borderBox, 0.01), localToScreen)!;
    assert.ok(Math.abs(shifted.residual - 0.01 * (Math.cos(Math.PI / 12) + Math.sin(Math.PI / 12))) < 1e-9);
    assert.ok(shifted.residual > SVG_FRAME_TOLERANCE_PX);
    // Under zoom 2 a 0.004 px screen shift is 0.002 frame px: the tolerance is stated in the frame.
    assert.ok(Math.abs(localBoxes(modelOf(scale(2), content, paddingBox, borderBox, 0.004), scale(2))!.residual - 0.002) < 1e-9);
    // A mirrored ancestor keeps CDP's corner order the box's own: still a rectangle.
    const mirrored = multiply(translate(300, 0), scale(-1, 1));
    assert.ok(localBoxes(modelOf(mirrored, content, paddingBox, borderBox), mirrored)!.residual < 1e-9);
    assert.equal(localRectangle([0, 0, 1, 0, 1, 1], I), null);
    assert.equal(localBoxes(modelOf(I, content), [0, 0, 0, 0, 1, 1]), null);
    // Quantisation: half a float32 step at the largest coordinate, stretched by the inverse map.
    assert.equal(float32HalfSpacing(100_000), 2 ** -8);
    assert.equal(float32HalfSpacing(85.65685272216797), 2 ** -18);
    assert.equal(float32HalfSpacing(0), 0);
    const far = localBoxes(modelOf(translate(10, 100_000), content, paddingBox, borderBox), translate(10, 100_000))!;
    assert.equal(far.quantization, 2 ** -8);
    const shrunk = localBoxes(modelOf(scale(0.5), content, paddingBox, borderBox), scale(0.5))!;
    assert.equal(shrunk.quantization, 2 * float32HalfSpacing(105), "a shrinking map magnifies the quad's error in the frame");
  });

  it("clips where Chromium paints: the snapped clip rectangle less the snapped origin", () => {
    // The verifier's snapedge fixture, measured at a device scale of 4 through Paged.js: an SVG
    // 300.4 px wide at x = 32.3 has its content painted at 32 and its clip at 333, so in its own
    // frame the clip ends at 301, not 300.4; one 300.48 px wide at x = 32.5 is painted at 33 and
    // clipped at 333: 300, not 300.48.
    const model = (x: number, width: number): SvgBoxModel => ({
      content: quadOf(box(x, 100, width, 120), I), padding: quadOf(box(x, 100, width, 120), I), border: quadOf(box(x, 100, width, 120), I), scroll: [0, 0],
    });
    const fe = paintedClip(model(32.3, 300.4), "content-box", 0, 0, translate(32.3, 100));
    assert.ok(fe.ok);
    assert.ok(Math.abs(fe.clip.x - 0) < 1e-9 && Math.abs(fe.clip.width - 301) < 1e-9, JSON.stringify(fe.clip));
    assert.deepEqual(fe.page, { left: 32, top: 100, right: 333, bottom: 220 });
    const fc = paintedClip(model(32.5, 300.48), "content-box", 0, 0, translate(32.5, 100));
    assert.ok(fc.ok);
    assert.ok(Math.abs(fc.clip.x + 0) < 1e-9 && Math.abs(fc.clip.width - 300) < 1e-9, JSON.stringify(fc.clip));
    assert.equal(snapPixel(32.5), 33, "LayoutUnit::Round rounds a tie up");
    assert.equal(snapPixel(-0.5), 0);
    // Padding moves the content box off the border box: the origin that snaps is the BORDER box's.
    const padded: SvgBoxModel = { content: quadOf(box(42.6, 100, 300, 50), I), padding: quadOf(box(32.3, 100, 320.6, 50), I), border: quadOf(box(32.3, 100, 320.6, 50), I), scroll: [0, 0] };
    const pad = paintedClip(padded, "content-box", 0, 0, translate(42.6, 100));
    assert.ok(pad.ok);
    // content 42.6..342.6 snaps to 43..343; the painted origin moves by 32 - 32.3 = -0.3.
    assert.ok(Math.abs(pad.clip.x - (43 - 42.6 + 0.3)) < 1e-9 && Math.abs(pad.clip.x + pad.clip.width - (343 - 42.6 + 0.3)) < 1e-9, JSON.stringify(pad.clip));
    // A clip margin grows the rectangle before it snaps; zoom scales the margin into page px.
    const margin = paintedClip(model(32.25, 300), "content-box", 10, 0, [2, 0, 0, 2, 32.25, 100]);
    assert.ok(margin.ok);
    assert.deepEqual(margin.page, { left: 12, top: 80, right: 352, bottom: 240 });
    // The document scroll offset carries viewport quads into the snapping space.
    const scrolled = paintedClip({ ...model(32.3, 300.4), scroll: [0, 0.5] }, "content-box", 0, 0, translate(32.3, 100));
    assert.ok(scrolled.ok);
    assert.equal(scrolled.page.top, 101);
    // What the model does not cover declines.
    assert.deepEqual(paintedClip(model(32.3, 300.4), "content-box", 0, 0, multiply(translate(32.3, 100), rotate(5))), { ok: false, diagnostic: "pixel-snapping-unmodelled" });
    const { scroll: _scroll, ...noScroll } = model(32.3, 300.4);
    assert.deepEqual(paintedClip(noScroll, "content-box", 0, 0, translate(32.3, 100)), { ok: false, diagnostic: "oracle-unavailable" });
    // An edge off the LayoutUnit grid is known only to float32, and within that of a tie it cannot
    // be snapped; a margin within its resolution of the grid is put back on it and snaps exactly.
    assert.deepEqual(paintedClip(model(32.5000001, 300), "content-box", 0, 0, translate(32.5000001, 100)), { ok: false, diagnostic: "frame-imprecise" });
    const regridded = paintedClip(model(32, 300), "content-box", 0.4999, 0.0005, translate(32, 100));
    assert.ok(regridded.ok && regridded.page.left === 32 && regridded.page.right === 333, "0.4999 read as the LayoutUnit 0.5: 31.5 rounds up, 332.5 rounds up");
    assert.equal(paintOffsetUnmodelled({ transform: "none", rotate: "none", scale: "none", translate: "none", perspective: "none", offsetPath: "none" }), false);
    for (const over of [{ transform: "matrix(1, 0, 0, 1, 0.3, 0)" }, { translate: "0.3px" }, { willChange: "transform" }, { position: "sticky" }, { position: "fixed" }]) {
      assert.equal(paintOffsetUnmodelled({ transform: "none", rotate: "none", scale: "none", translate: "none", perspective: "none", offsetPath: "none", ...over }), true, JSON.stringify(over));
    }
    // An ancestor's clip, known by its content quad, holds the SVG's painted clip after snapping both.
    assert.equal(ancestorContains(quadOf(box(32, 90, 301.4, 200), I), [0, 0], fe.page), true, "333.4 snaps to 333");
    assert.equal(ancestorContains(quadOf(box(32, 90, 300.4, 200), I), [0, 0], fe.page), false, "332.4 snaps to 332");
    assert.equal(ancestorContains(quadOf(box(0, 0, 100, 50), rotate(30)), [0, 0], fe.page), false, "a rotated ancestor is not a rectangle here");
  });

  it("takes the worst overshoot over the whole clip chain", () => {
    const text = box(130, 60, 23, 10);
    assert.equal(overshootBeyond(text, [box(60, 55, 100, 60)]), -5, "the nearest edge is the top, 5 px away");
    assert.equal(overshootBeyond(text, [box(60, 55, 100, 60), box(0, 0, 150, 200)]), 3);
  });

  it("states an epsilon that covers the whole error budget", () => {
    // Frame residual at its tolerance, float32 quads 100 000 px down, a clip margin below 100 px,
    // arithmetic on both sides: inside the resolution. Stated, not fitted; this pins that they fit.
    assert.ok(SVG_FRAME_TOLERANCE_PX + 2 ** -8 + 5e-5 + 2 * SVG_FLOAT_NOISE_PX > SVG_OVERSHOOT_EPSILON_PX,
      "the worst case of every term at once does not fit — which is why the bound is computed per record");
    assert.ok(2 ** -8 + 5e-5 + 2 * SVG_FLOAT_NOISE_PX <= SVG_OVERSHOOT_EPSILON_PX);
    assert.ok(SVG_MODEL_TOLERANCE_PX >= 2 * (1 / 64) / 0.5, "two snapped fractional edges at zoom 0.5");
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
    assert.equal(snapshot.svg[0]!.viewportLocal?.oracleDeltaPx, 0);
    assert.equal(snapshot.svg[0]!.viewportLocal?.modelDeltaPx, 0);
    assert.ok(snapshot.svg[0]!.viewportLocal!.uncertaintyPx! + SVG_FLOAT_NOISE_PX <= SVG_OVERSHOOT_EPSILON_PX);
  });

  it("clips at the USED box: fractional padding under border-box is measured, not declined", () => {
    // A percentage-width SVG under Paged.js' border-box (an adversarial probe): computed width
    // 317.375px (the snapped border box), padding 1.3px 2.7px as specified. Layout snaps the padding
    // to 2.6875 and 1.296875, so the used content box is 312 x 89.09375 against a computed
    // 311.975 x 89.0875.
    // Rebuilt from computed values the clip is 0.025 px short and the first label, which the
    // browser draws in full, is reported — or the whole SVG is declined, exit 4, as 0.6.0 did.
    // Painted, the used content box 2.6875..314.6875 x 1.296875..90.390625 snaps to 3..315 x 1..90
    // with the border-box origin already on the pixel grid: the clip in the frame starts 0.3125 in.
    const localToScreen = translate(2.6875, 1.296875);
    const frame = outerFrame({ localToScreen, style: style({ boxSizing: "border-box", width: "317.375px", height: "91.6875px", ...padding(edges(1.3, 2.7)) }) });
    const used = box(0, 0, 312, 89.09375);
    const { labels, snapshot, coverage } = single(frame, [inside("used-edge-in", 271.99), inside("used-out", 275)], localToScreen,
      used, box(-2.6875, -1.296875, 317.375, 91.6875));
    assert.deepEqual(labels, ["used-out"]);
    assert.deepEqual([coverage?.candidates, coverage?.measured], [2, 2]);
    assert.deepEqual(snapshot.svg[0]!.viewportLocal?.clips, [box(0.3125, -0.296875, 312, 89)]);
    assert.deepEqual(snapshot.svg[0]!.viewportLocal?.viewport, used, "the viewport stays the used box; the clip is what is painted");
    assert.ok(Math.abs(snapshot.svg[0]!.viewportLocal!.modelDeltaPx! - 0.025) < 1e-9);
  });

  it("decides at the stated resolution: flush and exactly epsilon are clean, beyond it is reported", () => {
    // The left edge makes the arithmetic exact: overshoot = 0 − x.
    const localToScreen = translate(35, 35);
    const cases: [string, number, boolean][] = [
      ["flush", 0, false],
      ["half-epsilon", -SVG_OVERSHOOT_EPSILON_PX / 2, false],
      ["at-epsilon", -SVG_OVERSHOOT_EPSILON_PX, false],
      ["past-epsilon", -(SVG_OVERSHOOT_EPSILON_PX + 2 ** -10), true],
    ];
    for (const [id, x, reported] of cases) {
      const { labels, report } = single(outerFrame({ localToScreen }), [inside(id, x)], localToScreen, box(0, 0, 200, 80));
      assert.deepEqual(labels, reported ? [id] : [], id);
      const evaluation = report.evaluations.find((item) => item.ruleId === "svg/text-overflows-viewport" && item.status === "measured")!;
      assert.equal(evaluation.measurements[0]?.threshold, SVG_OVERSHOOT_EPSILON_PX, id);
      assert.equal(evaluation.measurements[0]?.value, 0 - x, id);
    }
  });

  it("declines a frame whose error bound does not fit the resolution", () => {
    // float32 quads 300 000 px down carry 1/64 px each: more than the whole epsilon.
    const far = translate(10, 300_000);
    const declined = assemble([rawSvg(0, outerFrame({ localToScreen: far }), [inside("t", 20)], far)], [modelOf(far, box(0, 0, 200, 80))]);
    assert.equal(declined.svg[0]!.viewportDiagnostic, "frame-imprecise");
    assert.equal(verdictOf(declined).exit, 4);
    // 100 000 px down the bound is 2^-8 + noise, and the record is measured.
    const near = translate(10, 100_000);
    const measured = single(outerFrame({ localToScreen: near }), [inside("in", 157), inside("out", 163)], near, box(0, 0, 200, 80));
    assert.deepEqual(measured.labels, ["out"]);
    assert.equal(measured.snapshot.svg[0]!.viewportLocal?.uncertaintyPx, 2 ** -8 + SVG_FLOAT_NOISE_PX);
    // 200 000 px down the bound is 2^-7 + noise: the frame still fits, but only a target with no
    // residual of its own fits beside it. One 0.004 px off — within SVG_FRAME_TOLERANCE_PX — does
    // not, and is unreadable rather than measured on a budget it has overdrawn.
    const deep = translate(10, 200_000);
    const deepRaw = rawSvg(0, outerFrame({ localToScreen: deep }), [inside("exact", 20), inside("residual", 60)], deep);
    deepRaw.texts[1]!.geometry.screenCtm = [...translate(10.004, 200_000)];
    const deepSnapshot = assemble([deepRaw], [modelOf(deep, box(0, 0, 200, 80))]);
    assert.equal(deepSnapshot.svg[0]!.viewportLocal?.uncertaintyPx, 2 ** -7 + SVG_FLOAT_NOISE_PX);
    assert.deepEqual(deepSnapshot.svg[0]!.texts.map((text) => text.svgTextKey.split(":").at(-1)), ["exact"]);
    assert.equal(deepSnapshot.svg[0]!.unreadableTargets, 1);
    // A projection that carries a larger bound is refused by the invariants.
    const edited = structuredClone(measured.snapshot);
    edited.svg[0]!.viewportLocal!.uncertaintyPx = 0.02;
    assert.ok(validateSnapshotInvariants(edited, { sourceMapInjection: true }).issues.some((issue) => issue.includes("error bound")));
  });

  it("declines a clipped SVG under a CSS transform: its painted clip snaps in a space the frame does not know", () => {
    // The browser snaps an SVG's clip and paint offset in the space of its nearest transform, not
    // in the document's, so the snapping model — and with it the half pixel this rule resolves
    // below — does not hold. Up to round two such an SVG was measured against its unsnapped clip.
    const localToScreen = multiply(translate(64.95, 29.8), rotate(15));
    const facts = { transform: "matrix(0.965926, 0.258819, -0.258819, 0.965926, 0, 0)", rotate: "none", scale: "none", translate: "none", perspective: "none", offsetPath: "none" };
    const rotated = assemble([rawSvg(0, outerFrame({ localToScreen, transforms: [facts] }), [inside("in", 157), inside("out", 163)], localToScreen)], [modelOf(localToScreen, box(0, 0, 200, 80))]);
    assert.equal(rotated.svg[0]!.viewportDiagnostic, "pixel-snapping-unmodelled");
    assert.equal(verdictOf(rotated).exit, 4);
    // A sub-pixel translate is not rotated at all, and still declines: its space is not the page's.
    const moved = translate(35.3, 35);
    const shifted = assemble([rawSvg(0, outerFrame({ localToScreen: moved, transforms: [{ ...facts, transform: "matrix(1, 0, 0, 1, 0.3, 0)" }] }), [inside("t", 20)], moved)], [modelOf(moved, box(0, 0, 200, 80))]);
    assert.equal(shifted.svg[0]!.viewportDiagnostic, "pixel-snapping-unmodelled");
    // Unclipped, nothing is snapped against: overflow visible under a transform stays exempt.
    const free = assemble([rawSvg(0, outerFrame({ localToScreen, transforms: [facts], style: style(visible) }), [inside("t", 900)], localToScreen)], [modelOf(localToScreen, box(0, 0, 200, 80))]);
    assert.equal(free.svg[0]!.clipped, false);
    assert.deepEqual(verdictOf(free).coverage?.notMeasured.map((entry) => entry.reason), ["env/svg-overflow-visible"]);
  });

  it("measures a label near a sub-pixel edge against the painted clip, in both directions", () => {
    // The verifier's snapedge figures, rebuilt: content 32.3 + 300.4 is painted to 333 from 32, so a
    // cell ending at local 300.44 (0.04 past the layout edge) is drawn — the old frame reported it;
    // content 32.5 + 300.48 is painted to 333 from 33, so a cell ending at 300.27 (0.21 inside the
    // layout edge) is cut — the old frame called it clean.
    const run = (x: number, width: number, label: TextSpec) => {
      const localToScreen = translate(x, 100);
      const frame = outerFrame({ localToScreen, style: style({ width: `${width}px`, height: "120px" }) });
      return single(frame, [label], localToScreen, box(0, 0, width, 120));
    };
    const drawn = run(32.3, 300.4, { id: "fe-in", bbox: box(250.4379, 30, 50, 14) });
    assert.deepEqual(drawn.labels, [], "0.04 past the layout edge, 0.56 inside the painted one");
    const cut = run(32.5, 300.48, { id: "fc-out", bbox: box(250.269, 30, 50, 14) });
    assert.deepEqual(cut.labels, ["fc-out"], "0.21 inside the layout edge, 0.27 past the painted one");
    assert.ok(Math.abs(cut.report.findings[0]!.measurement.value - 0.27) < 0.006);
  });

  it("declines what the snapping model and the DOM walk cannot see: a scrolled ancestor, a slotted SVG", () => {
    const localToScreen = translate(35, 35);
    const scrolled = assemble([rawSvg(0, outerFrame({ localToScreen, scrolled: true }), [inside("t", 20)], localToScreen)], [modelOf(localToScreen, box(0, 0, 200, 80))]);
    assert.equal(scrolled.svg[0]!.viewportDiagnostic, "scrolled-ancestor");
    // A slotted SVG is clipped by a shadow tree no walk visits — overflow visible or not.
    for (const over of [{}, visible]) {
      const slotted = assemble([rawSvg(0, outerFrame({ localToScreen, slotted: true, style: style(over) }), [inside("t", 20)], localToScreen)], [modelOf(localToScreen, box(0, 0, 200, 80))]);
      assert.deepEqual([slotted.svg[0]!.clipped, slotted.svg[0]!.viewportDiagnostic], [true, "shadow-tree"]);
      assert.equal(verdictOf(slotted).exit, 4);
    }
  });

  it("measures under ancestor zoom in unzoomed px", () => {
    const localToScreen = multiply(translate(36, 36), scale(2));
    const frame = outerFrame({ localToScreen, style: style({ ...padding(edges(5)), ...border(edges(3)) }) });
    const { labels, report } = single(frame, [inside("in", 157), inside("out", 163)], localToScreen, ...usedBoxes(box(0, 0, 200, 80), edges(5), edges(3)));
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

  it("measures `overflow-x: visible; overflow-y: hidden` as the clip on both axes it is", () => {
    // Computes to `auto hidden`; measured on Chromium 141: clipped at the content box on both axes.
    const localToScreen = translate(42, 42);
    const { labels, coverage, snapshot } = single(outerFrame({ localToScreen, style: style({ overflowX: "auto", overflowY: "hidden" }) }),
      [inside("x-in", 157), inside("x-out", 163)], localToScreen, box(0, 0, 200, 80));
    assert.deepEqual(labels, ["x-out"], "the x axis clips although overflow-x was written visible");
    assert.deepEqual([coverage?.candidates, coverage?.measured], [2, 2]);
    assert.equal(snapshot.svg[0]!.clipped, true);
  });

  describe("paint containment and clips from above", () => {
    const localToScreen = translate(42, 42);
    const texts = [inside("in", 157), inside("out", 163)];

    it("treats paint containment on the outermost SVG as its clip", () => {
      // An adversarial probe: overflow visible, contain paint, 570 ink pixels clipped, reported
      // clean as non-applicable. Paint containment clips like overflow, clip margin included.
      for (const over of [{ contain: "paint" }, { contain: "strict" }, { contain: "content" }, { contentVisibility: "auto" }]) {
        const { labels, snapshot, exit } = single(outerFrame({ localToScreen, style: style({ ...visible, ...over }) }), texts, localToScreen, box(0, 0, 200, 80));
        assert.deepEqual(labels, ["out"], JSON.stringify(over));
        assert.equal(exit, 1);
        assert.equal(snapshot.svg[0]!.clipped, true);
      }
      // contain: layout clips nothing: non-applicable, as before.
      const layout = single(outerFrame({ localToScreen, style: style({ ...visible, contain: "layout" }) }), texts, localToScreen, box(0, 0, 200, 80));
      assert.equal(layout.snapshot.svg[0]!.clipped, false);
      assert.deepEqual(layout.coverage?.notMeasured.map((entry) => entry.reason), ["env/svg-overflow-visible"]);
      // A containment serialisation this code does not know: clipped, and declined.
      const unknown = assemble([rawSvg(0, outerFrame({ localToScreen, style: style({ ...visible, contain: "paint future" }) }), texts, localToScreen)], [modelOf(localToScreen, box(0, 0, 200, 80))]);
      assert.deepEqual([unknown.svg[0]!.clipped, unknown.svg[0]!.viewportDiagnostic], [true, "containment-unrecognised"]);
      assert.equal(verdictOf(unknown).exit, 4);
    });

    it("declines a clip-path, mask or url() filter on the outermost SVG instead of calling it non-applicable", () => {
      for (const over of [{ clipPath: "inset(0px 50px 0px 0px)" }, { maskImage: "url(\"#m\")" }, { filter: "url(\"#f\")" }, { clip: "rect(0px, 100px, 50px, 0px)" }]) {
        for (const overflow of [visible, {}]) {
          const snapshot = assemble([rawSvg(0, outerFrame({ localToScreen, style: style({ ...overflow, ...over }) }), texts, localToScreen)], [modelOf(localToScreen, box(0, 0, 200, 80))]);
          assert.equal(snapshot.svg[0]!.clipped, true, JSON.stringify(over));
          assert.equal(snapshot.svg[0]!.viewportDiagnostic, "ancestor-clip");
          assert.deepEqual(validateSnapshotInvariants(snapshot, { sourceMapInjection: true }).issues, []);
          const { exit, coverage, report } = verdictOf(snapshot);
          assert.equal(exit, 4, "a clip the frame does not rebuild is never a clean exit");
          assert.deepEqual(coverage?.notMeasured.map((entry) => entry.reason), ["env/svg-viewport-geometry-unsupported"]);
          assert.deepEqual(report.findings, []);
        }
      }
    });

    it("sets aside an HTML ancestor clip only where it provably contains the SVG's own", () => {
      // The ancestor's content box on screen, which every clip of it contains.
      const roomy = quadOf(box(0, 0, 400, 300), I);
      const tight = quadOf(box(0, 0, 200, 100), I);
      const run = (frameOver: Partial<RawSvgFrame>, ancestors: (number[] | null)[] | undefined) =>
        assemble([rawSvg(0, outerFrame({ localToScreen, ...frameOver }), texts, localToScreen)], [modelOf(localToScreen, box(0, 0, 200, 80), undefined, undefined, 0, ancestors)]);
      const contained = run({ ancestors: [ancestor()] }, [roomy]);
      assert.equal(contained.svg[0]!.viewportDiagnostic, null);
      assert.deepEqual(verdictOf(contained).labels, ["out"]);
      // Flush: the SVG's clip IS the ancestor's content box (an SVG in an overflow: hidden wrapper).
      const flush = run({ ancestors: [ancestor()] }, [quadOf(box(0, 0, 200, 80), localToScreen)]);
      assert.equal(flush.svg[0]!.viewportDiagnostic, null, "touching the ancestor's edge is containment");
      assert.deepEqual(verdictOf(flush).labels, ["out"]);
      // Both clips are painted snapped: an ancestor content box ending at 241.6 snaps to 242 and still
      // holds the SVG's clip (242); one ending at 241.4 snaps to 241 and cuts a pixel off it.
      const rounded = run({ ancestors: [ancestor()] }, [quadOf(box(0, 0, 199.6, 80), localToScreen)]);
      assert.equal(rounded.svg[0]!.viewportDiagnostic, null);
      const crossing = run({ ancestors: [ancestor()] }, [quadOf(box(0, 0, 199.4, 80), localToScreen)]);
      assert.equal(crossing.svg[0]!.viewportDiagnostic, "ancestor-clip", "crossing it by a painted pixel is not containment");
      // The SVG's clip spans 42..242 on screen; the tight ancestor's content box ends at 200.
      const cases: [string, Partial<RawSvgFrame>, (number[] | null)[] | undefined][] = [
        ["cuts the SVG's clip", { ancestors: [ancestor()] }, [tight]],
        ["no quad", { ancestors: [ancestor()] }, [null]],
        ["no quads at all", { ancestors: [ancestor()] }, undefined],
        ["rounded", { ancestors: [ancestor({ radii: ["6px", "6px", "6px", "6px"] })] }, [roomy]],
        ["masked", { ancestors: [ancestor({ ...visible, maskImage: "url(\"#m\")" })] }, [roomy]],
        ["paint-contained above an unclipped SVG", { ancestors: [ancestor({ ...visible, contain: "paint" })], style: style(visible) }, [roomy]],
        ["overflow-clipped above an unclipped SVG", { ancestors: [ancestor({ up: 3 })], style: style(visible) }, [roomy]],
      ];
      for (const [name, frameOver, quads] of cases) {
        const snapshot = run(frameOver, quads);
        assert.equal(snapshot.svg[0]!.clipped, true, name);
        assert.equal(snapshot.svg[0]!.viewportDiagnostic, "ancestor-clip", name);
        assert.equal(verdictOf(snapshot).exit, 4, name);
      }
      // An ancestor that clips nothing (contain: layout) is nothing: overflow visible stays exempt.
      const inert = run({ ancestors: [ancestor({ ...visible, contain: "layout" })], style: style(visible) }, [null]);
      assert.equal(inert.svg[0]!.clipped, false);
      assert.deepEqual(verdictOf(inert).coverage?.notMeasured.map((entry) => entry.reason), ["env/svg-overflow-visible"]);
    });
  });

  describe("nested viewports", () => {
    // Outer 400 x 200 at (20, 20), viewBox the same size. Inner x=50 y=50 w=100 h=60 with
    // viewBox 0 0 50 30, so its user space is scaled 2 into the outer frame: getCTM() of a text in
    // it is translate(50, 50)·scale(2), and its client rect is the union of its CONTENT.
    const outerToScreen = translate(20, 20);
    const nestedTextCtm = multiply(translate(50, 50), scale(2));
    const nestedFrame = (over: Partial<RawSvgFrame> = {}): RawSvgFrame => ({
      kind: "nested", parentIndex: 0, anchorIndex: -1, anchorCtm: [...I], ctm: [...nestedTextCtm], screenCtm: [...multiply(outerToScreen, nestedTextCtm)],
      style: style(), transforms: [], ancestors: [], slotted: false, scrolled: false, lengths: [50, 50, 100, 60],
      computed: { x: "50px", y: "50px", width: "100px", height: "60px", transform: "none" }, attributes: { x: "50", y: "50", viewBox: "0 0 50 30" },
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
    // In the inner user space (scale 2): `n-in` ends at local 147, 3 px inside the inner right edge
    // (150); `n-out` ends at local 153, 3 px beyond it — and far inside the outer viewport.
    const pair = [
      { id: "n-in", bbox: box(5, 5, 43.5, 7), ctm: nestedTextCtm },
      { id: "n-out", bbox: box(40, 15, 11.5, 7), ctm: nestedTextCtm },
    ];

    it("clips a label at the nested viewport, not at the union of its content", () => {
      const { labels, exit, coverage, snapshot } = build(nestedFrame(), pair);
      assert.deepEqual(labels, ["n-out"]);
      assert.equal(exit, 1);
      assert.deepEqual([coverage?.candidates, coverage?.measured], [2, 2]);
      assert.deepEqual(snapshot.svg[1]!.viewportLocal?.clips, [box(50, 50, 100, 60), box(0, 0, 400, 200)]);
      assert.ok(overshootBeyond(snapshot.svg[1]!.texts.find((t) => t.svgTextKey.endsWith("n-out"))!.boxScreen, [snapshot.svg[1]!.viewportScreen]) <= 0,
        "against its client rect the clipped label is inside: the 0.6.0 false clean");
    });

    it("charges a clipping nested viewport's size serialisation to the frame's error bound", () => {
      // The computed width and height are six-digit serialisations: half a unit of the sixth
      // digit each, scaled into the frame. Charged where the nested viewport clips, not otherwise.
      const bound = (built: ReturnType<typeof build>, index: number) => built.snapshot.svg[index]!.viewportLocal?.uncertaintyPx ?? null;
      const clipping = build(nestedFrame(), pair);
      assert.ok(Math.abs(bound(clipping, 1)! - bound(clipping, 0)! - serialisationHalfUnit(100)) < 1e-12,
        `nested ${String(bound(clipping, 1))} against outer ${String(bound(clipping, 0))}`);
      const drawing = build(nestedFrame({ style: style(visible) }), pair);
      assert.equal(bound(drawing, 1), bound(drawing, 0));
      // Scaled 20 into the frame, the same half unit is 0.01 frame px: the budget is exceeded.
      const scaled = build(nestedFrame({ anchorCtm: [...scale(20)], screenCtm: [...multiply(outerToScreen, multiply(scale(20), nestedTextCtm))] }), pair);
      assert.deepEqual([scaled.snapshot.svg[1]!.measurable, scaled.snapshot.svg[1]!.viewportDiagnostic], [false, "frame-imprecise"]);
      assert.equal(scaled.exit, 4);
    });

    it("does not clip at a nested viewport with overflow auto, and does with scroll", () => {
      // Measured on Chromium 141 (svg-overflow-kinds.html): nested `auto` paints like `visible`.
      // Clipped like the root's `auto`, the drawn label would be reported.
      const auto = build(nestedFrame({ style: style({ overflowX: "auto", overflowY: "auto" }) }), pair);
      assert.deepEqual(auto.labels, [], "the nested `auto` label is drawn in full");
      assert.deepEqual(auto.snapshot.svg[1]!.viewportLocal?.clips, [box(0, 0, 400, 200)], "only the outer viewport clips");
      assert.deepEqual([auto.coverage?.candidates, auto.coverage?.measured], [2, 2]);
      const scroll = build(nestedFrame({ style: style({ overflowX: "scroll", overflowY: "scroll" }) }), pair);
      assert.deepEqual(scroll.labels, ["n-out"]);
      // Under an unclipped outer SVG a nested `auto` is not clipped at all: non-applicable.
      const free = build(nestedFrame({ style: style({ overflowX: "auto", overflowY: "auto" }) }), pair, style({ width: "400px", height: "200px", ...visible }));
      assert.equal(free.snapshot.svg[1]!.clipped, false);
      assert.deepEqual(free.coverage?.notMeasured.map((entry) => entry.reason), ["env/svg-overflow-visible"]);
      // Mixed axes on a nested SVG are declined, clipped.
      const mixed = build(nestedFrame({ style: style({ overflowX: "auto", overflowY: "hidden" }) }), pair);
      assert.deepEqual([mixed.snapshot.svg[1]!.clipped, mixed.snapshot.svg[1]!.viewportDiagnostic], [true, "overflow-axes-differ"]);
      assert.equal(mixed.exit, 4);
    });

    it("clips a nested label with overflow visible at the enclosing SVG", () => {
      // Inner overflow visible: its own viewport does not clip, the outer one (right edge 400) does.
      const ctm = multiply(translate(300, 50), scale(2));
      const nested = nestedFrame({ lengths: [300, 50, 100, 60], computed: { x: "300px", y: "50px", width: "100px", height: "60px", transform: "none" },
        attributes: { x: "300", y: "50", viewBox: "0 0 50 30" }, screenCtm: [...multiply(outerToScreen, ctm)], style: style(visible) });
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

  it("declines, counted against coverage, whatever the CDP quads do not confirm", () => {
    const localToScreen = translate(35, 35);
    const frame = outerFrame({ localToScreen, style: style({ ...padding(edges(10)), ...border(edges(5)) }) });
    const texts = [inside("in", 157), inside("out", 163)];
    const cases: [string, readonly (SvgBoxModel | null)[] | undefined][] = [
      ["oracle-unavailable", undefined],
      ["oracle-unavailable", [null]],
      ["oracle-disagreed", [modelOf(localToScreen, box(0, 0, 200, 80), box(-10, -10, 220, 100), box(-15, -15, 230, 110), 0.01)]],
      // The border box is not the content box: an inset taken from the wrong box is caught here.
      ["oracle-disagreed", [modelOf(localToScreen, box(-15, -15, 230, 110))]],
      // A content quad twice the computed size at the right corner: the frame is not in CSS px.
      ["box-model-disagreed", [modelOf(localToScreen, box(0, 0, 400, 160), box(-10, -10, 420, 180), box(-15, -15, 430, 190))]],
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
    // Agreement just inside the stated tolerance is agreement, and is charged to the error bound.
    const within = assemble([rawSvg(0, frame, texts, localToScreen)], [modelOf(localToScreen, box(0, 0, 200, 80), box(-10, -10, 220, 100), box(-15, -15, 230, 110), SVG_FRAME_TOLERANCE_PX / 2)]);
    assert.equal(within.svg[0]!.measurable, true);
    assert.ok(within.svg[0]!.viewportLocal!.uncertaintyPx! >= SVG_FRAME_TOLERANCE_PX / 2);
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
      const snapshot = assemble([rawSvg(0, outerFrame({ localToScreen, ...(over as Partial<RawSvgFrame>) }), [inside("t", 20)], localToScreen)],
        [modelOf(localToScreen, ...usedBoxes(box(0, 0, 200, 80), edges(2), edges(2)))]);
      assert.equal(snapshot.svg[0]!.viewportDiagnostic, diagnostic);
      assert.equal(verdictOf(snapshot).exit, 4, diagnostic);
    }
  });

  it("declines a record inside a foreignObject, and keeps overflow: visible non-applicable", () => {
    const localToScreen = translate(30, 30);
    const fo = assemble([rawSvg(0, outerFrame({ localToScreen, kind: "foreign-object" }), [inside("t", 20)], localToScreen, { oracleIndex: -1 })], [null]);
    assert.equal(fo.svg[0]!.viewportDiagnostic, "inside-foreign-object");
    assert.equal(verdictOf(fo).exit, 4);
    const unclipped = assemble([rawSvg(0, outerFrame({ localToScreen, style: style(visible) }), [inside("far", 900)], localToScreen)],
      [modelOf(localToScreen, box(0, 0, 200, 80))]);
    const { coverage } = verdictOf(unclipped);
    assert.equal(unclipped.svg[0]!.clipped, false);
    // Non-applicable, not declined: out of the coverage base, still named in notMeasured.
    assert.deepEqual([coverage?.candidates, coverage?.ok], [0, true]);
    assert.deepEqual(coverage?.notMeasured.map((entry) => entry.reason), ["env/svg-overflow-visible"]);
  });

  it("counts a target whose local matrix does not reach its own getScreenCTM() as unreadable", () => {
    const localToScreen = translate(35, 35);
    const frame = outerFrame({ localToScreen });
    const raw = rawSvg(0, frame, [inside("good", 20), inside("drift", 60), inside("drift-small", 100), inside("drift-tiny", 140)], localToScreen);
    // 0.01 px exceeds the whole resolution; 0.006 px fits beside the frame's bound but exceeds
    // SVG_FRAME_TOLERANCE_PX, which is the model's own tolerance and is checked on its own.
    raw.texts[1]!.geometry.screenCtm = [...translate(35.01, 35)];
    raw.texts[2]!.geometry.screenCtm = [...translate(35.006, 35)];
    // 0.004 px is within both, and is charged to the target: it stays measured.
    raw.texts[3]!.geometry.screenCtm = [...translate(35.004, 35)];
    const snapshot = assemble([raw], [modelOf(localToScreen, box(0, 0, 200, 80))]);
    assert.deepEqual(snapshot.svg[0]!.texts.map((text) => text.svgTextKey.split(":").at(-1)), ["good", "drift-tiny"]);
    assert.equal(snapshot.svg[0]!.unreadableTargets, 2);
    const { coverage, exit } = verdictOf(snapshot);
    assert.deepEqual(coverage?.notMeasured.map((entry) => entry.reason), ["env/svg-ctm-unavailable"]);
    assert.equal(exit, 4);
  });

  it("rejects a local box that is not exactly the envelope of its user box", () => {
    const localToScreen = translate(35, 35);
    const snapshot = assemble([rawSvg(0, outerFrame({ localToScreen }), [inside("t", 20.004)], localToScreen)], [modelOf(localToScreen, box(0, 0, 200, 80))]);
    assert.deepEqual(snapshot.svg[0]!.texts[0]!.boxLocal, box(20.004, 30, 40, 14), "stored unrounded");
    assert.deepEqual(snapshot.svg[0]!.texts[0]!.boxScreen, box(55, 65, 40, 14), "the screen box keeps the 0.01 px grid");
    const edited = structuredClone(snapshot);
    edited.svg[0]!.texts[0]!.boxLocal = box(20, 30, 40, 14);
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
      assert.ok("modelDeltaPx" in svg.viewportLocal && "uncertaintyPx" in svg.viewportLocal);
      for (const text of svg.texts) assert.ok(text.boxLocal && text.bboxUser && text.userToLocal.length === 6);
    }
    assert.deepEqual(validateSnapshotInvariants(demo.snapshot, { sourceMapInjection: true }).issues
      .filter((issue) => issue.startsWith(demo.snapshot.svg[0]!.nodeKey)), []);
  });

  it("names every viewport diagnostic the resolver can produce", () => {
    assert.equal(new Set(SVG_VIEWPORT_DIAGNOSTICS).size, SVG_VIEWPORT_DIAGNOSTICS.length);
    const source = readFileSync(new URL("../../src/measure/svg-viewport.ts", import.meta.url), "utf8");
    const produced = new Set([...source.matchAll(/(?:decline\(|diagnostic: )(?:clipped, |true, )?"([a-z-]+)"/gu)].map((match) => match[1]!));
    assert.ok(produced.size >= 20, `found only ${produced.size} diagnostics in the resolver`);
    for (const diagnostic of produced) assert.ok((SVG_VIEWPORT_DIAGNOSTICS as readonly string[]).includes(diagnostic), diagnostic);
  });
});

describe("the CDP walk to a clipping ancestor", () => {
  // html > body > div.clip (node 4) > div.wide (node 5) > svg (node 6): the page names the clipping
  // wrapper `up: 2`, and CDP has to reach the same element in its own tree — not the wide div one
  // step up, whose box would hold the SVG and set the wrapper's clip aside (the verifier's walk.html).
  const tree = { nodeId: 1, nodeType: 9, children: [{ nodeId: 2, nodeType: 1, children: [
    { nodeId: 3, nodeType: 1, children: [
      { nodeId: 4, nodeType: 1, children: [{ nodeId: 40, nodeType: 3 }, { nodeId: 5, nodeType: 1, children: [{ nodeId: 6, nodeType: 1 }] }] },
    ] },
  ] }] };
  const quads: Record<number, number[]> = {
    6: quadOf(box(32, 50, 400, 100), I),
    5: quadOf(box(32, 50, 450, 100), I),
    4: quadOf(box(32, 50, 200, 100), I),
  };

  it("walks the page's parent steps in the browser's tree", () => {
    const walked = cdpTree(tree);
    assert.equal(cdpAncestor(walked, 6, 0), 6);
    assert.equal(cdpAncestor(walked, 6, 1), 5);
    assert.equal(cdpAncestor(walked, 6, 2), 4);
    assert.equal(cdpAncestor(walked, 6, 3), 3);
    assert.equal(cdpAncestor(walked, 6, 5), null, "the document node is not an element");
    assert.equal(cdpAncestor(walked, 6, 9), null, "off the tree");
  });

  it("asks CDP for the named ancestor's content quad, and the document scroll", async () => {
    const sent: string[] = [];
    const session = {
      async send<R>(method: string, params?: Record<string, unknown>): Promise<R> {
        sent.push(method);
        if (method === "DOM.getDocument") return { root: tree } as R;
        if (method === "DOM.querySelectorAll") return { nodeIds: [6] } as R;
        if (method === "Page.getLayoutMetrics") return { cssLayoutViewport: { pageX: 0, pageY: 12 } } as R;
        if (method === "DOM.getBoxModel") {
          const quad = quads[Number(params?.["nodeId"])];
          if (!quad) throw new Error("no box");
          return { model: { content: quad, padding: quad, border: quad } } as R;
        }
        return {} as R;
      },
      async detach() {},
    };
    const page = { createCDPSession: async () => session } as unknown as Parameters<typeof svgBoxModels>[0];
    const localToScreen = translate(32, 50);
    const frame = outerFrame({ localToScreen, ancestors: [ancestor({ up: 2 })], style: style({ width: "400px", height: "100px" }) });
    const raw = { svg: [rawSvg(0, frame, [], localToScreen)], svgRendered: 1 } as unknown as Parameters<typeof svgBoxModels>[1];
    const [model] = await svgBoxModels(page, raw);
    assert.deepEqual(model?.ancestors, [quads[4]], "the wrapper two steps up, not its wide child");
    assert.deepEqual(model?.scroll, [0, 12]);
    assert.ok(sent.includes("Page.getLayoutMetrics"));
    // And that quad declines the SVG, where the wide child's would have set the clip aside.
    const snapshot = assemble([rawSvg(0, frame, [inside("t", 20)], localToScreen)], [{ ...model!, scroll: [0, 0] }]);
    assert.equal(snapshot.svg[0]!.viewportDiagnostic, "ancestor-clip");
    const wrong = assemble([rawSvg(0, frame, [inside("t", 20)], localToScreen)], [{ ...model!, ancestors: [quads[5]!], scroll: [0, 0] }]);
    assert.equal(wrong.svg[0]!.viewportDiagnostic, null);
  });
});
