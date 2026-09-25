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
 * content's bounding box); each is placed where the browser's own `getScreenCTM()` puts it, sized by
 * its computed (used) width and height, proven against its viewBox transform, and inherits the
 * outermost SVG's frame (see nestedViewportGeometry).
 *
 * THE PAINTED CLIP. Chromium does not clip where layout puts the clip rectangle: it paints the
 * outermost SVG's content at its border-box origin rounded to a whole CSS px of the document and
 * clips at the clip rectangle with each edge rounded the same way (see paintedClip). The clip the
 * rule compares against is that painted one, carried into the frame.
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
 *               nested width/height serialisation  the same, times the nested frame's stretch;
 *                                                  charged only where the nested viewport clips
 *               arithmetic                         SVG_FLOAT_NOISE_PX
 *   text side   local matrix against screen CTM    the text's own residual, charged per target
 *               arithmetic                         SVG_FLOAT_NOISE_PX
 *
 * The clip-side sum is the frame's `uncertaintyPx`. A frame is declined `frame-imprecise` when
 * `uncertaintyPx` plus one more SVG_FLOAT_NOISE_PX exceeds this epsilon, and also when a painted
 * clip edge cannot be snapped because its unrounded position lies within the margin's serialisation
 * (and the quads' float32 spacing) of a half pixel. A target is declined as unreadable when
 * `uncertaintyPx` plus its own residual plus SVG_FLOAT_NOISE_PX exceeds it.
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
  maskBoxImageSource: string;
  maskBorderSource: string;
  filter: string;
  clip: string;
}

/**
 * Computed transform-related properties of one element on the SVG's ancestor path, with the two
 * that give an element a paint offset of its own (`will-change`, `position: fixed | sticky`).
 */
