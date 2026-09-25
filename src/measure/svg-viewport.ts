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
 * THE BOXES. The frame map is `getScreenCTM()·getCTM()⁻¹`, read inside the page. The boxes the
 * clip is built from are NOT: they are CDP `DOM.getBoxModel()` quads — the browser's layout tree,
 * read out of process — carried back through that map. Layout snaps boxes to 1/64 px and computed
 * style does not (a padding of 2.7px lays out as 2.6875), so a clip rebuilt from computed values is
 * off by up to a LayoutUnit per edge, which is more than this rule resolves; the quads are the used
 * geometry itself. The computed values are still read and compared, as a units check: a frame whose
 * content box is not the computed one within SVG_MODEL_TOLERANCE_PX is not the frame this module
 * thinks it is. Nested viewports have no CDP counterpart (the box model of an inner `<svg>` is its
 * content's bounding box); they are reconstructed from the SVGAnimatedLength values the browser
 * lays them out with, checked against the computed style, and inherit the outermost SVG's frame.
 *
 * THE RESOLUTION. Every frame carries a bound on how far its clip edges can sit from the browser's
 * (`uncertaintyPx`), and a frame whose bound does not fit inside SVG_OVERSHOOT_EPSILON_PX is
 * declined. The rule reports an overshoot only above that epsilon, so a finding is a statement the
 * frame's error cannot have produced. See SVG_OVERSHOOT_EPSILON_PX for the budget.
 */

import type { AffineMatrix, Box, SvgViewportLocal } from "../core/types.ts";
import type { SvgViewportDiagnostic } from "../core/enums.ts";

/**
 * Double arithmetic over the frame, stated as one number and added once on each side of a
 * comparison. The inputs are doubles (CTMs, SVGLength values) and float32 values that are the
 * browser's own geometry rather than a rounding of it (`getBBox()` is the union of the glyph cells
 * the browser computed in float); what remains is the error of a handful of multiplications, below
 * 1e-9 px for any coordinate a page reaches. 0.001 is chosen, not fitted, and is six orders above it.
 */
export const SVG_FLOAT_NOISE_PX = 0.001;

/**
 * How far two independent statements about the same frame may disagree and still be taken for the
 * same frame, in frame px: CDP's quads carried back through `getScreenCTM()·getCTM()⁻¹` against the
 * frame's definition (content corner at the origin, a rectangle), and a text's local matrix carried
 * to the screen against its own `getScreenCTM()`. Beyond it the model is wrong, not imprecise: every
 * model error seen while building this — a missed zoom, the wrong box, a foreignObject offset,
 * perspective — disagreed by 5 px or more, and agreement on Chromium 141 over padding, fractional
 * border-box sizing, rotation and zoom of the SVG and its ancestors was within the float32
 * quantisation of the quads. Whatever disagreement is admitted is charged to the frame's error bound.
 */
export const SVG_FRAME_TOLERANCE_PX = 0.005;

/**
 * How far the computed-style content box may sit from the laid-out one. A units check, not a
 * precision one: it proves the frame is in CSS px of this SVG (a device-pixel quad or a doubled zoom
 * would be off by the whole box), and the decision never uses the computed box. The gap it has to
 * admit is layout snapping: each of two fractional paddings or borders snaps to 1/64 px in the zoomed
 * box — measured, border-box width 317.389px with padding 2.7px lays out a content box of 312 against
 * a computed 311.975 — which is 1/32 px unzoomed at zoom 0.5, plus six-digit serialisation.
 */
export const SVG_MODEL_TOLERANCE_PX = 0.1;

/**
 * The resolution of `svg/text-overflows-viewport`, in frame px: an overshoot is reported only when it
 * exceeds the permitted overshoot by more than this. It is the error budget of one comparison, and a
 * frame that does not fit it is declined, never measured with a larger epsilon:
 *
 *   clip side   frame residual against CDP        ≤ SVG_FRAME_TOLERANCE_PX (0.005)
 *               float32 quantisation of the quads  ≤ computed per record; 0.0039 at 100 000 px
 *               clip-margin serialisation          ≤ half the sixth significant digit (5e-5 at 10 px)
 *               arithmetic                         SVG_FLOAT_NOISE_PX
 *   text side   local matrix against screen CTM    the text's own residual, charged per target
 *               arithmetic                         SVG_FLOAT_NOISE_PX
 *
 * What that means for the verdict, with measured overshoot o, true overshoot t and permitted p: the
 * two differ by less than this epsilon, so `o > p + epsilon` implies `t > p` — no finding is an
 * artefact of the frame — and `t > p + 2·epsilon` implies a finding. Between p and p + 0.02 px a
 * clipped label can be reported clean. That band is the stated resolution of the rule, not a
 * tolerance of the author's layout: 0.02 px is 1/50 of a CSS pixel of the glyph cell, below what
 * anti-aliasing draws. A flush label — ending exactly on the edge, as textLength against the full
 * viewBox width constructs — measures 0 and is clean, as it must be.
 */
export const SVG_OVERSHOOT_EPSILON_PX = 0.01;

export const IDENTITY: AffineMatrix = [1, 0, 0, 1, 0, 0];

/** Computed-style strings of an SVG that decide its content box, its clip and what else clips it. */
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
  contain: string;
  contentVisibility: string;
  clipPath: string;
  maskImage: string;
  mask: string;
  filter: string;
  clip: string;
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

/**
 * An HTML ancestor of an outermost SVG, inside the page area, that may clip what the SVG draws:
 * one whose overflow, containment, clip-path, mask, url() filter or legacy `clip` is not the
 * initial value. Shipped only for those; every other ancestor clips nothing.
 */
export interface SvgAncestorFacts {
  /** Parent steps from the `<svg>` to this element: 1 is its parent. CDP walks the same path. */
  up: number;
  overflowX: string;
  overflowY: string;
  contain: string;
  contentVisibility: string;
  clipPath: string;
  maskImage: string;
  mask: string;
  filter: string;
  clip: string;
  /** border-top-left, -top-right, -bottom-right, -bottom-left radius. */
  radii: string[];
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
  /** Outer only: the HTML ancestors between the SVG and its page area that may clip it. */
  ancestors: SvgAncestorFacts[];
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

/** The largest factor by which a matrix stretches a per-axis error: its ∞-norm. */
export function stretch(value: AffineMatrix): number {
  const [a, b, c, d] = value;
  return Math.max(Math.abs(a) + Math.abs(c), Math.abs(b) + Math.abs(d));
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

/** Screen boxes enter the snapshot at 0.01 px. Frame boxes do not: the rule compares them unrounded. */
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

/**
 * Half the float32 spacing at |value|: how far a coordinate CDP hands over can sit from the one
 * layout computed. CDP builds box-model quads in single precision (a rotated SVG's corner reads
 * 85.65685272216797), so the error grows with the distance from the top of the document — at page
 * 90 of a letter-size run, 100 000 px down, it is 0.0039 px.
 */
export function float32HalfSpacing(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude === 0 || !Number.isFinite(magnitude)) return 0;
  return 2 ** (Math.floor(Math.log2(magnitude)) - 24);
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

/** Half a unit in the sixth significant digit: how far Chromium's serialisation of a length can be off. */
export function serialisationHalfUnit(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude === 0) return 0;
  return 0.5 * 10 ** (Math.floor(Math.log10(magnitude)) - 5);
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
 * The length is the USED one: the margin is stored as a LayoutUnit, and the computed value reads
 * it back (10.3px serialises as "10.2969px", 659/64; under zoom 1.37 as "10.2988px", the snapped
 * zoomed value unzoomed). So the only error is the six-digit serialisation, returned as
 * `resolution`.
 *
 * The 0.6.0 collector read this with parseFloat, which is NaN for every keyword form: a clip
 * margin written as `content-box 20px` counted as none, and text the browser draws inside the
 * margin was reported as clipped.
 */
export function parseClipMargin(value: string): { box: VisualBox; margin: number; resolution: number } | null {
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
  const resolved = margin ?? 0;
  return { box: box ?? "padding-box", margin: resolved, resolution: serialisationHalfUnit(resolved) };
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

const OVERFLOW_KEYWORDS = new Set(["visible", "hidden", "clip", "auto", "scroll"]);

/**
 * Overflow keywords that clip, per kind of `<svg>`. Measured on Chromium 141 by painting a
 * 10 000 px rectangle inside the viewport and reading where it survives:
 *
 *   outermost  hidden, clip, auto, scroll clip, clip margin included, with no scrollbar shown.
 *   nested     hidden, clip, scroll clip at the viewport; `auto` does NOT clip, as property or as
 *              attribute — it paints like `visible`. Treating it like the root's `auto` reports a
 *              label drawn in full as clipped (a false error; fixture svg-overflow-kinds.html).
 */
const ROOT_CLIPPING = new Set(["hidden", "clip", "auto", "scroll"]);
const NESTED_CLIPPING = new Set(["hidden", "clip", "scroll"]);
/** The values CSS makes a scroll container of. On the root, any pair of them clips both axes. */
const ROOT_SCROLL_CONTAINER = new Set(["hidden", "auto", "scroll"]);

type OverflowState = { clips: boolean } | { diagnostic: SvgViewportDiagnostic };

/**
 * Whether this SVG's own overflow clips, on both axes together — a one-axis clip is never modelled.
 *
 * Outermost, measured: `overflow-x: visible; overflow-y: hidden` computes to `auto hidden` and clips
 * BOTH axes at the content box, clip margin included; `hidden scroll` does the same. Any pair of
 * scroll-container values is therefore one clip. `visible` with `clip` — the only pair that keeps
 * `visible` — does not clip x and clips y at the PADDING box: declined.
 *
 * Nested, measured: `auto hidden` does not clip at all. Mixed axes are declined there.
 */
export function overflowState(kind: "outer" | "nested", overflowX: string, overflowY: string): OverflowState {
  if (!OVERFLOW_KEYWORDS.has(overflowX) || !OVERFLOW_KEYWORDS.has(overflowY)) return { diagnostic: "overflow-unrecognised" };
  if (overflowX === "visible" && overflowY === "visible") return { clips: false };
  if (kind === "nested") {
    if (overflowX !== overflowY) return { diagnostic: "overflow-axes-differ" };
    return { clips: NESTED_CLIPPING.has(overflowX) };
  }
  if (overflowX === overflowY) return { clips: ROOT_CLIPPING.has(overflowX) };
  if (ROOT_SCROLL_CONTAINER.has(overflowX) && ROOT_SCROLL_CONTAINER.has(overflowY)) return { clips: true };
  return { diagnostic: "overflow-axes-differ" };
}

/**
 * Whether this SVG's own overflow might clip. Conservative: anything not provably non-clipping
 * counts as clipping, so a declined record is never mistaken for a non-applicable one.
 */
export function overflowMayClip(kind: "outer" | "nested", overflowX: string, overflowY: string): boolean {
  const state = overflowState(kind, overflowX, overflowY);
  return "diagnostic" in state || state.clips;
}

const CONTAIN_KEYWORDS = new Set(["none", "strict", "content", "size", "inline-size", "layout", "style", "paint"]);
const CONTENT_VISIBILITY = new Set(["visible", "auto", "hidden"]);

/**
 * Paint containment: `contain: paint` (and `strict`, `content`, which include it) and
 * `content-visibility: auto | hidden`, which imply it. It clips like overflow does. Measured on an
 * outermost SVG with `overflow: visible` on Chromium 141: the clip is the clip-margin reference box
 * grown by its margin, every form (`content-box`, `0px`, `6px`, `border-box 5px`) exactly where the
 * same margin puts an overflow clip; `contain: layout` and `size` clip nothing. Reported clean
 * before this, with 570 of a label's ink pixels cut away (an adversarial probe document).
 *
 * On a NESTED `<svg>`, which has no CSS box, containment was measured to clip nothing and is not
 * read. null: a serialisation this code does not know.
 */
export function paintContainment(contain: string, contentVisibility: string): boolean | null {
  const tokens = contain.trim().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0 || tokens.some((token) => !CONTAIN_KEYWORDS.has(token))) return null;
  if (tokens.includes("none") && tokens.length > 1) return null;
  if (!CONTENT_VISIBILITY.has(contentVisibility)) return null;
  return tokens.some((token) => token === "paint" || token === "strict" || token === "content") || contentVisibility !== "visible";
}

const paintEffect = (value: string): boolean => value !== "" && value !== "none" && !value.startsWith("none ");

/**
 * A clip this module does not reconstruct: `clip-path`, a mask, a `url()` filter (clipped to its
 * filter region) or a legacy `clip` rectangle. On the outermost SVG or an HTML ancestor, each cuts
 * away drawn content wherever it lies, so its presence makes the record clipped — never
 * non-applicable — and declined. Inside the SVG, on the text or a group, the same effects stay what
 * they were: a per-target `env/svg-painted-bounds-unsupported`.
 */
export function unmodelledClip(facts: Pick<SvgBoxStyle, "clipPath" | "maskImage" | "mask" | "filter" | "clip">): boolean {
  return paintEffect(facts.clipPath) || paintEffect(facts.maskImage) || paintEffect(facts.mask) ||
    /url\(/u.test(facts.filter) || (facts.clip !== "auto" && facts.clip !== "");
}

const zeroRadius = (value: string): boolean => value.trim().split(/\s+/u).every((token) => /^0(?:\.0+)?(?:px|%)?$/u.test(token));

/**
 * What an HTML ancestor does to the SVG's drawing. `box`: it clips to a region that contains its
 * own CONTENT box — true of every overflow and paint-containment clip without a radius, whatever its
 * clip margin (measured: `overflow: clip` and `contain: paint` with `overflow-clip-margin:
 * content-box` clip exactly at the content box, and no form clips inside it). `unsupported`: a
 * rounded clip, an unmodelled clip or a containment serialisation this code does not know.
 */
export function ancestorClip(facts: SvgAncestorFacts): "none" | "box" | "unsupported" {
  if (unmodelledClip(facts)) return "unsupported";
  const containment = paintContainment(facts.contain, facts.contentVisibility);
  if (containment === null) return "unsupported";
  if (!OVERFLOW_KEYWORDS.has(facts.overflowX) || !OVERFLOW_KEYWORDS.has(facts.overflowY)) return "unsupported";
  const overflow = facts.overflowX !== "visible" || facts.overflowY !== "visible";
  if (!overflow && !containment) return "none";
  if (facts.radii.length !== 4 || !facts.radii.every(zeroRadius)) return "unsupported";
  return "box";
}

/**
 * A 3D transform, perspective or motion path on the SVG or an ancestor. Containment in the frame
 * would still hold, but `getScreenCTM()` is 2D, so the screen evidence could not be trusted. These
 * stay declines by name, and the CDP residual catches what the list misses (perspective measured at
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

/** CDP `DOM.getBoxModel()` quads of an outermost `<svg>`, four corners each, and of its ancestors. */
export interface SvgBoxModel {
  content: readonly number[];
  padding: readonly number[];
  border: readonly number[];
  /**
   * The content quad of each `RawSvgFrame.ancestors` entry, in the same order; null where CDP had
   * none. Absent: nothing was asked, and a record that needs them declines.
   */
  ancestors?: readonly (readonly number[] | null)[];
}

/**
 * The computed-style content size of an outermost SVG — for the units check only. Computed border
 * widths arrive device-snapped (3.25px reads 3px) and so does the layout that uses them; padding
 * stays the specified length. Under `box-sizing: border-box` the computed width is the border box,
 * so border and padding come off it; under `content-box` it is the content box.
 */
export function contentModel(style: SvgBoxStyle): Resolved<{ width: number; height: number }> {
  const lengths = [style.width, style.height, style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth,
    style.borderLeftWidth, style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(cssPx);
  if (lengths.some((value) => value === null || value < 0)) return { ok: false, diagnostic: "box-unreadable" };
  const [w, h, top, right, bottom, left, padTop, padRight, padBottom, padLeft] = lengths as number[];
  if (style.boxSizing === "content-box") return { ok: true, width: w!, height: h! };
  if (style.boxSizing !== "border-box") return { ok: false, diagnostic: "box-unreadable" };
  const width = w! - left! - right! - padLeft! - padRight!;
  const height = h! - top! - bottom! - padTop! - padBottom!;
  if (width < 0 || height < 0) return { ok: false, diagnostic: "box-unreadable" };
  return { ok: true, width, height };
}

/**
 * One CDP quad carried back into the frame as a rectangle. CDP lists a quad's corners in the box's
 * own order (top-left, top-right, bottom-right, bottom-left, each transformed), so the corners land
 * in that order in the frame whatever the rotation or mirroring. The rectangle is the mean of the
 * corners on each edge; `residual` is how far the corners stray from it.
 */
export function localRectangle(quad: readonly number[], screenToLocal: AffineMatrix): { box: Box; residual: number } | null {
  if (quad.length !== 8 || quad.some((value) => !Number.isFinite(value))) return null;
  const p = [0, 1, 2, 3].map((index) => apply(screenToLocal, quad[2 * index]!, quad[2 * index + 1]!));
  const [tl, tr, br, bl] = p as [[number, number], [number, number], [number, number], [number, number]];
  const left = (tl[0] + bl[0]) / 2;
  const right = (tr[0] + br[0]) / 2;
  const top = (tl[1] + tr[1]) / 2;
  const bottom = (bl[1] + br[1]) / 2;
  if (!(right >= left) || !(bottom >= top)) return null;
  const residual = Math.max(Math.abs(tl[0] - bl[0]), Math.abs(tr[0] - br[0]), Math.abs(tl[1] - tr[1]), Math.abs(bl[1] - br[1])) / 2;
  return { box: { x: left, y: top, width: right - left, height: bottom - top }, residual };
}

/** The used content, padding and border boxes of an outermost SVG in its frame, from CDP. */
export interface LocalBoxes {
  content: Box;
  padding: Box;
  border: Box;
  /**
   * The largest disagreement with the frame's definition: a corner off its rectangle, the content
   * box's corner off the origin, a box outside the one that should contain it.
   */
  residual: number;
  /** The float32 quantisation of the quads, carried into the frame. */
  quantization: number;
}

export function localBoxes(model: SvgBoxModel, localToScreen: AffineMatrix): LocalBoxes | null {
  const back = invert(localToScreen);
  if (!back) return null;
  const content = localRectangle(model.content, back);
  const padding = localRectangle(model.padding, back);
  const border = localRectangle(model.border, back);
  if (!content || !padding || !border) return null;
  const outside = (inner: Box, outer: Box): number => Math.max(0,
    outer.x - inner.x, outer.y - inner.y,
    inner.x + inner.width - (outer.x + outer.width), inner.y + inner.height - (outer.y + outer.height));
  const residual = Math.max(content.residual, padding.residual, border.residual,
    Math.abs(content.box.x), Math.abs(content.box.y),
    outside(content.box, padding.box), outside(padding.box, border.box));
  const quantization = stretch(back) * Math.max(...[...model.content, ...model.padding, ...model.border].map(float32HalfSpacing));
  return { content: content.box, padding: padding.box, border: border.box, residual, quantization };
}

/** The outermost SVG's own clip, in its frame, from the used boxes. */
export interface OuterClip {
  clip: Box | null;
  /** The clip margin's serialisation error; 0 without a clip. */
  resolution: number;
}

/**
 * The clip rectangle of an outermost SVG: its overflow clip or its paint containment, which clip
 * alike, at the clip-margin reference box grown by the margin. null when neither applies.
 */
export function outerClip(style: SvgBoxStyle, boxes: Pick<LocalBoxes, "content" | "padding" | "border">): Resolved<OuterClip> {
  const overflow = overflowState("outer", style.overflowX, style.overflowY);
  if ("diagnostic" in overflow) return { ok: false, diagnostic: overflow.diagnostic };
  const containment = paintContainment(style.contain, style.contentVisibility);
  if (containment === null) return { ok: false, diagnostic: "containment-unrecognised" };
  if (!overflow.clips && !containment) return { ok: true, clip: null, resolution: 0 };

  const clipMargin = parseClipMargin(style.overflowClipMargin);
  if (!clipMargin) return { ok: false, diagnostic: "clip-margin-unrecognised" };

  // Rounded clipping. The clip follows the reference box's corner curve, which for the content box
  // is the outer radius less border and padding on each axis (CSS Backgrounds §5.2); a corner is
  // square as soon as either of its radii is zero. Measured: radius 12 over border 4 + padding 8
  // clips exactly at the content rectangle. A clip margin grows the curve with the rectangle, so a
  // radius together with any margin is not modelled at all. The insets are the used ones, CDP's;
  // radii the layout scaled down only make a square corner squarer.
  const { content, border } = boxes;
  const radii = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius]
    .map((value) => parseCornerRadius(value, border.width, border.height));
  if (radii.some((value) => value === null)) return { ok: false, diagnostic: "box-unreadable" };
  const leftInset = content.x - border.x;
  const rightInset = border.x + border.width - (content.x + content.width);
  const topInset = content.y - border.y;
  const bottomInset = border.y + border.height - (content.y + content.height);
  const insetX = [leftInset, rightInset, rightInset, leftInset];
  const insetY = [topInset, topInset, bottomInset, bottomInset];
  const epsilon = 1e-6;
  const anyRadius = radii.some((value) => value![0] > epsilon && value![1] > epsilon);
  const plainContentClip = clipMargin.box === "content-box" && clipMargin.margin === 0;
  if (anyRadius && !plainContentClip) return { ok: false, diagnostic: "radius-with-clip-margin" };
  const rounded = radii.some((value, corner) => value![0] - insetX[corner]! > epsilon && value![1] - insetY[corner]! > epsilon);
  if (rounded) return { ok: false, diagnostic: "rounded-clip" };

  const reference = clipMargin.box === "content-box" ? boxes.content : clipMargin.box === "padding-box" ? boxes.padding : boxes.border;
  const m = clipMargin.margin;
  return {
    ok: true,
    clip: { x: reference.x - m, y: reference.y - m, width: reference.width + 2 * m, height: reference.height + 2 * m },
    resolution: clipMargin.resolution,
  };
}

/**
 * Whether every point lies inside a convex quad (CDP corner order), at least `margin` from each
 * edge; a negative margin lets a point sit that far outside. Used for an ancestor's clip, which
 * must contain the SVG's own before it can be set aside.
 */
export function insideQuad(points: readonly [number, number][], quad: readonly number[], margin: number): boolean {
  if (quad.length !== 8 || quad.some((value) => !Number.isFinite(value))) return false;
  const q = [0, 1, 2, 3].map((index) => [quad[2 * index]!, quad[2 * index + 1]!] as const);
  let area = 0;
  for (let i = 0; i < 4; i += 1) {
    const [x1, y1] = q[i]!;
    const [x2, y2] = q[(i + 1) % 4]!;
    area += x1 * y2 - x2 * y1;
  }
  if (!(Math.abs(area) > 0)) return false;
  const orientation = Math.sign(area);
  for (let i = 0; i < 4; i += 1) {
    const [x1, y1] = q[i]!;
    const [x2, y2] = q[(i + 1) % 4]!;
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (!(length > 0)) return false;
    for (const [px, py] of points) {
      const distance = (orientation * ((x2 - x1) * (py - y1) - (y2 - y1) * (px - x1))) / length;
      if (!(distance >= margin)) return false;
    }
  }
  return true;
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
 * the parent's user space, and a clip margin on a clipping one was measured to be ignored — neither
 * is modelled; both decline.
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
  const overflow = overflowState("nested", raw.style.overflowX, raw.style.overflowY);
  if ("diagnostic" in overflow) return { ok: false, diagnostic: overflow.diagnostic };
  if (overflow.clips && raw.style.overflowClipMargin !== "content-box") return { ok: false, diagnostic: "nested-clip-margin" };
  if (!axisAligned(toOuter)) return { ok: false, diagnostic: "nested-viewport-rotated" };
  const viewport = envelope({ x, y, width, height }, toOuter);
  return { ok: true, viewport, clip: overflow.clips ? viewport : null };
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
 * Whether anything may clip what an outermost SVG draws: its own overflow or paint containment, an
 * unmodelled clip on it, or an HTML ancestor inside the page area that clips. Conservative: an
 * unknown serialisation clips.
 */
export function outerMayClip(raw: RawSvgFrame): boolean {
  const containment = paintContainment(raw.style.contain, raw.style.contentVisibility);
  return overflowMayClip("outer", raw.style.overflowX, raw.style.overflowY) || containment !== false ||
    unmodelledClip(raw.style) || raw.ancestors.some((facts) => ancestorClip(facts) !== "none");
}

function resolveOuter(raw: RawSvgFrame, model: SvgBoxModel | null): ResolvedSvgFrame {
  const clipped = outerMayClip(raw);
  const decline = (diagnostic: SvgViewportDiagnostic): ResolvedSvgFrame => ({ clipped, frame: null, diagnostic });
  if (raw.transforms.some(threeDimensional)) return decline("three-dimensional-transform");
  // Clipping this module does not rebuild comes first: whatever else the frame would prove, a
  // clip-path, mask or url() filter on the SVG or an ancestor decides what is drawn.
  const ancestors = raw.ancestors.map(ancestorClip);
  if (unmodelledClip(raw.style) || ancestors.includes("unsupported")) return decline("ancestor-clip");
  const ctm = matrix(raw.ctm);
  const screenCtm = matrix(raw.screenCtm);
  const ctmInverse = ctm ? invert(ctm) : null;
  if (!screenCtm || !ctmInverse) return decline("matrix-unavailable");
  const localToScreen = multiply(screenCtm, ctmInverse);
  const screenToLocal = invert(localToScreen);
  if (!screenToLocal) return decline("matrix-unavailable");
  const modelled = contentModel(raw.style);
  if (!modelled.ok) return decline(modelled.diagnostic);
  if (!model) return decline("oracle-unavailable");
  const boxes = localBoxes(model, localToScreen);
  if (!boxes || boxes.residual > SVG_FRAME_TOLERANCE_PX) return decline("oracle-disagreed");
  const modelDelta = Math.max(Math.abs(boxes.content.width - modelled.width), Math.abs(boxes.content.height - modelled.height));
  if (modelDelta > SVG_MODEL_TOLERANCE_PX) return decline("box-model-disagreed");
  const own = outerClip(raw.style, boxes);
  if (!own.ok) return decline(own.diagnostic);
  const uncertainty = boxes.residual + boxes.quantization + own.resolution + SVG_FLOAT_NOISE_PX;
  if (uncertainty + SVG_FLOAT_NOISE_PX > SVG_OVERSHOOT_EPSILON_PX) return decline("frame-imprecise");

  // An ancestor that clips at a region containing its content box can be set aside once that
  // content box contains this SVG's own clip, carried to the screen. Then a label the rule calls
  // clean — at most epsilon past the SVG's clip as measured — is at most epsilon plus the quad's
  // quantisation past the ancestor's content box, which is inside the resolution the rule states,
  // and nothing the rule reports depends on the ancestor at all (text past the SVG's clip is cut
  // whatever lies above). So the clip may touch the ancestor's edge — an SVG flush in an
  // `overflow: hidden` wrapper is the ordinary case — but not cross it by more than the float32
  // error of the quad. An SVG with no clip of its own under a clipping ancestor has nothing to
  // hold against it and is declined, not called unclipped.
  const clipping = raw.ancestors.flatMap((_, index) => (ancestors[index] === "box" ? [index] : []));
  if (clipping.length > 0) {
    if (!own.clip) return decline("ancestor-clip");
    const points = corners(own.clip).map(([x, y]) => apply(localToScreen, x, y));
    for (const index of clipping) {
      const quad = model.ancestors?.[index] ?? null;
      if (!quad) return decline("ancestor-clip");
      const slack = Math.SQRT2 * Math.max(0, ...quad.map(float32HalfSpacing)) + stretch(localToScreen) * SVG_FLOAT_NOISE_PX;
      if (!insideQuad(points, quad, -slack)) return decline("ancestor-clip");
    }
  }
  return {
    clipped,
    diagnostic: null,
    frame: {
      toOuter: IDENTITY, viewport: boxes.content, clips: own.clip ? [own.clip] : [], localToScreen,
      oracleDeltaPx: boxes.residual, modelDeltaPx: modelDelta, uncertaintyPx: uncertainty,
    },
  };
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
    if (raw.kind === "foreign-object") {
      // The foreignObject and every enclosing SVG clip this SVG too, and Chromium 141 places its
      // getScreenCTM() 20 px away from CDP's content box when it is a direct child of the
      // foreignObject. Conservative on both counts: applicable, and declined.
      out.push(decline(true, "inside-foreign-object"));
      return;
    }
    if (raw.kind === "nested") {
      const clipped = overflowMayClip("nested", raw.style.overflowX, raw.style.overflowY) || !!parent?.clipped;
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
          ...parent.frame,
          toOuter,
          viewport: nested.viewport,
          clips: [...(nested.clip ? [nested.clip] : []), ...parent.frame.clips],
        },
      });
      return;
    }
    out.push(resolveOuter(raw, boxModels?.[index] ?? null));
  });
  return out;
}

