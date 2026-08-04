import type { Finding, Report } from "../core/types.ts";
import { summaryLine } from "./mandatory.ts";
import { infraLines } from "./infra.ts";
import { ALL_RULES } from "../rules/index.ts";

/**
 * SARIF 2.1.0.
 *
 * One rule of this format is not cosmetic: a finding whose source is `null` must not carry a
 * `physicalLocation`. Fourteen margin boxes produced by the paginator have no source id at all,
 * and pointing a code-scanning UI at "line 1 of the input file" for them would be an invented
 * fact. Those become `logicalLocations` instead.
 */
export function renderSarif(report: Report): string {
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "breaklint",
            version: report.tool.version,
            informationUri: "https://github.com/godarg/breaklint",
            rules: ALL_RULES.map((r) => ({
              id: r.id,
              shortDescription: { text: r.summary },
              defaultConfiguration: { level: sarifLevel(r.severity) },
              properties: {
                calibrated: r.calibrated,
                experimental: r.experimental,
                proofSource: r.proofSource,
              },
            })),
          },
        },
        invocations: [
          {
            executionSuccessful: report.runVerdict === "clean" || report.runVerdict === "findings",
            exitCode: report.exitCode,
            // The honesty layer, in the one free-text field every SARIF consumer shows.
            workingDirectory: { uri: "." },
            // `executionSuccessful: false` says the run failed and not WHY. A reader of this
            // format got no kind and no reason at all until an audit measured it; SARIF has a
            // standard place for exactly this, and it is `toolExecutionNotifications`.
            toolExecutionNotifications: infraLines(report).map((line) => ({
              level: "error",
              message: { text: `${line.kind}: ${line.detail}` },
              properties: { kind: line.kind, document: line.document, measured: line.measured },
            })),
            properties: { summary: summaryLine(report) },
          },
        ],
        results: report.findings.map((f) => toResult(f)),
        properties: {
          inputsFound: report.inputsFound,
          pagesAnalysed: report.pagesAnalysed,
          rulesRun: report.rulesRun,
          measuredRules: report.measuredRules,
          runVerdict: report.runVerdict,
          mode: report.mode,
          failOn: report.config.failOn,
          gateTriggeredBy: report.summary.gateTriggeredBy,
          notMeasuredTotal: report.documents.reduce(
            (sum, d) => sum + d.notMeasured.reduce((s, n) => s + n.count, 0),
            0,
          ),
        },
      },
    ],
  };
  return JSON.stringify(sarif, null, 2) + "\n";
}

function sarifLevel(severity: string): "error" | "warning" | "note" {
  return severity === "error" ? "error" : severity === "warn" ? "warning" : "note";
}

function toResult(f: Finding) {
  const base = {
    ruleId: f.ruleId,
    level: sarifLevel(f.severity),
    message: { text: f.message },
    properties: {
      page: f.page,
      measured: f.measurement.value,
      threshold: f.measurement.threshold,
      unit: f.measurement.unit,
      calibrated: f.measurement.calibrated,
      experimental: f.experimental,
      fingerprint: f.fingerprint,
      evidence: f.evidence.ref,
      evidenceBindsFinding: f.evidence.bindsFinding,
    },
  };
  if (!f.source) {
    return {
      ...base,
      locations: [
        {
          logicalLocations: [{ name: f.target.nodeKey, kind: "element", fullyQualifiedName: f.target.keyType }],
        },
      ],
    };
  }
  return {
    ...base,
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: f.source.file },
          region: { startLine: f.source.line, startColumn: f.source.column },
        },
      },
    ],
  };
}
