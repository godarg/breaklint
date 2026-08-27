import { defineRule } from "../../core/rule.ts";
import { declined, makeFinding, num } from "../shared.ts";

/**
 * svg/text-clipped — part of a text's glyph ink is cut away by a clip path or a mask.
 *
 * The measurement is a counterfactual, and the reason is worth stating plainly: the obvious
 * approach — ask `isPointInFill` whether the glyph is inside the clip — takes its truth from
 * the same API it is checking. An oracle drawn from the thing under test proves nothing.
 *
 * So the rule compares two rasterisations of the *same* target: `T`, as it stands, and `T0`,
 * with clipping neutralised. `missingInk = (|T0| - |T|) / |T0|`. Nothing else is consulted.
 *
 * Two properties of this measurement were expensive to learn and are load-bearing:
 *
 *   Per target, not per SVG. Under one shared mask the value depends on how much *other* text
 *   stands next to it. Measured on the dilution fixture, a genuine 0.627 collapses to 0.0435 —
 *   below the threshold, so the defect disappears. A threshold on a dilutable quantity is not a
 *   threshold.
 *
 *   Ink is defined against the empty pass, not against an assumed background. The earlier
 *   version compared against white and missed a pale yellow line completely. Later, after
 *   pinning dependencies, a renderer's default background turned out to be (18, 18, 18) rather
 *   than white — a comparison against an assumed background is not robust across an update.
 */
export const textClipped = defineRule(
  {
    id: "svg/text-clipped",
    severity: "warn",
    proofSource: null,
    calibrated: false,
    experimental: false,
    unit: "missing ink ratio",
    defaultOptions: { maxMissingInk: 0.05 },
    summary: "Part of a text's glyph ink is removed by a clip path or mask.",
    declines: [
      "env/svg-not-inline",
      "env/svg-no-text",
      "env/pixel-oracle-unavailable",
      "env/ink-passes-unstable",
      "env/svg-too-many-text-targets",
    ],
  },
  (snapshot, ctx) => {
    const findings = [];
    const notMeasured = [];
    let candidates = 0;
    let measured = 0;
    const maxMissingInk = num(ctx.options.maxMissingInk, 0.05);

    for (const svg of snapshot.svg) {
      const targets = svg.texts.length;
      candidates += Math.max(targets, svg.measurable ? 0 : 1);

      if (!svg.measurable) {
        notMeasured.push(
          declined({
            scope: "svg",
            ruleId: "svg/text-clipped",
            reason: svg.reason ?? "env/svg-not-inline",
            count: Math.max(targets, 1),
          }),
        );
        continue;
      }
      if (targets === 0) continue;
      if (svg.textTargetsCapped) {
        notMeasured.push(
          declined({
            scope: "svgText",
            ruleId: "svg/text-clipped",
            reason: "env/svg-too-many-text-targets",
            count: targets,
          }),
        );
        continue;
      }
      // Two identical passes must give the same count. If they do not, the measurement is
      // discarded rather than averaged — an averaged unstable value is an invented value.
      // The passes are not implemented in this build, which is a fact about the tool and not
      // about the document. It is reported as such, and it leaves the coverage base — see
      // TOOL_CAPABILITY_ENV_IDS. Saying "unstable" here would claim a measurement was made.
      if (!svg.inkCollected) {
        notMeasured.push(
          declined({ scope: "svg", ruleId: "svg/text-clipped", reason: "env/pixel-oracle-unavailable", count: targets }),
        );
        continue;
      }
      if (!svg.inkStable) {
        notMeasured.push(
          declined({ scope: "svg", ruleId: "svg/text-clipped", reason: "env/ink-passes-unstable", count: targets },),
        );
        continue;
      }
      measured += targets;

      for (const text of svg.texts) {
        const t0 = text.ink.T0.count;
        const t = text.ink.T.count;
        // A target that carries no glyph ink at all cannot be judged; the ratio would divide
        // by zero and any answer would be arithmetic, not measurement.
        if (t0 <= 0) continue;
        const missing = (t0 - t) / t0;
        if (missing <= maxMissingInk) continue;

        findings.push(
          makeFinding({
            ctx,
            ruleId: "svg/text-clipped",
            severity: "warn",
            message:
              `${(missing * 100).toFixed(2)} % of this text's glyph ink is removed by ` +
              `${text.clipState === "mask" ? "a mask" : "a clip path"}; threshold ` +
              `${(maxMissingInk * 100).toFixed(0)} %. Heuristic: clipping can be deliberate.`,
            page: 1,
            keyType: "svg-text",
            key: text.svgTextKey,
            nodeKey: svg.nodeKey,
            sid: null,
            boxScreen: text.boxScreen,
            source: null,
            value: Number(missing.toFixed(4)),
            threshold: maxMissingInk,
            unit: "missing ink ratio",
          }),
        );
      }
    }
    return { findings, candidates, measured, notMeasured };
  },
);
