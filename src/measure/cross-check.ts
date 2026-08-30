/**
 * A second opinion on the probe's geometry, from a source the document cannot reach.
 *
 * The freeze signature and the whole snapshot are measured inside the page. `primitives.ts` makes
 * those calls survive an author script replacing the prototypes, and that is measured — but it is
 * still one source. If the captured references were themselves wrong, or a future browser changed
 * what `getBoundingClientRect` reports under pagination, nothing in the page could tell.
 *
 * So a sample is cross-examined against CDP `DOM.getBoxModel`, which reads the browser's own
 * layout tree over the debugging protocol. That is an oracle from a DIFFERENT source than the
 * thing it judges — the standing requirement in this project, and the one whose absence has caused
 * more retracted claims here than any other single mistake.
 *
 * WHAT IS COMPARED, AND TWO NUMBERS THAT WERE NEARLY WRITTEN DOWN WRONG. `DOM.getBoxModel` returns
 * both a quad and a `width`/`height` pair. Measured over eight paginated paragraphs, twice:
 *
 *     quad corners and size vs. getBoundingClientRect   max |Δ| = 0 px, EXACTLY, on both runs
 *     model.width / model.height vs. the same           max |Δ| = 0.34375 px
 *
 * The second row is not a disagreement about geometry: `model.width` and `model.height` are
 * ROUNDED TO INTEGERS — 469 against 468.65625. A tolerance chosen to accommodate that would have
 * been a number invented to cover reading the wrong field. The size is taken from the quad.
 *
 * The first row was nearly recorded as 0.005 px. A throwaway probe measured that, and it was an
 * artefact of the PROBE: it rounded the in-page values to two decimals before comparing, so it was
 * measuring its own rounding and attributing it to the browser. Unrounded, the two sources agree
 * to the bit. A constant that looks measured and describes something else is the failure this
 * whole project is about, so the number here is 0 and the live suite asserts exact agreement —
 * which makes that case load-bearing instead of slack.
 *
 * A later real-document run found two other distinctions that the simple corpus did not expose.
 * First, a transformed quad is not axis-aligned: its AABB must use all four corners, not the first
 * corner and two convenient neighbours. A 30-degree HTML block made the shortcut wrong by 23 px.
 * Second, CDP and `getBoundingClientRect` do not describe the same box for SVG graphics descendants:
 * strokes enlarged CDP's box by 0.55 px in one Wikimedia SVG and 3.07 px in another. Those nodes are
 * excluded from this CSS-box oracle; the SVG collector has its own CTM geometry boundary. Third,
 * an author can reset a block element to `display:inline`: for an inline box that contains block
 * children, `getBoundingClientRect()` and CDP's border quad intentionally cover different unions.
 * Those inline formatting boxes are excluded too; their block children remain eligible. None of
 * these findings justifies spending the tolerance on a comparison of different quantities.
 *
 * THE TOLERANCE IS THEREFORE NOT A MEASURED DISAGREEMENT AT ALL. There is none to accommodate. It
 * is a guard band for machines this build has never run on — a different device pixel ratio, a
 * different zoom, a browser that rounds one path and not the other — and it is a CHOSEN number,
 * `calibrated: false` in the same sense as every threshold in this project. The live suite pins
 * the real corpus at 0, so the band cannot quietly absorb a genuine drift: a disagreement of any
 * size on this corpus fails the suite long before it reaches the tolerance.
 */

import type { InfraEvent } from "../core/types.ts";

/**
 * The largest disagreement between the two sources that is still treated as agreement.
 *
 * A chosen guard band, not a measured one — see the module comment. The corpus disagrees by
 * nothing at all, so this number has never yet been consulted by a passing run.
 */
export const CROSS_CHECK_TOLERANCE_PX = 0.05;

/**
 * What the corpus actually produces: exact agreement, on two runs.
 *
 * The live suite asserts the corpus does not exceed this, so if the two sources ever begin to
 * disagree — a browser change, a device pixel ratio, a zoom level — the suite says so at the first
 * fractional pixel instead of silently spending the guard band above.
 */
export const CROSS_CHECK_MEASURED_MAX_PX = 0;

/** Maximum elements cross-examined. A smaller document contributes every eligible CSS box. */
export const CROSS_CHECK_SAMPLE_SIZE = 8;

export interface GeometrySample {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** CDP selector for exactly the sampled attribute family; never authored CSS. */
  selector?: string;
  /** Zero-based occurrence among the rendered nodes matching `selector`. */
  occurrence?: number;
}

export interface Disagreement {
  key: string;
  field: "x" | "y" | "width" | "height";
  inPage: number;
  outOfProcess: number;
  delta: number;
}

export interface CrossCheckResult {
  checked: number;
  required: number;
  candidates: number;
  eligible: number;
  excludedSvgDescendants: number;
  excludedInlineBlockContainers: number;
  maxDelta: number;
  disagreements: Disagreement[];
  ok: boolean;
}

