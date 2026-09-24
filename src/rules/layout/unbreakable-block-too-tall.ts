import { defineRule } from "../../core/rule.ts";
import { blockKey } from "../../core/fingerprint.ts";
import { SNAPSHOT_ROUNDING_PX } from "../../core/enums.ts";
import type { BlockRecord, Box, PageRecord, Snapshot } from "../../core/types.ts";
import {
  declined, hasLayoutBox, layoutOutOfScope, makeFinding, notRenderedEvaluation, num, pageByNumber, sourceOf, targetEvaluation,
} from "../shared.ts";

/**
 * layout/unbreakable-block-too-tall — a block that promises not to break is taller than a page.
 *
 * One of two rules in this release that carry `error`, and the only kind of threshold that
 * earns it: the comparison is between a measured height and a structural boundary, not a chosen
 * one. A block that is taller than the page cannot keep its own promise not to break there. That
 * is arithmetic, not convention, and it is why this rule may fail a build by default while
 * eleven others may not. It also means the height it reports has to be a PROOF: either measured
 * exactly, or a number the block is provably at least as tall as. An estimate may not gate.
 *
 * WHICH HEIGHT. An unsplit block's height is its box, measured. Until 0.6.0 a split block was
 * judged on its first fragment, and a six-page `break-inside: avoid` section came back clean
 * (fragment 0: 596.36 px against a 680.31 px page). 0.6.0 summed the fragment boxes, but only from
 * the third fragment on, and a block split into exactly two pieces — the usual outcome for one
 * between one and two pages tall, because Paged.js pushes an avoid block that fits a fresh page
 * onto one — still came back clean: measured on 2026-09-24, a block 503.72 px tall split
 * 335.81 + 167.91 against a 340.16 px page, exit 0.
 *
 * The sum of the boxes is not the answer either, in either direction. Paged.js does not fragment
 * natively: it makes a new element per page, unsets margin and padding at the split edges but not
 * border (nor `!important` or inline padding), and ignores the repeated bottom edge when it picks
 * the break, so the piece before a split overflows and Chrome pushes its last line into the hidden
 * overflow column beside the page; `getBoundingClientRect` then returns a union box one page tall.
 * Measured on 2026-09-24: a block 301.19 px tall unsplit, inside a 40 px-bordered wrapper that was
 * split too, had fragment boxes summing to 417.47 px against a 340.16 px page — a false `error`,
 * and still one (377.47) after subtracting its own border; elsewhere a collapsed margin lost at the
 * split made the sum 12 px SHORT of the block. The 0.6.0 reason to believe a sum from three
 * fragments on — "an intermediate fragment fills a whole page" — is false as well: it fills what
 * the repeated border of a split ancestor leaves of the page, and Paged.js can repeat content
 * outright (see below, where the 0.6.0 sum reported 798.98 px for a block 302.53 px tall).
 *
 * WHAT IS MEASURED FOR A SPLIT BLOCK: a lower bound from the text lines its fragments carry. For
 * each fragment, the lines that start in its page's own column — left of the content box's right
 * edge; a line in the overflow column is on no printed page — clipped to the fragment's box, and
 * the extent from the top of the first to the bottom of the last. The bound is the sum of those
 * extents, each less the snapshot's rounding. A fragment on a page whose content box is not as wide
 * as the first fragment's is left out (A1: at another width the text would break into other lines).
 *
 * WHY THE BOUND CANNOT EXCEED THE UNSPLIT HEIGHT. Paged.js splits between lines and elements and
 * places each piece of content once, in order, and it duplicates nothing at a split (no table
 * header repetition; `::before`/`::after` are unset on the pieces). So the lines of fragment k are,
 * in the block laid out unsplit at the same width, a run of consecutive lines in the same order and
 * with the same offsets between them, and the runs of different fragments follow one another.
 * Everything the paginator adds or removes at a split — repeated borders and padding of the block
 * and of every split element inside it, unset margins, the overflow of the repeated bottom edge —
 * lies above the first or below the last line of a fragment, outside its extent. The extents are
 * therefore disjoint pieces of the unsplit block, and their sum is at most its height. It is below
 * it by at least the half-leading above the first and below the last line of every fragment (glyph
 * boxes sit inside line boxes: 3.66 px per fragment at 10pt/1.4), by the block's own borders and
 * padding, and by every line in the overflow column. The finding says "at least", never "is".
 *
 * That argument has premises. Where the snapshot can see one fail, the block is DECLINED as
 * `env/invalid-measurement` (charged to coverage) instead of bounded:
 *   - Two text-carrying records inside one fragment stand side by side — cells of one table row,
 *     flex or grid items, a float beside a paragraph. Paged.js lays each fragment of a table out as
 *     a table of its own, recomputing column widths, and moves every cell after a split cell to the
 *     next page whole; the runs are then not consecutive. Measured on 2026-09-24: a two-column row
 *     split inside its first cell gave 697.95 px of lines for a block 522.38 px tall.
 *   - A piece of a split element inside a fragment does not end the fragment's text (if the element
 *     continues) or begin it (if it continued): after a break everything in flow order is on the
 *     next page, so anything else is content the paginator repeated or moved. Measured on
 *     2026-09-24: an absolutely positioned caption at the foot of a split block made Paged.js lay
 *     the same lines out again on the next page; without this check they bound a block 302.53 px
 *     tall at 418.09 px.
 *   - A line reaches out of its own record's box by half its height or more: text overflowing a
 *     fixed height, which Paged.js repeats with that height on every fragment, or text moved by an
 *     offset or a transform.
 *   - No counted fragment has a text line at all (a block of images): there is nothing to bound
 *     it with, and a bound of zero would be a claim that it fits.
 * Where the leading is tighter than the font, a glyph box is taller than its line box and would be
 * counted on both sides of a split; that overhang is given back per fragment, against the smallest
 * line height of any element in it. What the snapshot cannot see is assumed, and stated in
 * docs/limitations.md:
 *   - A2: no absolutely positioned, fixed or transformed text inside the block that stays inside
 *     its box, no side-by-side content without a record of its own (inline blocks, anonymous flex
 *     items, text beside an image float), and no content repeated by the paginator outside an
 *     element of its own. The snapshot records neither positioning nor transforms nor display.
 *   - A3: the hyphen Paged.js appends at a split inside a word (U+2011) is not wider than the
 *     hyphen the browser drew there, so it does not push the word onto a line of its own.
 *   - Every line box is at least as tall as the smallest line height of the elements the snapshot
 *     records in its fragment (the strut of the block that holds the line).
 *
 * Flow membership is a property of the snapshot, not of this rule: the collector keeps only blocks
 * inside a page's content area (`.pagedjs_pagebox > .pagedjs_area`), so a `position: running(...)`
 * clone in a margin box never reaches it, and every record carrying the element's sid is one of its
 * fragments, wherever it lies. A coordinate test here — the first repair of the clones — also
 * discarded every fragment of a full-bleed block and called a five-and-a-half-page block clean.
 *
 * The boundary is the page the block was laid out on, and the sentence says so. The largest content
 * box in the document was tried instead and is worse — in a document with a named landscape page it
 * raises the bar for every block on the portrait pages and hides real ones.
 *
 * Fragments are correlated by `sid`, the authoring-source identity. A split block whose fragments
 * carry no `sid` — a `--no-source-map` run, or an element a script created — cannot be correlated,
 * and neither can one whose sid does not account for exactly the fragments the snapshot counted.
 * Such a block is declined too: measuring its first fragment compares a piece with the page, and a
 * clean result must mean the block was judged.
 */
