import { defineRule } from "../../core/rule.ts";
import { blockKey } from "../../core/fingerprint.ts";
import {
  closingOwnLines, declined, fragmentNeighbours, isBlockContainer, layoutOutOfScope, lineOwnership, makeFinding, num, openingOwnLines, pageByNumber, sourceOf, targetEvaluation,
} from "../shared.ts";

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
 * runs no violation occurred". At `widows: 6; orphans: 6` a 9-line paragraph with room for 8
 * splits 6+3, which *is* a violation — a permitted one, because widows+orphans = 12 > 9 lines and
 * no conforming split exists. A run that fails to produce a case has not shown the case does not
 * exist. That split is now pinned by tests/live/fragmentation-levers.test.ts.
 *
 * The property is not inert, and the advice must not say it is. Paged.js 0.4.3 never reads it,
 * but it splits pages where the browser's own column fragmentation breaks, and Chromium applies
 * `widows` there: over one geometry, `widows` 1, initial and 5 split 8+1, 7+2 and 4+5. An
 * earlier version of the advice called it "ignored by Paged.js" without asking the browser.
 *
 * The threshold is the element's own computed `widows`, never a constant of ours. A checker
 * that substitutes its own number for the author's instruction is measuring its own taste.
 *
 * And it is judged against the lines that value governs: the run of the block's own container's
 * line boxes that the break split (`lineOwnership`, `openingOwnLines`). A `<section>` around a
 * paragraph records the paragraph's lines too; counting them judged the paragraph by the section's
 * value.
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
    declines: ["env/multicolumn", "env/vertical-writing", "env/forced-break", "env/invalid-measurement"],
    remediation: {
      advice:
        "A block fragments across a page break and the fragment OPENING the next page carries fewer lines than the block's own 'widows' value (plus any configured extra lines) asks for. Chromium applies a paragraph's 'widows' and 'orphans' when Paged.js splits it; when the paragraph has too few lines at the break to satisfy both, the browser keeps 'orphans' and relaxes 'widows', as CSS Fragmentation Level 3 permits, so this rule is only a warning. Changing the block's 'widows' moves the threshold with it and is not a fix. For paragraphs, keep the block together with 'break-inside: avoid', force an earlier break with 'break-before: page', or reword/re-space the text. If this occurs inside a table row, keep the row together with 'tr { break-inside: avoid; }'.",
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
    // Block containers: `widows` and `orphans` govern a container's line boxes.
    const ownership = lineOwnership(snapshot, { containers: true });
    const neighbours = fragmentNeighbours(snapshot);

    for (const block of snapshot.blocks) {
      // Only continuation fragments can carry a widow: the first fragment of a block has no
      // predecessor on the previous page, so the question does not arise.
      if (block.fragmentIndex === 0 || block.fragmentCount < 2) continue;
      candidates += 1;

      const outOfScope = layoutOutOfScope(block.effectiveStyle);
      if (outOfScope) {
        notMeasured.push(declined({ scope: "block", ruleId: "layout/widow", reason: outOfScope }));
        evaluations.push(targetEvaluation({ ruleId: "layout/widow", keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "not-measured", reason: outOfScope }));
        continue;
      }
      const page = pageByNumber(snapshot, block.page);
      // A page the author forced is a decision, not an overflow. Judging the line count of a
      // fragment that starts after a deliberate break would report the author's own intent.
      if (page?.incomingBreakCause.kind === "forced") {
        notMeasured.push(declined({ scope: "block", ruleId: "layout/widow", reason: "env/forced-break" }));
        evaluations.push(targetEvaluation({ ruleId: "layout/widow", keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "not-measured", reason: "env/forced-break" }));
        continue;
      }
      const owned = ownership(block);
      // A `display: contents` or inline record is no block container (`isBlockContainer`, which
      // agrees with `renderingOf`). Where a recorded block around it holds its lines, that block
      // is judged and this record owns none. Where none does, its lines belong to a container the
      // snapshot does not record, and judging them by this element's own value would judge the
      // wrong container: declined.
      if (!isBlockContainer(snapshot, block) && owned.lines.some((entry) => entry.owned)) {
        notMeasured.push(declined({ scope: "block", ruleId: "layout/widow", reason: "env/invalid-measurement" }));
        evaluations.push(targetEvaluation({ ruleId: "layout/widow", keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "not-measured", reason: "env/invalid-measurement" }));
        continue;
      }
      measured += 1;

      // The lines of this block's own container that the break split — the run that opens the
      // fragment — never those of a block nested in it: a wrapper judged by its own value against
      // its paragraphs' lines reported a split the author had asked for (see `lineOwnership`). A
      // nested block is a candidate of its own. For a block without nested blocks this is every
      // line of the fragment, as before.
      const lines = openingOwnLines(owned);
      const delegated = owned.delegated;
      // And only a run the break SPLIT: the own run must continue on the other side. When
      // the fragment before it ends with a nested block's line, this run is complete — a wrapper's own
      // line followed by a paragraph that moved whole was reported as a split it never was.
      // Unjoinable fragments (no source id) keep the one-sided count, and the measurement says so.
      const side = neighbours(block);
      const otherSide = side.previous ? closingOwnLines(ownership(side.previous)) : null;
      const applicable = lines > 0 && (otherSide === null || otherSide > 0);
      const required = block.effectiveStyle.widows + num(ctx.options.extraLines, 0);
      const violated = applicable && lines < required && required > 1;
      evaluations.push(targetEvaluation({
        ruleId: "layout/widow", keyType: "block", nodeKey: block.nodeKey, sid: block.sid,
        fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "measured",
        measurements: [
          { name: "widow-applicable-opening-lines", value: applicable, unit: null, operator: "=", threshold: true },
          { name: "opening-fragment-lines", value: lines, unit: "lines", operator: "<", threshold: required },
          { name: "widows-requirement-exceeds-one", value: required, unit: "lines", operator: ">", threshold: 1 },
          { name: "opening-fragment-lines-of-nested-blocks", value: delegated, unit: "lines", operator: null, threshold: null },
          { name: "previous-fragment-closing-lines", value: otherSide, unit: "lines", operator: null, threshold: null },
        ],
        connective: "all",
        violated,
      }));
      // A fragment with no visible text line has no text to strand. Found by the corpus
      // cross-check: without this the rule reports "0 lines" on a fragment carrying only a
      // figure or an image — a false alarm on every document that splits around a picture. A
      // fragment that meets the break with a nested block's line has no run of its own there.
      if (!applicable) continue;
      // The element's own widows value, plus an offset a stricter house style may add. The
      // offset also makes the threshold injectable, which is what lets the mutation guard move
      // it — a threshold buried in a comparison cannot be mutated, and a mutant that changes
      // nothing survives without proving anything.
      if (lines >= required || required <= 1) continue;

      findings.push(
        makeFinding({
          ctx,
          ruleId: "layout/widow",
          severity: "warn",
          message:
            `${lines} line${lines === 1 ? " of this block continues" : "s of this block continue"} onto page ${block.page}; ` +
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
    return { findings, candidates, measured, notMeasured, evaluations };
  },
);
