/** Public host-page adapter. It observes an already-opened page and writes only its PNG artifact. */

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureBoundedSourceFile, sha256Bytes } from "../source/bytes.ts";
import { EXIT_CODE_BY_VERDICT, type RunVerdict } from "../core/enums.ts";
import { validateCheckPageOptions } from "../web/options.ts";
import type {
  CheckPageOptions, HostBuildContainerBinding, PublicScreenReport, ScreenCheckResult,
  ScreenFinding, ScreenInfrastructureEvent, ScreenTargetEvaluation, StructuralPage,
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

type RawTarget = {
  selector: string; domPath: string; tag: string; id: string; className: string; textLength: number; directTextSha256: string | null;
  paintSignature: string; ancestorSignatureComplete: boolean;
  box: { x: number; y: number; width: number; height: number } | null;
  state: "candidate" | "excluded" | "not-measured"; reason: string | null; paint: string | null;
  transform: string | null; clipped: "none" | "partial" | "outside"; horizontalOverflow: number; allowedScroll: boolean;
  overlay: boolean; sourceContainer: number | null; scroll: { x: number; y: number };
};
type RawSample = {
  signature: unknown; fontsReady: boolean; deviceScaleFactor: number; candidates: number; omittedCount: number;
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
function verifyOutputReceipt(input: HostBuildContainerBinding, sourceBuildId: string): void {
  if (!input.buildOutputReceiptPath) throw new Error("build output receipt path is required for verified host binding");
  if (!sourcePath(input.buildOutputReceiptPath)) throw new Error("unsafe build output receipt path");
  const raw = captureBoundedSourceFile(input.root, input.buildOutputReceiptPath, MAX_RECEIPT_BYTES, "screen build output receipt");
  const receipt: unknown = JSON.parse(raw.toString("utf8"));
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new Error("build output receipt is not an object");
  const value = receipt as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["schemaVersion", "sourceBuildId", "nextBuildId", "files", "filesSha256"].includes(key)) || value.schemaVersion !== 1 || value.sourceBuildId !== sourceBuildId || typeof value.nextBuildId !== "string" || !/^[A-Za-z0-9_-]{1,256}$/u.test(value.nextBuildId) || typeof value.filesSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.filesSha256)) throw new Error("invalid build output receipt schema");
  const files = receiptFiles(value.files, ["build-output"], "build output receipt", MAX_OUTPUT_FILES, MAX_OUTPUT_TOTAL);
  if (!Object.hasOwn(files, ".next/BUILD_ID") || sha(canonicalFiles(files)) !== value.filesSha256) throw new Error("invalid build output receipt inventory");
  if (captureBoundedSourceFile(input.root, ".next/BUILD_ID", 512, "screen compiled build id").toString("utf8").trim() !== value.nextBuildId) throw new Error("compiled BUILD_ID does not match output receipt");
  for (const [file, entry] of Object.entries(files)) {
    const bytes = captureBoundedSourceFile(input.root, file, MAX_SOURCE_BYTES, "screen build output");
    if (bytes.length !== entry.byteLength || sha256Bytes(bytes) !== entry.sha256) throw new Error(`build output mismatch: ${file}`);
  }
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<{ value: T | null; timedOut: boolean }> {
  let timer: NodeJS.Timeout | null = null;
  try { const value = await Promise.race([promise, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); })]); return { value, timedOut: value === null }; }
  finally { if (timer) clearTimeout(timer); }
}