export interface GeometrySampleBatch {
  samples: GeometrySample[];
  candidates: number;
  eligible: number;
  excludedSvgDescendants: number;
  excludedInlineBlockContainers: number;
}

/** Convert CDP's four-corner quad to the axis-aligned box returned by getBoundingClientRect(). */
export function quadEnvelope(quad: readonly number[]): Omit<GeometrySample, "key"> {
  if (quad.length !== 8 || quad.some((value) => !Number.isFinite(value))) {
    throw new Error("CDP box quad must contain four finite x/y corners");
  }
  const xs = [quad[0]!, quad[2]!, quad[4]!, quad[6]!];
  const ys = [quad[1]!, quad[3]!, quad[5]!, quad[7]!];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * Compare two sets of boxes for the same keys.
 *
 * Pure, so the disagreement branch is reachable without a browser — a real browser cannot be asked
 * to disagree with itself, which is exactly the shape of branch this project has repeatedly found
 * to be ungated.
 *
 * A key present in one set and not the other is itself a disagreement, not a skip. Silently
 * intersecting the two would let a probe that returned NOTHING pass with `checked: 0`.
 */
export function compareGeometry(
  inPage: readonly GeometrySample[],
  outOfProcess: readonly GeometrySample[],
  tolerance: number = CROSS_CHECK_TOLERANCE_PX,
  required: number = inPage.length,
  stats: Omit<GeometrySampleBatch, "samples"> = {
    candidates: inPage.length,
    eligible: inPage.length,
    excludedSvgDescendants: 0,
    excludedInlineBlockContainers: 0,
  },
): CrossCheckResult {
  const byKey = new Map(outOfProcess.map((s) => [s.key, s]));
  const disagreements: Disagreement[] = [];
  let maxDelta = 0;

  for (const probe of inPage) {
    const other = byKey.get(probe.key);
    if (!other) {
      disagreements.push({ key: probe.key, field: "x", inPage: probe.x, outOfProcess: Number.NaN, delta: Infinity });
      maxDelta = Infinity;
      continue;
    }
    for (const field of ["x", "y", "width", "height"] as const) {
      const delta = Math.abs(probe[field] - other[field]);
      if (delta > maxDelta) maxDelta = delta;
      if (delta > tolerance) {
        disagreements.push({ key: probe.key, field, inPage: probe[field], outOfProcess: other[field], delta });
      }
    }
  }

  return {
    checked: inPage.length,
    required,
    ...stats,
    maxDelta,
    disagreements,
    // A cross-check over nothing is not a passed cross-check. Measuring zero elements and
    // reporting `ok` would be the green-over-nothing shape one level in from the live suite.
    ok: disagreements.length === 0 && inPage.length > 0 && inPage.length === required,
  };
}

/** The infrastructure event a failed cross-check produces. Fatal — see `enums.ts`. */
export function crossCheckEvent(result: CrossCheckResult): InfraEvent {
  const worst = [...result.disagreements].sort((a, b) => b.delta - a.delta).slice(0, 3);
  return {
    kind: "geometry-cross-check-failed",
    detail:
      result.checked === 0
        ? "the geometry cross-check measured no elements, so it confirms nothing about the probe."
        : result.checked !== result.required
          ? `the geometry cross-check measured ${result.checked} of ${result.required} required elements, ` +
            `so the report is not written.`
        : `the in-page probe and the browser's layout tree disagree about ${result.disagreements.length} ` +
          `measurement(s) of ${result.checked} element(s) sampled, by up to ${result.maxDelta.toFixed(4)} px ` +
          `against a tolerance of ${CROSS_CHECK_TOLERANCE_PX} px. Every number in the report comes from ` +
          `the probe, so the report is not written.`,
    measured: {
      checked: result.checked,
      required: result.required,
      candidates: result.candidates,
      eligible: result.eligible,
      excludedSvgDescendants: result.excludedSvgDescendants,
      excludedInlineBlockContainers: result.excludedInlineBlockContainers,
      maxDeltaPx: Number.isFinite(result.maxDelta) ? Number(result.maxDelta.toFixed(4)) : null,
      tolerancePx: CROSS_CHECK_TOLERANCE_PX,
      worst: worst.map((d) => ({ key: d.key, field: d.field, inPage: d.inPage, outOfProcess: d.outOfProcess })),
    },
  };
}

/** Positive evidence from the independent browser-layout-tree oracle. Non-fatal by contract. */
export function crossCheckPassedEvent(result: CrossCheckResult): InfraEvent {
  return {
    kind: "geometry-cross-check-passed",
    detail:
      `the in-page probe matched the browser's layout tree for ${result.checked} of ${result.eligible} ` +
      `eligible CSS box(es); ${result.excludedSvgDescendants} SVG graphics descendant(s) and ` +
      `${result.excludedInlineBlockContainers} inline block-container(s) used different box semantics.`,
    measured: {
      checked: result.checked,
      required: result.required,
      candidates: result.candidates,
      eligible: result.eligible,
      excludedSvgDescendants: result.excludedSvgDescendants,
      excludedInlineBlockContainers: result.excludedInlineBlockContainers,
      maxDeltaPx: Number(result.maxDelta.toFixed(4)),
      tolerancePx: CROSS_CHECK_TOLERANCE_PX,
    },
  };
}

/**
 * The in-page half of the sample.
 *
 * Reads through the captured primitives, like every other measurement — the point of the check is
 * to cross-examine the numbers the report will actually contain, not a second set taken a
 * different way. The selector plus occurrence names the exact rendered fragment, so a source block
 * split across pages cannot make CDP compare the first fragment while the in-page probe chose a
 * later visible one.
 */
export const SAMPLE_SOURCE = `((limit) => {
  const P = window.__blPrimitives;
  const selector = "[data-bl-sid],address[data-ref],article[data-ref],aside[data-ref],blockquote[data-ref],caption[data-ref],dd[data-ref],details[data-ref],div[data-ref],dl[data-ref],dt[data-ref],fieldset[data-ref],figcaption[data-ref],figure[data-ref],footer[data-ref],form[data-ref],h1[data-ref],h2[data-ref],h3[data-ref],h4[data-ref],h5[data-ref],h6[data-ref],header[data-ref],hgroup[data-ref],hr[data-ref],li[data-ref],main[data-ref],nav[data-ref],ol[data-ref],p[data-ref],pre[data-ref],section[data-ref],summary[data-ref],table[data-ref],tbody[data-ref],td[data-ref],tfoot[data-ref],th[data-ref],thead[data-ref],tr[data-ref],ul[data-ref],[id]";
  const rendered = ".pagedjs_page " + selector.replaceAll(",", ",.pagedjs_page ");
  const all = P.all(document, rendered);
  const seen = new Set();
  const out = [];
  let candidates = 0;
  let eligible = 0;
  let excludedSvgDescendants = 0;
  let excludedInlineBlockContainers = 0;
  for (const el of all) {
    const sid = P.attr(el, "data-bl-sid");
    const ref = P.attr(el, "data-ref");
    const id = P.attr(el, "id");
    const attribute = sid ? "data-bl-sid" : ref ? "data-ref" : id ? "id" : null;
    const value = sid || ref || id;
    if (!attribute || !value) continue;
    candidates += 1;
    // CDP's border quad includes stroke/paint extents for SVG graphics descendants while
    // getBoundingClientRect reports SVG geometry. Comparing those would be a disagreement between
    // definitions, not an independent check. Keep the root <svg>, whose CSS replaced-element box
    // is shared by both sources, and leave descendant geometry to the dedicated CTM collector.
    const svgRoot = P.closest(el, "svg");
    if (svgRoot && svgRoot !== el) { excludedSvgDescendants += 1; continue; }
    // A source-level block can become an inline formatting box through authored CSS (all:initial
    // does exactly that). For an inline containing block children, GCR and CDP's border quad cover
    // different unions. The child blocks remain independently eligible, so skipping this one box
    // removes a definition mismatch without creating an unchecked subtree.
    let containsBlockChild = false;
    for (const child of P.children(el)) {
      if (P.nodeType(child) !== 1) continue;
      const childDisplay = P.style(child).display;
      if (childDisplay === "block" || childDisplay === "flow-root" || childDisplay === "list-item" ||
          childDisplay === "table" || childDisplay === "flex" || childDisplay === "grid") {
        containsBlockChild = true;
        break;
      }
    }
    if (!svgRoot && P.style(el).display === "inline" && containsBlockChild) {
      excludedInlineBlockContainers += 1;
      continue;
    }
    const b = P.rect(el);
    if (b.width <= 0 || b.height <= 0) continue;
    // JSON emits a CSS string token and therefore keeps an authored id containing a quote from
    // widening this selector.  The generated source attributes are preferred; id is the
    // compatibility fallback Paged.js preserves when it drops both generated attributes.
    const exactSelector = ".pagedjs_page [" + attribute + "=" + JSON.stringify(value) + "]";
    const occurrence = P.all(document, exactSelector).indexOf(el);
    const key = attribute + ":" + value + "#" + occurrence;
    if (occurrence < 0 || seen.has(key)) continue;
    seen.add(key);
    // Count the addressable, de-duplicated population from which required is derived. Counting
    // before this guard can make a sound small document require more samples than can be queried.
    eligible += 1;
    if (out.length < limit) {
      out.push({ key, x: b.x, y: b.y, width: b.width, height: b.height, selector: exactSelector, occurrence });
    }
  }
  return { samples: out, candidates, eligible, excludedSvgDescendants, excludedInlineBlockContainers };
})`;

/** Bind the sample limit into the browser expression; `PageLike.evaluate(string)` takes no args. */
export function geometrySampleSource(limit: number): string {
  // Page.evaluate receives a source string.  Its function-expression form is not invoked by all
  // drivers, so bind the limit and invoke it here rather than accidentally treating the function
  // object's arity (zero) as an empty geometry sample.
  return `${SAMPLE_SOURCE.replace("((limit) => {", `(() => { const limit = ${limit};`)}()`;
}
