/**
 * The painted ink of an SVG `<text>`, bounded from both sides, for `svg/text-overflows-viewport`.
 *
 * THE QUESTION BEHIND THE BOUNDS. The rule reports text the viewport clips away. What the clip
 * removes is INK: the glyph outlines and, where one is painted, the stroke around them. Up to this
 * build the rule compared the typographic cell of `getBBox()` instead, and the cell is neither side
 * of the ink:
 *
 *   - it is not inside the ink. The cell spans the font's ascent and descent and every advance,
 *     trailing letter-spacing included. Measured on Chromium 141, DejaVu Sans 12 px "100": cell
 *     y 149..163, ink 151..160 — 2 px of slack above and 3 below, 6 and 8 at 40 px, 12 px after
 *     the last glyph under letter-spacing 12. An axis tick at y = height − 2 had its cell 1 px past
 *     the edge and every pixel of its ink inside, and the released rule called it "not drawn".
 *   - it is not, on its own authority, around the ink: a stroke paints beyond it (a miter join up
 *     to miterlimit · stroke-width / 2 beyond the outline, measured up to 8.8 · sw/2 at miterlimit
 *     10), and glyph outlines are only inside it because Chromium happens to unite the cell with
 *     its own glyph bounds.
 *
 * So the page ships raw facts — computed paint and font properties of the text and its rendered
 * descendants, SVG text positions, and a canvas RASTER of the label's own glyphs — and this module
 * turns them into two boxes in the record's local frame (`SvgViewportLocal`): `inkInnerLocal`, a
 * box the glyph ink provably reaches on every side, and `inkOuterLocal` grown by the stroke pad, a
 * box that provably contains all painted ink. The rule reports only what the first proves outside
 * the clip, stays silent only where the second is inside it, and declines the band between.
 * Nothing here runs in the document; every decision is plain arithmetic over what the page
 * returned and can be tested without a browser.
 *
 * THE RASTER, AND WHY NOT `measureText()` ALONE. Canvas `actualBoundingBox*` is not the outline
 * bbox either: measured against the DPR-8 screenshot of the same SVG label, it lay outside the
 * glyph outlines by up to 1.64 px at the label's own size and 1.39 px at 64× (a synthetic-oblique
 * DejaVu Serif "100" at 40 px) — it is the rounded control box, hinted, and a control point can sit
 * anywhere a font designer put it. An inner bound built on it could invent ink. The raster is
 * physics instead of font design: the label is filled into a detached canvas with the SAME computed
 * font state, drawn through the linear part of its own CTM — so a rotated label is rastered rotated
 * and its covered columns and rows are already the viewport's axes — magnified to about 128 device
 * px per em by the context transform (the font size, and with it the optical size, stays the
 * label's own), and its alpha channel scanned for the first and last covered column and row. Measured over 270 labels (15 fonts, 18 strings, 9 sizes, 5 scales,
 * 4 styles, anchors, spacing), every raster edge lay within [−0.61, +1.36] canvas px of the DPR-8
 * screenshot edge wherever the screenshot resolved finer than the raster: the model "rounded out by
 * up to one pixel, hinted by up to half a pixel either way" holds, and RASTER_MARGIN_CANVAS_PX
 * covers it with half a pixel to spare.
 *
 * WHEN THE RASTER IS THE LABEL. Only for one horizontal run the canvas demonstrably reproduces:
 * text-node children only; no x/y/dx/dy list (a `rotate` attribute declines the target before this; a transform is fine: it is in
 * the CTM the raster is drawn through); no textLength other than a spacingAndGlyphs scale; a font state the canvas carries (the whitelist below); left-to-right with
 * no right-to-left characters; the alphabetic baseline (measured: under dominant-baseline middle,
 * central and hanging, `getStartPositionOfChar()` reports the unshifted position, 6 to 15 px away);
 * collapsed white space whose character count matches `getNumberOfChars()`; start and end positions
 * on one baseline, `getComputedTextLength()` apart; and — the font's own fingerprint — the canvas
 * advance equal to the SVG advance within ADVANCE_TOLERANCE (measured |Δ| ≤ 0.039 px over 465
 * labels). Everything else is bounded by its cell grown by CELL_OVERHANG, with no inner box.
 */

import type { SvgInkDiagnostic } from "../core/enums.ts";
import type { AffineMatrix, Box, SvgTextPaint } from "../core/types.ts";
import { apply, axisAligned, cssPx, envelope, invert, multiply, overshootBeyond } from "./svg-viewport.ts";

// ---------------------------------------------------------------------------------------------
// Stated constants. Each is chosen, not fitted, and sized from a measurement named next to it.

/** The raster's target size: canvas px per em along the label's larger axis. */
export const RASTER_EM_DEVICE_PX = 128;
/** Below this many canvas px per em on the label's smaller axis the raster is not used. */
export const RASTER_MIN_EM_DEVICE_PX = 48;
/**
 * The raster is never coarser than this many canvas px per screen px. At 128 px per em an 80 px
 * label would be rastered at 1.6 px per screen px, and its two-pixel margin would be 1.25 px wide
 * (measured on the miter fixture: an inner box 1.5 px short of the glyphs).
 */
