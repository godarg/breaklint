import { defineRule } from "../../core/rule.ts";
import { blockKey } from "../../core/fingerprint.ts";
import { declined, layoutOutOfScope, makeFinding, num, pageByNumber, sourceOf, targetEvaluation } from "../shared.ts";

/**
 * layout/hyphen-across-page — a word was hyphenated across a page boundary.
 *
 * Detection is by the paginator's own class (`pagedjs_hyphen`, recorded per block as
 * `boundaryHyphen`, on the block or an inline element in it), never by comparing characters. The hyphen glyph is
 * configurable, so a character comparison would miss a document that changed it and would fire
 * on a compound word that legitimately ends a line with a hyphen ("Ein- und Ausgang"). The
 * class says the paginator did it; the character says nothing about who did.
 *
 * Paged.js 0.4.3 sets the class when the characters on both sides of its split are word
 * characters OR soft hyphens (`hyphenateAtBreak`, src/chunker/layout.js). The earlier advice
 * therefore recommended its own finding: "insert soft hyphens" re-creates the class when the
 * page ends at one, and `hyphens: manual` is the value under which soft hyphens break. Measured
 * and pinned by tests/live/fragmentation-levers.test.ts, with the word-local levers as controls.
 *
 * Precedence with `type/excessive-word-spacing`: that rule owns the block-level `hyphens` setting
 * and the soft hyphens of justified blocks, because word spacing touches every line of the block
 * and a boundary hyphen touches one word. In a justified block this advice changes only the
 * boundary word. Both levers are declared on both rules in `remediation.interactions`, and the
 * registry test refuses a one-sided pair.
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
    remediation: {
      advice:
        "The last text line on a page ends in a hyphen that breaks a word across the page boundary. The rule reads the paginator's own hyphenation class, so it only reports a hyphen Paged.js introduced — a hard hyphen you typed is not reported. Paged.js marks a page split that falls inside a word, and a split right after a soft hyphen counts as one: do not insert soft hyphens ('&shy;') to cure this finding, and do not rely on 'hyphens: manual', under which soft hyphens still break. In justified text 'type/excessive-word-spacing' owns the block-level 'hyphens' setting and where soft hyphens go, so change only the boundary word there: wrap it in '<span style=\"hyphens: none\">' or 'white-space: nowrap', or reword slightly. In a block that is not justified, 'hyphens: none' on the paragraph is the direct fix.",
      interactions: [
        { ruleId: "type/excessive-word-spacing", lever: "hyphens", relation: "defers", scope: "justified" },
        { ruleId: "type/excessive-word-spacing", lever: "soft-hyphen", relation: "defers", scope: "justified" },
      ],
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

      // Recorded by the collector (Snapshot 5): the class on the block or on an inline element
      // inside it. Paged.js marks the parent of the text node it cut, so a word cut inside `<em>`
      // carries the class on the `<em>`, and the block's own classes missed it.
      const occurrences = block.boundaryHyphen ? 1 : 0;
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
