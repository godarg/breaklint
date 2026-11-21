/**
 * Shape check for a report handed to `compare`, `context` or `bundle` on the command line.
 *
 * The public API keeps its legacy fallback: `createContextPack()` and `renderReport()` accept any
 * value and mark an unreadable one as "legacy or invalid". The CLI is a different boundary. A CI
 * step that hands it the SARIF file, a context pack, a comparison or `package.json` by mistake
 * used to receive exit 0 and an empty projection, which a pipeline reads as success. Here an input
 * is accepted only when it is an object of a readable report version whose consumed parts have the
 * types the projections read; everything else ends with exit 2 and "is not a breaklint report".
 *
 * Additive fields are allowed: a newer producer may add keys, and nothing here rejects them. What
 * is required is exactly what the three subcommands read, so a field that no projection consumes
 * is not checked. This is not the full report schema (that remains a registered follow-up).
 */
import { READABLE_REPORT_SCHEMA_VERSIONS, RUN_VERDICTS, SEVERITIES } from "../core/enums.ts";
import type { Report } from "../core/types.ts";
import { READABLE_SCREEN_REPORT_SCHEMA_VERSIONS, type PublicScreenReport } from "../web/types.ts";

export type AcceptedProfiles = "document" | "document-or-screen";

class ShapeError extends Error {}

type Rec = Record<string, unknown>;

function fail(path: string, expected: string): never {
  throw new ShapeError(`${path} ${expected}`);
}

function record(value: unknown, path: string): Rec {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(path, "is not an object");
  return value as Rec;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "is not an array");
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "is not a string");
  return value;
}

function nullableText(value: unknown, path: string): void {
  if (value !== null && typeof value !== "string") fail(path, "is not a string or null");
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "is not a finite number");
  return value;
}

function nullableFinite(value: unknown, path: string): void {
  if (value !== null) finite(value, path);
}

function bool(value: unknown, path: string): void {
  if (typeof value !== "boolean") fail(path, "is not a boolean");
}

function oneOf(value: unknown, allowed: readonly unknown[], path: string): void {
  if (!allowed.includes(value)) fail(path, `is not one of ${allowed.map((item) => JSON.stringify(item)).join(", ")}`);
}

/** A measured value is a finite number, a boolean, a string or null; never an object or NaN. */
function scalar(value: unknown, path: string): void {
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  finite(value, path);
}

const EXIT_CODES = [0, 1, 2, 3, 4] as const;

function sourceRef(value: unknown, path: string): void {
  const ref = record(value, path);
  text(ref.file, `${path}.file`);
  for (const key of ["line", "column", "offset", "endLine", "endColumn", "endOffset"]) finite(ref[key], `${path}.${key}`);
  text(ref.coordinateSystem, `${path}.coordinateSystem`);
}

function nullableSourceRef(value: unknown, path: string): void {
  if (value !== null) sourceRef(value, path);
}

function documentFinding(value: unknown, path: string): void {
  const finding = record(value, path);
  for (const key of ["runFindingId", "fingerprint", "ruleId", "message", "document", "actionability"]) text(finding[key], `${path}.${key}`);
  oneOf(finding.severity, SEVERITIES, `${path}.severity`);
  finite(finding.page, `${path}.page`);
  const target = record(finding.target, `${path}.target`);
  text(target.keyType, `${path}.target.keyType`);
  text(target.nodeKey, `${path}.target.nodeKey`);
  finite(target.fragmentIndex, `${path}.target.fragmentIndex`);
  const measurement = record(finding.measurement, `${path}.measurement`);
  // A document finding records a number against a numeric threshold (Measurement); JSON has no
  // NaN or Infinity, so a non-finite measurement arrives as null and is refused here.
  finite(measurement.value, `${path}.measurement.value`);
  finite(measurement.threshold, `${path}.measurement.threshold`);
  text(measurement.unit, `${path}.measurement.unit`);
  const identity = record(finding.stableIdentity, `${path}.stableIdentity`);
  text(identity.status, `${path}.stableIdentity.status`);
  const evidence = record(finding.evidence, `${path}.evidence`);
  nullableText(evidence.ref, `${path}.evidence.ref`);
  bool(evidence.bindsFinding, `${path}.evidence.bindsFinding`);
  nullableSourceRef(finding.source, `${path}.source`);
  const original = record(finding.originalSource, `${path}.originalSource`);
  text(original.status, `${path}.originalSource.status`);
  text(original.role, `${path}.originalSource.role`);
  nullableSourceRef(original.location, `${path}.originalSource.location`);
  array(original.candidates, `${path}.originalSource.candidates`).forEach((candidate, index) => sourceRef(candidate, `${path}.originalSource.candidates[${index}]`));
  if (original.integrity !== null) {
    const integrity = record(original.integrity, `${path}.originalSource.integrity`);
    text(integrity.sha256, `${path}.originalSource.integrity.sha256`);
    finite(integrity.byteLength, `${path}.originalSource.integrity.byteLength`);
  }
  if (finding.ambiguity !== null && finding.ambiguity !== undefined) {
    finite(record(finding.ambiguity, `${path}.ambiguity`).groupSize, `${path}.ambiguity.groupSize`);
  }
}

