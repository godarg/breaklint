import { defineRule } from "../../core/rule.ts";
import { blockKey } from "../../core/fingerprint.ts";
import {
  boxlessDeclined, declined, hasLayoutBox, isNotRendered, layoutOutOfScope, lineStateOf, makeFinding, notRenderedEvaluation,
  num, pageByNumber, renderedBox, sourceOf, targetEvaluation,
} from "../shared.ts";

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/**
 * layout/heading-at-page-bottom — a heading sits at the foot of a page and its section starts
 * on the next one.
 *
 * The threshold is two of the heading's own line heights of remaining space. That number is
 * chosen, not derived, and the finding says so. Using the heading's own line height rather than
 * a fixed pixel count at least makes the rule scale with the typography instead of with the
 * page size.
 */
export const headingAtPageBottom = defineRule(
  {
    id: "layout/heading-at-page-bottom",
    severity: "warn",
    proofSource: null,
    calibrated: false,
    experimental: false,
    unit: "line heights",
    quantityScope: "fragment",
    defaultOptions: { minTrailingLineHeights: 2 },
    summary: "A heading is the last thing on a page; what it introduces begins on the next.",
    declines: ["env/multicolumn", "env/vertical-writing", "env/invalid-measurement"],
    remediation: {
      advice:
        "A heading sits at the bottom of the page with less room than the uncalibrated threshold following it. Add 'break-after: avoid;' to the heading style rule so it advances with its following content, or insert an explicit 'break-before: page;' before the heading.",
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
    const minLineHeights = num(ctx.options.minTrailingLineHeights, 2);

    const byPage = new Map<number, typeof snapshot.blocks>();
    for (const b of snapshot.blocks) {
      const list = byPage.get(b.page) ?? [];
      list.push(b);
      byPage.set(b.page, list);
    }

    for (const block of snapshot.blocks) {
      if (!HEADINGS.has(block.tag.toLowerCase())) continue;
      // A heading nothing was printed from does not end any page: it is not on one. The case is a
      // running heading, whose in-flow original Paged.js hides with `display: none`
      // (`rule/target-in-margin-box`); it was counted as a measured candidate that "had content
      // below it".
      if (isNotRendered(snapshot, block)) {
        evaluations.push(notRenderedEvaluation("layout/heading-at-page-bottom", block));
        continue;
      }
      // A heading with no box of its own whose recorded lines are all invisible prints nothing
      // either: excluded as not visible, like any other hidden target, not declined against
      // coverage — which turned a document with one hidden `display: contents` heading into exit 4.
      if (!hasLayoutBox(block.box)) {
        const lines = lineStateOf(snapshot, block);
        if (lines.recorded && lines.total > 0 && lines.visible === 0) {
          evaluations.push(targetEvaluation({
            ruleId: "layout/heading-at-page-bottom", keyType: "block", nodeKey: block.nodeKey, sid: block.sid,
            fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "excluded", countsTowardCoverage: false,
            reason: "rule/target-not-visible",
            measurements: [{ name: "visible-line-count", value: 0, unit: "lines", operator: ">", threshold: 0 }],
            connective: "single", violated: null,
          }));
          continue;
        }
      }
      candidates += 1;
      // Where the heading is printed. A `display: contents` heading has no box of its own — a zero
      // box at the origin, which said "content below it" about every heading — but its text has
      // line boxes, and the heading ends where its last line does. With neither, it is declined.
      const box = renderedBox(snapshot, block);
      if (box === null) {
        const decline = boxlessDeclined("layout/heading-at-page-bottom", snapshot, block);
        notMeasured.push(decline.notMeasured);
        evaluations.push(decline.evaluation);
        continue;
      }

      const outOfScope = layoutOutOfScope(block.effectiveStyle);
      if (outOfScope) {
        notMeasured.push(declined({ scope: "block", ruleId: "layout/heading-at-page-bottom", reason: outOfScope }));
        evaluations.push(targetEvaluation({ ruleId: "layout/heading-at-page-bottom", keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "not-measured", reason: outOfScope }));
        continue;
      }
      const page = pageByNumber(snapshot, block.page);
      if (!page) {
        notMeasured.push(
          declined({ scope: "block", ruleId: "layout/heading-at-page-bottom", reason: "env/multicolumn" }),
        );
        evaluations.push(targetEvaluation({ ruleId: "layout/heading-at-page-bottom", keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "not-measured", reason: "env/multicolumn" }));
        continue;
      }
      measured += 1;

      // The heading is only stranded if nothing else follows it on this page. A heading with
      // three lines of text under it is exactly what the author wanted.
      const onPage = byPage.get(block.page) ?? [];
      const below = onPage.filter((b) => {
        if (b.nodeKey === block.nodeKey) return false;
        const other = renderedBox(snapshot, b);
        return other !== null && other.y >= box.y + box.height - 0.5;
      });
      const pageBottom = page.contentBox.y + page.contentBox.height;
      const remaining = pageBottom - (box.y + box.height);
      const lineHeight = block.lineHeight > 0 ? block.lineHeight : block.effectiveStyle.fontSize * 1.2;
      const remainingInLines = lineHeight > 0 ? remaining / lineHeight : 0;
      const violated = below.length === 0 && remainingInLines < minLineHeights;
      const measurements = [
        { name: "following-block-count", value: below.length, unit: "blocks", operator: "=", threshold: 0 },
        { name: "remaining-line-heights", value: remainingInLines, unit: "line heights", operator: "<", threshold: minLineHeights },
      ] as const;
      if (below.length > 0) {
        evaluations.push(targetEvaluation({ ruleId: "layout/heading-at-page-bottom", keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "measured", measurements: [...measurements], connective: "all", violated }));
        continue;
      }

      evaluations.push(targetEvaluation({ ruleId: "layout/heading-at-page-bottom", keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "measured", measurements: [...measurements], connective: "all", violated }));
      if (remainingInLines >= minLineHeights) continue;

      findings.push(
        makeFinding({
          ctx,
          ruleId: "layout/heading-at-page-bottom",
          severity: "warn",
          message:
            `This heading ends page ${block.page} with ${remainingInLines.toFixed(2)} of its own ` +
            `line heights left; the threshold is ${minLineHeights}. Heuristic: the threshold is a ` +
            `chosen default, not a calibrated one.`,
          page: block.page,
          keyType: "block",
          key: blockKey({ authorId: block.authorId, blockSignature: block.blockSignature }),
          nodeKey: block.nodeKey,
          sid: block.sid,
          fragmentIndex: block.fragmentIndex,
          boxScreen: block.box,
          source: sourceOf(snapshot, block.sid),
          value: Number(remainingInLines.toFixed(4)),
          threshold: minLineHeights,
          unit: "line heights",
        }),
      );
    }
    return { findings, candidates, measured, notMeasured, evaluations };
  },
);
