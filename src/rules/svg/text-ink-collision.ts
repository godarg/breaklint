import { defineRule } from "../../core/rule.ts";
import { declined, makeFinding, num } from "../shared.ts";

/**
 * svg/text-ink-collision — a shape crosses a text's glyphs, or covers them.
 *
 * Two bands, both from the counterfactual passes of §5.0, neither from an API that is itself
 * under test:
 *
 *   collisionInk = |T ∩ S|   glyph ink of this target and shape ink on the same pixel
 *   occludedInk  = |T ∧ ¬F|  glyph ink of this target that is *missing* from the full run
 *
 * The second band exists because the first cannot see the practically most important case. An
 * opaque **white** rectangle over the text carries no ink of its own in the shapes pass — white
 * on white — so the intersection stays 0 while the text is entirely wiped out. Measured:
 * collisionInk 0, occludedInk 8 263.
 *
 * Two approaches were tried and discarded, and both are worth remembering:
 *
 *   Bounding-box overlap is wrong in 2 of 8 collision fixtures. The clearest case is a line
 *   that runs exactly through the gap between two text lines: it crosses the shared bounding
 *   box and not a single glyph. The ink measurement returns 0 there, correctly.
 *
 *   A fixed sampling grid misses. A short thin line grazing a corner of the text box is hit
 *   0 times at a 4 px step and 51 times at 0.25 px. There is no step that is both cheap and right.
 *
 * What this rule no longer finds, and it is a real loss, not a neutral trade: the sub-pixel
 * contact case — a shape close enough to touch a glyph optically without sharing a device
 * pixel. The old "contact band" caught it through `isPointInStroke`, which is exactly the
 * circular oracle this design forbids. Dropping it was right and it cost recall. It says so in
 * the finding, in the rule docs and in the README, because someone using this rule should learn
 * what it does not find from the tool, not from a surprise.
 */
export const textInkCollision = defineRule(
  {
    id: "svg/text-ink-collision",
    severity: "warn",
    proofSource: null,
    calibrated: false,
    experimental: false,
    unit: "device pixels",
    defaultOptions: { minCollisionInk: 8, minOccludedInk: 8 },
    summary: "A shape crosses or covers the glyphs of a text element.",
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
    const minCollision = num(ctx.options.minCollisionInk, 8);
    const minOccluded = num(ctx.options.minOccludedInk, 8);

    for (const svg of snapshot.svg) {
      const targets = svg.texts.length;
      candidates += Math.max(targets, svg.measurable ? 0 : 1);

      if (!svg.measurable) {
        notMeasured.push(
          declined({
            scope: "svg",
            ruleId: "svg/text-ink-collision",
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
            ruleId: "svg/text-ink-collision",
            reason: "env/svg-too-many-text-targets",
            count: targets,
          }),
        );
        continue;
      }
      // The passes are not implemented in this build, which is a fact about the tool and not
      // about the document. It is reported as such, and it leaves the coverage base — see
      // TOOL_CAPABILITY_ENV_IDS. Saying "unstable" here would claim a measurement was made.
      if (!svg.inkCollected) {
        notMeasured.push(
          declined({ scope: "svg", ruleId: "svg/text-ink-collision", reason: "env/pixel-oracle-unavailable", count: targets }),
        );
        continue;
      }
      if (!svg.inkStable) {
        notMeasured.push(
          declined({ scope: "svg", ruleId: "svg/text-ink-collision", reason: "env/ink-passes-unstable", count: targets }),
        );
        continue;
      }
      measured += targets;

      for (const text of svg.texts) {
        const collision = text.ink.T.intersectShapes ?? 0;
        const occluded = text.ink.T.missingInFull ?? 0;
        const hitsCollision = collision >= minCollision;
        const hitsOcclusion = occluded >= minOccluded;
        if (!hitsCollision && !hitsOcclusion) continue;

        const value = hitsOcclusion ? occluded : collision;
        const threshold = hitsOcclusion ? minOccluded : minCollision;
        const what = hitsOcclusion
          ? `${occluded} device pixels of this text's glyph ink are missing from the full ` +
            `rendering — something opaque covers them`
          : `${collision} device pixels of this text's glyph ink share a pixel with a shape`;

        findings.push(
          makeFinding({
            ctx,
            ruleId: "svg/text-ink-collision",
            severity: "warn",
            message:
              `${what}; threshold ${threshold}. Heuristic. Note: this rule does not detect ` +
              `sub-pixel contact — a shape may touch a glyph optically without sharing a pixel.`,
            page: 1,
            keyType: "svg-text",
            key: text.svgTextKey,
            nodeKey: svg.nodeKey,
            sid: null,
            boxScreen: text.boxScreen,
            source: null,
            value,
            threshold,
            unit: "device pixels",
          }),
        );
      }
    }
    return { findings, candidates, measured, notMeasured };
  },
);
