/**
 * SVG viewport geometry, reconstructed in the SVG's own coordinate system.
 *
 * THE QUESTION. `svg/text-overflows-viewport` asks whether a `<text>` lies outside the rectangle
 * its SVG clips to. Up to 0.6.0 both sides of that comparison were screen rectangles: the text as
 * its four `getBBox()` corners through `getScreenCTM()`, the viewport as the SVG's
 * `getBoundingClientRect()`. That is only right while the border box IS the clip rectangle and no
 * CSS transform or zoom stands between the SVG and the screen, so every SVG with a border, a
 * padding, a clip margin or a rotated/zoomed ancestor was declined — and two cases that were not
 * declined got the wrong answer: a nested `<svg>`, whose client rect is the union of its CONTENT
 * (a clipped label can never overshoot it, measured 43.5 px clipped and reported clean), and a
 * keyword clip margin (`parseFloat("content-box 20px")` is NaN, read as 0, so text drawn inside the
 * margin was reported as not drawn).
 *
 * THE FRAME. Containment is decided in the OUTERMOST SVG's viewport coordinate system: CSS px,
 * origin at its content-box corner, before any CSS transform or zoom. The browser clips SVG content
 * in exactly this system and only afterwards applies the affine map to the screen, and containment
 * is invariant under an affine map — so ancestor rotation, the SVG's own transform and zoom stop
 * mattering. Everything this module computes is plain arithmetic over facts the page shipped as
 * numbers and computed-style strings, which is why every decision here can be tested without a
 * browser. What was measured on Chromium 141 to make these rules is written next to each rule.
 *
 * THE PROOF. The frame rests on `getScreenCTM()·getCTM()⁻¹` and the computed box values, all read
 * inside the page. The collector therefore compares the reconstructed content box, mapped to the
 * screen, with CDP `DOM.getBoxModel().content` — the browser's layout tree, read out of process — and
 * declines the SVG when they disagree. Nested viewports have no CDP counterpart (the box model of an
 * inner `<svg>` is its content's bounding box); they are reconstructed from the SVGAnimatedLength
 * values, checked against the computed style, and inherit the outermost SVG's proven frame.
 */

import type { AffineMatrix, Box, SvgViewportLocal } from "../core/types.ts";
import type { SvgViewportDiagnostic } from "../core/enums.ts";

/**
 * How far the reconstructed geometry may sit from its independent counterpart and still count as
 * the same geometry, in local-frame CSS px. Used for the CDP box-model oracle and for the check
 * that a text's local matrix, carried to the screen, is its `getScreenCTM()`.
 *
 * A stated number, chosen and not fitted, and sized from the inputs it compares. The reconstruction
 * reads computed lengths, and Chromium serialises those with six significant digits (measured on
 * 141: a used width of 1234.515625 px reads "1234.52px", 0.0044 off; 346.65625 reads "346.656px").
 * Half of SNAPSHOT_ROUNDING_PX covers that below 10 000 px and nothing coarser: every model error
 * observed while building this — a missed zoom, the wrong box for box-sizing, a foreignObject
 * offset, perspective — disagreed by 5 px or more. Agreement found on Chromium 141 over padding,
 * fractional border-box sizing, rotation and zoom of the SVG and its ancestors, and the SVGs of the
 * live fixtures and the public first-party corpus document: at most 3.75e-4 px, every time the
 * six-digit serialisation of a pt-sized width.
 *
 * Why half and not more: the rule reports a stored overshoot only above SNAPSHOT_ROUNDING_PX, which
 * on the 0.01 grid of stored boxes means at least 0.02, so the unrounded overshoot is at least 0.01;
 * a frame wrong by less than 0.005 still leaves the label past the edge. A finding therefore stays
 * a statement about a box the frame cannot have misplaced. The disagreement actually measured for a
 * record travels with it (`oracleDeltaPx`) as evidence.
 */
export const SVG_FRAME_TOLERANCE_PX = 0.005;

export const IDENTITY: AffineMatrix = [1, 0, 0, 1, 0, 0];

/** Computed-style strings of an SVG root that decide its content box and clip rectangle. */
export interface SvgBoxStyle {
  width: string;
  height: string;
  boxSizing: string;
  borderTopWidth: string;
  borderRightWidth: string;
  borderBottomWidth: string;
  borderLeftWidth: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  borderTopLeftRadius: string;
  borderTopRightRadius: string;
  borderBottomRightRadius: string;
  borderBottomLeftRadius: string;
  overflowX: string;
  overflowY: string;
  overflowClipMargin: string;
}