async function samplePage(page: StructuralPage, input: { maxTargets: number; allowed: string[]; overlays: string[]; containers: string[] }): Promise<RawSample> {
  const sampled: BrowserRawSample = await page.evaluate(async (options) => {
    type Box = { x: number; y: number; width: number; height: number };
    const rect = (node: Element): Box | null => { const r = node.getBoundingClientRect(); return Number.isFinite(r.x) && Number.isFinite(r.y) && r.width >= 0 && r.height >= 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; };
    const contained = (outer: DOMRect, inner: DOMRect): "none" | "partial" | "outside" => {
      const left = Math.max(outer.left, inner.left), top = Math.max(outer.top, inner.top), right = Math.min(outer.right, inner.right), bottom = Math.min(outer.bottom, inner.bottom);
      if (right <= left || bottom <= top) return "outside";
      return left === inner.left && top === inner.top && right === inner.right && bottom === inner.bottom ? "none" : "partial";
    };
    const domPath = (node: Element): string => { const parts: string[] = []; let cur: Element | null = node; while (cur && parts.length < 16) { const parentElement: Element | null = cur.parentElement; const i = parentElement ? [...parentElement.children].indexOf(cur) + 1 : 1; parts.push(`${cur.tagName.toLowerCase()}:nth-child(${i})`); cur = parentElement; } return parts.reverse().join(">"); };
    const selector = (node: Element, fallback: string): string => node.id ? `#${CSS.escape(node.id)}` : fallback;
    const alpha = (color: string): number | null => { const match = color.match(/^rgba?\(([^)]+)\)$/u); if (!match) return null; const values = match[1]!.split(/[,\s/]+/u).filter(Boolean); if (values.length < 3) return null; if (values.length < 4) return 1; const a = Number(values[3]); return Number.isFinite(a) && a >= 0 && a <= 1 ? a : null; };
    const svgPaintAlpha = (paint: string, opacity: string): number | null => { if (paint.trim() === "none") return 0; const paintAlpha = alpha(paint); const componentOpacity = Number(opacity); return paintAlpha === null || !Number.isFinite(componentOpacity) || componentOpacity < 0 || componentOpacity > 1 ? null : paintAlpha * componentOpacity; };
    const transform = (style: CSSStyleDeclaration): string | null => { const v = style.transform; if (v === "none") return null; const match = v.match(/^matrix\(([^)]+)\)$/u); if (!match) return "unsupported-transform"; const n = match[1]!.split(",").map(Number); return n.length === 6 && Number.isFinite(n[0]) && Number.isFinite(n[3]) && n[0]! > 0 && n[3]! > 0 && n[1] === 0 && n[2] === 0 ? null : "unsupported-transform"; };
    const matchCount = (selectors: string[]): number[] => selectors.map((s) => { try { return document.querySelectorAll(s).length; } catch { return -1; } });
    const allowedCounts = matchCount(options.allowed), overlayCounts = matchCount(options.overlays);
    const isMatch = (node: Element, selectors: string[]): boolean => selectors.some((s) => { try { return node.matches(s) || !!node.closest(s); } catch { return false; } });
    const containerIndex = (node: Element): number | null => { for (let i = 0; i < options.containers.length; i++) { try { if (node.closest(options.containers[i]!)) return i; } catch { return null; } } return null; };
    const visibleViewport = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const paintValues = (style: CSSStyleDeclaration): string[] => [style.color, style.getPropertyValue("-webkit-text-fill-color"), style.backgroundColor, style.fill, style.getPropertyValue("fill-opacity"), style.stroke, style.getPropertyValue("stroke-opacity"), style.fontFamily, style.fontSize, style.fontWeight, style.fontStyle, style.fontStretch, style.fontKerning, style.lineHeight, style.letterSpacing, style.wordSpacing, style.opacity, style.filter, style.backdropFilter, style.maskImage, style.webkitMaskImage, style.clipPath, style.clip, style.transform];
    let signatureTextBytes = 0; let signatureTextComplete = true; let ancestorSignatureComplete = true;
    const nodes = [...document.querySelectorAll("*")]; const capped = nodes.length > options.maxTargets; const selected = nodes.slice(0, options.maxTargets);
    const targets = await Promise.all(selected.map(async (node, index) => {
      const style = getComputedStyle(node); const box = rect(node); const path = domPath(node); const fallback = `[data-breaklint-target="${index}"]`;
      let state: "candidate" | "excluded" | "not-measured" = "candidate"; let reason: string | null = null; let paint: string | null = null;
      if (style.display === "none" || style.visibility === "hidden" || !!node.closest("dialog:not([open])")) { state = "excluded"; reason = "target/not-rendered"; }
      else if (style.position === "absolute" && box && box.width <= 1 && box.height <= 1 && (style.clip !== "auto" || style.clipPath !== "none")) { state = "excluded"; reason = "target/visually-hidden"; }
      else if (!box || box.width === 0 || box.height === 0 || contained(visibleViewport, node.getBoundingClientRect()) === "outside") { state = "excluded"; reason = "target/off-viewport"; }
      const directTextNodes = [...node.childNodes].filter((child): child is Text => child.nodeType === Node.TEXT_NODE);
      const ownClip = [style.overflow, style.overflowX, style.overflowY].some((value) => value === "hidden" || value === "clip");
      let clipped: "none" | "partial" | "outside" = "none";
      if (state === "candidate" && ownClip && box && directTextNodes.some((text) => { const range = document.createRange(); range.selectNodeContents(text); return [...range.getClientRects()].some((textRect) => contained(node.getBoundingClientRect(), textRect) !== "none"); })) clipped = "partial";
      let ancestor: Element | null = node.parentElement;
      while (state === "candidate" && ancestor) { const ps = getComputedStyle(ancestor); const clip = [ps.overflow, ps.overflowX, ps.overflowY].some((v) => v === "hidden" || v === "clip"); if (clip && box) { const outcome = contained(ancestor.getBoundingClientRect(), node.getBoundingClientRect()); if (outcome !== "none") { clipped = outcome; if (outcome === "outside") { state = "not-measured"; reason = "evidence/target-clipped-outside"; } break; } } ancestor = ancestor.parentElement; }
      const chain = [node, ...(() => { const out: Element[] = []; let x = node.parentElement; while (x) { out.push(x); x = x.parentElement; } return out; })()];
      const targetPaintSignature = paintValues(style);
      const ancestorSignature = chain.slice(1, 65).map((part) => paintValues(getComputedStyle(part)));
      const targetAncestorSignatureComplete = chain.length <= 65;
      if (!targetAncestorSignatureComplete) ancestorSignatureComplete = false;
      if (state === "candidate") for (const part of chain) { const ps = getComputedStyle(part); if (ps.opacity !== "1" || ps.filter !== "none" || ps.backdropFilter !== "none" || ps.maskImage !== "none" || ps.webkitMaskImage !== "none" || ps.clipPath !== "none" || ps.clip !== "auto") { state = "not-measured"; reason = "evidence/paint-unsupported"; paint = reason; break; } if (transform(ps)) { state = "not-measured"; reason = "evidence/transform-unsupported"; paint = reason; break; } if (part.getAnimations({ subtree: false }).some((a) => a.playState === "running")) { state = "not-measured"; reason = "evidence/animation-active"; paint = reason; break; } }
      if (state === "candidate") { const textAlpha = alpha(style.color); const webkitTextFill = style.getPropertyValue("-webkit-text-fill-color"); const textFillAlpha = webkitTextFill ? alpha(webkitTextFill) : textAlpha; const svg = node instanceof SVGElement; const fill = svgPaintAlpha(style.fill, style.getPropertyValue("fill-opacity") || "1"); const stroke = svgPaintAlpha(style.stroke, style.getPropertyValue("stroke-opacity") || "1"); if ((!svg && (textAlpha === 0 || textFillAlpha === 0)) || (svg && fill === 0 && stroke === 0)) { state = "not-measured"; reason = "evidence/target-not-visible"; paint = reason; } else if ((!svg && (textAlpha === null || textFillAlpha === null)) || (svg && (fill === null || stroke === null))) { state = "not-measured"; reason = "evidence/paint-unsupported"; paint = reason; } }
      const className = typeof node.className === "string" ? node.className : node.getAttribute("class") ?? "";
      const directText = directTextNodes.map((child) => child.textContent ?? "").join("\u0000");
      const directTextBytes = new TextEncoder().encode(directText).byteLength;
      const includeDirectText = signatureTextBytes + directTextBytes <= 1_048_576;
      if (includeDirectText) signatureTextBytes += directTextBytes; else signatureTextComplete = false;
      return { selector: selector(node, fallback), domPath: path, tag: node.tagName.toLowerCase(), id: node.id, className, textLength: node.textContent?.length ?? 0, directText: includeDirectText ? directText : null, paintSignature: JSON.stringify([targetPaintSignature, ancestorSignature]), ancestorSignatureComplete: targetAncestorSignatureComplete, box, state, reason, paint, transform: transform(style), clipped, horizontalOverflow: Math.max(0, node.scrollWidth - node.clientWidth), allowedScroll: isMatch(node, options.allowed), overlay: isMatch(node, options.overlays), sourceContainer: containerIndex(node), scroll: { x: window.scrollX, y: window.scrollY } };
    }));
    // Do not use HTML serialization here. Chromium screenshot capture may materialize a
    // semantically inert `style=""` attribute (without changing layout or computed paint).
    // This bounded signature instead covers DOM membership/identity plus every observable
    // geometry, visibility, paint, transform, clipping, and overflow input used by the rules.
    const signature = { url: location.href, viewport: [innerWidth, innerHeight, devicePixelRatio], scroll: [scrollX, scrollY], document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight, document.documentElement.clientWidth, document.documentElement.clientHeight, nodes.length], fonts: document.fonts?.status ?? "unsupported" };
    return { signature, fontsReady: document.fonts?.status === "loaded", deviceScaleFactor: devicePixelRatio, candidates: nodes.length, omittedCount: capped ? nodes.length - selected.length : 0, signatureTextComplete, ancestorSignatureComplete, exceptions: { allowed: allowedCounts, overlay: overlayCounts }, targets };
  }, input);
  // Direct text crosses this private host boundary only to become a digest. It is never
  // retained in the public report, artifact, events, or evidence metadata.
  const targets = sampled.targets.map(({ directText, ...target }) => ({ ...target, directTextSha256: directText === null ? null : sha(directText) }));
  const targetDigest = JSON.stringify(targets.map((target) => [target.selector, target.domPath, target.tag, target.id, target.className, target.textLength, target.directTextSha256, target.paintSignature, target.ancestorSignatureComplete, target.box?.x ?? null, target.box?.y ?? null, target.box?.width ?? null, target.box?.height ?? null, target.state, target.reason, target.paint, target.transform, target.horizontalOverflow, target.clipped, target.allowedScroll, target.overlay, target.sourceContainer]));
  return { ...sampled, signature: { ...(sampled.signature as Record<string, unknown>), targetDigest }, targets };
}

