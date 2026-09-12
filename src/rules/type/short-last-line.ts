import { defineRule } from "../../core/rule.ts";
import { blockKey } from "../../core/fingerprint.ts";
import { declined, layoutOutOfScope, linesOfBlock, makeFinding, num, sourceOf, targetEvaluation } from "../shared.ts";

/**
 * type/short-last-line — a paragraph ends on a stub of a line.
 *
 * Both conditions have to hold: below a share of the paragraph width *and* below two ems in
 * absolute terms. The relative test alone fires on narrow columns where a short last line is
 * unavoidable; the absolute test alone fires on wide measures where a 15 % line is still a
 * perfectly good line.
 *
 * Three exclusions, each for a reason rather than for tidiness: a single-line paragraph has no
 * last line in the relevant sense, centred text is set that way on purpose, and the last
 * fragment of a split block continues on the next page, so its "last" line is not one.
 */
export const shortLastLine = defineRule(
  {
    id: "type/short-last-line",
    severity: "warn",
    proofSource: null,
    calibrated: false,
    experimental: false,
    unit: "width ratio",
    defaultOptions: { maxWidthRatio: 0.15, maxEms: 2 },
    summary: "The closing line of a paragraph is a stub.",
    declines: ["env/multicolumn", "env/vertical-writing", "env/invalid-measurement"],
  },
  (snapshot, ctx) => {
    const findings = [];
    const notMeasured = [];
    const evaluations = [];
    let candidates = 0;
    let measured = 0;
    const maxRatio = num(ctx.options.maxWidthRatio, 0.15);
    const maxEms = num(ctx.options.maxEms, 2);

    for (const block of snapshot.blocks) {
      if (block.tag.toLowerCase() !== "p") continue;
      if (/center/u.test(block.effectiveStyle.textAlign)) continue;
      // A fragment with a successor does not end here; its last line is a page boundary.
      if (block.fragmentCount > 1 && block.fragmentIndex < block.fragmentCount - 1) continue;

      const lines = linesOfBlock(snapshot, block.nodeKey);
      if (lines.length < 2) continue;
      candidates += 1;

      const outOfScope = layoutOutOfScope(block.effectiveStyle);
      if (outOfScope) {
        notMeasured.push(declined({ scope: "block", ruleId: "type/short-last-line", reason: outOfScope }));
        evaluations.push(targetEvaluation({ ruleId: "type/short-last-line", keyType: "block", nodeKey: block.nodeKey, sid: block.sid, fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "not-measured", reason: outOfScope }));
        continue;
      }
      const last = lines[lines.length - 1];
      const lineWidthValid = last !== undefined && Number.isFinite(last.width) && last.width >= 0;
      const paragraphWidthValid = Number.isFinite(block.box.width) && block.box.width > 0;
      const fontSizeValid = Number.isFinite(block.effectiveStyle.fontSize) && block.effectiveStyle.fontSize > 0;
      if (!lineWidthValid || !paragraphWidthValid || !fontSizeValid) {
        // A malformed projection is a declined measurement, never a clean numeric decision. In
        // particular, Infinity would silently become JSON null and could otherwise look safe.
        notMeasured.push(declined({ scope: "block", ruleId: "type/short-last-line", reason: "env/invalid-measurement" }));
        evaluations.push(targetEvaluation({
          ruleId: "type/short-last-line", keyType: "block", nodeKey: block.nodeKey, sid: block.sid,
          fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "not-measured", reason: "env/invalid-measurement",
          measurements: [
            { name: "last-line-width-finite", value: lineWidthValid, unit: null, operator: "=", threshold: true },
            { name: "paragraph-width-finite-positive", value: paragraphWidthValid, unit: null, operator: "=", threshold: true },
            { name: "font-size-finite-positive", value: fontSizeValid, unit: null, operator: "=", threshold: true },
          ],
          connective: "all", violated: null,
        }));
        continue;
      }
      measured += 1;
      const ratio = last.width / block.box.width;
      const ems = last.width / block.effectiveStyle.fontSize;
      const violated = ratio < maxRatio && ems < maxEms;
      evaluations.push(targetEvaluation({
        ruleId: "type/short-last-line", keyType: "block", nodeKey: block.nodeKey, sid: block.sid,
        fragmentIndex: block.fragmentIndex, boxScreen: block.box, status: "measured",
        measurements: [
          { name: "last-line-width-ratio", value: ratio, unit: "ratio", operator: "<", threshold: maxRatio },
          { name: "last-line-width", value: ems, unit: "em", operator: "<", threshold: maxEms },
        ], connective: "all", violated,
      }));
      if (!violated) continue;

      findings.push(
        makeFinding({
          ctx,
          ruleId: "type/short-last-line",
          severity: "warn",
          message:
            `The closing line fills ${(ratio * 100).toFixed(1)} % of the paragraph width ` +
            `(${ems.toFixed(2)} em); thresholds ${(maxRatio * 100).toFixed(0)} % and ${maxEms} em. ` +
            `Heuristic: both are chosen defaults.`,
          page: block.page,
          keyType: "block",
          key: blockKey({ authorId: block.authorId, blockSignature: block.blockSignature }),
          nodeKey: block.nodeKey,
          sid: block.sid,
          fragmentIndex: block.fragmentIndex,
          boxScreen: last.box,
          source: sourceOf(snapshot, block.sid),
          value: Number(ratio.toFixed(4)),
          threshold: maxRatio,
          unit: "width ratio",
        }),
      );
    }
    return { findings, candidates, measured, notMeasured, evaluations };
  },
);
