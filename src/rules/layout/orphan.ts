import { defineRule } from "../../core/rule.ts";
import { blockKey } from "../../core/fingerprint.ts";
import {
  closingOwnLines, declined, fragmentNeighbours, isBlockContainer, layoutOutOfScope, lineOwnership, makeFinding, num, openingOwnLines, pageByNumber, sourceOf, targetEvaluation,
} from "../shared.ts";

/**
 * layout/orphan — the closing lines of a block on a page are fewer than the author asked for.
 *
 * The mirror of layout/widow, and it carries the same permanent ceiling of `warn` for the same
 * reason: the specification drops the rule rather than overflow the fragmentainer, so a
 * violation can be conforming. See docs/rules/layout-orphan.md.
 *
 * Like `widows`, the property is applied, not inert: Chromium honours it when Paged.js splits a
 * paragraph, and with room for fewer lines than `orphans` it moves the whole paragraph to the
 * next page (pinned by tests/live/fragmentation-levers.test.ts).
 *
 * Like layout/widow it counts only the run of the block's own container's lines that the break
 * split (`lineOwnership`, `closingOwnLines`), so a wrapper is not judged by its own value against
 * its paragraphs' lines.
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
    declines: ["env/multicolumn", "env/vertical-writing", "env/forced-break", "env/invalid-measurement"],
    remediation: {
      advice:
        "A block fragment ENDS at a page break carrying fewer lines than the block's own 'orphans' value (plus any configured extra lines) asks for. Chromium applies a paragraph's 'widows' and 'orphans' when Paged.js splits it, and moves the whole paragraph to the next page when the page has room for fewer lines than 'orphans'; CSS Fragmentation Level 3 still permits a split that keeps fewer, so this rule is only a warning. Changing the block's 'orphans' moves the threshold with it and is not a fix. For paragraphs, move the block onto the next page with 'break-inside: avoid' or 'break-before: page', or reword/re-space the text. If this occurs inside a table row, keep the row together with 'tr { break-inside: avoid; }'.",
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
      const owned = ownership(block);
      // A `display: contents` or inline record is no block container (`isBlockContainer`, which
      // agrees with `renderingOf`). Where a recorded block around it holds its lines, that block
      // is judged and this record owns none. Where none does, its lines belong to a container the
      // snapshot does not record, and judging them by this element's own value would judge the
      // wrong container: declined.
      if (!isBlockContainer(snapshot, block) && owned.lines.some((entry) => entry.owned)) {
        notMeasured.push(declined({ scope: "block", ruleId: "layout/orphan", reason: "env/invalid-measurement" }));
        evaluations.push(targetEvaluation({ ruleId: "layout/orphan", keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "not-measured", reason: "env/invalid-measurement" }));
        continue;
      }
      measured += 1;

      // The lines of this block's own container that the break split — the run that closes the
      // fragment — never those of a block nested in it (see layout/widow and `lineOwnership`).
      const lines = closingOwnLines(owned);
      const delegated = owned.delegated;
      // And only a run the break SPLIT: the own run must continue on the other side. When
      // the fragment after it opens with a nested block's line, this run is complete — a wrapper's own
      // line followed by a paragraph that moved whole was reported as a split it never was.
      // Unjoinable fragments (no source id) keep the one-sided count, and the measurement says so.
      const side = neighbours(block);
      const otherSide = side.next ? openingOwnLines(ownership(side.next)) : null;
      const applicable = lines > 0 && (otherSide === null || otherSide > 0);
      const required = block.effectiveStyle.orphans + num(ctx.options.extraLines, 0);
      const violated = applicable && lines < required && required > 1;
      evaluations.push(targetEvaluation({
        ruleId: "layout/orphan", keyType: "block", nodeKey: block.nodeKey, sid: block.sid,
        fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "measured",
        measurements: [
          { name: "orphan-applicable-closing-lines", value: applicable, unit: null, operator: "=", threshold: true },
          { name: "closing-fragment-lines", value: lines, unit: "lines", operator: "<", threshold: required },
          { name: "orphans-requirement-exceeds-one", value: required, unit: "lines", operator: ">", threshold: 1 },
          { name: "closing-fragment-lines-of-nested-blocks", value: delegated, unit: "lines", operator: null, threshold: null },
          { name: "next-fragment-opening-lines", value: otherSide, unit: "lines", operator: null, threshold: null },
        ],
        connective: "all",
        violated,
      }));
      // A fragment with no visible text line has no text to strand. Found by the corpus
      // cross-check: without this the rule reports "0 lines" on a fragment carrying only a
      // figure or an image — a false alarm on every document that splits around a picture. A
      // fragment that meets the break with a nested block's line has no run of its own there.
      if (!applicable) continue;
      if (lines >= required || required <= 1) continue;

      findings.push(
        makeFinding({
          ctx,
          ruleId: "layout/orphan",
          severity: "warn",
          message:
            `${lines} line${lines === 1 ? " of this block remains" : "s of this block remain"} at the foot of page ` +
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
