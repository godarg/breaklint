import type { Finding, Report, RuleCoverage } from "../core/types.ts";
import type { RunVerdict, Severity } from "../core/enums.ts";
import { mandatoryFacts } from "./mandatory.ts";
import { infraLines } from "./infra.ts";

export interface HtmlStatus {
  key: RunVerdict;
  marker: string;
  title: string;
  sentence: string;
  gate: string;
  partial: boolean;
}

export interface HtmlFinding {
  id: string;
  severity: Severity;
  severityLabel: string;
  experimental: boolean;
  ruleId: string;
  page: number;
  document: string;
  source: string | null;
  measured: string;
  threshold: string;
  calibration: string;
  proofSource: string | null;
  message: string;
  evidence: {
    state: "bound" | "unbound" | "none";
    label: string;
    ref: string | null;
    href: string | null;
  };
  ambiguity: string | null;
}

export interface HtmlCoverageRow {
  id: string;
  ruleId: string;
  candidates: number;
  measured: number;
  notMeasured: number;
  ratio: string;
  floor: string;
  ok: boolean;
}

export interface HtmlCoverageDocument {
  id: string;
  path: string;
  verdict: RunVerdict;
  rows: HtmlCoverageRow[];
}

export interface HtmlReportModel {
  status: HtmlStatus;
  facts: ReturnType<typeof mandatoryFacts>;
  severity: Record<Severity, number>;
  coverageTrust: {
    label: string;
    detail: string;
    shortfallCount: number;
    measured: number;
    candidates: number;
  };
  findingsLead: string;
  findings: HtmlFinding[];
  infrastructure: ReturnType<typeof infraLines>;
  coverage: HtmlCoverageDocument[];
}

const STATUS: Record<RunVerdict, Omit<HtmlStatus, "key">> = {
  clean: {
    marker: "PASS",
    title: "Clean run",
    sentence: "Coverage met. The requested checks ran and no finding reached the configured gate.",
    gate: "Build passes (exit 0).",
    partial: false,
  },
  findings: {
    marker: "FAIL",
    title: "Findings block this run",
    sentence: "The finding gate was triggered. Review the measured failures below.",
    gate: "Build fails (exit 1).",
    partial: false,
  },
  infrastructure: {
    marker: "ERROR",
    title: "Checker failed",
    sentence: "This is not a clean run. The checker stopped before it could establish a trustworthy result.",
    gate: "Build fails (exit 3).",
    partial: true,
  },
  "insufficient-coverage": {
    marker: "INCOMPLETE",
    title: "Not enough was measured",
    sentence: "This is not a clean run. At least one rule did not meet its required coverage floor.",
    gate: "Build fails (exit 4).",
    partial: true,
  },
  usage: {
    marker: "USAGE",
    title: "Command could not start",
    sentence: "This is not a clean run. Correct the command or configuration, then run breaklint again.",
    gate: "Build fails (exit 2).",
    partial: true,
  },
};

const SEVERITY_LABELS: Record<Severity, string> = {
  error: "Error",
  warn: "Warning",
  info: "Information",
};

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

function formatMeasurement(value: number, unit: string): string {
  return `${formatNumber(value)} ${unit}`;
}

/**
 * Only evidence artifacts minted by breaklint are navigable. Report data is otherwise treated as
 * text: a hostile `https:`, `file:`, absolute path or traversal can never become an active link.
 */
export function safeEvidenceHref(ref: string | null): string | null {
  if (!ref || /[\u0000-\u001f\u007f\\]/u.test(ref)) return null;
  if (!/^(?:\.\/)?(?:evidence\/)?[A-Za-z0-9._-]+-page-[0-9]{3}\.png$/u.test(ref)) return null;
  return ref
    .split("/")
    .map((part) => (part === "." ? part : encodeURIComponent(part)))
    .join("/");
}

