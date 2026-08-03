import type { Report } from "../core/types.ts";

/**
 * What every output format must show, in words a reader can find.
 *
 * `json` is the truth; every other format is a lossy projection. The loss is allowed to be
 * large — but not here. A format that shows only the findings makes the blind run invisible
 * again, and a format that hides its own gate threshold leaves the reader unable to say what
 * exit 0 meant. Both were real defects, so both are checked mechanically:
 * `tests/unit/reporters.test.ts` asserts each of these appears in each rendered format.
 */
export interface MandatoryFacts {
  inputsFound: number;
  pagesAnalysed: number;
  rulesRun: number;
  measuredRules: number;
  notMeasuredTotal: number;
  runVerdict: string;
  mode: string;
  failOn: string;
  gateTriggeredBy: string;
}

export function mandatoryFacts(report: Report): MandatoryFacts {
  return {
    inputsFound: report.inputsFound,
    pagesAnalysed: report.pagesAnalysed,
    rulesRun: report.rulesRun,
    measuredRules: report.measuredRules,
    notMeasuredTotal: report.documents.reduce(
      (sum, d) => sum + d.notMeasured.reduce((s, n) => s + n.count, 0),
      0,
    ),
    runVerdict: report.runVerdict,
    mode: report.mode,
    failOn: report.config.failOn,
    gateTriggeredBy: report.summary.gateTriggeredBy ?? "none",
  };
}

/** The labels the formats print. One list, so a rename cannot drift between six files. */
export const LABELS = {
  inputsFound: "inputs found",
  pagesAnalysed: "pages analysed",
  rulesRun: "rules run",
  measuredRules: "rules that measured something",
  notMeasuredTotal: "not measured",
  runVerdict: "verdict",
  mode: "mode",
  failOn: "fail-on",
  gateTriggeredBy: "gate triggered by",
} as const;

export function summaryLine(report: Report): string {
  const f = mandatoryFacts(report);
  return (
    `${LABELS.inputsFound}: ${f.inputsFound} · ${LABELS.pagesAnalysed}: ${f.pagesAnalysed} · ` +
    `${LABELS.rulesRun}: ${f.rulesRun} · ${LABELS.measuredRules}: ${f.measuredRules} · ` +
    `${LABELS.notMeasuredTotal}: ${f.notMeasuredTotal} · ${LABELS.runVerdict}: ${f.runVerdict} · ` +
    `${LABELS.mode}: ${f.mode} · ${LABELS.failOn}: ${f.failOn} · ` +
    `${LABELS.gateTriggeredBy}: ${f.gateTriggeredBy}`
  );
}
