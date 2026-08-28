import { defineRule } from "../../core/rule.ts";
import { declined, makeFinding, num } from "../shared.ts";
import { SNAPSHOT_ROUNDING_PX } from "../../core/enums.ts";

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
    // The collector emits `env/svg-too-many-text-targets` at SVG level, `env/svg-ctm-unavailable`
    // per target and `env/svg-overflow-visible` for a viewport that does not clip. The first two
    // in the list come from externally supplied snapshot projections rather than from a real run
    // — M3-0 executes this rule over receipt-bound records — and dropping them made that suite
    // fail with exactly the undeclared-decline crash this list exists to prevent.
    declines: [
      "env/svg-not-inline",
      "env/svg-no-text",
      "env/svg-overflow-visible",
      "env/svg-too-many-text-targets",
      "env/svg-ctm-unavailable",
    ],
  },
  (snapshot, ctx) => {
    const findings = [];
    const notMeasured = [];
    let candidates = 0;
    let measured = 0;

    for (const svg of snapshot.svg) {
      const targets = svg.texts.length;

      // The only way a whole SVG is unmeasurable: more targets than the collector will gather.
      // Everything else is per target, because throwing away thirty-nine measured boxes over one
      // unmeasured one takes an error rule with a floor of 1 straight to exit 4.
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

      // Laid out but unreadable: a measurement this rule owed and did not deliver. It counts, and
      // it is the reason exit 4 exists. Targets the browser never laid out are not here at all —
      // they are `notRenderedTargets`, and a `<text>` in `<defs>` is not a target of a rule about
      // what the viewport clips away.
      if (svg.unreadableTargets > 0) {
        candidates += svg.unreadableTargets;
        notMeasured.push(
          declined({
            scope: "svgText",
            ruleId: "svg/text-overflows-viewport",
            reason: "env/svg-ctm-unavailable",
            count: svg.unreadableTargets,
          }),
        );
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
      // The collector sets `textTargetsCapped` together with `measurable: false`, so a real run
      // never reaches this branch. It stays because the rule also runs over externally supplied
      // snapshot projections (M3-0), where the two fields can disagree — and a capped SVG that
      // arrives marked measurable would otherwise be measured silently on whatever subset of its
      // targets came with it.
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
        // The two boxes come from different APIs — the viewport from getBoundingClientRect, the
        // target from CTM-transformed getBBox corners — and the collector stores both rounded to
        // two decimals. Each value therefore carries up to 0.005 px of rounding, and a difference
        // of two of them up to 0.01. SNAPSHOT_ROUNDING_PX is that granularity, read off the
        // collector rather than chosen: it is what the stored numbers cannot resolve, not a
        // tolerance somebody picked, and it does not make the threshold configurable.
        //
        // Measured on the sharpest constructible case — textLength set to the full width of the
        // viewBox, so the box ends on the edge by construction — the difference came out at
        // exactly 0, so this guard changes no verdict in the corpus. It is here because "0.01 px
        // outside" is not a statement this data can support.
        if (overshoot <= permitted + SNAPSHOT_ROUNDING_PX) continue;

        findings.push(
          makeFinding({
            ctx,
            ruleId: "svg/text-overflows-viewport",
            severity: "error",
            message:
              `This text extends ${overshoot.toFixed(2)} px beyond the SVG viewport and is not ` +
              `drawn. Coordinates are normalised through getScreenCTM().`,
            page: svg.page,
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
            // Two identical labels without an `id` share one content-derived identity. Which of
            // them is meant is not a well-formed question; the finding says the group is larger
            // than one instead of inventing a distinction from their order.
            ambiguity: text.ambiguityGroupSize > 1
              ? { groupSize: text.ambiguityGroupSize, resolvable: false }
              : null,
          }),
        );
      }
    }
    return { findings, candidates, measured, notMeasured };
  },
);
