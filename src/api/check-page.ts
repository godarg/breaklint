/** Public host-page adapter. It observes an already-opened page and writes only its PNG artifact. */

import { randomUUID } from "node:crypto";
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
const DEFAULT_SMALL_TEXT_PX = 12;
const DEFAULT_SMALL_TOUCH_PX = 24;

const CSS_COLOR_SPACES = new Set([
  "srgb", "srgb-linear", "display-p3", "a98-rgb", "prophoto-rgb", "rec2020", "xyz", "xyz-d50", "xyz-d65",
]);

const COLOR_NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/u;
const COLOR_CHANNEL_RE = /^(?:none|[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:%|deg|rad|grad|turn)?)$/u;

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
 * Parses the alpha channel (0..1) of a CSS Color 3 or CSS Color 4 computed color string.
 * Returns null for unrecognized or non-solid paint syntax (e.g. url(#gradient)), failing closed.
 */
export function parseCssColorAlpha(color: string): number | null {
  const trimmed = color.trim().toLowerCase();
  if (trimmed === "transparent") return 0;
  const fnMatch = /^([a-z]+)\(([^()]+)\)$/u.exec(trimmed);
  if (!fnMatch) return null;
  const fn = fnMatch[1]!;
  const body = fnMatch[2]!.trim();
  if (fn === "rgb" || fn === "rgba" || fn === "hsl" || fn === "hsla") {
    if (body.includes(",")) {
      const parts = body.split(",").map((s) => s.trim());
      if (parts.some((p) => p === "")) return null;
      if (parts.length !== 3 && parts.length !== 4) return null;
      if (!parts.slice(0, 3).every((p) => COLOR_CHANNEL_RE.test(p))) return null;
      return parts.length === 4 ? parseAlphaToken(parts[3]!) : 1;
    }
    const slashParts = body.split("/");
    if (slashParts.length > 2) return null;
    const channels = slashParts[0]!.trim().split(/\s+/u).filter(Boolean);
    if (channels.length !== 3 || !channels.every((c) => COLOR_CHANNEL_RE.test(c))) return null;
    return slashParts.length === 2 ? parseAlphaToken(slashParts[1]!) : 1;
  }
  if (fn === "hwb" || fn === "lab" || fn === "lch" || fn === "oklab" || fn === "oklch") {
    const slashParts = body.split("/");
    if (slashParts.length > 2) return null;
    const channels = slashParts[0]!.trim().split(/\s+/u).filter(Boolean);
    if (channels.length !== 3 || !channels.every((c) => COLOR_CHANNEL_RE.test(c))) return null;
    return slashParts.length === 2 ? parseAlphaToken(slashParts[1]!) : 1;
  }
  if (fn === "color") {
    const slashParts = body.split("/");
    if (slashParts.length > 2) return null;
    const tokens = slashParts[0]!.trim().split(/\s+/u).filter(Boolean);
    if (tokens.length !== 4 || !CSS_COLOR_SPACES.has(tokens[0]!) || !tokens.slice(1).every((c) => COLOR_CHANNEL_RE.test(c))) return null;
    return slashParts.length === 2 ? parseAlphaToken(slashParts[1]!) : 1;
  }
  return null;
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

async function samplePage(page: StructuralPage, input: { maxTargets: number; allowed: string[]; overlays: string[]; containers: string[]; fullPage: boolean; siblingOverlap: boolean }): Promise<RawSample> {
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

    const colorSpaces = new Set(["srgb", "srgb-linear", "display-p3", "a98-rgb", "prophoto-rgb", "rec2020", "xyz", "xyz-d50", "xyz-d65"]);
    const colorNumRe = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/u;
    const colorChannelRe = /^(?:none|[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:%|deg|rad|grad|turn)?)$/u;
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
      if (fn === "rgb" || fn === "rgba" || fn === "hsl" || fn === "hsla") {
        if (body.includes(",")) {
          const parts = body.split(",").map((s) => s.trim());
          if (parts.some((p) => p === "")) return null;
          if (parts.length !== 3 && parts.length !== 4) return null;
          if (!parts.slice(0, 3).every((p) => colorChannelRe.test(p))) return null;
          return parts.length === 4 ? parseAlphaToken(parts[3]!) : 1;
        }
        const sp = body.split("/"); if (sp.length > 2) return null;
        const ch = sp[0]!.trim().split(/\s+/u).filter(Boolean);
        if (ch.length !== 3 || !ch.every((c) => colorChannelRe.test(c))) return null;
        return sp.length === 2 ? parseAlphaToken(sp[1]!) : 1;
      }
      if (fn === "hwb" || fn === "lab" || fn === "lch" || fn === "oklab" || fn === "oklch") {
        const sp = body.split("/"); if (sp.length > 2) return null;
        const ch = sp[0]!.trim().split(/\s+/u).filter(Boolean);
        if (ch.length !== 3 || !ch.every((c) => colorChannelRe.test(c))) return null;
        return sp.length === 2 ? parseAlphaToken(sp[1]!) : 1;
      }
      if (fn === "color") {
        const sp = body.split("/"); if (sp.length > 2) return null;
        const tokens = sp[0]!.trim().split(/\s+/u).filter(Boolean);
        if (tokens.length !== 4 || !colorSpaces.has(tokens[0]!) || !tokens.slice(1).every((c) => colorChannelRe.test(c))) return null;
        return sp.length === 2 ? parseAlphaToken(sp[1]!) : 1;
      }
      return null;
    };
    const svgPaintAlpha = (paint: string, opacity: string): number | null => { if (paint.trim() === "none") return 0; const paintAlpha = alpha(paint); const componentOpacity = Number(opacity); return paintAlpha === null || !Number.isFinite(componentOpacity) || componentOpacity < 0 || componentOpacity > 1 ? null : paintAlpha * componentOpacity; };
    const transform = (style: CSSStyleDeclaration): string | null => { const v = style.transform; if (v === "none") return null; const match = v.match(/^matrix\(([^)]+)\)$/u); if (!match) return "unsupported-transform"; const n = match[1]!.split(",").map(Number); return n.length === 6 && Number.isFinite(n[0]) && Number.isFinite(n[3]) && n[0]! > 0 && n[3]! > 0 && n[1] === 0 && n[2] === 0 ? null : "unsupported-transform"; };
    const matchCount = (selectors: string[]): number[] => selectors.map((s) => { try { return document.querySelectorAll(s).length; } catch { return -1; } });
    const allowedCounts = matchCount(options.allowed), overlayCounts = matchCount(options.overlays);
    const isMatch = (node: Element, selectors: string[]): boolean => selectors.some((s) => { try { return node.matches(s) || !!node.closest(s); } catch { return false; } });
    const containerIndex = (node: Element): number | null => { for (let i = 0; i < options.containers.length; i++) { try { if (node.closest(options.containers[i]!)) return i; } catch { return null; } } return null; };

    const visibleArea = options.fullPage
      ? new DOMRect(0, 0, Math.max(window.innerWidth, document.documentElement.scrollWidth), Math.max(window.innerHeight, document.documentElement.scrollHeight))
      : new DOMRect(0, 0, window.innerWidth, window.innerHeight);

    const paintValues = (style: CSSStyleDeclaration): string[] => [style.color, style.getPropertyValue("-webkit-text-fill-color"), style.backgroundColor, style.fill, style.getPropertyValue("fill-opacity"), style.stroke, style.getPropertyValue("stroke-opacity"), style.fontFamily, style.fontSize, style.fontWeight, style.fontStyle, style.fontStretch, style.fontKerning, style.lineHeight, style.letterSpacing, style.wordSpacing, style.opacity, style.filter, style.backdropFilter, style.maskImage, style.webkitMaskImage, style.clipPath, style.clip, style.transform];
    let signatureTextBytes = 0; let signatureTextComplete = true; let ancestorSignatureComplete = true;
    const nodes = [...document.querySelectorAll("*")]; const capped = nodes.length > options.maxTargets; const selected = nodes.slice(0, options.maxTargets);

    const INTERACTIVE_TAGS = new Set(["button", "select", "textarea", "summary"]);
    const INTERACTIVE_ROLES = new Set(["button", "link", "checkbox", "radio", "switch", "tab"]);
    const REPLACED_TAGS = new Set(["img", "video", "canvas", "input", "button", "select", "textarea", "iframe", "svg"]);

    const isInteractiveControl = (node: Element, tag: string): boolean => {
      if (INTERACTIVE_TAGS.has(tag)) return true;
      if (tag === "input" && (node.getAttribute("type") ?? "").toLowerCase() !== "hidden") return true;
      const role = (node.getAttribute("role") ?? "").trim().toLowerCase();
      if (INTERACTIVE_ROLES.has(role)) return true;
      if (tag === "a" && node.hasAttribute("href")) {
        // Inline links inside running prose paragraphs are exempt from minimum touch-target size.
        const st = getComputedStyle(node);
        const insideProse = !!node.closest("p, li, dd, blockquote, td, th");
        if (insideProse && st.display === "inline") return false;
        return true;
      }
      return false;
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

    const rectsByNode = new Map<Element, DOMRect>();
    const stylesByNode = new Map<Element, CSSStyleDeclaration>();
    const statesByNode = new Map<Element, "candidate" | "excluded" | "not-measured">();
    const overlayByNode = new Map<Element, boolean>();
    for (const node of selected) {
      rectsByNode.set(node, node.getBoundingClientRect());
      stylesByNode.set(node, getComputedStyle(node));
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
      const overlay = overlayByNode.get(node) ?? false;

      let state: "candidate" | "excluded" | "not-measured" = "candidate"; let reason: string | null = null; let paint: string | null = null;
      if (style.display === "none" || style.visibility === "hidden" || !!node.closest("dialog:not([open])") || notRendered(node)) { state = "excluded"; reason = "target/not-rendered"; }
      else if (style.position === "absolute" && box && box.width <= 1 && box.height <= 1 && (style.clip !== "auto" || style.clipPath !== "none")) { state = "excluded"; reason = "target/visually-hidden"; }
      else if (!box || box.width === 0 || box.height === 0 || contained(visibleArea, checkRect) === "outside") { state = "excluded"; reason = "target/off-viewport"; }
      else if (skippedByContentVisibilityAuto(node)) { state = "excluded"; reason = "target/not-rendered"; }

      const directTextNodes = [...node.childNodes].filter((child): child is Text => child.nodeType === Node.TEXT_NODE);
      const hasDirectText = directTextNodes.some((t) => (t.textContent ?? "").trim().length > 0);
      const ownClip = [style.overflow, style.overflowX, style.overflowY].some((value) => value === "hidden" || value === "clip");
      let clipped: "none" | "partial" | "outside" = "none";
      if (state === "candidate" && ownClip && box && directTextNodes.some((text) => { const range = document.createRange(); range.selectNodeContents(text); return [...range.getClientRects()].some((textRect) => contained(domRect, textRect) !== "none"); })) clipped = "partial";
      let ancestor: Element | null = node.parentElement;
      while (state === "candidate" && ancestor) { const ps = getComputedStyle(ancestor); const clip = [ps.overflow, ps.overflowX, ps.overflowY].some((v) => v === "hidden" || v === "clip"); if (clip && box) { const outcome = contained(ancestor.getBoundingClientRect(), domRect); if (outcome !== "none") { clipped = outcome; if (outcome === "outside") { state = "not-measured"; reason = "evidence/target-clipped-outside"; } break; } } ancestor = ancestor.parentElement; }

      const chain = [node, ...(() => { const out: Element[] = []; let x = node.parentElement; while (x) { out.push(x); x = x.parentElement; } return out; })()];
      const targetPaintSignature = paintValues(style);
      const ancestorSignature = chain.slice(1, 65).map((part) => paintValues(getComputedStyle(part)));
      const targetAncestorSignatureComplete = chain.length <= 65;
      if (!targetAncestorSignatureComplete) ancestorSignatureComplete = false;

      if (state === "candidate") {
        let effectiveOpacity = 1;
        for (const part of chain) {
          const ps = getComputedStyle(part);
          const op = Number(ps.opacity);
          if (!Number.isFinite(op) || op < 0 || op > 1) {
            state = "not-measured"; reason = "evidence/paint-unsupported"; paint = reason; break;
          }
          effectiveOpacity *= op;
          if (effectiveOpacity === 0 || /\bopacity\(\s*0+(?:\.0+)?%?\s*\)/iu.test(ps.filter)) {
            state = "not-measured"; reason = "evidence/target-not-visible"; paint = reason; break;
          }
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

      let svgTextOverflowPx = 0;
      if (state === "candidate" && isSvgText) {
        const ownerSvg = (node as SVGTextElement).ownerSVGElement;
        if (ownerSvg) {
          const svgRect = ownerSvg.getBoundingClientRect();
          if (svgRect.width > 0 && svgRect.height > 0) {
            svgTextOverflowPx = Math.max(0, svgRect.left - domRect.left, domRect.right - svgRect.right, svgRect.top - domRect.top, domRect.bottom - svgRect.bottom);
            svgTextOverflowPx = Math.round(svgTextOverflowPx * 100) / 100;
          }
        }
      }

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
          fontSizePx: Math.round(fontSizePx * 100) / 100, siblingOverlapPx: 0, svgTextOverflowPx,
          paintSignature: JSON.stringify([targetPaintSignature, ancestorSignature]),
          ancestorSignatureComplete: targetAncestorSignatureComplete, box, coordinateSystem: coordSystem,
          state, reason, paint, transform: transform(style), clipped,
          horizontalOverflow: Math.max(0, node.scrollWidth - node.clientWidth),
          allowedScroll: isMatch(node, options.allowed), overlay,
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
    return { signature, fontsReady: document.fonts?.status === "loaded", deviceScaleFactor: devicePixelRatio, candidates: nodes.length, omittedCount: capped ? nodes.length - selected.length : 0, signatureTextComplete, ancestorSignatureComplete, exceptions: { allowed: allowedCounts, overlay: overlayCounts }, targets };
  }, input);

  return digestBrowserSample(sampled, input.siblingOverlap);
}

/** Reads the rendered build id the host declared; null when unbound, absent, or unreadable. */
async function readDomBuildId(page: StructuralPage, binding: HostBuildContainerBinding | undefined): Promise<string | null> {
  if (!binding) return null;
  return page.evaluate((b) => { try { return document.querySelector(b.selector)?.getAttribute(b.attribute) ?? null; } catch { return null; } }, { selector: binding.compiledBuildSelector, attribute: binding.compiledBuildAttribute });
}

/** Observe one existing host-owned page; it never navigates, mutates, closes, or imports a driver. */
export async function checkPage(page: StructuralPage, rawOptions: unknown): Promise<ScreenCheckResult> {
  const options = validateCheckPageOptions(rawOptions);
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

  const deadline = Date.now() + timeout;
  const fonts = await withTimeout(
    page.evaluate(async () => { if (!document.fonts) return false; await document.fonts.ready; return document.fonts.status === "loaded"; }),
    timeout,
  );

  // Stabilization loop: wait for 2 consecutive identical samples within stabilizationTimeoutMs.
  let before = await samplePage(page, sampleInput);
  let settled = before;
  let stabilized = false;
  let stabilizationTimedOut = false;
  let stabilizationAttempts = 0;
  let prev = before;
  let prevHash = sha(stable(prev.signature));
  for (let attempt = 1; attempt <= MAX_STABILIZATION_ATTEMPTS; attempt++) {
    const remainingForRaf = deadline - Date.now();
    if (remainingForRaf <= 0) {
      stabilizationTimedOut = true;
      break;
    }
    const raf = await withTimeout(
      page.evaluate(() => new Promise<boolean>((resolve) => requestAnimationFrame(() => resolve(true)))),
      remainingForRaf,
    );
    if (raf.timedOut) {
      stabilizationTimedOut = true;
      break;
    }
    const remainingForSample = deadline - Date.now();
    if (remainingForSample <= 0) {
      stabilizationTimedOut = true;
      break;
    }
    const sampledCurr = await withTimeout(samplePage(page, sampleInput), remainingForSample);
    if (sampledCurr.timedOut || sampledCurr.value === null) {
      stabilizationTimedOut = true;
      break;
    }
    const curr = sampledCurr.value;
    const currHash = sha(stable(curr.signature));
    stabilizationAttempts = attempt;
    if (currHash === prevHash) {
      before = prev;
      settled = curr;
      stabilized = true;
      break;
    }
    before = prev;
    settled = curr;
    if (Date.now() >= deadline) {
      stabilizationTimedOut = true;
      break;
    }
    prev = curr;
    prevHash = currHash;
  }

  const domBuildId = await readDomBuildId(page, options.sourceBinding);
  const bindingBefore = verifyBinding(options.sourceBinding, domBuildId);
  const bytes = await page.screenshot({ fullPage });
  const after = await samplePage(page, sampleInput);
  const domBuildIdAfter = await readDomBuildId(page, options.sourceBinding);
  const bindingAfter = verifyBinding(options.sourceBinding, domBuildIdAfter);

  const captureBefore = sha(stable(before.signature));
  const captureStable = sha(stable(settled.signature));
  const captureAfter = sha(stable(after.signature));
  const postScreenshotDrifted = captureStable !== captureAfter;
  const drifted = !stabilized || postScreenshotDrifted;

  const driftDetails: ScreenDriftDetail[] = [
    ...(!stabilized ? computeScreenDriftDetails(before, settled, "pre-screenshot") : []),
    ...(postScreenshotDrifted ? computeScreenDriftDetails(settled, after, "post-screenshot") : []),
  ].slice(0, MAX_DRIFT_DETAILS);

  const timedOut = fonts.timedOut || stabilizationTimedOut;
  const completeSignature = before.signatureTextComplete && settled.signatureTextComplete && after.signatureTextComplete && before.ancestorSignatureComplete && settled.ancestorSignatureComplete && after.ancestorSignatureComplete;
  const stableCapture = !timedOut && !drifted && completeSignature;

  if (timedOut) infrastructure.push({ kind: "screen-font-layout-timeout", detail: "document fonts/layout did not settle within the configured bound", fatal: false });
  if (drifted) infrastructure.push({ kind: "screen-capture-drift", detail: summarizeDriftDetails(driftDetails), fatal: false });
  if (!before.signatureTextComplete || !settled.signatureTextComplete || !after.signatureTextComplete) infrastructure.push({ kind: "screen-dom-signature-incomplete", detail: `direct child text exceeded the ${MAX_SIGNATURE_TEXT_BYTES}-byte capture bound or browser hashing was unavailable`, fatal: false });
  if (!before.ancestorSignatureComplete || !settled.ancestorSignatureComplete || !after.ancestorSignatureComplete) infrastructure.push({ kind: "screen-paint-signature-incomplete", detail: `a target ancestor chain exceeded the ${MAX_SIGNATURE_ANCESTORS}-ancestor capture bound`, fatal: false });

  const bindingStable = bindingBefore.status === "verified-container-only" && bindingAfter.status === "verified-container-only" && bindingBefore.detail === bindingAfter.detail && domBuildId === domBuildIdAfter;
  if (!bindingStable) events.push({ kind: "source-binding-unavailable", detail: bindingAfter.detail ?? bindingBefore.detail ?? "host build container binding unavailable or changed during capture" });

  for (const [kind, entries, counts] of [["allowed-scroll-container", allowedEntries, settled.exceptions.allowed], ["intentional-overlay", overlayEntries, settled.exceptions.overlay]] as const) {
    entries.forEach((entry, index) => {
      if ((counts[index] ?? 0) <= 0 && entry.scope === "scenario") {
        events.push({ kind: "screen-exception-unused", detail: `${kind} ${entry.selector} matched no current target` });
      }
    });
  }

  const artifactDir = join(options.output.dir, "evidence"); mkdirSync(artifactDir, { recursive: true });
  // runId is public report data, not a filesystem component. Hash it before naming an artifact.
  const relativePath = `evidence/screen-${sha(runId).slice(0, 32)}.png`; writeFileSync(join(options.output.dir, relativePath), bytes);
  const dimensions = pngSize(bytes); if (!dimensions) infrastructure.push({ kind: "screen-screenshot-invalid", detail: "host screenshot was not a PNG with IHDR dimensions", fatal: true });

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
  const insufficient = !stableCapture || settled.omittedCount > 0 || notMeasured > 0 || measured === 0;
  const verdict: RunVerdict = infrastructure.some((entry) => entry.fatal) ? "infrastructure" : insufficient ? "insufficient-coverage" : gatingFindings > 0 ? "findings" : "clean";
  const viewport = page.viewportSize();
  const browserVersion = await Promise.resolve(page.context().browser()?.version() ?? null);

  const report: PublicScreenReport = {
    schemaVersion: SCREEN_REPORT_SCHEMA_VERSION,
    profileKind: "screen",
    runId,
    runVerdict: verdict,
    exitCode: EXIT_CODE_BY_VERDICT[verdict],
    scope: {
      projectId: options.projectId ?? null,
      documentId: options.documentId ?? null,
      scenario: options.scenario,
      url: safeUrl(page.url()),
      viewport: { width: viewport?.width ?? 0, height: viewport?.height ?? 0, deviceScaleFactor: settled.deviceScaleFactor },
      browserVersion,
    },
    trust: "host-controlled-page",
    networkPolicy: "host-owned",
    failOn,
    rulesEnabled,
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
      fontsReady: fonts.value === true && settled.fontsReady,
      timedOut,
      drifted,
      stabilized,
      stabilizationAttempts,
      driftDetails,
    },
    artifact: {
      kind: "png",
      relativePath: dimensions ? relativePath : null,
      sha256: dimensions ? sha(bytes) : null,
      byteLength: dimensions ? bytes.length : null,
      widthPx: dimensions?.widthPx ?? null,
      heightPx: dimensions?.heightPx ?? null,
      capture: options.output.screenshot,
      coordinateSystem: fullPage ? "css-document-pixels" : "css-viewport-pixels-with-scroll",
    },
    evaluations,
    findings,
    infrastructure,
    events,
  };
  return verdict === "clean" || verdict === "findings" ? { ok: true, report } : { ok: false, report };
}
