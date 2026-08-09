/**
 * The normative enumerations. This file is the single source; nothing else declares these
 * values. Types are derived from the arrays, never written twice.
 *
 * Why arrays and not TypeScript unions: a union exists only at compile time. Several of these
 * sets have to be *iterated* at run time — the report validator walks them, and the rule
 * registry is checked against them. A set that can only be checked by the compiler cannot be
 * checked by a test.
 */

/** Reasons a measurement did not happen. They appear only in `NotMeasured.reason`. */
export const ENV_IDS = [
  "env/multicolumn",
  "env/vertical-writing",
  "env/forced-break",
  "env/forced-break-inert",
  "env/parity-blank-page",
  "env/svg-not-inline",
  "env/svg-no-text",
  "env/svg-overflow-visible",
  "env/svg-too-many-text-targets",
  "env/canvas-content-lost",
  "env/pixel-oracle-unavailable",
  "env/ink-passes-unstable",
  "env/page-area-static",
  "env/evidence-overlay-removed",
] as const;
export type EnvId = (typeof ENV_IDS)[number];

/**
 * States of the measuring infrastructure. They appear only in `documents[].infrastructure[]`
 * and never carry an `env/` prefix — three of them were written with one by mistake once, and
 * a report that did so would not match its own schema.
 */
export const INFRA_EVENT_KINDS = [
  "empty-input",
  "renderer-missing",
  "font-load-failed",
  "pagination-aborted",
  "after-rendered-missing",
  "checker-crashed",
  "render-unstable",
  "document-not-quiescent",
  "injection-interference",
  "source-id-namespace-collision",
  "limit-exceeded",
  "mark-style-overridden",
  "mark-raster-diff",
  "renderer-not-terminated",
  "break-cause-undetermined",
  "pagedjs-version-unsupported",
  /**
   * The in-page probe and the browser's own layout tree disagree about where something is.
   *
   * Fatal, and it has to be: every number in the snapshot comes from the probe, so a probe whose
   * geometry does not match what CDP reads out of process is describing a document that does not
   * exist. No partial report is worth writing from that.
   */
  "geometry-cross-check-failed",
] as const;
export type InfraEventKind = (typeof INFRA_EVENT_KINDS)[number];

/**
 * The infrastructure kinds that do NOT make a run exit 3.
 *
 * Everything else about the measuring apparatus failing means the report cannot be trusted. These
 * three mean something narrower and the contract says so in as many words: for the two mark
 * kinds, "the document is in order, only the binding is not" (§11.4.1). Losing the evidence for a
 * finding is not the same as being unable to measure the document, and a tool that exits 3
 * because a hostile stylesheet reached its own overlay would be unusable on exactly the documents
 * it exists for. `empty-input` is here because an empty document is a coverage question.
 *
 * The list is deliberately small and deliberately explicit: an infrastructure kind added later is
 * fatal unless someone decides otherwise, which is the safe default direction.
 */
export const NON_FATAL_INFRA_EVENT_KINDS = [
  "empty-input",
  "mark-style-overridden",
  "mark-raster-diff",
] as const satisfies readonly InfraEventKind[];

/** Fingerprint key types. */
export const KEY_TYPES = ["block", "page", "resource", "generated", "svg-text"] as const;
export type KeyType = (typeof KEY_TYPES)[number];

/** What an unmeasured item refers to. */
export const NOT_MEASURED_SCOPES = [
  "document",
  "page",
  "block",
  "svg",
  "svgText",
  "textRun",
  "resource",
] as const;
export type NotMeasuredScope = (typeof NOT_MEASURED_SCOPES)[number];

/**
 * What did the rasterising. One value only: the evidence path rasterises the produced PDF in
 * the browser that Paged.js needs anyway. `browser-screenshot` and `external` were removed
 * when the evidence binding moved into the print medium.
 */
export const RASTERIZERS = ["pdfjs-dist"] as const;
export type Rasterizer = (typeof RASTERIZERS)[number];

/** How the run was invoked. */
export const REPORT_MODES = ["live", "demo"] as const;
export type ReportMode = (typeof REPORT_MODES)[number];

/**
 * Where the measurements came from. `recorded snapshot fixture` is only permitted once a
 * snapshot has actually been recorded from a render — a report must not flatter its own
 * provenance.
 */
export const REPORT_SOURCES = [
  "rendered",
  "recorded snapshot fixture",
  "handwritten snapshot fixture",
] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];

/** Network mode. Separate from `Report.mode`; two fields named `mode` mean two enumerations. */
export const NETWORK_MODES = ["offline", "allowlist"] as const;
export type NetworkMode = (typeof NETWORK_MODES)[number];

/** What was rasterised. Always the produced PDF in v1. */
export const EVIDENCE_ORIGINS = ["pdf-raster"] as const;
export type EvidenceOrigin = (typeof EVIDENCE_ORIGINS)[number];

/**
 * From what the break cause was determined. Deliberately not called `source`: `Report.source`
 * means something else, and two fields of the same name with different meanings is the
 * collision this project punishes elsewhere.
 */
