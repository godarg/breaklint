import { defineRule } from "../../core/rule.ts";
import { blockKey } from "../../core/fingerprint.ts";
import { makeFinding, sourceOf, targetEvaluation } from "../shared.ts";
import { isExcludedRun, pageOfBlock } from "./shared-type.ts";

/**
 * type/straight-quotes — a typewriter quote in typeset German prose.
 *
 * A warning and nothing stronger, because the same characters are legitimate as the inch mark
 * and the arc minute. A digit immediately before the character is therefore not a finding —
 * `Ein 5" Bildschirm` is correct and stays quiet.
 */
export const straightQuotes = defineRule(
  {
    id: "type/straight-quotes",
    severity: "warn",
    proofSource: null,
    calibrated: false,
    experimental: false,
    unit: "occurrences",
    defaultOptions: { locale: "de-DE", maxOccurrences: 0, excludeTags: [] },
    summary: "A straight quotation mark or apostrophe appears in typeset prose.",
    declines: [],
  },
  (snapshot, ctx) => {
    const findings = [];
    const evaluations = [];
    let candidates = 0;
    let measured = 0;
    const locale = String(ctx.options.locale ?? "de-DE");
    const extra = (ctx.options.excludeTags as readonly string[] | undefined) ?? [];

    for (const [runIndex, run] of snapshot.textRuns.entries()) {
      candidates += 1;
      if (isExcludedRun(run, locale, extra)) {
        candidates -= 1;
        evaluations.push(targetEvaluation({ ruleId: "type/straight-quotes", keyType: "block", nodeKey: run.blockKey, sid: null, occurrenceKey: String(runIndex), status: "excluded", reason: "configured-or-semantic-text-exclusion" }));
        continue;
      }
      measured += 1;

      let hits = 0;
      let sample = "";
      for (const match of run.text.matchAll(/["']/gu)) {
        const at = match.index ?? 0;
        // Inch and arc minute: a digit immediately before the mark. Nothing else is exempt.
        if (at > 0 && /\d/u.test(run.text[at - 1] ?? "")) continue;
        hits += 1;
        if (!sample) sample = run.text.slice(Math.max(0, at - 20), at + 20).trim();
      }
      const permitted = Number(ctx.options.maxOccurrences ?? 0);
      const block = snapshot.blocks.find((b) => b.nodeKey === run.blockKey);
      evaluations.push(targetEvaluation({ ruleId: "type/straight-quotes", keyType: "block", nodeKey: run.blockKey, sid: block?.sid ?? null, occurrenceKey: String(runIndex), boxScreen: block?.box ?? null, status: "measured", measurements: [{ name: "straight-quote-occurrences", value: hits, unit: "occurrences", operator: ">", threshold: permitted }], violated: hits > permitted }));
      if (hits <= permitted) continue;

      findings.push(
        makeFinding({
          ctx,
          ruleId: "type/straight-quotes",
          severity: "warn",
          message:
            `occurrences: ${hits} (permitted: ${permitted}). text: "${sample}". Heuristic: inch marks and ` +
            `arc minutes are excluded by a preceding digit; a program quotation is not.`,
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
    return { findings, candidates, measured, notMeasured: [], evaluations };
  },
);