/** Computed transform-related properties of one element on the SVG's ancestor path. */
export interface SvgTransformFacts {
  transform: string;
  rotate: string;
  scale: string;
  translate: string;
  perspective: string;
  offsetPath: string;
}

/** What the page ships about one `<svg>` for its frame. */
export interface RawSvgFrame {
  /**
   * `outer`: no enclosing `<svg>`, a CSS box. `nested`: inside another `<svg>`.
   * `foreign-object`: an outermost SVG inside an enclosing SVG's `<foreignObject>`.
   */
  kind: "outer" | "nested" | "foreign-object";
  /** Index of the nearest enclosing `<svg>`'s record, or -1. The clip chain follows it. */
  parentIndex: number;
  /**
   * Nested only: the record whose frame map `anchorCtm` maps into; -1 when it maps straight into
   * the outermost frame (the parent element is the outermost `<svg>` itself); -2 when the page
   * found an anchor it could not number.
   */
  anchorIndex: number;
  /** Nested only: `getCTM()` of the nested SVG's parent element, whose user space holds x/y/w/h. */
  anchorCtm: number[] | null;
  /** `getCTM()` and `getScreenCTM()` of the SVG element itself. */
  ctm: number[] | null;
  screenCtm: number[] | null;
  style: SvgBoxStyle;
  /** Outer only: the SVG and every ancestor element whose transform facts are not all `none`. */
  transforms: SvgTransformFacts[];
  /** Nested only: x, y, width, height as SVGLength.value of the animated values. */
  lengths: number[] | null;
  /** Nested only: the computed x, y, width, height and transform. */
  computed: { x: string; y: string; width: string; height: string; transform: string } | null;
  /** Nested only: the x and y attributes as written, for percentages the computed style keeps. */
  attributes: { x: string | null; y: string | null } | null;
}

/** The raw facts behind one text target's box. */
export interface RawSvgTextFrame {
  bbox: number[];
  ctm: number[];
  screenCtm: number[];
}

export type Resolved<T> = ({ ok: true } & T) | { ok: false; diagnostic: SvgViewportDiagnostic };

// ---------------------------------------------------------------------------------------------
// Matrix and rectangle arithmetic

function matrix(values: readonly number[] | null | undefined): AffineMatrix | null {
  if (!values || values.length !== 6 || values.some((value) => !Number.isFinite(value))) return null;
  return [values[0]!, values[1]!, values[2]!, values[3]!, values[4]!, values[5]!];
}

export function multiply(left: AffineMatrix, right: AffineMatrix): AffineMatrix {
  const [a, b, c, d, e, f] = left;
  const [A, B, C, D, E, F] = right;
  return [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
}

export function invert(value: AffineMatrix): AffineMatrix | null {
  const [a, b, c, d, e, f] = value;
  const det = a * d - b * c;
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  if (!Number.isFinite(det) || scale === 0 || Math.abs(det) <= 1e-12 * scale * scale) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function apply(value: AffineMatrix, x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = value;
  return [a * x + c * y + e, b * x + d * y + f];
}

function corners(box: Box): [number, number][] {
  return [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x + box.width, box.y + box.height],
    [box.x, box.y + box.height],
  ];
}

/** The axis-aligned envelope of a rectangle's four corners through a matrix. All four: see the rule. */
export function envelope(box: Box, through: AffineMatrix): Box {
  const points = corners(box).map(([x, y]) => apply(through, x, y));
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Boxes enter the snapshot at 0.01 px, the resolution SNAPSHOT_ROUNDING_PX is defined by. */
export function roundedBox(box: Box): Box {
  return { x: round2(box.x), y: round2(box.y), width: round2(box.width), height: round2(box.height) };
}

/**
 * Whether a matrix maps axis-aligned rectangles onto axis-aligned rectangles: no rotation other
 * than quarter turns, no skew. Only then is a nested viewport a rectangle in the frame.
 */
export function axisAligned(value: AffineMatrix): boolean {
  const [a, b, c, d] = value;
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  if (scale === 0) return false;
  const tiny = 1e-9 * scale;
  return (Math.abs(b) <= tiny && Math.abs(c) <= tiny) || (Math.abs(a) <= tiny && Math.abs(d) <= tiny);
}

// ---------------------------------------------------------------------------------------------
// Computed-style parsing. Strict on purpose: a serialisation this code has not seen is a decline.

/** A computed `<length>` in px. Computed values are absolute, so any other unit is unexpected. */
export function cssPx(value: string | null | undefined): number | null {
  const match = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)px$/iu.exec((value ?? "").trim());
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) ? number : null;
}

