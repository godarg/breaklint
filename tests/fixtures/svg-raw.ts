/**
 * Raw collector facts for SVG text targets, shaped like what the page ships on Chromium 141
 * (`src/measure/snapshot.ts`, per target `paint` and `label`), for tests that drive
 * `assembleSnapshot` without a browser.
 *
 * `rasterLabel` builds the facts of a SIMPLE label whose canvas raster covers a chosen ink box: one
 * text-node run, the computed style of an unstyled `<text>` in DejaVu Sans, the SVG positions of a
 * single run on one baseline, and a raster drawn through the linear part of the text's CTM whose
 * covered columns and rows are that ink box, at the magnification the page uses. The ink is given
 * in USER space; it defaults to the cell grown by the raster margin, so that the inner box the
 * bound derives from it is exactly the cell — tests written against cell geometry keep their
 * numbers, and a test about ink passes the ink it means.
 * `complexLabel` is a label the raster does not reproduce (a tspan child), bounded by its cell.
 */

import type { AffineMatrix, Box, Snapshot } from "../../src/core/types.ts";
import { assembleSnapshot, inputIdentity, type RawSnapshot, type RawSvg } from "../../src/measure/snapshot.ts";
import { apply, envelope, multiply } from "../../src/measure/svg-viewport.ts";
import {
  RASTER_EM_DEVICE_PX,
  ADVANCE_TOLERANCE_PX,
  LAYOUT_UNIT_DEVICE_PX,
  RASTER_MARGIN_CANVAS_PX,
  canvasSpecFor,
  unitsPerDevicePx,
  wordBoundaries,
  type LabelStyle,
  type RawPaintElement,
  type RawTextLabel,
  type RawTextPaint,
} from "../../src/measure/svg-ink.ts";

export const NEUTRAL_LABEL_STYLE: LabelStyle = {
  fontStyle: "normal", fontWeight: "400", fontStretch: "100%", fontSize: "14px", fontFamily: "\"DejaVu Sans\"",
  fontVariantCaps: "normal", fontVariantLigatures: "normal", fontVariantNumeric: "normal", fontVariantEastAsian: "normal",
  fontVariantAlternates: "normal", fontVariantPosition: "normal", fontVariantEmoji: "normal", fontFeatureSettings: "normal",
  fontVariationSettings: "normal", fontKerning: "auto", fontOpticalSizing: "auto", fontSizeAdjust: "none",
  fontSynthesisWeight: "auto", fontSynthesisStyle: "auto", fontSynthesisSmallCaps: "auto", fontPalette: "normal",
  letterSpacing: "normal", wordSpacing: "0px", textTransform: "none", textRendering: "auto", writingMode: "horizontal-tb",
  direction: "ltr", unicodeBidi: "normal", dominantBaseline: "auto", alignmentBaseline: "auto", baselineShift: "0px",
  whiteSpaceCollapse: "collapse", textAutospace: "no-autospace", textSpacingTrim: "normal", webkitLocale: "\"en\"",
  webkitTextStrokeWidth: "0px",
};

export function paintElement(over: Partial<RawPaintElement> = {}): RawPaintElement {
  return {
    tag: "text", fill: "rgb(0, 0, 0)", fillOpacity: "1", stroke: "none", strokeOpacity: "1", strokeWidth: "1px",
    strokeLinejoin: "miter", strokeMiterlimit: "4", strokeDasharray: "none", strokeLinecap: "butt", vectorEffect: "none",
    textShadow: "none", textDecorationLine: "none", clipPath: "none", mask: "none", maskImage: "none", filter: "none", fontSize: "14px",
    textLength: null, lengthAdjust: null,
    ...over,
  };
}

export function rawPaint(over: Partial<RawTextPaint> & { text?: Partial<RawPaintElement> } = {}): RawTextPaint {
  const { text, ...rest } = over;
  return { perGlyphRotate: false, elements: [paintElement(text)], ancestors: [], renderedText: "label", ...rest };
}

export interface RasterLabelOptions {
  /** The text's own getCTM(); the raster is drawn through its linear part. Default: identity. */
  ctm?: AffineMatrix;
  /** The glyph ink the raster covers, in USER space. Default: the cell grown by the raster margin. */
  ink?: Box;
  /** The baseline, in user space. Default: 80 % down the cell. */
  baseline?: number;
  style?: Partial<LabelStyle>;
  text?: string;
  /** SVG advance minus canvas advance, to model a font the canvas does not reproduce. */
  advanceDelta?: number;
  /** A spacingAndGlyphs textLength: the canvas's natural run is then 80 % of the cell's width. */
  textLength?: number;
  /** Canvas prefix width minus SVG position at a word boundary, by character index: a shaping split. */
  boundaryDrift?: Readonly<Record<number, number>>;
  /**
   * The text's user space → screen. Given, the default ink is grown by exactly the margin the bound
   * will take off again along the baseline, so the inner box is the cell to the last digit.
   */
  userToScreen?: AffineMatrix;
}

