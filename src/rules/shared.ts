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

/**
 * What a recorded line is to the record that records it.
 *   - `own`: the record's own container holds it.
 *   - `beside`: a nested record holds it, and that record sits BESIDE the record's own lines — a
 *     float or an inline-block, whose lines share or overlap the record's own lines. Its lines do
 *     not interrupt the record's own run: a break across them still splits that run.
 *   - `nested`: an in-flow nested block holds it; its lines end the record's own run.
 *   - `enclosing`: the record has no box of its own (`display: contents`) and the block around it
 *     holds the line (containers mode only).
 */
export type LineRole = "own" | "beside" | "nested" | "enclosing";

export interface LineOwnership {
  /** The record's visible lines in line order, each with its role; `owned` is `role === "own"`. */
  lines: { line: TextLine; owned: boolean; role: LineRole }[];
  /** How many of them belong to a nested block or to the container around it. */
  delegated: number;
  /** For a record without a box of its own: the boxed record that holds its lines, if any. */
  enclosedBy: string | null;
}

/**
 * The lines of a fragment's own container that OPEN it: its own lines up to the first line of an
 * in-flow nested block. Lines of a float or an inline-block beside them are passed over, neither
 * counted nor ending the run. That run is what a break before this fragment split, and it is what
 * `widows` governs. A fragment that opens with an in-flow nested block's line has none: the break
 * fell inside the nested block, which is judged as a candidate of its own.
 */
export function openingOwnLines(ownership: LineOwnership): number {
  let count = 0;
  for (const entry of ownership.lines) {
    if (entry.role === "beside") continue;
    if (entry.role !== "own") break;
    count += 1;
  }
  return count;
}

/** The mirror of `openingOwnLines`: the own run that CLOSES the fragment, which `orphans` governs. */
export function closingOwnLines(ownership: LineOwnership): number {
  let count = 0;
  for (let at = ownership.lines.length - 1; at >= 0; at -= 1) {
    const role = ownership.lines[at]!.role;
    if (role === "beside") continue;
    if (role !== "own") break;
    count += 1;
  }
  return count;
}

/**
 * The fragment before and after a record, joined by authoring-source id — the only join key a
 * snapshot has. `joined` is false when the record has no sid, or its sid does not account for
 * exactly `fragmentCount` records with distinct indices; the neighbours are then unknown, not
 * absent.
 */
export function fragmentNeighbours(snapshot: Snapshot): (block: BlockRecord) => {
  joined: boolean; previous: BlockRecord | null; next: BlockRecord | null;
} {
  const bySid = new Map<string, BlockRecord[]>();
  for (const block of snapshot.blocks) {
    if (block.sid === null) continue;
    const list = bySid.get(block.sid) ?? [];
    list.push(block);
    bySid.set(block.sid, list);
  }
  return (block) => {
    const group = block.sid === null ? undefined : bySid.get(block.sid);
    const indices = new Set(group?.map((item) => item.fragmentIndex));
    const joined = group !== undefined && group.length === block.fragmentCount && indices.size === group.length &&
      group.every((item) => item.fragmentCount === block.fragmentCount && item.fragmentIndex >= 0 && item.fragmentIndex < block.fragmentCount);
    if (!joined) return { joined: false, previous: null, next: null };
    return {
      joined: true,
      previous: group!.find((item) => item.fragmentIndex === block.fragmentIndex - 1) ?? null,
      next: group!.find((item) => item.fragmentIndex === block.fragmentIndex + 1) ?? null,
    };
  };
}

/**
 * Whether a record is a BLOCK CONTAINER, whose own line boxes `widows` and `orphans` govern: laid
 * out (`renderingOf` is `box` or `zero-box`) and not `display: inline`. A `display: contents`
 * element generates no box and an inline element no block, so their text is in the lines of the
 * block container around them; a record nothing was printed from has no lines at all.
 */
export function isBlockContainer(snapshot: Pick<Snapshot, "textLines">, block: BlockRecord): boolean {
  const rendering = renderingOf(snapshot, block);
  return (rendering === "box" || rendering === "zero-box") && block.display !== "inline" && block.display !== "contents";
}

/**
 * Whether a nested record sits IN the flow of the block around it, as a block: block-level display,
 * not floated, not absolutely or fixed positioned. Its lines end that block's own run of lines. A
 * float, a positioned box or an inline-level box (`inline-block`, `inline-flex`, ...) sits beside
 * the lines around it, which stay one run across it.
 */
