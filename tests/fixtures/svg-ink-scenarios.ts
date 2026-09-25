/**
 * The painted-ink bracket's cases, end to end without a browser: raw collector facts shaped like
 * Chromium 141's through `assembleSnapshot` and the real engine and rule to a report.
 *
 * One 200 × 80 viewport (overflow hidden), one label per case, and the case names are the ones the
 * design has to get right. They are kept here rather than inside a test so that the mutation test
 * (tests/unit/svg-ink-mutants.test.ts) can run the very same cases against a copy of `src/` with
 * one protection removed and show which case turns.
 */

import { exitCodeFor, runDocument } from "../../src/core/engine.ts";
import type { AffineMatrix, Box } from "../../src/core/types.ts";
import { textOverflowsViewport } from "../../src/rules/svg/text-overflows-viewport.ts";
import { assembleOneSvg, complexLabel, paintElement, rasterLabel, rawPaint, type RawTextSpec } from "./svg-raw.ts";


const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });
const rotateAbout = (degrees: number, cx: number, cy: number): AffineMatrix => {
  const r = (degrees * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
};

export const SCENARIOS = {
  /** Plain label 10 px past the right edge, ink reaching its cell. */
  outside: (): RawTextSpec[] => [{ id: "outside", bbox: box(170, 30, 40, 14) }],
  /** Plain label well inside. */
  inside: (): RawTextSpec[] => [{ id: "inside", bbox: box(20, 30, 40, 14) }],
  /** Glyphs 1 px inside the right edge, a round-joined 4 px stroke: 2 px of stroke may cross. */
  "band-round": (): RawTextSpec[] => [{
    id: "band-round", bbox: box(159, 30, 40, 14),
    paint: rawPaint({ text: { stroke: "rgb(255, 255, 255)", strokeWidth: "4px", strokeLinejoin: "round" } }),
  }],
  /**
   * Glyphs 5 px inside, a 4 px stroke on the default miter join. cell + sw/2 is 3 px inside — the
   * claim the prototype made — but a miter tip reaches up to miterlimit · sw/2 = 8 px: the band.
   */
  miter: (): RawTextSpec[] => [{
    id: "miter", bbox: box(155, 30, 40, 14),
    paint: rawPaint({ text: { stroke: "rgb(255, 255, 255)", strokeWidth: "4px" } }),
  }],
  /**
   * The axis-tick slack: the cell ends 1 px past the bottom edge, the glyph ink 2 px inside it.
   * The released rule reported this as "not drawn".
   */
  slack: (): RawTextSpec[] => [{
    id: "slack", bbox: box(20, 67, 23, 14),
    label: rasterLabel(box(20, 67, 23, 14), { ink: box(21.5, 69.2, 20.4, 8.8), baseline: 78, text: "100" }),
  }],
  /** A label with a tspan whose own 3 px miter stroke can reach past the edge. */
  "tspan-stroke": (): RawTextSpec[] => [{
    id: "tspan-stroke", bbox: box(150, 30, 42, 14), label: complexLabel(),
    paint: rawPaint({ elements: [paintElement(), paintElement({ tag: "tspan", stroke: "rgb(255, 255, 255)", strokeWidth: "3px" })] }),
  }],
  /** A label with a tspan that casts a text shadow: no bound, declined. */
  "tspan-shadow": (): RawTextSpec[] => [{
    id: "tspan-shadow", bbox: box(20, 30, 42, 14), label: complexLabel(),
    paint: rawPaint({ elements: [paintElement(), paintElement({ tag: "tspan", textShadow: "rgb(0, 0, 0) 1px 1px 2px" })] }),
  }],
  /** A percentage stroke width: resolved against a viewport diagonal nothing here models. */
  "percent-stroke": (): RawTextSpec[] => [{ id: "percent-stroke", bbox: box(20, 30, 40, 14), paint: rawPaint({ text: { stroke: "rgb(0, 0, 0)", strokeWidth: "5%" } }) }],
  /** A non-scaling stroke: drawn in screen space. */
  "non-scaling": (): RawTextSpec[] => [{ id: "non-scaling", bbox: box(20, 30, 40, 14), paint: rawPaint({ text: { stroke: "rgb(0, 0, 0)", strokeWidth: "2px", vectorEffect: "non-scaling-stroke" } }) }],
  /**
   * A spacingAndGlyphs run (stretched 1.25×) with an 8 px round stroke, glyphs 5 px inside: the
   * stroke is stretched with the glyphs, so its reach along the baseline is 1.25 · 4 = 5 px and the
   * label is in the band. Unstretched, the 4 px pad would have called it inside.
   */
  "stretched-stroke": (): RawTextSpec[] => [{
    id: "stretched-stroke", bbox: box(155, 30, 40, 14),
    paint: rawPaint({ text: { stroke: "rgb(255, 255, 255)", strokeWidth: "8px", strokeLinejoin: "round", textLength: "40", lengthAdjust: "spacingAndGlyphs" } }),
    label: rasterLabel(box(155, 30, 40, 14), { textLength: 40, userToScreen: [1, 0, 0, 1, 35, 35] }),
  }],
  /** The same stretch on a tspan the raster does not reproduce: no bound for the stroke. */
  "stretched-tspan": (): RawTextSpec[] => [{
    id: "stretched-tspan", bbox: box(20, 30, 40, 14), label: complexLabel(),
    paint: rawPaint({ elements: [paintElement(), paintElement({ tag: "tspan", stroke: "rgb(0, 0, 0)", strokeWidth: "2px", textLength: "40", lengthAdjust: "spacingAndGlyphs" })] }),
  }],
  /** The halo idiom, well inside: fill, then a round-joined white stroke under it. */
  halo: (): RawTextSpec[] => [{ id: "halo", bbox: box(20, 30, 60, 14), paint: rawPaint({ text: { stroke: "rgb(255, 255, 255)", strokeWidth: "3px", strokeLinejoin: "round" } }) }],
  /**
   * A label rotated −30° about its start, rastered through its CTM: the raster's covered rows are
   * the frame's, so the label's top reaches past the top edge by what its ink covers there.
   */
  rotated: (): RawTextSpec[] => {
    const ctm = rotateAbout(-30, 100, 20);
    return [{ id: "rotated", bbox: box(100, 10, 60, 14), ctm }];
  },
} as const;
export type ScenarioName = keyof typeof SCENARIOS;

export interface ScenarioOutcome {
  exit: number;
  crashed: boolean;
  findings: { value: number; message: string }[];
  candidates: number;
  measured: number;
  declines: string[];
  rows: { status: string; reason: string | null; measurements: [string, unknown][] }[];
}

export function runScenario(name: ScenarioName): ScenarioOutcome {
  const snapshot = assembleOneSvg(SCENARIOS[name]());
  const report = runDocument(
    { path: `${name}.html`, snapshot, infrastructure: [] },
    { failOn: "error", activeRules: [textOverflowsViewport], optionsByRule: {}, coverageFloors: {} },
  ).report;
  const coverage = report.coverage["svg/text-overflows-viewport"];
  return {
    exit: exitCodeFor(report.verdict),
    crashed: report.infrastructure.some((event) => event.kind === "checker-crashed"),
    findings: report.findings.map((finding) => ({ value: finding.measurement.value as number, message: finding.message })),
    candidates: coverage?.candidates ?? 0,
    measured: coverage?.measured ?? 0,
    declines: (coverage?.notMeasured ?? []).map((entry) => `${entry.reason}:${entry.count}`),
    rows: report.evaluations.filter((row) => row.ruleId === "svg/text-overflows-viewport")
      .map((row) => ({ status: row.status, reason: row.reason, measurements: row.measurements.map((m) => [m.name, m.value] as [string, unknown]) })),
  };
}
