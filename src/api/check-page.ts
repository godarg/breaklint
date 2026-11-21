/** Public host-page adapter. It observes an already-opened page and writes only its PNG artifact. */

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureBoundedSourceFile, sha256Bytes } from "../source/bytes.ts";
import { EXIT_CODE_BY_VERDICT, type RunVerdict, type Severity } from "../core/enums.ts";
import { validateCheckPageOptions } from "../web/options.ts";
import {
  SCREEN_REPORT_SCHEMA_VERSION,
  type CheckPageOptions,
  type HostBuildContainerBinding,
  type PublicScreenReport,
  type ScreenCheckResult,
  type ScreenDriftDetail,
  type ScreenFinding,
  type ScreenInfrastructureEvent,
  type ScreenMeasurement,
  type ScreenRuleId,
  type ScreenTargetEvaluation,
  type StructuralPage,
} from "../web/types.ts";

const sha = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
const stable = (value: unknown): string => JSON.stringify(value);
const MAX_RECEIPT_BYTES = 1_000_000;
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_SOURCE_TOTAL = 250 * 1024 * 1024;
const MAX_OUTPUT_FILES = 10_000;
const MAX_OUTPUT_TOTAL = 512 * 1024 * 1024;
const MAX_SIGNATURE_TEXT_BYTES = 1_024 * 1_024;
const MAX_SIGNATURE_ANCESTORS = 64;
const MAX_STABILIZATION_ATTEMPTS = 20;
const MAX_DRIFT_DETAILS = 10;
const DEFAULT_SMALL_TEXT_PX = 12;
const DEFAULT_SMALL_TOUCH_PX = 24;
const SIBLING_OVERLAP_THRESHOLD_PX = 2;
const SVG_TEXT_OVERFLOW_THRESHOLD_PX = 1;

const CSS_COLOR_SPACES = new Set([
  "srgb", "srgb-linear", "display-p3", "a98-rgb", "prophoto-rgb", "rec2020", "xyz", "xyz-d50", "xyz-d65",
]);

function parseAlphaToken(token: string): number | null {
  const trimmed = token.trim().toLowerCase();
  if (trimmed === "none") return 0;
  if (trimmed.endsWith("%")) {
    const num = Number(trimmed.slice(0, -1));
    return Number.isFinite(num) && num >= 0 && num <= 100 ? num / 100 : null;
  }
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
      const parts = body.split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length === 3) return 1;
      if (parts.length === 4) return parseAlphaToken(parts[3]!);
      return null;
    }
    const slashParts = body.split("/");
    if (slashParts.length > 2) return null;
    const channels = slashParts[0]!.trim().split(/\s+/u).filter(Boolean);
    if (channels.length !== 3) return null;
    return slashParts.length === 2 ? parseAlphaToken(slashParts[1]!) : 1;
  }
  if (fn === "hwb" || fn === "lab" || fn === "lch" || fn === "oklab" || fn === "oklch") {
    const slashParts = body.split("/");
    if (slashParts.length > 2) return null;
    const channels = slashParts[0]!.trim().split(/\s+/u).filter(Boolean);
    if (channels.length !== 3) return null;
    return slashParts.length === 2 ? parseAlphaToken(slashParts[1]!) : 1;
  }
  if (fn === "color") {
    const slashParts = body.split("/");
    if (slashParts.length > 2) return null;
    const tokens = slashParts[0]!.trim().split(/\s+/u).filter(Boolean);
    if (tokens.length !== 4 || !CSS_COLOR_SPACES.has(tokens[0]!)) return null;
    return slashParts.length === 2 ? parseAlphaToken(slashParts[1]!) : 1;
  }
  return null;
}