export const RASTER_MIN_PER_SCREEN_PX = 8;
/** Largest canvas side the raster allocates. */
export const RASTER_MAX_CANVAS_PX = 8192;
/** Longest label the raster is attempted for, in UTF-16 units, and most word boundaries compared. */
export const RASTER_MAX_CHARS = 512;
export const RASTER_MAX_CHECKPOINTS = 128;
/**
 * How far a raster edge may sit from the glyph outline, in canvas px, either way: one pixel of
 * rounding-out (a pixel counts as ink if the outline touches it at all), half a pixel of hinting
 * either way, and half a pixel to spare. Measured worst: +1.36 / −0.61 (see the module comment).
 */
export const RASTER_MARGIN_CANVAS_PX = 2;
/**
 * How far the canvas and the SVG may place a glyph apart and still be one font, one shaping.
 *
 * SVG text is laid out with the font scaled to device pixels and its advances kept in LayoutUnits
 * of 1/64 px, so each glyph's position can drift from the canvas's float advances by up to 1/64
 * device px per preceding glyph. Measured on Chromium 141 with kerning off on both sides, 72 labels
 * over 9 fonts and 8 scales from 0.37 to 3: the largest drift at any glyph was 0.76 of that bound
 * (36 × "i" at scale 0.61: 0.64 px), and it tracks the drift at the run's end to within 0.049 px.
 * The canvas also shapes word by word and the SVG the whole run, so a font that kerns a letter
 * against a space moves every later word (measured: "A label, well inside" in DejaVu Serif, 0.79 px
 * after the "A"). The comparison is therefore made at every word boundary and at the end, each
 * against ADVANCE_TOLERANCE_PX plus the quantization of the glyphs before it; a mismatch anywhere
 * is a different layout and the raster is refused. What agrees is still a drift, and the largest
 * one any glyph can have between two agreeing checkpoints becomes margin along the baseline.
 * Under spacingAndGlyphs `getComputedTextLength()` itself departs from end − start by about that
 * much (measured 0.033 px at textLength 130).
 */
export const ADVANCE_TOLERANCE_PX = 0.05;
export const ADVANCE_TOLERANCE_RATIO = 0.0005;
export const LAYOUT_UNIT_DEVICE_PX = 1 / 64;
/** How far `getEndPositionOfChar(n − 1)` may sit from start + advance, in user units. Measured: 0. */
export const POSITION_TOLERANCE = 0.01;
/**
 * The fallback's glyph overhang beyond the cell, in em of the largest font size in the text, plus
 * one device px for hinting. Chromium's `getBBox()` for text is the cell united with the glyph ink
 * bounds of the font it draws with (LayoutNG `FragmentItem::ObjectBoundingBox`), so the outlines
 * reach past it only by what hinting moves: measured at most 0.0039 em over 112 labels with tspans,
 * per-glyph lists, rotate, textLength and textPath, and 0.033 em (0.39 px, a 12 px bold FreeSerif
 * label) over 195 single-run labels. 0.1 em is three times the worst and stays a stated margin —
 * a font whose ink escapes its own glyph bounds by more is outside what this bound claims.
 */
export const CELL_OVERHANG_EM = 0.1;
export const HINTING_DEVICE_PX = 1;

// ---------------------------------------------------------------------------------------------
// Raw facts, as the page ships them (src/measure/snapshot.ts, SNAPSHOT_SOURCE)

/** Computed paint of the `<text>` or of one rendered element descendant. */
export interface RawPaintElement {
  /** Lower-case local name; `text` for the target itself. */
  tag: string;
  fill: string;
  fillOpacity: string;
  stroke: string;
  strokeOpacity: string;
  strokeWidth: string;
  strokeLinejoin: string;
  strokeMiterlimit: string;
  strokeDasharray: string;
  strokeLinecap: string;
  vectorEffect: string;
  textShadow: string;
  textDecorationLine: string;
  clipPath: string;
  mask: string;
  maskImage: string;
  filter: string;
  fontSize: string;
  /** The element's textLength and lengthAdjust attributes: a spacingAndGlyphs scale stretches its stroke. */
  textLength: string | null;
  lengthAdjust: string | null;
}
export const PAINT_KEYS = [
  "fill", "fillOpacity", "stroke", "strokeOpacity", "strokeWidth", "strokeLinejoin", "strokeMiterlimit",
  "strokeDasharray", "strokeLinecap", "vectorEffect", "textShadow", "textDecorationLine", "clipPath", "mask",
  "maskImage", "filter", "fontSize",
] as const;

/** An ancestor of the text with any effect. `textDecorationLine` is null outside the SVG tree. */
export interface RawAncestorEffects {
  clipPath: string;
  mask: string;
  maskImage: string;
  filter: string;
  textDecorationLine: string | null;
}

export interface RawTextPaint {
  /**
   * A `rotate` attribute on the text or on any descendant, whatever its value (WP-S1's decline,
   * kept exactly): per-glyph rotation turns each glyph about its own origin, and under
   * spacingAndGlyphs Chromium 141 draws ink 2.25 px beyond the getBBox() cell.
   */
  perGlyphRotate: boolean;
  /** [0] is the `<text>`; then every rendered element descendant, document order. */
  elements: RawPaintElement[];
  /** Ancestors (parent upward) with a clip-path, mask, filter or, inside the SVG, decoration. */
  ancestors: RawAncestorEffects[];
  /** Text of the rendered descendants: title, desc, metadata and display:none subtrees excluded. */
  renderedText: string;
}

