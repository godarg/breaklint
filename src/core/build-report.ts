/**
 * Assembles the report from document outcomes.
 *
 * One thing here is easy to get wrong and was: `summary.gateTriggeredBy` names what moved the
 * *verdict*, not what findings existed. When coverage or infrastructure decided, it is `null`
 * even though findings are present. Otherwise a reader sees `"error"` next to exit 4 and
 * concludes the error caused it. `gateCandidate` carries what the finding gate would have said,
 * so nothing is lost by being precise.
 */

import { aggregateVerdict, exitCodeFor, gateCandidate, gateTriggeredBy } from "./engine.ts";
import type { DocumentOutcome } from "./engine.ts";
import type { FailOn, ReportMode, ReportSource } from "./enums.ts";
import { SCHEMA_VERSION } from "./enums.ts";
import type { Report, ReportConfig, ReportEnvironment } from "./types.ts";

export function buildReport(input: {
  outcomes: DocumentOutcome[];
  mode: ReportMode;
  source: ReportSource;
  toolVersion: string;
  commit: string | null;
  startedAt: string;
  durationMs: number;
  rulesRun: number;
  environment: ReportEnvironment;
  config: ReportConfig;
  failOn: FailOn;
}): Report {
  const documents = input.outcomes.map((o) => o.report);
  const findings = documents.flatMap((d) => d.findings);
  const verdict = aggregateVerdict(
    documents.map((d) => d.verdict),
    documents.length,
  );

  const measuredRules = new Set(input.outcomes.flatMap((o) => o.measuredRuleIds)).size;
  const decidedByFindings = verdict === "findings";
  const ambiguousGroups = new Set(findings.filter((f) => f.ambiguity).map((f) => f.fingerprint)).size;

  return {
    schemaVersion: SCHEMA_VERSION,
    mode: input.mode,
    source: input.source,
    chain: "v1-rule-and-reporter-chain",
    tool: { name: "breaklint", version: input.toolVersion, commit: input.commit },
    runVerdict: verdict,
    exitCode: exitCodeFor(verdict),
    startedAt: input.startedAt,
    durationMs: input.durationMs,
    inputsFound: documents.length,
    pagesAnalysed: documents.reduce((sum, d) => sum + d.pages, 0),
    rulesRun: input.rulesRun,
    measuredRules,
    environment: input.environment,
    config: input.config,
    documents,
    findings,
    summary: {
      error: findings.filter((f) => f.severity === "error").length,
      warn: findings.filter((f) => f.severity === "warn").length,
      info: findings.filter((f) => f.severity === "info").length,
      experimental: findings.filter((f) => f.experimental).length,
      suppressed: 0,
      ambiguousGroups,
      gateTriggeredBy: decidedByFindings ? gateTriggeredBy(findings, input.failOn) : null,
      gateCandidate: gateCandidate(findings),
    },
  };
}