export function rasterLabel(cell: Box, options: RasterLabelOptions = {}): RawTextLabel {
  const style: LabelStyle = { ...NEUTRAL_LABEL_STYLE, ...options.style };
  const text = options.text ?? "label";
  const size = parseFloat(style.fontSize);
  const ctm = options.ctm ?? [1, 0, 0, 1, 0, 0];
  const baseline = options.baseline ?? cell.y + 0.8 * cell.height;
  const start: [number, number] = [cell.x, baseline];
  const advance = cell.width;
  const lengthAdjusted = options.textLength !== undefined;
  const natural = lengthAdjusted ? advance * 0.8 : advance - (options.advanceDelta ?? 0);
  const scaleX = lengthAdjusted ? advance / natural : 1;
  const [a, b, c, d] = ctm;
  const k = RASTER_EM_DEVICE_PX / (size * Math.max(Math.hypot(a * scaleX, b * scaleX), Math.hypot(c, d)));
  // The ink relative to the run's start, in the text's viewport space: what the page's raster sees.
  const relative = (box: Box): Box => envelope({ x: box.x - start[0], y: box.y - start[1], width: box.width, height: box.height }, [a, b, c, d, 0, 0]);
  const margin = RASTER_MARGIN_CANVAS_PX / k;
  // The placement margin the bound adds along the baseline (src/measure/svg-ink.ts): half the
  // LayoutUnit quantization of the longest stretch between word boundaries, plus the float
  // allowance, when the canvas and the SVG agree at every boundary. Mirrored here only to place the
  // default ink; the tests about that margin set the ink themselves.
  const quantum = options.userToScreen ? LAYOUT_UNIT_DEVICE_PX * unitsPerDevicePx(options.userToScreen) * Math.max(1, scaleX) : 0;
  const bounds = [0, ...wordBoundaries(text), text.length];
  const longest = Math.max(...bounds.slice(1).map((value, index) => value - bounds[index]!));
  const along = options.userToScreen ? (longest * quantum) / 2 + ADVANCE_TOLERANCE_PX : 0;
  const alongViewport = { x: Math.abs(a) * along, y: Math.abs(b) * along };
  const cellViewport = relative(cell);
  const inkViewport = options.ink
    ? relative(options.ink)
    : { x: cellViewport.x - margin - alongViewport.x, y: cellViewport.y - margin - alongViewport.y,
        width: cellViewport.width + 2 * (margin + alongViewport.x), height: cellViewport.height + 2 * (margin + alongViewport.y) };
  const originX = 20 - inkViewport.x * k;
  const originY = 20 - inkViewport.y * k;
  const ink: [number, number, number, number] = [
    inkViewport.x * k + originX, inkViewport.y * k + originY,
    (inkViewport.x + inkViewport.width) * k + originX, (inkViewport.y + inkViewport.height) * k + originY,
  ];
  // A style the canvas cannot carry gets no raster in the page; the neutral state stands in so the
  // Node-side check has something to refuse.
  const spec = canvasSpecFor(style) ?? canvasSpecFor(NEUTRAL_LABEL_STYLE)!;
  // Glyphs spread evenly along the run, the canvas agreeing with the SVG at every word boundary
  // unless a drift is asked for.
  const checkpoints = wordBoundaries(text);
  return {
    elementChildren: 0,
    textContent: text,
    attributes: {
      x: String(cell.x), y: String(baseline), dx: null, dy: null, rotate: null,
      textLength: lengthAdjusted ? String(options.textLength) : null,
      lengthAdjust: lengthAdjusted ? "spacingAndGlyphs" : null,
    },
    style,
    positions: {
      chars: text.length, start, end: [cell.x + advance, baseline], advance, rotation: 0,
      at: checkpoints.map((index): [number, number, number] => [index, start[0] + (advance * index) / text.length, baseline]),
    },
    raster: {
      text,
      spec,
      sentinel: "1px serif",
      applied: {
        font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, letterSpacing: spec.letterSpacing,
        wordSpacing: spec.wordSpacing, fontKerning: spec.fontKerning, fontStretch: spec.fontStretch, fontVariantCaps: spec.fontVariantCaps,
        textRendering: spec.textRendering, lang: spec.lang, direction: "ltr",
      },
      metrics: { width: natural, left: 1, right: natural, ascent: size, descent: size / 4 },
      prefixes: checkpoints.map((index) => (natural * index) / text.length + (options.boundaryDrift?.[index] ?? 0) / scaleX),
      linear: [a, b, c, d],
      scaleX,
      k,
      originX,
      originY,
      width: Math.ceil(ink[2] + 20),
      height: Math.ceil(ink[3] + 20),
      ink,
    },
  };
}

