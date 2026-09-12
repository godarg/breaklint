import { defineRule } from "../../core/rule.ts";
import { blockKey } from "../../core/fingerprint.ts";
import { declined, layoutOutOfScope, makeFinding, num, pageByNumber, sourceOf, targetEvaluation } from "../shared.ts";

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
    defaultOptions: { minTrailingLineHeights: 2 },
    summary: "A heading is the last thing on a page; what it introduces begins on the next.",
    declines: ["env/multicolumn", "env/vertical-writing"],
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
      candidates += 1;

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
      const below = onPage.filter((b) => b.nodeKey !== block.nodeKey && b.box.y >= block.box.y + block.box.height - 0.5);
      const pageBottom = page.contentBox.y + page.contentBox.height;
      const remaining = pageBottom - (block.box.y + block.box.height);
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