/**
 * The CSS property name of a computed-style key, for the captured getPropertyValue: the collector
 * never reads a CSSStyleDeclaration property getter, which a document can shadow on the prototype
 * (G-73). Derived here, in Node, so no string method of the page stands between the key and the read.
 */
export function cssPropertyName(key: string): string {
  const kebab = key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
  return kebab.startsWith("webkit-") ? `-${kebab}` : kebab;
}
/** [key, CSS property name] pairs, as the collector reads them. */
export const cssPairs = (keys: readonly string[]): [string, string][] => keys.map((key) => [key, cssPropertyName(key)]);

/** Computed properties the simple-label test reads. */
export const LABEL_STYLE_KEYS = [
  "fontStyle", "fontWeight", "fontStretch", "fontSize", "fontFamily", "fontVariantCaps", "fontVariantLigatures",
  "fontVariantNumeric", "fontVariantEastAsian", "fontVariantAlternates", "fontVariantPosition", "fontVariantEmoji",
  "fontFeatureSettings", "fontVariationSettings", "fontKerning", "fontOpticalSizing", "fontSizeAdjust",
  "fontSynthesisWeight", "fontSynthesisStyle", "fontSynthesisSmallCaps", "fontPalette", "letterSpacing", "wordSpacing",
  "textTransform", "textRendering", "writingMode", "direction", "unicodeBidi", "dominantBaseline", "alignmentBaseline",
  "baselineShift", "whiteSpaceCollapse", "textAutospace", "textSpacingTrim", "webkitLocale", "webkitTextStrokeWidth",
] as const;
export type LabelStyle = Record<(typeof LABEL_STYLE_KEYS)[number], string>;

/** The canvas font state the raster sets, derived from the computed style (`canvasSpecFor`). */
export interface CanvasTextSpec {
  font: string;
  fontSize: string;
  letterSpacing: string;
  wordSpacing: string;
  fontKerning: string;
  fontStretch: string;
  fontVariantCaps: string;
  textRendering: string;
  lang: string;
}

export interface RawTextRaster {
  /** The string drawn: the rendered characters. */
  text: string;
  spec: CanvasTextSpec;
  /** `ctx.font` read back after a sentinel font was set, before the spec. */
  sentinel: string;
  /** The canvas state read back after the spec was set, on the canvas that was drawn. */
  applied: Partial<Record<keyof CanvasTextSpec | "direction", string>>;
  /** `measureText()` at the label's own size, untransformed. */
  metrics: { width: number; left: number; right: number; ascent: number; descent: number };
  /** `measureText()` widths of the text up to each checkpoint, in order. */
  prefixes: number[];
  /** The linear part of the text's getCTM() the label was drawn through: [a, b, c, d]. */
  linear: number[];
  /** The horizontal scale applied before it: 1, or the SVG advance over the canvas advance. */
  scaleX: number;
  /** Canvas px per unit of the text's viewport space, the text origin in canvas px, canvas size. */
  k: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
  /** First covered column, first covered row, one past the last of each, in canvas px; null: none. */
  ink: [number, number, number, number] | null;
}

export interface RawTextLabel {
  elementChildren: number;
  textContent: string;
  attributes: { x: string | null; y: string | null; dx: string | null; dy: string | null; rotate: string | null; textLength: string | null; lengthAdjust: string | null };
  style: LabelStyle;
  /**
   * getNumberOfChars, start of char 0, end of char n−1, getComputedTextLength, rotation of char 0,
   * and [index, x, y] for the start of each word-boundary checkpoint.
   */
  positions: { chars: number; start: [number, number] | null; end: [number, number] | null; advance: number; rotation: number | null; at: [number, number, number][] } | null;
  raster: RawTextRaster | null;
}

// ---------------------------------------------------------------------------------------------
// Box arithmetic

function grow(box: Box, dx: number, dy = dx): Box {
  return { x: box.x - dx, y: box.y - dy, width: box.width + 2 * dx, height: box.height + 2 * dy };
}

function contains(outer: Box, inner: Box, slack = 0): boolean {
  return inner.x >= outer.x - slack && inner.y >= outer.y - slack &&
    inner.x + inner.width <= outer.x + outer.width + slack && inner.y + inner.height <= outer.y + outer.height + slack;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const linearOf = (m: AffineMatrix): AffineMatrix => [m[0], m[1], m[2], m[3], 0, 0];

/**
 * Units per device px under a map to the screen: 1 / its smallest singular value, so the conversion
 * is right in the direction that shrinks most. Breaklint renders at device pixel ratio 1, where a
 * device px is a CSS px; at a higher ratio this overstates the device px, which only widens the
 * margins it sizes.
 */
export function unitsPerDevicePx(toScreen: AffineMatrix): number {
  const [a, b, c, d] = toScreen;
  const sum = a * a + b * b + c * c + d * d;
  const det = a * d - b * c;
  const smallest = Math.sqrt(Math.max(0, (sum - Math.sqrt(Math.max(0, sum * sum - 4 * det * det))) / 2));
  return smallest > 0 ? 1 / smallest : Infinity;
}

// ---------------------------------------------------------------------------------------------
// Paint: what can paint, and how far beyond the outlines

const transparentPaint = (value: string): boolean => value === "transparent"
  || /^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/u.test(value)
  || /\/\s*0(?:\.0+)?%?\s*\)$/u.test(value);
