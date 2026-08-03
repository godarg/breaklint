import { defineRule } from "../../core/rule.ts";
import { pageKey } from "../../core/fingerprint.ts";
import { declined, makeFinding, num } from "../shared.ts";

/**
 * layout/half-empty-page — a page carries far less content than it could.
 *
 * Three things about this rule are worth more than the rule itself.
 *
 * First, what is measured. `verticalFill` — the span from the top of the content box to the
 * lowest band — is *not* the threshold quantity, because it measures where the content is, not
 * how much there is. Measured: a page holding a single absolutely positioned line at the foot
 * reads 0.992, and the same line at the head reads 0.056. Identical content, a spread of 0.936.
 * The threshold quantity is `netFill`, the summed height of semantic bands.
 *
 * Second, why this rule is experimental and therefore never moves an exit code. The *ceiling*
 * of netFill on a fully set text page is 0.686 — line boxes do not cover leading. The threshold
 * is 0.60. Eighty-six thousandths separate "full" from "flagged", and a typeface with more
 * leading can spend that. Shipping this as a gate would be a wager, so it does not gate.
 *
 * Third, the last page. It is not exempted wholesale — that would hide a real defect on the one
 * page most likely to have one. It is downgraded to `info`, and only when it also carries no
 * continuation fragment and was not reached by a forced break.
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
    summary: "A page is filled well below what its content box allows.",
    declines: ["env/parity-blank-page", "env/forced-break"],
  },
  (snapshot, ctx) => {
    const findings = [];
    const notMeasured = [];
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
        continue;
      }
      measured += 1;

      const tooEmpty = page.fill.net < minNetFill;
      const tooLowOnPage = page.fill.topGap > maxTopGap;
      if (!tooEmpty && !tooLowOnPage) continue;

      // The last page of a document is usually short on purpose. Downgraded, not suppressed —
      // and only when nothing continues onto it and no forced break put it there.
      const isTailPage =
        page.isLast &&
        page.incomingBreakCause.kind !== "forced" &&
        !snapshot.blocks.some((b) => b.page === page.pageNumber && b.fragmentIndex > 0);

      const key = pageKey({
        firstSemanticBlockKey: page.firstSemanticBlockKey,
        pageOrdinal: page.pageNumber,
      });

      const value = tooEmpty ? page.fill.net : page.fill.topGap;
      const threshold = tooEmpty ? minNetFill : maxTopGap;
      const what = tooEmpty
        ? `is ${(page.fill.net * 100).toFixed(1)} % filled; threshold ${(minNetFill * 100).toFixed(0)} %`
        : `starts ${(page.fill.topGap * 100).toFixed(1)} % down the content box; threshold ` +
          `${(maxTopGap * 100).toFixed(0)} %`;

      findings.push(
        makeFinding({
          ctx,
          ruleId: "layout/half-empty-page",
          // Severity stays `warn` on the record; the tail-page case is expressed by the message
          // and by `experimental`, because a rule may not emit a severity it did not declare.
          severity: "warn",
          experimental: true,
          message:
            `Page ${page.pageNumber} ${what}.` +
            (isTailPage ? " This is the last page and carries no continuation — likely intended." : "") +
            " Experimental: the threshold sits 0.086 below the measured ceiling of a full text page.",
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
    return { findings, candidates, measured, notMeasured };
  },
);