function evaluation(raw: RawTarget, ruleId: ScreenTargetEvaluation["ruleId"], index: number, binding: Binding, stableCapture: boolean, artifactPath: string | null): ScreenTargetEvaluation {
  const overflow = ruleId === "web/unexpected-horizontal-overflow" ? raw.horizontalOverflow : raw.clipped === "partial" ? 1 : 0;
  const violation = raw.state === "candidate" && !raw.overlay && !raw.allowedScroll && overflow > 0;
  const status = raw.state === "candidate" ? "measured" : raw.state;
  const reason = raw.state === "candidate" ? (raw.overlay ? "target/intentional-overlay" : raw.allowedScroll ? "target/allowed-scroll-container" : null) : raw.reason;
  const sourceFile = raw.sourceContainer === null ? null : binding.containerFiles.get(raw.sourceContainer) ?? null;
  const source = sourceFile !== null && binding.status === "verified-container-only" ? { status: "verified-container-only" as const, method: "build-bound-component-container" as const, file: sourceFile } : { status: binding.status === "declared" ? "declared" as const : "unknown" as const, method: null, file: null };
  return { id: `screen-evaluation-${index}-${ruleId}`, ruleId, target: { selector: raw.selector, domPath: raw.domPath, tag: raw.tag, box: raw.box, coordinateSystem: "css-viewport-pixels", scroll: raw.scroll }, status, reason,
    measurements: [{ name: ruleId === "web/unexpected-horizontal-overflow" ? "horizontal-overflow" : "clipped-content", value: overflow, unit: ruleId === "web/unexpected-horizontal-overflow" ? "css-px" : "count", operator: ">", threshold: 0 }], predicate: { connective: "single", violated: status === "measured" ? violation : null }, evidenceBound: status === "measured" && stableCapture && artifactPath !== null && binding.status !== "declared", source, stableIdentity: { status: "unavailable", value: null, candidates: [], identityContract: "logical-source-value-v1", canonicalization: "canonical-node-v1" } };
}

