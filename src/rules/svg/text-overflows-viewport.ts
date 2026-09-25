import { defineRule } from "../../core/rule.ts";
import { declined, makeFinding, num, targetEvaluation } from "../shared.ts";
import { SVG_OVERSHOOT_EPSILON_PX } from "../../measure/svg-viewport.ts";
import { bracketVerdict, lowerBoundOvershoot, upperBoundOvershoot } from "../../measure/svg-ink.ts";

/**
 * svg/text-overflows-viewport — a `<text>` sits outside the SVG's viewport and is clipped away.
 *
 * The second of the two rules that carry `error`, and for the same kind of reason as the first:
 * two directly measured boxes and a structural boundary. What lies outside the viewport is not
 * drawn. There is no threshold to choose.
 *
 * Both boxes live in ONE coordinate system before they are compared: the outermost SVG's own
 * viewport frame (`SvgViewportLocal`), where the browser applies the clip. `getBBox()` returns
 * the text's user-space coordinates; measured on a transformed group, local (60, 0) is absolute
 * (284.57, 70.78) — an error of 235.46 px — so the text goes through its CTM chain into the frame.
 * The screen is not that frame: under a CSS rotation or zoom of the SVG or an ancestor, the screen
 * rectangles are only envelopes, and containment between envelopes is not containment.
 *
 * A nested `<svg>` is clipped by its own viewport and by every enclosing one, and the rule
 * measures against all of them. The exemption matters as much as the rule: where nothing clips —
 * no clipping overflow on the SVG or any enclosing SVG, no paint containment, no clip-path or mask
 * on the outermost SVG, no clipping HTML ancestor in the page area — the text *is* drawn, and the
 * rule declines rather than reports. Anything that clips and is not rebuilt in the frame is a
 * decline counted against coverage, never that exemption.
 *
 * WHAT IS COMPARED IS INK, BOUNDED FROM BOTH SIDES. What the clip removes is painted ink, and the
 * collector bounds it twice (`SvgTextPaint`, `src/measure/svg-ink.ts`): a box the glyph ink
 * provably reaches in every direction, from a canvas raster of the label's own glyphs, and a box
 * that provably contains every painted pixel — the glyph outlines grown by the widest the visible
 * stroke can reach, k·stroke-width/2 with k the miter limit for miter joins. The rule reports only
 * what the first proves to lie beyond the clip, stays silent only where the second lies inside it,
 * and declines the band between as `env/svg-painted-bounds-inconclusive`, counted against
 * coverage. The asymmetry is the safety property: no finding rests on ink that was not shown to
 * be there, and no silence on ink that was not shown to be absent. Up to this build the rule
 * compared the typographic cell, whose descent slack put an axis tick "1 px beyond the viewport"
 * with every pixel of its ink 2 px inside, and it declined every stroked label outright.
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
      "env/svg-viewport-geometry-unsupported",
      "env/svg-painted-bounds-unsupported",
      "env/svg-painted-bounds-inconclusive",
    ],
    remediation: {
      advice:
        "Text rendered inside an SVG extends outside the SVG viewport bounds and is clipped. Enlarge the SVG 'viewBox' or its width/height, or adjust the <text> coordinates ('x', 'y', 'text-anchor'). 'overflow: visible' on the container also clears the finding, but it does not move the text: the viewport then no longer clips, the target becomes non-applicable and this rule stops measuring it. Use that only where the overflow is intended.",
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

    for (const svg of snapshot.svg) {
      const targets = svg.texts.length;
      const potentialTargets = Math.max(
        targets + svg.unreadableTargets + svg.unsupportedTargets,
        svg.textTargetCount - svg.notRenderedTargets,
        svg.measurable ? 0 : 1,
      );

      // Not the SVG's own `overflow` string: a nested SVG with `overflow: visible` is still
      // clipped by the SVG around it, `auto` clips an outermost SVG and not a nested one, and
      // paint containment, a clip-path on the SVG or a clipping HTML ancestor clip whatever the
      // overflow says. `clipped` is the collector's statement that anything in the chain may clip.
      const overflowVisible = !svg.clipped;
      // Text that did not render is explicitly outside this rule's observable target set. Keep
      // the unknown count visible so removing/hiding text cannot resemble a visible repair.
      if (svg.notRenderedTargets > 0) {
        evaluations.push(targetEvaluation({
          ruleId: "svg/text-overflows-viewport", keyType: "svg-text", nodeKey: svg.nodeKey, sid: null,
          occurrenceKey: "unaddressable-rest:not-rendered", targetCount: svg.notRenderedTargets,
          status: "excluded", countsTowardCoverage: false, reason: "rule/svg-target-not-rendered",
          measurements: [
            { name: "svg-overflow-visible", value: overflowVisible, unit: null, operator: "=", threshold: true },
            { name: "svg-text-rendered", value: false, unit: null, operator: "=", threshold: true },
          ], connective: "all", violated: null,
        }));
      }
      // With overflow visible the SVG viewport does not clip its descendants, so this rule's
      // question does not arise. Decide that before asking whether target paint or viewport
      // geometry was measurable: neither can change this non-applicability fact.
      if (overflowVisible) {
        if (potentialTargets > 0) {
          candidates += potentialTargets;
          notMeasured.push(
            declined({
              scope: "svg",
              ruleId: "svg/text-overflows-viewport",
              reason: "env/svg-overflow-visible",
              count: potentialTargets,
            }),
          );
          for (const [textIndex, text] of svg.texts.entries()) evaluations.push(targetEvaluation({ ruleId: "svg/text-overflows-viewport", keyType: "svg-text", nodeKey: svg.nodeKey, sid: text.sourceAddressKey ?? null, occurrenceKey: String(textIndex), boxScreen: text.boxScreen, status: "not-applicable", reason: "env/svg-overflow-visible", measurements: [
            { name: "svg-overflow-visible", value: true, unit: null, operator: "=", threshold: true },
            { name: "svg-text-rendered", value: true, unit: null, operator: "=", threshold: true },
          ], connective: "all", violated: null }));
          const unaddressable = potentialTargets - svg.texts.length;
          if (unaddressable > 0) evaluations.push(targetEvaluation({ ruleId: "svg/text-overflows-viewport", keyType: "svg-text", nodeKey: svg.nodeKey, sid: null, occurrenceKey: "unaddressable-rest:overflow-visible", targetCount: unaddressable, status: "not-applicable", reason: "env/svg-overflow-visible", measurements: [
            { name: "svg-overflow-visible", value: true, unit: null, operator: "=", threshold: true },
            { name: "svg-text-rendered", value: true, unit: null, operator: "=", threshold: true },
          ], connective: "all", violated: null }));
        }
        continue;
      }

      // A whole SVG is unmeasurable when the target limit is exceeded or its viewport cannot be
      // represented by the collected rectangle. Paint-complex and unreadable targets remain
      // per-target declines, because throwing away thirty-nine sound boxes over one difficult
      // target would lose useful evidence without making the run any safer.
      if (!svg.measurable) {
        const unjudged = potentialTargets;
        candidates += unjudged;
        notMeasured.push(
          declined({
            scope: "svg",
            ruleId: "svg/text-overflows-viewport",
            reason: svg.reason ?? "env/svg-not-inline",
            count: unjudged,
          }),
        );
        evaluations.push(targetEvaluation({ ruleId: "svg/text-overflows-viewport", keyType: "svg-text", nodeKey: svg.nodeKey, sid: null, occurrenceKey: "unaddressable-rest:whole-svg", targetCount: unjudged, status: "not-measured", reason: svg.reason ?? "env/svg-not-inline" }));
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
        evaluations.push(targetEvaluation({ ruleId: "svg/text-overflows-viewport", keyType: "svg-text", nodeKey: svg.nodeKey, sid: null, occurrenceKey: "unaddressable-rest:ctm", targetCount: svg.unreadableTargets, status: "not-measured", reason: "env/svg-ctm-unavailable" }));
      }

      // `getBBox()` deliberately excludes several ways SVG changes painted geometry. The
      // collector counts those targets separately (including text instantiated through `<use>`),
      // so they cannot disappear from this error rule's coverage or be judged against a box that
      // describes different ink.
      if (svg.unsupportedTargets > 0) {
        candidates += svg.unsupportedTargets;
        notMeasured.push(
          declined({
            scope: "svgText",
            ruleId: "svg/text-overflows-viewport",
            reason: "env/svg-painted-bounds-unsupported",
            count: svg.unsupportedTargets,
          }),
        );
        evaluations.push(targetEvaluation({ ruleId: "svg/text-overflows-viewport", keyType: "svg-text", nodeKey: svg.nodeKey, sid: null, occurrenceKey: "unaddressable-rest:painted-bounds", targetCount: svg.unsupportedTargets, status: "not-measured", reason: "env/svg-painted-bounds-unsupported" }));
      }

      if (targets === 0) continue;
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
        for (const [textIndex, text] of svg.texts.entries()) evaluations.push(targetEvaluation({ ruleId: "svg/text-overflows-viewport", keyType: "svg-text", nodeKey: svg.nodeKey, sid: text.sourceAddressKey ?? null, occurrenceKey: String(textIndex), boxScreen: text.boxScreen, status: "not-measured", reason: "env/svg-too-many-text-targets" }));
        continue;
      }
      // A measurable record without its frame, or a clipped one without a clip rectangle, can
      // only come from a projection built outside the collector (the snapshot invariants refuse
      // it on the live path). Comparing against nothing would read as "inside everything", so
      // every target declines instead, still counted.
      const clips = svg.viewportLocal?.clips ?? [];
      if (clips.length === 0) {
        notMeasured.push(
          declined({
            scope: "svgText",
            ruleId: "svg/text-overflows-viewport",
            reason: "env/svg-viewport-geometry-unsupported",
            count: targets,
          }),
        );
        for (const [textIndex, text] of svg.texts.entries()) evaluations.push(targetEvaluation({ ruleId: "svg/text-overflows-viewport", keyType: "svg-text", nodeKey: svg.nodeKey, sid: text.sourceAddressKey ?? null, occurrenceKey: String(textIndex), boxScreen: text.boxScreen, status: "not-measured", reason: "env/svg-viewport-geometry-unsupported" }));
        continue;
      }
      const permitted = num(ctx.options.maxOvershootPx, 0);
      // The rule's stated resolution, S1's error budget of one comparison: the clips and the paint
      // bounds are unrounded frame values, and the collector declines every frame whose error bound
      // (`uncertaintyPx`: CDP residual, float32 quantisation of the quads, the clip margin's
      // serialisation) plus the target's own residual does not fit inside SVG_OVERSHOOT_EPSILON_PX
      // (the snapshot invariants refuse a projection that carries one). So a lower bound above
      // permitted + epsilon reaches past the real edge, and an upper bound at or below
      // permitted + epsilon keeps all ink within the 2·epsilon resolution band the frame decision
      // already states. Never a larger epsilon for a looser frame: such a frame is declined, not
      // measured. Not configurable, and not the threshold.
      const epsilon = SVG_OVERSHOOT_EPSILON_PX;
      let inconclusive = 0;
      for (const [textIndex, text] of svg.texts.entries()) {
        // Frame px: CSS px of the outermost SVG before its CSS transforms and zoom. The screen box
        // stays the evidence and the position a reader looks at.
        const lower = lowerBoundOvershoot(text.paint, text.userToLocal, clips);
        const upper = upperBoundOvershoot(text.paint, text.userToLocal, clips);
        const verdict = bracketVerdict(lower?.value ?? null, upper, permitted, epsilon);
        const measurements = [
          // The provable overshoot: null when nothing about this target's ink can be claimed past
          // the edge. The finding's value, whenever there is a finding.
          { name: "viewport-overshoot", value: lower === null ? null : lower.value, unit: "px", operator: ">" as const, threshold: permitted + epsilon },
          // The most the painted ink can overshoot. Silence needs this one inside the edge.
          { name: "viewport-overshoot-upper-bound", value: upper, unit: "px", operator: "<=" as const, threshold: permitted + epsilon },
        ];
        const base = { ruleId: "svg/text-overflows-viewport", keyType: "svg-text" as const, nodeKey: svg.nodeKey, sid: text.sourceAddressKey ?? null, occurrenceKey: String(textIndex), boxScreen: text.boxScreen, measurements };
        if (verdict === "inconclusive") {
          // Measured twice, and the two bounds disagree about the edge: the ink provably inside
          // does not reach past it, the box around all of it does. Neither "drawn" nor "not drawn"
          // is a statement these boxes support, so the target is declined — counted, per target,
          // and addressable across runs by its source identity.
          inconclusive += 1;
          evaluations.push(targetEvaluation({ ...base, status: "not-measured", reason: "env/svg-painted-bounds-inconclusive", violated: null }));
          continue;
        }
        measured += 1;
        const violated = verdict === "violated";
        evaluations.push(targetEvaluation({ ...base, status: "measured", violated }));
        if (!violated || lower === null) continue;

        const overshoot = lower.value;
        const what = lower.claim === "separated"
          ? `This text lies entirely outside the SVG viewport, at least ${overshoot.toFixed(2)} px beyond its edge, and is not drawn.`
          : text.paint.inkSource === "projection"
            ? `This text extends ${overshoot.toFixed(2)} px beyond the SVG viewport and is not drawn.`
            : `This text's glyph ink reaches at least ${overshoot.toFixed(2)} px beyond the SVG viewport, and that part is not drawn.`;
        findings.push(
          makeFinding({
            ctx,
            ruleId: "svg/text-overflows-viewport",
            severity: "error",
            message: `${what} Measured in the SVG's own coordinates, before CSS transforms and zoom.`,
            page: svg.page,
            keyType: "svg-text",
            key: text.svgTextKey,
            nodeKey: svg.nodeKey,
            sid: text.sourceAddressKey ?? null,
            boxScreen: text.boxScreen,
            source: text.sourceAddressKey ? snapshot.source.map[text.sourceAddressKey] ?? null : null,
            // The LOWER bound, rounded down to 0.01 px so the number printed never
            // exceeds what was proven.
            value: Math.floor(overshoot * 100 + 1e-9) / 100,
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
      if (inconclusive > 0) {
        notMeasured.push(
          declined({
            scope: "svgText",
            ruleId: "svg/text-overflows-viewport",
            // Its own reason, not the outright decline's: "no bound exists for this paint" and
            // "both bounds were measured and straddle the edge" are different states of knowledge,
            // and only the second says what would settle it — more room, a shorter label, a
            // thinner stroke.
            reason: "env/svg-painted-bounds-inconclusive",
            count: inconclusive,
          }),
        );
      }
    }
    return { findings, candidates, measured, notMeasured, evaluations };
  },
);
