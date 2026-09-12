/** Helpers shared by rules. Nothing here reaches outside the snapshot. */

import type { EnvId, KeyType, Severity } from "../core/enums.ts";
import type { Box, Finding, NotMeasured, PageRecord, Snapshot, SourceRef, TargetEvaluation } from "../core/types.ts";
import type { RuleContext } from "../core/rule.ts";

export function sourceOf(snapshot: Snapshot, sid: string | null): SourceRef | null {
  // `sid === null` means the paginator produced the node. Nothing is guessed here; a margin
  // box has no line in a source file, and a SARIF consumer must not be pointed at one.
  if (!sid) return null;
  return snapshot.source.map[sid] ?? null;
}

export function declined(input: {
  scope: NotMeasured["scope"];
  ruleId: string;
  reason: EnvId;
  count?: number;
  target?: NotMeasured["target"];
}): NotMeasured {
  return {
    scope: input.scope,
    ruleId: input.ruleId,
    reason: input.reason,
    target: input.count && input.count > 1 ? null : (input.target ?? null),
    count: input.count ?? 1,
  };
}

export function makeFinding(input: {
  ctx: RuleContext;
  ruleId: string;
  severity: Severity;
  experimental?: boolean;
  message: string;
  page: number;
  keyType: KeyType;
  key: string;
  nodeKey: string;
  sid: string | null;
  fragmentIndex?: number;
  boxScreen?: Box | null;
  source: SourceRef | null;
  value: number;
  threshold: number;
  unit: string;
  proofSource?: Finding["measurement"]["proofSource"];
  ambiguity?: Finding["ambiguity"];
}): Finding {
  return {
    runFindingId: `unbound-legacy-run:${input.ctx.documentPath}:${input.ruleId}:${input.nodeKey}:${input.fragmentIndex ?? 0}`,
    fingerprint: input.ctx.fingerprint({
      ruleId: input.ruleId,
      keyType: input.keyType,
      key: input.key,
    }),
    // The v1 fingerprint key can be content- or author-id-derived and may be shared by two
    // distinct targets. It is useful for cross-run grouping but is not yet a verified unique
    // target identity. P3 supplies the stronger identity proof; until then, be explicit.
    stableIdentity: input.ambiguity
      ? { status: "ambiguous", value: null, candidates: [] }
      : { status: "unavailable", value: null, candidates: [] },
    ruleId: input.ruleId,
    severity: input.severity,
    experimental: input.experimental ?? false,
    message: input.message,
    document: input.ctx.documentPath,
    page: input.page,
    target: {
      keyType: input.keyType,
      nodeKey: input.nodeKey,
      sid: input.sid,
      fragmentIndex: input.fragmentIndex ?? 0,
      boxScreen: input.boxScreen ?? null,
    },
    source: input.source,
    measurement: {
      value: input.value,
      threshold: input.threshold,
      unit: input.unit,
      calibrated: false,
      proofSource: input.proofSource ?? null,
    },
    ambiguity: input.ambiguity ?? null,
    // Filled in by the evidence stage once the raster exists; a rule never invents a path.
    evidence: { ref: null, bindsFinding: false },
    originalSource: {
      status: input.source ? "declared" : "unavailable",
      role: "unknown",
      location: input.source,
      integrity: null,
      candidates: input.source ? [input.source] : [],
    },
    actionability: input.source ? "recheck-required" : "unknown-source",
  };
}

export function targetEvaluation(input: {
  ruleId: string;
  keyType: KeyType;
  nodeKey: string;
  sid: string | null;
  fragmentIndex?: number;
  boxScreen?: Box | null;
  status: TargetEvaluation["status"];
  /** Required only when one concrete source address has multiple independent decisions. */
  occurrenceKey?: string;
  targetCount?: number;
  countsTowardCoverage?: boolean;
  reason?: string | null;
  measurements?: TargetEvaluation["measurements"];
  connective?: TargetEvaluation["predicate"]["connective"];
  violated?: boolean | null;
}): TargetEvaluation {
  return {
    ruleId: input.ruleId,
    semanticsVersion: "rule-decision-v1",
    targetRef: {
      keyType: input.keyType,
      nodeKey: input.nodeKey,
      sid: input.sid,
      fragmentIndex: input.fragmentIndex ?? 0,
      boxScreen: input.boxScreen ?? null,
    },
    status: input.status,
    ...(input.occurrenceKey === undefined ? {} : { occurrenceKey: input.occurrenceKey }),
    ...(input.targetCount === undefined ? {} : { targetCount: input.targetCount }),
    ...(input.countsTowardCoverage === undefined ? {} : { countsTowardCoverage: input.countsTowardCoverage }),
    reason: input.reason ?? null,
    measurements: input.measurements ?? [],
    predicate: { connective: input.connective ?? "single", violated: input.violated ?? null },
  };
}

export function pageByNumber(snapshot: Snapshot, pageNumber: number): PageRecord | undefined {
  return snapshot.pages.find((p) => p.pageNumber === pageNumber);
}

export function linesOfBlock(snapshot: Snapshot, blockKey: string) {
  return snapshot.textLines.filter((l) => l.blockKey === blockKey && l.visible);
}

/**
 * Whether a page is out of scope for the geometry rules because of how it is set.
 *
 * Multi-column and vertical writing are not defects, they are layouts this version does not
 * measure. Saying so out loud is the whole reason exit code 4 exists: a run that measured
 * nothing and a run that measured everything and found nothing looked identical before.
 */
export function layoutOutOfScope(style: {
  columns: string;
  writingMode: string;
}): EnvId | null {
  const columns = style.columns.trim();
  const isSingleColumn =
    columns === "" || columns === "auto" || columns === "1" || /^(auto\s+)?1$|^1(\s+auto)?$/u.test(columns);
  if (!isSingleColumn) return "env/multicolumn";
  if (style.writingMode && style.writingMode !== "horizontal-tb") return "env/vertical-writing";
  return null;
}

export function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
