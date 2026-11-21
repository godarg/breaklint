/** Structured, bounded drift details between two screen capture samples. */

import { sha, type RawSample } from "./raw-sample.ts";
import type { ScreenDriftDetail } from "./types.ts";

export const MAX_DRIFT_DETAILS = 10;

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
      // The field name is the change marker; only lengths are public. A text digest would let a
      // reader recover short page text (amounts, names) by dictionary search.
      push("text", curr.selector, prev.textLength, curr.textLength);
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

export function summarizeDriftDetails(details: readonly ScreenDriftDetail[]): string {
  if (details.length === 0) return "DOM/layout/viewport/scroll signature changed around screenshot";
  const parts = details.slice(0, 5).map((d) => `${d.phase}:${d.field}${d.selector ? `(${d.selector})` : ""}`);
  return `DOM/layout/viewport/scroll signature changed around screenshot [${parts.join(", ")}${details.length > 5 ? `, +${details.length - 5} more` : ""}]`;
}