export const unbreakableBlockTooTall = defineRule(
  {
    id: "layout/unbreakable-block-too-tall",
    severity: "error",
    proofSource: "A",
    calibrated: false,
    experimental: false,
    unit: "px",
    quantityScope: "element",
    defaultOptions: { toleranceRatio: 1.0 },
    summary: "A block with break-inside: avoid is taller than the page content box.",
    declines: ["env/multicolumn", "env/vertical-writing", "env/invalid-measurement"],
    remediation: {
      advice:
        "A block with 'break-inside: avoid' is taller than the content box of the page it was laid out on, so the paginator could not keep it whole there. Where the paginator had split it anyway, the reported height is a lower bound — the height of the text lines in its fragments, without borders, padding or the space around them — so the block is at least that tall. Make the block shorter — split it into smaller sections deliberately, or reduce container padding, font size or contained rows. Removing 'break-inside: avoid' also clears the finding, but only because the rule then has no candidate: the block is exactly as tall as before, and it will still be broken, just without having asked not to be.",
      // No trigger/remedied pair ships with this package and no gate re-runs one, so this
      // advice is untested in the sense the field defines.
      tested: false,
    },
  },
  (snapshot, ctx) => {
    const findings = [];
    const notMeasured = [];
    const evaluations = [];
    let candidates = 0;
    let measured = 0;

    // Every record with the element's sid is one of its fragments, wherever its box lies (see the
    // header: flow membership is decided by the collector, not by coordinates here).
    const fragmentsBySid = new Map<string, BlockRecord[]>();
    for (const fragment of snapshot.blocks) {
      if (fragment.sid === null) continue;
      const list = fragmentsBySid.get(fragment.sid) ?? [];
      list.push(fragment);
      fragmentsBySid.set(fragment.sid, list);
    }
    const index = indexSnapshot(snapshot);

    for (const block of snapshot.blocks) {
      const avoids = /\bavoid(-page)?\b/u.test(block.effectiveStyle.breakInside);
      const visible = block.effectiveStyle.visibility === "visible";
      if (!visible || !avoids) {
        // The retained DOM target is only an allowable applicability change when it remains
        // visible. Hiding it is recorded separately and never resembles a positive repair.
        evaluations.push(targetEvaluation({
          ruleId: "layout/unbreakable-block-too-tall", keyType: "block", nodeKey: block.nodeKey, sid: block.sid,
          fragmentIndex: block.fragmentIndex, boxScreen: block.box,
          status: visible ? "not-applicable" : "excluded", countsTowardCoverage: false,
          reason: visible ? "rule/break-inside-not-avoid" : "rule/target-not-visible",
          measurements: [
            { name: "break-inside-avoid", value: avoids, unit: null, operator: "=", threshold: true },
            { name: "target-visible", value: visible, unit: null, operator: "=", threshold: true },
          ], connective: "all", violated: null,
        }));
        continue;
      }
      // A block with no layout box was never placed by the paginator, so "does it fit the page
      // unbroken" has no referent. The case is the in-flow original of a `position: running(...)`
      // element, which Paged.js hides with `display: none` while its clones print in the margin
      // boxes: it was recorded as MEASURED at 0 px, and a document whose only avoid block was a
      // running element reported full coverage for a check that looked at nothing.
      if (!hasLayoutBox(block.box)) {
        evaluations.push(notRenderedEvaluation("layout/unbreakable-block-too-tall", block));
        continue;
      }
      // One evaluation per block, taken at its first fragment. The later fragments are not
      // separate candidates — but their lines are part of the height judged there.
      if (block.fragmentIndex !== 0) {
        evaluations.push(targetEvaluation({
          ruleId: "layout/unbreakable-block-too-tall", keyType: "block", nodeKey: block.nodeKey, sid: block.sid,
          fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "not-applicable",
          countsTowardCoverage: false, reason: "rule/non-initial-fragment",
        }));
        continue;
      }
      candidates += 1;

      const outOfScope = layoutOutOfScope(block.effectiveStyle);
      if (outOfScope) {
        notMeasured.push(
          declined({ scope: "block", ruleId: "layout/unbreakable-block-too-tall", reason: outOfScope }),
        );
        evaluations.push(targetEvaluation({ ruleId: "layout/unbreakable-block-too-tall", keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "not-measured", reason: outOfScope }));
        continue;
      }
      const page = pageByNumber(snapshot, block.page);
      if (!page) {
        // Cannot happen with a well-formed snapshot; if it does, the snapshot is the defect
        // and defineRule's invariant will surface it rather than let the count drift.
        notMeasured.push(
          declined({ scope: "block", ruleId: "layout/unbreakable-block-too-tall", reason: "env/multicolumn" }),
        );
        evaluations.push(targetEvaluation({ ruleId: "layout/unbreakable-block-too-tall", keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "not-measured", reason: "env/multicolumn" }));
        continue;
      }
      // A split block is judged on ALL of its fragments or not at all. Its fragments are joined by
      // `sid`; a block without one (a `--no-source-map` run, or an element a script created) has
      // nothing to join them by, and one whose sid does not account for exactly the fragments the
      // snapshot counted cannot be bounded either. Measuring the first fragment instead — what this
      // rule used to fall back to — compares a PIECE with the page and can call a six-page block
      // clean. That is declined, and the decline is charged to coverage, so the run says it could
      // not judge the block instead of saying the block fits.
      const fragments = block.sid === null ? undefined : fragmentsBySid.get(block.sid);
      const correlated = block.fragmentCount <= 1
        ? block.sid === null || fragments?.length === 1
        : fragments?.length === block.fragmentCount;
      if (!correlated) {
        notMeasured.push(
          declined({ scope: "block", ruleId: "layout/unbreakable-block-too-tall", reason: "env/invalid-measurement" }),
        );
        evaluations.push(targetEvaluation({
          ruleId: "layout/unbreakable-block-too-tall", keyType: "block", nodeKey: block.nodeKey, sid: block.sid,
          fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "not-measured", reason: "env/invalid-measurement",
          measurements: [
            { name: "fragment-count", value: block.fragmentCount, unit: null, operator: null, threshold: null },
            { name: "fragments-joined-by-sid", value: fragments?.length ?? 0, unit: null, operator: "=", threshold: block.fragmentCount },
          ],
          connective: "single", violated: null,
        }));
        continue;
      }

      // The boundary is structural: taller than the page means it cannot fit. The ratio is
      // exposed so the threshold is a value rather than a hidden comparison — at 1.0 it is
      // exactly the arithmetic claim, and nothing else is defensible as an error.
      const limit = page.contentBox.height * num(ctx.options.toleranceRatio, 1.0);
      const fragmentCount = fragments?.length ?? 1;

      if (fragmentCount === 1) {
        // Unsplit: the box is the block, measured. `block-height` keeps its 0.5.0 name and unit.
        measured += 1;
        const blockHeight = block.box.height;
        evaluations.push(targetEvaluation({ ruleId: "layout/unbreakable-block-too-tall", keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "measured", measurements: [{ name: "block-height", value: blockHeight, unit: "px", operator: ">", threshold: limit }], violated: blockHeight > limit }));
        if (blockHeight <= limit) continue;
        findings.push(tooTall({
          ctx, snapshot, block, value: blockHeight, limit, page,
          message:
            `This block asks not to be broken and is ${blockHeight.toFixed(2)} px tall; the content box of ` +
            `page ${page.pageNumber} is ${page.contentBox.height.toFixed(2)} px. It did not fit there unbroken.`,
        }));
        continue;
      }

      // Split: a lower bound, or a decline where the snapshot shows the bound's premises fail.
      const ordered = [...fragments!].sort((a, b) => a.fragmentIndex - b.fragmentIndex);
      const bound = splitBlockLowerBound(ordered, page, index);
      if (bound.kind === "unbounded") {
        notMeasured.push(
          declined({ scope: "block", ruleId: "layout/unbreakable-block-too-tall", reason: "env/invalid-measurement" }),
        );
        evaluations.push(targetEvaluation({
          ruleId: "layout/unbreakable-block-too-tall", keyType: "block", nodeKey: block.nodeKey, sid: block.sid,
          fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "not-measured", reason: "env/invalid-measurement",
          measurements: [
            { name: "fragment-count", value: fragmentCount, unit: null, operator: null, threshold: null },
            UNBOUNDED_MEASUREMENT[bound.condition],
          ],
          connective: "single", violated: null,
        }));
        continue;
      }
      measured += 1;
      // A different name from the unsplit case on purpose: this value is what the block is at
      // least, not what it is, and a consumer reading the evaluation must not mistake one for the
      // other.
      evaluations.push(targetEvaluation({
        ruleId: "layout/unbreakable-block-too-tall", keyType: "block", nodeKey: block.nodeKey, sid: block.sid,
        fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "measured",
        measurements: [
          { name: "block-height-lower-bound", value: bound.value, unit: "px", operator: ">", threshold: limit },
          { name: "fragment-count", value: fragmentCount, unit: null, operator: null, threshold: null },
        ],
        connective: "single", violated: bound.value > limit,
      }));
      if (bound.value <= limit) continue;
      findings.push(tooTall({
        ctx, snapshot, block, value: bound.value, limit, page,
        message:
          `This block asks not to be broken and is at least ${bound.value.toFixed(2)} px tall across the ` +
          `${fragmentCount} fragments the paginator split it into — counting only their text lines, not ` +
          `borders, padding or the space around them; the content box of page ${page.pageNumber} is ` +
          `${page.contentBox.height.toFixed(2)} px. It did not fit there unbroken.`,
      }));
    }
    return { findings, candidates, measured, notMeasured, evaluations };
  },
);