function documentEvaluation(value: unknown, path: string): void {
  const evaluation = record(value, path);
  text(evaluation.ruleId, `${path}.ruleId`);
  text(evaluation.status, `${path}.status`);
  const target = record(evaluation.targetRef, `${path}.targetRef`);
  text(target.nodeKey, `${path}.targetRef.nodeKey`);
  finite(target.fragmentIndex, `${path}.targetRef.fragmentIndex`);
  record(evaluation.predicate, `${path}.predicate`);
  array(evaluation.measurements, `${path}.measurements`).forEach((item, index) => {
    const measurement = record(item, `${path}.measurements[${index}]`);
    text(measurement.name, `${path}.measurements[${index}].name`);
    scalar(measurement.value, `${path}.measurements[${index}].value`);
    scalar(measurement.threshold ?? null, `${path}.measurements[${index}].threshold`);
  });
}

function documentReport(report: Rec): void {
  for (const key of ["runId"]) text(report[key], key);
  oneOf(report.runVerdict, RUN_VERDICTS, "runVerdict");
  oneOf(report.exitCode, EXIT_CODES, "exitCode");
  text(record(report.tool, "tool").version, "tool.version");
  const config = record(report.config, "config");
  text(config.fingerprint, "config.fingerprint");
  array(config.activeRules, "config.activeRules").forEach((rule, index) => text(rule, `config.activeRules[${index}]`));
  record(report.environment, "environment");
  array(report.findings, "findings").forEach((finding, index) => documentFinding(finding, `findings[${index}]`));
  array(report.evaluations, "evaluations").forEach((evaluation, index) => documentEvaluation(evaluation, `evaluations[${index}]`));
  array(report.documents, "documents").forEach((item, index) => {
    const path = `documents[${index}]`;
    const document = record(item, path);
    text(document.path, `${path}.path`);
    array(document.findings, `${path}.findings`).forEach((finding, inner) => documentFinding(finding, `${path}.findings[${inner}]`));
    array(document.evaluations, `${path}.evaluations`).forEach((evaluation, inner) => documentEvaluation(evaluation, `${path}.evaluations[${inner}]`));
    array(document.infrastructure, `${path}.infrastructure`).forEach((event, inner) => {
      const entry = record(event, `${path}.infrastructure[${inner}]`);
      text(entry.kind, `${path}.infrastructure[${inner}].kind`);
    });
    array(document.notMeasured, `${path}.notMeasured`).forEach((event, inner) => {
      const entry = record(event, `${path}.notMeasured[${inner}]`);
      text(entry.reason, `${path}.notMeasured[${inner}].reason`);
      finite(entry.count, `${path}.notMeasured[${inner}].count`);
    });
    array(document.evidence, `${path}.evidence`).forEach((event, inner) => record(event, `${path}.evidence[${inner}]`));
    for (const [ruleId, value] of Object.entries(record(document.coverage, `${path}.coverage`))) {
      const coverage = record(value, `${path}.coverage[${JSON.stringify(ruleId)}]`);
      for (const key of ["candidates", "measured", "notMeasuredCount"]) finite(coverage[key], `${path}.coverage[${JSON.stringify(ruleId)}].${key}`);
      nullableFinite(coverage.floor ?? null, `${path}.coverage[${JSON.stringify(ruleId)}].floor`);
      array(coverage.notMeasured, `${path}.coverage[${JSON.stringify(ruleId)}].notMeasured`);
    }
  });
}

function screenTarget(value: unknown, path: string): void {
  const target = record(value, path);
  text(target.selector, `${path}.selector`);
  text(target.coordinateSystem, `${path}.coordinateSystem`);
  if (target.box !== null) {
    const box = record(target.box, `${path}.box`);
    for (const key of ["x", "y", "width", "height"]) finite(box[key], `${path}.box.${key}`);
  }
  const scroll = record(target.scroll, `${path}.scroll`);
  finite(scroll.x, `${path}.scroll.x`);
  finite(scroll.y, `${path}.scroll.y`);
}

