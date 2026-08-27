import { defineRule } from "../../core/rule.ts";
import { declined, makeFinding, num } from "../shared.ts";

/**
 * svg/text-overflows-viewport — a `<text>` sits outside the SVG's viewport and is clipped away.
 *
 * The second of the two rules that carry `error`, and for the same kind of reason as the first:
 * two directly measured boxes and a structural boundary. What lies outside the viewport is not
 * drawn. There is no threshold to choose.
 *
 * Both boxes are CTM-normalised before they are compared. `getBBox()` returns *local*
 * coordinates; measured on a transformed group, local (60, 0) is absolute (284.57, 70.78) — an
 * error of 235.46 px. Comparing a local box against an absolute viewport is not an approximation,
 * it is a different measurement.
 *
 * The exemption matters as much as the rule: with `overflow: visible` on the SVG, the text *is*
 * drawn, and the rule declines rather than reports.
 */
export const textOverflowsViewport = defineRule(
  {
    id: "svg/text-overflows-viewport",
    severity: "error",
    proofSource: "A",
    calibrated: false,
    experimental: false,
    unit: "px",
    defaultOptions: { maxOvershootPx: 0 },
    summary: "A text element lies outside the viewport of its SVG and is not drawn.",
    declines: ["env/svg-not-inline", "env/svg-no-text", "env/svg-overflow-visible", "env/svg-too-many-text-targets", "env/svg-ctm-unavailable"],
  },
  (snapshot, ctx) => {
    const findings = [];
    const notMeasured = [];
    let candidates = 0;
    let measured = 0;

    for (const svg of snapshot.svg) {
      const targets = svg.texts.length;

      // An unmeasurable SVG carries no targets, so the count comes from what the collector saw
      // before it gave up — `textTargetCount` is the number of `<text>` elements on the page, and
      // reporting 1 for an SVG holding forty of them understates what went unjudged. Candidate
      // and decline take the same number: `defineRule` requires measured plus declined to equal
      // candidates, and a rule that cannot account for what it skipped has measured nothing.
      if (!svg.measurable) {
        const unjudged = Math.max(targets, svg.textTargetCount, 1);
        candidates += unjudged;
        notMeasured.push(
          declined({
            scope: "svg",
            ruleId: "svg/text-overflows-viewport",
            reason: svg.reason ?? "env/svg-not-inline",
            count: unjudged,
          }),
        );
        continue;
      }
      if (targets === 0) continue;
      // `overflow: visible` means the glyphs are painted after all. Not a defect, and saying
      // "not measured" is the honest form — the rule has no opinion about this document.
      //
      // The target is counted here and declined below, which keeps this rule's own books
      // straight. It leaves the COVERAGE base one level up, in the engine, because a question
      // that does not arise is not a question left unanswered: see `NON_APPLICABLE_ENV_IDS`.
      // Without that, one `overflow: visible` figure anywhere in a book would drive the whole
      // run to exit 4 — bookkeeping dressed as a statement about the document.
      if (/\bvisible\b/u.test(svg.overflow)) {
        candidates += targets;
        notMeasured.push(
          declined({
            scope: "svg",
            ruleId: "svg/text-overflows-viewport",
            reason: "env/svg-overflow-visible",
            count: targets,
          }),
        );
        continue;
      }
      candidates += targets;
      if (svg.textTargetsCapped) {
        notMeasured.push(
          declined({
            scope: "svgText",
            ruleId: "svg/text-overflows-viewport",
            reason: "env/svg-too-many-text-targets",
            count: targets,
          }),
        );
        continue;
      }
      measured += targets;

      const vp = svg.viewportScreen;
      const permitted = num(ctx.options.maxOvershootPx, 0);
      for (const text of svg.texts) {
        const b = text.boxScreen;
        const overshoot = Math.max(
          vp.x - b.x,
          vp.y - b.y,
          b.x + b.width - (vp.x + vp.width),
          b.y + b.height - (vp.y + vp.height),
        );
        if (overshoot <= permitted) continue;

        findings.push(
          makeFinding({
            ctx,
            ruleId: "svg/text-overflows-viewport",
            severity: "error",
            message:
              `This text extends ${overshoot.toFixed(2)} px beyond the SVG viewport and is not ` +
              `drawn. Coordinates are normalised through getScreenCTM().`,
            page: pageOfSvg(snapshot, svg.nodeKey),
            keyType: "svg-text",
            key: text.svgTextKey,
            nodeKey: svg.nodeKey,
            sid: null,
            boxScreen: b,
            source: null,
            value: Number(overshoot.toFixed(2)),
            threshold: permitted,
            unit: "px",
            proofSource: "A",
          }),
        );
      }
    }
    return { findings, candidates, measured, notMeasured };
  },
);

function pageOfSvg(snapshot: Parameters<typeof textOverflowsViewport.run>[0], nodeKey: string): number {
  return snapshot.blocks.find((b) => b.nodeKey === nodeKey)?.page ?? 1;
}