function tooTall(input: {
  ctx: Parameters<typeof makeFinding>[0]["ctx"];
  snapshot: Snapshot;
  block: BlockRecord;
  value: number;
  limit: number;
  page: PageRecord;
  message: string;
}) {
  const { block } = input;
  return makeFinding({
    ctx: input.ctx,
    ruleId: "layout/unbreakable-block-too-tall",
    severity: "error",
    message: input.message,
    page: block.page,
    keyType: "block",
    key: blockKey({ authorId: block.authorId, blockSignature: block.blockSignature }),
    nodeKey: block.nodeKey,
    sid: block.sid,
    fragmentIndex: block.fragmentIndex,
    boxScreen: block.box,
    source: sourceOf(input.snapshot, block.sid),
    value: input.value,
    threshold: input.limit,
    unit: "px",
    proofSource: "A",
  });
}

type UnboundedCondition = "side-by-side-text" | "text-outside-its-box" | "split-piece-off-edge" | "no-text-lines";

/** What a declined split block records about the premise that failed, so the row explains itself. */
const UNBOUNDED_MEASUREMENT = {
  "side-by-side-text": { name: "fragment-text-in-one-column", value: false, unit: null, operator: "=", threshold: true },
  "text-outside-its-box": { name: "fragment-text-inside-its-box", value: false, unit: null, operator: "=", threshold: true },
  "split-piece-off-edge": { name: "split-pieces-at-fragment-edges", value: false, unit: null, operator: "=", threshold: true },
  "no-text-lines": { name: "fragment-text-lines", value: 0, unit: "lines", operator: ">", threshold: 0 },
} as const;