export function inFlowBlock(block: Pick<BlockRecord, "display" | "float" | "position">): boolean {
  const display = block.display.trim();
  if (display.startsWith("inline") || display === "contents" || display === "none") return false;
  if (block.float !== "none") return false;
  return block.position !== "absolute" && block.position !== "fixed";
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
 *   - In `containers` mode a block container's line is its own exactly when the collector saw text
 *     of its own on it (`TextLine.ownText`: text whose nearest block container is this record). A
 *     line shared with a float on each side carries the container's text between the floats'
 *     although their boxes together span it, so geometry cannot say this; the flag can.
 *   - Otherwise — `containers: false`, and for a non-container record — a line box of record B is a
 *     nested block's when later records on the same page record line boxes inside it that together
 *     span it, edge for edge within `LINE_OWNERSHIP_TOLERANCE_PX` (the collector's own line-grouping
 *     tolerance). Spanning, not touching: a line that also carries text of B's own beyond the nested
 *     boxes stays B's.
 *   - A record that is not a block container (`isBlockContainer`: `display: contents` or inline,
 *     agreeing with `renderingOf`) cannot take a line from the record around it, and a line of it
 *     that an EARLIER block container also holds — equal or larger, on the same line — is that
 *     container's line (`enclosing`), not its own.
 *   - A nested block's line is `nested` when the outermost record covering it sits in the flow as a
 *     block (`inFlowBlock`, from the recorded `display`, `float` and `position`), and `beside` when
 *     it is a float, a positioned box or an inline-level box: those lines do not end B's own run.
 *     Geometry alone cannot tell a full-line inline-block from a block child; the fields can.
 *
 * THE BLOCK-CONTAINER TEST IS THE `containers` MODE, the one the fragmentation rules need: `widows`
 * and `orphans` are properties of block containers. A rule that asks about the TEXT rather than its
 * container — whose font set a gap, for `type/excessive-word-spacing` — passes `containers: false`:
 * then every record counts alike, and a line belongs to the deepest record that records it, which is
 * the element whose computed font the text is set in. (Measured on patched Chromium 141: a justified
 * `<div>` in the default serif around a monospace paragraph read the paragraph's 7-space gap as 16.84
 * spaces of its own font once the natural space was the font's own.)
 *
 * WHETHER A RUN WAS SPLIT needs both sides of the break, which this helper does not join: the rules
 * join a record's fragments by source id (`fragmentNeighbours`) and judge a run only when the run on
 * the other side is own text too.
 *
 * KNOWN LIMITS, stated because they are real: in `containers: false` mode, text of a block's own
 * that sits BETWEEN nested blocks' line boxes on one line (between two floats) is inside their span
 * and is taken for theirs; a block container the snapshot does not record (a custom element) owns
 * its text, so neither it nor the record around it is judged on those lines; a recorded block
 * inside an UNRECORDED inline-level box is taken for an in-flow block, because the outermost
 * RECORD covering the line decides, so its lines end the run; text in an unrecorded float or
 * positioned box counts as the record's own; and a hand-written snapshot that does not follow
 * collection order gets the ownership that order implies.
 *
 * Computed once per call, over the whole snapshot. The function returned answers for a record of
 * that snapshot; a record it has not seen owns nothing.
 */
export function lineOwnership(
  snapshot: Snapshot,
  { containers }: { containers: boolean },
): (block: Pick<BlockRecord, "nodeKey">) => LineOwnership {
  const tolerance = LINE_OWNERSHIP_TOLERANCE_PX;
  // In `containers: false` mode every record takes part alike. In `containers` mode only a block
  // container does: see `isBlockContainer`.
  const counts = (block: BlockRecord) => !containers || isBlockContainer(snapshot, block);
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
    for (const line of linesByKey.get(block.nodeKey) ?? []) entries.push({ order, boxed: counts(block), box: line.box });
    entriesByPage.set(block.page, entries);
  });
  for (const entries of entriesByPage.values()) entries.sort((a, b) => a.box.y - b.box.y || a.order - b.order);

  const result = new Map<string, LineOwnership>();
  snapshot.blocks.forEach((block, order) => {
    const lines = linesByKey.get(block.nodeKey) ?? [];
    const entries = entriesByPage.get(block.page) ?? [];
    const boxed = counts(block);
    const classified: { line: TextLine; held: boolean; nested: boolean; coverers: number[] }[] = [];
    let enclosedBy: number | null = null;
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
      let heldBy: number | null = null;
      const coverers = new Set<number>();
      // A boxless record also looks for an enclosing line, which starts at or above its own, so it
      // scans from the page's first line; a boxed record only for lines inside its own.
      for (let at = boxed ? low : 0; at < entries.length; at += 1) {
        const entry = entries[at]!;
        if (entry.box.y > row.y + row.height + tolerance) break;
        if (entry.order === order) continue;
        if (!boxed && entry.boxed && entry.order < order && within(row, entry.box, tolerance)) {
          heldBy = entry.order;
          break;
        }
        if (at < low || entry.order < order || !entry.boxed || !within(entry.box, row, tolerance)) continue;
        coverers.add(entry.order);
        left = Math.min(left, entry.box.x);
        top = Math.min(top, entry.box.y);
        right = Math.max(right, entry.box.x + entry.box.width);
        bottom = Math.max(bottom, entry.box.y + entry.box.height);
      }
      const nested = left <= row.x + tolerance && top <= row.y + tolerance &&
        right >= row.x + row.width - tolerance && bottom >= row.y + row.height - tolerance;
      if (heldBy !== null && enclosedBy === null) enclosedBy = heldBy;
      classified.push({ line, held: heldBy !== null, nested, coverers: [...coverers] });
    }
    // Which nested records sit BESIDE this record's own lines rather than in their flow: the
    // outermost record covering a line (the earliest in collection order) decides, by what the
    // snapshot records about it — a float, an absolutely or fixed positioned box, or an
    // inline-level box leaves the record's own run whole; an in-flow block ends it.
    const isBeside = (coverers: number[]) => !inFlowBlock(snapshot.blocks[Math.min(...coverers)]!);
    const marked: LineOwnership["lines"] = classified.map(({ line, held, nested, coverers }) => {
      let role: LineRole;
      if (containers && boxed) {
        // A block container's own line is the one the collector saw its own text on
        // (`TextLine.ownText`), not one whose box geometry is left over: a line shared with a
        // float on each side has the container's text in the middle and the floats' at the edges,
        // and their union spans it. Otherwise the outermost nested record on the line decides
        // whether the line ends the container's run; a line with none found ends it.
        role = line.ownText ? "own" : coverers.length > 0 && isBeside(coverers) ? "beside" : "nested";
      } else {
        role = held ? "enclosing" : !nested ? "own" : isBeside(coverers) ? "beside" : "nested";
      }
      return { line, owned: role === "own", role };
    });
    marked.sort((a, b) => a.line.index - b.line.index);
    result.set(block.nodeKey, {
      lines: marked,
      delegated: marked.filter((entry) => !entry.owned).length,
      enclosedBy: enclosedBy === null ? null : snapshot.blocks[enclosedBy]!.nodeKey,
    });
  });
  return (block) => result.get(block.nodeKey) ?? { lines: [], delegated: 0, enclosedBy: null };
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
 * A box of zero by zero does not say WHY there is no box, and the rules need the reason; see
 * `renderingOf`.
 */
