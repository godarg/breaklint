/** Public host-page adapter. It observes an already-opened page and writes only its PNG artifact. */

import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXIT_CODE_BY_VERDICT, type RunVerdict } from "../core/enums.ts";
import { MAX_DRIFT_DETAILS, computeScreenDriftDetails, summarizeDriftDetails } from "../web/drift.ts";
import { evaluateScreenTargets, screenFindings } from "../web/evaluate.ts";
import { validateCheckPageOptions } from "../web/options.ts";
import { digestBrowserSample, sha, stable, type BrowserRawSample, type BrowserRawTarget, type RawSample, type RawSampleSignature } from "../web/raw-sample.ts";
import { verifyBinding, type Binding } from "../web/receipt.ts";
import {
  SCREEN_REPORT_SCHEMA_VERSION,
  type CheckPageOptions,
  type HostBuildContainerBinding,
  type PublicScreenReport,
  type ScreenCheckResult,
  type ScreenDriftDetail,
  type ScreenInfrastructureEvent,
  type ScreenRuleId,
  type StructuralPage,
} from "../web/types.ts";

export { computeScreenDriftDetails } from "../web/drift.ts";
export { verifyOutputReceipt } from "../web/receipt.ts";

const MAX_SIGNATURE_TEXT_BYTES = 1_024 * 1_024;
const MAX_SIGNATURE_ANCESTORS = 64;
const MAX_STABILIZATION_ATTEMPTS = 20;
const PHASE_BOUND_FLOOR_MS = 10_000;
const PHASE_BOUND_FACTOR = 5;
const DEFAULT_SMALL_TEXT_PX = 12;
const DEFAULT_SMALL_TOUCH_PX = 24;

const CSS_COLOR_SPACES = new Set([
  "srgb", "srgb-linear", "display-p3", "a98-rgb", "prophoto-rgb", "rec2020", "xyz", "xyz-d50", "xyz-d65",
]);

const COLOR_NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/u;
// Channel grammar per color function (CSS Color 4): n = number, p = percentage, a = angle (hue
// only), x = none. Legacy comma syntax exists only for rgb()/hsl() and has no `none`.
const COLOR_CHANNELS: ReadonlyMap<string, readonly string[]> = new Map([
  ["rgb", ["npx", "npx", "npx"]], ["rgba", ["npx", "npx", "npx"]], ["hsl", ["nax", "npx", "npx"]], ["hsla", ["nax", "npx", "npx"]],
  ["hwb", ["nax", "npx", "npx"]], ["lab", ["npx", "npx", "npx"]], ["oklab", ["npx", "npx", "npx"]], ["lch", ["npx", "npx", "nax"]],
  ["oklch", ["npx", "npx", "nax"]], ["color", ["npx", "npx", "npx"]],
]);
const LEGACY_COLOR_CHANNELS: ReadonlyMap<string, readonly string[]> = new Map([
  ["rgb", ["np", "np", "np"]], ["rgba", ["np", "np", "np"]], ["hsl", ["na", "p", "p"]], ["hsla", ["na", "p", "p"]],
]);

function colorChannelKind(token: string): string | null {
  if (token === "none") return "x";
  if (token.endsWith("%")) return COLOR_NUM_RE.test(token.slice(0, -1)) ? "p" : null;
  const angle = /^(.*?)(?:deg|grad|rad|turn)$/u.exec(token);
  if (angle) return COLOR_NUM_RE.test(angle[1]!) ? "a" : null;
  return COLOR_NUM_RE.test(token) ? "n" : null;
}
function colorChannelsValid(tokens: readonly string[], kinds: readonly string[]): boolean {
  return tokens.length === kinds.length && tokens.every((token, index) => { const kind = colorChannelKind(token); return kind !== null && kinds[index]!.includes(kind); });
}

function parseAlphaToken(token: string): number | null {
  const trimmed = token.trim().toLowerCase();
  if (trimmed === "none") return 0;
  if (trimmed.endsWith("%")) {
    const raw = trimmed.slice(0, -1);
    if (!COLOR_NUM_RE.test(raw)) return null;
    const num = Number(raw);
    return Number.isFinite(num) && num >= 0 && num <= 100 ? num / 100 : null;
  }
  if (!COLOR_NUM_RE.test(trimmed)) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) && num >= 0 && num <= 1 ? num : null;
}

/**
 * Parses the alpha channel (0..1) of a CSS Color 3 or CSS Color 4 computed color string, with the
 * channel grammar of each color function (an angle is only a hue). Returns null for unrecognized or
 * non-solid paint syntax (e.g. url(#gradient)), failing closed. The in-page sampler carries a copy
 * of this parser; a live differential test keeps both on one table.
 */
export function parseCssColorAlpha(color: string): number | null {
  const trimmed = color.trim().toLowerCase();
  if (trimmed === "transparent") return 0;
  const fnMatch = /^([a-z]+)\(([^()]+)\)$/u.exec(trimmed);
  if (!fnMatch) return null;
  const fn = fnMatch[1]!;
  const body = fnMatch[2]!.trim();
  const modern = COLOR_CHANNELS.get(fn);
  if (!modern) return null;
  if (body.includes(",")) {
    const legacy = LEGACY_COLOR_CHANNELS.get(fn);
    if (!legacy) return null;
    const parts = body.split(",").map((part) => part.trim());
    if (parts.length !== 3 && parts.length !== 4) return null;
    if (!colorChannelsValid(parts.slice(0, 3), legacy)) return null;
    return parts.length === 4 ? parseAlphaToken(parts[3]!) : 1;
  }
  const slashParts = body.split("/");
  if (slashParts.length > 2) return null;
  let tokens = slashParts[0]!.trim().split(/\s+/u).filter(Boolean);
  if (fn === "color") {
    if (!CSS_COLOR_SPACES.has(tokens[0] ?? "")) return null;
    tokens = tokens.slice(1);
  }
  if (!colorChannelsValid(tokens, modern)) return null;
  return slashParts.length === 2 ? parseAlphaToken(slashParts[1]!) : 1;
}

function pngSize(bytes: Uint8Array): { widthPx: number; heightPx: number } | null {
  if (bytes.length < 24 || Buffer.from(bytes.subarray(0, 8)).compare(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) !== 0) return null;
  return { widthPx: Buffer.from(bytes).readUInt32BE(16), heightPx: Buffer.from(bytes).readUInt32BE(20) };
}
function safeUrl(raw: string): string {
  try { const url = new URL(raw); url.search = ""; url.hash = ""; return url.toString(); }
  catch { return "about:invalid"; }
}
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<{ value: T | null; timedOut: boolean }> {
  let timer: NodeJS.Timeout | null = null;
  try { const value = await Promise.race([promise, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); })]); return { value, timedOut: value === null }; }
  finally { if (timer) clearTimeout(timer); }
}