export type VisualBox = "content-box" | "padding-box" | "border-box";

/**
 * `overflow-clip-margin: <visual-box> || <length [0,∞]>`, as Chromium 141 serialises the computed
 * value. Measured, clip edge against the painted pixels (padding 8, border 4):
 *
 *     content-box        -> "content-box"        clip at the content box (the UA default on svg)
 *     padding-box        -> "0px"                clip at the padding box
 *     padding-box 4px    -> "4px"                padding box + 4
 *     10px               -> "10px"               padding box + 10: the box defaults to padding-box
 *     content-box 10px   -> "content-box 10px"   content box + 10 (so does "10px content-box")
 *     border-box         -> "border-box"         border box
 *     border-box 5px     -> "border-box 5px"     border box + 5
 *     content-box 1.5em  -> "content-box 15px"   lengths arrive resolved
 *
 * The 0.6.0 collector read this with parseFloat, which is NaN for every keyword form: a clip
 * margin written as `content-box 20px` counted as none, and text the browser draws inside the
 * margin was reported as clipped.
 */
export function parseClipMargin(value: string): { box: VisualBox; margin: number } | null {
  const tokens = value.trim().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 2) return null;
  let box: VisualBox | null = null;
  let margin: number | null = null;
  for (const token of tokens) {
    if (token === "content-box" || token === "padding-box" || token === "border-box") {
      if (box !== null) return null;
      box = token;
      continue;
    }
    const length = cssPx(token);
    if (length === null || length < 0 || margin !== null) return null;
    margin = length;
  }
  return { box: box ?? "padding-box", margin: margin ?? 0 };
}

/** One computed corner radius, `<h> [<v>]`, each px or a percentage of the border box. */
export function parseCornerRadius(value: string, borderBoxWidth: number, borderBoxHeight: number): [number, number] | null {
  const tokens = value.trim().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 2) return null;
  const resolve = (token: string, reference: number): number | null => {
    const percent = /^(\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%$/iu.exec(token);
    if (percent) return (Number(token.slice(0, -1)) / 100) * reference;
    const length = cssPx(token);
    return length === null || length < 0 ? null : length;
  };
  const horizontal = resolve(tokens[0]!, borderBoxWidth);
  const vertical = resolve(tokens[1] ?? tokens[0]!, borderBoxHeight);
  return horizontal === null || vertical === null ? null : [horizontal, vertical];
}

/**
 * Overflow keywords that clip an SVG viewport. Measured on Chromium 141 for an SVG root: `auto` and
 * `scroll` clip exactly like `hidden` and `clip`, clip margin included, and show no scrollbar.
 */
const CLIPPING_OVERFLOW = new Set(["hidden", "clip", "auto", "scroll"]);

type OverflowState = { clips: boolean } | { diagnostic: SvgViewportDiagnostic };

/**
 * Both axes must agree. Measured on Chromium 141: `overflow-x: visible; overflow-y: clip` does not
 * clip x and clips y at the PADDING box rather than the content box, and `visible` with `hidden`
 * computes to `auto hidden` and clips both. A per-axis model would be built on two observations; a
 * decline is built on none.
 */
export function overflowState(overflowX: string, overflowY: string): OverflowState {
  if (overflowX === "visible" && overflowY === "visible") return { clips: false };
  if (overflowX !== overflowY) return { diagnostic: "overflow-axes-differ" };
  if (!CLIPPING_OVERFLOW.has(overflowX)) return { diagnostic: "overflow-unrecognised" };
  return { clips: true };
}

/** Whether anything about this record might clip. Conservative: an unknown state counts as clipping. */
export function overflowClips(overflowX: string, overflowY: string): boolean {
  return !(overflowX === "visible" && overflowY === "visible");
}

/**
 * A 3D transform, perspective or motion path on the SVG or an ancestor. Containment in the frame
 * would still hold, but `getScreenCTM()` is 2D, so the screen evidence could not be trusted. These
 * stay declines by name, and the CDP oracle catches what the list misses (perspective measured at
 * 1.1e4 px of disagreement on Chromium 141).
 */
