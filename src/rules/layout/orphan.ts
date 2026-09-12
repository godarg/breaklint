import { defineRule } from "../../core/rule.ts";
import { blockKey } from "../../core/fingerprint.ts";
import { declined, layoutOutOfScope, linesOfBlock, makeFinding, num, pageByNumber, sourceOf, targetEvaluation } from "../shared.ts";

/**
 * layout/orphan — the closing lines of a block on a page are fewer than the author asked for.
 *
 * The mirror of layout/widow, and it carries the same permanent ceiling of `warn` for the same
 * reason: the specification drops the rule rather than overflow the fragmentainer, so a
 * violation can be conforming. See docs/rules/layout-orphan.md.
 */
export const orphan = defineRule(
  {
    id: "layout/orphan",
    severity: "warn",
    proofSource: null,
    calibrated: false,
    experimental: false,
    unit: "lines",
    defaultOptions: { extraLines: 0 },
    summary: "The last fragment of a block on a page has fewer lines than its own orphans value.",
    declines: ["env/multicolumn", "env/vertical-writing", "env/forced-break"],
  },
  (snapshot, ctx) => {
    const findings = [];
    const notMeasured = [];
    const evaluations = [];
    let candidates = 0;
    let measured = 0;

    for (const block of snapshot.blocks) {
      // Only a fragment that has a successor can strand lines at the foot of a page.
      if (block.fragmentCount < 2 || block.fragmentIndex >= block.fragmentCount - 1) continue;
      candidates += 1;

      const outOfScope = layoutOutOfScope(block.effectiveStyle);
      if (outOfScope) {
        notMeasured.push(declined({ scope: "block", ruleId: "layout/orphan", reason: outOfScope }));
        evaluations.push(targetEvaluation({ ruleId: "layout/orphan", keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "not-measured", reason: outOfScope }));
        continue;
      }
      const page = pageByNumber(snapshot, block.page);
      if (page?.outgoingBreakCause.kind === "forced") {
        notMeasured.push(declined({ scope: "block", ruleId: "layout/orphan", reason: "env/forced-break" }));
        evaluations.push(targetEvaluation({ ruleId: "layout/orphan", keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "not-measured", reason: "env/forced-break" }));
        continue;
      }
      measured += 1;

      const lines = linesOfBlock(snapshot, block.nodeKey).length;
      const required = block.effectiveStyle.orphans + num(ctx.options.extraLines, 0);
      const violated = lines > 0 && lines < required && required > 1;
      evaluations.push(targetEvaluation({
        ruleId: "layout/orphan", keyType: "block", nodeKey: block.nodeKey, sid: block.sid,
        fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "measured",
        measurements: [
          { name: "orphan-applicable-closing-lines", value: lines > 0, unit: null, operator: "=", threshold: true },
          { name: "closing-fragment-lines", value: lines, unit: "lines", operator: "<", threshold: required },
          { name: "orphans-requirement-exceeds-one", value: required, unit: "lines", operator: ">", threshold: 1 },
        ],
        connective: "all",
        violated,
      }));
      // A fragment with no visible text line has no text to strand. Found by the corpus
      // cross-check: without this the rule reports "0 lines" on a fragment carrying only a
      // figure or an image — a false alarm on every document that splits around a picture.
      if (lines === 0) continue;
      if (lines >= required || required <= 1) continue;

      findings.push(
        makeFinding({
          ctx,
          ruleId: "layout/orphan",
          severity: "warn",
          message:
            `${lines} line${lines === 1 ? "" : "s"} of this block remain at the foot of page ` +
            `${block.page}; its own orphans value asks for ${required}. Heuristic: the ` +
            `specification permits this relaxation when no conforming split exists.`,
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
    return { findings, candidates, measured, notMeasured, evaluations };
  },
);
