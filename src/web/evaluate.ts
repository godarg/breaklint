/** Builds per-target screen rule evaluations and findings from a settled Node-side sample. */

import type { Severity } from "../core/enums.ts";
import { sha, type RawTarget } from "./raw-sample.ts";
import type { Binding } from "./receipt.ts";
import type { ScreenFinding, ScreenMeasurement, ScreenRuleId, ScreenTargetEvaluation } from "./types.ts";

export const SIBLING_OVERLAP_THRESHOLD_PX = 2;
export const SVG_TEXT_OVERFLOW_THRESHOLD_PX = 1;

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
  overrideStatus: "excluded" | null = null,
): ScreenTargetEvaluation {
  const status = raw.state === "candidate" ? (overrideStatus ?? "measured") : raw.state;
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

export function severityForScreenRule(ruleId: ScreenRuleId): Severity {
  if (ruleId === "web/unexpected-horizontal-overflow" || ruleId === "web/content-clipped" || ruleId === "web/svg-text-overflows-viewport") {
    return "error";
  }
  return "warn";
}

export interface ScreenEvaluationContext {
  binding: Binding;
  stableCapture: boolean;
  artifactPath: string;
  siblingOverlap: boolean;
  smallText: { enabled: boolean; thresholdPx: number };
  smallTouch: { enabled: boolean; thresholdPx: number };
}

/** Evaluates every enabled screen rule for every settled target, in report order. */
export function evaluateScreenTargets(targets: readonly RawTarget[], ctx: ScreenEvaluationContext): ScreenTargetEvaluation[] {
  const { binding, stableCapture, artifactPath } = ctx;
  const evaluations: ScreenTargetEvaluation[] = [];
  let i = 0;
  for (const raw of targets) {
    const exceptionReason = raw.overlay ? "target/intentional-overlay" : raw.allowedScroll ? "target/allowed-scroll-container" : null;
    const exceptionStatus = exceptionReason !== null ? ("excluded" as const) : null;
    // 1. web/unexpected-horizontal-overflow
    evaluations.push(buildEvaluation(
      raw, "web/unexpected-horizontal-overflow", i++, binding, stableCapture, artifactPath,
      { name: "horizontal-overflow", value: raw.horizontalOverflow, unit: "css-px", operator: ">", threshold: 0, calibrated: false },
      raw.state === "candidate" && !raw.overlay && !raw.allowedScroll && raw.horizontalOverflow > 0,
      exceptionReason,
      exceptionStatus,
    ));
    // 2. web/content-clipped
    const clippedVal = raw.clipped === "partial" ? 1 : 0;
    evaluations.push(buildEvaluation(
      raw, "web/content-clipped", i++, binding, stableCapture, artifactPath,
      { name: "clipped-content", value: clippedVal, unit: "count", operator: ">", threshold: 0, calibrated: false },
      raw.state === "candidate" && !raw.overlay && !raw.allowedScroll && clippedVal > 0,
      exceptionReason,
      exceptionStatus,
    ));
    // 3. Opt-in web/sibling-overlap (HTML elements only; SVG shapes overlap by design)
    if (ctx.siblingOverlap && !raw.isSvg) {
      const siblingExcluded = !raw.siblingEligible;
      const siblingReason = raw.overlay
        ? "target/intentional-overlay"
        : siblingExcluded
          ? "rule/target-not-applicable"
          : null;
      evaluations.push(buildEvaluation(
        raw, "web/sibling-overlap", i++, binding, stableCapture, artifactPath,
        { name: "sibling-overlap-depth", value: raw.siblingOverlapPx, unit: "css-px", operator: ">", threshold: SIBLING_OVERLAP_THRESHOLD_PX, calibrated: false },
        raw.state === "candidate" && raw.siblingEligible && !raw.overlay && raw.siblingOverlapPx > SIBLING_OVERLAP_THRESHOLD_PX,
        siblingReason,
        siblingExcluded || raw.overlay ? "excluded" : null,
      ));
    }
    // 4. web/svg-text-overflows-viewport (SVG <text> targets)
    if (raw.isSvgText) {
      evaluations.push(buildEvaluation(
        raw, "web/svg-text-overflows-viewport", i++, binding, stableCapture, artifactPath,
        { name: "svg-text-overflow", value: raw.svgTextOverflowPx, unit: "css-px", operator: ">", threshold: SVG_TEXT_OVERFLOW_THRESHOLD_PX, calibrated: false },
        raw.state === "candidate" && raw.svgTextOverflowPx > SVG_TEXT_OVERFLOW_THRESHOLD_PX,
      ));
    }
    // 5. Opt-in web/small-text
    if (ctx.smallText.enabled && raw.hasDirectText) {
      evaluations.push(buildEvaluation(
        raw, "web/small-text", i++, binding, stableCapture, artifactPath,
        { name: "font-size", value: raw.fontSizePx, unit: "css-px", operator: "<", threshold: ctx.smallText.thresholdPx, calibrated: false },
        raw.state === "candidate" && raw.fontSizePx > 0 && raw.fontSizePx < ctx.smallText.thresholdPx,
      ));
    }
    // 6. Opt-in web/small-touch-target
    if (ctx.smallTouch.enabled && raw.isInteractiveControl) {
      const minDim = raw.box ? Math.round(Math.min(raw.box.width, raw.box.height) * 100) / 100 : null;
      evaluations.push(buildEvaluation(
        raw, "web/small-touch-target", i++, binding, stableCapture, artifactPath,
        { name: "touch-target-min-dimension", value: minDim, unit: "css-px", operator: "<", threshold: ctx.smallTouch.thresholdPx, calibrated: false },
        raw.state === "candidate" && minDim !== null && minDim < ctx.smallTouch.thresholdPx,
      ));
    }
  }
  return evaluations;
}

/** One finding per violated evaluation, in evaluation order. */
export function screenFindings(evaluations: readonly ScreenTargetEvaluation[], artifactPath: string): ScreenFinding[] {
  return evaluations.filter((entry) => entry.predicate.violated === true).map((entry, index) => ({
    id: `screen-finding-${index}-${sha(entry.id).slice(0, 12)}`,
    ruleId: entry.ruleId,
    severity: severityForScreenRule(entry.ruleId),
    target: entry.target,
    measurement: entry.measurements[0]!,
    evaluationId: entry.id,
    evidence: { bindsFinding: entry.evidenceBound, screenshot: artifactPath },
    repair: { nextCheck: "rerun-same-scenario-and-viewport" },
  }));
}