export function threeDimensional(facts: SvgTransformFacts): boolean {
  const none = (value: string): boolean => value === "none" || value === "";
  if (facts.transform.startsWith("matrix3d(")) return true;
  if (!none(facts.perspective) || !none(facts.offsetPath)) return true;
  const topLevelTokens = (value: string): number => {
    let depth = 0;
    let count = 0;
    let inToken = false;
    for (const character of value.trim()) {
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      if (/\s/u.test(character) && depth === 0) { inToken = false; continue; }
      if (!inToken) { count += 1; inToken = true; }
    }
    return count;
  };
  // 2D forms only: a single angle for `rotate` (an axis makes it 3D), at most two values for
  // `scale` and `translate` (a third is z).
  if (!none(facts.rotate) && !/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:deg|rad|grad|turn)$/iu.test(facts.rotate.trim())) return true;
  if (!none(facts.scale) && topLevelTokens(facts.scale) > 2) return true;
  if (!none(facts.translate) && topLevelTokens(facts.translate) > 2) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------
// Rectangles

/**
 * The content box and clip rectangle of an outermost SVG, in its frame.
 *
 * Computed values are the source, never `getBoundingClientRect()`: they are unzoomed while the
 * client rect is zoomed (measured, ancestor `zoom: 2`: client rect 420 x 140 for 200 + 2·5), so
 * insetting the client rect by computed padding would be wrong exactly where zoom is present.
 * Computed border widths arrive device-snapped (3.25px reads 3px) and so does the layout that uses
 * them; padding stays fractional. Under `box-sizing: border-box` the computed width is the border
 * box (230.5 for 200 + 2·12.25 + 2·3), so border and padding come off it; under `content-box` it
 * is the content box. `clientWidth` is integer-rounded and is not used.
 */
export interface OuterViewportGeometry {
  content: Box;
  padding: Box;
  border: Box;
  clip: Box | null;
  /** The box the clip is grown from, and the one the oracle must therefore also confirm. */
  reference: VisualBox | null;
}

export function outerViewportGeometry(style: SvgBoxStyle): Resolved<OuterViewportGeometry> {
  const width = cssPx(style.width);
  const height = cssPx(style.height);
  const [bt, br, bb, bl] = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].map(cssPx);
  const [pt, pr, pb, pl] = [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(cssPx);
  const lengths = [width, height, bt, br, bb, bl, pt, pr, pb, pl];
  if (lengths.some((value) => value === null || value === undefined || value < 0)) return { ok: false, diagnostic: "box-unreadable" };
  const [w, h, top, right, bottom, left, padTop, padRight, padBottom, padLeft] = lengths as number[];
  let contentWidth: number;
  let contentHeight: number;
  if (style.boxSizing === "content-box") {
    contentWidth = w!;
    contentHeight = h!;
  } else if (style.boxSizing === "border-box") {
    contentWidth = w! - left! - right! - padLeft! - padRight!;
    contentHeight = h! - top! - bottom! - padTop! - padBottom!;
  } else {
    return { ok: false, diagnostic: "box-unreadable" };
  }
  if (contentWidth < 0 || contentHeight < 0) return { ok: false, diagnostic: "box-unreadable" };
  const content: Box = { x: 0, y: 0, width: contentWidth, height: contentHeight };
  // 0 - p rather than -p: a zero padding must give +0, not -0, or the boxes stop comparing equal.
  const padding: Box = { x: 0 - padLeft!, y: 0 - padTop!, width: contentWidth + padLeft! + padRight!, height: contentHeight + padTop! + padBottom! };
  const borderBox: Box = { x: padding.x - left!, y: padding.y - top!, width: padding.width + left! + right!, height: padding.height + top! + bottom! };

  const overflow = overflowState(style.overflowX, style.overflowY);
  if ("diagnostic" in overflow) return { ok: false, diagnostic: overflow.diagnostic };
  if (!overflow.clips) return { ok: true, content, padding, border: borderBox, clip: null, reference: null };

  const clipMargin = parseClipMargin(style.overflowClipMargin);
  if (!clipMargin) return { ok: false, diagnostic: "clip-margin-unrecognised" };

  // Rounded clipping. The clip follows the reference box's corner curve, which for the content box
  // is the outer radius less border and padding on each axis (CSS Backgrounds §5.2); a corner is
  // square as soon as either of its radii is zero. Measured: radius 12 over border 4 + padding 8
  // clips exactly at the content rectangle. A clip margin grows the curve with the rectangle, so a
  // radius together with any margin is not modelled at all.
  const borderBoxWidth = borderBox.width;
  const borderBoxHeight = borderBox.height;
  const radii = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius]
    .map((value) => parseCornerRadius(value, borderBoxWidth, borderBoxHeight));
  if (radii.some((value) => value === null)) return { ok: false, diagnostic: "box-unreadable" };
  const insetX = [left! + padLeft!, right! + padRight!, right! + padRight!, left! + padLeft!];
  const insetY = [top! + padTop!, top! + padTop!, bottom! + padBottom!, bottom! + padBottom!];
  const epsilon = 1e-6;
  const anyRadius = radii.some((value) => value![0] > epsilon && value![1] > epsilon);
  const plainContentClip = clipMargin.box === "content-box" && clipMargin.margin === 0;
  if (anyRadius && !plainContentClip) return { ok: false, diagnostic: "radius-with-clip-margin" };
  const rounded = radii.some((value, corner) => value![0] - insetX[corner]! > epsilon && value![1] - insetY[corner]! > epsilon);
  if (rounded) return { ok: false, diagnostic: "rounded-clip" };

  const reference = clipMargin.box === "content-box" ? content : clipMargin.box === "padding-box" ? padding : borderBox;
  const m = clipMargin.margin;
  return {
    ok: true, content, padding, border: borderBox, reference: clipMargin.box,
    clip: { x: reference.x - m, y: reference.y - m, width: reference.width + 2 * m, height: reference.height + 2 * m },
  };
}

