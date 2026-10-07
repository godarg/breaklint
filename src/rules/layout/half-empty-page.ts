import { defineRule } from "../../core/rule.ts";
import { pageKey } from "../../core/fingerprint.ts";
import { declined, isNotRendered, makeFinding, num, renderedBox, targetEvaluation } from "../shared.ts";

/**
 * Experimental whitespace review, not a proof of avoidability. Net fill counts glyph/visual
 * bands rather than line boxes. A low ratio alone does not establish unused vertical capacity.
 * A two-line-height review tolerance removes pages with too little bottom space for two recorded
 * lines; it is not a calibrated proof threshold. A natural document ending needs no additional content. Observed forced endings remain
 * explicit unknowns. No CSS declaration is treated as an author-intent label.
 */
export const halfEmptyPage = defineRule(
  {
    id: "layout/half-empty-page",
    severity: "warn",
    proofSource: null,
    calibrated: false,
    experimental: true,
    unit: "fill ratio",
    defaultOptions: { minNetFill: 0.6, maxTopGap: 0.5 },
    summary: "A page has low glyph/visual-band coverage and remaining vertical room, or starts unusually far down.",
    declines: ["env/parity-blank-page", "env/forced-break"],
    remediation: {
      advice:
        "Inspect the page and its next page. Low glyph/visual-band coverage is not proof of an avoidable gap. Compare the reported bottom space with the actual following image, table or kept block; try a small size, margin or keep change only when that source cause is verified, then rerender both pages. For a late start, inspect leading margins, empty blocks and floats. A forced paginator ending is reported as unmeasured, and a natural document ending is accepted for low coverage; neither establishes author intent.",
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
    const minNetFill = num(ctx.options.minNetFill, 0.6);
    const maxTopGap = num(ctx.options.maxTopGap, 0.5);

    for (const page of snapshot.pages) {
      candidates += 1;

      // A parity blank page has netFill 0 and would fire under any threshold. It exists because
      // the author asked for `break-before: right`; reporting it as a defect makes the tool
      // useless for book setting.
      if (page.blank) {
        notMeasured.push(
          declined({ scope: "page", ruleId: "layout/half-empty-page", reason: "env/parity-blank-page" }),
        );
        evaluations.push(targetEvaluation({ ruleId: "layout/half-empty-page", keyType: "page", nodeKey: page.nodeKey, sid: null, boxScreen: page.contentBox, status: "not-measured", reason: "env/parity-blank-page" }));
        continue;
      }
      const bottomGap = Math.max(0, (1 - page.fill.vertical) * page.contentBox.height);
      const lineHeights = snapshot.blocks.filter(block => block.page === page.pageNumber
        && !isNotRendered(snapshot, block) && renderedBox(snapshot, block) !== null && block.lineHeight > 0)
        .map(block => block.lineHeight);
      const minimumLineHeight = lineHeights.length ? Math.min(...lineHeights) : null;
      const naturalEnd = page.isLast && page.outgoingBreakCause.kind === "document-end";
      const tooEmpty = page.fill.net < minNetFill && !naturalEnd
        && (minimumLineHeight === null || bottomGap >= 2 * minimumLineHeight);
      const tooLowOnPage = page.fill.topGap > maxTopGap;
      const measurements = [
        { name: "net-fill", value: page.fill.net, unit: "fill ratio", operator: "<" as const, threshold: minNetFill },
        { name: "top-gap", value: page.fill.topGap, unit: "fill ratio", operator: ">" as const, threshold: maxTopGap },
        { name: "bottom-space", value: bottomGap, unit: "CSS px", operator: null, threshold: null },
        { name: "minimum-recorded-line-height", value: minimumLineHeight, unit: "CSS px", operator: null, threshold: null },
        { name: "natural-document-end", value: naturalEnd, unit: null, operator: null, threshold: null },
        { name: "outgoing-paginator-break", value: page.outgoingBreakCause.kind, unit: null, operator: null, threshold: null },
      ];
      if (tooEmpty && !tooLowOnPage && page.outgoingBreakCause.kind === "forced") {
        notMeasured.push(declined({ scope: "page", ruleId: "layout/half-empty-page", reason: "env/forced-break" }));
        evaluations.push(targetEvaluation({ ruleId: "layout/half-empty-page", keyType: "page", nodeKey: page.nodeKey,
          sid: null, boxScreen: page.contentBox, status: "not-measured", reason: "env/forced-break", measurements }));
        continue;
      }
      measured += 1;
      evaluations.push(targetEvaluation({ ruleId: "layout/half-empty-page", keyType: "page", nodeKey: page.nodeKey, sid: null,
        boxScreen: page.contentBox, status: "measured", measurements, connective: "any", violated: tooEmpty || tooLowOnPage }));
      if (!tooEmpty && !tooLowOnPage) continue;

      const key = pageKey({
        firstSemanticBlockKey: page.firstSemanticBlockKey,
        pageOrdinal: page.pageNumber,
      });

      const value = tooLowOnPage ? page.fill.topGap : page.fill.net;
      const threshold = tooLowOnPage ? maxTopGap : minNetFill;
      const what = tooLowOnPage
        ? `starts ${(page.fill.topGap * 100).toFixed(1)} % down the content box; threshold ${(maxTopGap * 100).toFixed(0)} %`
        : `has ${(page.fill.net * 100).toFixed(1)} % glyph/visual-band coverage; threshold ${(minNetFill * 100).toFixed(0)} %`;

      findings.push(
        makeFinding({
          ctx,
          ruleId: "layout/half-empty-page",
          // Severity stays `warn` on the record; the tail-page case is expressed by the message
          // and by `experimental`, because a rule may not emit a severity it did not declare.
          severity: "warn",
          experimental: true,
          message:
            `Page ${page.pageNumber} ${what}. Bottom space: ${bottomGap.toFixed(2)} CSS px` +
            (minimumLineHeight === null ? "; recorded line height unavailable." : `; smallest recorded line height: ${minimumLineHeight.toFixed(2)} CSS px.`) +
            ` Paginator ending: ${page.outgoingBreakCause.kind} (${page.outgoingBreakCause.determinedBy}).` +
            " The avoidable cause and author intent are unknown. Experimental: glyph/visual-band coverage is not line-box occupancy.",
          page: page.pageNumber,
          keyType: "page",
          key: key.key,
          nodeKey: page.nodeKey,
          sid: null,
          boxScreen: page.contentBox,
          source: null,
          value,
          threshold,
          unit: "fill ratio",
          ambiguity: key.ambiguous ? { groupSize: 2, resolvable: false } : null,
        }),
      );
    }
    return { findings, candidates, measured, notMeasured, evaluations };
  },
);