export interface SvgTransformFacts {
  transform: string;
  rotate: string;
  scale: string;
  translate: string;
  perspective: string;
  offsetPath: string;
  willChange?: string;
  position?: string;
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
  maskBoxImageSource: string;
  maskBorderSource: string;
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
  /** Outer only: the SVG or an ancestor is assigned to a slot, so the flat tree is not the DOM's. */
  slotted: boolean;
  /** Outer only: an ancestor (not the document) is scrolled, so its content's paint offset moved. */
  scrolled: boolean;
  /** Nested only: x, y, width, height as SVGLength.value of the animated values. */
  lengths: number[] | null;
  /** Nested only: the computed x, y, width, height and transform. */
  computed: { x: string; y: string; width: string; height: string; transform: string } | null;
  /** Nested only: the x and y attributes as written, and the viewBox and preserveAspectRatio. */
  attributes: { x: string | null; y: string | null; viewBox?: string | null; preserveAspectRatio?: string | null } | null;
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

const noneOrAbsent = (value: string): boolean => value === "none" || value === "";

/**
 * CSS filter functions, which change the colour or extend the ink but never cut drawn content
 * away. A `url()` reference is not among them: an SVG filter clips to its filter region.
 */
const FILTER_FUNCTIONS = new Set(["blur", "brightness", "contrast", "drop-shadow", "grayscale", "hue-rotate",
  "invert", "opacity", "saturate", "sepia"]);
function filterClipsNothing(value: string): boolean {
  if (noneOrAbsent(value)) return true;
  let rest = value.trim();
  while (rest.length > 0) {
    const match = /^([a-z-]+)\(/u.exec(rest);
    if (!match || !FILTER_FUNCTIONS.has(match[1]!)) return false;
    let depth = 0;
    let end = -1;
    for (let index = match[1]!.length; index < rest.length; index += 1) {
      if (rest[index] === "(") depth += 1;
      if (rest[index] === ")") { depth -= 1; if (depth === 0) { end = index; break; } }
    }
    if (end < 0 || /url\(/u.test(rest.slice(0, end + 1))) return false;
    rest = rest.slice(end + 1).trim();
  }
  return true;
}

/**
 * A clip this module does not reconstruct. Decided by an ALLOW-LIST: every property that can cut
 * drawn content away — `clip-path`, `mask-image` and the `mask` shorthand, the mask-box image
 * (`-webkit-mask-box-image-source`) and `mask-border-source`, `filter` (a `url()` filter clips to
 * its filter region) and legacy `clip` — must hold a value that provably clips nothing: `none`
 * (or empty, a property this browser does not have), a list of CSS filter functions, `clip:
 * auto`. Anything else counts as a clip, including a value never seen before; a deny-list read
 * `url(` and `none` and missed `-webkit-mask-box-image` entirely. On the outermost SVG or an HTML
 * ancestor such a clip makes the record clipped — never non-applicable — and declined. Inside the
 * SVG, on the text or a group, the same effects stay per-target `env/svg-painted-bounds-unsupported`.
 */
export function unmodelledClip(facts: Pick<SvgBoxStyle, "clipPath" | "maskImage" | "mask" | "maskBoxImageSource" | "maskBorderSource" | "filter" | "clip">): boolean {
  return !(noneOrAbsent(facts.clipPath) && noneOrAbsent(facts.maskImage) && noneOrAbsent(facts.mask) &&
    noneOrAbsent(facts.maskBoxImageSource) && noneOrAbsent(facts.maskBorderSource) &&
    filterClipsNothing(facts.filter) && (facts.clip === "auto" || facts.clip === ""));
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
  /**
   * The document's scroll offset (CDP `Page.getLayoutMetrics`), which carries the viewport-relative
   * quads into the document space the browser snaps paint offsets in. Absent: a clipped record
   * declines.
   */
  scroll?: readonly number[];
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
  /** As layout has it, unsnapped; the painted clip is `paintedClip` of the same reference box. */
  clip: Box | null;
  /** The clip margin's serialisation error; 0 without a clip. */
  resolution: number;
  reference: VisualBox | null;
  margin: number;
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
  if (!overflow.clips && !containment) return { ok: true, clip: null, resolution: 0, reference: null, margin: 0 };

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
    reference: clipMargin.box,
    margin: m,
  };
}

/**
 * Chromium's pixel snapping, measured. The browser paints an outermost SVG with its content moved
 * to the SNAPPED border-box origin and clips it at the SNAPPED clip rectangle — `LayoutUnit::Round`,
 * half up, on each edge, in CSS px of the document, whatever the device scale. Neither is what
 * `getScreenCTM()` or CDP report, which are the unsnapped layout. So the clip that decides what is
 * drawn, in the frame the targets' boxes are in, is the snapped clip rectangle minus the snapped
 * origin: every edge moves by `(round(edge) − edge) − (round(origin) − origin)`, up to one pixel.
 * Measured on Chromium 141 through Paged.js at a device scale of 8, over 18 SVGs on four pages with
 * fractional page heights, margins, paddings, borders, zoom 1.37 and every clip-margin form: this
 * model put every painted clip edge and every painted content offset exactly (0.000 px); the
 * unsnapped layout was off by up to 0.5 px per edge. Up to round two of this build that half pixel
 * was reported as a finding on labels drawn in full, and let clipped labels through as clean.
 *
 * The model holds only where the snapping space is the document: no CSS transform, `will-change`
 * or fixed/sticky position on the SVG or an ancestor, and no scrolled ancestor. Elsewhere a clipped
 * SVG is declined (`pixel-snapping-unmodelled`, `scrolled-ancestor`).
 */
export function snapPixel(value: number): number {
  return Math.floor(value + 0.5);
}

/** Whether transform facts give the SVG a paint offset space other than the document's. */
export function paintOffsetUnmodelled(facts: SvgTransformFacts): boolean {
  const none = (value: string | undefined): boolean => value === undefined || value === "none" || value === "";
  return !(none(facts.transform) && none(facts.rotate) && none(facts.scale) && none(facts.translate) &&
      none(facts.perspective) && none(facts.offsetPath)) ||
    !(facts.willChange === undefined || facts.willChange === "auto" || facts.willChange === "") ||
    facts.position === "fixed" || facts.position === "sticky";
}

/**
 * One edge, snapped. A layout coordinate below 2^17 px on the 1/64 grid is exactly what layout
 * holds (float32 carries it exactly), so even a tie at .5 rounds as the browser does. Anything
 * else is known only to `slack`, and a value that close to a tie cannot be snapped: null.
 */
function snapEdge(value: number, slack: number): number | null {
  const exact = Math.abs(value) < 2 ** 17 && Number.isInteger(value * 64) && slack === 0;
  if (!exact) {
    const fraction = value - Math.floor(value);
    if (Math.abs(fraction - 0.5) <= slack + float32HalfSpacing(value) + 1e-9) return null;
  }
  return snapPixel(value);
}

/** The painted (snapped) clip of an outermost SVG, in its frame and on the page. */
export interface PaintedClip {
  /** In the frame: where the targets' boxes are compared. */
  clip: Box;
  /** In document CSS px: the snapped rectangle itself, for holding against an ancestor's clip. */
  page: { left: number; top: number; right: number; bottom: number };
}

export function paintedClip(
  model: SvgBoxModel, reference: VisualBox, margin: number, marginResolution: number, localToScreen: AffineMatrix,
): Resolved<PaintedClip> {
  const [a, b, c, d, e, f] = localToScreen;
  if (!(a > 0 && d > 0 && Math.abs(b) <= 1e-12 * a && Math.abs(c) <= 1e-12 * d)) return { ok: false, diagnostic: "pixel-snapping-unmodelled" };
  const scroll = model.scroll;
  if (!scroll || scroll.length !== 2 || !scroll.every(Number.isFinite)) return { ok: false, diagnostic: "oracle-unavailable" };
  const sx = scroll[0]!;
  const sy = scroll[1]!;
  const quad = reference === "content-box" ? model.content : reference === "padding-box" ? model.padding : model.border;
  const rectangular = (q: readonly number[]): boolean => q.length === 8 && q[0] === q[6] && q[1] === q[3] && q[2] === q[4] && q[5] === q[7];
  if (!rectangular(quad) || !rectangular(model.border)) return { ok: false, diagnostic: "pixel-snapping-unmodelled" };
  // The margin in document px. Its used value is a LayoutUnit, so it is snapped back onto the 1/64
  // grid where its serialisation allows; otherwise it carries its resolution into the edge.
  let slack = 0;
  const grid = (value: number, resolution: number): number => {
    const snapped = Math.round(value * 64) / 64;
    if (Math.abs(snapped - value) <= resolution + 1e-9) return snapped;
    slack = Math.max(slack, resolution);
    return value;
  };
  const mx = grid(margin * a, marginResolution * a);
  const my = grid(margin * d, marginResolution * d);
  const left = snapEdge(quad[0]! + sx - mx, slack);
  const right = snapEdge(quad[2]! + sx + mx, slack);
  const top = snapEdge(quad[1]! + sy - my, slack);
  const bottom = snapEdge(quad[5]! + sy + my, slack);
  const originX = model.border[0]! + sx;
  const originY = model.border[1]! + sy;
  const snappedOriginX = snapEdge(originX, 0);
  const snappedOriginY = snapEdge(originY, 0);
  if (left === null || right === null || top === null || bottom === null || snappedOriginX === null || snappedOriginY === null) {
    return { ok: false, diagnostic: "frame-imprecise" };
  }
  const shiftX = snappedOriginX - originX;
  const shiftY = snappedOriginY - originY;
  const toLocalX = (page: number): number => (page - sx - shiftX - e) / a;
  const toLocalY = (page: number): number => (page - sy - shiftY - f) / d;
  const x0 = toLocalX(left);
  const y0 = toLocalY(top);
  return {
    ok: true,
    clip: { x: x0, y: y0, width: toLocalX(right) - x0, height: toLocalY(bottom) - y0 },
    page: { left, top, right, bottom },
  };
}

/**
 * Whether an ancestor's clip, known by its content quad, contains the SVG's painted clip. Every
 * clip an ancestor makes contains its content box, snapped the same way (rounding is monotone),
 * so the snapped content rectangle is the region to hold the SVG against.
 */
export function ancestorContains(quad: readonly number[], scroll: readonly number[], page: PaintedClip["page"]): boolean {
  if (quad.length !== 8 || quad.some((value) => !Number.isFinite(value))) return false;
  if (!(quad[0] === quad[6] && quad[1] === quad[3] && quad[2] === quad[4] && quad[5] === quad[7])) return false;
  const [sx, sy] = scroll as [number, number];
  const left = snapEdge(quad[0]! + sx, 0);
  const right = snapEdge(quad[2]! + sx, 0);
  const top = snapEdge(quad[1]! + sy, 0);
  const bottom = snapEdge(quad[5]! + sy, 0);
  if (left === null || right === null || top === null || bottom === null) return false;
  return page.left >= left && page.right <= right && page.top >= top && page.bottom <= bottom;
}

/** A `viewBox` attribute as four numbers, or null when absent; "invalid" when present and unusable. */
export function parseViewBox(value: string | null | undefined): [number, number, number, number] | null | "invalid" {
  if (value === null || value === undefined) return null;
  const tokens = value.trim().split(/[\s,]+/u).filter(Boolean);
  if (tokens.length !== 4) return "invalid";
  const numbers = tokens.map(Number);
  if (numbers.some((number) => !Number.isFinite(number)) || numbers[2]! <= 0 || numbers[3]! <= 0) return "invalid";
  return numbers as [number, number, number, number];
}

const ALIGNMENTS = new Set(["none", "xMinYMin", "xMidYMin", "xMaxYMin", "xMinYMid", "xMidYMid", "xMaxYMid", "xMinYMax", "xMidYMax", "xMaxYMax"]);

/**
 * The viewBox transform of SVG 2 §8.2 for a viewport of `width` x `height`: user space of the
 * `<svg>` into its viewport, before the viewport's own x/y. null for a preserveAspectRatio this code
 * does not parse.
 */
export function viewBoxTransform(viewBox: [number, number, number, number] | null, preserveAspectRatio: string | null | undefined,
  width: number, height: number): AffineMatrix | null {
  if (!viewBox) return IDENTITY;
  const tokens = (preserveAspectRatio ?? "").trim().split(/\s+/u).filter(Boolean);
  if (tokens[0] === "defer") tokens.shift();
  const align = tokens[0] ?? "xMidYMid";
  const meetOrSlice = tokens[1] ?? "meet";
  if (!ALIGNMENTS.has(align) || (meetOrSlice !== "meet" && meetOrSlice !== "slice") || tokens.length > 2) return null;
  const [vx, vy, vw, vh] = viewBox;
  let sx = width / vw;
  let sy = height / vh;
  if (align !== "none") {
    const scale = meetOrSlice === "slice" ? Math.max(sx, sy) : Math.min(sx, sy);
    sx = scale;
    sy = scale;
  }
  let tx = -vx * sx;
  let ty = -vy * sy;
  if (align.includes("xMid")) tx += (width - vw * sx) / 2;
  if (align.includes("xMax")) tx += width - vw * sx;
  if (align.includes("YMid")) ty += (height - vh * sy) / 2;
  if (align.includes("YMax")) ty += height - vh * sy;
  return [sx, 0, 0, sy, tx, ty];
}

/**
 * The viewport and clip rectangle of a nested `<svg>`, in the frame.
 *
 * WHERE THE VIEWPORT IS comes from the browser's own placement of it, not from the attributes:
 * the nested SVG's screen CTM carried back through the frame (`S⁻¹`) and its parent's frame map
 * (`toOuter⁻¹`) is `translate(x, y) · viewBoxTransform(w, h)`, and x/y are read off that
 * translation. HOW LARGE it is comes from the computed width/height, which Chromium 141 resolves to
 * the used size in every case measured — the attribute, a CSS `width: 100px` that overrides it,
 * `width: auto` (the parent viewport) — while `SVGLength.value` keeps the attribute whatever the
 * CSS says, and a CSS `x` is ignored for the viewport although the computed `x` reports it. An
 * earlier build required computed x/y/width/height to equal the SVGLength values, and on CI's
 * Chrome 153 declined every nested SVG of the live suite; which value disagreed there could not be
 * observed on Chromium 141, and the live suite now prints the browser's facts for any nested SVG
 * that declines. The CTM's translation carries the page offset as layout holds it and the SVG
 * lengths as floats; live on Chromium 141 the viewports it gives match the authored x/y to 1e-6 px
 * (tests/live/render-run.test.ts, nested figures). With a viewBox the
 * reconstructed transform's scale must match the CTM's, which checks width/height too. A
 * transform on the nested SVG, or a clip margin on a clipping one (measured to be ignored), is not
 * modelled; both decline. `resolution` is the six-digit serialisation of width/height.
 */
export function nestedViewportGeometry(raw: RawSvgFrame, toOuter: AffineMatrix, localToScreen: AffineMatrix):
  Resolved<{ viewport: Box; clip: Box | null; resolution: number }> {
  const computed = raw.computed;
  if (!computed || computed.transform !== "none") return { ok: false, diagnostic: "nested-transform" };
  const width = cssPx(computed.width);
  const height = cssPx(computed.height);
  if (width === null || height === null || width < 0 || height < 0) return { ok: false, diagnostic: "nested-lengths-disagree" };
  const screenCtm = matrix(raw.screenCtm);
  const screenToLocal = invert(localToScreen);
  const outerToParent = invert(toOuter);
  if (!screenCtm || !screenToLocal || !outerToParent) return { ok: false, diagnostic: "matrix-unavailable" };
  const placed = multiply(outerToParent, multiply(screenToLocal, screenCtm));
  const viewBox = parseViewBox(raw.attributes?.viewBox);
  if (viewBox === "invalid") return { ok: false, diagnostic: "nested-lengths-disagree" };
  const content = viewBoxTransform(viewBox, raw.attributes?.preserveAspectRatio, width, height);
  if (!content) return { ok: false, diagnostic: "nested-lengths-disagree" };
  const close = (actual: number, expected: number): boolean => Math.abs(actual - expected) <= 1e-6 * Math.max(1, Math.abs(expected));
  if (!close(placed[0], content[0]) || !close(placed[1], 0) || !close(placed[2], 0) || !close(placed[3], content[3])) {
    return { ok: false, diagnostic: "nested-lengths-disagree" };
  }
  const x = placed[4] - content[4];
  const y = placed[5] - content[5];
  const overflow = overflowState("nested", raw.style.overflowX, raw.style.overflowY);
  if ("diagnostic" in overflow) return { ok: false, diagnostic: overflow.diagnostic };
  if (overflow.clips && raw.style.overflowClipMargin !== "content-box") return { ok: false, diagnostic: "nested-clip-margin" };
  if (!axisAligned(toOuter)) return { ok: false, diagnostic: "nested-viewport-rotated" };
  const viewport = envelope({ x, y, width, height }, toOuter);
  const resolution = stretch(toOuter) * Math.max(serialisationHalfUnit(width), serialisationHalfUnit(height));
  return { ok: true, viewport, clip: overflow.clips ? viewport : null, resolution };
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
    unmodelledClip(raw.style) || raw.slotted || raw.ancestors.some((facts) => ancestorClip(facts) !== "none");
}

function resolveOuter(raw: RawSvgFrame, model: SvgBoxModel | null): ResolvedSvgFrame {
  const clipped = outerMayClip(raw);
  const decline = (diagnostic: SvgViewportDiagnostic): ResolvedSvgFrame => ({ clipped, frame: null, diagnostic });
  if (raw.transforms.some(threeDimensional)) return decline("three-dimensional-transform");
  // Clipping this module does not rebuild comes first: whatever else the frame would prove, a
  // clip-path, mask or url() filter on the SVG or an ancestor decides what is drawn.
  const ancestors = raw.ancestors.map(ancestorClip);
  if (unmodelledClip(raw.style) || ancestors.includes("unsupported")) return decline("ancestor-clip");
  // A slotted SVG is clipped by the shadow tree it is assigned into, which no DOM walk visits.
  if (raw.slotted) return decline("shadow-tree");
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
  if (clipping.length > 0 && !own.clip) return decline("ancestor-clip");
  let clip: Box | null = null;
  if (own.clip) {
    // The painted clip, not the layout one (see paintedClip). Its space must be the document's.
    if (raw.transforms.some(paintOffsetUnmodelled)) return decline("pixel-snapping-unmodelled");
    if (raw.scrolled) return decline("scrolled-ancestor");
    const painted = paintedClip(model, own.reference!, own.margin, own.resolution, localToScreen);
    if (!painted.ok) return decline(painted.diagnostic);
    clip = painted.clip;
    for (const index of clipping) {
      const quad = model.ancestors?.[index] ?? null;
      if (!quad || !ancestorContains(quad, model.scroll!, painted.page)) return decline("ancestor-clip");
    }
  }
  return {
    clipped,
    diagnostic: null,
    frame: {
      toOuter: IDENTITY, viewport: boxes.content, clips: clip ? [clip] : [], localToScreen,
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
      const nested = nestedViewportGeometry(raw, toOuter, parent.frame.localToScreen);
      if (!nested.ok) { out.push(decline(clipped, nested.diagnostic)); return; }
      // The nested clip's width/height are six-digit serialisations: charged to the bound.
      const uncertainty = (parent.frame.uncertaintyPx ?? 0) + (nested.clip ? nested.resolution : 0);
      if (uncertainty + SVG_FLOAT_NOISE_PX > SVG_OVERSHOOT_EPSILON_PX) { out.push(decline(clipped, "frame-imprecise")); return; }
      out.push({
        clipped,
        diagnostic: null,
        frame: {
          ...parent.frame,
          toOuter,
          viewport: nested.viewport,
          clips: [...(nested.clip ? [nested.clip] : []), ...parent.frame.clips],
          uncertaintyPx: parent.frame.uncertaintyPx === null ? null : uncertainty,
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