/**
 * The viewport and clip rectangle of a nested `<svg>`, in the frame.
 *
 * x/y/width/height come from SVGLength.value of the animated lengths, which resolves percentages
 * against the enclosing viewport. They are believed only where the computed style says the same:
 * measured on Chromium 141, a CSS `width` overrides the attribute for the clip while a CSS `x` is
 * ignored, so an author rule on either leaves the attribute values describing a viewport that is
 * not there. The computed width/height arrive resolved to px; x/y keep a percentage as written,
 * which is then compared with the attribute text.
 *
 * A transform on the nested SVG moves the viewport off the rectangle x/y/width/height describe in
 * the parent's user space, and a clip margin on it was measured to be ignored — neither is
 * modelled; both decline.
 */
export function nestedViewportGeometry(raw: RawSvgFrame, toOuter: AffineMatrix): Resolved<{ viewport: Box; clip: Box | null }> {
  const computed = raw.computed;
  const lengths = raw.lengths;
  if (!computed || computed.transform !== "none") return { ok: false, diagnostic: "nested-transform" };
  if (!lengths || lengths.length !== 4 || lengths.some((value) => !Number.isFinite(value)) || lengths[2]! < 0 || lengths[3]! < 0) {
    return { ok: false, diagnostic: "nested-lengths-disagree" };
  }
  const [x, y, width, height] = lengths as [number, number, number, number];
  const same = (css: string, value: number): boolean => {
    const px = cssPx(css);
    return px !== null && Math.abs(px - value) <= 1e-6 * Math.max(1, Math.abs(value));
  };
  const position = (css: string, attribute: string | null | undefined, value: number): boolean =>
    same(css, value) || (/%$/u.test(css) && (attribute ?? "").trim() === css);
  if (!same(computed.width, width) || !same(computed.height, height) ||
      !position(computed.x, raw.attributes?.x, x) || !position(computed.y, raw.attributes?.y, y)) {
    return { ok: false, diagnostic: "nested-lengths-disagree" };
  }
  const overflow = overflowState(raw.style.overflowX, raw.style.overflowY);
  if ("diagnostic" in overflow) return { ok: false, diagnostic: overflow.diagnostic };
  if (raw.style.overflowClipMargin !== "content-box") return { ok: false, diagnostic: "nested-clip-margin" };
  if (!axisAligned(toOuter)) return { ok: false, diagnostic: "nested-viewport-rotated" };
  const viewport = envelope({ x, y, width, height }, toOuter);
  return { ok: true, viewport, clip: overflow.clips ? viewport : null };
}

/** CDP `DOM.getBoxModel()` quads of an outermost `<svg>`, four corners each. */
export interface SvgBoxModel {
  content: readonly number[];
  padding: readonly number[];
  border: readonly number[];
}