export function hasLayoutBox(box: Box): boolean {
  return box.width !== 0 || box.height !== 0;
}

/**
 * How a block record was rendered, from its box, its recorded lines and the facts Snapshot 5
 * records about it:
 * - `box`: laid out with a box of its own;
 * - `contents`: `display: contents` — no box for the element, while its text and children are laid
 *   out and printed (an image-only `display: contents` figure prints its image);
 * - `margin-box`: no box in the flow, and printed as margin-box copies: the in-flow original of a
 *   `position: running(...)` element, which Paged.js hides with `display: none`;
 * - `not-rendered`: no box and nothing the snapshot shows printed from it — `display: none`, or
 *   lines that were recorded and none of which is visible (an element inside a hidden subtree or a
 *   closed `<details>` has no line box);
 * - `zero-box`: a box of zero by zero that is NOT proof of nothing printed: a visible line was
 *   recorded (`width: 0; height: 0; overflow: visible` prints its text outside its box), or the
 *   lines were not recorded at all, so the question is open.
 * The classification never reads "no box" alone as "not rendered". An earlier state of this change
 * did, and a zero-size block whose seventeen lines printed was excluded, turning a counted decline
 * (exit 4) into a clean run.
 */
export type Rendering = "box" | "contents" | "margin-box" | "not-rendered" | "zero-box";

type RenderFacts = { nodeKey: string; box: Box; display: string; marginCopies: number; lines: readonly number[] | null };

export function renderingOf(snapshot: Pick<Snapshot, "textLines">, block: RenderFacts): Rendering {
  if (hasLayoutBox(block.box)) return "box";
  if (block.display === "contents") return "contents";
  if (block.marginCopies > 0) return "margin-box";
  if (block.display === "none") return "not-rendered";
  if (block.lines === null) return "zero-box";
  const lines = snapshot.textLines.filter((line) => line.blockKey === block.nodeKey);
  // A visible line printed. A referenced line the snapshot does not carry is not proof of anything.
  if (lines.some((line) => line.visible) || lines.length < block.lines.length) return "zero-box";
  return "not-rendered";
}

