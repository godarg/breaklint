import { defineRule } from "../../core/rule.ts";
import { pageKey } from "../../core/fingerprint.ts";
import { declined, makeFinding, num, targetEvaluation } from "../shared.ts";

/**
 * layout/orphaned-continuation-page — a page whose only content is the tail of a block.
 *
 * The trap here is the forced break, and it is worth naming because reading it the obvious way
 * is verifiably wrong. `break-before: page` set from a stylesheet reads back as `auto` after
 * pagination; the same declaration written inline survives as `page` — and is measured *not*
 * to take effect. So a rule that asks `getComputedStyle` for the break reason gets it backwards
 * in both directions. The cause comes from the collector, which reads what the paginator itself
 * wrote into the tree.
 */
export const orphanedContinuationPage = defineRule(
  {
    id: "layout/orphaned-continuation-page",
    severity: "warn",
    proofSource: null,
    calibrated: false,
    experimental: false,
    unit: "fill ratio",
    defaultOptions: { maxNetFill: 0.5 },
    summary: "A page holds nothing but the tail of a block that began earlier.",
    declines: ["env/parity-blank-page", "env/forced-break"],
  },
  (snapshot, ctx) => {
    const findings = [];
    const notMeasured = [];
    const evaluations = [];
    let candidates = 0;
    let measured = 0;
    const maxNetFill = num(ctx.options.maxNetFill, 0.5);

    for (const page of snapshot.pages) {
      candidates += 1;
      if (page.blank) {
        notMeasured.push(
          declined({ scope: "page", ruleId: "layout/orphaned-continuation-page", reason: "env/parity-blank-page" }),
        );
        evaluations.push(targetEvaluation({ ruleId: "layout/orphaned-continuation-page", keyType: "page", nodeKey: page.nodeKey, sid: null, boxScreen: page.contentBox, status: "not-measured", reason: "env/parity-blank-page" }));
        continue;
      }
      // A page the author forced open is a decision. Judging its fill reports the intent back.
      if (page.incomingBreakCause.kind === "forced") {
        notMeasured.push(
          declined({ scope: "page", ruleId: "layout/orphaned-continuation-page", reason: "env/forced-break" }),
        );
        evaluations.push(targetEvaluation({ ruleId: "layout/orphaned-continuation-page", keyType: "page", nodeKey: page.nodeKey, sid: null, boxScreen: page.contentBox, status: "not-measured", reason: "env/forced-break" }));
        continue;
      }
      measured += 1;

      const onPage = snapshot.blocks.filter((b) => b.page === page.pageNumber);
      if (onPage.length === 0) { evaluations.push(targetEvaluation({ ruleId: "layout/orphaned-continuation-page", keyType: "page", nodeKey: page.nodeKey, sid: null, boxScreen: page.contentBox, status: "measured", measurements: [{ name: "continuation-only", value: false, unit: null, operator: "=", threshold: true }, { name: "net-fill", value: page.fill.net, unit: "fill ratio", operator: "<", threshold: maxNetFill }], connective: "all", violated: false })); continue; }
      const allAreContinuations = onPage.every((b) => b.fragmentIndex > 0);
      const violated = allAreContinuations && page.fill.net < maxNetFill;
      evaluations.push(targetEvaluation({ ruleId: "layout/orphaned-continuation-page", keyType: "page", nodeKey: page.nodeKey, sid: null, boxScreen: page.contentBox, status: "measured", measurements: [{ name: "continuation-only", value: allAreContinuations, unit: null, operator: "=", threshold: true }, { name: "net-fill", value: page.fill.net, unit: "fill ratio", operator: "<", threshold: maxNetFill }], connective: "all", violated }));
      if (!violated) continue;

      const key = pageKey({
        firstSemanticBlockKey: page.firstSemanticBlockKey,
        pageOrdinal: page.pageNumber,
      });
      findings.push(
        makeFinding({
          ctx,
          ruleId: "layout/orphaned-continuation-page",
          severity: "warn",
          message:
            `Page ${page.pageNumber} carries only the continuation of earlier content and is ` +
            `${(page.fill.net * 100).toFixed(1)} % filled; threshold ` +
            `${(maxNetFill * 100).toFixed(0)} %. The break into it was an overflow, not a request.`,
          page: page.pageNumber,
          keyType: "page",
          key: key.key,
          nodeKey: page.nodeKey,
          sid: null,
          boxScreen: page.contentBox,
          source: null,
          value: page.fill.net,
          threshold: maxNetFill,
          unit: "fill ratio",
          ambiguity: key.ambiguous ? { groupSize: 2, resolvable: false } : null,
        }),
      );
    }
    return { findings, candidates, measured, notMeasured, evaluations };
  },
);
