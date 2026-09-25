import { defineRule } from "../../core/rule.ts";
import { blockKey } from "../../core/fingerprint.ts";
import {
  declined, hasLayoutBox, layoutOutOfScope, makeFinding, notRenderedEvaluation, num, pageByNumber, renderingOf, sourceOf,
  targetEvaluation,
} from "../shared.ts";

/**
 * layout/unbreakable-block-too-tall — a block that promises not to break is taller than a page.
 *
 * One of two rules in this release that carry `error`, and the only kind of threshold that
 * earns it: the comparison is between two directly measured heights and the boundary is
 * structural, not chosen. A block that is taller than every page cannot keep its own promise
 * not to break. That is arithmetic, not convention, and it is why this rule may fail a build
 * by default while eleven others may not.
 *
 * Which height, though. Until 0.6.0 the rule measured the FIRST fragment and skipped the rest,
 * on the stated ground that "the block's height is a property of the block". That holds only
 * while the block is unfragmented. Measured on 2026-09-18 with a six-page `break-inside: avoid`
 * section: the paginator split it into six fragments, fragment 0 measured 596.36 px against a
 * page content box of 680.31 px, the rule reported nothing and the document came back `clean` at
 * exit 0 — for a block roughly five and a half pages tall that had asked not to be broken. The
 * one rule that can fail a build was silent about the very thing it exists to catch, and a
 * false-negative gate is worse than no gate.
 *
 * The height of a block the paginator had to split is the sum of the boxes it was split into.
 * That is still a measured quantity and still compared against the same structural boundary, so
 * the burden of proof is unchanged. It is also conservative in the direction that matters: a
 * block SHORTER than a page that merely started low on one is fragmented too, and its fragment
 * heights still sum to less than a page, so it does not become a finding.
 *
 * TWO THINGS THE FIRST VERSION OF THIS SUM GOT WRONG, BOTH MEASURED BEFORE THEY SHIPPED.
 *
 * Same `sid` did not mean same flow. Paged.js implements `position: running(...)` by deep-cloning
 * the element into the page margin box of EVERY page, and the clone keeps the injected source id.
 * Measured on 2026-09-18: an ordinary twelve-page document whose only running header is three
 * lines tall reported this rule at 979.08 px against a 619.83 px page — 13 copies of an 81.59 px
 * header, summed, as `severity: error`. Nothing in that document was too tall for anything. The
 * first repair decided flow membership HERE, by coordinates: a fragment counted only when its box
 * started inside the content box of its page. That excluded the margin boxes and, measured on
 * 2026-09-24, every fragment of a full-bleed block as well — negative side margins put all six
 * fragments of a five-and-a-half-page block left of the content box, and the document came back
 * clean. Flow membership is now decided where the page structure is visible: the collector keeps
 * only blocks inside a page's content area (`.pagedjs_pagebox > .pagedjs_area`), so margin-box
 * clones never reach this rule, and every record carrying the element's sid is one of its
 * fragments, wherever it lies.
 *
 * The boundary is the page the block was laid out on, and the sentence says so. It used to end
 * "It cannot fit on any page", which is an all-pages claim taken from one sample; the largest
 * content box in the document was tried instead and is worse — in a document with a named
 * landscape page it raises the bar for every block on the portrait pages and hides real ones. What
 * is actually observed is that THIS block did not fit on THIS page, and that is what is reported.
 *
 * A split block is only reported from the THIRD fragment on, and that is a proof obligation rather
 * than caution. Paged.js does not fragment natively: it produces separate DOM elements, and its
 * own stylesheet unsets `margin` and `padding` at the split edges but not `border`, and without
 * `!important`. A two-fragment block therefore has a summed height that repeated decoration can
 * inflate above the page, while the unsplit block would have fitted. From three fragments on the
 * inflation cannot manufacture the finding: an intermediate fragment fills a whole content box and
 * there is content before and after it, so the block is taller than one page by construction —
 * with or without decoration. At one or two fragments the rule measures and records the first
 * fragment's box and reports only if that alone exceeds the page — exactly what 0.5.0 did. The
 * two-fragment case is therefore a KNOWN gap, not a silent one: a block that really is too tall
 * and happens to split into exactly two pieces is not reported. `docs/limitations.md` says so.
 *
 * Fragments are correlated by `sid`, the authoring-source identity. A split block whose fragments
 * carry no `sid` — a `--no-source-map` run, or an element a script created — cannot be correlated,
 * and neither can one whose sid does not account for exactly the fragments the snapshot counted.
 * Such a block is DECLINED (`env/invalid-measurement`, charged to coverage). It used to be measured
 * on its first fragment, which compares a piece with the page: a silent partial measurement is how
 * the six-page block above came back clean, and a clean result must mean the block was judged.
 */
