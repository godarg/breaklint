import { defineRule } from "../../core/rule.ts";
import { blockKey } from "../../core/fingerprint.ts";
import { declined, layoutOutOfScope, makeFinding, num, pageByNumber, sourceOf } from "../shared.ts";

/**
 * layout/unbreakable-block-too-tall — a block that promises not to break is taller than a page.
 *
 * One of two rules in this release that carry `error`, and the only kind of threshold that
 * earns it: the comparison is between two directly measured heights and the boundary is
 * structural, not chosen. A block that is taller than every page cannot keep its own promise
 * not to break. That is arithmetic, not convention, and it is why this rule may fail a build
 * by default while thirteen others may not.
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
  },
  (snapshot, ctx) => {
    const findings = [];
    const notMeasured = [];
    let candidates = 0;
    let measured = 0;

    for (const block of snapshot.blocks) {
      const avoids = /\bavoid(-page)?\b/u.test(block.effectiveStyle.breakInside);
      if (!avoids) continue;
      // One fragment per block is enough: the block's height is a property of the block.
      if (block.fragmentIndex !== 0) continue;
      candidates += 1;

      const outOfScope = layoutOutOfScope(block.effectiveStyle);
      if (outOfScope) {
        notMeasured.push(
          declined({ scope: "block", ruleId: "layout/unbreakable-block-too-tall", reason: outOfScope }),
        );
        continue;
      }
      const page = pageByNumber(snapshot, block.page);
      if (!page) {
        // Cannot happen with a well-formed snapshot; if it does, the snapshot is the defect
        // and defineRule's invariant will surface it rather than let the count drift.
        notMeasured.push(
          declined({ scope: "block", ruleId: "layout/unbreakable-block-too-tall", reason: "env/multicolumn" }),
        );
        continue;
      }
      measured += 1;

      // The boundary is structural: taller than the page means it cannot fit. The ratio is
      // exposed so the threshold is a value rather than a hidden comparison — at 1.0 it is
      // exactly the arithmetic claim, and nothing else is defensible as an error.
      const limit = page.contentBox.height * num(ctx.options.toleranceRatio, 1.0);
      if (block.box.height <= limit) continue;

      findings.push(
        makeFinding({
          ctx,
          ruleId: "layout/unbreakable-block-too-tall",
          severity: "error",
          message:
            `This block asks not to be broken and is ${block.box.height.toFixed(2)} px tall; the ` +
            `page content box is ${page.contentBox.height.toFixed(2)} px. It cannot fit on any page.`,
          page: block.page,
          keyType: "block",
          key: blockKey({ authorId: block.authorId, blockSignature: block.blockSignature }),
          nodeKey: block.nodeKey,
          sid: block.sid,
          fragmentIndex: block.fragmentIndex,
          boxScreen: block.box,
          source: sourceOf(snapshot, block.sid),
          value: block.box.height,
          threshold: limit,
          unit: "px",
          proofSource: "A",
        }),
      );
    }
    return { findings, candidates, measured, notMeasured };
  },
);
