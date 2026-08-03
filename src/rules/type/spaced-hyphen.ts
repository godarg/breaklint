import { defineRule } from "../../core/rule.ts";
import { blockKey } from "../../core/fingerprint.ts";
import { makeFinding, sourceOf } from "../shared.ts";
import { isExcludedRun, pageOfBlock } from "./shared-type.ts";

/** Space, U+002D, space. Not an en dash, not an em dash — the character that is wrong here. */
const SPACED_HYPHEN = / - /gu;

/**
 * type/spaced-hyphen — a hyphen used with spaces around it, where a dash belongs.
 *
 * Permanently a warning. The German orthography ruleset distinguishes the hyphen from the dash
 * by *function*, and a minus sign in `x - y = 0` is neither. About that case the ruleset says
 * nothing at all, so the rule cannot claim a norm covers it.
 *
 * The mathematical exclusion below is a neighbourhood test with a window of ±12 characters.
 * That window is chosen and unmeasured; no corpus of real prose stands behind it. It says so in
 * the rule documentation rather than only here.
 */
export const spacedHyphen = defineRule(
  {
    id: "type/spaced-hyphen",
    severity: "warn",
    proofSource: null,
    calibrated: false,
    experimental: false,
    unit: "occurrences",
    defaultOptions: { locale: "de-DE", mathWindow: 12, maxOccurrences: 0, excludeSelectors: [] },
    summary: "A hyphen stands between spaces where the convention asks for a dash.",
    declines: [],
  },
  (snapshot, ctx) => {
    const findings = [];
    let candidates = 0;
    let measured = 0;
    const locale = String(ctx.options.locale ?? "de-DE");
    const windowSize = Number(ctx.options.mathWindow ?? 12);
    const extra = (ctx.options.excludeSelectors as readonly string[] | undefined) ?? [];

    for (const run of snapshot.textRuns) {
      candidates += 1;
      // An excluded run is not "not measured" — it is not a candidate for this rule at all.
      // Counting it as declined would make coverage look worse than it is.
      if (isExcludedRun(run, locale, extra)) {
        candidates -= 1;
        continue;
      }
      measured += 1;

      let hits = 0;
      let firstContext = "";
      for (const match of run.text.matchAll(SPACED_HYPHEN)) {
        const at = match.index ?? 0;
        const around = run.text.slice(Math.max(0, at - windowSize), at + windowSize + 3);
        if (looksMathematical(around)) continue;
        hits += 1;
        if (!firstContext) firstContext = around.trim();
      }
      const permitted = Number(ctx.options.maxOccurrences ?? 0);
      if (hits <= permitted) continue;

      const block = snapshot.blocks.find((b) => b.nodeKey === run.blockKey);
      findings.push(
        makeFinding({
          ctx,
          ruleId: "type/spaced-hyphen",
          severity: "warn",
          message:
            `occurrences: ${hits} (permitted: ${permitted}). text: "${firstContext}". The hyphen always has ` +
            `contact with letters; the dash has neither contact nor the same length. A hyphen ` +
            `surrounded by spaces is neither. Heuristic: mathematical use is excluded by a ` +
            `chosen ±${windowSize}-character window.`,
          page: pageOfBlock(snapshot, run.blockKey),
          keyType: "block",
          key: blockKey({
            authorId: block?.authorId ?? null,
            blockSignature: block?.blockSignature ?? run.text,
          }),
          nodeKey: run.blockKey,
          sid: block?.sid ?? null,
          boxScreen: block?.box ?? null,
          source: sourceOf(snapshot, block?.sid ?? null),
          value: hits,
          threshold: permitted,
          unit: "occurrences",
        }),
      );
    }
    return { findings, candidates, measured, notMeasured: [] };
  },
);

/** A digit next to the hyphen, an operator nearby, or two single letters joined by one. */
function looksMathematical(around: string): boolean {
  if (/[=<>±×÷∓≤≥≠]/u.test(around)) return true;
  if (/\d\s+-\s+|\s+-\s+\d/u.test(around)) return true;
  if (/(^|\W)[A-Za-z]\s+-\s+[A-Za-z](\W|$)/u.test(around)) return true;
  return false;
}
