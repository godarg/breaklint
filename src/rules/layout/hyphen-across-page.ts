import { defineRule } from "../../core/rule.ts";
import { blockKey } from "../../core/fingerprint.ts";
import { declined, layoutOutOfScope, makeFinding, num, pageByNumber, sourceOf, targetEvaluation } from "../shared.ts";

/** The class the paginator sets on a block it hyphenated at a page boundary. */
const PAGEDJS_HYPHEN_CLASS = "pagedjs_hyphen";

/**
 * layout/hyphen-across-page — a word was hyphenated across a page boundary.
 *
 * Detection is by the paginator's own class, never by comparing characters. The hyphen glyph is
 * configurable, so a character comparison would miss a document that changed it and would fire
 * on a compound word that legitimately ends a line with a hyphen ("Ein- und Ausgang"). The
 * class says the paginator did it; the character says nothing about who did.
 */
export const hyphenAcrossPage = defineRule(
  {
    id: "layout/hyphen-across-page",
    severity: "warn",
    proofSource: null,
    calibrated: false,
    experimental: false,
    unit: "occurrences",
    defaultOptions: { maxOccurrences: 0 },
    summary: "A word is split by a hyphen across a page boundary.",
    declines: ["env/multicolumn", "env/vertical-writing"],
  },
  (snapshot, ctx) => {
    const findings = [];
    const notMeasured = [];
    const evaluations = [];
    let candidates = 0;
    let measured = 0;

    for (const block of snapshot.blocks) {
      // Only a fragment that hands over to a following page can hyphenate across one.
      if (block.fragmentCount < 2 || block.fragmentIndex >= block.fragmentCount - 1) continue;
      candidates += 1;

      const outOfScope = layoutOutOfScope(block.effectiveStyle);
      if (outOfScope) {
        notMeasured.push(declined({ scope: "block", ruleId: "layout/hyphen-across-page", reason: outOfScope }));
        evaluations.push(targetEvaluation({ ruleId: "layout/hyphen-across-page", keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "not-measured", reason: outOfScope }));
        continue;
      }
      measured += 1;

      const occurrences = block.classList.includes(PAGEDJS_HYPHEN_CLASS) ? 1 : 0;
      const permitted = num(ctx.options.maxOccurrences, 0);
      evaluations.push(targetEvaluation({ ruleId: "layout/hyphen-across-page", keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "measured", measurements: [{ name: "boundary-hyphens", value: occurrences, unit: "occurrences", operator: ">", threshold: permitted }], violated: occurrences > permitted }));
      if (occurrences <= permitted) continue;
      const page = pageByNumber(snapshot, block.page);

      findings.push(
        makeFinding({
          ctx,
          ruleId: "layout/hyphen-across-page",
          severity: "warn",
          message:
            `A word is hyphenated across the boundary after page ${block.page}` +
            (page ? ` (${page.outgoingBreakCause.kind} break)` : "") +
            `. occurrences: ${occurrences} (permitted: ${permitted}). Heuristic: hyphenating across a page is a ` +
            `convention, not an error.`,
          page: block.page,
          keyType: "block",
          key: blockKey({ authorId: block.authorId, blockSignature: block.blockSignature }),
          nodeKey: block.nodeKey,
          sid: block.sid,
          fragmentIndex: block.fragmentIndex,
          boxScreen: block.box,
          source: sourceOf(snapshot, block.sid),
          value: occurrences,
          threshold: permitted,
          unit: "occurrences",
        }),
      );
    }
    return { findings, candidates, measured, notMeasured, evaluations };
  },
);