interface SnapshotIndex {
  readonly pages: ReadonlyMap<number, PageRecord>;
  readonly linesByBlock: ReadonlyMap<string, readonly Box[]>;
  readonly blocksByPage: ReadonlyMap<number, readonly BlockRecord[]>;
}

function indexSnapshot(snapshot: Snapshot): SnapshotIndex {
  const linesByBlock = new Map<string, Box[]>();
  for (const line of snapshot.textLines) {
    if (!line.visible) continue;
    const list = linesByBlock.get(line.blockKey) ?? [];
    list.push(line.box);
    linesByBlock.set(line.blockKey, list);
  }
  const blocksByPage = new Map<number, BlockRecord[]>();
  for (const block of snapshot.blocks) {
    const list = blocksByPage.get(block.page) ?? [];
    list.push(block);
    blocksByPage.set(block.page, list);
  }
  return { pages: new Map(snapshot.pages.map((page) => [page.pageNumber, page])), linesByBlock, blocksByPage };
}

const finiteBox = (box: Box): boolean =>
  Number.isFinite(box.x) && Number.isFinite(box.y) && Number.isFinite(box.width) && Number.isFinite(box.height);

/** Half a line box: the most a glyph box can stick out of its own box with tight leading. */
const outsideItsBox = (line: Box, box: Box): boolean =>
  line.height > 0 && Math.max(box.y - line.y, line.y + line.height - (box.y + box.height)) >= line.height / 2;