function findingModel(finding: Finding, index: number): HtmlFinding {
  const href = safeEvidenceHref(finding.evidence.ref);
  const state = finding.evidence.ref === null ? "none" : finding.evidence.bindsFinding ? "bound" : "unbound";
  const labels = {
    bound: "Bound evidence",
    unbound: "Evidence exists but does not bind this finding",
    none: "No evidence artifact",
  } as const;
  return {
    id: `finding-${index + 1}`,
    severity: finding.severity,
    severityLabel: SEVERITY_LABELS[finding.severity],
    experimental: finding.experimental,
    ruleId: finding.ruleId,
    page: finding.page,
    document: finding.document,
    source: finding.source ? `${finding.source.file}:${finding.source.line}:${finding.source.column}` : null,
    measured: formatMeasurement(finding.measurement.value, finding.measurement.unit),
    threshold: formatMeasurement(finding.measurement.threshold, finding.measurement.unit),
    calibration: finding.measurement.calibrated ? "Calibrated threshold" : "Uncalibrated threshold",
    proofSource: finding.measurement.proofSource,
    message: finding.message,
    evidence: { state, label: labels[state], ref: finding.evidence.ref, href },
    ambiguity: finding.ambiguity
      ? `${finding.ambiguity.groupSize} findings share this unresolved fingerprint.`
      : null,
  };
}

function coverageRow(ruleId: string, coverage: RuleCoverage, documentIndex: number, rowIndex: number): HtmlCoverageRow {
  return {
    id: `coverage-${documentIndex + 1}-${rowIndex + 1}`,
    ruleId,
    candidates: coverage.candidates,
    measured: coverage.measured,
    notMeasured: coverage.notMeasuredCount,
    ratio: coverage.coverage === null ? "Not applicable" : `${formatNumber(coverage.coverage * 100)}%`,
    floor: `${formatNumber(coverage.floor * 100)}%`,
    ok: coverage.ok,
  };
}

export function buildHtmlReportModel(report: Report): HtmlReportModel {
  const coverage = report.documents.map((document, documentIndex) => ({
    id: `coverage-document-${documentIndex + 1}`,
    path: document.path,
    verdict: document.verdict,
    rows: Object.entries(document.coverage).map(([ruleId, row], rowIndex) =>
      coverageRow(ruleId, row, documentIndex, rowIndex),
    ),
  }));
  const flatCoverage = coverage.flatMap((document) => document.rows);
  const shortfallCount = flatCoverage.filter((row) => !row.ok).length;
  const candidates = flatCoverage.reduce((sum, row) => sum + row.candidates, 0);
  const measured = flatCoverage.reduce((sum, row) => sum + row.measured, 0);
  const coverageTrust = report.runVerdict === "infrastructure"
    ? {
        label: "Not trustworthy",
        detail: candidates === 0
          ? "No trusted candidate coverage; the checker failed before trust could be established"
          : `Partial measurement only: ${measured} of ${candidates} candidates measured before the checker failed`,
        shortfallCount,
        candidates,
        measured,
      }
    : report.runVerdict === "insufficient-coverage"
    ? {
        label: shortfallCount > 0 ? "Below required floor" : "Not established",
        detail: shortfallCount > 0
          ? `${shortfallCount} rule check${shortfallCount === 1 ? "" : "s"} below the configured floor`
          : candidates === 0
            ? "No candidate coverage was established; no rule measured a candidate"
            : `Only ${measured} of ${candidates} candidates were measured; coverage was not established`,
        shortfallCount,
        candidates,
        measured,
      }
    : shortfallCount > 0
    ? {
        label: "Below required floor",
        detail: `${shortfallCount} rule check${shortfallCount === 1 ? "" : "s"} below the configured floor`,
        shortfallCount,
        candidates,
        measured,
      }
    : candidates === 0
      ? {
          label: "Coverage met",
          detail: "No applicable candidates",
          shortfallCount,
          candidates,
          measured,
        }
      : {
          label: "Coverage met",
          detail: `${measured} of ${candidates} candidates measured`,
          shortfallCount,
          candidates,
          measured,
        };

  return {
    status: { key: report.runVerdict, ...STATUS[report.runVerdict] },
    facts: mandatoryFacts(report),
    severity: {
      error: report.summary.error,
      warn: report.summary.warn,
      info: report.summary.info,
    },
    coverageTrust,
    findingsLead: STATUS[report.runVerdict].partial
      ? "Partial findings only. The run did not establish enough trust for these findings to describe the whole document."
      : report.findings.length === 0
        ? "The requested checks completed without a gate-triggering finding."
        : `${report.findings.length} measured finding${report.findings.length === 1 ? "" : "s"}, ordered as produced by the checker.`,
    findings: report.findings.map(findingModel),
    // Non-fatal apparatus diagnostics and positive second-opinion evidence remain visible too.
    // Presence is not equivalent to failure; `InfraLine.fatal` carries that engine decision.
    infrastructure: infraLines(report),
    coverage,
  };
}