/** A label with a `<tspan>` child: not one run, so its ink is bounded by its cell. */
export function complexLabel(): RawTextLabel {
  return {
    elementChildren: 1,
    textContent: "label",
    attributes: { x: null, y: null, dx: null, dy: null, rotate: null, textLength: null, lengthAdjust: null },
    style: NEUTRAL_LABEL_STYLE,
    positions: null,
    raster: null,
  };
}

// ---------------------------------------------------------------------------------------------
// One outermost SVG through assembleSnapshot, its CDP oracle answered from its own geometry.


export interface RawTextSpec {
  id: string;
  /** getBBox() in user space. */
  bbox: Box;
  /** getCTM(); for an outermost SVG this maps straight into its frame. Default: identity. */
  ctm?: AffineMatrix;
  paint?: RawTextPaint;
  label?: RawTextLabel;
}

/**
 * A 200 × 80 content box at (35, 35) on the screen, `overflow: hidden`, holding the given texts;
 * every text defaults to a plain-painted raster label whose ink reaches its cell.
 */
export function assembleOneSvg(texts: readonly RawTextSpec[], over: { unsupportedTargets?: number; textTargetCount?: number } = {}): Snapshot {
  const localToScreen: AffineMatrix = [1, 0, 0, 1, 35, 35];
  const identity: AffineMatrix = [1, 0, 0, 1, 0, 0];
  const quad = (b: Box) => [[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]].flatMap(([x, y]) => apply(localToScreen, x!, y!));
  const content: Box = { x: 0, y: 0, width: 200, height: 80 };
  const svg: RawSvg = {
    nodeKey: "svg:0:0", page: 1, sourceIdentity: "figure", outerHtml: `<svg id="figure"></svg>`,
    measurable: true, reason: null, unreadableTargets: 0, unsupportedTargets: over.unsupportedTargets ?? 0, notRenderedTargets: 0,
    viewportScreen: { x: 35, y: 35, width: 200, height: 80 }, overflow: "hidden",
    textTargetCount: over.textTargetCount ?? texts.length, textTargetsCapped: false,
    texts: texts.map((text) => {
      const ctm = text.ctm ?? identity;
      return {
        sourceIdentity: text.id, sourceAddressKey: `bt-${text.id}`, signature: text.id, clipState: "none" as const,
        geometry: { bbox: [text.bbox.x, text.bbox.y, text.bbox.width, text.bbox.height], ctm: [...ctm], screenCtm: [...multiply(localToScreen, ctm)] },
        paint: text.paint ?? rawPaint(), label: text.label ?? rasterLabel(text.bbox, { ctm, userToScreen: multiply(localToScreen, ctm) }),
      };
    }),
    shapes: [], paths: [],
    geometry: {
      kind: "outer", parentIndex: -1, anchorIndex: -1, anchorCtm: null, ctm: [...identity], screenCtm: [...localToScreen],
      style: {
        width: "200px", height: "80px", boxSizing: "content-box",
        borderTopWidth: "0px", borderRightWidth: "0px", borderBottomWidth: "0px", borderLeftWidth: "0px",
        paddingTop: "0px", paddingRight: "0px", paddingBottom: "0px", paddingLeft: "0px",
        borderTopLeftRadius: "0px", borderTopRightRadius: "0px", borderBottomRightRadius: "0px", borderBottomLeftRadius: "0px",
        overflowX: "hidden", overflowY: "hidden", overflowClipMargin: "content-box",
        contain: "none", contentVisibility: "visible", clipPath: "none", maskImage: "none", mask: "none", filter: "none", clip: "auto",
      },
      transforms: [], ancestors: [], lengths: null, computed: null, attributes: null,
    },
    oracleIndex: 0,
    inkPasses: { E: { count: 0, maskHash: "" }, S: { count: 0, maskHash: "" }, F: { count: 0, maskHash: "" } },
    inkCollected: false, inkStable: false,
  };
  const raw: RawSnapshot = {
    pages: [{ pageNumber: 1, nodeKey: "page:1", epoch: 0, blank: false, isLast: true, contentBox: { x: 0, y: 0, width: 800, height: 1000 },
      pageBox: { x: 0, y: 0, width: 816, height: 1056 }, marginBoxes: [], fill: { vertical: 0.5, topGap: 0, net: 0.5, area: 0.2 }, notMeasured: [] }],
    blocks: [], textLines: [], svg: [svg], svgRendered: 1, requestedUrls: [], fontFamilies: [],
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
    svgBoxModels: [{ content: quad(content), padding: quad(content), border: quad(content) }],
  });
}