function screenReport(report: Rec): void {
  text(report.runId, "runId");
  oneOf(report.runVerdict, RUN_VERDICTS, "runVerdict");
  oneOf(report.exitCode, EXIT_CODES, "exitCode");
  const scope = record(report.scope, "scope");
  text(scope.scenario, "scope.scenario");
  text(scope.url, "scope.url");
  const viewport = record(scope.viewport, "scope.viewport");
  for (const key of ["width", "height", "deviceScaleFactor"]) finite(viewport[key], `scope.viewport.${key}`);
  const inventory = record(report.targetInventory, "targetInventory");
  bool(inventory.complete, "targetInventory.complete");
  finite(inventory.omittedCount, "targetInventory.omittedCount");
  nullableText(inventory.reason, "targetInventory.reason");
  finite(record(report.coverage, "coverage").notMeasured, "coverage.notMeasured");
  const artifact = record(report.artifact, "artifact");
  nullableText(artifact.relativePath, "artifact.relativePath");
  nullableText(artifact.sha256, "artifact.sha256");
  for (const key of ["byteLength", "widthPx", "heightPx"]) nullableFinite(artifact[key], `artifact.${key}`);
  text(artifact.capture, "artifact.capture");
  array(report.evaluations, "evaluations").forEach((item, index) => {
    const path = `evaluations[${index}]`;
    const evaluation = record(item, path);
    text(evaluation.id, `${path}.id`);
    text(evaluation.ruleId, `${path}.ruleId`);
    text(evaluation.status, `${path}.status`);
    nullableText(evaluation.reason ?? null, `${path}.reason`);
    if (evaluation.source !== undefined) {
      const source = record(evaluation.source, `${path}.source`);
      text(source.status, `${path}.source.status`);
      nullableText(source.file, `${path}.source.file`);
    }
  });
  array(report.findings, "findings").forEach((item, index) => {
    const path = `findings[${index}]`;
    const finding = record(item, path);
    for (const key of ["id", "ruleId", "evaluationId"]) text(finding[key], `${path}.${key}`);
    oneOf(finding.severity, SEVERITIES, `${path}.severity`);
    screenTarget(finding.target, `${path}.target`);
    const measurement = record(finding.measurement, `${path}.measurement`);
    scalar(measurement.value, `${path}.measurement.value`);
    scalar(measurement.threshold ?? null, `${path}.measurement.threshold`);
    nullableText(measurement.unit ?? null, `${path}.measurement.unit`);
    const evidence = record(finding.evidence, `${path}.evidence`);
    bool(evidence.bindsFinding, `${path}.evidence.bindsFinding`);
    nullableText(evidence.screenshot, `${path}.evidence.screenshot`);
  });
  array(report.infrastructure, "infrastructure").forEach((item, index) => {
    const event = record(item, `infrastructure[${index}]`);
    text(event.kind, `infrastructure[${index}].kind`);
  });
  array(report.events, "events").forEach((item, index) => {
    const event = record(item, `events[${index}]`);
    text(event.kind, `events[${index}].kind`);
  });
}

/**
 * Returns the input typed as a report, or throws an Error whose message names the first field
 * that does not have the type a projection reads. `accept` names the profiles the subcommand
 * reads: `compare` reads document reports only.
 */
export function assertReadableReport(raw: unknown, accept: "document"): Report;
export function assertReadableReport(raw: unknown, accept: AcceptedProfiles): Report | PublicScreenReport;
export function assertReadableReport(raw: unknown, accept: AcceptedProfiles): Report | PublicScreenReport {
  try {
    const report = record(raw, "the top level");
    const profileKind = report.profileKind;
    const allowedProfiles = accept === "document" ? ["document"] : ["document", "screen"];
    oneOf(profileKind, allowedProfiles, "profileKind");
    if (profileKind === "screen") {
      oneOf(report.schemaVersion, READABLE_SCREEN_REPORT_SCHEMA_VERSIONS, "schemaVersion of a screen report");
      screenReport(report);
      return raw as PublicScreenReport;
    }
    oneOf(report.schemaVersion, READABLE_REPORT_SCHEMA_VERSIONS, "schemaVersion of a document report");
    documentReport(report);
    return raw as Report;
  } catch (error) {
    if (error instanceof ShapeError) throw new Error(error.message);
    throw error;
  }
}