/** Observe one existing host-owned page; it never navigates, mutates, closes, or imports a driver. */
export async function checkPage(page: StructuralPage, rawOptions: unknown): Promise<ScreenCheckResult> {
  const options = validateCheckPageOptions(rawOptions); const runId = options.runId ?? randomUUID(); const timeout = options.geometry?.stabilizationTimeoutMs ?? 2_000; const maxTargets = options.geometry?.maxTargets ?? 2_000;
  const allowed = options.geometry?.allowedScrollContainers?.map((x) => x.selector) ?? []; const overlays = options.geometry?.intentionalOverlays?.map((x) => x.selector) ?? []; const containers = options.sourceBinding?.containers.map((x) => x.selector) ?? [];
  const infrastructure: ScreenInfrastructureEvent[] = []; const events: { kind: string; detail: string }[] = [];
  const fonts = await withTimeout(page.evaluate(async () => { if (!document.fonts) return false; await document.fonts.ready; return document.fonts.status === "loaded"; }), timeout);
  const before = await samplePage(page, { maxTargets, allowed, overlays, containers });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const settled = await samplePage(page, { maxTargets, allowed, overlays, containers });
  const domBuildId = options.sourceBinding ? await page.evaluate((binding) => { try { return document.querySelector(binding.selector)?.getAttribute(binding.attribute) ?? null; } catch { return null; } }, { selector: options.sourceBinding.compiledBuildSelector, attribute: options.sourceBinding.compiledBuildAttribute }) : null;
  const bindingBefore = verifyBinding(options.sourceBinding, domBuildId);
  const bytes = await page.screenshot({ fullPage: options.output.screenshot === "full-page" });
  const after = await samplePage(page, { maxTargets, allowed, overlays, containers });
  const domBuildIdAfter = options.sourceBinding ? await page.evaluate((binding) => { try { return document.querySelector(binding.selector)?.getAttribute(binding.attribute) ?? null; } catch { return null; } }, { selector: options.sourceBinding.compiledBuildSelector, attribute: options.sourceBinding.compiledBuildAttribute }) : null;
  const bindingAfter = verifyBinding(options.sourceBinding, domBuildIdAfter);
  const captureBefore = sha(stable(before.signature)), captureStable = sha(stable(settled.signature)), captureAfter = sha(stable(after.signature));
  const drifted = captureBefore !== captureStable || captureBefore !== captureAfter;
  const completeSignature = before.signatureTextComplete && settled.signatureTextComplete && after.signatureTextComplete && before.ancestorSignatureComplete && settled.ancestorSignatureComplete && after.ancestorSignatureComplete;
  const stableCapture = !fonts.timedOut && !drifted && completeSignature;
  if (fonts.timedOut) infrastructure.push({ kind: "screen-font-layout-timeout", detail: "document fonts/layout did not settle within the configured bound", fatal: false });
  if (drifted) infrastructure.push({ kind: "screen-capture-drift", detail: "DOM/layout/viewport/scroll signature changed around screenshot", fatal: false });
  if (!before.signatureTextComplete || !settled.signatureTextComplete || !after.signatureTextComplete) infrastructure.push({ kind: "screen-dom-signature-incomplete", detail: `direct child text exceeded the ${MAX_SIGNATURE_TEXT_BYTES}-byte capture bound or browser hashing was unavailable`, fatal: false });
  if (!before.ancestorSignatureComplete || !settled.ancestorSignatureComplete || !after.ancestorSignatureComplete) infrastructure.push({ kind: "screen-paint-signature-incomplete", detail: `a target ancestor chain exceeded the ${MAX_SIGNATURE_ANCESTORS}-ancestor capture bound`, fatal: false });
  const bindingStable = bindingBefore.status === "verified-container-only" && bindingAfter.status === "verified-container-only" && bindingBefore.detail === bindingAfter.detail && domBuildId === domBuildIdAfter;
  if (!bindingStable) events.push({ kind: "source-binding-unavailable", detail: bindingAfter.detail ?? bindingBefore.detail ?? "host build container binding unavailable or changed during capture" });
  for (const [kind, entries, counts] of [["allowed-scroll-container", options.geometry?.allowedScrollContainers ?? [], before.exceptions.allowed], ["intentional-overlay", options.geometry?.intentionalOverlays ?? [], before.exceptions.overlay]] as const) {
    entries.forEach((entry, index) => { if ((counts[index] ?? 0) <= 0) events.push({ kind: "screen-exception-unused", detail: `${kind} ${entry.selector} matched no current target` }); });
  }
  const artifactDir = join(options.output.dir, "evidence"); mkdirSync(artifactDir, { recursive: true });
  // runId is public report data, not a filesystem component. Hash it before naming an artifact.
  const relativePath = `evidence/screen-${sha(runId).slice(0, 32)}.png`; writeFileSync(join(options.output.dir, relativePath), bytes);
  const dimensions = pngSize(bytes); if (!dimensions) infrastructure.push({ kind: "screen-screenshot-invalid", detail: "host screenshot was not a PNG with IHDR dimensions", fatal: true });
  const evaluations: ScreenTargetEvaluation[] = []; let i = 0;
  const effectiveBinding: Binding = bindingStable ? bindingAfter : { status: options.sourceBinding ? "declared" : "unknown", files: new Set(), containerFiles: new Map(), detail: bindingAfter.detail };
  for (const raw of before.targets) for (const ruleId of ["web/unexpected-horizontal-overflow", "web/content-clipped"] as const) evaluations.push(evaluation(raw, ruleId, i++, effectiveBinding, stableCapture, relativePath));
  const findings: ScreenFinding[] = evaluations.filter((entry) => entry.predicate.violated === true).map((entry, index) => ({ id: `screen-finding-${index}-${sha(entry.id).slice(0, 12)}`, ruleId: entry.ruleId, severity: "error", target: entry.target, measurement: entry.measurements[0]!, evaluationId: entry.id, evidence: { bindsFinding: entry.evidenceBound, screenshot: relativePath }, repair: { nextCheck: "rerun-same-scenario-and-viewport" } }));
  const measured = evaluations.filter((entry) => entry.status === "measured").length; const excluded = evaluations.filter((entry) => entry.status === "excluded").length; const notMeasured = evaluations.filter((entry) => entry.status === "not-measured").length;
  // A page with candidates but no measurements has no positive observation to support Clean.
  const insufficient = !stableCapture || before.omittedCount > 0 || notMeasured > 0 || measured === 0; const verdict: RunVerdict = infrastructure.some((entry) => entry.fatal) ? "infrastructure" : insufficient ? "insufficient-coverage" : findings.length ? "findings" : "clean";
  const viewport = page.viewportSize();
  const browserVersion = await Promise.resolve(page.context().browser()?.version() ?? null);
  const report: PublicScreenReport = { schemaVersion: 1, profileKind: "screen", runId, runVerdict: verdict, exitCode: EXIT_CODE_BY_VERDICT[verdict], scope: { projectId: options.projectId ?? null, documentId: options.documentId ?? null, scenario: options.scenario, url: safeUrl(page.url()), viewport: { width: viewport?.width ?? 0, height: viewport?.height ?? 0, deviceScaleFactor: before.deviceScaleFactor }, browserVersion }, trust: "host-controlled-page", networkPolicy: "host-owned", targetInventory: { complete: before.omittedCount === 0 && completeSignature, omittedCount: before.omittedCount, reason: before.omittedCount ? "screen/target-enumeration-capped" : !completeSignature ? "screen/signature-incomplete" : null }, coverage: { candidates: before.candidates * 2, measured, excluded, notMeasured, allowedScrollContainers: (options.geometry?.allowedScrollContainers ?? []).map((entry, index) => ({ ...entry, count: before.exceptions.allowed[index] ?? 0 })), intentionalOverlays: (options.geometry?.intentionalOverlays ?? []).map((entry, index) => ({ ...entry, count: before.exceptions.overlay[index] ?? 0 })) }, capture: { before: captureBefore, stable: captureStable, after: captureAfter, fontsReady: fonts.value === true && before.fontsReady, timedOut: fonts.timedOut, drifted }, artifact: { kind: "png", relativePath: dimensions ? relativePath : null, sha256: dimensions ? sha(bytes) : null, byteLength: dimensions ? bytes.length : null, widthPx: dimensions?.widthPx ?? null, heightPx: dimensions?.heightPx ?? null, capture: options.output.screenshot, coordinateSystem: "css-viewport-pixels-with-scroll" }, evaluations, findings, infrastructure, events };
  return verdict === "clean" || verdict === "findings" ? { ok: true, report } : { ok: false, report };
}