export const BREAK_CAUSE_DETERMINED_BY = [
  "pagedjs-break-attributes",
  "page-blank",
  "break-token",
  "document-boundary",
  "undetermined",
] as const;
export type BreakCauseDeterminedBy = (typeof BREAK_CAUSE_DETERMINED_BY)[number];

/** The cause of a page boundary. */
export const BREAK_CAUSE_KINDS = [
  "forced",
  "overflow",
  "parity",
  "document-start",
  "document-end",
  "unknown",
] as const;
export type BreakCauseKind = (typeof BREAK_CAUSE_KINDS)[number];

/** Where a break declaration won in the browser cascade. A hint, never normative. */
export const BREAK_CAUSE_CASCADE_HINTS = ["stylesheet", "inline", "none"] as const;
export type BreakCauseCascadeHint = (typeof BREAK_CAUSE_CASCADE_HINTS)[number];

/** Verdicts, one per document and one per run. */
export const RUN_VERDICTS = [
  "clean",
  "findings",
  "insufficient-coverage",
  "infrastructure",
  "usage",
] as const;
export type RunVerdict = (typeof RUN_VERDICTS)[number];

/** Severity. `info` is off by default. */
export const SEVERITIES = ["error", "warn", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * The gate threshold. `error` is the default: only two rules carry a named proof source, and a
 * tool that breaks a build on thirteen self-declared uncalibrated heuristics contradicts its
 * own burden-of-proof rule.
 */
export const FAIL_ON_VALUES = ["error", "warn", "never"] as const;
export type FailOn = (typeof FAIL_ON_VALUES)[number];

/** Output formats. `json` is the truth; every other format is a lossy projection of it. */
export const OUTPUT_FORMATS = ["json", "sarif", "console", "html", "junit", "markdown"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** Proof classes for `error`. `C` is defined but claimed by no v1 rule — no spike supports it. */
export const PROOF_SOURCES = ["A", "B", "C"] as const;
export type ProofSource = (typeof PROOF_SOURCES)[number];

/** Rule namespaces. `env/` is deliberately absent: those are diagnoses, not rules. */
export const RULE_NAMESPACES = ["layout", "svg", "type", "artifact"] as const;
export type RuleNamespace = (typeof RULE_NAMESPACES)[number];

/** Exit codes, paired with their verdicts. */
export const EXIT_CODE_BY_VERDICT: Readonly<Record<RunVerdict, 0 | 1 | 2 | 3 | 4>> = {
  clean: 0,
  findings: 1,
  usage: 2,
  infrastructure: 3,
  "insufficient-coverage": 4,
};

/**
 * Verdict precedence, strongest first. A run takes the strongest verdict of any document.
 *
 * `usage` first because an invalid invocation means the run was never validly configured.
 * `infrastructure` before `insufficient-coverage` because a broken renderer *causes* coverage
 * gaps — reporting 4 would send the reader into the document while the renderer is at fault.
 * `insufficient-coverage` before `findings` because otherwise the reader fixes the findings,
 * gets 0, and part of the corpus is still unjudged.
 */
export const VERDICT_PRECEDENCE: readonly RunVerdict[] = [
  "usage",
  "infrastructure",
  "insufficient-coverage",
  "findings",
  "clean",
];

/** Coverage floors by severity. `error` demands full coverage; see `docs/limitations.md`. */
export const COVERAGE_FLOOR_BY_SEVERITY: Readonly<Record<Severity, number>> = {
  error: 1.0,
  warn: 0.5,
  info: 0,
};

/** The one Paged.js version this release is measured against. Not a range — see `docs/`. */
export const SUPPORTED_PAGEDJS_VERSION = "0.4.3";
export const SUPPORTED_PDFJS_VERSION = "6.2.108";

/** Report and snapshot schema version. Raised on every incompatible change, both together. */
export const SCHEMA_VERSION = 2;

const asSet = <T extends string>(values: readonly T[]): ReadonlySet<string> => new Set(values);

/** Membership tests, used by the report validator and by the registry check. */
export const IS = {
  envId: asSet(ENV_IDS),
  infraEventKind: asSet(INFRA_EVENT_KINDS),
  nonFatalInfraEventKind: asSet(NON_FATAL_INFRA_EVENT_KINDS),
  keyType: asSet(KEY_TYPES),
  notMeasuredScope: asSet(NOT_MEASURED_SCOPES),
  rasterizer: asSet(RASTERIZERS),
  reportMode: asSet(REPORT_MODES),
  reportSource: asSet(REPORT_SOURCES),
  networkMode: asSet(NETWORK_MODES),
  evidenceOrigin: asSet(EVIDENCE_ORIGINS),
  breakCauseDeterminedBy: asSet(BREAK_CAUSE_DETERMINED_BY),
  breakCauseKind: asSet(BREAK_CAUSE_KINDS),
  breakCauseCascadeHint: asSet(BREAK_CAUSE_CASCADE_HINTS),
  runVerdict: asSet(RUN_VERDICTS),
  severity: asSet(SEVERITIES),
  failOn: asSet(FAIL_ON_VALUES),
  outputFormat: asSet(OUTPUT_FORMATS),
  proofSource: asSet(PROOF_SOURCES),
  ruleNamespace: asSet(RULE_NAMESPACES),
} as const;
