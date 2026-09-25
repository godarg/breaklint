/** Helpers shared by rules. Nothing here reaches outside the snapshot. */

import type { EnvId, KeyType, Severity } from "../core/enums.ts";
import type { BlockRecord, Box, Finding, NotMeasured, PageRecord, Snapshot, SourceRef, TargetEvaluation, TextLine } from "../core/types.ts";
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

/** Edge tolerance of line ownership: the collector's own line-grouping tolerance, in CSS px. */
export const LINE_OWNERSHIP_TOLERANCE_PX = 0.5;

export interface LineOwnership {
  /** The record's visible lines in line order, each marked with whether its own container holds it. */
  lines: { line: TextLine; owned: boolean }[];
  /** How many of them belong to a nested block or to the container around it. */
  delegated: number;
}

/**
 * The lines of a fragment's own container that OPEN it: the run of owned lines before the first
 * line of a nested block. That run is what a break before this fragment split, and it is what
 * `widows` governs. A fragment that opens with a nested block's line has none: the break fell
 * inside the nested block, which is judged as a candidate of its own.
 */
export function openingOwnLines(ownership: LineOwnership): number {
  let count = 0;
  for (const entry of ownership.lines) {
    if (!entry.owned) break;
    count += 1;
  }
  return count;
}

/** The mirror of `openingOwnLines`: the owned run that CLOSES the fragment, which `orphans` governs. */
export function closingOwnLines(ownership: LineOwnership): number {
  let count = 0;
  for (let at = ownership.lines.length - 1; at >= 0; at -= 1) {
    if (!ownership.lines[at]!.owned) break;
    count += 1;
  }
  return count;
}

function within(inner: Box, outer: Box, tolerance: number): boolean {
  return inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance;
}

/**
 * The lines a block record's OWN block container holds, as opposed to lines the record merely
 * contains.
 *
 * WHY THIS EXISTS. The collector records a block's lines from every text node beneath it, so a
 * `<section>` around a paragraph carries the paragraph's line boxes too — the same boxes, recorded
 * once under each block. `widows` and `orphans` apply to the line boxes of one block container, and
 * a rule that counted the wrapper's recorded lines judged the paragraph's lines by the wrapper's own
 * value: a paragraph split 8+1 under an author's explicit request for single-line widows was
 * reported as a widow of the section around it, and a paragraph moved whole left the section's
 * one intro line reported as an orphan. Measured on patched Chromium 141 with Paged.js 0.4.3.
 *
 * Counting only the OWNED lines of a fragment is not the answer either, and `openingOwnLines` /
 * `closingOwnLines` say why: a section with one line of its own text above a paragraph that splits
 * owns one line on the first page, but that line is nowhere near the break. What a break splits is
 * the run of a container's own lines next to it, so that run is what the rules count; a fragment
 * that meets the break with a nested block's line has none.
 *
 * WHICH BLOCK OWNS A LINE: the nearest block container of it, read from geometry the snapshot
 * already has, with the collection order as the tiebreak.
 *   - `snapshot.blocks` is in collection order: pages ascending, document order within a page. Every
 *     record that contains a text node is an ancestor of it, so the records recording one line form
 *     an ancestor chain and the LATEST of them in that order is the deepest.
 *   - A line box of record B is a nested block's when later records on the same page that have a
 *     box of their own record line boxes inside it that together span it, edge for edge within
 *     `LINE_OWNERSHIP_TOLERANCE_PX` (the collector's own line-grouping tolerance). Spanning, not
 *     touching: a line that also carries text of B's own beyond the nested boxes stays B's.
 *   - A record with no box of its own (`display: contents`) is not a block container. It cannot take
 *     a line from the record around it, and a line of it that an EARLIER boxed record also holds —
 *     equal or larger, on the same line — is that record's line, not its own.
 *
 * THAT LAST POINT IS THE `containers` MODE, the one the fragmentation rules need: `widows` and
 * `orphans` are properties of block containers. A rule that asks about the TEXT rather than its
 * container — whose font set a gap, for `type/excessive-word-spacing` — passes `containers: false`:
 * then every record counts alike, box or not, and a line belongs to the deepest record that records
 * it, which is the element whose computed font the text is set in. (Measured on patched Chromium
 * 141: a justified `<div>` in the default serif around a monospace paragraph read the paragraph's
 * 7-space gap as 16.84 spaces of its own font once the natural space was the font's own.)
 *
 * KNOWN LIMITS, stated because they are real: text of the wrapper's own that sits BETWEEN nested
 * blocks' line boxes on one line (between two floats, say) is inside their span and cannot be told
 * apart from them, so the wrapper loses that line; a `display: contents` record with no boxed record around it keeps
 * its lines and is judged by its own value, which is inherited from its parent unless the author
 * set it on the element; the wrapper's own text that ends exactly at a break, with a nested block
 * opening the next page, is still counted as a split run of its own, because finding the wrapper's
 * next fragment would need a join this helper does not make — the count the rules used before;
 * and a hand-written snapshot that does not follow collection order gets the
 * ownership that order implies.
 *
 * Computed once per call, over the whole snapshot. The function returned answers for a record of
 * that snapshot; a record it has not seen owns nothing.
 */
