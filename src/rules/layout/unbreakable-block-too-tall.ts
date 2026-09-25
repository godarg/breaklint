import { defineRule } from "../../core/rule.ts";
import { blockKey } from "../../core/fingerprint.ts";
import { SNAPSHOT_ROUNDING_PX } from "../../core/enums.ts";
import type { BlockRecord, Box, EvaluationMeasurement, FlowHazards, PageRecord, Snapshot } from "../../core/types.ts";
import {
  boxlessDeclined, declined, hasLayoutBox, isNotRendered, layoutOutOfScope, makeFinding, notRenderedEvaluation, num, pageByNumber,
  renderingOf, sourceOf, targetEvaluation,
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
 * WHAT IS MEASURED FOR A SPLIT BLOCK: a lower bound from what its fragments carry. For each
 * fragment, its ITEMS: the glyph boxes of its text lines and the boxes of its replaced content
 * (Snapshot 5 `atomicBoxes`: images, the outermost svg, canvas, video, frames, form controls) that
 * start in its page's own column — left of the content box's right edge; the overflow column is on
 * no printed page — and the extent from the top of the first to the bottom of the last, clipped to
 * the fragment's box. The bound is the sum of those extents, each less the snapshot's rounding and
 * the glyph overhang (below), rounded down. A fragment on a page whose content box is not as wide as
 * the first fragment's is left out (A1: at another width the text would break into other lines), and
 * the row says how many were.
 *
 * WHY THE BOUND CANNOT EXCEED THE UNSPLIT HEIGHT. Take content laid out in ONE untransformed
 * block-direction flow: nothing positioned, offset, transformed, floated, set in columns, flex, grid
 * or table columns, nothing pulled up by a negative margin, nothing overflowing a box that does not
 * clip it. Then an item's position is fixed by what precedes it in flow order, and Paged.js — which
 * splits between lines and elements, places each piece of content once, in order, unsets
 * `text-indent` on a continued piece, and duplicates nothing at a split — lays the items of fragment
 * k out as a run of consecutive items of the unsplit block, at the same width and with the SAME
 * OFFSETS from one another (the relative-offset argument: every offset inside the run is a sum of
 * heights and margins of content inside the run, which the split does not change). The runs of
 * different fragments follow one another. Everything the paginator adds or removes at a split —
 * repeated borders and padding of the block and of every split element inside it, unset margins,
 * the overflow of the repeated bottom edge — lies above the first or below the last item of a
 * fragment, outside its extent. The extents are therefore disjoint, ordered pieces of the unsplit
 * block, and their sum is at most its height. It is below it by the block's own borders and padding,
 * by the half-leading above the first and below the last line of every fragment (3.66 px per
 * fragment at 10pt/1.4), and by every item in the overflow column. The finding says "at least".
 *
 * Where the leading is tighter than the font, a glyph box is taller than its line box and would be
 * counted on both sides of a split; that overhang is given back per fragment, against the smallest
 * line height of any element in it.
 *
 * The premises are CHECKED, not assumed, wherever the snapshot can see them, and the block is
 * DECLINED as `env/invalid-measurement` (charged to coverage) where they fail:
 *   - A flow hazard recorded inside the block, on it or around it (`flowHazards`, see FLOW_HAZARDS).
 *     Measured on 2026-09-25 (Paged.js 0.4.3, patched Chromium 141) with the lines-only bound this
 *     replaced: relatively offset paragraphs made a block 301.19 px tall read 360.19 px, a
 *     two-column descendant made one 335.81 px tall read 347.13 px — false errors on a 340.16 px
 *     page — and a table row split inside its first cell gave 697.95 px for a block 522.38 px tall.
 *   - Two text-carrying records inside one fragment stand side by side (what the hazards miss:
 *     inline blocks).
 *   - A piece of a split element inside a fragment does not end the fragment's content (if the
 *     element continues) or begin it (if it continued): after a break everything in flow order is
 *     on the next page, so anything else is content the paginator repeated or moved. Measured on
 *     2026-09-24: an absolutely positioned caption made Paged.js lay the same lines out twice.
 *   - An item reaches out of its own record's box by more than a glyph overhang allows (text
 *     overflowing a fixed height, which Paged.js repeats on every fragment).
 *   - No fragment has an item at all: a bound of zero would be a claim that it fits.
 *   - INCONCLUSIVE: the bound is at or below the page. A lower bound below the boundary proves
 *     nothing, and nothing in the snapshot proves the block fits: the fragment boxes are not an upper
 *     bound (a margin Paged.js unsets at a split was measured missing from them, 12 px short of the
 *     block). Such a block is neither reported nor called clean.
 * An unsplit block is declined when it or an ancestor is transformed (its box is not its laid-out
 * height) or its box reaches past the sheet (a union with the overflow column, one page tall).
 *
 * What the snapshot cannot see is assumed, and stated in docs/limitations.md: no content repeated or
 * moved by the paginator without an element of its own, nothing side by side without an element of
 * its own, the hyphen Paged.js appends at a split inside a word (U+2011) no wider than the one the
 * browser drew, a continued piece of a paragraph not wrapping into more lines than its text had
 * unsplit, and every line box at least as tall as the smallest line height recorded in its fragment.
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
const RULE = "layout/unbreakable-block-too-tall";

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
        "A block with 'break-inside: avoid' is taller than the content box of the page it was laid out on, so the paginator could not keep it whole there. Where the paginator had split it anyway, the reported height is a lower bound — the height of the text lines and the images or other replaced content in its fragments, without borders, padding or the space around them — so the block is at least that tall. Make the block shorter — split it into smaller sections deliberately, or reduce container padding, font size or contained rows. Removing 'break-inside: avoid' also clears the finding, but only because the rule then has no candidate: the block is exactly as tall as before, and it will still be broken, just without having asked not to be.",
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
    // Every decline of this rule is charged to coverage: the run says it could not judge the
    // block, never that the block fits. The measurements say which premise was not established.
    const decline = (block: BlockRecord, measurements: EvaluationMeasurement[]): void => {
      notMeasured.push(declined({ scope: "block", ruleId: RULE, reason: "env/invalid-measurement" }));
      evaluations.push(targetEvaluation({
        ruleId: RULE, keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex,
        boxScreen: block.box, status: "not-measured", reason: "env/invalid-measurement", measurements,
        connective: "single", violated: null,
      }));
    };

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

    // Which fragment stands for a split block: the first one the paginator laid out with a box of
    // its own and that is visible. Normally that is fragment 0. Deciding it per fragment instead —
    // "fragment 0 is not rendered, so the block is not" — let a script that hid only the first
    // fragment (`display: none` on it, or moving it where it has no box) hide the whole block: the
    // later fragments were skipped as continuations of a candidate that no longer existed, and a
    // block four pages tall came back clean (measured 2026-09-25: base exit 1, then exit 0). What is
    // judged is what printed. A block none of whose fragments has a box is classified at each
    // fragment below, as before.
    const leadBySid = new Map<string, number>();
    for (const fragment of snapshot.blocks) {
      if (fragment.sid === null || renderingOf(snapshot, fragment) !== "box" || fragment.effectiveStyle.visibility !== "visible") continue;
      const current = leadBySid.get(fragment.sid);
      if (current === undefined || fragment.fragmentIndex < current) leadBySid.set(fragment.sid, fragment.fragmentIndex);
    }

    for (const block of snapshot.blocks) {
      const lead = block.sid === null ? undefined : leadBySid.get(block.sid);
      // One evaluation per block, taken at its lead fragment. The other fragments are not separate
      // candidates — but what they carry is part of the height judged there. A fragment BEFORE the
      // lead is one that did not print as a box; it says so.
      if (lead !== undefined && block.fragmentIndex !== lead) {
        const before = block.fragmentIndex < lead;
        evaluations.push(targetEvaluation({
          ruleId: "layout/unbreakable-block-too-tall", keyType: "block", nodeKey: block.nodeKey, sid: block.sid,
          fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "not-applicable",
          countsTowardCoverage: false,
          reason: !before ? "rule/non-initial-fragment"
            : isNotRendered(snapshot, block) ? "rule/fragment-not-rendered" : "rule/fragment-without-visible-box",
          ...(before ? {
            measurements: [
              { name: "target-has-layout-box", value: hasLayoutBox(block.box), unit: null, operator: "=", threshold: true },
              { name: "target-visible", value: block.effectiveStyle.visibility === "visible", unit: null, operator: "=", threshold: true },
              { name: "judged-at-fragment", value: lead, unit: null, operator: null, threshold: null },
            ],
            connective: "all" as const, violated: null,
          } : {}),
        }));
        continue;
      }
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
      const rendering = renderingOf(snapshot, block);
      // `display: contents` generates no box for the element, and `break-inside` applies to boxes:
      // the declaration does nothing, so "does this block fit the page unbroken" is not a question
      // about it. Its children are laid out and are candidates in their own right. Not applicable,
      // outside coverage — not a decline, which made a list of `display: contents` items with
      // `break-inside: avoid` (a common grid pattern) end at exit 4 for a check that does not apply.
      if (rendering === "contents") {
        evaluations.push(targetEvaluation({
          ruleId: "layout/unbreakable-block-too-tall", keyType: "block", nodeKey: block.nodeKey, sid: block.sid,
          fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "not-applicable",
          countsTowardCoverage: false, reason: "rule/target-generates-no-box",
          measurements: [{ name: "display", value: block.display, unit: null, operator: null, threshold: null }],
          connective: "single", violated: null,
        }));
        continue;
      }
      // A block that was not rendered at all was never placed by the paginator, so the question has
      // no referent either. The case is the in-flow original of a `position: running(...)` element
      // (`rule/target-in-margin-box`: Paged.js hides it with `display: none` while its clones print
      // in the margin boxes); it was recorded as MEASURED at 0 px, and a document whose only avoid
      // block was a running element reported full coverage for a check that looked at nothing.
      if (rendering === "margin-box" || rendering === "not-rendered") {
        evaluations.push(notRenderedEvaluation("layout/unbreakable-block-too-tall", block));
        continue;
      }
      if (lead === undefined && block.fragmentIndex !== 0) {
        evaluations.push(targetEvaluation({
          ruleId: "layout/unbreakable-block-too-tall", keyType: "block", nodeKey: block.nodeKey, sid: block.sid,
          fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "not-applicable",
          countsTowardCoverage: false, reason: "rule/non-initial-fragment",
        }));
        continue;
      }
      candidates += 1;
      // A box of zero by zero that printed lines (`width: 0; height: 0; overflow: visible`), or
      // whose lines were not recorded: the box's height is not the height of what printed, and the
      // lines' extent is not the height of a box that could have broken. Neither is this block's
      // height. Declined, counted against coverage — never excluded, which turned such a document's
      // `insufficient-coverage` into a clean run.
      if (rendering === "zero-box") {
        const boxless = boxlessDeclined(RULE, snapshot, block);
        notMeasured.push(boxless.notMeasured);
        evaluations.push(boxless.evaluation);
        continue;
      }

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
        decline(block, [
          { name: "fragment-count", value: block.fragmentCount, unit: null, operator: null, threshold: null },
          { name: "fragments-joined-by-sid", value: fragments?.length ?? 0, unit: null, operator: "=", threshold: block.fragmentCount },
        ]);
        continue;
      }

      // The boundary is structural: taller than the page means it cannot fit. The ratio is
      // exposed so the threshold is a value rather than a hidden comparison — at 1.0 it is
      // exactly the arithmetic claim, and nothing else is defensible as an error.
      const limit = page.contentBox.height * num(ctx.options.toleranceRatio, 1.0);
      const fragmentCount = fragments?.length ?? 1;

      if (fragmentCount === 1) {
        // Unsplit: the box is the block, measured — unless it is drawn in another geometry than it
        // was laid out in, or it reaches past the sheet into the overflow column Paged.js hides
        // beside the page, where getBoundingClientRect returns a union one column tall.
        const transformed = hazardsOf([block], ["self", "around"]).filter((entry) => entry.endsWith(":transformed"));
        if (transformed.length > 0) {
          decline(block, [{ name: "flow-hazards", value: transformed.join(" "), unit: null, operator: "=", threshold: "none" }]);
          continue;
        }
        const sheetRight = page.pageBox ? page.pageBox.x + page.pageBox.width : page.contentBox.x + page.contentBox.width;
        if (!finiteBox(block.box) || block.box.x + block.box.width > sheetRight + 0.5) {
          decline(block, [{ name: "box-within-the-sheet", value: false, unit: null, operator: "=", threshold: true }]);
          continue;
        }
        // `block-height` keeps its 0.5.0 name and unit.
        measured += 1;
        const blockHeight = block.box.height;
        evaluations.push(targetEvaluation({ ruleId: RULE, keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "measured", measurements: [{ name: "block-height", value: blockHeight, unit: "px", operator: ">", threshold: limit }], violated: blockHeight > limit }));
        if (blockHeight <= limit) continue;
        findings.push(tooTall({
          ctx, snapshot, block, value: blockHeight, limit, page,
          message:
            `This block asks not to be broken and is ${blockHeight.toFixed(2)} px tall; the content box of ` +
            `page ${page.pageNumber} is ${page.contentBox.height.toFixed(2)} px. It did not fit there unbroken.`,
        }));
        continue;
      }

      // Split: a lower bound, or a decline where the snapshot shows a premise of the bound fails.
      const ordered = [...fragments!].sort((a, b) => a.fragmentIndex - b.fragmentIndex);
      const countMeasurement = { name: "fragment-count", value: fragmentCount, unit: null, operator: null, threshold: null } as const;
      const hazards = hazardsOf(ordered, ["inside", "self", "around"]);
      if (hazards.length > 0) {
        decline(block, [countMeasurement, { name: "flow-hazards", value: hazards.join(" "), unit: null, operator: "=", threshold: "none" }]);
        continue;
      }
      const bound = splitBlockLowerBound(ordered, page, index);
      if (bound.kind === "unbounded") {
        decline(block, [countMeasurement, UNBOUNDED_MEASUREMENT[bound.condition]]);
        continue;
      }
      // A different name from the unsplit case on purpose: this value is what the block is at
      // least, not what it is, and a consumer reading the evaluation must not mistake one for the
      // other.
      const boundMeasurements = [
        { name: "block-height-lower-bound", value: bound.value, unit: "px", operator: ">", threshold: limit },
        countMeasurement,
        { name: "fragments-left-out", value: bound.leftOut, unit: null, operator: null, threshold: null },
      ] as const;
      if (bound.value <= limit) {
        // INCONCLUSIVE. The bound is below the page, so it proves nothing, and nothing the
        // snapshot holds proves the block fits either: the sum of the fragment boxes is not an
        // upper bound (a margin Paged.js unsets at a split is missing from it — measured 12 px
        // short of the block), and the paginator split the block, which it does to a block that
        // fits a fresh page only when something else took the room. Declined, never "clean".
        decline(block, [...boundMeasurements]);
        continue;
      }
      measured += 1;
      evaluations.push(targetEvaluation({
        ruleId: RULE, keyType: "block", nodeKey: block.nodeKey, sid: block.sid,
        fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "measured",
        measurements: [...boundMeasurements], connective: "single", violated: true,
      }));
      findings.push(tooTall({
        ctx, snapshot, block, value: bound.value, limit, page,
        message:
          `This block asks not to be broken and is at least ${bound.value.toFixed(2)} px tall across the ` +
          `${fragmentCount} fragments the paginator split it into — counting only their text lines and ` +
          `replaced content, not borders, padding or the space around them; the content box of page ` +
          `${page.pageNumber} is ${page.contentBox.height.toFixed(2)} px. It did not fit there unbroken.`,
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

type UnboundedCondition = "side-by-side-text" | "content-outside-its-box" | "split-piece-off-edge" | "no-content";

/** What a declined split block records about the premise that failed, so the row explains itself. */
const UNBOUNDED_MEASUREMENT = {
  "side-by-side-text": { name: "fragment-text-in-one-column", value: false, unit: null, operator: "=", threshold: true },
  "content-outside-its-box": { name: "fragment-content-inside-its-box", value: false, unit: null, operator: "=", threshold: true },
  "split-piece-off-edge": { name: "split-pieces-at-fragment-edges", value: false, unit: null, operator: "=", threshold: true },
  "no-content": { name: "fragment-content-items", value: 0, unit: null, operator: ">", threshold: 0 },
} as const;

/**
 * The flow hazards the snapshot recorded on these records, as `scope:hazard`, sorted and without
 * repeats. A record without the Snapshot 5 field reports `scope:unrecorded`: an absent list is not
 * an empty one.
 */
function hazardsOf(records: readonly BlockRecord[], scopes: readonly (keyof FlowHazards)[]): string[] {
  const out = new Set<string>();
  for (const record of records) {
    for (const scope of scopes) {
      const list = (record.flowHazards as Partial<FlowHazards> | undefined)?.[scope];
      if (!Array.isArray(list)) out.add(`${scope}:unrecorded`);
      else for (const hazard of list) out.add(`${scope}:${hazard}`);
    }
  }
  return [...out].sort();
}

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

/** One thing a fragment carries: a glyph box of a text line, or the box of replaced content. */
interface Item {
  readonly box: Box;
  readonly text: boolean;
}

const within = (outer: Box, inner: Box, tolerance = 1): boolean =>
  inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance &&
  inner.x + inner.width <= outer.x + outer.width + tolerance &&
  inner.y + inner.height <= outer.y + outer.height + tolerance;

/** Two glyph boxes on the same band of the page with nothing between them horizontally in common. */
const sideBySide = (a: Box, b: Box): boolean =>
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5 &&
  (a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5);

const lineHeightOf = (record: BlockRecord): number =>
  Number.isFinite(record.lineHeight) && record.lineHeight >= 0 ? record.lineHeight : 0;

/**
 * How far an item may reach out of its record's box before the snapshot shows it is not the
 * record's own content in flow. A glyph box may overhang its line box by what the font is taller
 * than the line height; replaced content has no such overhang. One pixel of rounding either way.
 */
const reachOut = (item: Item, record: BlockRecord): boolean => {
  const allowance = (item.text ? Math.max(0, item.box.height - lineHeightOf(record)) : 0) + 1;
  return record.box.y - item.box.y > allowance ||
    item.box.y + item.box.height - (record.box.y + record.box.height) > allowance;
};

/**
 * The lower bound for a split block, or the premise of the bound the snapshot shows to fail. See the
 * header for the argument; `first` is the page of fragment 0, whose content box is the boundary.
 */
function splitBlockLowerBound(
  fragments: readonly BlockRecord[],
  first: PageRecord,
  index: SnapshotIndex,
): { kind: "bounded"; value: number; leftOut: number } | { kind: "unbounded"; condition: UnboundedCondition } {
  let total = 0;
  let items = 0;
  let leftOut = 0;
  for (const fragment of fragments) {
    // A piece the paginator laid out without a box carries nothing.
    if (!hasLayoutBox(fragment.box)) continue;
    const page = index.pages.get(fragment.page);
    // A1: content on a page of another width breaks into other lines; that fragment is left out,
    // which only makes the bound smaller, and the evaluation says how many were.
    if (!page || Math.abs(page.contentBox.width - first.contentBox.width) > 0.5) {
      leftOut += 1;
      continue;
    }
    const columnEnd = page.contentBox.x + page.contentBox.width;
    // The page's own column only. Anything that starts at or right of the content box's right
    // edge is in the overflow column Paged.js hides beside the page: printed nowhere.
    const itemsOf = (record: BlockRecord): Item[] => [
      ...(index.linesByBlock.get(record.nodeKey) ?? []).map((box) => ({ box, text: true })),
      ...(record.atomicBoxes ?? []).map(({ box }) => ({ box, text: false })),
    ].filter(({ box }) => finiteBox(box) && box.height > 0 && box.x < columnEnd);
    const own = itemsOf(fragment);
    // Records whose every item is one of this fragment's: the elements inside it on this page (the
    // element's own other fragments are not inside it, wherever they are).
    const inside = (index.blocksByPage.get(fragment.page) ?? [])
      .filter((record) => record.nodeKey !== fragment.nodeKey && record.sid !== fragment.sid)
      .map((record) => ({ record, items: itemsOf(record) }))
      .filter(({ items: its }) => its.length > 0 && its.every((item) => own.some((mine) => within(mine.box, item.box))));
    for (const { record, items: its } of [{ record: fragment, items: own }, ...inside]) {
      if (its.length === 0) continue;
      // A box that is not a number contains nothing it can be shown to contain.
      if (!finiteBox(record.box) || its.some((item) => reachOut(item, record))) {
        return { kind: "unbounded", condition: "content-outside-its-box" };
      }
    }
    if (own.length === 0) continue;
    // An element split at this page's edge ends this fragment's content, or begins it: after the
    // break everything in flow order is on the next page. A piece of a split element anywhere else
    // means the paginator did not cut one flow in two here — it repeated content, or moved some.
    const ownTop = Math.min(...own.map(({ box }) => box.y));
    const ownBottom = Math.max(...own.map(({ box }) => box.y + box.height));
    for (const { record, items: its } of inside) {
      if (record.fragmentCount < 2) continue;
      const continues = record.fragmentIndex < record.fragmentCount - 1;
      const continued = record.fragmentIndex > 0;
      if (continues && Math.abs(Math.max(...its.map(({ box }) => box.y + box.height)) - ownBottom) > 1) {
        return { kind: "unbounded", condition: "split-piece-off-edge" };
      }
      if (continued && Math.abs(Math.min(...its.map(({ box }) => box.y)) - ownTop) > 1) {
        return { kind: "unbounded", condition: "split-piece-off-edge" };
      }
    }
    for (let i = 0; i < inside.length; i += 1) {
      for (let j = i + 1; j < inside.length; j += 1) {
        const a = inside[i]!.items.filter((item) => item.text).map(({ box }) => box);
        const b = inside[j]!.items.filter((item) => item.text).map(({ box }) => box);
        // An element and one inside it share their lines; only two that are not nested can be
        // side by side.
        const nested = a.every((line) => b.some((other) => within(other, line))) || b.every((line) => a.some((other) => within(other, line)));
        if (!nested && a.some((line) => b.some((other) => sideBySide(line, other)))) {
          return { kind: "unbounded", condition: "side-by-side-text" };
        }
      }
    }
    const top = Math.max(fragment.box.y, ownTop);
    const bottom = Math.min(fragment.box.y + fragment.box.height, ownBottom);
    // With leading tighter than the font, a glyph box is taller than its line box and sticks out of
    // it above and below — together by at most its height less the line height. At a split that
    // overhang would be counted on both sides of the break, so it is given back per fragment,
    // against the smallest line height of any element here (which only ever gives back more).
    const glyphs = own.filter((item) => item.text).map(({ box }) => box.height);
    const lineHeight = Math.min(...[fragment, ...inside.map(({ record }) => record)].map(lineHeightOf));
    const overhang = glyphs.length === 0 ? 0 : Math.max(0, Math.max(...glyphs) - lineHeight);
    // Each extent is a difference of two stored coordinates and may read up to the snapshot's
    // rounding more than it is; the bound gives that back rather than claim it.
    total += Math.max(0, bottom - top - overhang - SNAPSHOT_ROUNDING_PX);
    items += own.length;
  }
  if (items === 0) return { kind: "unbounded", condition: "no-content" };
  // Rounded DOWN: a lower bound may lose a hundredth of a pixel, never gain one.
  return { kind: "bounded", value: Math.floor(total * 100 + 1e-6) / 100, leftOut };
}
