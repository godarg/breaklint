import { defineRule } from "../../core/rule.ts";
import { blockKey } from "../../core/fingerprint.ts";
import { declined, layoutOutOfScope, linesOfBlock, makeFinding, num, sourceOf, targetEvaluation } from "../shared.ts";

/**
 * type/excessive-word-spacing — justification has pulled the word gaps far apart.
 *
 * Only in justified blocks, and only where the author has not set `word-spacing` themselves —
 * there the width is a stated intention, not an accident of the algorithm. Table cells are out
 * for the same reason as narrow columns: a justified cell has no room to do better.
 *
 * Word boxes are held for every line of every justified block. An earlier version limited them
 * to a window around page boundaries, which contradicted the rule that needs them; the cost of
 * keeping them all was measured at 4 221 bytes per page, about 8 MiB over 2 000 pages, and that
 * is affordable. The limit was not a trade-off, it was an unmeasured assumption.
 */
export const excessiveWordSpacing = defineRule(
  {
    id: "type/excessive-word-spacing",
    severity: "warn",
    proofSource: null,
    calibrated: false,
    experimental: false,
    unit: "× natural space",
    defaultOptions: { maxSpaceFactor: 3.0 },
    summary: "Word gaps in a justified block are far wider than the natural space.",
    declines: ["env/multicolumn", "env/vertical-writing"],
  },
  (snapshot, ctx) => {
    const findings = [];
    const notMeasured = [];
    const evaluations = [];
    let candidates = 0;
    let measured = 0;
    const maxFactor = num(ctx.options.maxSpaceFactor, 3.0);

    for (const block of snapshot.blocks) {
      if (!/justify/u.test(block.effectiveStyle.textAlign)) continue;
      // An explicit word-spacing is a decision. Reporting it back is reporting the author.
      const ws = block.effectiveStyle.wordSpacing.trim();
      if (ws && ws !== "normal" && ws !== "0px") continue;
      if (block.tag.toLowerCase() === "td" || block.tag.toLowerCase() === "th") continue;
      if (block.spaceWidth <= 0) continue;
      candidates += 1;

      const outOfScope = layoutOutOfScope(block.effectiveStyle);
      if (outOfScope) {
        notMeasured.push(declined({ scope: "block", ruleId: "type/excessive-word-spacing", reason: outOfScope }));
        evaluations.push(targetEvaluation({ ruleId: "type/excessive-word-spacing", keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "not-measured", reason: outOfScope }));
        continue;
      }
      measured += 1;

      let worst = 0;
      let worstLine = 0;
      for (const line of linesOfBlock(snapshot, block.nodeKey)) {
        const boxes = line.wordBoxes;
        if (!boxes || boxes.length < 2) continue;
        for (let i = 1; i < boxes.length; i += 1) {
          const prev = boxes[i - 1];
          const cur = boxes[i];
          if (!prev || !cur) continue;
          const gap = cur.x - (prev.x + prev.width);
          if (gap <= 0) continue;
          const factor = gap / block.spaceWidth;
          if (factor > worst) {
            worst = factor;
            worstLine = line.index;
          }
        }
      }
      evaluations.push(targetEvaluation({ ruleId: "type/excessive-word-spacing", keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "measured", measurements: [{ name: "largest-word-gap-factor", value: worst, unit: "× natural space", operator: ">", threshold: maxFactor }], violated: worst > maxFactor }));
      if (worst <= maxFactor) continue;

      findings.push(
        makeFinding({
          ctx,
          ruleId: "type/excessive-word-spacing",
          severity: "warn",
          message:
            `Line ${worstLine} of this justified block has a word gap of ${worst.toFixed(2)}× the ` +
            `natural space; threshold ${maxFactor.toFixed(1)}×. Heuristic: the threshold is a ` +
            `chosen default. Hyphenation usually fixes this.`,
          page: block.page,
          keyType: "block",
          key: blockKey({ authorId: block.authorId, blockSignature: block.blockSignature }),
          nodeKey: block.nodeKey,
          sid: block.sid,
          fragmentIndex: block.fragmentIndex,
          boxScreen: block.box,
          source: sourceOf(snapshot, block.sid),
          value: Number(worst.toFixed(4)),
          threshold: maxFactor,
          unit: "× natural space",
        }),
      );
    }
    return { findings, candidates, measured, notMeasured, evaluations };
  },
);