export function lineOwnership(
  snapshot: Snapshot,
  { containers }: { containers: boolean },
): (block: Pick<BlockRecord, "nodeKey">) => LineOwnership {
  const tolerance = LINE_OWNERSHIP_TOLERANCE_PX;
  // In `containers: false` mode every record takes part as if it had a box of its own.
  const counts = (box: Box) => !containers || hasLayoutBox(box);
  const linesByKey = new Map<string, TextLine[]>();
  for (const line of snapshot.textLines) {
    if (!line.visible) continue;
    const list = linesByKey.get(line.blockKey) ?? [];
    list.push(line);
    linesByKey.set(line.blockKey, list);
  }
  interface Entry { order: number; boxed: boolean; box: Box }
  const entriesByPage = new Map<number, Entry[]>();
  snapshot.blocks.forEach((block, order) => {
    const entries = entriesByPage.get(block.page) ?? [];
    for (const line of linesByKey.get(block.nodeKey) ?? []) entries.push({ order, boxed: counts(block.box), box: line.box });
    entriesByPage.set(block.page, entries);
  });
  for (const entries of entriesByPage.values()) entries.sort((a, b) => a.box.y - b.box.y || a.order - b.order);

  const result = new Map<string, LineOwnership>();
  snapshot.blocks.forEach((block, order) => {
    const lines = linesByKey.get(block.nodeKey) ?? [];
    const entries = entriesByPage.get(block.page) ?? [];
    const boxed = counts(block.box);
    const marked: LineOwnership["lines"] = [];
    for (const line of lines) {
      const row = line.box;
      // Entries sorted by top edge: the first one that can lie inside this row, by binary search.
      let low = 0;
      let high = entries.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (entries[mid]!.box.y < row.y - tolerance) low = mid + 1;
        else high = mid;
      }
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      let heldByEnclosing = false;
      // A boxless record also looks for an enclosing line, which starts at or above its own, so it
      // scans from the page's first line; a boxed record only for lines inside its own.
      for (let at = boxed ? low : 0; at < entries.length; at += 1) {
        const entry = entries[at]!;
        if (entry.box.y > row.y + row.height + tolerance) break;
        if (entry.order === order) continue;
        if (!boxed && entry.boxed && entry.order < order && within(row, entry.box, tolerance)) {
          heldByEnclosing = true;
          break;
        }
        if (at < low || entry.order < order || !entry.boxed || !within(entry.box, row, tolerance)) continue;
        left = Math.min(left, entry.box.x);
        top = Math.min(top, entry.box.y);
        right = Math.max(right, entry.box.x + entry.box.width);
        bottom = Math.max(bottom, entry.box.y + entry.box.height);
      }
      const nested = left <= row.x + tolerance && top <= row.y + tolerance &&
        right >= row.x + row.width - tolerance && bottom >= row.y + row.height - tolerance;
      marked.push({ line, owned: !heldByEnclosing && !nested });
    }
    marked.sort((a, b) => a.line.index - b.line.index);
    result.set(block.nodeKey, { lines: marked, delegated: marked.filter((entry) => !entry.owned).length });
  });
  return (block) => result.get(block.nodeKey) ?? { lines: [], delegated: 0 };
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