/** A record nothing in the flow was printed from: `margin-box` or `not-rendered`. */
export function isNotRendered(snapshot: Pick<Snapshot, "textLines">, block: RenderFacts): boolean {
  const rendering = renderingOf(snapshot, block);
  return rendering === "margin-box" || rendering === "not-rendered";
}

/**
 * The evaluation a rule records for a record that `isNotRendered`: `excluded`, outside the coverage
 * base, with the reason named — `rule/target-in-margin-box` for a running element's in-flow
 * original, `rule/target-not-rendered` for anything else. Not a decline — nothing failed to be
 * measured; the question the rule asks has no referent in the flow. And not `measured`: counting it
 * as a zero-height measurement let a document report full coverage for an element nobody looked at.
 */
export function notRenderedEvaluation(ruleId: string, block: {
  nodeKey: string; sid: string | null; fragmentIndex: number; box: Box; display: string; marginCopies: number;
}): TargetEvaluation {
  // Called for a record `isNotRendered`; of those, exactly the ones with margin copies printed there.
  const inMargin = block.marginCopies > 0;
  return targetEvaluation({
    ruleId, keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex,
    boxScreen: block.box, status: "excluded", countsTowardCoverage: false,
    reason: inMargin ? "rule/target-in-margin-box" : "rule/target-not-rendered",
    measurements: [
      { name: "target-has-layout-box", value: false, unit: null, operator: "=", threshold: true },
      { name: "display", value: block.display, unit: null, operator: null, threshold: null },
      { name: "margin-copies", value: block.marginCopies, unit: null, operator: null, threshold: null },
    ],
    connective: "all", violated: null,
  });
}

/**
 * The lines of a block the snapshot recorded, and how many of them are visible. `recorded: false`
 * when the snapshot did not measure the block's lines at all (`lines: null`, with its reason).
 */
export function lineStateOf(snapshot: Snapshot, block: { nodeKey: string; lines: readonly number[] | null }): {
  recorded: boolean; total: number; visible: number;
} {
  if (block.lines === null) return { recorded: false, total: 0, visible: 0 };
  const lines = snapshot.textLines.filter((line) => line.blockKey === block.nodeKey);
  return { recorded: true, total: lines.length, visible: lines.filter((line) => line.visible).length };
}

/**
 * Where a block is printed: its own box, or — for a block with no box of its own, such as
 * `display: contents` — the union of its visible line boxes. `null` when neither exists, so a caller
 * cannot mistake the zero box at the origin for a position, and `null` for every record
 * `isNotRendered` (a running element's in-flow original, an element the author hid): the two
 * helpers agree, so no rule can put in the flow what the classification says printed nowhere.
 */
export function renderedBox(snapshot: Snapshot, block: RenderFacts): Box | null {
  if (hasLayoutBox(block.box)) return block.box;
  if (isNotRendered(snapshot, block)) return null;
  const lines = linesOfBlock(snapshot, block.nodeKey);
  if (lines.length === 0) return null;
  const left = Math.min(...lines.map((line) => line.box.x));
  const top = Math.min(...lines.map((line) => line.box.y));
  const right = Math.max(...lines.map((line) => line.box.x + line.box.width));
  const bottom = Math.max(...lines.map((line) => line.box.y + line.box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The decline a rule records for a printed candidate it cannot place: no box of its own and no
 * visible line box to read a position from, or lines the snapshot did not measure. The
 * measurements state what was there — the visible line count, or `null` when the lines were not
 * recorded — and never claim rendered lines the snapshot does not show. Counted against coverage.
 */
export function boxlessDeclined(ruleId: string, snapshot: Snapshot, block: {
  nodeKey: string; sid: string | null; fragmentIndex: number; box: Box; display: string; lines: readonly number[] | null;
}): { notMeasured: NotMeasured; evaluation: TargetEvaluation } {
  const lines = lineStateOf(snapshot, block);
  return {
    notMeasured: declined({ scope: "block", ruleId, reason: "env/invalid-measurement" }),
    evaluation: targetEvaluation({
      ruleId, keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex,
      boxScreen: block.box, status: "not-measured", reason: "env/invalid-measurement",
      measurements: [
        { name: "target-has-layout-box", value: false, unit: null, operator: "=", threshold: true },
        { name: "display", value: block.display, unit: null, operator: null, threshold: null },
        { name: "visible-line-count", value: lines.recorded ? lines.visible : null, unit: "lines", operator: ">", threshold: 0 },
      ],
      connective: "all", violated: null,
    }),
  };
}
