import { defineRule } from "../../core/rule.ts";
import { blockKey } from "../../core/fingerprint.ts";
import { declined, layoutOutOfScope, makeFinding, num, pageByNumber, sourceOf, targetEvaluation } from "../shared.ts";

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
 * Same `sid` does not mean same flow. Paged.js implements `position: running(...)` by deep-cloning
 * the element into the page margin box of EVERY page, and the clone keeps the injected source id.
 * Measured on 2026-09-18: an ordinary twelve-page document whose only running header is three
 * lines tall reported this rule at 979.08 px against a 619.83 px page — 13 copies of an 81.59 px
 * header, summed, as `severity: error`. Nothing in that document was too tall for anything. A
 * fragment therefore only counts towards the flow when its box STARTS inside the content box of
 * its page: a margin box is by construction outside it, and a real fragment always begins inside.
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
 * Fragments are correlated by `sid`, the authoring-source identity; a block whose fragments carry
 * no `sid` cannot be correlated and keeps the old first-fragment behaviour rather than guessing.
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
    declines: ["env/multicolumn", "env/vertical-writing"],
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
    // A box only counts when it STARTS inside the content box of its page. Paged.js clones a
    // `position: running(...)` element into the margin box of every page and the clone keeps the
    // source id, so summing by id alone adds one copy of a running header per page — measured as a
    // false `error` on a document with nothing too tall in it. A margin box lies outside the
    // content box by construction; a real fragment always begins inside it.
    const INSIDE_TOLERANCE_PX = 1;
    const flowBySid = new Map<string, { height: number; fragments: number }>();
    for (const fragment of snapshot.blocks) {
      if (fragment.sid === null) continue;
      const host = pageByNumber(snapshot, fragment.page);
      if (!host) continue;
      const top = host.contentBox.y - INSIDE_TOLERANCE_PX;
      const bottom = host.contentBox.y + host.contentBox.height + INSIDE_TOLERANCE_PX;
      if (fragment.box.y < top || fragment.box.y > bottom) continue;
      const entry = flowBySid.get(fragment.sid) ?? { height: 0, fragments: 0 };
      entry.height += fragment.box.height;
      entry.fragments += 1;
      flowBySid.set(fragment.sid, entry);
    }

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
      // One evaluation per block, taken at its first fragment. The later fragments are not
      // separate candidates — but their heights are part of the height judged there.
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
      measured += 1;

      // The boundary is structural: taller than the page means it cannot fit. The ratio is
      // exposed so the threshold is a value rather than a hidden comparison — at 1.0 it is
      // exactly the arithmetic claim, and nothing else is defensible as an error.
      const limit = page.contentBox.height * num(ctx.options.toleranceRatio, 1.0);
      const flow = block.sid === null ? undefined : flowBySid.get(block.sid);
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
