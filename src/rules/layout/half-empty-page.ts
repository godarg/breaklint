import { defineRule } from "../../core/rule.ts";
import { pageKey } from "../../core/fingerprint.ts";
import { declined, makeFinding, num, targetEvaluation } from "../shared.ts";

/**
 * layout/half-empty-page — a page carries far less content than it could.
 *
 * Four things about this rule are worth more than the rule itself.
 *
 * First, what is measured. `verticalFill` — the span from the top of the content box to the
 * lowest band — is *not* the threshold quantity, because it measures where the content is, not
 * how much there is. Measured: a page holding a single absolutely positioned line at the foot
 * reads 0.992, and the same line at the head reads 0.056. Identical content, a spread of 0.936.
 * The threshold quantity is `netFill`, the summed height of semantic bands.
 *
 * Second, why this rule is experimental and therefore never moves an exit code. netFill sums the
 * glyph boxes of text runs (plus replaced elements), not their line boxes: half-leading and
 * block margins never count. So a page no line more would fit on reads roughly glyph height over
 * line pitch, and that depends on the font and the leading. There is no ceiling, in the code or
 * in the measurements: full, non-last prose pages at `line-height: 1.5` read 0.58–0.72 with this
 * collector — 0.69–0.72 for one long paragraph, 0.58–0.63 with 1 em paragraph margins, six of
 * sixteen such pages below the 0.60 threshold — and a full page reads 0.51–0.54 at 2 and
 * 0.34–0.36 at 3 (12 pt on A5 and 11 pt on A4). The 0.686 this comment used to call "the
 * measured ceiling" is a single reading whose conditions were never recorded, not a bound. A
 * threshold that full pages straddle cannot gate, so it does not.
 *
 * Third, since 0.6.0 this rule is not active in the default profile. Measured on a 40-document
 * corpus built to exercise it, it fired on 37 of them — most of those are pages a reader calls
 * full, because of the glyph-box quantity above. Registration is not activation: the id, the
 * options and the schema entry are unchanged, and `profile: "strict"`, `rules: {
 * "layout/half-empty-page": true }` or `--only` each turn it back on. See OFF_BY_DEFAULT_RULE_IDS
 * in src/config/contract.ts.
 *
 * Fourth, the last page. It is not exempted wholesale — that would hide a real defect on the one
 * page most likely to have one. Its finding keeps `warn`, because a rule may not emit a severity
 * it did not declare; the message says the page is likely intended, and only when it also carries
 * no continuation fragment and was not reached by a forced break.
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
    remediation: {
      advice:
        "This rule fires on either of two quantities: the page's net fill ratio fell below the uncalibrated threshold, or its content starts more than half a page down. Read the finding's measurement to see which. If the page naturally concludes a section, chapter or document, either is expected and may be disregarded. If unintended: for low fill, check whether a following block forced an early break with 'break-before: page' or an oversized 'break-inside: avoid' container; for a late start, look for a leading margin, an empty block or a float above the first line.",
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
      measured += 1;

      const tooEmpty = page.fill.net < minNetFill;
      const tooLowOnPage = page.fill.topGap > maxTopGap;
      evaluations.push(targetEvaluation({ ruleId: "layout/half-empty-page", keyType: "page", nodeKey: page.nodeKey, sid: null, boxScreen: page.contentBox, status: "measured", measurements: [{ name: "net-fill", value: page.fill.net, unit: "fill ratio", operator: "<", threshold: minNetFill }, { name: "top-gap", value: page.fill.topGap, unit: "fill ratio", operator: ">", threshold: maxTopGap }], connective: "any", violated: tooEmpty || tooLowOnPage }));
      if (!tooEmpty && !tooLowOnPage) continue;

      // The last page of a document is usually short on purpose. Noted in the message, neither
      // suppressed nor downgraded — and only when nothing continues onto it and no forced break
      // put it there.
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
            " Experimental: net fill sums the glyph boxes of text, not its line boxes, so a page a " +
            "reader calls full can read below this threshold.",
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