/**
 * The largest distance, in frame px, between a reconstructed box's corners and a CDP quad carried
 * back into the frame. CDP lists a quad's corners in the box's own order (top-left, top-right,
 * bottom-right, bottom-left, each transformed), so corresponding corners are compared, not
 * envelopes. null when the map to the screen cannot be inverted or the quad is malformed.
 */
export function quadDelta(box: Box, localToScreen: AffineMatrix, quad: readonly number[]): number | null {
  if (quad.length !== 8 || quad.some((value) => !Number.isFinite(value))) return null;
  const back = invert(localToScreen);
  if (!back) return null;
  let delta = 0;
  corners(box).forEach(([x, y], index) => {
    const [qx, qy] = apply(back, quad[2 * index]!, quad[2 * index + 1]!);
    delta = Math.max(delta, Math.abs(qx - x), Math.abs(qy - y));
  });
  return delta;
}

/**
 * The oracle for one outermost SVG: its content box, and — where the clip is grown from the padding
 * or border box — that box too, against CDP's quads of the same boxes. The reference box is checked
 * because it is built from computed padding and border, and computed padding is the specified
 * length, not the used one (measured: 3.333333px reads "3.33333px" while layout uses 3.328125). A
 * clip that rests on a box CDP does not confirm is not proven.
 */
export function oracleDelta(geometry: OuterViewportGeometry, localToScreen: AffineMatrix, model: SvgBoxModel): number | null {
  const checks: [Box, readonly number[]][] = [[geometry.content, model.content]];
  if (geometry.reference === "padding-box") checks.push([geometry.padding, model.padding]);
  if (geometry.reference === "border-box") checks.push([geometry.border, model.border]);
  let delta = 0;
  for (const [box, quad] of checks) {
    const one = quadDelta(box, localToScreen, quad);
    if (one === null) return null;
    delta = Math.max(delta, one);
  }
  return delta;
}

// ---------------------------------------------------------------------------------------------
// Records

export interface ResolvedSvgFrame {
  clipped: boolean;
  /** With `toOuter`: this record's viewport space (where its targets' getCTM lands) → the frame. */
  frame: (SvgViewportLocal & { toOuter: AffineMatrix }) | null;
  diagnostic: SvgViewportDiagnostic | null;
}

/**
 * Resolve every record's frame, in document order, so that an enclosing SVG is resolved before the
 * SVGs it contains. `boxModels[i]` is CDP's box model for record `i` (outermost records only); an
 * absent box model is an absent proof, and the record declines.
 */