const opacityOf = (value: string): number => { const n = parseFloat(value); return Number.isFinite(n) ? n : 1; };
/** The same test the page applies to decide whether a target paints at all. */
export const visiblePaint = (value: string, opacity: string): boolean =>
  value !== "none" && value !== "" && opacityOf(opacity) > 0 && !transparentPaint(value);
/**
 * Only a width that computes to a plain px length of (almost) zero paints no stroke. A percentage
 * or calc() is NOT zero here: read with parseFloat, "calc(2px + 5%)" is NaN, and a stroke that
 * paints would have been taken for none — the one direction this bound must never err in.
 */
const zeroLength = (value: string): boolean => { const px = cssPx(value); return px !== null && Math.abs(px) <= 0.001; };
const effect = (value: string | null | undefined): boolean => !!value && value !== "none" && !value.startsWith("none ");
const strokeVisible = (element: RawPaintElement): boolean =>
  visiblePaint(element.stroke, element.strokeOpacity) && !zeroLength(element.strokeWidth);
const dashed = (element: RawPaintElement): boolean => element.strokeDasharray !== "none" && element.strokeDasharray !== "";

export type PaintUnsupported =
  | "per-glyph-rotate" | "paint-server" | "text-shadow" | "text-decoration" | "clip-mask-filter" | "stroke-width"
  | "non-scaling-stroke" | "line-join" | "line-cap" | "miter-limit" | "font-size";

export type PaintClassification =
  | { ok: true; strokePad: number; emMax: number; fillVisible: boolean; dashedStrokeOnly: boolean; stretched: boolean }
  | { ok: false; reason: PaintUnsupported };

/**
 * Whether this target's paint is bounded here, and the stroke pad if so. Every element that paints
 * the text is inspected — the `<text>` and every rendered `<tspan>`, `<textPath>` and `<a>` inside
 * it — because a descendant's own paint is drawn with the same glyphs. Up to this build only the
 * `<text>` was read, so a tspan with a stroke, a shadow or a paint server was measured as bare
 * glyphs.
 *
 * The stroke pad: a stroke paints within stroke-width/2 of the outline, except at joins and caps.
 * A miter join's tip lies (sw/2)/sin(θ/2) from its vertex and is beveled beyond miterlimit · sw/2,
 * so k = max(1, miterlimit); round and bevel joins stay within sw/2 (k = 1); outlines are closed, so
 * caps only exist on a dashed stroke, where a square cap's corner lies √2 · sw/2 from its end.
 * Measured on Chromium 141 over 320 stroked labels (4 fonts, 5 strings, sw 4/6/8): miter factor
 * ≤ 1 at limit 1, 1.5 at 2, 2.56 at 4 (the default), 8.81 at 10; round 1.06 and bevel 1.00 (the
 * 1/8 px screenshot rim); dashed square caps 1.375 — every one within k. The stroke width is a user-
 * space length only when it computes to an absolute px value; a percentage or calc() resolves
 * against a viewport diagonal this does not model, and `vector-effect: non-scaling-stroke` draws it
 * in screen space (measured: a 1 px user-space pad under a scale of 0.25 missed 3 px of ink), so
 * both are declines. So are joins other than miter, round and bevel.
 */
