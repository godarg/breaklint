/**
 * Private Node-side shapes of one in-page screen sample. Nothing here is public API; the public
 * report contract lives in types.ts.
 */

import { createHash } from "node:crypto";

export const sha = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
export const stable = (value: unknown): string => JSON.stringify(value);

export type RawTarget = {
  selector: string; domPath: string; tag: string; id: string; className: string; textLength: number; directTextSha256: string | null;
  hasDirectText: boolean; isSvg: boolean; isSvgText: boolean; isInteractiveControl: boolean; siblingEligible: boolean;
  fontSizePx: number; siblingOverlapPx: number; svgTextOverflowPx: number;
  paintSignature: string; ancestorSignatureComplete: boolean;
  box: { x: number; y: number; width: number; height: number } | null;
  coordinateSystem: "css-viewport-pixels" | "css-document-pixels";
  state: "candidate" | "excluded" | "not-measured"; reason: string | null; paint: string | null;
  transform: string | null; clipped: "none" | "partial" | "outside"; horizontalOverflow: number; allowedScroll: boolean;
  overlay: boolean; sourceContainer: number | null; scroll: { x: number; y: number };
};
export type RawSampleSignature = {
  url: string;
  viewport: [number, number, number];
  scroll: [number, number];
  document: [number, number, number, number, number];
  fonts: string;
  targetDigest?: string;
};
export type RawSample = {
  signature: RawSampleSignature; fontsReady: boolean; deviceScaleFactor: number; candidates: number; omittedCount: number;
  signatureTextComplete: boolean; ancestorSignatureComplete: boolean;
  exceptions: { allowed: number[]; overlay: number[] }; targets: RawTarget[];
};
export type BrowserRawTarget = Omit<RawTarget, "directTextSha256"> & { directText: string | null };
export type BrowserRawSample = Omit<RawSample, "targets"> & { targets: BrowserRawTarget[] };

/**
 * Turns the browser's private sample into the Node-side sample. Direct text crosses this private
 * host boundary only to become a digest. It is never retained in the public report, artifact,
 * events, or evidence metadata.
 */
export function digestBrowserSample(sampled: BrowserRawSample): RawSample {
  const targets = sampled.targets.map(({ directText, ...target }) => ({ ...target, directTextSha256: directText === null ? null : sha(directText) }));
  const targetDigest = JSON.stringify(targets.map((target) => [
    target.selector, target.domPath, target.tag, target.id, target.className, target.textLength, target.directTextSha256,
    target.paintSignature, target.ancestorSignatureComplete, target.box?.x ?? null, target.box?.y ?? null, target.box?.width ?? null, target.box?.height ?? null,
    target.state, target.reason, target.paint, target.transform, target.horizontalOverflow, target.clipped,
    target.siblingOverlapPx, target.svgTextOverflowPx, target.fontSizePx, target.hasDirectText, target.isInteractiveControl, target.siblingEligible,
    target.allowedScroll, target.overlay, target.sourceContainer,
  ]));
  return { ...sampled, signature: { ...sampled.signature, targetDigest }, targets };
}
