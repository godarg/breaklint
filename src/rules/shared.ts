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

/**
 * Whether a block record has a box of its own: not zero in both dimensions.
 *
 * Both dimensions, never one. An empty paragraph is laid out with the full column width and no
 * height, and a zero-width block can still be tall; both are real boxes in the flow, and a
 * predicate on one dimension would declare them box-less.
 *
 * A box of zero by zero is NOT by itself evidence that nothing was laid out. `display: none`
 * produces one, and so does `display: contents`, which generates no box for the element while its
 * text is laid out, printed and recorded as lines. Whether a record was rendered at all is
 * `isNotRendered`'s question, which looks at the lines too.
 */
export function hasLayoutBox(box: Box): boolean {
  return box.width !== 0 || box.height !== 0;
}

/**
 * Whether a block record is provably not rendered: no box in either dimension AND measured lines,
 * of which there are none.
 *
 * That is the in-flow original of a `position: running(...)` element, which Paged.js leaves in the
 * page content with an inline `display: none` while its clones print in the margin boxes, and any
 * other `display: none` element. A `display: contents` element is not one of them: it has no box
 * but its text has line boxes, so the snapshot records lines for it, and a justified
 * `display: contents` paragraph really does print its gaps. A record whose lines were not measured
 * (`lines: null`) is not provably unrendered either; it is left to the rule, which must measure it
 * or decline it where coverage counts the decline.
 */
export function isNotRendered(block: { box: Box; lines: readonly number[] | null }): boolean {
  return !hasLayoutBox(block.box) && block.lines !== null && block.lines.length === 0;
}

/**
 * The evaluation a rule records for a candidate that is not rendered (see `isNotRendered`):
 * `excluded`, outside the coverage base, with the reason named. Not a decline — nothing failed to
 * be measured; the question the rule asks (how tall, how much space below, how wide the gaps) has
 * no referent for an element the paginator never laid out. And not `measured`: counting it as a
 * zero-height measurement let a document report full coverage for an element nobody looked at.
 */
export function notRenderedEvaluation(ruleId: string, block: {
  nodeKey: string; sid: string | null; fragmentIndex: number; box: Box;
}): TargetEvaluation {
  return targetEvaluation({
    ruleId, keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex,
    boxScreen: block.box, status: "excluded", countsTowardCoverage: false, reason: "rule/target-not-rendered",
    measurements: [
      { name: "target-has-layout-box", value: false, unit: null, operator: "=", threshold: true },
      { name: "target-has-rendered-lines", value: false, unit: null, operator: "=", threshold: true },
    ],
    connective: "all", violated: null,
  });
}

/**
 * Where a block is printed: its own box, or — for a block with no box of its own, such as
 * `display: contents` — the union of its visible line boxes. `null` when neither exists, so a caller
 * cannot mistake the zero box at the origin for a position.
 */
export function renderedBox(snapshot: Snapshot, block: { nodeKey: string; box: Box }): Box | null {
  if (hasLayoutBox(block.box)) return block.box;
  const lines = linesOfBlock(snapshot, block.nodeKey);
  if (lines.length === 0) return null;
  const left = Math.min(...lines.map((line) => line.box.x));
  const top = Math.min(...lines.map((line) => line.box.y));
  const right = Math.max(...lines.map((line) => line.box.x + line.box.width));
  const bottom = Math.max(...lines.map((line) => line.box.y + line.box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The decline a box-geometry rule records for a candidate that IS rendered but has no box of its
 * own — a `display: contents` block, whose text is on the page while its element box is zero by
 * zero at the origin. A rule that judges the block's box (how tall it is, what lies below it) has
 * nothing valid to read. Measuring the zero box called such a block clean; excluding it hid a
 * printed element from coverage. It is declined as `env/invalid-measurement` and counted.
 */
export function boxlessDeclined(ruleId: string, block: {
  nodeKey: string; sid: string | null; fragmentIndex: number; box: Box;
}): { notMeasured: NotMeasured; evaluation: TargetEvaluation } {
  return {
    notMeasured: declined({ scope: "block", ruleId, reason: "env/invalid-measurement" }),
    evaluation: targetEvaluation({
      ruleId, keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex,
      boxScreen: block.box, status: "not-measured", reason: "env/invalid-measurement",
      measurements: [
        { name: "target-has-layout-box", value: false, unit: null, operator: "=", threshold: true },
        { name: "target-has-rendered-lines", value: true, unit: null, operator: null, threshold: null },
      ],
      connective: "single", violated: null,
    }),
  };
}