export function classifyPaint(paint: RawTextPaint): PaintClassification {
  // First, and alone: WP-S1 declines per-glyph rotation before anything else is asked of the paint,
  // so a rotated label has exactly one reason, never a raster fallback beside it.
  if (paint.perGlyphRotate) return { ok: false, reason: "per-glyph-rotate" };
  let strokePad = 0;
  let emMax = 0;
  for (const element of paint.elements) {
    if (/url\(/u.test(element.fill) || /url\(/u.test(element.stroke)) return { ok: false, reason: "paint-server" };
    if (effect(element.textShadow)) return { ok: false, reason: "text-shadow" };
    if (effect(element.textDecorationLine)) return { ok: false, reason: "text-decoration" };
    if (effect(element.clipPath) || effect(element.mask) || effect(element.maskImage) || effect(element.filter)) return { ok: false, reason: "clip-mask-filter" };
    const size = cssPx(element.fontSize);
    if (size === null || size < 0) return { ok: false, reason: "font-size" };
    emMax = Math.max(emMax, size);
    if (!strokeVisible(element)) continue;
    const width = cssPx(element.strokeWidth);
    if (width === null || width < 0) return { ok: false, reason: "stroke-width" };
    if (element.vectorEffect !== "none") return { ok: false, reason: "non-scaling-stroke" };
    if (!["miter", "round", "bevel"].includes(element.strokeLinejoin)) return { ok: false, reason: "line-join" };
    if (!["butt", "round", "square"].includes(element.strokeLinecap)) return { ok: false, reason: "line-cap" };
    const limit = Number(element.strokeMiterlimit);
    if (!Number.isFinite(limit) || limit < 1) return { ok: false, reason: "miter-limit" };
    let k = element.strokeLinejoin === "miter" ? Math.max(1, limit) : 1;
    if (dashed(element) && element.strokeLinecap === "square") k = Math.max(k, Math.SQRT2);
    strokePad = Math.max(strokePad, (k * width) / 2);
  }
  for (const ancestor of paint.ancestors) {
    if (effect(ancestor.clipPath) || effect(ancestor.mask) || effect(ancestor.maskImage) || effect(ancestor.filter)) return { ok: false, reason: "clip-mask-filter" };
    if (effect(ancestor.textDecorationLine)) return { ok: false, reason: "text-decoration" };
  }
  const own = paint.elements[0];
  const fillVisible = !!own && visiblePaint(own.fill, own.fillOpacity);
  // A dashed stroke need not pass over the outline's extreme points, so with no fill to cover them
  // nothing proves the ink reaches the outline bbox: no inner box, still an outer one.
  const dashedStrokeOnly = !!own && !fillVisible && strokeVisible(own) && dashed(own);
  // spacingAndGlyphs scales the glyphs of its run along the baseline, and the stroke painted with
  // them (measured on Chromium 141: a round 6-unit stroke on a run stretched about 3× reached
  // 0.5 px past the unstretched pad). Only a raster that knows the scale can bound it.
  const stretched = paint.elements.some((element) => element.textLength !== null && element.lengthAdjust === "spacingAndGlyphs");
  return { ok: true, strokePad, emMax, fillVisible, dashedStrokeOnly, stretched };
}

/**
 * Whether the text holds a character that can draw anything: not white space, not a control, not
 * default-ignorable. Used only for the fallback's "entirely outside, so not drawn" claim.
 */
export function textCanPaint(text: string): boolean {
  return /[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}]/u.test(text);
}

// ---------------------------------------------------------------------------------------------
// The simple label and its raster

export const STRETCH_KEYWORDS: Readonly<Record<string, string>> = {
  "50%": "ultra-condensed", "62.5%": "extra-condensed", "75%": "condensed", "87.5%": "semi-condensed", "100%": "normal",
  "112.5%": "semi-expanded", "125%": "expanded", "150%": "extra-expanded", "200%": "ultra-expanded",
};
export const TEXT_RENDERING: Readonly<Record<string, string>> = {
  auto: "auto", optimizespeed: "optimizeSpeed", optimizelegibility: "optimizeLegibility", geometricprecision: "geometricPrecision",
};

/**
 * The canvas font state for a computed style, or null when the canvas cannot carry it. The page
 * applies the same mapping (it has to, to draw); this is the copy Node checks the page against, so
 * a mapping the two sides disagree on is a decline rather than a raster of some other font.
 */
export function canvasSpecFor(style: LabelStyle): CanvasTextSpec | null {
  const fontStretch = STRETCH_KEYWORDS[style.fontStretch];
  const textRendering = TEXT_RENDERING[style.textRendering.toLowerCase()];
  if (!fontStretch || !textRendering) return null;
  const locale = style.webkitLocale;
  const lang = !locale || locale === "auto" ? "inherit" : locale.replace(/^"|"$/gu, "");
  return {
    font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
    fontSize: style.fontSize,
    letterSpacing: style.letterSpacing === "normal" ? "0px" : style.letterSpacing,
    wordSpacing: style.wordSpacing,
    fontKerning: style.fontKerning,
    fontStretch,
    fontVariantCaps: style.fontVariantCaps,
    textRendering,
    lang,
  };
}

/** The characters an SVG text node renders under `white-space-collapse: collapse`. */
export function collapsedCharacters(textContent: string, whiteSpaceCollapse: string): string | null {
  if (whiteSpaceCollapse !== "collapse") return null;
  return textContent.replace(/[\t\n\r ]+/gu, " ").replace(/^ | $/gu, "");
}

/**
 * The word boundaries of a rendered run: every index where a space begins or ends. The page takes
 * the same indices (it has to, to measure there); Node recomputes them and compares.
 */
export function wordBoundaries(text: string): number[] {
  const out: number[] = [];
  for (let index = 1; index < text.length; index += 1) if (text[index] === " " || text[index - 1] === " ") out.push(index);
  return out;
}

/** Hebrew, Arabic, Syriac, Thaana, NKo and the rest of the right-to-left blocks, and bidi controls. */
const RIGHT_TO_LEFT = /[\u{0590}-\u{08FF}\u{FB1D}-\u{FDFF}\u{FE70}-\u{FEFF}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;
/** Han, kana, Hangul, Bopomofo and the CJK punctuation and fullwidth forms. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\u{3000}-\u{303F}\u{FF00}-\u{FFEF}]/u;

const listLength = (value: string | null): number => (value ?? "").trim().split(/[\s,]+/u).filter(Boolean).length;
const zeroList = (value: string | null): boolean =>
  (value ?? "").trim().split(/[\s,]+/u).filter(Boolean).every((token) => Number(token) === 0);

/** Font and text properties the canvas state cannot express, at the only values it reproduces. */
const NEUTRAL: Readonly<Partial<Record<keyof LabelStyle, readonly string[]>>> = {
  fontVariantLigatures: ["normal"], fontVariantNumeric: ["normal"], fontVariantEastAsian: ["normal"],
  fontVariantAlternates: ["normal"], fontVariantPosition: ["normal"], fontVariantEmoji: ["normal"],
  fontFeatureSettings: ["normal"], fontVariationSettings: ["normal"], fontOpticalSizing: ["auto"], fontSizeAdjust: ["none"],
  fontSynthesisWeight: ["auto"], fontSynthesisStyle: ["auto"], fontSynthesisSmallCaps: ["auto"], fontPalette: ["normal"],
  textTransform: ["none"], webkitTextStrokeWidth: ["0px"], fontKerning: ["auto", "normal", "none"],
  fontVariantCaps: ["normal", "small-caps", "all-small-caps", "petite-caps", "all-petite-caps", "unicase", "titling-caps"],
};

export type SimpleInk =
  | { ok: true; innerLocal: Box | null; outerLocal: Box; scaleX: number }
  | { ok: false; diagnostic: SvgInkDiagnostic };

/** What the raster needs of the target besides its label: its geometry in the frame. */
export interface TargetFrameFacts {
  /** getBBox() in user space. */
  bboxUser: Box;
  /** The text's own getCTM(): user space → its nearest viewport. */
  ctm: AffineMatrix;
  /** User space → the local frame. */
  userToLocal: AffineMatrix;
  /** The local frame → screen CSS px. */
  localToScreen: AffineMatrix;
}

/**
 * The raster bound of a label, in the local frame, or the first reason it is not one.
 *
 * The raster was drawn through the linear part of the text's own CTM, so its covered columns and
 * rows are axis-aligned in the text's VIEWPORT space; what remains to the local frame is the
 * nested viewports' map, which the frame resolver only admits when it is axis-aligned (a scale,
 * a flip, a quarter turn), and under which a box stays a box. A rotated label is therefore bounded
 * as tightly as an upright one — the user-space box of its ink, rotated and enveloped, would claim
 * ink in corners where there is none.
 *
 * The SVG's own box of the label (`bboxUser`) already unites, in Chromium, the cell with the glyph
 * bounds of the font it draws with: an inner box reaching past it by more than a device px means
 * the canvas drew something the SVG did not, and the raster is refused.
 */
export function simpleLabelInk(label: RawTextLabel, facts: TargetFrameFacts): SimpleInk {
  const fail = (diagnostic: SvgInkDiagnostic): SimpleInk => ({ ok: false, diagnostic });
  if (label.elementChildren !== 0) return fail("element-children");
  const { attributes, style } = label;
  if ([attributes.x, attributes.y, attributes.dx, attributes.dy].some((value) => listLength(value) > 1) || !zeroList(attributes.rotate)) {
    return fail("positioning-lists");
  }
  const lengthAdjusted = attributes.textLength !== null;
  if (lengthAdjusted && attributes.lengthAdjust !== "spacingAndGlyphs") return fail("length-adjust");
  if (style.writingMode !== "horizontal-tb" || style.direction !== "ltr" || style.unicodeBidi !== "normal") return fail("writing-direction");
  if (!["auto", "alphabetic"].includes(style.dominantBaseline) || !["auto", "baseline", "alphabetic"].includes(style.alignmentBaseline) ||
      style.baselineShift !== "0px") {
    return fail("baseline");
  }
  for (const [key, allowed] of Object.entries(NEUTRAL) as [keyof LabelStyle, readonly string[]][]) {
    if (!allowed.includes(style[key])) return fail("font-properties");
  }
  const size = cssPx(style.fontSize);
  const spec = canvasSpecFor(style);
  if (size === null || size <= 0 || !spec || cssPx(spec.letterSpacing) === null || cssPx(spec.wordSpacing) === null) return fail("font-properties");
  const rendered = collapsedCharacters(label.textContent, style.whiteSpaceCollapse);
  if (rendered === null) return fail("white-space");
  if (RIGHT_TO_LEFT.test(rendered)) return fail("writing-direction");
  // A spacingAndGlyphs scale hides the advance, which is the font check below. What it cannot
  // compensate for is then kept out: spacing distributed between glyphs, and the CJK spacing
  // (text-autospace, text-spacing-trim) the SVG applies and the canvas does not — measured, a
  // lang="ja" label with Latin letters ran 2 px longer in the SVG than on the canvas.
  if (lengthAdjusted && (CJK.test(rendered) || cssPx(spec.letterSpacing) !== 0 || cssPx(spec.wordSpacing) !== 0)) return fail("length-adjust");
  const positions = label.positions;
  if (!positions || positions.chars !== rendered.length || rendered.length === 0) return fail("white-space");
  const { start, end, advance, rotation } = positions;
  if (!start || !end || ![...start, ...end, advance].every(finite) || rotation !== 0 || advance <= 0 ||
      Math.abs(end[1] - start[1]) > POSITION_TOLERANCE) {
    return fail("positions");
  }
  const run = end[0] - start[0];
  if (Math.abs(run - advance) > (lengthAdjusted ? ADVANCE_TOLERANCE_PX + ADVANCE_TOLERANCE_RATIO * run : POSITION_TOLERANCE)) return fail("positions");
  const raster = label.raster;
  const ctmLinear = linearOf(facts.ctm);
  if (!raster || raster.text !== rendered || JSON.stringify(raster.spec) !== JSON.stringify(spec) ||
      raster.applied.font === undefined || raster.applied.font === raster.sentinel ||
      (["letterSpacing", "wordSpacing", "fontKerning", "fontStretch", "fontVariantCaps", "textRendering"] as const)
        .some((key) => raster.applied[key] !== spec[key]) ||
      (spec.lang !== "inherit" && raster.applied.lang !== spec.lang) || raster.applied.direction !== "ltr" ||
      ![raster.k, raster.originX, raster.originY, raster.width, raster.height, raster.metrics.width, raster.scaleX].every(finite) ||
      raster.k <= 0 || !(raster.metrics.width > 0) ||
      raster.linear.length !== 4 || raster.linear.some((value, index) => value !== ctmLinear[index])) {
    return fail("raster-unavailable");
  }
  // The scale along the baseline: 1, or under spacingAndGlyphs the SVG run over the natural one.
  const expectedScale = lengthAdjusted ? run / raster.metrics.width : 1;
  if (Math.abs(raster.scaleX - expectedScale) > 1e-9 * Math.max(1, expectedScale)) return fail("raster-unavailable");
  // Glyph placement, compared at every word boundary and at the end. Each checkpoint may disagree
  // by the float allowance plus the LayoutUnit quantization of the glyphs before it (in user
  // units, through the text's scale to device px); more is a different layout. Under
  // spacingAndGlyphs the end agrees by construction, and the boundaries between still test the font.
  const checkpoints = wordBoundaries(rendered);
  if (checkpoints.length > RASTER_MAX_CHECKPOINTS) return fail("raster-unavailable");
  const at = positions.at;
  if (at.length !== checkpoints.length || raster.prefixes.length !== checkpoints.length ||
      at.some(([index, x, y], position) => index !== checkpoints[position] || !finite(x) || !finite(y) || Math.abs(y - start[1]) > POSITION_TOLERANCE) ||
      !raster.prefixes.every(finite)) {
    return fail("positions");
  }
  const quantum = LAYOUT_UNIT_DEVICE_PX * unitsPerDevicePx(multiply(facts.localToScreen, facts.userToLocal)) * Math.max(1, raster.scaleX);
  const marks: [number, number][] = [[0, 0], ...at.map(([index, x], position): [number, number] => [index, raster.scaleX * raster.prefixes[position]! - (x - start[0])]),
    [rendered.length, raster.scaleX * raster.metrics.width - run]];
  for (const [index, drift] of marks) {
    if (Math.abs(drift) > ADVANCE_TOLERANCE_PX + index * quantum) return fail("advance-mismatch");
  }
  // Between two agreeing checkpoints a glyph drifts at most one quantum per glyph from either end,
  // so no further than half their drifts plus the segment's quantization.
  let advanceError = 0;
  for (let segment = 1; segment < marks.length; segment += 1) {
    const [a, driftA] = marks[segment - 1]!;
    const [b, driftB] = marks[segment]!;
    advanceError = Math.max(advanceError, Math.abs(driftA), Math.abs(driftB), (Math.abs(driftA) + Math.abs(driftB) + (b - a) * quantum) / 2);
  }
  advanceError += ADVANCE_TOLERANCE_PX;
  if (!raster.ink) return fail("raster-empty");
  const [left, top, right, bottom] = raster.ink;
  if (![left, top, right, bottom].every(finite)) return fail("raster-unavailable");
  if (left <= 0 || top <= 0 || right >= raster.width || bottom >= raster.height) return fail("raster-edge");
  // Canvas px → the text's viewport space relative to the mapped origin → the local frame. The map
  // left is the nested viewports' (userToLocal · ctm⁻¹); a box stays a box under it only if it is
  // axis-aligned, which the frame resolver guarantees and this re-checks.
  const ctmInverse = invert(ctmLinear);
  if (!ctmInverse) return fail("raster-unavailable");
  const viewportToLocal = multiply(linearOf(facts.userToLocal), ctmInverse);
  if (!axisAligned(viewportToLocal)) return fail("raster-unavailable");
  const relative: Box = {
    x: (left - raster.originX) / raster.k, y: (top - raster.originY) / raster.k,
    width: (right - left) / raster.k, height: (bottom - top) / raster.k,
  };
  const [ox, oy] = apply(facts.userToLocal, start[0], start[1]);
  const placed = envelope(relative, viewportToLocal);
  const ink: Box = { x: ox + placed.x, y: oy + placed.y, width: placed.width, height: placed.height };
  // Margins in the local frame: the raster margin through the viewport map, plus the advance error
  // along the user-space baseline through the whole linear map.
  const e = RASTER_MARGIN_CANVAS_PX / raster.k;
  const [ta, tb, tc, td] = viewportToLocal;
  const [ma, mb] = facts.userToLocal;
  const ex = e * (Math.abs(ta) + Math.abs(tc)) + advanceError * Math.abs(ma);
  const ey = e * (Math.abs(tb) + Math.abs(td)) + advanceError * Math.abs(mb);
  const outerLocal = grow(ink, ex, ey);
  const innerWidth = ink.width - 2 * ex;
  const innerHeight = ink.height - 2 * ey;
  const innerLocal: Box | null = innerWidth >= 0 && innerHeight >= 0 ? { x: ink.x + ex, y: ink.y + ey, width: innerWidth, height: innerHeight } : null;
  const devicePx = unitsPerDevicePx(facts.localToScreen);
  const cellLocal = envelope(facts.bboxUser, facts.userToLocal);
  if (innerLocal && !contains(cellLocal, innerLocal, HINTING_DEVICE_PX * devicePx + POSITION_TOLERANCE)) return fail("raster-exceeds-cell");
  return { ok: true, innerLocal, outerLocal, scaleX: raster.scaleX };
}

/** The fallback: the cell grown by the stated glyph overhang, carried into the frame. */
export function cellInkOuterLocal(bboxUser: Box, emMax: number, userToLocal: AffineMatrix, localToScreen: AffineMatrix): Box {
  return grow(envelope(grow(bboxUser, CELL_OVERHANG_EM * emMax), userToLocal), HINTING_DEVICE_PX * unitsPerDevicePx(localToScreen));
}

/**
 * One target's `paint`, or null when its frame gives no finite device px (a degenerate map: the
 * caller counts the target as unreadable).
 */
export function textPaint(
  label: RawTextLabel,
  paint: RawTextPaint,
  classified: Extract<PaintClassification, { ok: true }>,
  facts: TargetFrameFacts,
): SvgTextPaint | "unsupported" | null {
  if (!Number.isFinite(unitsPerDevicePx(facts.localToScreen))) return null;
  const simple = simpleLabelInk(label, facts);
  if (simple.ok) {
    return {
      inkSource: "canvas-raster",
      inkDiagnostic: classified.dashedStrokeOnly ? "dashed-stroke-only" : null,
      inkInnerLocal: classified.dashedStrokeOnly ? null : simple.innerLocal,
      inkOuterLocal: simple.outerLocal,
      strokePad: classified.strokePad,
      strokeScaleX: simple.scaleX,
      paints: true,
    };
  }
  // A stroke on a spacingAndGlyphs run the raster did not reproduce: stretched by a scale nothing
  // measured, so no pad bounds it. The glyphs alone are still bounded by the cell, which Chromium
  // unites with their stretched ink bounds.
  if (classified.stretched && classified.strokePad > 0) return "unsupported";
  return {
    inkSource: "cell",
    inkDiagnostic: simple.diagnostic,
    inkInnerLocal: null,
    inkOuterLocal: cellInkOuterLocal(facts.bboxUser, classified.emMax, facts.userToLocal, facts.localToScreen),
    strokePad: classified.strokePad,
    strokeScaleX: 1,
    paints: textCanPaint(paint.renderedText),
  };
}

// ---------------------------------------------------------------------------------------------
// The two bounds against the clip chain, and the verdict they support

/**
 * A box containing every painted pixel of the target, in the local frame: the glyph box grown by
 * the stroke pad. The pad is a disc of radius `strokePad` in user space, stretched along the
 * baseline by `strokeScaleX`; through the linear map it is an ellipse whose half-extents are the
 * pad times the norms of the rows of map · diag(strokeScaleX, 1).
 */
export function paintOuterLocal(paint: SvgTextPaint, userToLocal: AffineMatrix): Box {
  const [a, b, c, d] = userToLocal;
  const s = paint.strokeScaleX;
  return grow(paint.inkOuterLocal, paint.strokePad * Math.hypot(a * s, c), paint.strokePad * Math.hypot(b * s, d));
}

/** How far a box lies beyond some clip in its whole extent: positive only when it misses the clip. */
function separation(box: Box, clips: readonly Box[]): number {
  let worst = -Infinity;
  for (const clip of clips) {
    worst = Math.max(worst, clip.x - (box.x + box.width), box.x - (clip.x + clip.width), clip.y - (box.y + box.height), box.y - (clip.y + clip.height));
  }
  return worst;
}

export interface LowerBound {
  /** At least this much of the painted ink lies beyond the clip chain, in frame px. */
  value: number;
  /** `ink`: the inner box reaches past the edge. `separated`: all of the ink lies beyond an edge. */
  claim: "ink" | "separated";
}

/**
 * The provable part of the overshoot: what the ink certainly reaches beyond the clip chain, or null
 * when nothing can be claimed. Two claims, each sound on its own, and the larger is kept:
 *   - the inner box: the glyph ink reaches each of its edges, so its overshoot is the ink's at least;
 *   - separation: the box containing ALL painted ink misses a clip entirely, so every ink point lies
 *     at least that far beyond it — made only for text that paints something.
 */
export function lowerBoundOvershoot(paint: SvgTextPaint, userToLocal: AffineMatrix, clips: readonly Box[]): LowerBound | null {
  let best: LowerBound | null = null;
  if (paint.inkInnerLocal) best = { value: overshootBeyond(paint.inkInnerLocal, clips), claim: "ink" };
  if (paint.paints) {
    const apart = separation(paintOuterLocal(paint, userToLocal), clips);
    if (apart > 0 && (best === null || apart > best.value)) best = { value: apart, claim: "separated" };
  }
  return best;
}

/** The most the painted ink can reach beyond the clip chain, in frame px. */
export function upperBoundOvershoot(paint: SvgTextPaint, userToLocal: AffineMatrix, clips: readonly Box[]): number {
  return overshootBeyond(paintOuterLocal(paint, userToLocal), clips);
}

export type BracketVerdict = "violated" | "clear" | "inconclusive";

/**
 * The verdict two bounds support, at the rule's stated resolution `epsilon`
 * (SVG_OVERSHOOT_EPSILON_PX: a frame value is within it of the browser's, or the frame is declined).
 * The same discipline on both sides as the frame decision itself: the lower bound must exceed the
 * permitted overshoot by more than epsilon to be a finding — so the true ink overshoot exceeds it —
 * and the upper bound must not exceed it by more than epsilon to be silent — so no ink reaches more
 * than 2·epsilon past it, the documented resolution band in which a label may come out clean. The
 * band between the bounds is declined. Reporting on the upper bound would state an overshoot
 * nothing measured; staying silent on the lower bound would call ink drawn that may be clipped.
 */
export function bracketVerdict(lower: number | null, upper: number, permitted: number, epsilon: number): BracketVerdict {
  if (lower !== null && lower > permitted + epsilon) return "violated";
  if (upper <= permitted + epsilon) return "clear";
  return "inconclusive";
}