export function resolveSvgFrames(
  raws: readonly RawSvgFrame[],
  boxModels: readonly (SvgBoxModel | null)[] | undefined,
): ResolvedSvgFrame[] {
  const out: ResolvedSvgFrame[] = [];
  const decline = (clipped: boolean, diagnostic: SvgViewportDiagnostic): ResolvedSvgFrame => ({ clipped, frame: null, diagnostic });
  raws.forEach((raw, index) => {
    const parent = raw.parentIndex >= 0 && raw.parentIndex < index ? out[raw.parentIndex] : undefined;
    const ownClips = overflowClips(raw.style.overflowX, raw.style.overflowY);
    if (raw.kind === "foreign-object") {
      // The foreignObject and every enclosing SVG clip this SVG too, and Chromium 141 places its
      // getScreenCTM() 20 px away from CDP's content box when it is a direct child of the
      // foreignObject. Conservative on both counts: applicable, and declined.
      out.push(decline(true, "inside-foreign-object"));
      return;
    }
    if (raw.kind === "nested") {
      const clipped = ownClips || !!parent?.clipped;
      if (!parent?.frame) { out.push(decline(clipped, "enclosing-viewport-unsupported")); return; }
      // -1: the parent element is the outermost <svg> itself, whose getCTM() lands in the frame.
      // Any other negative index is an anchor the page could not number, and no frame at all.
      const anchor = raw.anchorIndex === -1 ? IDENTITY
        : raw.anchorIndex >= 0 && raw.anchorIndex < index ? out[raw.anchorIndex]?.frame?.toOuter : undefined;
      if (!anchor) { out.push(decline(clipped, "enclosing-viewport-unsupported")); return; }
      const anchorCtm = matrix(raw.anchorCtm);
      if (!anchorCtm) { out.push(decline(clipped, "matrix-unavailable")); return; }
      const toOuter = multiply(anchor, anchorCtm);
      const nested = nestedViewportGeometry(raw, toOuter);
      if (!nested.ok) { out.push(decline(clipped, nested.diagnostic)); return; }
      out.push({
        clipped,
        diagnostic: null,
        frame: {
          toOuter,
          viewport: nested.viewport,
          clips: [...(nested.clip ? [nested.clip] : []), ...parent.frame.clips],
          localToScreen: parent.frame.localToScreen,
          oracleDeltaPx: parent.frame.oracleDeltaPx,
        },
      });
      return;
    }
    const clipped = ownClips;
    if (raw.transforms.some(threeDimensional)) { out.push(decline(clipped, "three-dimensional-transform")); return; }
    const ctm = matrix(raw.ctm);
    const screenCtm = matrix(raw.screenCtm);
    const ctmInverse = ctm ? invert(ctm) : null;
    if (!screenCtm || !ctmInverse) { out.push(decline(clipped, "matrix-unavailable")); return; }
    const localToScreen = multiply(screenCtm, ctmInverse);
    if (!invert(localToScreen)) { out.push(decline(clipped, "matrix-unavailable")); return; }
    const geometry = outerViewportGeometry(raw.style);
    if (!geometry.ok) { out.push(decline(clipped, geometry.diagnostic)); return; }
    const model = boxModels?.[index] ?? null;
    if (!model) { out.push(decline(clipped, "oracle-unavailable")); return; }
    const delta = oracleDelta(geometry, localToScreen, model);
    if (delta === null || delta > SVG_FRAME_TOLERANCE_PX) { out.push(decline(clipped, "oracle-disagreed")); return; }
    out.push({
      clipped,
      diagnostic: null,
      frame: { toOuter: IDENTITY, viewport: geometry.content, clips: geometry.clip ? [geometry.clip] : [], localToScreen, oracleDeltaPx: delta },
    });
  });
  return out;
}

/**
 * One target's boxes. The local matrix is the record's frame map times the text's own `getCTM()`;
 * carried to the screen it must be the text's `getScreenCTM()`. That identity is what ties the text
 * to the frame the oracle proved, and a target for which it fails is a target this build cannot
 * place — null, and the caller counts it as unreadable rather than guessing a frame for it.
 */
export function resolveSvgText(
  frame: NonNullable<ResolvedSvgFrame["frame"]>,
  raw: RawSvgTextFrame,
): { boxScreen: Box; boxLocal: Box; bboxUser: Box; userToLocal: AffineMatrix } | null {
  const ctm = matrix(raw.ctm);
  const screenCtm = matrix(raw.screenCtm);
  if (!ctm || !screenCtm || raw.bbox.length !== 4 || raw.bbox.some((value) => !Number.isFinite(value))) return null;
  const bboxUser: Box = { x: raw.bbox[0]!, y: raw.bbox[1]!, width: raw.bbox[2]!, height: raw.bbox[3]! };
  if (bboxUser.width < 0 || bboxUser.height < 0) return null;
  const userToLocal = multiply(frame.toOuter, ctm);
  const back = invert(frame.localToScreen);
  if (!back) return null;
  for (const [x, y] of corners(bboxUser)) {
    const [lx, ly] = apply(userToLocal, x, y);
    const [sx, sy] = apply(screenCtm, x, y);
    const [bx, by] = apply(back, sx, sy);
    if (Math.abs(bx - lx) > SVG_FRAME_TOLERANCE_PX || Math.abs(by - ly) > SVG_FRAME_TOLERANCE_PX) return null;
  }
  return {
    boxScreen: roundedBox(envelope(bboxUser, screenCtm)),
    boxLocal: roundedBox(envelope(bboxUser, userToLocal)),
    bboxUser,
    userToLocal,
  };
}

/**
 * The overshoot of a local box beyond a set of clip rectangles: how far it reaches past the edge
 * of whichever clip it leaves furthest, in frame px. Negative when it is inside all of them. Text
 * is drawn in full only inside every clip of its chain, so the maximum is the exact statement.
 */
export function overshootBeyond(box: Box, clips: readonly Box[]): number {
  let worst = -Infinity;
  for (const clip of clips) {
    worst = Math.max(
      worst,
      clip.x - box.x,
      clip.y - box.y,
      box.x + box.width - (clip.x + clip.width),
      box.y + box.height - (clip.y + clip.height),
    );
  }
  return worst;
}
