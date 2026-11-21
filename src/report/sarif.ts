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
/**
 * Every registered rule ships its page in docs/rules/ (package.json "files" includes docs/): the
 * rule-doc generator reads each rule's page and tests/unit/registry.test.ts fails on a missing one.
 * A rule id outside the registry (a screen rule, a page without a rule) has no shipped page here.
 */
const RULES_WITH_SHIPPED_PAGES: ReadonlySet<string> = new Set(ALL_RULES.map((rule) => rule.id));
const RELEASE_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

/**
 * The rule page of the release that wrote the report, pinned to its tag: a link to `main` would
 * describe whatever the rule has become since. `undefined` when the rule has no shipped page or
 * the version cannot name a release tag (the CLI's `0.0.0` fallback for an unreadable manifest).
 */
export function ruleHelpUri(ruleId: string, version: string): string | undefined {
  if (!RULES_WITH_SHIPPED_PAGES.has(ruleId) || !RELEASE_VERSION.test(version) || version === "0.0.0") return undefined;
  return `https://github.com/godarg/breaklint/blob/v${version}/docs/rules/${ruleId.replace("/", "-")}.md`;
}

export function renderSarif(report: Report): string {
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        columnKind: "unicodeCodePoints",
        tool: {
          driver: {
            name: "breaklint",
            version: report.tool.version,
            informationUri: "https://github.com/godarg/breaklint",
            rules: ALL_RULES.map((r) => {
              const helpUri = ruleHelpUri(r.id, report.tool.version);
              return {
                id: r.id,
                shortDescription: { text: r.summary },
                ...(helpUri ? { helpUri } : {}),
                defaultConfiguration: { level: sarifLevel(r.severity) },
                properties: {
                  calibrated: r.calibrated,
                  experimental: r.experimental,
                  proofSource: r.proofSource,
                },
              };
            }),
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
              level: line.level,
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
  const original = f.originalSource.status === "verified" && f.originalSource.role === "exact-original-range" ? f.originalSource.location : null;
  const location = original ?? f.source;
  const base = {
    ruleId: f.ruleId,
    level: sarifLevel(f.severity),
    message: { text: f.message },
    ...(f.stableIdentity.status === "unique" && f.stableIdentity.value ? { partialFingerprints: { "breaklint/logical-source-value-v1": f.stableIdentity.value } } : {}),
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
      sourceLocationKind: original ? "verified-original" : location ? "input-artifact" : "unknown",
      originalSourceStatus: f.originalSource.status,
      sourceRole: f.originalSource.role,
      stableIdentityStatus: f.stableIdentity.status,
    },
  };
  if (!location) {
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
          artifactLocation: { uri: location.file.split("/").map(encodeURIComponent).join("/") },
          region: { startLine: location.line, startColumn: location.column, endLine: location.endLine, endColumn: location.endColumn },
        },
      },
    ],
  };
}
