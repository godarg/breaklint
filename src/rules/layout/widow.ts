import { defineRule } from "../../core/rule.ts";
import { blockKey } from "../../core/fingerprint.ts";
import { declined, layoutOutOfScope, linesOfBlock, makeFinding, num, pageByNumber, sourceOf } from "../shared.ts";

/**
 * layout/widow — the opening fragment of a block carries fewer lines than the author asked for.
 *
 * This rule is a warning, and it can never be an error. Not because the norm is vague, but
 * because CSS Fragmentation Level 3 §4.3 says in as many words that rule 3 — the widow/orphan
 * rule — *is dropped* when keeping it would leave too few break points. So `lines < widows`
 * does not prove a defect on its own; it may be exactly the relaxation the specification
 * permits. To call it an error this rule would have to prove the relaxation was not warranted,
 * and it has no way to do that.
 *
 * The earlier justification for the downgrade was worse than wrong, it was unmeasured: "in 230
 * runs no violation occurred". At `widows: 6` the same layout produces 6+3, which *is* a
 * violation — a permitted one, because with 9 lines and widows+orphans = 12 no conforming
 * split exists. A run that fails to produce a case has not shown the case does not exist.
 *
 * The threshold is the element's own computed `widows`, never a constant of ours. A checker
 * that substitutes its own number for the author's instruction is measuring its own taste.
 */
export const widow = defineRule(
  {
    id: "layout/widow",
    severity: "warn",
    proofSource: null,
    calibrated: false,
    experimental: false,
    unit: "lines",
    defaultOptions: { extraLines: 0 },
    summary: "The first fragment of a block on a page has fewer lines than its own widows value.",
    declines: ["env/multicolumn", "env/vertical-writing", "env/forced-break"],
  },
  (snapshot, ctx) => {
    const findings = [];
    const notMeasured = [];
    let candidates = 0;
    let measured = 0;

    for (const block of snapshot.blocks) {
      // Only continuation fragments can carry a widow: the first fragment of a block has no
      // predecessor on the previous page, so the question does not arise.
      if (block.fragmentIndex === 0 || block.fragmentCount < 2) continue;
      candidates += 1;

      const outOfScope = layoutOutOfScope(block.effectiveStyle);
      if (outOfScope) {
        notMeasured.push(declined({ scope: "block", ruleId: "layout/widow", reason: outOfScope }));
        continue;
      }
      const page = pageByNumber(snapshot, block.page);
      // A page the author forced is a decision, not an overflow. Judging the line count of a
      // fragment that starts after a deliberate break would report the author's own intent.
      if (page?.incomingBreakCause.kind === "forced") {
        notMeasured.push(declined({ scope: "block", ruleId: "layout/widow", reason: "env/forced-break" }));
        continue;
      }
      measured += 1;

      const lines = linesOfBlock(snapshot, block.nodeKey).length;
      // A fragment with no visible text line has no text to strand. Found by the corpus
      // cross-check: without this the rule reports "0 lines" on a fragment carrying only a
      // figure or an image — a false alarm on every document that splits around a picture.
      if (lines === 0) continue;
      // The element's own widows value, plus an offset a stricter house style may add. The
      // offset also makes the threshold injectable, which is what lets the mutation guard move
      // it — a threshold buried in a comparison cannot be mutated, and a mutant that changes
      // nothing survives without proving anything.
      const required = block.effectiveStyle.widows + num(ctx.options.extraLines, 0);
      if (lines >= required || required <= 1) continue;

      findings.push(
        makeFinding({
          ctx,
          ruleId: "layout/widow",
          severity: "warn",
          message:
            `${lines} line${lines === 1 ? "" : "s"} of this block continue onto page ${block.page}; ` +
            `its own widows value asks for ${required}. Heuristic: CSS Fragmentation Level 3 ` +
            `permits this relaxation when no conforming split exists.`,
          page: block.page,
          keyType: "block",
          key: blockKey({ authorId: block.authorId, blockSignature: block.blockSignature }),
          nodeKey: block.nodeKey,
          sid: block.sid,
          fragmentIndex: block.fragmentIndex,
          boxScreen: block.box,
          source: sourceOf(snapshot, block.sid),
          value: lines,
          threshold: required,
          unit: "lines",
        }),
      );
    }
    return { findings, candidates, measured, notMeasured };
  },
);