/** Private sampler input. `colorProbe` lets the differential test run the in-page color parser on a table. */
export interface SampleInput { maxTargets: number; allowed: string[]; overlays: string[]; containers: string[]; fullPage: boolean; siblingOverlap: boolean; colorProbe?: string[] }

/** One in-page sample of the host page. Exported for tests only; not part of the public index. */
export async function samplePage(page: StructuralPage, input: SampleInput): Promise<RawSample> {
  const sampled: BrowserRawSample = await page.evaluate(async (options) => {
    type Box = { x: number; y: number; width: number; height: number };
    const sx = window.scrollX;
    const sy = window.scrollY;
    const coordSystem: "css-viewport-pixels" | "css-document-pixels" = options.fullPage ? "css-document-pixels" : "css-viewport-pixels";
    const toBox = (r: DOMRect): Box | null =>
      Number.isFinite(r.x) && Number.isFinite(r.y) && r.width >= 0 && r.height >= 0
        ? { x: options.fullPage ? r.x + sx : r.x, y: options.fullPage ? r.y + sy : r.y, width: r.width, height: r.height }
        : null;
    const contained = (outer: DOMRect, inner: DOMRect): "none" | "partial" | "outside" => {
      const left = Math.max(outer.left, inner.left), top = Math.max(outer.top, inner.top), right = Math.min(outer.right, inner.right), bottom = Math.min(outer.bottom, inner.bottom);
      if (right <= left || bottom <= top) return "outside";
      return left === inner.left && top === inner.top && right === inner.right && bottom === inner.bottom ? "none" : "partial";
    };
    const domPath = (node: Element): string => { const parts: string[] = []; let cur: Element | null = node; while (cur && parts.length < 16) { const parentElement: Element | null = cur.parentElement; const i = parentElement ? [...parentElement.children].indexOf(cur) + 1 : 1; parts.push(`${cur.tagName.toLowerCase()}:nth-child(${i})`); cur = parentElement; } return parts.reverse().join(">"); };
    const selector = (node: Element, fallback: string): string => node.id ? `#${CSS.escape(node.id)}` : fallback;

    // Copy of parseCssColorAlpha (no closure can cross into the page); the live differential test
    // runs both on one table through SampleInput.colorProbe.
    const colorSpaces = new Set(["srgb", "srgb-linear", "display-p3", "a98-rgb", "prophoto-rgb", "rec2020", "xyz", "xyz-d50", "xyz-d65"]);
    const colorNumRe = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/u;
    const colorChannels = new Map<string, readonly string[]>([
      ["rgb", ["npx", "npx", "npx"]], ["rgba", ["npx", "npx", "npx"]], ["hsl", ["nax", "npx", "npx"]], ["hsla", ["nax", "npx", "npx"]],
      ["hwb", ["nax", "npx", "npx"]], ["lab", ["npx", "npx", "npx"]], ["oklab", ["npx", "npx", "npx"]], ["lch", ["npx", "npx", "nax"]],
      ["oklch", ["npx", "npx", "nax"]], ["color", ["npx", "npx", "npx"]],
    ]);
    const legacyColorChannels = new Map<string, readonly string[]>([
      ["rgb", ["np", "np", "np"]], ["rgba", ["np", "np", "np"]], ["hsl", ["na", "p", "p"]], ["hsla", ["na", "p", "p"]],
    ]);
    const channelKind = (token: string): string | null => {
      if (token === "none") return "x";
      if (token.endsWith("%")) return colorNumRe.test(token.slice(0, -1)) ? "p" : null;
      const angle = /^(.*?)(?:deg|grad|rad|turn)$/u.exec(token);
      if (angle) return colorNumRe.test(angle[1]!) ? "a" : null;
      return colorNumRe.test(token) ? "n" : null;
    };
    const channelsValid = (tokens: readonly string[], kinds: readonly string[]): boolean =>
      tokens.length === kinds.length && tokens.every((token, index) => { const kind = channelKind(token); return kind !== null && kinds[index]!.includes(kind); });
    const parseAlphaToken = (token: string): number | null => {
      const t = token.trim().toLowerCase();
      if (t === "none") return 0;
      if (t.endsWith("%")) {
        const raw = t.slice(0, -1);
        if (!colorNumRe.test(raw)) return null;
        const n = Number(raw);
        return Number.isFinite(n) && n >= 0 && n <= 100 ? n / 100 : null;
      }
      if (!colorNumRe.test(t)) return null;
      const n = Number(t);
      return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
    };
    const alpha = (color: string): number | null => {
      const trimmed = color.trim().toLowerCase();
      if (trimmed === "transparent") return 0;
      const fnMatch = /^([a-z]+)\(([^()]+)\)$/u.exec(trimmed);
      if (!fnMatch) return null;
      const fn = fnMatch[1]!; const body = fnMatch[2]!.trim();
      const modern = colorChannels.get(fn);
      if (!modern) return null;
      if (body.includes(",")) {
        const legacy = legacyColorChannels.get(fn);
        if (!legacy) return null;
        const parts = body.split(",").map((part) => part.trim());
        if (parts.length !== 3 && parts.length !== 4) return null;
        if (!channelsValid(parts.slice(0, 3), legacy)) return null;
        return parts.length === 4 ? parseAlphaToken(parts[3]!) : 1;
      }
      const sp = body.split("/"); if (sp.length > 2) return null;
      let tokens = sp[0]!.trim().split(/\s+/u).filter(Boolean);
      if (fn === "color") { if (!colorSpaces.has(tokens[0] ?? "")) return null; tokens = tokens.slice(1); }
      if (!channelsValid(tokens, modern)) return null;
      return sp.length === 2 ? parseAlphaToken(sp[1]!) : 1;
    };
    const svgPaintAlpha = (paint: string, opacity: string): number | null => { if (paint.trim() === "none") return 0; const paintAlpha = alpha(paint); const componentOpacity = Number(opacity); return paintAlpha === null || !Number.isFinite(componentOpacity) || componentOpacity < 0 || componentOpacity > 1 ? null : paintAlpha * componentOpacity; };
    const transform = (style: CSSStyleDeclaration): string | null => { const v = style.transform; if (v === "none") return null; const match = v.match(/^matrix\(([^)]+)\)$/u); if (!match) return "unsupported-transform"; const n = match[1]!.split(",").map(Number); return n.length === 6 && Number.isFinite(n[0]) && Number.isFinite(n[3]) && n[0]! > 0 && n[3]! > 0 && n[1] === 0 && n[2] === 0 ? null : "unsupported-transform"; };
    const matchCount = (selectors: string[]): number[] => selectors.map((s) => { try { return document.querySelectorAll(s).length; } catch { return -1; } });
    const allowedCounts = matchCount(options.allowed), overlayCounts = matchCount(options.overlays);
    const isMatch = (node: Element, selectors: string[]): boolean => selectors.some((s) => { try { return node.matches(s) || !!node.closest(s); } catch { return false; } });
    // An allowed scroll container exempts only itself (its own horizontal overflow) and the
    // clipping it causes; its descendants stay measured.
    const isSelf = (node: Element, selectors: string[]): boolean => selectors.some((s) => { try { return node.matches(s); } catch { return false; } });
    // An exception that matches the document root or body exempts the whole page.
    const rootMatch = (selectors: string[]): boolean[] => selectors.map((s) => { try { return document.documentElement.matches(s) || !!document.body?.matches(s); } catch { return false; } });
    const containerIndex = (node: Element): number | null => { for (let i = 0; i < options.containers.length; i++) { try { if (node.closest(options.containers[i]!)) return i; } catch { return null; } } return null; };

    const visibleArea = options.fullPage
      ? new DOMRect(0, 0, Math.max(window.innerWidth, document.documentElement.scrollWidth), Math.max(window.innerHeight, document.documentElement.scrollHeight))
      : new DOMRect(0, 0, window.innerWidth, window.innerHeight);

    const paintValues = (style: CSSStyleDeclaration): string[] => [style.color, style.getPropertyValue("-webkit-text-fill-color"), style.backgroundColor, style.fill, style.getPropertyValue("fill-opacity"), style.stroke, style.getPropertyValue("stroke-opacity"), style.fontFamily, style.fontSize, style.fontWeight, style.fontStyle, style.fontStretch, style.fontKerning, style.lineHeight, style.letterSpacing, style.wordSpacing, style.opacity, style.filter, style.backdropFilter, style.maskImage, style.webkitMaskImage, style.clipPath, style.clip, style.transform];
    let signatureTextBytes = 0; let signatureTextComplete = true; let ancestorSignatureComplete = true;
    const nodes = [...document.querySelectorAll("*")]; const capped = nodes.length > options.maxTargets; const selected = nodes.slice(0, options.maxTargets);

    const INTERACTIVE_TAGS = new Set(["button", "select", "textarea", "summary"]);
    const INTERACTIVE_ROLES = new Set(["button", "link", "checkbox", "radio", "switch", "tab"]);
    const RUNNING_TEXT_INTERACTIVE = 'a[href], button, [role="link"], [role="button"]';
    const REPLACED_TAGS = new Set(["img", "video", "canvas", "input", "button", "select", "textarea", "iframe", "svg"]);

    const isInteractiveControl = (node: Element, tag: string): boolean => {
      if (INTERACTIVE_TAGS.has(tag)) return true;
      if (tag === "input" && (node.getAttribute("type") ?? "").toLowerCase() !== "hidden") return true;
      const role = (node.getAttribute("role") ?? "").trim().toLowerCase();
      if (INTERACTIVE_ROLES.has(role)) return true;
      if (tag === "a" && node.hasAttribute("href")) {
        // An inline link surrounded by running text is exempt from the minimum touch-target size,
        // whatever its container's tag; a link that is the only text of its block (a navigation
        // list item) or stands among other links only (an inline navigation row) is measured.
        return !(getComputedStyle(node).display === "inline" && inRunningText(node));
      }
      return false;
    };
    const inRunningText = (node: Element): boolean => {
      let block = node.parentElement;
      while (block && ["inline", "contents"].includes(getComputedStyle(block).display)) block = block.parentElement;
      if (!block) return false;
      // Running text is visible text of the block outside any interactive element: the labels of
      // neighbouring links or buttons (a row of inline navigation links) are not running text.
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        if (node.contains(text) || (text.textContent ?? "").trim().length === 0) continue;
        const owner = text.parentElement?.closest(RUNNING_TEXT_INTERACTIVE) ?? null;
        if (owner === null || !block.contains(owner)) return true;
      }
      return false;
    };
    // An element with display: contents has no box of its own, but its direct text renders: its
    // geometry is the union of that text's line boxes (null without visible direct text).
    const contentsTextRect = (node: Element, style: CSSStyleDeclaration): DOMRect | null => {
      if (style.display !== "contents") return null;
      const rects = [...node.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim().length > 0).flatMap((text) => {
        const range = document.createRange(); range.selectNodeContents(text); return [...range.getClientRects()];
      }).filter((rect) => rect.width > 0 && rect.height > 0);
      if (rects.length === 0) return null;
      const left = Math.min(...rects.map((r) => r.left)), top = Math.min(...rects.map((r) => r.top));
      return new DOMRect(left, top, Math.max(...rects.map((r) => r.right)) - left, Math.max(...rects.map((r) => r.bottom)) - top);
    };

    // Content the browser does not render: the body of a closed <details> (its first direct
    // <summary> stays rendered; every closed ancestor counts) and the contents of an element with
    // content-visibility: hidden. display: contents is not a reason by itself (its children render).
    const notRendered = (node: Element): boolean => {
      let child: Element = node;
      for (let ancestor = node.parentElement; ancestor; child = ancestor, ancestor = ancestor.parentElement) {
        if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
          const summary = [...ancestor.children].find((candidate) => candidate.tagName === "SUMMARY");
          if (child !== summary) return true;
        }
        if (getComputedStyle(ancestor).contentVisibility === "hidden") return true;
      }
      return false;
    };
    // content-visibility: auto skips painting contents away from the viewport; a full-page capture
    // does not paint them either, so inside the capture area they are not rendered evidence.
    const skippedByContentVisibilityAuto = (node: Element): boolean => {
      let ancestor = node.parentElement;
      while (ancestor && getComputedStyle(ancestor).contentVisibility !== "auto") ancestor = ancestor.parentElement;
      if (!ancestor || typeof node.checkVisibility !== "function") return false;
      return node.checkVisibility() && !node.checkVisibility({ contentVisibilityAuto: true });
    };

    // Effective opacity of a target: opacity and every filter opacity() multiplied along the
    // ancestor chain. null when a value is not a finite number in [0, 1] (fail closed).
    const filterOpacityRe = /opacity\(\s*([^)]*?)\s*\)/giu;
    const effectiveOpacity = (node: Element): number | null => {
      let product = 1;
      for (let part: Element | null = node; part; part = part.parentElement) {
        const ps = getComputedStyle(part);
        const op = Number(ps.opacity);
        if (!Number.isFinite(op) || op < 0 || op > 1) return null;
        product *= op;
        for (const match of ps.filter.matchAll(filterOpacityRe)) {
          const raw = match[1]!;
          const value = raw.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw);
          if (raw === "" || !Number.isFinite(value) || value < 0) return null;
          product *= Math.min(1, value);
        }
      }
      return product;
    };

    // The clipping viewport of an <svg> in client CSS pixels: the content box of an outer <svg>;
    // for a nested <svg>, its x/y/width/height mapped through the parent's screen CTM. null when
    // the browser cannot provide the mapping.
    const svgViewport = (svg: SVGSVGElement): { left: number; top: number; right: number; bottom: number } | null => {
      const owner = svg.ownerSVGElement;
      if (!owner) {
        const r = svg.getBoundingClientRect(); const st = getComputedStyle(svg);
        const px = (v: string): number => Number.parseFloat(v) || 0;
        return { left: r.left + px(st.borderLeftWidth) + px(st.paddingLeft), top: r.top + px(st.borderTopWidth) + px(st.paddingTop), right: r.right - px(st.borderRightWidth) - px(st.paddingRight), bottom: r.bottom - px(st.borderBottomWidth) - px(st.paddingBottom) };
      }
      const ctm = owner.getScreenCTM();
      if (!ctm) return null;
      const x = svg.x.animVal.value, y = svg.y.animVal.value, w = svg.width.animVal.value, h = svg.height.animVal.value;
      const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([cx, cy]) => [ctm.a * cx! + ctm.c * cy! + ctm.e, ctm.b * cx! + ctm.d * cy! + ctm.f]);
      const xs = corners.map((c) => c[0]!), ys = corners.map((c) => c[1]!);
      return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
    };

    const rectsByNode = new Map<Element, DOMRect>();
    const stylesByNode = new Map<Element, CSSStyleDeclaration>();
    const statesByNode = new Map<Element, "candidate" | "excluded" | "not-measured">();
    const overlayByNode = new Map<Element, boolean>();
    for (const node of selected) {
      const style = getComputedStyle(node);
      rectsByNode.set(node, contentsTextRect(node, style) ?? node.getBoundingClientRect());
      stylesByNode.set(node, style);
      overlayByNode.set(node, isMatch(node, options.overlays));
    }

    const rawRecords = await Promise.all(selected.map(async (node, index) => {
      const style = stylesByNode.get(node)!;
      const domRect = rectsByNode.get(node)!;
      const box = toBox(domRect);
      const checkRect = options.fullPage ? new DOMRect(domRect.x + sx, domRect.y + sy, domRect.width, domRect.height) : domRect;
      const path = domPath(node);
      const fallback = `[data-breaklint-target="${index}"]`;
      const tag = node.tagName.toLowerCase();
      const isSvg = node instanceof SVGElement;
      const isSvgText = isSvg && tag === "text";
      const svgInterior = node instanceof SVGElement && (node as SVGElement).ownerSVGElement !== null;
      const overlay = overlayByNode.get(node) ?? false;

      let state: "candidate" | "excluded" | "not-measured" = "candidate"; let reason: string | null = null; let paint: string | null = null;
      if (style.display === "none" || style.visibility === "hidden" || !!node.closest("dialog:not([open])") || notRendered(node)) { state = "excluded"; reason = "target/not-rendered"; }
      else if (effectiveOpacity(node) === 0) { state = "excluded"; reason = "target/not-visible"; }
      else if (style.position === "absolute" && box && box.width <= 1 && box.height <= 1 && (style.clip !== "auto" || style.clipPath !== "none")) { state = "excluded"; reason = "target/visually-hidden"; }
      else if (!box || box.width === 0 || box.height === 0 || contained(visibleArea, checkRect) === "outside") { state = "excluded"; reason = "target/off-viewport"; }
      else if (skippedByContentVisibilityAuto(node)) { state = "excluded"; reason = "target/not-rendered"; }

      const directTextNodes = [...node.childNodes].filter((child): child is Text => child.nodeType === Node.TEXT_NODE);
      const hasDirectText = directTextNodes.some((t) => (t.textContent ?? "").trim().length > 0);
      const ownClip = [style.overflow, style.overflowX, style.overflowY].some((value) => value === "hidden" || value === "clip");
      let clipped: "none" | "partial" | "outside" = "none";
      let clipByAllowed = false;
      if (state === "candidate" && ownClip && box && directTextNodes.some((text) => { const range = document.createRange(); range.selectNodeContents(text); return [...range.getClientRects()].some((textRect) => contained(domRect, textRect) !== "none"); })) { clipped = "partial"; clipByAllowed = isSelf(node, options.allowed); }
      // SVG text is measured against the SVG viewports that clip it (content box of the outer
      // <svg>, x/y/width/height of a nested <svg>), in client CSS pixels, before the generic
      // ancestor classification. Clipping by an SVG viewport is decided by that rule alone (one
      // defect, one finding): for every target inside an <svg> (the <text> itself, its <tspan> and
      // <textPath>, which belong to it, and <g>/shapes, which are not clipped content) the generic
      // check skips SVG ancestors. HTML ancestors stay with the generic web/content-clipped check.
      let svgViewportOverflow = 0; let svgClipped = false;
      if (state === "candidate" && isSvgText) {
        for (let part = node.parentElement; part instanceof SVGElement; part = part.parentElement) {
          if (!(part instanceof SVGSVGElement) || getComputedStyle(part).overflow === "visible") continue;
          const viewport = svgViewport(part);
          if (!viewport) { state = "not-measured"; reason = "evidence/svg-viewport-unavailable"; break; }
          svgClipped = true;
          svgViewportOverflow = Math.max(svgViewportOverflow, viewport.left - domRect.left, domRect.right - viewport.right, viewport.top - domRect.top, domRect.bottom - viewport.bottom);
        }
      }
      let ancestor: Element | null = node.parentElement;
      if (isSvgText || svgInterior) while (ancestor instanceof SVGElement) ancestor = ancestor.parentElement;
      while (state === "candidate" && ancestor) {
        const ps = getComputedStyle(ancestor); const clip = [ps.overflow, ps.overflowX, ps.overflowY].some((v) => v === "hidden" || v === "clip");
        if (clip && box) {
          const outcome = contained(ancestor.getBoundingClientRect(), domRect);
          if (outcome !== "none") {
            clipped = outcome; clipByAllowed = isSelf(ancestor, options.allowed);
            // Content scrolled out of an allowed scroll container is intended, not missing evidence.
            if (outcome === "outside" && !clipByAllowed) { state = "not-measured"; reason = "evidence/target-clipped-outside"; }
            break;
          }
        }
        ancestor = ancestor.parentElement;
      }

      const chain = [node, ...(() => { const out: Element[] = []; let x = node.parentElement; while (x) { out.push(x); x = x.parentElement; } return out; })()];
      const targetPaintSignature = paintValues(style);
      const ancestorSignature = chain.slice(1, 65).map((part) => paintValues(getComputedStyle(part)));
      const targetAncestorSignatureComplete = chain.length <= 65;
      if (!targetAncestorSignatureComplete) ancestorSignatureComplete = false;

      if (state === "candidate" && effectiveOpacity(node) === null) {
        state = "not-measured"; reason = "evidence/paint-unsupported"; paint = reason;
      }
      if (state === "candidate") {
        for (const part of chain) {
          const ps = getComputedStyle(part);
          // Effective opacity 0 was excluded above as target/not-visible.
          // Geometry rules remain valid under semi-transparent opacity (0 < opacity < 1), filter,
          // and backdrop-filter; only geometry-altering masks, clip-paths, unsupported transforms,
          // and running animations stay not-measured.
          if (ps.maskImage !== "none" || ps.webkitMaskImage !== "none" || ps.clipPath !== "none" || ps.clip !== "auto") {
            state = "not-measured"; reason = "evidence/paint-unsupported"; paint = reason; break;
          }
          if (transform(ps)) {
            state = "not-measured"; reason = "evidence/transform-unsupported"; paint = reason; break;
          }
          if (part.getAnimations({ subtree: false }).some((a) => a.playState === "running")) {
            state = "not-measured"; reason = "evidence/animation-active"; paint = reason; break;
          }
        }
      }
      if (state === "candidate") {
        const textAlpha = alpha(style.color);
        const webkitTextFill = style.getPropertyValue("-webkit-text-fill-color");
        const textFillAlpha = webkitTextFill ? alpha(webkitTextFill) : textAlpha;
        const fill = svgPaintAlpha(style.fill, style.getPropertyValue("fill-opacity") || "1");
        const stroke = svgPaintAlpha(style.stroke, style.getPropertyValue("stroke-opacity") || "1");
        if ((!isSvg && (textAlpha === 0 || textFillAlpha === 0)) || (isSvg && fill === 0 && stroke === 0)) {
          state = "not-measured"; reason = "evidence/target-not-visible"; paint = reason;
        } else if ((!isSvg && (textAlpha === null || textFillAlpha === null)) || (isSvg && (fill === null || stroke === null))) {
          state = "not-measured"; reason = "evidence/paint-unsupported"; paint = reason;
        }
      }
      statesByNode.set(node, state);

      const svgTextOverflowPx = state === "candidate" && svgClipped ? Math.round(Math.max(0, svgViewportOverflow) * 100) / 100 : 0;

      const fontSizePx = Number.parseFloat(style.fontSize) || 0;
      const className = typeof node.className === "string" ? node.className : node.getAttribute("class") ?? "";
      const directText = directTextNodes.map((child) => child.textContent ?? "").join("\u0000");
      const directTextBytes = new TextEncoder().encode(directText).byteLength;
      const includeDirectText = signatureTextBytes + directTextBytes <= 1_048_576;
      if (includeDirectText) signatureTextBytes += directTextBytes; else signatureTextComplete = false;
      return {
        node,
        record: {
          selector: selector(node, fallback), domPath: path, tag, id: node.id, className,
          textLength: node.textContent?.length ?? 0, directText: includeDirectText ? directText : null,
          hasDirectText, isSvg, isSvgText, isInteractiveControl: isInteractiveControl(node, tag), siblingEligible: false,
          fontSizePx: Math.round(fontSizePx * 100) / 100, siblingOverlapPx: 0, svgTextOverflowPx, svgClipped,
          paintSignature: JSON.stringify([targetPaintSignature, ancestorSignature]),
          ancestorSignatureComplete: targetAncestorSignatureComplete, box, coordinateSystem: coordSystem,
          state, reason, paint, transform: transform(style), clipped,
          // Inside an <svg>, scrollWidth is in CSS pixels and clientWidth in user units; the pair
          // measures viewBox scaling, not overflow. SVG content is web/svg-text-overflows-viewport's.
          horizontalOverflow: svgInterior ? 0 : Math.max(0, node.scrollWidth - node.clientWidth), svgInterior,
          allowedScroll: isSelf(node, options.allowed), clipByAllowed, overlay,
          sourceContainer: containerIndex(node), scroll: { x: sx, y: sy },
        },
      };
    }));

    // Second pass (only when web/sibling-overlap is opted in): compute direct HTML sibling overlap
    // depth (excluding SVG internals, intentional overlays, fixed/sticky chrome, and
    // pointer-events:none decorative layers). A wrapper whose only content is a replaced
    // descendant (an image card) is content; position:absolute is deliberately not excluded.
    const REPLACED_SELECTOR = [...REPLACED_TAGS].join(",");
    const siblingEligible = (node: Element, rec: BrowserRawTarget): boolean => {
      if (rec.isSvg || rec.state !== "candidate" || rec.overlay || !rec.box || rec.box.width <= 0 || rec.box.height <= 0) return false;
      if (node.closest("svg")) return false;
      const st = stylesByNode.get(node);
      if (!st) return false;
      if (st.position === "fixed" || st.position === "sticky" || st.pointerEvents === "none") return false;
      const hasContent = (node.textContent?.trim().length ?? 0) > 0 || REPLACED_TAGS.has(rec.tag) || node.querySelector(REPLACED_SELECTOR) !== null;
      return hasContent;
    };
    const fragmentRects = (node: Element, st: CSSStyleDeclaration, fallback: DOMRect): readonly DOMRect[] => {
      if (st.display === "inline" && typeof node.getClientRects === "function") {
        const rects = [...node.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
        if (rects.length > 0) return rects;
      }
      return [fallback];
    };
    const byParent = new Map<Element, { node: Element; rec: BrowserRawTarget; rect: DOMRect; rects: readonly DOMRect[] }[]>();
    for (const item of options.siblingOverlap ? rawRecords : []) {
      if (!siblingEligible(item.node, item.record)) continue;
      item.record.siblingEligible = true;
      const parent = item.node.parentElement;
      if (!parent) continue;
      const st = stylesByNode.get(item.node)!;
      const rect = rectsByNode.get(item.node)!;
      const list = byParent.get(parent) ?? [];
      list.push({ node: item.node, rec: item.record, rect, rects: fragmentRects(item.node, st, rect) });
      byParent.set(parent, list);
    }
    for (const siblings of byParent.values()) {
      if (siblings.length < 2) continue;
      for (let a = 0; a < siblings.length; a++) {
        for (let b = a + 1; b < siblings.length; b++) {
          const sa = siblings[a]!;
          const sb = siblings[b]!;
          const ra = sa.rect;
          const rb = sb.rect;
          if (Math.min(ra.right, rb.right) <= Math.max(ra.left, rb.left) || Math.min(ra.bottom, rb.bottom) <= Math.max(ra.top, rb.top)) {
            continue;
          }
          let depth = 0;
          for (const fa of sa.rects) {
            for (const fb of sb.rects) {
              const iw = Math.min(fa.right, fb.right) - Math.max(fa.left, fb.left);
              const ih = Math.min(fa.bottom, fb.bottom) - Math.max(fa.top, fb.top);
              if (iw > 0 && ih > 0) {
                const d = Math.round(Math.min(iw, ih) * 100) / 100;
                if (d > depth) depth = d;
              }
            }
          }
          if (depth > 0) {
            if (depth > sa.rec.siblingOverlapPx) sa.rec.siblingOverlapPx = depth;
            if (depth > sb.rec.siblingOverlapPx) sb.rec.siblingOverlapPx = depth;
          }
        }
      }
    }

    const safeHref = (() => { try { const u = new URL(location.href); u.search = ""; u.hash = ""; return u.toString(); } catch { return "about:invalid"; } })();
    const targets: BrowserRawTarget[] = rawRecords.map((item) => item.record);
    const signature: RawSampleSignature = {
      url: safeHref,
      viewport: [innerWidth, innerHeight, devicePixelRatio],
      scroll: [sx, sy],
      document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight, document.documentElement.clientWidth, document.documentElement.clientHeight, nodes.length],
      fonts: document.fonts?.status ?? "unsupported",
    };
    return { signature, fontsReady: document.fonts?.status === "loaded", deviceScaleFactor: devicePixelRatio, candidates: nodes.length, omittedCount: capped ? nodes.length - selected.length : 0, signatureTextComplete, ancestorSignatureComplete, exceptions: { allowed: allowedCounts, overlay: overlayCounts, allowedRoot: rootMatch(options.allowed), overlayRoot: rootMatch(options.overlays) }, targets, ...(options.colorProbe ? { colorProbe: options.colorProbe.map(alpha) } : {}) };
  }, input);

  return digestBrowserSample(sampled, input.siblingOverlap);
}