type RawTarget = {
  selector: string; domPath: string; tag: string; id: string; className: string; textLength: number; directTextSha256: string | null;
  hasDirectText: boolean; isSvg: boolean; isSvgText: boolean; isInteractiveControl: boolean;
  fontSizePx: number; siblingOverlapPx: number; svgTextOverflowPx: number;
  paintSignature: string; ancestorSignatureComplete: boolean;
  box: { x: number; y: number; width: number; height: number } | null;
  coordinateSystem: "css-viewport-pixels" | "css-document-pixels";
  state: "candidate" | "excluded" | "not-measured"; reason: string | null; paint: string | null;
  transform: string | null; clipped: "none" | "partial" | "outside"; horizontalOverflow: number; allowedScroll: boolean;
  overlay: boolean; sourceContainer: number | null; scroll: { x: number; y: number };
};
type RawSampleSignature = {
  url: string;
  viewport: [number, number, number];
  scroll: [number, number];
  document: [number, number, number, number, number];
  fonts: string;
  targetDigest?: string;
};
type RawSample = {
  signature: RawSampleSignature; fontsReady: boolean; deviceScaleFactor: number; candidates: number; omittedCount: number;
  signatureTextComplete: boolean; ancestorSignatureComplete: boolean;
  exceptions: { allowed: number[]; overlay: number[] }; targets: RawTarget[];
};
type BrowserRawTarget = Omit<RawTarget, "directTextSha256"> & { directText: string | null };
type BrowserRawSample = Omit<RawSample, "targets"> & { targets: BrowserRawTarget[] };
type Binding = { status: "verified-container-only" | "declared" | "unknown"; files: Set<string>; containerFiles: Map<number, string>; detail: string | null };