export const unbreakableBlockTooTall = defineRule(
  {
    id: "layout/unbreakable-block-too-tall",
    severity: "error",
    proofSource: "A",
    calibrated: false,
    experimental: false,
    unit: "px",
    defaultOptions: { toleranceRatio: 1.0 },
    summary: "A block with break-inside: avoid is taller than the page content box.",
    declines: ["env/multicolumn", "env/vertical-writing", "env/invalid-measurement"],
    remediation: {
      advice:
        "A block with 'break-inside: avoid' is taller than the content box of the page it was laid out on, so the paginator could not keep it whole there. Where it had already been split into three or more fragments, the reported height is the sum of those fragments, which is the height its content needed. Make the block shorter — split it into smaller sections deliberately, or reduce container padding, font size or contained rows. Removing 'break-inside: avoid' also clears the finding, but only because the rule then has no candidate: the block is exactly as tall as before, and it will still be broken, just without having asked not to be.",
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

    // The flow height of every source element, summed over the fragments the paginator produced.
    // Built over ALL blocks rather than only the avoiding ones, because a fragment is a fragment
    // of its element regardless of which fragment happens to carry the declaration in the tree.
    //
    // Every record with the element's sid counts, wherever its box lies. Flow membership is a
    // property of the snapshot, not of this rule: the collector keeps only blocks inside a page's
    // content area, so a `position: running(...)` clone in a margin box never reaches it. It used
    // to be decided here, by coordinates — a fragment counted only when its box started inside
    // the content box — and that test was wrong in the other direction: a full-bleed block with
    // negative side margins has EVERY fragment left of the content box, the filter discarded all
    // six of them, and a block five and a half pages tall was judged on one piece and came back
    // clean. No coordinate can tell a margin box from a fragment that bleeds into the margin; the
    // page structure can.
    const flowBySid = new Map<string, { height: number; fragments: number }>();
    for (const fragment of snapshot.blocks) {
      if (fragment.sid === null) continue;
      const entry = flowBySid.get(fragment.sid) ?? { height: 0, fragments: 0 };
      entry.height += fragment.box.height;
      entry.fragments += 1;
      flowBySid.set(fragment.sid, entry);
    }

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
      if (fragment.sid === null || renderingOf(fragment) !== "box" || fragment.effectiveStyle.visibility !== "visible") continue;
      const current = leadBySid.get(fragment.sid);
      if (current === undefined || fragment.fragmentIndex < current) leadBySid.set(fragment.sid, fragment.fragmentIndex);
    }

    for (const block of snapshot.blocks) {
      const lead = block.sid === null ? undefined : leadBySid.get(block.sid);
      // One evaluation per block, taken at its lead fragment. The other fragments are not separate
      // candidates — but their heights are part of the height judged there. A fragment BEFORE the
      // lead is one that did not print as a box; it says so.
      if (lead !== undefined && block.fragmentIndex !== lead) {
        const before = block.fragmentIndex < lead;
        evaluations.push(targetEvaluation({
          ruleId: "layout/unbreakable-block-too-tall", keyType: "block", nodeKey: block.nodeKey, sid: block.sid,
          fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "not-applicable",
          countsTowardCoverage: false, reason: before ? "rule/fragment-not-rendered" : "rule/non-initial-fragment",
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
      const rendering = renderingOf(block);
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
      if (rendering !== "box") {
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
      // snapshot counted cannot be summed either. Measuring the first fragment instead — what this
      // rule used to fall back to — compares a PIECE with the page and can call a six-page block
      // clean. That is declined, and the decline is charged to coverage, so the run says it could
      // not judge the block instead of saying the block fits.
      const flow = block.sid === null ? undefined : flowBySid.get(block.sid);
      const correlated = block.fragmentCount <= 1
        ? block.sid === null || flow?.fragments === 1
        : flow?.fragments === block.fragmentCount;
      if (!correlated) {
        notMeasured.push(
          declined({ scope: "block", ruleId: "layout/unbreakable-block-too-tall", reason: "env/invalid-measurement" }),
        );
        evaluations.push(targetEvaluation({
          ruleId: "layout/unbreakable-block-too-tall", keyType: "block", nodeKey: block.nodeKey, sid: block.sid,
          fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "not-measured", reason: "env/invalid-measurement",
          measurements: [
            { name: "fragment-count", value: block.fragmentCount, unit: null, operator: null, threshold: null },
            { name: "fragments-joined-by-sid", value: flow?.fragments ?? 0, unit: null, operator: "=", threshold: block.fragmentCount },
          ],
          connective: "single", violated: null,
        }));
        continue;
      }
      measured += 1;

      // The boundary is structural: taller than the page means it cannot fit. The ratio is
      // exposed so the threshold is a value rather than a hidden comparison — at 1.0 it is
      // exactly the arithmetic claim, and nothing else is defensible as an error.
      const limit = page.contentBox.height * num(ctx.options.toleranceRatio, 1.0);
      const fragmentCount = flow?.fragments ?? 1;
      // `block-height` keeps its name and its unit: it is still the height of this block. What
      // changed is that a split block's height is no longer read off one of its pieces — from the
      // third fragment on. At one or two fragments the recorded value is the first fragment's box,
      // exactly as in 0.5.0: the sum is not recorded there either, because a two-fragment sum is
      // the one this rule cannot tell apart from repeated decoration (see the header).
      const summable = fragmentCount >= 3;
      const blockHeight = summable ? flow!.height : block.box.height;
      evaluations.push(targetEvaluation({ ruleId: "layout/unbreakable-block-too-tall", keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "measured", measurements: [{ name: "block-height", value: blockHeight, unit: "px", operator: ">", threshold: limit }], violated: blockHeight > limit }));
      if (blockHeight <= limit) continue;

      findings.push(
        makeFinding({
          ctx,
          ruleId: "layout/unbreakable-block-too-tall",
          severity: "error",
          message:
            `This block asks not to be broken and is ${blockHeight.toFixed(2)} px tall` +
            (summable
              ? ` across the ${fragmentCount} fragments the paginator split it into`
              : "") +
            `; the content box of page ${page.pageNumber} is ${page.contentBox.height.toFixed(2)} px. ` +
            `It did not fit there unbroken.`,
          page: block.page,
          keyType: "block",
          key: blockKey({ authorId: block.authorId, blockSignature: block.blockSignature }),
          nodeKey: block.nodeKey,
          sid: block.sid,
          fragmentIndex: block.fragmentIndex,
          boxScreen: block.box,
          source: sourceOf(snapshot, block.sid),
          value: blockHeight,
          threshold: limit,
          unit: "px",
          proofSource: "A",
        }),
      );
    }
    return { findings, candidates, measured, notMeasured, evaluations };
  },
);