/** The rendered source and output build ids the host declared; null each when unbound, absent, or unreadable. */
type DomBuildIds = { buildId: string | null; outputId: string | null };
async function readDomBuildIds(page: StructuralPage, binding: HostBuildContainerBinding | undefined): Promise<DomBuildIds> {
  if (!binding) return { buildId: null, outputId: null };
  return page.evaluate((b) => {
    try {
      const element = document.querySelector(b.selector);
      return { buildId: element?.getAttribute(b.attribute) ?? null, outputId: b.outputAttribute === null ? null : element?.getAttribute(b.outputAttribute) ?? null };
    } catch { return { buildId: null, outputId: null }; }
  }, { selector: binding.compiledBuildSelector, attribute: binding.compiledBuildAttribute, outputAttribute: binding.compiledOutputAttribute ?? null });
}

/**
 * Every selector the run will hand to the browser, with its option field path. The browser's
 * selector grammar decides validity (Chrome closes an unterminated "[attr" itself), so the check
 * runs in the page, once, before the first sample.
 */
function selectorFields(options: CheckPageOptions): { field: string; selector: string }[] {
  return [
    ...(options.geometry?.allowedScrollContainers ?? []).map((entry, index) => ({ field: `geometry.allowedScrollContainers[${index}].selector`, selector: entry.selector })),
    ...(options.geometry?.intentionalOverlays ?? []).map((entry, index) => ({ field: `geometry.intentionalOverlays[${index}].selector`, selector: entry.selector })),
    ...(options.sourceBinding ? [{ field: "sourceBinding.compiledBuildSelector", selector: options.sourceBinding.compiledBuildSelector }] : []),
    ...(options.sourceBinding?.containers ?? []).map((entry, index) => ({ field: `sourceBinding.containers[${index}].selector`, selector: entry.selector })),
  ];
}