const within = (outer: Box, inner: Box, tolerance = 1): boolean =>
  inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance &&
  inner.x + inner.width <= outer.x + outer.width + tolerance &&
  inner.y + inner.height <= outer.y + outer.height + tolerance;

/** Two glyph boxes on the same band of the page with nothing between them horizontally in common. */
const sideBySide = (a: Box, b: Box): boolean =>
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5 &&
  (a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5);

/**
 * The lower bound for a split block, or the premise of the bound the snapshot shows to fail. See the
 * header for the argument; `first` is the page of fragment 0, whose content box is the boundary.
 */
function splitBlockLowerBound(
  fragments: readonly BlockRecord[],
  first: PageRecord,
  index: SnapshotIndex,
): { kind: "bounded"; value: number } | { kind: "unbounded"; condition: UnboundedCondition } {
  let total = 0;
  let lines = 0;
  for (const fragment of fragments) {
    const page = index.pages.get(fragment.page);
    // A1: text on a page of another width breaks into other lines; it is left out, which only
    // makes the bound smaller.
    if (!page || Math.abs(page.contentBox.width - first.contentBox.width) > 0.5) continue;
    const columnEnd = page.contentBox.x + page.contentBox.width;
    // The page's own column only. A line that starts at or right of the content box's right edge is
    // in the overflow column Paged.js hides beside the page: printed nowhere, and in another frame.
    const inColumn = (key: string): Box[] => (index.linesByBlock.get(key) ?? []).filter((line) =>
      finiteBox(line) && line.height > 0 && line.x < columnEnd);
    const own = inColumn(fragment.nodeKey);
    // Records whose every line is one of this fragment's lines: the elements inside it on this page
    // (the element's own other fragments are not inside it, wherever they are).
    const inside = (index.blocksByPage.get(fragment.page) ?? [])
      .filter((record) => record.nodeKey !== fragment.nodeKey && record.sid !== fragment.sid)
      .map((record) => ({ record, lines: inColumn(record.nodeKey) }))
      .filter(({ lines: its }) => its.length > 0 && its.every((line) => own.some((mine) => within(mine, line))));
    for (const { record, lines: its } of [{ record: fragment, lines: own }, ...inside]) {
      // A box that is not a number contains nothing it can be shown to contain.
      if (its.length > 0 && !finiteBox(record.box)) return { kind: "unbounded", condition: "text-outside-its-box" };
      const hasBox = record.box.width !== 0 || record.box.height !== 0;
      if (hasBox && its.some((line) => outsideItsBox(line, record.box))) return { kind: "unbounded", condition: "text-outside-its-box" };
    }
    // An element split at this page's edge ends this fragment's text, or begins it: after the break
    // everything in flow order is on the next page. A piece of a split element anywhere else means
    // the paginator did not cut one flow in two here — it repeated content, or moved some of it.
    const ownTop = Math.min(...own.map((line) => line.y));
    const ownBottom = Math.max(...own.map((line) => line.y + line.height));
    for (const { record, lines: its } of inside) {
      if (record.fragmentCount < 2) continue;
      const continues = record.fragmentIndex < record.fragmentCount - 1;
      const continued = record.fragmentIndex > 0;
      if (continues && Math.abs(Math.max(...its.map((line) => line.y + line.height)) - ownBottom) > 1) {
        return { kind: "unbounded", condition: "split-piece-off-edge" };
      }
      if (continued && Math.abs(Math.min(...its.map((line) => line.y)) - ownTop) > 1) {
        return { kind: "unbounded", condition: "split-piece-off-edge" };
      }
    }
    for (let i = 0; i < inside.length; i += 1) {
      for (let j = i + 1; j < inside.length; j += 1) {
        const a = inside[i]!.lines;
        const b = inside[j]!.lines;
        // An element and one inside it share their lines; only two that are not nested can be
        // side by side.
        const nested = a.every((line) => b.some((other) => within(other, line))) || b.every((line) => a.some((other) => within(other, line)));
        if (!nested && a.some((line) => b.some((other) => sideBySide(line, other)))) {
          return { kind: "unbounded", condition: "side-by-side-text" };
        }
      }
    }
    if (own.length === 0) continue;
    const top = Math.max(fragment.box.y, Math.min(...own.map((line) => line.y)));
    const bottom = Math.min(fragment.box.y + fragment.box.height, Math.max(...own.map((line) => line.y + line.height)));
    // With leading tighter than the font, a glyph box is taller than its line box and sticks out of
    // it above and below — together by at most its height less the line height. At a split that
    // overhang would be counted on both sides of the break, so it is given back per fragment,
    // against the smallest line height of any element here (which only ever gives back more).
    const lineHeights = [fragment, ...inside.map(({ record }) => record)]
      .map((record) => record.lineHeight)
      .filter((value) => Number.isFinite(value) && value > 0);
    const lineHeight = lineHeights.length > 0 ? Math.min(...lineHeights) : 0;
    const overhang = Math.max(0, Math.max(...own.map((line) => line.height)) - lineHeight);
    // Each extent is a difference of two stored coordinates and may read up to the snapshot's
    // rounding more than it is; the bound gives that back rather than claim it.
    total += Math.max(0, bottom - top - overhang - SNAPSHOT_ROUNDING_PX);
    lines += own.length;
  }
  if (lines === 0) return { kind: "unbounded", condition: "no-text-lines" };
  // Rounded DOWN: a lower bound may lose a hundredth of a pixel, never gain one.
  return { kind: "bounded", value: Math.floor(total * 100 + 1e-6) / 100 };
}