function pngSize(bytes: Uint8Array): { widthPx: number; heightPx: number } | null {
  if (bytes.length < 24 || Buffer.from(bytes.subarray(0, 8)).compare(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) !== 0) return null;
  return { widthPx: Buffer.from(bytes).readUInt32BE(16), heightPx: Buffer.from(bytes).readUInt32BE(20) };
}
function safeUrl(raw: string): string {
  try { const url = new URL(raw); url.search = ""; url.hash = ""; return url.toString(); }
  catch { return "about:invalid"; }
}
function sourcePath(path: string): boolean {
  return !!path && !path.includes("\\") && !path.includes("\0") && !path.startsWith("/") && path.split("/").every((part) => part && part !== "." && part !== "..");
}
function canonicalFiles(files: Record<string, { sha256: string; byteLength: number; role: string }>): string {
  return JSON.stringify(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([file, entry]) => [file, entry.sha256, entry.byteLength, entry.role]));
}
function receiptFiles(value: unknown, allowedRoles: readonly string[], label: string, maxFiles: number, maxTotal: number): Record<string, { sha256: string; byteLength: number; role: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} files are invalid`);
  const entries = Object.entries(value as Record<string, unknown>); if (entries.length === 0 || entries.length > maxFiles) throw new Error(`${label} file inventory is invalid`);
  const normalized: Record<string, { sha256: string; byteLength: number; role: string }> = {}; let total = 0;
  for (const [file, candidate] of entries) {
    if (!sourcePath(file) || !candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`${label} file path is invalid`);
    const entry = candidate as Record<string, unknown>; const byteLength = entry.byteLength;
    if (Object.keys(entry).some((key) => !["sha256", "byteLength", "role"].includes(key)) || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(entry.sha256) || typeof byteLength !== "number" || !Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > MAX_SOURCE_BYTES || !allowedRoles.includes(String(entry.role))) throw new Error(`invalid ${label} file entry`);
    total += byteLength; if (total > maxTotal) throw new Error(`${label} byte budget exceeded`);
    normalized[file] = { sha256: entry.sha256, byteLength, role: String(entry.role) };
  }
  return normalized;
}

/**
 * Verifies compiled output receipts in either schemaVersion 1 (Next.js `.next/BUILD_ID`) or
 * schemaVersion 2 (framework-agnostic output directory manifest with optional `buildMarkerPath`).
 */
export function verifyOutputReceipt(input: HostBuildContainerBinding, sourceBuildId: string): void {
  if (!input.buildOutputReceiptPath) throw new Error("build output receipt path is required for verified host binding");
  if (!sourcePath(input.buildOutputReceiptPath)) throw new Error("unsafe build output receipt path");
  const raw = captureBoundedSourceFile(input.root, input.buildOutputReceiptPath, MAX_RECEIPT_BYTES, "screen build output receipt");
  const receipt: unknown = JSON.parse(raw.toString("utf8"));
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new Error("build output receipt is not an object");
  const value = receipt as Record<string, unknown>;

  if (value.schemaVersion === 1) {
    if (Object.keys(value).some((key) => !["schemaVersion", "sourceBuildId", "nextBuildId", "files", "filesSha256"].includes(key)) || value.sourceBuildId !== sourceBuildId || typeof value.nextBuildId !== "string" || !/^[A-Za-z0-9_-]{1,256}$/u.test(value.nextBuildId) || typeof value.filesSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.filesSha256)) throw new Error("invalid build output receipt schema");
    const files = receiptFiles(value.files, ["build-output"], "build output receipt", MAX_OUTPUT_FILES, MAX_OUTPUT_TOTAL);
    if (!Object.hasOwn(files, ".next/BUILD_ID") || sha(canonicalFiles(files)) !== value.filesSha256) throw new Error("invalid build output receipt inventory");
    if (captureBoundedSourceFile(input.root, ".next/BUILD_ID", 512, "screen compiled build id").toString("utf8").trim() !== value.nextBuildId) throw new Error("compiled BUILD_ID does not match output receipt");
    for (const [file, entry] of Object.entries(files)) {
      const bytes = captureBoundedSourceFile(input.root, file, MAX_SOURCE_BYTES, "screen build output");
      if (bytes.length !== entry.byteLength || sha256Bytes(bytes) !== entry.sha256) throw new Error(`build output mismatch: ${file}`);
    }
    return;
  }

  if (value.schemaVersion === 2) {
    if (Object.keys(value).some((key) => !["schemaVersion", "sourceBuildId", "buildId", "buildMarkerPath", "files", "filesSha256"].includes(key)) || value.sourceBuildId !== sourceBuildId || typeof value.buildId !== "string" || !/^[A-Za-z0-9_.:-]{1,256}$/u.test(value.buildId) || typeof value.filesSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.filesSha256)) throw new Error("invalid build output receipt schema");
    const files = receiptFiles(value.files, ["build-output"], "build output receipt", MAX_OUTPUT_FILES, MAX_OUTPUT_TOTAL);
    if (sha(canonicalFiles(files)) !== value.filesSha256) throw new Error("invalid build output receipt inventory");
    if (value.buildMarkerPath !== undefined) {
      if (typeof value.buildMarkerPath !== "string" || !sourcePath(value.buildMarkerPath) || !Object.hasOwn(files, value.buildMarkerPath)) {
        throw new Error("invalid build marker path in output receipt");
      }
      if (captureBoundedSourceFile(input.root, value.buildMarkerPath, 512, "screen compiled build marker").toString("utf8").trim() !== value.buildId) {
        throw new Error("compiled build marker does not match output receipt");
      }
    } else if (value.buildId !== value.filesSha256) {
      throw new Error("generic output receipt buildId must equal filesSha256 when buildMarkerPath is omitted");
    }
    for (const [file, entry] of Object.entries(files)) {
      const bytes = captureBoundedSourceFile(input.root, file, MAX_SOURCE_BYTES, "screen build output");
      if (bytes.length !== entry.byteLength || sha256Bytes(bytes) !== entry.sha256) throw new Error(`build output mismatch: ${file}`);
    }
    return;
  }

  throw new Error("invalid build output receipt schema");
}

function verifyBinding(input: HostBuildContainerBinding | undefined, domBuildId: string | null): Binding {
  if (!input) return { status: "unknown", files: new Set(), containerFiles: new Map(), detail: null };
  try {
    if (!sourcePath(input.receiptPath)) throw new Error("unsafe receipt path");
    const raw = captureBoundedSourceFile(input.root, input.receiptPath, MAX_RECEIPT_BYTES, "screen build receipt");
    const receipt: unknown = JSON.parse(raw.toString("utf8"));
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new Error("receipt is not an object");
    const value = receipt as Record<string, unknown>;
    if (Object.keys(value).some((key) => !["schemaVersion", "buildId", "files", "filesSha256"].includes(key)) || value.schemaVersion !== 1 || typeof value.buildId !== "string" || !/^[a-f0-9]{64}$/u.test(value.buildId) || typeof value.filesSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.filesSha256) || !value.files || typeof value.files !== "object" || Array.isArray(value.files)) throw new Error("invalid receipt schema");
    if (value.buildId !== value.filesSha256) throw new Error("receipt build id must equal file inventory digest");
    if (domBuildId !== value.buildId) throw new Error("compiled build id does not match receipt");
    const normalized = receiptFiles(value.files, ["source", "config", "lock"], "receipt", 2_000, MAX_SOURCE_TOTAL);
    for (const [file, entry] of Object.entries(normalized)) {
      const bytes = captureBoundedSourceFile(input.root, file, MAX_SOURCE_BYTES, "screen build source");
      if (bytes.length !== entry.byteLength || sha256Bytes(bytes) !== entry.sha256) throw new Error(`receipt source mismatch: ${file}`);
    }
    if (sha(canonicalFiles(normalized)) !== value.filesSha256) throw new Error("receipt inventory digest mismatch");
    verifyOutputReceipt(input, value.buildId);
    for (const container of input.containers) if (!Object.hasOwn(normalized, container.file)) throw new Error(`container file absent from receipt: ${container.file}`);
    return { status: "verified-container-only", files: new Set(Object.keys(normalized)), containerFiles: new Map(input.containers.map((container, index) => [index, container.file])), detail: null };
  } catch (error) { return { status: "declared", files: new Set(), containerFiles: new Map(), detail: error instanceof Error ? error.message : String(error) }; }
}

/** Computes a bounded list of concrete field/selector changes between two screen capture samples. */
export function computeScreenDriftDetails(
  first: Pick<RawSample, "signature" | "targets">,
  second: Pick<RawSample, "signature" | "targets">,
  phase: "pre-screenshot" | "post-screenshot",
): ScreenDriftDetail[] {
  const details: ScreenDriftDetail[] = [];
  const push = (field: string, selector: string | null, before: string | number | null, after: string | number | null): void => {
    if (details.length < MAX_DRIFT_DETAILS) details.push({ phase, field, selector, before, after });
  };
  if (first.signature.url !== second.signature.url) push("url", null, first.signature.url, second.signature.url);
  if (JSON.stringify(first.signature.viewport) !== JSON.stringify(second.signature.viewport)) push("viewport", null, JSON.stringify(first.signature.viewport), JSON.stringify(second.signature.viewport));
  if (JSON.stringify(first.signature.scroll) !== JSON.stringify(second.signature.scroll)) push("scroll", null, JSON.stringify(first.signature.scroll), JSON.stringify(second.signature.scroll));
  if (JSON.stringify(first.signature.document) !== JSON.stringify(second.signature.document)) push("document", null, JSON.stringify(first.signature.document), JSON.stringify(second.signature.document));
  if (first.signature.fonts !== second.signature.fonts) push("fonts", null, first.signature.fonts, second.signature.fonts);
  if (first.targets.length !== second.targets.length) push("targetCount", null, first.targets.length, second.targets.length);

  const byPath = new Map(first.targets.map((t) => [t.domPath, t]));
  const secondPaths = new Set<string>();
  for (const curr of second.targets) {
    if (details.length >= MAX_DRIFT_DETAILS) break;
    secondPaths.add(curr.domPath);
    const prev = byPath.get(curr.domPath);
    if (!prev) {
      push("target-added", curr.selector, null, curr.domPath);
      continue;
    }
    if (JSON.stringify(prev.box) !== JSON.stringify(curr.box)) {
      push("box", curr.selector, prev.box ? `${prev.box.x},${prev.box.y},${prev.box.width}x${prev.box.height}` : null, curr.box ? `${curr.box.x},${curr.box.y},${curr.box.width}x${curr.box.height}` : null);
    } else if (prev.state !== curr.state || prev.reason !== curr.reason) {
      push("state", curr.selector, `${prev.state}:${prev.reason ?? ""}`, `${curr.state}:${curr.reason ?? ""}`);
    } else if (prev.directTextSha256 !== curr.directTextSha256 || prev.textLength !== curr.textLength) {
      push("text", curr.selector, prev.directTextSha256 ?? prev.textLength, curr.directTextSha256 ?? curr.textLength);
    } else if (prev.horizontalOverflow !== curr.horizontalOverflow) {
      push("horizontalOverflow", curr.selector, prev.horizontalOverflow, curr.horizontalOverflow);
    } else if (prev.clipped !== curr.clipped) {
      push("clipped", curr.selector, prev.clipped, curr.clipped);
    } else if (prev.siblingOverlapPx !== curr.siblingOverlapPx) {
      push("siblingOverlap", curr.selector, prev.siblingOverlapPx, curr.siblingOverlapPx);
    } else if (prev.svgTextOverflowPx !== curr.svgTextOverflowPx) {
      push("svgTextOverflow", curr.selector, prev.svgTextOverflowPx, curr.svgTextOverflowPx);
    } else if (prev.paintSignature !== curr.paintSignature) {
      push("paint", curr.selector, sha(prev.paintSignature).slice(0, 12), sha(curr.paintSignature).slice(0, 12));
    }
  }
  if (details.length < MAX_DRIFT_DETAILS) {
    for (const prev of first.targets) {
      if (details.length >= MAX_DRIFT_DETAILS) break;
      if (!secondPaths.has(prev.domPath)) push("target-removed", prev.selector, prev.domPath, null);
    }
  }
  return details;
}

function summarizeDriftDetails(details: readonly ScreenDriftDetail[]): string {
  if (details.length === 0) return "DOM/layout/viewport/scroll signature changed around screenshot";
  const parts = details.slice(0, 5).map((d) => `${d.phase}:${d.field}${d.selector ? `(${d.selector})` : ""}`);
  return `DOM/layout/viewport/scroll signature changed around screenshot [${parts.join(", ")}${details.length > 5 ? `, +${details.length - 5} more` : ""}]`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<{ value: T | null; timedOut: boolean }> {
  let timer: NodeJS.Timeout | null = null;
  try { const value = await Promise.race([promise, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); })]); return { value, timedOut: value === null }; }
  finally { if (timer) clearTimeout(timer); }
}

async function samplePage(page: StructuralPage, input: { maxTargets: number; allowed: string[]; overlays: string[]; containers: string[]; fullPage: boolean }): Promise<RawSample> {
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
    const parseAlphaToken = (token: string): number | null => {
      const t = token.trim().toLowerCase();
      if (t === "none") return 0;
      if (t.endsWith("%")) { const n = Number(t.slice(0, -1)); return Number.isFinite(n) && n >= 0 && n <= 100 ? n / 100 : null; }
      const n = Number(t); return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
    };
    const alpha = (color: string): number | null => {
      const trimmed = color.trim().toLowerCase();
      if (trimmed === "transparent") return 0;
      const fnMatch = /^([a-z]+)\(([^()]+)\)$/u.exec(trimmed);
      if (!fnMatch) return null;
      const fn = fnMatch[1]!; const body = fnMatch[2]!.trim();
      if (fn === "rgb" || fn === "rgba" || fn === "hsl" || fn === "hsla") {
        if (body.includes(",")) {
          const parts = body.split(",").map((s) => s.trim()).filter(Boolean);
          if (parts.length === 3) return 1;
          if (parts.length === 4) return parseAlphaToken(parts[3]!);
          return null;
        }
        const sp = body.split("/"); if (sp.length > 2) return null;
        const ch = sp[0]!.trim().split(/\s+/u).filter(Boolean); if (ch.length !== 3) return null;
        return sp.length === 2 ? parseAlphaToken(sp[1]!) : 1;
      }
      if (fn === "hwb" || fn === "lab" || fn === "lch" || fn === "oklab" || fn === "oklch") {
        const sp = body.split("/"); if (sp.length > 2) return null;
        const ch = sp[0]!.trim().split(/\s+/u).filter(Boolean); if (ch.length !== 3) return null;
        return sp.length === 2 ? parseAlphaToken(sp[1]!) : 1;
      }
      if (fn === "color") {
        const sp = body.split("/"); if (sp.length > 2) return null;
        const tokens = sp[0]!.trim().split(/\s+/u).filter(Boolean);
        if (tokens.length !== 4 || !colorSpaces.has(tokens[0]!)) return null;
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
      if (style.display === "none" || style.visibility === "hidden" || !!node.closest("dialog:not([open])")) { state = "excluded"; reason = "target/not-rendered"; }
      else if (style.position === "absolute" && box && box.width <= 1 && box.height <= 1 && (style.clip !== "auto" || style.clipPath !== "none")) { state = "excluded"; reason = "target/visually-hidden"; }
      else if (!box || box.width === 0 || box.height === 0 || contained(visibleArea, checkRect) === "outside") { state = "excluded"; reason = "target/off-viewport"; }

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
          if (effectiveOpacity === 0) {
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
          hasDirectText, isSvg, isSvgText, isInteractiveControl: isInteractiveControl(node, tag),
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

    // Second pass: compute direct HTML sibling overlap depth (excluding SVG internals,
    // intentional overlays, fixed/sticky chrome, and pointer-events:none decorative layers).
    const siblingEligible = (node: Element, rec: BrowserRawTarget): boolean => {
      if (rec.isSvg || rec.state !== "candidate" || rec.overlay || !rec.box || rec.box.width <= 0 || rec.box.height <= 0) return false;
      if (node.closest("svg")) return false;
      const st = stylesByNode.get(node);
      if (!st) return false;
      if (st.position === "fixed" || st.position === "sticky" || st.pointerEvents === "none") return false;
      const hasContent = (node.textContent?.trim().length ?? 0) > 0 || REPLACED_TAGS.has(rec.tag);
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
    for (const item of rawRecords) {
      if (!siblingEligible(item.node, item.record)) continue;
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

    const targets: BrowserRawTarget[] = rawRecords.map((item) => item.record);
    const signature: RawSampleSignature = {
      url: location.href,
      viewport: [innerWidth, innerHeight, devicePixelRatio],
      scroll: [sx, sy],
      document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight, document.documentElement.clientWidth, document.documentElement.clientHeight, nodes.length],
      fonts: document.fonts?.status ?? "unsupported",
    };
    return { signature, fontsReady: document.fonts?.status === "loaded", deviceScaleFactor: devicePixelRatio, candidates: nodes.length, omittedCount: capped ? nodes.length - selected.length : 0, signatureTextComplete, ancestorSignatureComplete, exceptions: { allowed: allowedCounts, overlay: overlayCounts }, targets };
  }, input);

  // Direct text crosses this private host boundary only to become a digest. It is never
  // retained in the public report, artifact, events, or evidence metadata.
  const targets = sampled.targets.map(({ directText, ...target }) => ({ ...target, directTextSha256: directText === null ? null : sha(directText) }));
  const targetDigest = JSON.stringify(targets.map((target) => [
    target.selector, target.domPath, target.tag, target.id, target.className, target.textLength, target.directTextSha256,
    target.paintSignature, target.ancestorSignatureComplete, target.box?.x ?? null, target.box?.y ?? null, target.box?.width ?? null, target.box?.height ?? null,
    target.state, target.reason, target.paint, target.transform, target.horizontalOverflow, target.clipped,
    target.siblingOverlapPx, target.svgTextOverflowPx, target.fontSizePx, target.allowedScroll, target.overlay, target.sourceContainer,
  ]));
  return { ...sampled, signature: { ...sampled.signature, targetDigest }, targets };
}

function buildSourceRef(raw: RawTarget, binding: Binding): ScreenTargetEvaluation["source"] {
  const sourceFile = raw.sourceContainer === null ? null : binding.containerFiles.get(raw.sourceContainer) ?? null;
  return sourceFile !== null && binding.status === "verified-container-only"
    ? { status: "verified-container-only", method: "build-bound-component-container", file: sourceFile }
    : { status: binding.status === "declared" ? "declared" : "unknown", method: null, file: null };
}

function buildEvaluation(
  raw: RawTarget,
  ruleId: ScreenRuleId,
  index: number,
  binding: Binding,
  stableCapture: boolean,
  artifactPath: string | null,
  measurement: ScreenMeasurement,
  violated: boolean,
  overrideReason: string | null = null,
): ScreenTargetEvaluation {
  const status = raw.state === "candidate" ? "measured" : raw.state;
  const reason = raw.state === "candidate" ? overrideReason : raw.reason;
  return {
    id: `screen-evaluation-${index}-${ruleId}`,
    ruleId,
    target: { selector: raw.selector, domPath: raw.domPath, tag: raw.tag, box: raw.box, coordinateSystem: raw.coordinateSystem, scroll: raw.scroll },
    status,
    reason,
    measurements: [measurement],
    predicate: { connective: "single", violated: status === "measured" ? violated : null },
    evidenceBound: status === "measured" && stableCapture && artifactPath !== null && binding.status !== "declared",
    source: buildSourceRef(raw, binding),
    stableIdentity: { status: "unavailable", value: null, candidates: [], identityContract: "logical-source-value-v1", canonicalization: "canonical-node-v1" },
  };
}

function severityForScreenRule(ruleId: ScreenRuleId): Severity {
  if (ruleId === "web/unexpected-horizontal-overflow" || ruleId === "web/content-clipped" || ruleId === "web/svg-text-overflows-viewport") {
    return "error";
  }
  return "warn";
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

  const smallTextOpt = options.geometry?.rules?.smallText;
  const smallTextEnabled = smallTextOpt !== undefined && smallTextOpt !== false;
  const smallTextThreshold = typeof smallTextOpt === "object" && smallTextOpt.minFontSizePx !== undefined ? smallTextOpt.minFontSizePx : DEFAULT_SMALL_TEXT_PX;
  const smallTouchOpt = options.geometry?.rules?.smallTouchTarget;
  const smallTouchEnabled = smallTouchOpt !== undefined && smallTouchOpt !== false;
  const smallTouchThreshold = typeof smallTouchOpt === "object" && smallTouchOpt.minSizePx !== undefined ? smallTouchOpt.minSizePx : DEFAULT_SMALL_TOUCH_PX;

  const rulesEnabled: ScreenRuleId[] = [
    "web/unexpected-horizontal-overflow",
    "web/content-clipped",
    "web/sibling-overlap",
    "web/svg-text-overflows-viewport",
    ...(smallTextEnabled ? ["web/small-text" as const] : []),
    ...(smallTouchEnabled ? ["web/small-touch-target" as const] : []),
  ];

  const infrastructure: ScreenInfrastructureEvent[] = [];
  const events: { kind: string; detail: string }[] = [];
  const sampleInput = { maxTargets, allowed, overlays, containers, fullPage };

  const deadline = Date.now() + timeout;
  const fonts = await withTimeout(
    page.evaluate(async () => { if (!document.fonts) return false; await document.fonts.ready; return document.fonts.status === "loaded"; }),
    timeout,
  );

  // Stabilization loop: wait for 2 consecutive identical samples within stabilizationTimeoutMs.
  let before = await samplePage(page, sampleInput);
  let settled = before;
  let stabilized = false;
  let stabilizationAttempts = 0;
  let prev = before;
  let prevHash = sha(stable(prev.signature));
  for (let attempt = 1; attempt <= MAX_STABILIZATION_ATTEMPTS; attempt++) {
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    const curr = await samplePage(page, sampleInput);
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
    if (Date.now() >= deadline) break;
    prev = curr;
    prevHash = currHash;
  }

  const domBuildId = options.sourceBinding ? await page.evaluate((binding) => { try { return document.querySelector(binding.selector)?.getAttribute(binding.attribute) ?? null; } catch { return null; } }, { selector: options.sourceBinding.compiledBuildSelector, attribute: options.sourceBinding.compiledBuildAttribute }) : null;
  const bindingBefore = verifyBinding(options.sourceBinding, domBuildId);
  const bytes = await page.screenshot({ fullPage });
  const after = await samplePage(page, sampleInput);
  const domBuildIdAfter = options.sourceBinding ? await page.evaluate((binding) => { try { return document.querySelector(binding.selector)?.getAttribute(binding.attribute) ?? null; } catch { return null; } }, { selector: options.sourceBinding.compiledBuildSelector, attribute: options.sourceBinding.compiledBuildAttribute }) : null;
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

  const completeSignature = before.signatureTextComplete && settled.signatureTextComplete && after.signatureTextComplete && before.ancestorSignatureComplete && settled.ancestorSignatureComplete && after.ancestorSignatureComplete;
  const stableCapture = !fonts.timedOut && !drifted && completeSignature;

  if (fonts.timedOut) infrastructure.push({ kind: "screen-font-layout-timeout", detail: "document fonts/layout did not settle within the configured bound", fatal: false });
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

  const evaluations: ScreenTargetEvaluation[] = [];
  let i = 0;
  const effectiveBinding: Binding = bindingStable ? bindingAfter : { status: options.sourceBinding ? "declared" : "unknown", files: new Set(), containerFiles: new Map(), detail: bindingAfter.detail };

  for (const raw of settled.targets) {
    const exceptionReason = raw.overlay ? "target/intentional-overlay" : raw.allowedScroll ? "target/allowed-scroll-container" : null;
    // 1. web/unexpected-horizontal-overflow
    evaluations.push(buildEvaluation(
      raw, "web/unexpected-horizontal-overflow", i++, effectiveBinding, stableCapture, relativePath,
      { name: "horizontal-overflow", value: raw.horizontalOverflow, unit: "css-px", operator: ">", threshold: 0, calibrated: false },
      raw.state === "candidate" && !raw.overlay && !raw.allowedScroll && raw.horizontalOverflow > 0,
      exceptionReason,
    ));
    // 2. web/content-clipped
    const clippedVal = raw.clipped === "partial" ? 1 : 0;
    evaluations.push(buildEvaluation(
      raw, "web/content-clipped", i++, effectiveBinding, stableCapture, relativePath,
      { name: "clipped-content", value: clippedVal, unit: "count", operator: ">", threshold: 0, calibrated: false },
      raw.state === "candidate" && !raw.overlay && !raw.allowedScroll && clippedVal > 0,
      exceptionReason,
    ));
    // 3. web/sibling-overlap (HTML elements only; SVG shapes overlap by design)
    if (!raw.isSvg) {
      evaluations.push(buildEvaluation(
        raw, "web/sibling-overlap", i++, effectiveBinding, stableCapture, relativePath,
        { name: "sibling-overlap-depth", value: raw.siblingOverlapPx, unit: "css-px", operator: ">", threshold: SIBLING_OVERLAP_THRESHOLD_PX, calibrated: false },
        raw.state === "candidate" && !raw.overlay && raw.siblingOverlapPx > SIBLING_OVERLAP_THRESHOLD_PX,
        raw.overlay ? "target/intentional-overlay" : null,
      ));
    }
    // 4. web/svg-text-overflows-viewport (SVG <text> targets)
    if (raw.isSvgText) {
      evaluations.push(buildEvaluation(
        raw, "web/svg-text-overflows-viewport", i++, effectiveBinding, stableCapture, relativePath,
        { name: "svg-text-overflow", value: raw.svgTextOverflowPx, unit: "css-px", operator: ">", threshold: SVG_TEXT_OVERFLOW_THRESHOLD_PX, calibrated: false },
        raw.state === "candidate" && raw.svgTextOverflowPx > SVG_TEXT_OVERFLOW_THRESHOLD_PX,
      ));
    }
    // 5. Opt-in web/small-text
    if (smallTextEnabled && raw.hasDirectText) {
      evaluations.push(buildEvaluation(
        raw, "web/small-text", i++, effectiveBinding, stableCapture, relativePath,
        { name: "font-size", value: raw.fontSizePx, unit: "css-px", operator: "<", threshold: smallTextThreshold, calibrated: false },
        raw.state === "candidate" && raw.fontSizePx > 0 && raw.fontSizePx < smallTextThreshold,
      ));
    }
    // 6. Opt-in web/small-touch-target
    if (smallTouchEnabled && raw.isInteractiveControl) {
      const minDim = raw.box ? Math.round(Math.min(raw.box.width, raw.box.height) * 100) / 100 : null;
      evaluations.push(buildEvaluation(
        raw, "web/small-touch-target", i++, effectiveBinding, stableCapture, relativePath,
        { name: "touch-target-min-dimension", value: minDim, unit: "css-px", operator: "<", threshold: smallTouchThreshold, calibrated: false },
        raw.state === "candidate" && minDim !== null && minDim < smallTouchThreshold,
      ));
    }
  }

  const findings: ScreenFinding[] = evaluations.filter((entry) => entry.predicate.violated === true).map((entry, index) => ({
    id: `screen-finding-${index}-${sha(entry.id).slice(0, 12)}`,
    ruleId: entry.ruleId,
    severity: severityForScreenRule(entry.ruleId),
    target: entry.target,
    measurement: entry.measurements[0]!,
    evaluationId: entry.id,
    evidence: { bindsFinding: entry.evidenceBound, screenshot: relativePath },
    repair: { nextCheck: "rerun-same-scenario-and-viewport" },
  }));

  const measured = evaluations.filter((entry) => entry.status === "measured").length;
  const excluded = evaluations.filter((entry) => entry.status === "excluded").length;
  const notMeasured = evaluations.filter((entry) => entry.status === "not-measured").length;
  // A page with candidates but no measurements has no positive observation to support Clean.
  const insufficient = !stableCapture || settled.omittedCount > 0 || notMeasured > 0 || measured === 0;
  const verdict: RunVerdict = infrastructure.some((entry) => entry.fatal) ? "infrastructure" : insufficient ? "insufficient-coverage" : findings.length ? "findings" : "clean";
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
      timedOut: fonts.timedOut,
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