/** Throws a TypeError naming the first option field whose selector the page cannot parse. */
async function preflightSelectors(page: StructuralPage, options: CheckPageOptions): Promise<void> {
  const fields = selectorFields(options);
  if (fields.length === 0) return;
  const invalid = await page.evaluate((selectors: string[]) => {
    for (let i = 0; i < selectors.length; i++) { try { document.querySelector(selectors[i]!); } catch { return i; } }
    return -1;
  }, fields.map((entry) => entry.selector));
  if (invalid >= 0) throw new TypeError(`${fields[invalid]!.field} is not a valid selector in this page`);
}

/** Observe one existing host-owned page; it never navigates, mutates, closes, or imports a driver. */
export async function checkPage(page: StructuralPage, rawOptions: unknown): Promise<ScreenCheckResult> {
  const options = validateCheckPageOptions(rawOptions);
  await preflightSelectors(page, options);
  const runId = options.runId ?? randomUUID();
  const timeout = options.geometry?.stabilizationTimeoutMs ?? 2_000;
  const maxTargets = options.geometry?.maxTargets ?? 2_000;
  const fullPage = options.output.screenshot === "full-page";
  const allowedEntries = (options.geometry?.allowedScrollContainers ?? []).map((e) => ({ ...e, scope: e.scope ?? ("scenario" as const) }));
  const overlayEntries = (options.geometry?.intentionalOverlays ?? []).map((e) => ({ ...e, scope: e.scope ?? ("scenario" as const) }));
  const allowed = allowedEntries.map((x) => x.selector);
  const overlays = overlayEntries.map((x) => x.selector);
  const containers = options.sourceBinding?.containers.map((x) => x.selector) ?? [];

  const siblingOverlapEnabled = options.geometry?.rules?.siblingOverlap === true;
  const failOn = options.failOn ?? "warn";
  const smallTextOpt = options.geometry?.rules?.smallText;
  const smallTextEnabled = smallTextOpt !== undefined && smallTextOpt !== false;
  const smallTextThreshold = typeof smallTextOpt === "object" && smallTextOpt.minFontSizePx !== undefined ? smallTextOpt.minFontSizePx : DEFAULT_SMALL_TEXT_PX;
  const smallTouchOpt = options.geometry?.rules?.smallTouchTarget;
  const smallTouchEnabled = smallTouchOpt !== undefined && smallTouchOpt !== false;
  const smallTouchThreshold = typeof smallTouchOpt === "object" && smallTouchOpt.minSizePx !== undefined ? smallTouchOpt.minSizePx : DEFAULT_SMALL_TOUCH_PX;

  const rulesEnabled: ScreenRuleId[] = [
    "web/unexpected-horizontal-overflow",
    "web/content-clipped",
    ...(siblingOverlapEnabled ? ["web/sibling-overlap" as const] : []),
    "web/svg-text-overflows-viewport",
    ...(smallTextEnabled ? ["web/small-text" as const] : []),
    ...(smallTouchEnabled ? ["web/small-touch-target" as const] : []),
  ];

  const infrastructure: ScreenInfrastructureEvent[] = [];
  const events: { kind: string; detail: string }[] = [];
  const sampleInput = { maxTargets, allowed, overlays, containers, fullPage, siblingOverlap: siblingOverlapEnabled };

  const viewport = page.viewportSize();
  const reportHead = async (verdict: RunVerdict, deviceScaleFactor: number) => ({
    schemaVersion: SCREEN_REPORT_SCHEMA_VERSION,
    profileKind: "screen" as const,
    runId,
    runVerdict: verdict,
    exitCode: EXIT_CODE_BY_VERDICT[verdict],
    scope: {
      projectId: options.projectId ?? null,
      documentId: options.documentId ?? null,
      scenario: options.scenario,
      url: safeUrl(page.url()),
      viewport: { width: viewport?.width ?? 0, height: viewport?.height ?? 0, deviceScaleFactor },
      browserVersion: await Promise.resolve(page.context().browser()?.version() ?? null),
    },
    trust: "host-controlled-page" as const,
    networkPolicy: "host-owned" as const,
    failOn,
    rulesEnabled,
  });
  const emptyArtifact = { kind: "png" as const, relativePath: null, sha256: null, byteLength: null, widthPx: null, heightPx: null, capture: options.output.screenshot, coordinateSystem: fullPage ? "css-document-pixels" as const : "css-viewport-pixels-with-scroll" as const };

  // Phases outside the stabilization budget (first sample, screenshot, post-capture check) carry
  // their own bound, so a hanging driver still yields a report.
  const phaseBoundMs = Math.max(PHASE_BOUND_FLOOR_MS, PHASE_BOUND_FACTOR * timeout);
  // stabilizationTimeoutMs 0 keeps its 0.10 meaning: fonts and layout are not awaited, which is a
  // timeout (no clean claim), and no drift is claimed without two differing samples.
  const fonts = timeout === 0
    ? { value: null, timedOut: true }
    : await withTimeout(page.evaluate(async () => { if (!document.fonts) return false; await document.fonts.ready; return document.fonts.status === "loaded"; }), timeout);

  const firstStart = performance.now();
  const first = await withTimeout(samplePage(page, sampleInput), phaseBoundMs);
  const firstSampleMs = Math.round(performance.now() - firstStart);
  if (first.value === null) {
    // No sample, no observation: no screenshot is taken and nothing is evaluated.
    infrastructure.push({ kind: "screen-sample-timeout", detail: `the first page sample did not finish within ${phaseBoundMs} ms`, fatal: true });
    const report: PublicScreenReport = {
      ...await reportHead("infrastructure", 0),
      targetInventory: { complete: false, omittedCount: 0, reason: "screen/no-sample" },
      coverage: {
        candidates: 0, measured: 0, excluded: 0, notMeasured: 0,
        allowedScrollContainers: allowedEntries.map((entry) => ({ ...entry, count: 0 })),
        intentionalOverlays: overlayEntries.map((entry) => ({ ...entry, count: 0 })),
      },
      capture: { before: "", stable: "", after: "", fontsReady: false, timedOut: true, drifted: false, stabilized: false, stabilizationAttempts: 0, stabilizationEndedBy: "timeout", firstSampleMs, driftDetails: [] },
      artifact: emptyArtifact, evaluations: [], findings: [], infrastructure, events,
    };
    return { ok: false, report };
  }

  // Stabilization: two consecutive identical samples, while document fonts are not loading. The
  // monotonic deadline starts after the first sample, whose duration the report records.
  let before = first.value;
  let settled = before;
  let stabilized = false;
  let endedBy: "stable" | "timeout" | "attempt-limit" = "timeout";
  let stabilizationAttempts = 0;
  let lastPairDiffered = false;
  let prev = before;
  let prevHash = sha(stable(prev.signature));
  const stabilizationStart = performance.now();
  const deadline = stabilizationStart + timeout;
  for (;;) {
    if (stabilizationAttempts >= MAX_STABILIZATION_ATTEMPTS) { endedBy = "attempt-limit"; break; }
    const remainingForRaf = deadline - performance.now();
    if (remainingForRaf <= 0) { endedBy = "timeout"; break; }
    const raf = await withTimeout(page.evaluate(() => new Promise<boolean>((resolve) => requestAnimationFrame(() => resolve(true)))), remainingForRaf);
    if (raf.timedOut) { endedBy = "timeout"; break; }
    const remainingForSample = deadline - performance.now();
    if (remainingForSample <= 0) { endedBy = "timeout"; break; }
    const sampledCurr = await withTimeout(samplePage(page, sampleInput), remainingForSample);
    if (sampledCurr.value === null) { endedBy = "timeout"; break; }
    stabilizationAttempts++;
    const curr = sampledCurr.value;
    const currHash = sha(stable(curr.signature));
    before = prev;
    settled = curr;
    lastPairDiffered = currHash !== prevHash;
    if (!lastPairDiffered && curr.signature.fonts !== "loading") { stabilized = true; endedBy = "stable"; break; }
    prev = curr;
    prevHash = currHash;
  }
  const stabilizationMs = Math.round(performance.now() - stabilizationStart);
  const stabilizationTimedOut = !stabilized && endedBy === "timeout";

  const readBuildIds = async (): Promise<DomBuildIds> => (await withTimeout(readDomBuildIds(page, options.sourceBinding), phaseBoundMs)).value ?? { buildId: null, outputId: null };
  const domIds = await readBuildIds();
  const bindingBefore = verifyBinding(options.sourceBinding, domIds.buildId, domIds.outputId);
  const shot = await withTimeout(page.screenshot({ fullPage }), phaseBoundMs);
  const bytes = shot.value;
  if (bytes === null) infrastructure.push({ kind: "screen-screenshot-timeout", detail: `the host screenshot did not finish within ${phaseBoundMs} ms`, fatal: true });
  const afterSample = bytes === null ? null : await withTimeout(samplePage(page, sampleInput), phaseBoundMs);
  const after = afterSample?.value ?? null;
  const postCaptureTimedOut = afterSample !== null && after === null;
  if (postCaptureTimedOut) infrastructure.push({ kind: "screen-post-capture-timeout", detail: `the sample after the screenshot did not finish within ${phaseBoundMs} ms`, fatal: false });
  const domIdsAfter = await readBuildIds();
  const bindingAfter = verifyBinding(options.sourceBinding, domIdsAfter.buildId, domIdsAfter.outputId);

  // Public capture digests are keyed with a per-run secret that never leaves this call: they compare
  // samples within the run, but a reader cannot test guessed page text against them.
  const captureKey = randomBytes(32);
  const captureDigest = (sample: RawSample): string => createHmac("sha256", captureKey).update(stable(sample.signature)).digest("hex");
  const captureBefore = captureDigest(before);
  const captureStable = captureDigest(settled);
  const captureAfter = after === null ? "" : captureDigest(after);
  const postScreenshotDrifted = after !== null && captureStable !== captureAfter;
  // Drift means two samples really differed; a budget that ran out before a second sample is a timeout.
  const preScreenshotDrifted = !stabilized && lastPairDiffered;
  const drifted = preScreenshotDrifted || postScreenshotDrifted;

  const driftDetails: ScreenDriftDetail[] = [
    ...(preScreenshotDrifted ? computeScreenDriftDetails(before, settled, "pre-screenshot") : []),
    ...(postScreenshotDrifted && after !== null ? computeScreenDriftDetails(settled, after, "post-screenshot") : []),
  ].slice(0, MAX_DRIFT_DETAILS);

  const samples = after === null ? [before, settled] : [before, settled, after];
  const fontsAllReady = samples.every((sample) => sample.fontsReady);
  const timedOut = fonts.timedOut || stabilizationTimedOut || postCaptureTimedOut;
  const completeSignature = samples.every((sample) => sample.signatureTextComplete && sample.ancestorSignatureComplete);
  const stableCapture = stabilized && !timedOut && !drifted && completeSignature && fontsAllReady && after !== null;

  if (fonts.timedOut) infrastructure.push({ kind: "screen-font-layout-timeout", detail: timeout === 0 ? "stabilizationTimeoutMs is 0: document fonts and layout were not awaited" : `document.fonts.ready did not resolve within ${timeout} ms`, fatal: false });
  if (stabilizationTimedOut && timeout > 0) infrastructure.push({ kind: "screen-stabilization-timeout", detail: `no two consecutive identical samples within ${timeout} ms after the first sample (first sample ${firstSampleMs} ms, ${stabilizationAttempts} further samples)`, fatal: false });
  if (endedBy === "attempt-limit") infrastructure.push({ kind: "screen-stabilization-attempt-limit", detail: `no two consecutive identical samples within the ${MAX_STABILIZATION_ATTEMPTS}-sample attempt limit (${stabilizationMs} of ${timeout} ms used)`, fatal: false });
  if (!fontsAllReady && !fonts.timedOut) infrastructure.push({ kind: "screen-fonts-not-ready", detail: "document fonts were still loading in a compared sample", fatal: false });
  if (drifted) infrastructure.push({ kind: "screen-capture-drift", detail: summarizeDriftDetails(driftDetails), fatal: false });
  if (!samples.every((sample) => sample.signatureTextComplete)) infrastructure.push({ kind: "screen-dom-signature-incomplete", detail: `direct child text exceeded the ${MAX_SIGNATURE_TEXT_BYTES}-byte capture bound or browser hashing was unavailable`, fatal: false });
  if (!samples.every((sample) => sample.ancestorSignatureComplete)) infrastructure.push({ kind: "screen-paint-signature-incomplete", detail: `a target ancestor chain exceeded the ${MAX_SIGNATURE_ANCESTORS}-ancestor capture bound`, fatal: false });

  const bindingStable = bindingBefore.status === "verified-container-only" && bindingAfter.status === "verified-container-only" && bindingBefore.detail === bindingAfter.detail && domIds.buildId === domIdsAfter.buildId && domIds.outputId === domIdsAfter.outputId;
  if (!bindingStable) events.push({ kind: "source-binding-unavailable", detail: bindingAfter.detail ?? bindingBefore.detail ?? "host build container binding unavailable or changed during capture" });

  let rootException = false;
  for (const [kind, entries, counts, roots] of [["allowed-scroll-container", allowedEntries, settled.exceptions.allowed, settled.exceptions.allowedRoot], ["intentional-overlay", overlayEntries, settled.exceptions.overlay, settled.exceptions.overlayRoot]] as const) {
    entries.forEach((entry, index) => {
      if (roots[index] === true) {
        // Regardless of scope: an exception on html/body exempts the page, so no clean claim.
        rootException = true;
        events.push({ kind: "screen-exception-too-broad", detail: `${kind} ${entry.selector} matches the document root or body` });
      }
      if ((counts[index] ?? 0) <= 0 && entry.scope === "scenario") {
        events.push({ kind: "screen-exception-unused", detail: `${kind} ${entry.selector} matched no current target` });
      }
    });
  }

  // runId is public report data, not a filesystem component. Hash it before naming an artifact.
  let relativePath: string | null = null;
  let dimensions: { widthPx: number; heightPx: number } | null = null;
  if (bytes !== null) {
    const artifactDir = join(options.output.dir, "evidence"); mkdirSync(artifactDir, { recursive: true });
    relativePath = `evidence/screen-${sha(runId).slice(0, 32)}.png`; writeFileSync(join(options.output.dir, relativePath), bytes);
    dimensions = pngSize(bytes); if (!dimensions) infrastructure.push({ kind: "screen-screenshot-invalid", detail: "host screenshot was not a PNG with IHDR dimensions", fatal: true });
  }

  const effectiveBinding: Binding = bindingStable ? bindingAfter : { status: options.sourceBinding ? "declared" : "unknown", files: new Set(), containerFiles: new Map(), detail: bindingAfter.detail };
  const evaluations = evaluateScreenTargets(settled.targets, {
    binding: effectiveBinding, stableCapture, artifactPath: relativePath,
    siblingOverlap: siblingOverlapEnabled,
    smallText: { enabled: smallTextEnabled, thresholdPx: smallTextThreshold },
    smallTouch: { enabled: smallTouchEnabled, thresholdPx: smallTouchThreshold },
  });
  const findings = screenFindings(evaluations, relativePath);
  // The gate mirrors the print profile: `error` lets warnings stay visible without failing the run.
  const gatingFindings = findings.filter((finding) => failOn === "warn" || finding.severity === "error").length;

  const measured = evaluations.filter((entry) => entry.status === "measured").length;
  const excluded = evaluations.filter((entry) => entry.status === "excluded").length;
  const notMeasured = evaluations.filter((entry) => entry.status === "not-measured").length;
  // A page with candidates but no measurements has no positive observation to support Clean.
  const insufficient = !stableCapture || settled.omittedCount > 0 || notMeasured > 0 || measured === 0 || rootException;
  const verdict: RunVerdict = infrastructure.some((entry) => entry.fatal) ? "infrastructure" : insufficient ? "insufficient-coverage" : gatingFindings > 0 ? "findings" : "clean";

  const report: PublicScreenReport = {
    ...await reportHead(verdict, settled.deviceScaleFactor),
    targetInventory: {
      complete: settled.omittedCount === 0 && completeSignature,
      omittedCount: settled.omittedCount,
      reason: settled.omittedCount ? "screen/target-enumeration-capped" : !completeSignature ? "screen/signature-incomplete" : null,
    },
    coverage: {
      candidates: evaluations.length,
      measured,
      excluded,
      notMeasured,
      allowedScrollContainers: allowedEntries.map((entry, index) => ({ ...entry, count: settled.exceptions.allowed[index] ?? 0 })),
      intentionalOverlays: overlayEntries.map((entry, index) => ({ ...entry, count: settled.exceptions.overlay[index] ?? 0 })),
    },
    capture: {
      before: captureBefore,
      stable: captureStable,
      after: captureAfter,
      fontsReady: fonts.value === true && fontsAllReady,
      timedOut,
      drifted,
      stabilized,
      stabilizationAttempts,
      stabilizationEndedBy: endedBy,
      firstSampleMs,
      driftDetails,
    },
    artifact: bytes !== null && dimensions ? {
      ...emptyArtifact,
      relativePath,
      sha256: sha(bytes),
      byteLength: bytes.length,
      widthPx: dimensions.widthPx,
      heightPx: dimensions.heightPx,
    } : emptyArtifact,
    evaluations,
    findings,
    infrastructure,
    events,
  };
  return verdict === "clean" || verdict === "findings" ? { ok: true, report } : { ok: false, report };
}