/**
 * One target's boxes. The local matrix is the record's frame map times the text's own `getCTM()`;
 * carried to the screen it must be the text's `getScreenCTM()`. That identity is what ties the text
 * to the frame the quads were carried into, and a target for which it fails — or whose residual
 * does not fit the epsilon beside the frame's own error — is a target this build cannot place:
 * null, and the caller counts it as unreadable rather than guessing a frame for it.
 *
 * `boxLocal` stays unrounded: the rule compares it against unrounded clips, and rounding both to
 * 0.01 px would spend the whole epsilon on the storage format.
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
  let residual = 0;
  for (const [x, y] of corners(bboxUser)) {
    const [lx, ly] = apply(userToLocal, x, y);
    const [sx, sy] = apply(screenCtm, x, y);
    const [bx, by] = apply(back, sx, sy);
    residual = Math.max(residual, Math.abs(bx - lx), Math.abs(by - ly));
  }
  if (!(residual <= SVG_FRAME_TOLERANCE_PX)) return null;
  if ((frame.uncertaintyPx ?? 0) + residual + SVG_FLOAT_NOISE_PX > SVG_OVERSHOOT_EPSILON_PX) return null;
  return {
    boxScreen: roundedBox(envelope(bboxUser, screenCtm)),
    boxLocal: envelope(bboxUser, userToLocal),
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
