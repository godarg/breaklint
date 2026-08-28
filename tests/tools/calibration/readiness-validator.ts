#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import type { RuleResult } from "../../../src/core/rule.ts";
import type { Snapshot, SvgRecord } from "../../../src/core/types.ts";
import { RULES_BY_ID } from "../../../src/rules/index.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const RULE_IDS = ["svg/text-clipped", "svg/text-ink-collision", "svg/text-overflows-viewport"] as const;
type RuleId = (typeof RULE_IDS)[number];
type Split = "development" | "tuning" | "holdout";
const MINIMUM_REAL_DOCUMENTS = 30;
const RUN_LOCAL_TARGET_TOKENS = ["data-bl-svg-target", "dom-ordinal", "nodekey", "fingerprint"];
const GUIDELINE_BY_RULE: Readonly<Record<RuleId, string>> = Object.freeze({
  "svg/text-clipped": "svg-text-clipped-v1",
  "svg/text-ink-collision": "svg-text-ink-collision-v1",
  "svg/text-overflows-viewport": "svg-text-overflows-viewport-v1",
});
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

export interface Annotation {
  annotationId: string;
  annotatorId: string;
  targetId: string;
  ruleId: RuleId;
  guidelineVersion: string;
  createdAt: string;
  blinded: true;
  breaklintResultExposed: false;
  label: "positive" | "negative" | "ambiguous" | "abstain" | "invalid_target";
  rationale: string;
}
interface Adjudication {
  adjudicationId: string;
  adjudicatorIds: string[];
  guidelineVersion: string;
  createdAt: string;
  finalLabel: "positive" | "negative" | "ambiguous" | "excluded_invalid";
  rationale: string;
}
type OracleEvidenceKind = "artifact-bytes" | "authored-svg-semantics" | "synthetic-construction" | "neutral-counterfactual-render" | "independent-render-geometry" | "authored-viewport-boundary" | "blind-human-annotation" | "independent-adjudication";
export interface Target {
  targetId: string;
  svgRootKey: string;
  sourceIdentity: string;
  ruleId: RuleId;
  oracle: { oracleVersion: "m3-0-oracle-v1"; evidenceKinds: OracleEvidenceKind[]; groundTruth: string };
  annotations: Annotation[];
  ambiguityStatus: "unambiguous" | "ambiguous" | "abstained" | "invalid_target";
  adjudication: Adjudication | null;
}
export interface DocumentEntry {
  documentId: string;
  artifact: { sha256: string; storage: "public-repository" | "external-private"; relativePath: string | null; mediaType: string };
  realDocument: boolean;
  split: Split;
  originGroupId: string;
  duplicateGroupId: string | null;
  derivationGroupId: string | null;
  parentTemplateGroupId: string | null;
  provenance: { provenanceClass: string; sourceLocator: string; sourceEvidence: string };
  license: { status: string; evidence: string };
  privacy: { status: string; reviewEvidence: string };
  capturedAt: string;
  rendererFreeze: { rendererFreezeId: string; fonts: unknown[]; [key: string]: unknown };
  targets: Target[];
}
export interface HoldoutFreeze {
  holdoutId: string;
  holdoutLineageId: string;
  preregistrationReceiptSha256: string;
  version: number;
  frozenAt: string;
  reason: string;
  approverId: string;
  orderedDocuments: { documentId: string; artifactSha256: string; originGroupId: string }[];
  manifestHash: string;
  annotationHash: string;
  adjudicationHash: string;
  rendererFreezeIds: string[];
  acceptancePlanHashes: string[];
}
export interface ReadinessClaim {
  ruleId: RuleId;
  calibrationMode: "empirical-threshold" | "structural-validation";
  ruleReadyForCalibration: boolean;
  ruleReadyForCalibratedClaim: boolean;
  calibratedClaim: boolean;
  eligibleRealDocuments: number;
  eligibleOriginGroups: number;
  acceptedSamplingPlan: boolean;
  candidateConfigHash: string | null;
  rendererFreezeId: string | null;
  rendererContentHash: string | null;
  thresholdCandidateHash: string | null;
  acceptanceGateVersion: string | null;
  acceptancePlanSha256: string | null;
  preregistrationReceiptSha256: string | null;
  holdoutLineageId: string | null;
  outcomeSha256: string | null;
  acceptanceReportSha256: string | null;
}
export interface PreregistrationReceipt {
  contractVersion: "m3-0-preregistration-receipt-v1";
  receiptId: string;
  issuedAt: string;
  planSha256: string;
  holdoutLineageId: string;
  holdoutId: string;
}
interface OutcomeRow {
  documentId: string; artifactSha256: string; targetId: string; ruleId: RuleId;
  oracleSnapshotSha256: string; annotationSnapshotSha256: string; adjudicationSnapshotSha256: string;
  evaluationDisposition: "included" | "excluded"; groundTruth: "positive" | "negative" | null;
  excludedReason: "ambiguous" | "abstained" | "invalid_target" | "production-declined" | null;
  candidateConfigHash: string; rendererFreezeId: string; rendererContentHash: string; planSha256: string;
  preregistrationReceiptSha256: string; holdoutLineageId: string; holdoutId: string; holdoutVersion: number;
  productionEvaluationRowSha256: string;
  productionDecision: "finding" | "clean" | "declined";
}
export interface OutcomeArtifact {
  contractVersion: "m3-0-outcome-v1"; outcomeId: string; createdAt: string; ruleId: RuleId;
  holdoutLineageId: string; holdoutId: string; holdoutVersion: number; holdoutManifestHash: string;
  candidateConfigHash: string; rendererFreezeId: string; rendererContentHash: string;
  planSha256: string; preregistrationReceiptSha256: string; rows: OutcomeRow[];
  productionEvaluationSha256: string;
}
export type CandidateConfig = { ruleId: "svg/text-clipped"; maxMissingInk: number } | { ruleId: "svg/text-ink-collision"; minCollisionInk: number; minOccludedInk: number } | { ruleId: "svg/text-overflows-viewport"; maxOvershootPx: 0 };
export interface SnapshotProjection {
  schemaVersion: 1;
  documentPath: string;
  pageNumber: number;
  svg: Omit<SvgRecord, "reason"> & { reason: SvgRecord["reason"] | null };
}
export interface MeasurementReceiptRow { documentId: string; artifactSha256: string; targetId: string; ruleId: RuleId; candidateConfigHash: string; rendererFreezeId: string; rendererContentHash: string; measuredAt: string; snapshot: SnapshotProjection }
export interface MeasurementReceipt {
  contractVersion: "m3-0-measurement-receipt-v1"; receiptId: string; createdAt: string;
  evidentiaryStatus: "externally-attested-real-render" | "non-evidentiary-contract-simulation";
  captureAttestationSha256: string | null;
  producer: { contractId: "breaklint-svg-measurement-producer"; contractVersion: "m3-0-measurement-producer-v1"; sourceIdentity: unknown; sourceIdentitySha256: string };
  ruleContract: { ruleId: RuleId; moduleRelativePath: string; sourceSha256: string; executableContractVersion: "m3-0-real-rule-run-v1" };
  ruleId: RuleId; candidateConfig: CandidateConfig; candidateConfigHash: string; rendererFreezeId: string; rendererContentHash: string; rows: MeasurementReceiptRow[];
}
export interface CaptureAttestation {
  contractVersion: "m3-0-capture-attestation-v1";
  attestationId: string; attestorId: string; issuedAt: string; measurementReceiptId: string;
  ruleId: RuleId; candidateConfigHash: string; rendererFreezeId: string; rendererContentHash: string;
  producerSourceIdentitySha256: string; rowsSha256: string; artifactTargetSetSha256: string;
  captureEvidenceSha256: string;
}
export interface CaptureEvidenceBundle {
  contractVersion: "m3-0-capture-evidence-bundle-v1";
  bundleId: string; capturedAt: string; measurementReceiptId: string; ruleId: RuleId;
  candidateConfigHash: string; rendererFreezeId: string; rendererContentHash: string;
  producerSourceIdentitySha256: string; productRuleSourceSha256: string;
  rowsSha256: string; artifactTargetSetSha256: string; rawMeasurementsSha256: string;
  rows: { documentId: string; artifactSha256: string; targetId: string; ruleId: RuleId; rendererFreezeId: string; rendererContentHash: string; measuredAt: string; rawMeasurementSha256: string }[];
}
interface RuleResultProjection { findings: { ruleId: RuleId; targetSvgTextKey: string; value: number; threshold: number; unit: string }[]; candidates: number; measured: number; notMeasured: { scope: "svg" | "svgText"; ruleId: RuleId; reason: string; count: number }[] }
interface ProductionEvaluationRow { documentId: string; artifactSha256: string; targetId: string; ruleId: RuleId; candidateConfigHash: string; rendererFreezeId: string; rendererContentHash: string; measurementReceiptRowSha256: string; ruleResult: RuleResultProjection; productionDecision: "finding" | "clean" | "declined" }
export interface ProductionEvaluation { contractVersion: "m3-0-production-evaluation-v1"; evaluationId: string; createdAt: string; ruleId: RuleId; ruleExecutableContractVersion: "m3-0-real-rule-run-v1"; productRuleSourceSha256: string; measurementReceiptSha256: string; candidateConfig: CandidateConfig; candidateConfigHash: string; rows: ProductionEvaluationRow[] }
interface DerivedOutcome {
  outcome: OutcomeArtifact;
  claimEvidentiary: boolean;
  captureEvidenceBytesValid: boolean;
  captureAttestorTrustValid: boolean;
  truePositive: number; trueNegative: number; falsePositive: number; falseNegative: number;
  excludedAmbiguous: number; evaluatedTargetCount: number; includedBinaryTargetCount: number;
  excludedTargetCount: number; eligibleHoldoutDocuments: number; eligibleHoldoutOriginGroups: number;
}
export interface Manifest {
  contractVersion: string;
  schemaVersion: number;
  manifestId: string;
  createdAt: string;
  documents: DocumentEntry[];
  preregistrationAnchors: { receiptId: string; receiptSha256: string; planSha256: string; holdoutLineageId: string; holdoutId: string; recordedAt: string; firstHoldoutAccessAt: string }[];
  holdoutFreeze: HoldoutFreeze | null;
  candidateSelections: { selectionId: string; ruleId: RuleId; createdAt: string; holdoutLineageId: string; holdoutId: string; preregistrationReceiptSha256: string; preregisteredPlanId: string; planSha256: string; candidateConfigHash: string; thresholdCandidateHash: string | null; inputSplits: Split[]; inputDocumentIds: string[]; evidenceHashes: string[]; holdoutOutcomeUsed: boolean }[];
  evaluationLedger: { eventId: string; createdAt: string; purpose: string; holdoutLineageId: string; holdoutId: string; holdoutVersion: number; holdoutManifestHash: string; rendererFreezeIds: string[]; preregistrationReceiptSha256: string; candidateConfigHash: string; planSha256: string; productionEvaluationSha256: string; outcomeSha256: string; acceptanceReportSha256: string; lineageSnapshotSha256: string; appendOnlySequence: number }[];
  readinessClaims: ReadinessClaim[];
}
export interface TrustLedger {
  contractVersion: "m3-0-trust-ledger-v1";
  ledgerId: string;
  createdAt: string;
  attestations: { attestationId: string; reviewerId: string; reviewedAt: string; documentId: string; artifactSha256: string; originGroupId: string; provenanceEvidenceSha256: string; licenseEvidenceSha256: string; privacyEvidenceSha256: string; approvedForCalibration: true }[];
}
export interface AcceptanceReport {
  contractVersion: "m3-0-acceptance-report-v1";
  reportId: string;
  createdAt: string;
  ruleId: RuleId;
  holdoutLineageId: string;
  holdoutId: string;
  holdoutVersion: number;
  holdoutManifestHash: string;
  candidateConfigHash: string;
  rendererFreezeId: string;
  rendererContentHash: string;
  acceptanceGateVersion: string;
  preregisteredPlanId: string;
  planSha256: string;
  preregistrationReceiptSha256: string;
  outcomeSha256: string;
  eligibleHoldoutDocuments: number;
  eligibleHoldoutOriginGroups: number;
  ambiguityExcluded: true;
  evaluatedTargetCount: number;
  includedBinaryTargetCount: number;
  excludedTargetCount: number;
  confusionCounts: { truePositive: number; trueNegative: number; falsePositive: number; falseNegative: number; excludedAmbiguous: number };
  gates: { metric: "precision" | "recall" | "specificity" | "false-positive-rate"; operator: ">=" | "<="; threshold: number }[];
}
export interface AcceptancePlan {
  contractVersion: "m3-0-acceptance-plan-v1";
  planId: string;
  planVersion: number;
  samplingPlanId: string;
  samplingPlanVersion: number;
  acceptanceGateVersion: string;
  createdAt: string;
  ruleId: RuleId;
  candidateSelectionId: string;
  candidateConfigHash: string;
  thresholdCandidateHash: string | null;
  gates: AcceptanceReport["gates"];
}
interface EncodedArtifact { sha256: string; bytesBase64: string }
export interface LineageSnapshot {
  contractVersion: "m3-0-lineage-snapshot-v1"; snapshotId: string; createdAt: string; eventId: string;
  holdoutLineageId: string; holdoutId: string; holdoutVersion: number; freeze: HoldoutFreeze;
  documentSplits: { documentId: string; split: Split }[];
  knownOutcomeSha256s: string[];
  targetTuples: { documentId: string; artifactSha256: string; originGroupId: string; targetId: string; svgRootKey: string; sourceIdentity: string; ruleId: RuleId; oracleSnapshotSha256: string; annotationSnapshotSha256: string; adjudicationSnapshotSha256: string; finalLabel: "positive" | "negative" | "ambiguous" | "excluded_invalid"; ambiguityStatus: "unambiguous" | "ambiguous" | "abstained" | "invalid_target"; rendererFreezeId: string; rendererContentHash: string; rendererSourceIdentitySha256: string }[];
  artifacts: { preregistrationReceipt: EncodedArtifact; acceptancePlan: EncodedArtifact; candidateSelection: EncodedArtifact; captureEvidenceBundle: EncodedArtifact | null; captureAttestation: EncodedArtifact | null; measurementReceipt: EncodedArtifact; productionEvaluation: EncodedArtifact; outcome: EncodedArtifact; acceptanceReport: EncodedArtifact };
}
export interface ExternalArtifact<T = unknown> { bytes: Buffer; value: T }
interface DecodedExternalArtifact<T> { bytes: Buffer; value: T; sha256: string }
export interface ValidationOptions { manifestBytes?: Buffer; artifactRoot?: string; previousManifest?: unknown; trustLedger?: ExternalArtifact<unknown>; acceptancePlans?: ExternalArtifact<unknown>[]; preregistrationReceipts?: ExternalArtifact<unknown>[]; captureEvidenceBundles?: ExternalArtifact<unknown>[]; captureAttestations?: ExternalArtifact<unknown>[]; measurementReceipts?: ExternalArtifact<unknown>[]; productionEvaluations?: ExternalArtifact<unknown>[]; outcomes?: ExternalArtifact<unknown>[]; acceptanceReports?: ExternalArtifact<unknown>[]; lineageSnapshots?: ExternalArtifact<unknown>[] }
export interface ValidationIssue { code: string; path: string; message: string }
export interface RuleReadiness { calibration_mode: "empirical-threshold" | "structural-validation"; eligible_real_documents: number; eligible_origin_groups: number; eligible_real_evidentiary_holdout_documents: number; eligible_real_evidentiary_holdout_origin_groups: number; capture_evidence_bytes_valid: boolean; capture_attestor_trust_valid: boolean; rule_ready_for_calibration: boolean; rule_ready_for_calibrated_claim: boolean }
export interface ReadinessReport {
  reportSchemaVersion: 1;
  validatorContractVersion: "m3-0-readiness-v1";
  manifestSha256: string;
  status: "valid" | "invalid";
  exitCode: 0 | 1 | 2;
  checks: { schema_valid: boolean; provenance_valid: boolean; privacy_valid: boolean; annotation_valid: boolean; split_valid: boolean; holdout_frozen: boolean; oracle_independent: boolean; renderer_identity_complete: boolean; external_trust_valid: boolean; external_holdout_baseline_valid: boolean; acceptance_plans_valid: boolean; acceptance_reports_valid: boolean; capture_evidence_bytes_valid: boolean; capture_attestor_trust_valid: boolean; registry_state_consistent: boolean };
  rules: Record<RuleId, RuleReadiness>;
  issues: ValidationIssue[];
}

function sha256(value: Buffer | string): string { return createHash("sha256").update(value).digest("hex"); }
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b, "en"));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export function canonicalTargetId(document: Pick<DocumentEntry, "artifact">, target: Pick<Target, "svgRootKey" | "sourceIdentity" | "ruleId">): string {
  return `target_${sha256(`${document.artifact.sha256}\0${target.svgRootKey}\0${target.sourceIdentity}\0${target.ruleId}`).slice(0, 32)}`;
}
export function rendererContentHash(rendererFreeze: DocumentEntry["rendererFreeze"]): string {
  const { rendererFreezeId: _id, ...projection } = rendererFreeze;
  return sha256(canonicalJson(projection));
}
export function contentDerivedRendererId(rendererFreeze: DocumentEntry["rendererFreeze"]): string {
  return `renderer_${rendererContentHash(rendererFreeze)}`;
}
export function oracleSnapshotSha256(target: Target): string { return sha256(canonicalJson(target.oracle)); }
export function annotationSnapshotSha256(target: Target): string { return sha256(canonicalJson(target.annotations)); }
export function adjudicationSnapshotSha256(target: Target): string { return sha256(canonicalJson(target.adjudication)); }
export function lineageTargetTuples(manifest: Manifest): LineageSnapshot["targetTuples"] {
  return manifest.documents
    .filter((document) => document.split === "holdout")
    .flatMap((document) => document.targets.map((target) => ({
      documentId: document.documentId,
      artifactSha256: document.artifact.sha256,
      originGroupId: document.originGroupId,
      targetId: target.targetId,
      svgRootKey: target.svgRootKey,
      sourceIdentity: target.sourceIdentity,
      ruleId: target.ruleId,
      oracleSnapshotSha256: oracleSnapshotSha256(target),
      annotationSnapshotSha256: annotationSnapshotSha256(target),
      adjudicationSnapshotSha256: adjudicationSnapshotSha256(target),
      finalLabel: (target.adjudication?.finalLabel ?? target.oracle.groundTruth) as LineageSnapshot["targetTuples"][number]["finalLabel"],
      ambiguityStatus: target.ambiguityStatus,
      rendererFreezeId: document.rendererFreeze.rendererFreezeId,
      rendererContentHash: rendererContentHash(document.rendererFreeze),
      rendererSourceIdentitySha256: producerSourceIdentitySha256(document.rendererFreeze.sourceIdentity),
    })))
    .sort((left, right) => `${left.documentId}\0${left.targetId}`.localeCompare(`${right.documentId}\0${right.targetId}`, "en"));
}
function issue(issues: ValidationIssue[], code: string, path: string, message: string): void { issues.push({ code, path, message }); }
function schemaErrors(validate: ValidateFunction): ValidationIssue[] {
  return (validate.errors ?? []).map((error: ErrorObject) => ({ code: "schema", path: error.instancePath || "/", message: `${error.keyword}: ${error.message ?? "invalid"}` }));
}
function decodeExternalArtifact<T>(
  external: ExternalArtifact<unknown>,
  validator: ValidateFunction,
  issues: ValidationIssue[],
  path: string,
  issuePrefix: string,
): DecodedExternalArtifact<T> | null {
  let parsed: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(external.bytes);
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    issue(issues, `${issuePrefix}-bytes`, path, `external bytes are not valid UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  if (!validator(parsed)) {
    for (const entry of schemaErrors(validator)) issue(issues, `${issuePrefix}-schema`, `${path}${entry.path}`, entry.message);
    return null;
  }
  if (external.value !== undefined && canonicalJson(external.value) !== canonicalJson(parsed)) {
    issue(issues, `${issuePrefix}-value-mismatch`, path, "redundant API value differs from the object parsed from the authoritative bytes");
    return null;
  }
  return { bytes: external.bytes, value: parsed as T, sha256: sha256(external.bytes) };
}
function compileSchemas(): { manifest: ValidateFunction; trust: ValidateFunction; plan: ValidateFunction; receipt: ValidateFunction; captureEvidence: ValidateFunction; capture: ValidateFunction; measurement: ValidateFunction; production: ValidateFunction; outcome: ValidateFunction; acceptance: ValidateFunction; lineage: ValidateFunction; candidateSelection: ValidateFunction } {
  const annotation = JSON.parse(readFileSync(resolve(ROOT, "schemas/calibration/annotation-v1.schema.json"), "utf8")) as object;
  const corpus = JSON.parse(readFileSync(resolve(ROOT, "schemas/calibration/corpus-manifest-v1.schema.json"), "utf8")) as object;
  const trust = JSON.parse(readFileSync(resolve(ROOT, "schemas/calibration/trust-ledger-v1.schema.json"), "utf8")) as object;
  const acceptance = JSON.parse(readFileSync(resolve(ROOT, "schemas/calibration/acceptance-report-v1.schema.json"), "utf8")) as object;
  const plan = JSON.parse(readFileSync(resolve(ROOT, "schemas/calibration/acceptance-plan-v1.schema.json"), "utf8")) as object;
  const receipt = JSON.parse(readFileSync(resolve(ROOT, "schemas/calibration/preregistration-receipt-v1.schema.json"), "utf8")) as object;
  const capture = JSON.parse(readFileSync(resolve(ROOT, "schemas/calibration/capture-attestation-v1.schema.json"), "utf8")) as object;
  const captureEvidence = JSON.parse(readFileSync(resolve(ROOT, "schemas/calibration/capture-evidence-bundle-v1.schema.json"), "utf8")) as object;
  const outcome = JSON.parse(readFileSync(resolve(ROOT, "schemas/calibration/outcome-v1.schema.json"), "utf8")) as object;
  const measurement = JSON.parse(readFileSync(resolve(ROOT, "schemas/calibration/measurement-receipt-v1.schema.json"), "utf8")) as object;
  const production = JSON.parse(readFileSync(resolve(ROOT, "schemas/calibration/production-evaluation-v1.schema.json"), "utf8")) as object;
  const lineage = JSON.parse(readFileSync(resolve(ROOT, "schemas/calibration/lineage-snapshot-v1.schema.json"), "utf8")) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: true, formats: { "date-time": ISO_DATE_TIME } });
  ajv.addSchema(annotation);
  ajv.addSchema(corpus);
  const manifest = ajv.getSchema("https://breaklint.dev/schemas/calibration/corpus-manifest-v1.schema.json");
  if (!manifest) throw new Error("corpus manifest schema did not register");
  return {
    manifest,
    trust: ajv.compile(trust),
    plan: ajv.compile(plan),
    receipt: ajv.compile(receipt),
    captureEvidence: ajv.compile(captureEvidence),
    capture: ajv.compile(capture),
    measurement: ajv.compile(measurement),
    production: ajv.compile(production),
    outcome: ajv.compile(outcome),
    acceptance: ajv.compile(acceptance),
    lineage: ajv.compile(lineage),
    candidateSelection: ajv.compile({ $ref: "https://breaklint.dev/schemas/calibration/corpus-manifest-v1.schema.json#/$defs/candidateSelection" }),
  };
}
const VALIDATORS = compileSchemas();

function groupLeakage(documents: DocumentEntry[], field: "artifact" | "originGroupId" | "duplicateGroupId" | "derivationGroupId" | "parentTemplateGroupId", issues: ValidationIssue[]): void {
  const seen = new Map<string, { split: Split; documentId: string }>();
  for (const document of documents) {
    const value = field === "artifact" ? document.artifact.sha256 : document[field];
    if (!value) continue;
    const previous = seen.get(value);
    if (previous && previous.split !== document.split) issue(issues, field === "artifact" ? "split-identical-hash" : `split-${field}-leakage`, `/documents/${document.documentId}/${field}`, `${value} occurs in ${previous.split} (${previous.documentId}) and ${document.split}`);
    else if (!previous) seen.set(value, { split: document.split, documentId: document.documentId });
  }
}

function safeArtifactPath(document: DocumentEntry, artifactRoot: string, issues: ValidationIssue[]): string | null {
  const base = `/documents/${document.documentId}/artifact`;
  const declared = document.artifact.relativePath;
  if (declared === null) return null;
  if (isAbsolute(declared) || declared.includes("..") || /(?:^|[/\\])(?:Users|home)(?:[/\\]|$)|~/u.test(declared)) {
    issue(issues, "privacy-path-disclosure", `${base}/relativePath`, "artifact path is not a safe relative opaque path");
    return null;
  }
  const lexical = resolve(artifactRoot, declared);
  const lexicalRelative = relative(artifactRoot, lexical);
  if (lexicalRelative.startsWith("..") || isAbsolute(lexicalRelative)) {
    issue(issues, "artifact-path-escape", base, "artifact escapes the declared artifact root");
    return null;
  }
  if (!existsSync(lexical)) return lexical;
  try {
    const rootReal = realpathSync(artifactRoot);
    const artifactReal = realpathSync(lexical);
    const realRelative = relative(rootReal, artifactReal);
    if (lstatSync(lexical).isSymbolicLink() || realRelative.startsWith("..") || isAbsolute(realRelative) || !(artifactReal === rootReal || artifactReal.startsWith(`${rootReal}${sep}`))) {
      issue(issues, "artifact-symlink-escape", base, "artifact symlink or real path escapes the attested artifact boundary");
      return null;
    }
    return artifactReal;
  } catch (error) {
    issue(issues, "artifact-path-unresolvable", base, error instanceof Error ? error.message : String(error));
    return null;
  }
}
type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
function elements(node: Node, result: Element[] = []): Element[] {
  if ("tagName" in node) result.push(node as Element);
  if ("childNodes" in node) for (const child of node.childNodes) elements(child, result);
  return result;
}
function attr(element: Element, name: string): string | null { return element.attrs.find((entry) => entry.name === name)?.value ?? null; }
function verifyTargetBinding(document: DocumentEntry, target: Target, bytes: Buffer, path: string, issues: ValidationIssue[]): boolean {
  if (!target.svgRootKey.startsWith("author-id:") || !target.sourceIdentity.startsWith("author-id:")) {
    issue(issues, "target-signature-unverifiable", path, "only source-bound author-id SVG roots and text targets are claim-eligible");
    return false;
  }
  const rootId = target.svgRootKey.slice("author-id:".length);
  const targetId = target.sourceIdentity.slice("author-id:".length);
  const all = elements(parse(bytes.toString("utf8")));
  const roots = all.filter((entry) => entry.tagName === "svg" && attr(entry, "id") === rootId);
  const targets = all.filter((entry) => entry.tagName === "text" && attr(entry, "id") === targetId);
  const targetsInsideRoot = roots.length === 1
    ? elements(roots[0] as Node).filter((entry) => entry.tagName === "text" && attr(entry, "id") === targetId)
    : [];
  if (roots.length !== 1 || targets.length !== 1 || targetsInsideRoot.length !== 1) {
    issue(issues, "target-source-binding", path, `expected exactly one svg#${rootId} and one text#${targetId} in the exact artifact bytes`);
    return false;
  }
  const expected = canonicalTargetId(document, target);
  if (target.targetId !== expected) {
    issue(issues, "target-id-content-mismatch", `${path}/targetId`, `targetId must equal ${expected} for the attested bytes and author identities`);
    return false;
  }
  return true;
}

function annotationSemantics(document: DocumentEntry, target: Target, path: string, issues: ValidationIssue[]): void {
  if (!document.realDocument) {
    if (target.annotations.length > 0) issue(issues, "synthetic-human-annotations", path, "synthetic construction truth must not invent human annotations");
    return;
  }
  const expectedGuideline = GUIDELINE_BY_RULE[target.ruleId];
  const annotations = target.annotations;
  const identities = new Set(annotations.map((entry) => entry.annotatorId));
  if (annotations.length < 2) issue(issues, "annotation-count", path, "real targets require at least two blind annotations");
  if (identities.size < 2) issue(issues, "annotation-identities", path, "blind annotations require distinct identities");
  for (const annotation of annotations) {
    if (annotation.targetId !== target.targetId || annotation.ruleId !== target.ruleId) issue(issues, "annotation-target-binding", path, `${annotation.annotationId} is bound to another target or rule`);
    if (annotation.guidelineVersion !== expectedGuideline) issue(issues, "guideline-version-mismatch", `${path}/annotations/${annotation.annotationId}`, `expected ${expectedGuideline}`);
    if (!annotation.blinded || annotation.breaklintResultExposed) issue(issues, "annotation-not-blind", path, `${annotation.annotationId} was not blind to breaklint`);
  }
  const labels = new Set(annotations.map((entry) => entry.label));
  const disagreement = labels.size > 1;
  if (disagreement && target.adjudication === null) issue(issues, "adjudication-missing", path, "disagreeing annotations require adjudication");
  if (target.adjudication) {
    if (target.adjudication.guidelineVersion !== expectedGuideline) issue(issues, "guideline-version-mismatch", `${path}/adjudication`, `expected ${expectedGuideline}`);
    if (target.adjudication.adjudicatorIds.some((id) => identities.has(id))) issue(issues, "adjudicator-not-independent", path, "adjudicator identities must differ from blind annotators");
    if (annotations.some((entry) => ["ambiguous", "abstain", "invalid_target"].includes(entry.label)) && ["positive", "negative"].includes(target.adjudication.finalLabel)) issue(issues, "ambiguity-forced-binary", path, "non-binary annotation was forced to a binary final label");
  }
  const hasAmbiguous = annotations.some((entry) => entry.label === "ambiguous");
  const hasAbstain = annotations.some((entry) => entry.label === "abstain");
  const hasInvalid = annotations.some((entry) => entry.label === "invalid_target");
  const nonBinary = hasAmbiguous || hasAbstain || hasInvalid;
  if (nonBinary) {
    const allowedStatus = hasInvalid ? "invalid_target" : hasAbstain && !hasAmbiguous ? "abstained" : "ambiguous";
    if (target.ambiguityStatus !== allowedStatus) issue(issues, "nonbinary-status-mismatch", path, `non-binary annotations require ambiguityStatus ${allowedStatus}`);
    const allowedTruth = hasInvalid ? "excluded_invalid" : "ambiguous";
    if (target.oracle.groundTruth !== allowedTruth) issue(issues, "nonbinary-oracle-binary", path, `non-binary annotations require oracle groundTruth ${allowedTruth}`);
  }
  if (target.adjudication) {
    const final = target.adjudication.finalLabel;
    const expectedStatus = final === "ambiguous" ? "ambiguous" : final === "excluded_invalid" ? "invalid_target" : "unambiguous";
    if (target.ambiguityStatus !== expectedStatus) issue(issues, "adjudication-status-mismatch", path, `final label ${final} requires ambiguityStatus ${expectedStatus}`);
    if (target.oracle.groundTruth !== final) issue(issues, "adjudication-oracle-mismatch", path, "adjudicated final label and independent ground truth differ");
  } else if (!disagreement && !nonBinary) {
    const sole = annotations[0]?.label;
    if (sole && target.oracle.groundTruth !== sole) issue(issues, "annotation-oracle-mismatch", path, "agreeing binary annotations and independent ground truth differ");
  }
}

export function holdoutProjection(manifest: Manifest): { orderedDocuments: HoldoutFreeze["orderedDocuments"]; manifestHash: string; annotationHash: string; adjudicationHash: string; rendererFreezeIds: string[]; acceptancePlanHashes: string[] } {
  const holdout = manifest.documents.filter((document) => document.split === "holdout");
  const orderedDocuments = holdout.map((document) => ({ documentId: document.documentId, artifactSha256: document.artifact.sha256, originGroupId: document.originGroupId })).sort((a, b) => a.documentId.localeCompare(b.documentId, "en"));
  const annotations = holdout.flatMap((document) => document.targets.flatMap((target) => target.annotations.map((annotation) => ({ documentId: document.documentId, ...annotation }))));
  const adjudications = holdout.flatMap((document) => document.targets.flatMap((target) => target.adjudication ? [{ documentId: document.documentId, targetId: target.targetId, ...target.adjudication }] : []));
  const rendererFreezeIds = [...new Set(holdout.map((document) => document.rendererFreeze.rendererFreezeId))].sort();
  const acceptancePlanHashes = [...new Set(manifest.candidateSelections.map((selection) => selection.planSha256))].sort();
  const manifestDocuments = holdout.map((document) => ({ ...document, targets: document.targets.map(({ annotations: _a, adjudication: _b, ...target }) => target) }));
  return { orderedDocuments, manifestHash: sha256(canonicalJson({ contractVersion: manifest.contractVersion, schemaVersion: manifest.schemaVersion, documents: manifestDocuments })), annotationHash: sha256(canonicalJson(annotations)), adjudicationHash: sha256(canonicalJson(adjudications)), rendererFreezeIds, acceptancePlanHashes };
}
function externalTrust(document: DocumentEntry, ledger: TrustLedger | null, issues: ValidationIssue[]): boolean {
  if (!ledger) return false;
  const matches = ledger.attestations.filter((entry) => entry.documentId === document.documentId);
  if (matches.length !== 1) {
    if (document.realDocument) issue(issues, "trust-attestation-cardinality", `/documents/${document.documentId}`, "real document requires exactly one external trust attestation");
    return false;
  }
  const attestation = matches[0]!;
  const expected = { artifactSha256: document.artifact.sha256, originGroupId: document.originGroupId, provenanceEvidenceSha256: sha256(document.provenance.sourceEvidence), licenseEvidenceSha256: sha256(document.license.evidence), privacyEvidenceSha256: sha256(document.privacy.reviewEvidence) };
  for (const [key, value] of Object.entries(expected)) if (attestation[key as keyof typeof expected] !== value) {
    issue(issues, "trust-attestation-mismatch", `/documents/${document.documentId}`, `${key} does not match the external trust ledger`);
    return false;
  }
  return true;
}
function targetEligible(document: DocumentEntry, target: Target, issues: ValidationIssue[], verifiedArtifacts: Set<string>, verifiedTargets: Set<string>, trustedDocuments: Set<string>): boolean {
  if (!document.realDocument || document.provenance.provenanceClass === "synthetic_first_party") return false;
  if (!verifiedArtifacts.has(document.documentId) || !verifiedTargets.has(target.targetId) || !trustedDocuments.has(document.documentId)) return false;
  if (issues.some((entry) => entry.path.startsWith(`/documents/${document.documentId}`))) return false;
  if (["ambiguous", "excluded_invalid"].includes(target.oracle.groundTruth) || target.ambiguityStatus !== "unambiguous") return false;
  if (target.annotations.length < 2 || new Set(target.annotations.map((entry) => entry.annotatorId)).size < 2 || target.annotations.some((entry) => ["ambiguous", "abstain", "invalid_target"].includes(entry.label))) return false;
  const labels = new Set(target.annotations.map((entry) => entry.label));
  if (labels.size > 1 && !target.adjudication) return false;
  if (target.adjudication && ["ambiguous", "excluded_invalid"].includes(target.adjudication.finalLabel)) return false;
  return true;
}
function metricValue(report: AcceptanceReport, metric: AcceptanceReport["gates"][number]["metric"]): number | null {
  const { truePositive: tp, trueNegative: tn, falsePositive: fp, falseNegative: fn } = report.confusionCounts;
  const pair = metric === "precision" ? [tp, tp + fp] : metric === "recall" ? [tp, tp + fn] : metric === "specificity" ? [tn, tn + fp] : [fp, fp + tn];
  return pair[1] === 0 ? null : pair[0]! / pair[1]!;
}
export const PRODUCT_RULE_EXECUTABLE_CONTRACTS: Readonly<Record<RuleId, { moduleRelativePath: string; sourceSha256: string; executableContractVersion: "m3-0-real-rule-run-v1" }>> = Object.freeze({
  "svg/text-clipped": { moduleRelativePath: "src/rules/svg/text-clipped.ts", sourceSha256: "6e55541c82526ec89ee0d5b95574647399111e4a90c43ada849b0385a3c13307", executableContractVersion: "m3-0-real-rule-run-v1" },
  "svg/text-ink-collision": { moduleRelativePath: "src/rules/svg/text-ink-collision.ts", sourceSha256: "e6f3389c7df1ee5d3dd9cfc8dc8f8a218c63ce436c2e5e481e3640a3e560fe61", executableContractVersion: "m3-0-real-rule-run-v1" },
  "svg/text-overflows-viewport": { moduleRelativePath: "src/rules/svg/text-overflows-viewport.ts", sourceSha256: "aa131ddc1740cfc5f4ec78ef032dc57af1cbb13a557b62f0411bfd98a49093c8", executableContractVersion: "m3-0-real-rule-run-v1" },
});

export function producerSourceIdentitySha256(sourceIdentity: unknown): string { return sha256(canonicalJson(sourceIdentity)); }

function snapshotFromProjection(projection: SnapshotProjection): Snapshot {
  const style = { breakInside: "auto", breakBefore: "auto", breakAfter: "auto", columns: "auto", writingMode: "horizontal-tb", visibility: "visible", widows: 2, orphans: 2, textAlign: "start", wordSpacing: "normal", fontFamily: "sans-serif", fontSize: 16, lineHeight: 20, lang: "en" };
  const svg = structuredClone(projection.svg) as SvgRecord & { reason?: SvgRecord["reason"] };
  if (svg.reason === null) delete svg.reason;
  return {
    schemaVersion: projection.schemaVersion,
    meta: { renderer: "m3-0-measurement-receipt", browserVersion: "receipt-bound", pagedjsVersion: "0.4.3", platform: "receipt-bound", locale: "en", inputIdentity: null, freezeSignature: "receipt-bound", freezeRetries: 0, epochCount: 1, interventions: [] },
    source: { map: {}, parser: "receipt-projection-v1", complete: true, injectedAttribute: "data-bl-sid", collisionChecked: true },
    pages: [],
    blocks: [{ nodeKey: svg.nodeKey, sid: null, authorId: null, blockSignature: "receipt-svg", fragmentIndex: 0, fragmentCount: 1, page: projection.pageNumber, box: svg.viewportScreen, tag: "svg", classList: [], lineHeight: 20, spaceWidth: 4, effectiveStyle: style, lines: [], inertBreak: null }],
    textLines: [], textRuns: [], svg: [svg], uriRefs: [], resources: [], notMeasured: [],
  };
}

function ruleOptions(config: CandidateConfig): Record<string, number> {
  if (config.ruleId === "svg/text-clipped") return { maxMissingInk: config.maxMissingInk };
  if (config.ruleId === "svg/text-ink-collision") return { minCollisionInk: config.minCollisionInk, minOccludedInk: config.minOccludedInk };
  return { maxOvershootPx: config.maxOvershootPx };
}

export function executeProductRuleV1(ruleId: RuleId, config: CandidateConfig, projection: SnapshotProjection): { result: RuleResultProjection; decision: "finding" | "clean" | "declined" } {
  const rule = RULES_BY_ID.get(ruleId);
  if (!rule || config.ruleId !== ruleId) throw new Error(`no executable product rule for ${ruleId}`);
  const snapshot = snapshotFromProjection(projection);
  const raw: RuleResult = rule.run(snapshot, {
    documentPath: projection.documentPath,
    options: ruleOptions(config),
    fingerprint: ({ ruleId: findingRule, keyType, key }) => sha256(`m3-0-rule-run-v1\0${findingRule}\0${keyType}\0${key}`),
  });
  const targetSvgTextKey = projection.svg.texts[0]!.svgTextKey;
  const result: RuleResultProjection = {
    findings: raw.findings.map((finding) => ({ ruleId: finding.ruleId as RuleId, targetSvgTextKey, value: finding.measurement.value, threshold: finding.measurement.threshold, unit: finding.measurement.unit })),
    candidates: raw.candidates,
    measured: raw.measured,
    notMeasured: raw.notMeasured.map((entry) => ({ scope: entry.scope as "svg" | "svgText", ruleId: entry.ruleId as RuleId, reason: entry.reason, count: entry.count })),
  };
  const decision = result.findings.length > 0 ? "finding" : result.notMeasured.reduce((sum, entry) => sum + entry.count, 0) > 0 ? "declined" : "clean";
  return { result, decision };
}
function occursNoLater(left: string, right: string): boolean {
  return Date.parse(left) <= Date.parse(right);
}
type CandidateSelection = Manifest["candidateSelections"][number];
interface CandidateSemanticContext {
  selection: CandidateSelection;
  plan: AcceptancePlan | undefined;
  receipt: PreregistrationReceipt | undefined;
  freeze: HoldoutFreeze | null;
  documentSplits: ReadonlyMap<string, Split>;
  knownOutcomeSha256s: ReadonlySet<string>;
  issues: ValidationIssue[];
  path: string;
}
function validateCandidateSelectionSemantics(context: CandidateSemanticContext): boolean {
  const { selection, plan, receipt, freeze, documentSplits, knownOutcomeSha256s, issues, path } = context;
  let valid = true;
  const fail = (code: string, message: string): void => { valid = false; issue(issues, code, path, message); };
  if (selection.holdoutOutcomeUsed || selection.inputSplits.includes("holdout")) fail("candidate-holdout-input", "candidate selection must not use holdout");
  for (const documentId of selection.inputDocumentIds) {
    const split = documentSplits.get(documentId);
    if (!split) fail("candidate-input-document-missing", `unknown input ${documentId}`);
    else if (split === "holdout") fail("candidate-holdout-input", `holdout document ${documentId} used for candidate selection`);
  }
  if (selection.evidenceHashes.some((hash) => knownOutcomeSha256s.has(hash))) fail("candidate-holdout-outcome", "candidate evidence contains a known holdout outcome hash");
  if (!freeze) {
    fail("candidate-holdout-freeze-missing", "candidate semantics require the frozen holdout lineage");
    return valid;
  }
  if (!receipt || receipt.planSha256 !== selection.planSha256 || receipt.holdoutLineageId !== selection.holdoutLineageId || receipt.holdoutId !== selection.holdoutId || freeze.preregistrationReceiptSha256 !== selection.preregistrationReceiptSha256) fail("preregistration-candidate-binding", "candidate requires the exact externally anchored receipt and frozen lineage");
  if (!plan) fail("acceptance-plan-external-missing", "candidate selection requires the exact external preregistered plan bytes");
  else {
    const planBound = plan.planId === selection.preregisteredPlanId
      && plan.ruleId === selection.ruleId
      && plan.candidateSelectionId === selection.selectionId
      && plan.candidateConfigHash === selection.candidateConfigHash
      && plan.thresholdCandidateHash === selection.thresholdCandidateHash
      && freeze.acceptancePlanHashes.includes(selection.planSha256)
      && freeze.holdoutLineageId === selection.holdoutLineageId
      && freeze.holdoutId === selection.holdoutId;
    if (!planBound) fail("acceptance-plan-candidate-binding", "plan, candidate and frozen holdout lineage differ");
    if (!receipt || !occursNoLater(plan.createdAt, receipt.issuedAt) || !occursNoLater(receipt.issuedAt, selection.createdAt) || !occursNoLater(selection.createdAt, freeze.frozenAt)) fail("acceptance-plan-time-order", "required order is plan <= receipt <= candidate <= freeze");
  }
  return valid;
}
interface EvaluationTargetBinding {
  documentId: string; artifactSha256: string; targetId: string; ruleId: RuleId;
  rendererFreezeId: string; rendererContentHash: string; rendererSourceIdentitySha256: string;
  svgRootKey?: string; sourceIdentity?: string;
}
interface ValidatedMeasurement { receipt: MeasurementReceipt; rows: Map<string, MeasurementReceiptRow>; claimEvidentiary: boolean; captureEvidenceBytesValid: boolean; captureAttestorTrustValid: boolean }
interface ValidatedProduction { evaluation: ProductionEvaluation; rows: Map<string, ProductionEvaluationRow>; claimEvidentiary: boolean; captureEvidenceBytesValid: boolean; captureAttestorTrustValid: boolean }

function captureArtifactTargetSetSha256(rows: MeasurementReceiptRow[]): string {
  const projection = rows.map((row) => ({ documentId: row.documentId, artifactSha256: row.artifactSha256, targetId: row.targetId, ruleId: row.ruleId })).sort((left, right) => `${left.documentId}\0${left.targetId}`.localeCompare(`${right.documentId}\0${right.targetId}`, "en"));
  return sha256(canonicalJson(projection));
}
function captureEvidenceRows(rows: MeasurementReceiptRow[]): CaptureEvidenceBundle["rows"] {
  return rows.map((row) => ({ documentId: row.documentId, artifactSha256: row.artifactSha256, targetId: row.targetId, ruleId: row.ruleId, rendererFreezeId: row.rendererFreezeId, rendererContentHash: row.rendererContentHash, measuredAt: row.measuredAt, rawMeasurementSha256: sha256(canonicalJson(row.snapshot)) }));
}
function captureRawMeasurementsSha256(rows: MeasurementReceiptRow[]): string {
  return sha256(canonicalJson(captureEvidenceRows(rows).map((row) => ({ documentId: row.documentId, targetId: row.targetId, rawMeasurementSha256: row.rawMeasurementSha256 }))));
}

function validateMeasurementReceipt(
  external: DecodedExternalArtifact<MeasurementReceipt>,
  targetBindings: Map<string, EvaluationTargetBinding>,
  captureEvidenceByHash: ReadonlyMap<string, CaptureEvidenceBundle>,
  captureAttestationByHash: ReadonlyMap<string, CaptureAttestation>,
  issues: ValidationIssue[],
  base: string,
): ValidatedMeasurement | null {
  const receipt = external.value;
  const contract = PRODUCT_RULE_EXECUTABLE_CONTRACTS[receipt.ruleId];
  const actualSourceSha256 = sha256(readFileSync(resolve(ROOT, contract.moduleRelativePath)));
  let valid = receipt.candidateConfig.ruleId === receipt.ruleId
    && receipt.candidateConfigHash === sha256(canonicalJson(receipt.candidateConfig))
    && receipt.ruleContract.ruleId === receipt.ruleId
    && canonicalJson(receipt.ruleContract) === canonicalJson({ ruleId: receipt.ruleId, ...contract })
    && actualSourceSha256 === contract.sourceSha256
    && receipt.producer.sourceIdentitySha256 === producerSourceIdentitySha256(receipt.producer.sourceIdentity);
  if (!valid) issue(issues, "measurement-receipt-contract-binding", base, "producer, candidate or independently pinned product-rule source contract differs");
  const rows = new Map<string, MeasurementReceiptRow>();
  for (const [rowIndex, row] of receipt.rows.entries()) {
    const path = `${base}/rows/${rowIndex}`;
    const key = `${row.documentId}\0${row.targetId}`;
    const binding = targetBindings.get(key);
    const text = row.snapshot.svg.texts[0];
    const snapshotClosed = row.snapshot.svg.texts.length === 1
      && row.snapshot.svg.textTargetCount === row.snapshot.svg.texts.length
      && Boolean(text)
      && row.snapshot.svg.sourceKey !== null
      && (row.snapshot.svg.measurable ? row.snapshot.svg.reason === null : row.snapshot.svg.reason !== null)
      && occursNoLater(row.measuredAt, receipt.createdAt);
    const sourceBound = binding && (!binding.svgRootKey || row.snapshot.svg.sourceKey === binding.svgRootKey)
      && (!binding.sourceIdentity || text?.svgTextKey === binding.sourceIdentity);
    const bound = binding && binding.ruleId === receipt.ruleId && row.ruleId === receipt.ruleId
      && row.artifactSha256 === binding.artifactSha256 && row.candidateConfigHash === receipt.candidateConfigHash
      && row.rendererFreezeId === binding.rendererFreezeId && row.rendererContentHash === binding.rendererContentHash
      && receipt.rendererFreezeId === binding.rendererFreezeId && receipt.rendererContentHash === binding.rendererContentHash
      && receipt.producer.sourceIdentitySha256 === binding.rendererSourceIdentitySha256 && sourceBound && snapshotClosed;
    if (!bound || rows.has(key)) {
      valid = false;
      issue(issues, "measurement-receipt-row-binding", path, "artifact, target, renderer, source identity, timestamp or closed Snapshot/SvgRecord projection differs");
    } else rows.set(key, row);
  }
  if (rows.size !== targetBindings.size) {
    valid = false;
    issue(issues, "measurement-receipt-target-set", base, "receipt must contain exactly one row for every governed holdout target");
  }
  let captureEvidenceBytesValid = false;
  const captureAttestorTrustValid = false;
  const claimEvidentiary = false;
  if (receipt.evidentiaryStatus === "externally-attested-real-render") {
    const attestation = receipt.captureAttestationSha256 ? captureAttestationByHash.get(receipt.captureAttestationSha256) : undefined;
    const evidence = attestation ? captureEvidenceByHash.get(attestation.captureEvidenceSha256) : undefined;
    const expectedEvidenceRows = captureEvidenceRows(receipt.rows);
    const evidenceBound = evidence
      && evidence.measurementReceiptId === receipt.receiptId
      && evidence.ruleId === receipt.ruleId
      && evidence.candidateConfigHash === receipt.candidateConfigHash
      && evidence.rendererFreezeId === receipt.rendererFreezeId
      && evidence.rendererContentHash === receipt.rendererContentHash
      && evidence.producerSourceIdentitySha256 === receipt.producer.sourceIdentitySha256
      && evidence.productRuleSourceSha256 === receipt.ruleContract.sourceSha256
      && evidence.rowsSha256 === sha256(canonicalJson(receipt.rows))
      && evidence.artifactTargetSetSha256 === captureArtifactTargetSetSha256(receipt.rows)
      && evidence.rawMeasurementsSha256 === captureRawMeasurementsSha256(receipt.rows)
      && canonicalJson(evidence.rows) === canonicalJson(expectedEvidenceRows)
      && receipt.rows.every((row) => occursNoLater(row.measuredAt, evidence.capturedAt));
    const attestationBound = attestation
      && evidenceBound
      && attestation.measurementReceiptId === receipt.receiptId
      && attestation.ruleId === receipt.ruleId
      && attestation.candidateConfigHash === receipt.candidateConfigHash
      && attestation.rendererFreezeId === receipt.rendererFreezeId
      && attestation.rendererContentHash === receipt.rendererContentHash
      && attestation.producerSourceIdentitySha256 === receipt.producer.sourceIdentitySha256
      && attestation.rowsSha256 === sha256(canonicalJson(receipt.rows))
      && attestation.artifactTargetSetSha256 === captureArtifactTargetSetSha256(receipt.rows)
      && evidence !== undefined
      && occursNoLater(evidence.capturedAt, attestation.issuedAt)
      && occursNoLater(attestation.issuedAt, receipt.createdAt);
    if (!attestationBound) {
      valid = false;
      issue(issues, "capture-evidence-binding", base, "external real-render status requires exact separately supplied evidence and attestation bytes bound to raw rows, artifact targets, product source, producer, renderer and chronology");
    } else captureEvidenceBytesValid = true;
  } else if (receipt.captureAttestationSha256 !== null) {
    valid = false;
    issue(issues, "capture-attestation-simulation", base, "non-evidentiary simulation must not bind or inherit a capture attestation");
  }
  return valid ? { receipt, rows, claimEvidentiary, captureEvidenceBytesValid, captureAttestorTrustValid } : null;
}

function validateProductionEvaluation(
  external: DecodedExternalArtifact<ProductionEvaluation>,
  measurementByHash: Map<string, ValidatedMeasurement>,
  issues: ValidationIssue[],
  base: string,
): ValidatedProduction | null {
  const evaluation = external.value;
  const contract = PRODUCT_RULE_EXECUTABLE_CONTRACTS[evaluation.ruleId];
  const actualSourceSha256 = sha256(readFileSync(resolve(ROOT, contract.moduleRelativePath)));
  const measurement = measurementByHash.get(evaluation.measurementReceiptSha256);
  let valid = Boolean(measurement)
    && evaluation.candidateConfig.ruleId === evaluation.ruleId
    && evaluation.candidateConfigHash === sha256(canonicalJson(evaluation.candidateConfig))
    && evaluation.ruleExecutableContractVersion === contract.executableContractVersion
    && evaluation.productRuleSourceSha256 === contract.sourceSha256
    && actualSourceSha256 === contract.sourceSha256
    && measurement?.receipt.ruleId === evaluation.ruleId
    && measurement.receipt.candidateConfigHash === evaluation.candidateConfigHash
    && occursNoLater(measurement.receipt.createdAt, evaluation.createdAt);
  if (!valid) issue(issues, "production-evaluation-contract-binding", base, "measurement receipt, candidate, chronology or pinned executable product rule differs");
  const rows = new Map<string, ProductionEvaluationRow>();
  for (const [rowIndex, row] of evaluation.rows.entries()) {
    const path = `${base}/rows/${rowIndex}`;
    const key = `${row.documentId}\0${row.targetId}`;
    const measurementRow = measurement?.rows.get(key);
    let executed: ReturnType<typeof executeProductRuleV1> | null = null;
    try { if (measurementRow) executed = executeProductRuleV1(evaluation.ruleId, evaluation.candidateConfig, measurementRow.snapshot); }
    catch (error) { issue(issues, "production-rule-execution", path, error instanceof Error ? error.message : String(error)); }
    const bound = measurementRow && executed && row.ruleId === evaluation.ruleId
      && row.artifactSha256 === measurementRow.artifactSha256 && row.candidateConfigHash === evaluation.candidateConfigHash
      && row.rendererFreezeId === measurementRow.rendererFreezeId && row.rendererContentHash === measurementRow.rendererContentHash
      && row.measurementReceiptRowSha256 === sha256(canonicalJson(measurementRow))
      && canonicalJson(row.ruleResult) === canonicalJson(executed.result) && row.productionDecision === executed.decision;
    if (!bound || rows.has(key)) {
      valid = false;
      issue(issues, "production-evaluation-row-binding", path, "real Rule.run result, measurement receipt row, candidate, renderer, artifact or decision differs");
    } else rows.set(key, row);
  }
  if (measurement && rows.size !== measurement.rows.size) {
    valid = false;
    issue(issues, "production-evaluation-target-set", base, "production evaluation must execute every measurement-receipt row exactly once");
  }
  if (!valid) issue(issues, "production-evaluation-binding", base, "production evaluation is not independently executable through the real registry rule");
  return valid ? { evaluation, rows, claimEvidentiary: measurement?.claimEvidentiary === true, captureEvidenceBytesValid: measurement?.captureEvidenceBytesValid === true, captureAttestorTrustValid: measurement?.captureAttestorTrustValid === true } : null;
}

function decodeLineageArtifact<T>(wrapper: EncodedArtifact, validator: ValidateFunction, issues: ValidationIssue[], path: string): DecodedExternalArtifact<T> | null {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(wrapper.bytesBase64, "base64");
    if (bytes.length === 0 || bytes.toString("base64") !== wrapper.bytesBase64 || sha256(bytes) !== wrapper.sha256) throw new Error("base64 bytes or sha256 differ");
  } catch (error) {
    issue(issues, "lineage-artifact-bytes", path, error instanceof Error ? error.message : String(error));
    return null;
  }
  return decodeExternalArtifact<T>({ bytes, value: undefined }, validator, issues, path, "lineage-artifact");
}

function metricFromCounts(counts: AcceptanceReport["confusionCounts"], metric: AcceptanceReport["gates"][number]["metric"]): number | null {
  const { truePositive: tp, trueNegative: tn, falsePositive: fp, falseNegative: fn } = counts;
  const pair = metric === "precision" ? [tp, tp + fp] : metric === "recall" ? [tp, tp + fn] : metric === "specificity" ? [tn, tn + fp] : [fp, fp + tn];
  return pair[1] === 0 ? null : pair[0]! / pair[1]!;
}
function emptyRules(): Record<RuleId, RuleReadiness> {
  return Object.fromEntries(RULE_IDS.map((ruleId) => [ruleId, { calibration_mode: ruleId === "svg/text-overflows-viewport" ? "structural-validation" : "empirical-threshold", eligible_real_documents: 0, eligible_origin_groups: 0, eligible_real_evidentiary_holdout_documents: 0, eligible_real_evidentiary_holdout_origin_groups: 0, capture_evidence_bytes_valid: false, capture_attestor_trust_valid: false, rule_ready_for_calibration: false, rule_ready_for_calibrated_claim: false }])) as Record<RuleId, RuleReadiness>;
}

export function validateManifest(value: unknown, options: ValidationOptions = {}): ReadinessReport {
  const manifestBytes = options.manifestBytes ?? Buffer.from(JSON.stringify(value), "utf8");
  const manifestSha256 = sha256(manifestBytes);
  if (!VALIDATORS.manifest(value)) return { reportSchemaVersion: 1, validatorContractVersion: "m3-0-readiness-v1", manifestSha256, status: "invalid", exitCode: 1, checks: { schema_valid: false, provenance_valid: false, privacy_valid: false, annotation_valid: false, split_valid: false, holdout_frozen: false, oracle_independent: false, renderer_identity_complete: false, external_trust_valid: false, external_holdout_baseline_valid: false, acceptance_plans_valid: false, acceptance_reports_valid: false, capture_evidence_bytes_valid: false, capture_attestor_trust_valid: false, registry_state_consistent: false }, rules: emptyRules(), issues: schemaErrors(VALIDATORS.manifest).sort((a, b) => `${a.path}:${a.message}`.localeCompare(`${b.path}:${b.message}`, "en")) };
  const manifest = value as Manifest;
  const issues: ValidationIssue[] = [];
  const decodeMany = <T>(
    artifacts: ExternalArtifact<unknown>[] | undefined,
    validator: ValidateFunction,
    path: string,
    issuePrefix: string,
  ): DecodedExternalArtifact<T>[] => (artifacts ?? []).flatMap((external, index) => {
    const decoded = decodeExternalArtifact<T>(external, validator, issues, `${path}/${index}`, issuePrefix);
    return decoded ? [decoded] : [];
  });
  const decodedTrustLedger = options.trustLedger
    ? decodeExternalArtifact<TrustLedger>(options.trustLedger, VALIDATORS.trust, issues, "/trustLedger", "trust-ledger")
    : null;
  const decodedAcceptancePlans = decodeMany<AcceptancePlan>(options.acceptancePlans, VALIDATORS.plan, "/acceptancePlans", "acceptance-plan");
  const decodedPreregistrationReceipts = decodeMany<PreregistrationReceipt>(options.preregistrationReceipts, VALIDATORS.receipt, "/preregistrationReceipts", "preregistration-receipt");
  const decodedCaptureEvidenceBundles = decodeMany<CaptureEvidenceBundle>(options.captureEvidenceBundles, VALIDATORS.captureEvidence, "/captureEvidenceBundles", "capture-evidence");
  const decodedCaptureAttestations = decodeMany<CaptureAttestation>(options.captureAttestations, VALIDATORS.capture, "/captureAttestations", "capture-attestation");
  const decodedMeasurementReceipts = decodeMany<MeasurementReceipt>(options.measurementReceipts, VALIDATORS.measurement, "/measurementReceipts", "measurement-receipt");
  const decodedProductionEvaluations = decodeMany<ProductionEvaluation>(options.productionEvaluations, VALIDATORS.production, "/productionEvaluations", "production-evaluation");
  const decodedOutcomes = decodeMany<OutcomeArtifact>(options.outcomes, VALIDATORS.outcome, "/outcomes", "outcome");
  const decodedAcceptanceReports = decodeMany<AcceptanceReport>(options.acceptanceReports, VALIDATORS.acceptance, "/acceptanceReports", "acceptance-report");
  const decodedLineageSnapshots = decodeMany<LineageSnapshot>(options.lineageSnapshots, VALIDATORS.lineage, "/lineageSnapshots", "lineage-snapshot");
  const artifactRoot = resolve(options.artifactRoot ?? ROOT);
  const verifiedArtifacts = new Set<string>();
  const verifiedTargets = new Set<string>();
  const trustedDocuments = new Set<string>();
  const documentIds = new Set<string>();
  const artifactHashes = new Map<string, string>();
  const targetIds = new Set<string>();
  const annotationIds = new Set<string>();
  const adjudicationIds = new Set<string>();
  const rendererById = new Map<string, string>();
  const rendererHashById = new Map<string, string>();
  let trustLedger: TrustLedger | null = null;
  const trustLedgerSchemaValid = decodedTrustLedger !== null;
  if (decodedTrustLedger) trustLedger = decodedTrustLedger.value;
  const planByHash = new Map<string, AcceptancePlan>();
  let acceptancePlansValid = Boolean(options.acceptancePlans?.length) && decodedAcceptancePlans.length === options.acceptancePlans?.length;
  for (const [index, decoded] of decodedAcceptancePlans.entries()) {
    const plan = decoded.value;
    const metrics = new Set(plan.gates.map((gate) => gate.metric));
    const operatorsValid = plan.gates.every((gate) => gate.operator === (gate.metric === "false-positive-rate" ? "<=" : ">="));
    if (plan.gates.length !== 4 || metrics.size !== 4 || !operatorsValid) {
      acceptancePlansValid = false;
      issue(issues, "acceptance-plan-gates", `/acceptancePlans/${index}/gates`, "plan requires exactly one correctly directed gate for each governed metric");
      continue;
    }
    planByHash.set(decoded.sha256, plan);
  }
  const receiptByHash = new Map<string, PreregistrationReceipt>();
  for (const decoded of decodedPreregistrationReceipts) receiptByHash.set(decoded.sha256, decoded.value);
  const captureAttestationByHash = new Map<string, CaptureAttestation>();
  for (const decoded of decodedCaptureAttestations) captureAttestationByHash.set(decoded.sha256, decoded.value);
  const captureEvidenceByHash = new Map<string, CaptureEvidenceBundle>();
  for (const decoded of decodedCaptureEvidenceBundles) captureEvidenceByHash.set(decoded.sha256, decoded.value);
  for (const document of manifest.documents) {
    const base = `/documents/${document.documentId}`;
    if (documentIds.has(document.documentId)) issue(issues, "document-id-duplicate", base, "documentId is not unique");
    documentIds.add(document.documentId);
    const previousHash = artifactHashes.get(document.artifact.sha256);
    if (previousHash && previousHash !== document.documentId) issue(issues, "artifact-hash-duplicate", `${base}/artifact/sha256`, `exact bytes already represented by ${previousHash}; duplicate documents cannot inflate a corpus`);
    else artifactHashes.set(document.artifact.sha256, document.documentId);
    const path = safeArtifactPath(document, artifactRoot, issues);
    let bytes: Buffer | null = null;
    if (path !== null) {
      if (!existsSync(path)) issue(issues, "artifact-missing", `${base}/artifact`, "artifact bytes are unavailable");
      else {
        bytes = readFileSync(path);
        const actual = sha256(bytes);
        if (actual !== document.artifact.sha256) issue(issues, "artifact-hash-mismatch", `${base}/artifact/sha256`, `expected ${document.artifact.sha256}, got ${actual}`);
        else verifiedArtifacts.add(document.documentId);
      }
    } else if (document.artifact.storage === "public-repository" && document.artifact.relativePath === null) issue(issues, "artifact-public-path-missing", `${base}/artifact`, "public repository artifact requires a relative path");
    if (document.license.status === "unknown") issue(issues, "license-unknown", `${base}/license`, "unknown licence blocks use");
    if (document.privacy.status === "unknown") issue(issues, "privacy-unknown", `${base}/privacy`, "unknown privacy blocks use");
    if (/[/\\]|@|Users|home|~|[A-Z]:/u.test(document.provenance.sourceLocator)) issue(issues, "provenance-locator-disclosure", `${base}/provenance/sourceLocator`, "source locator must be opaque and non-identifying");
    const publicSafeLicence = ["first_party", "public_domain", "permissive_redistribution_verified"].includes(document.license.status);
    const publicSafePrivacy = ["synthetic_no_personal_data", "reviewed_no_personal_data", "redacted_and_reviewed"].includes(document.privacy.status);
    if (document.artifact.storage === "public-repository" && (!publicSafeLicence || !publicSafePrivacy)) issue(issues, "public-artifact-rights", `${base}/artifact`, "public bytes require redistribution rights and privacy clearance");
    if (document.provenance.provenanceClass === "synthetic_first_party" && document.realDocument) issue(issues, "synthetic-counted-real", `${base}/realDocument`, "synthetic documents never count as real");
    if (document.provenance.provenanceClass.startsWith("private_") && document.artifact.storage !== "external-private") issue(issues, "private-artifact-public", `${base}/artifact/storage`, "private documents must remain outside the public repository");
    const rendererCanonical = canonicalJson(document.rendererFreeze);
    const rendererHash = rendererContentHash(document.rendererFreeze);
    const expectedRendererId = `renderer_${rendererHash}`;
    if (document.rendererFreeze.rendererFreezeId !== expectedRendererId) issue(issues, "renderer-id-content-mismatch", `${base}/rendererFreeze/rendererFreezeId`, `rendererFreezeId must equal ${expectedRendererId}`);
    const priorRenderer = rendererById.get(document.rendererFreeze.rendererFreezeId);
    if (priorRenderer && priorRenderer !== rendererCanonical) issue(issues, "renderer-freeze-id-drift", `${base}/rendererFreeze`, "same rendererFreezeId identifies different renderer content");
    else rendererById.set(document.rendererFreeze.rendererFreezeId, rendererCanonical);
    rendererHashById.set(document.rendererFreeze.rendererFreezeId, rendererHash);
    if (!document.rendererFreeze.fonts.length) issue(issues, "renderer-fonts-missing", `${base}/rendererFreeze/fonts`, "resolved font identities are required");
    if (externalTrust(document, trustLedger, issues)) trustedDocuments.add(document.documentId);
    for (const target of document.targets) {
      const targetPath = `${base}/targets/${target.targetId}`;
      if (targetIds.has(target.targetId)) issue(issues, "target-id-duplicate", targetPath, "targetId is not globally unique");
      targetIds.add(target.targetId);
      if (RUN_LOCAL_TARGET_TOKENS.some((token) => `${target.targetId} ${target.svgRootKey} ${target.sourceIdentity}`.toLowerCase().includes(token))) issue(issues, "target-id-run-local", `${targetPath}/targetId`, "target identity uses a run-local identifier");
      if (bytes && verifyTargetBinding(document, target, bytes, targetPath, issues)) verifiedTargets.add(target.targetId);
      for (const annotation of target.annotations) {
        if (annotationIds.has(annotation.annotationId)) issue(issues, "annotation-id-duplicate", `${targetPath}/annotations/${annotation.annotationId}`, "annotationId is not globally unique");
        annotationIds.add(annotation.annotationId);
      }
      if (target.adjudication) {
        if (adjudicationIds.has(target.adjudication.adjudicationId)) issue(issues, "adjudication-id-duplicate", `${targetPath}/adjudication`, "adjudicationId is not globally unique");
        adjudicationIds.add(target.adjudication.adjudicationId);
      }
      annotationSemantics(document, target, targetPath, issues);
    }
  }
  groupLeakage(manifest.documents, "artifact", issues);
  groupLeakage(manifest.documents, "originGroupId", issues);
  groupLeakage(manifest.documents, "duplicateGroupId", issues);
  groupLeakage(manifest.documents, "derivationGroupId", issues);
  groupLeakage(manifest.documents, "parentTemplateGroupId", issues);
  const holdoutDocuments = manifest.documents.filter((document) => document.split === "holdout");
  let internalHoldoutFrozen = false;
  if (manifest.holdoutFreeze) {
    const expected = holdoutProjection(manifest);
    for (const key of ["orderedDocuments", "manifestHash", "annotationHash", "adjudicationHash", "rendererFreezeIds", "acceptancePlanHashes"] as const) if (canonicalJson(manifest.holdoutFreeze[key]) !== canonicalJson(expected[key])) issue(issues, "holdout-freeze-mismatch", `/holdoutFreeze/${key}`, "frozen holdout no longer matches manifest");
    internalHoldoutFrozen = holdoutDocuments.length > 0 && !issues.some((entry) => entry.code === "holdout-freeze-mismatch");
  } else if (holdoutDocuments.length > 0) issue(issues, "holdout-not-frozen", "/holdoutFreeze", "holdout documents exist without freeze record");
  let externalBaselineValid = false;
  const anchorIds = new Set<string>();
  for (const anchor of manifest.preregistrationAnchors) {
    if (anchorIds.has(anchor.receiptId)) issue(issues, "preregistration-anchor-duplicate", "/preregistrationAnchors", "receipt anchors must be unique");
    anchorIds.add(anchor.receiptId);
  }
  if (options.previousManifest !== undefined) {
    if (!VALIDATORS.manifest(options.previousManifest)) issue(issues, "previous-manifest-invalid", "/holdoutFreeze", "external previous manifest fails schema");
    else {
      const previous = options.previousManifest as Manifest;
      const before = previous.holdoutFreeze;
      const after = manifest.holdoutFreeze;
      if (!after) issue(issues, "holdout-external-baseline-missing", "/holdoutFreeze", "claim-grade validation requires a current freeze");
      else {
        const historyIsPrefix = canonicalJson(manifest.preregistrationAnchors.slice(0, previous.preregistrationAnchors.length)) === canonicalJson(previous.preregistrationAnchors);
        if (!historyIsPrefix) issue(issues, "preregistration-anchor-history", "/preregistrationAnchors", "previous receipt anchors changed");
        const anchor = previous.preregistrationAnchors.find((entry) => entry.receiptSha256 === after.preregistrationReceiptSha256);
        const receipt = receiptByHash.get(after.preregistrationReceiptSha256);
        if (!anchor || !receipt) issue(issues, "preregistration-external-baseline-missing", "/holdoutFreeze/preregistrationReceiptSha256", "freeze requires receipt bytes and an identical anchor already present in the previous baseline");
        else {
          const receiptBound = receipt.receiptId === anchor.receiptId && receipt.planSha256 === anchor.planSha256 && receipt.holdoutLineageId === anchor.holdoutLineageId && receipt.holdoutId === anchor.holdoutId
            && after.holdoutLineageId === receipt.holdoutLineageId && after.holdoutId === receipt.holdoutId;
          if (!receiptBound) issue(issues, "preregistration-receipt-binding", "/holdoutFreeze", "receipt, prior anchor and freeze do not identify the same plan and holdout lineage");
          if (!(occursNoLater(receipt.issuedAt, anchor.recordedAt) && occursNoLater(anchor.recordedAt, anchor.firstHoldoutAccessAt) && occursNoLater(anchor.firstHoldoutAccessAt, after.frozenAt))) issue(issues, "preregistration-time-order", "/holdoutFreeze", "receipt must be externally anchored before first holdout access and freeze");
        }
        if (before) {
          const sameLineage = before.holdoutLineageId === after.holdoutLineageId;
          const changed = canonicalJson(holdoutProjection(previous)) !== canonicalJson(holdoutProjection(manifest)) || before.holdoutId !== after.holdoutId;
          if (sameLineage && (after.preregistrationReceiptSha256 !== before.preregistrationReceiptSha256 || previous.evaluationLedger.some((event) => event.holdoutLineageId === after.holdoutLineageId) && before.acceptancePlanHashes.some((hash) => !after.acceptancePlanHashes.includes(hash)))) issue(issues, "holdout-lineage-plan-locked", "/holdoutFreeze", "an evaluated lineage cannot change its preregistered plan or receipt");
          if (sameLineage && (after.version < before.version || (changed && after.version <= before.version))) issue(issues, "holdout-version-mutated", "/holdoutFreeze/version", "holdout changed without newer version");
          if (!sameLineage && (after.version !== 1 || previous.evaluationLedger.some((event) => event.holdoutLineageId === after.holdoutLineageId))) issue(issues, "holdout-lineage-restart-invalid", "/holdoutFreeze", "a new lineage must start at version 1 with no prior evaluation");
        }
        externalBaselineValid = true;
      }
      if (canonicalJson(manifest.evaluationLedger.slice(0, previous.evaluationLedger.length)) !== canonicalJson(previous.evaluationLedger)) issue(issues, "evaluation-ledger-history", "/evaluationLedger", "previous evaluation events changed");
    }
  }
  if (issues.some((entry) => ["holdout-version-mutated", "previous-manifest-invalid", "evaluation-ledger-history", "preregistration-anchor-history", "preregistration-external-baseline-missing", "preregistration-receipt-binding", "preregistration-time-order", "holdout-lineage-plan-locked", "holdout-lineage-restart-invalid"].includes(entry.code))) externalBaselineValid = false;
  const holdoutFrozen = internalHoldoutFrozen && externalBaselineValid;
  const documentSplits = new Map(manifest.documents.map((document) => [document.documentId, document.split]));
  const outcomeHashes = new Set([...manifest.evaluationLedger.map((entry) => entry.outcomeSha256), ...decodedOutcomes.map((external) => external.sha256)]);
  const selectionIds = new Set<string>();
  const planBoundSelections = new Set<string>();
  for (const selection of manifest.candidateSelections) {
    const path = `/candidateSelections/${selection.selectionId}`;
    if (selectionIds.has(selection.selectionId)) issue(issues, "selection-id-duplicate", path, "selectionId is not unique");
    selectionIds.add(selection.selectionId);
    const plan = planByHash.get(selection.planSha256);
    const receipt = receiptByHash.get(selection.preregistrationReceiptSha256);
    if (validateCandidateSelectionSemantics({ selection, plan, receipt, freeze: manifest.holdoutFreeze, documentSplits, knownOutcomeSha256s: outcomeHashes, issues, path })) planBoundSelections.add(selection.selectionId);
  }
  const sequences = manifest.evaluationLedger.map((entry) => entry.appendOnlySequence);
  if (new Set(sequences).size !== sequences.length || sequences.some((value, index) => index > 0 && value <= sequences[index - 1]!)) issue(issues, "evaluation-ledger-order", "/evaluationLedger", "events must be append-only");
  for (const event of manifest.evaluationLedger) {
    const path = `/evaluationLedger/${event.eventId}`;
    const eventAnchor = manifest.preregistrationAnchors.find((entry) => entry.receiptSha256 === event.preregistrationReceiptSha256 && entry.holdoutLineageId === event.holdoutLineageId && entry.holdoutId === event.holdoutId);
    if (!eventAnchor) issue(issues, "evaluation-holdout-binding", path, "evaluation lacks its immutable lineage receipt snapshot");
    if (manifest.holdoutFreeze?.holdoutLineageId === event.holdoutLineageId && (event.holdoutId !== manifest.holdoutFreeze.holdoutId || event.holdoutVersion !== manifest.holdoutFreeze.version || event.holdoutManifestHash !== manifest.holdoutFreeze.manifestHash || canonicalJson(event.rendererFreezeIds) !== canonicalJson(manifest.holdoutFreeze.rendererFreezeIds))) issue(issues, "evaluation-holdout-binding", path, "current-lineage evaluation differs from the current frozen snapshot");
    const isCurrentLineage = manifest.holdoutFreeze?.holdoutLineageId === event.holdoutLineageId;
    const plan = planByHash.get(event.planSha256);
    if (isCurrentLineage && !plan) issue(issues, "acceptance-plan-evaluation-missing", `${path}/planSha256`, "current evaluation requires the exact external preregistered plan bytes");
    else if (isCurrentLineage && plan) {
      if (plan.candidateConfigHash !== event.candidateConfigHash || !manifest.candidateSelections.some((selection) => selection.selectionId === plan.candidateSelectionId && selection.planSha256 === event.planSha256)) issue(issues, "acceptance-plan-evaluation-binding", path, "evaluation does not match the plan-bound candidate");
      if (!occursNoLater(plan.createdAt, event.createdAt) || (manifest.holdoutFreeze && !occursNoLater(plan.createdAt, manifest.holdoutFreeze.frozenAt))) issue(issues, "acceptance-plan-time-order", path, "acceptance plan must predate holdout freeze and evaluation");
      if (!manifest.holdoutFreeze?.acceptancePlanHashes.includes(event.planSha256)) issue(issues, "acceptance-plan-holdout-binding", path, "evaluation plan hash is absent from the holdout freeze");
    }
  }
  const currentBindings = holdoutDocuments.flatMap((document) => document.targets.map((target): EvaluationTargetBinding => ({
    documentId: document.documentId,
    artifactSha256: document.artifact.sha256,
    targetId: target.targetId,
    ruleId: target.ruleId,
    rendererFreezeId: document.rendererFreeze.rendererFreezeId,
    rendererContentHash: rendererContentHash(document.rendererFreeze),
    rendererSourceIdentitySha256: producerSourceIdentitySha256(document.rendererFreeze.sourceIdentity),
    svgRootKey: target.svgRootKey,
    sourceIdentity: target.sourceIdentity,
  })));
  const measurementByHash = new Map<string, ValidatedMeasurement>();
  for (const [index, decoded] of decodedMeasurementReceipts.entries()) {
    const claimedRule = decoded.value.ruleId;
    const bindings = new Map(currentBindings.filter((entry) => entry.ruleId === claimedRule).map((entry) => [`${entry.documentId}\0${entry.targetId}`, entry]));
    const validated = validateMeasurementReceipt(decoded, bindings, captureEvidenceByHash, captureAttestationByHash, issues, `/measurementReceipts/${index}`);
    if (validated) {
      if (manifest.holdoutFreeze && !occursNoLater(manifest.holdoutFreeze.frozenAt, validated.receipt.createdAt)) issue(issues, "measurement-receipt-time-order", `/measurementReceipts/${index}`, "measurement receipt must be created after holdout freeze");
      else measurementByHash.set(decoded.sha256, validated);
    }
  }
  const productionByHash = new Map<string, ValidatedProduction>();
  for (const [index, decoded] of decodedProductionEvaluations.entries()) {
    const validated = validateProductionEvaluation(decoded, measurementByHash, issues, `/productionEvaluations/${index}`);
    if (validated) productionByHash.set(decoded.sha256, validated);
  }
  const derivedOutcomeByHash = new Map<string, DerivedOutcome>();
  for (const [index, decoded] of decodedOutcomes.entries()) {
    const outcome = decoded.value;
    const base = `/outcomes/${index}`;
    let valid = true;
    const freeze = manifest.holdoutFreeze;
    const fail = (code: string, path: string, message: string): void => { valid = false; issue(issues, code, path, message); };
    const production = productionByHash.get(outcome.productionEvaluationSha256);
    if (!production || production.evaluation.ruleId !== outcome.ruleId || production.evaluation.candidateConfigHash !== outcome.candidateConfigHash) fail("outcome-production-evaluation-binding", base, "outcome requires the exact validated production evaluation bytes");
    else if (!occursNoLater(production.evaluation.createdAt, outcome.createdAt)) fail("production-outcome-time-order", base, "production evaluation must exist before its target-level outcome");
    if (!freeze || outcome.holdoutLineageId !== freeze.holdoutLineageId || outcome.holdoutId !== freeze.holdoutId || outcome.holdoutVersion !== freeze.version || outcome.holdoutManifestHash !== freeze.manifestHash) fail("outcome-holdout-binding", base, "outcome does not bind the exact frozen holdout");
    else if (!occursNoLater(freeze.frozenAt, outcome.createdAt)) fail("outcome-time-order", base, "outcome must be produced after the frozen holdout exists");
    const outcomeReceipt = receiptByHash.get(outcome.preregistrationReceiptSha256);
    if (!outcomeReceipt || outcomeReceipt.planSha256 !== outcome.planSha256 || outcomeReceipt.holdoutLineageId !== outcome.holdoutLineageId || outcomeReceipt.holdoutId !== outcome.holdoutId) fail("outcome-receipt-binding", base, "outcome requires the exact externally anchored receipt");
    const expectedTargets = holdoutDocuments.flatMap((document) => document.targets.filter((target) => target.ruleId === outcome.ruleId).map((target) => ({ document, target })));
    const expectedByKey = new Map(expectedTargets.map((entry) => [`${entry.document.documentId}\0${entry.target.targetId}`, entry]));
    const seenRows = new Set<string>();
    let tp = 0; let tn = 0; let fp = 0; let fn = 0; let excluded = 0;
    const includedDocs = new Set<string>(); const includedOrigins = new Set<string>();
    for (const [rowIndex, row] of outcome.rows.entries()) {
      const rowPath = `${base}/rows/${rowIndex}`;
      const key = `${row.documentId}\0${row.targetId}`;
      if (seenRows.has(key)) { fail("outcome-row-duplicate", rowPath, "holdout target appears more than once"); continue; }
      seenRows.add(key);
      const expected = expectedByKey.get(key);
      if (!expected) { fail("outcome-row-extra", rowPath, "row is not a target in the frozen holdout for this rule"); continue; }
      const { document, target } = expected;
      const productionRow = production?.rows.get(key);
      const commonBound = row.ruleId === outcome.ruleId && row.artifactSha256 === document.artifact.sha256
        && row.oracleSnapshotSha256 === oracleSnapshotSha256(target) && row.annotationSnapshotSha256 === annotationSnapshotSha256(target)
        && row.adjudicationSnapshotSha256 === adjudicationSnapshotSha256(target) && row.candidateConfigHash === outcome.candidateConfigHash
        && row.rendererFreezeId === outcome.rendererFreezeId && row.rendererContentHash === outcome.rendererContentHash
        && row.planSha256 === outcome.planSha256 && row.preregistrationReceiptSha256 === outcome.preregistrationReceiptSha256
        && row.holdoutLineageId === outcome.holdoutLineageId && row.holdoutId === outcome.holdoutId && row.holdoutVersion === outcome.holdoutVersion
        && productionRow !== undefined && row.productionEvaluationRowSha256 === sha256(canonicalJson(productionRow)) && row.productionDecision === productionRow.productionDecision
        && row.rendererFreezeId === document.rendererFreeze.rendererFreezeId && freeze?.rendererFreezeIds.includes(row.rendererFreezeId) === true;
      if (!commonBound) { fail("outcome-row-binding", rowPath, "row snapshots or candidate/renderer/plan/receipt/holdout bindings differ"); continue; }
      const eligible = targetEligible(document, target, issues, verifiedArtifacts, verifiedTargets, trustedDocuments);
      const finalTruth = target.adjudication?.finalLabel ?? target.oracle.groundTruth;
      if (row.evaluationDisposition === "included") {
        if (!eligible || (finalTruth !== "positive" && finalTruth !== "negative") || row.groundTruth !== finalTruth || row.excludedReason !== null || row.productionDecision === "declined") { fail("outcome-row-disposition", rowPath, "included row must be an eligible binary target with matching truth and production decision"); continue; }
        includedDocs.add(document.artifact.sha256); includedOrigins.add(document.originGroupId);
        if (finalTruth === "positive" && row.productionDecision === "finding") tp += 1;
        else if (finalTruth === "positive") fn += 1;
        else if (row.productionDecision === "finding") fp += 1;
        else tn += 1;
      } else {
        const expectedReason = target.ambiguityStatus === "invalid_target" || finalTruth === "excluded_invalid" ? "invalid_target" : target.ambiguityStatus === "abstained" ? "abstained" : target.ambiguityStatus === "ambiguous" || finalTruth === "ambiguous" ? "ambiguous" : "production-declined";
        if (row.groundTruth !== null || row.excludedReason !== expectedReason || (expectedReason === "production-declined" && row.productionDecision !== "declined")) { fail("outcome-row-disposition", rowPath, "excluded row must preserve its exact non-binary or declined reason"); continue; }
        excluded += 1;
      }
    }
    for (const key of expectedByKey.keys()) if (!seenRows.has(key)) fail("outcome-row-missing", base, "every frozen holdout target for the rule requires exactly one outcome row");
    if (valid) derivedOutcomeByHash.set(decoded.sha256, { outcome, claimEvidentiary: production?.claimEvidentiary === true, captureEvidenceBytesValid: production?.captureEvidenceBytesValid === true, captureAttestorTrustValid: production?.captureAttestorTrustValid === true, truePositive: tp, trueNegative: tn, falsePositive: fp, falseNegative: fn, excludedAmbiguous: excluded, evaluatedTargetCount: expectedTargets.length, includedBinaryTargetCount: tp + tn + fp + fn, excludedTargetCount: excluded, eligibleHoldoutDocuments: includedDocs.size, eligibleHoldoutOriginGroups: includedOrigins.size });
  }
  const acceptanceByHash = new Map<string, AcceptanceReport>();
  let acceptanceReportsValid = Boolean(options.acceptanceReports?.length) && decodedAcceptanceReports.length === options.acceptanceReports?.length;
  for (const [index, decoded] of decodedAcceptanceReports.entries()) {
    const report = decoded.value;
    let reportPasses = true;
    const derived = derivedOutcomeByHash.get(report.outcomeSha256);
    if (!derived) {
      reportPasses = false;
      acceptanceReportsValid = false;
      issue(issues, "acceptance-outcome-missing", `/acceptanceReports/${index}/outcomeSha256`, "acceptance requires exact external per-target outcome bytes");
    } else {
      const expectedCounts = { truePositive: derived.truePositive, trueNegative: derived.trueNegative, falsePositive: derived.falsePositive, falseNegative: derived.falseNegative, excludedAmbiguous: derived.excludedAmbiguous };
      const derivedBinding = canonicalJson(report.confusionCounts) === canonicalJson(expectedCounts)
        && report.evaluatedTargetCount === derived.evaluatedTargetCount && report.includedBinaryTargetCount === derived.includedBinaryTargetCount
        && report.excludedTargetCount === derived.excludedTargetCount && report.eligibleHoldoutDocuments === derived.eligibleHoldoutDocuments
        && report.eligibleHoldoutOriginGroups === derived.eligibleHoldoutOriginGroups && report.ruleId === derived.outcome.ruleId
        && report.holdoutLineageId === derived.outcome.holdoutLineageId && report.holdoutId === derived.outcome.holdoutId
        && report.holdoutVersion === derived.outcome.holdoutVersion && report.holdoutManifestHash === derived.outcome.holdoutManifestHash
        && report.candidateConfigHash === derived.outcome.candidateConfigHash && report.rendererFreezeId === derived.outcome.rendererFreezeId
        && report.rendererContentHash === derived.outcome.rendererContentHash && report.planSha256 === derived.outcome.planSha256
        && report.preregistrationReceiptSha256 === derived.outcome.preregistrationReceiptSha256;
      if (!derivedBinding) {
        reportPasses = false;
        acceptanceReportsValid = false;
        issue(issues, "acceptance-outcome-binding", `/acceptanceReports/${index}`, "reported counts and bindings differ from validator-recomputed target outcomes");
      }
      if (!occursNoLater(derived.outcome.createdAt, report.createdAt)) {
        reportPasses = false;
        acceptanceReportsValid = false;
        issue(issues, "acceptance-time-order", `/acceptanceReports/${index}`, "acceptance report must be created after its target-level outcome");
      }
    }
    const plan = planByHash.get(report.planSha256);
    if (!plan) {
      reportPasses = false;
      acceptanceReportsValid = false;
      issue(issues, "acceptance-plan-report-missing", `/acceptanceReports/${index}/planSha256`, "acceptance report requires the exact external preregistered plan bytes");
    } else {
      if (canonicalJson(report.gates) !== canonicalJson(plan.gates)) {
        reportPasses = false;
        acceptanceReportsValid = false;
        issue(issues, "acceptance-plan-gate-mismatch", `/acceptanceReports/${index}/gates`, "report gates must exactly mirror the authoritative external plan");
      }
      if (report.preregisteredPlanId !== plan.planId || report.ruleId !== plan.ruleId || report.candidateConfigHash !== plan.candidateConfigHash || report.acceptanceGateVersion !== plan.acceptanceGateVersion) {
        reportPasses = false;
        acceptanceReportsValid = false;
        issue(issues, "acceptance-plan-report-binding", `/acceptanceReports/${index}`, "acceptance report does not match its authoritative plan");
      }
      if (!occursNoLater(plan.createdAt, report.createdAt) || (manifest.holdoutFreeze && !occursNoLater(plan.createdAt, manifest.holdoutFreeze.frozenAt))) {
        reportPasses = false;
        acceptanceReportsValid = false;
        issue(issues, "acceptance-plan-time-order", `/acceptanceReports/${index}`, "acceptance plan must predate holdout freeze and report");
      }
    }
    const authoritativeGates = plan?.gates ?? report.gates;
    const metrics = new Set(authoritativeGates.map((gate) => gate.metric));
    if (authoritativeGates.length !== 4 || metrics.size !== 4) {
      reportPasses = false;
      acceptanceReportsValid = false;
      issue(issues, "acceptance-gate-incomplete", `/acceptanceReports/${index}/gates`, "exactly one preregistered gate is required for each of precision, recall, specificity and false-positive-rate");
    }
    for (const gate of authoritativeGates) {
      const observed = metricValue(report, gate.metric);
      if (observed === null || (gate.operator === ">=" ? observed < gate.threshold : observed > gate.threshold)) {
        reportPasses = false;
        acceptanceReportsValid = false;
        issue(issues, "acceptance-gate-failed", `/acceptanceReports/${index}/gates`, `${gate.metric} failed ${gate.operator} ${gate.threshold}`);
      }
    }
    if (reportPasses) acceptanceByHash.set(decoded.sha256, report);
  }
  const lineageSnapshotByHash = new Map<string, LineageSnapshot>();
  for (const [index, decoded] of decodedLineageSnapshots.entries()) {
    const base = `/lineageSnapshots/${index}`;
    const snapshot = decoded.value;
    const issueStart = issues.length;
    const receiptExternal = decodeLineageArtifact<PreregistrationReceipt>(snapshot.artifacts.preregistrationReceipt, VALIDATORS.receipt, issues, `${base}/artifacts/preregistrationReceipt`);
    const planExternal = decodeLineageArtifact<AcceptancePlan>(snapshot.artifacts.acceptancePlan, VALIDATORS.plan, issues, `${base}/artifacts/acceptancePlan`);
    const candidateExternal = decodeLineageArtifact<Manifest["candidateSelections"][number]>(snapshot.artifacts.candidateSelection, VALIDATORS.candidateSelection, issues, `${base}/artifacts/candidateSelection`);
    const captureEvidenceExternal = snapshot.artifacts.captureEvidenceBundle === null ? null : decodeLineageArtifact<CaptureEvidenceBundle>(snapshot.artifacts.captureEvidenceBundle, VALIDATORS.captureEvidence, issues, `${base}/artifacts/captureEvidenceBundle`);
    const captureExternal = snapshot.artifacts.captureAttestation === null ? null : decodeLineageArtifact<CaptureAttestation>(snapshot.artifacts.captureAttestation, VALIDATORS.capture, issues, `${base}/artifacts/captureAttestation`);
    const measurementExternal = decodeLineageArtifact<MeasurementReceipt>(snapshot.artifacts.measurementReceipt, VALIDATORS.measurement, issues, `${base}/artifacts/measurementReceipt`);
    const productionExternal = decodeLineageArtifact<ProductionEvaluation>(snapshot.artifacts.productionEvaluation, VALIDATORS.production, issues, `${base}/artifacts/productionEvaluation`);
    const outcomeExternal = decodeLineageArtifact<OutcomeArtifact>(snapshot.artifacts.outcome, VALIDATORS.outcome, issues, `${base}/artifacts/outcome`);
    const acceptanceExternal = decodeLineageArtifact<AcceptanceReport>(snapshot.artifacts.acceptanceReport, VALIDATORS.acceptance, issues, `${base}/artifacts/acceptanceReport`);
    if (!receiptExternal || !planExternal || !candidateExternal || (snapshot.artifacts.captureEvidenceBundle !== null && !captureEvidenceExternal) || (snapshot.artifacts.captureAttestation !== null && !captureExternal) || !measurementExternal || !productionExternal || !outcomeExternal || !acceptanceExternal) continue;
    const receipt = receiptExternal.value;
    const plan = planExternal.value;
    const candidate = candidateExternal.value;
    const outcome = outcomeExternal.value;
    const acceptance = acceptanceExternal.value;
    const splitKeys = snapshot.documentSplits.map((entry) => entry.documentId);
    if (new Set(splitKeys).size !== splitKeys.length || canonicalJson([...snapshot.documentSplits].sort((left, right) => left.documentId.localeCompare(right.documentId, "en"))) !== canonicalJson(snapshot.documentSplits)) issue(issues, "lineage-document-splits", `${base}/documentSplits`, "historical document/split projection must be unique and canonically ordered");
    const splitByDocument = new Map(snapshot.documentSplits.map((entry) => [entry.documentId, entry.split]));
    if (snapshot.freeze.orderedDocuments.some((document) => splitByDocument.get(document.documentId) !== "holdout")) issue(issues, "lineage-document-splits", `${base}/documentSplits`, "every frozen holdout document must remain holdout in the embedded split projection");
    if (canonicalJson([...snapshot.knownOutcomeSha256s].sort()) !== canonicalJson(snapshot.knownOutcomeSha256s) || !snapshot.knownOutcomeSha256s.includes(snapshot.artifacts.outcome.sha256)) issue(issues, "lineage-known-outcomes", `${base}/knownOutcomeSha256s`, "known outcomes must be canonical and include this evaluation's exact outcome bytes");
    const tupleKeys = snapshot.targetTuples.map((tuple) => `${tuple.documentId}\0${tuple.targetId}`);
    if (new Set(tupleKeys).size !== tupleKeys.length || canonicalJson([...snapshot.targetTuples].sort((left, right) => `${left.documentId}\0${left.targetId}`.localeCompare(`${right.documentId}\0${right.targetId}`, "en"))) !== canonicalJson(snapshot.targetTuples)) issue(issues, "lineage-target-tuples", `${base}/targetTuples`, "frozen target tuples must be unique and canonically ordered");
    const orderedDocuments = [...new Map(snapshot.targetTuples.map((tuple) => [tuple.documentId, { documentId: tuple.documentId, artifactSha256: tuple.artifactSha256, originGroupId: tuple.originGroupId }])).values()].sort((left, right) => left.documentId.localeCompare(right.documentId, "en"));
    const rendererFreezeIds = [...new Set(snapshot.targetTuples.map((tuple) => tuple.rendererFreezeId))].sort();
    if (canonicalJson(snapshot.freeze.orderedDocuments) !== canonicalJson(orderedDocuments) || canonicalJson(snapshot.freeze.rendererFreezeIds) !== canonicalJson(rendererFreezeIds)) issue(issues, "lineage-freeze-projection", `${base}/freeze`, "freeze document and renderer projection differs from its target tuples");
    const bindings = new Map(snapshot.targetTuples.filter((tuple) => tuple.ruleId === measurementExternal.value.ruleId).map((tuple) => [`${tuple.documentId}\0${tuple.targetId}`, { documentId: tuple.documentId, artifactSha256: tuple.artifactSha256, targetId: tuple.targetId, ruleId: tuple.ruleId, rendererFreezeId: tuple.rendererFreezeId, rendererContentHash: tuple.rendererContentHash, rendererSourceIdentitySha256: tuple.rendererSourceIdentitySha256, svgRootKey: tuple.svgRootKey, sourceIdentity: tuple.sourceIdentity }]));
    const localMeasurementByHash = new Map<string, ValidatedMeasurement>();
    const localCaptureEvidenceByHash = new Map<string, CaptureEvidenceBundle>();
    if (captureEvidenceExternal && snapshot.artifacts.captureEvidenceBundle) localCaptureEvidenceByHash.set(snapshot.artifacts.captureEvidenceBundle.sha256, captureEvidenceExternal.value);
    const localCaptureByHash = new Map<string, CaptureAttestation>();
    if (captureExternal && snapshot.artifacts.captureAttestation) localCaptureByHash.set(snapshot.artifacts.captureAttestation.sha256, captureExternal.value);
    const validatedMeasurement = validateMeasurementReceipt(measurementExternal, bindings, localCaptureEvidenceByHash, localCaptureByHash, issues, `${base}/measurementReceipt`);
    if (validatedMeasurement) localMeasurementByHash.set(snapshot.artifacts.measurementReceipt.sha256, validatedMeasurement);
    const validatedProduction = validateProductionEvaluation(productionExternal, localMeasurementByHash, issues, `${base}/productionEvaluation`);
    const candidateSemanticallyValid = validateCandidateSelectionSemantics({
      selection: candidate,
      plan,
      receipt,
      freeze: snapshot.freeze,
      documentSplits: new Map(snapshot.documentSplits.map((entry) => [entry.documentId, entry.split])),
      knownOutcomeSha256s: new Set(snapshot.knownOutcomeSha256s),
      issues,
      path: `${base}/artifacts/candidateSelection`,
    });
    const event = manifest.evaluationLedger.find((entry) => entry.eventId === snapshot.eventId);
    if (event) {
      const expectedKnownOutcomes = manifest.evaluationLedger.filter((entry) => entry.appendOnlySequence <= event.appendOnlySequence).map((entry) => entry.outcomeSha256).sort();
      if (canonicalJson(snapshot.knownOutcomeSha256s) !== canonicalJson(expectedKnownOutcomes)) issue(issues, "lineage-known-outcomes", `${base}/knownOutcomeSha256s`, "embedded known outcomes must equal the append-only evaluation prefix at this event");
    }
    const hashBindings = event
      && event.holdoutLineageId === snapshot.holdoutLineageId && event.holdoutId === snapshot.holdoutId && event.holdoutVersion === snapshot.holdoutVersion
      && event.holdoutManifestHash === snapshot.freeze.manifestHash && canonicalJson(event.rendererFreezeIds) === canonicalJson(snapshot.freeze.rendererFreezeIds)
      && event.preregistrationReceiptSha256 === snapshot.artifacts.preregistrationReceipt.sha256
      && event.planSha256 === snapshot.artifacts.acceptancePlan.sha256
      && event.candidateConfigHash === candidate.candidateConfigHash
      && event.productionEvaluationSha256 === snapshot.artifacts.productionEvaluation.sha256
      && event.outcomeSha256 === snapshot.artifacts.outcome.sha256
      && event.acceptanceReportSha256 === snapshot.artifacts.acceptanceReport.sha256;
    if (!hashBindings) issue(issues, "lineage-event-binding", base, "event does not bind this snapshot's freeze and exact external artifact bytes");
    const crossBound = candidateSemanticallyValid && snapshot.freeze.holdoutLineageId === snapshot.holdoutLineageId && snapshot.freeze.holdoutId === snapshot.holdoutId && snapshot.freeze.version === snapshot.holdoutVersion
      && receipt.planSha256 === snapshot.artifacts.acceptancePlan.sha256 && receipt.holdoutLineageId === snapshot.holdoutLineageId && receipt.holdoutId === snapshot.holdoutId
      && candidate.planSha256 === snapshot.artifacts.acceptancePlan.sha256 && candidate.preregistrationReceiptSha256 === snapshot.artifacts.preregistrationReceipt.sha256
      && plan.planId === candidate.preregisteredPlanId && plan.candidateSelectionId === candidate.selectionId && plan.candidateConfigHash === candidate.candidateConfigHash && plan.ruleId === candidate.ruleId
      && validatedMeasurement?.receipt.candidateConfigHash === candidate.candidateConfigHash && validatedProduction?.evaluation.measurementReceiptSha256 === snapshot.artifacts.measurementReceipt.sha256
      && validatedProduction?.evaluation.candidateConfigHash === candidate.candidateConfigHash && outcome.productionEvaluationSha256 === snapshot.artifacts.productionEvaluation.sha256
      && outcome.planSha256 === snapshot.artifacts.acceptancePlan.sha256 && outcome.preregistrationReceiptSha256 === snapshot.artifacts.preregistrationReceipt.sha256
      && outcome.holdoutLineageId === snapshot.holdoutLineageId && outcome.holdoutId === snapshot.holdoutId && outcome.holdoutVersion === snapshot.holdoutVersion && outcome.holdoutManifestHash === snapshot.freeze.manifestHash
      && acceptance.outcomeSha256 === snapshot.artifacts.outcome.sha256 && acceptance.planSha256 === snapshot.artifacts.acceptancePlan.sha256 && acceptance.preregistrationReceiptSha256 === snapshot.artifacts.preregistrationReceipt.sha256
      && acceptance.holdoutLineageId === snapshot.holdoutLineageId && acceptance.holdoutId === snapshot.holdoutId && acceptance.holdoutVersion === snapshot.holdoutVersion && acceptance.holdoutManifestHash === snapshot.freeze.manifestHash;
    if (!crossBound) issue(issues, "lineage-artifact-binding", `${base}/artifacts`, "receipt, plan, candidate, measurement, production, outcome and acceptance bytes do not form one lineage");
    const targetByKey = new Map(snapshot.targetTuples.filter((tuple) => tuple.ruleId === outcome.ruleId).map((tuple) => [`${tuple.documentId}\0${tuple.targetId}`, tuple]));
    const seen = new Set<string>(); let tp = 0; let tn = 0; let fp = 0; let fn = 0; let excluded = 0;
    const includedDocs = new Set<string>(); const includedOrigins = new Set<string>();
    for (const [rowIndex, row] of outcome.rows.entries()) {
      const key = `${row.documentId}\0${row.targetId}`; const tuple = targetByKey.get(key); const productionRow = validatedProduction?.rows.get(key);
      const rowBound = tuple && !seen.has(key) && row.artifactSha256 === tuple.artifactSha256 && row.ruleId === tuple.ruleId
        && row.oracleSnapshotSha256 === tuple.oracleSnapshotSha256 && row.annotationSnapshotSha256 === tuple.annotationSnapshotSha256 && row.adjudicationSnapshotSha256 === tuple.adjudicationSnapshotSha256
        && row.rendererFreezeId === tuple.rendererFreezeId && row.rendererContentHash === tuple.rendererContentHash
        && productionRow && row.productionEvaluationRowSha256 === sha256(canonicalJson(productionRow)) && row.productionDecision === productionRow.productionDecision;
      if (!rowBound) { issue(issues, "lineage-outcome-row-binding", `${base}/artifacts/outcome/rows/${rowIndex}`, "outcome row differs from frozen tuple or real Rule.run row"); continue; }
      seen.add(key);
      if (row.evaluationDisposition === "included" && (tuple.finalLabel === "positive" || tuple.finalLabel === "negative") && row.groundTruth === tuple.finalLabel && row.excludedReason === null && row.productionDecision !== "declined") {
        includedDocs.add(tuple.artifactSha256); includedOrigins.add(tuple.originGroupId);
        if (tuple.finalLabel === "positive" && row.productionDecision === "finding") tp += 1;
        else if (tuple.finalLabel === "positive") fn += 1;
        else if (row.productionDecision === "finding") fp += 1;
        else tn += 1;
      } else if (row.evaluationDisposition === "excluded" && row.groundTruth === null && ((row.productionDecision === "declined" && row.excludedReason === "production-declined") || tuple.finalLabel === "ambiguous" || tuple.finalLabel === "excluded_invalid")) excluded += 1;
      else issue(issues, "lineage-outcome-disposition", `${base}/artifacts/outcome/rows/${rowIndex}`, "outcome disposition differs from frozen final label or real production decline");
    }
    if (seen.size !== targetByKey.size) issue(issues, "lineage-outcome-target-set", `${base}/artifacts/outcome`, "outcome must contain every governed frozen target exactly once");
    const counts = { truePositive: tp, trueNegative: tn, falsePositive: fp, falseNegative: fn, excludedAmbiguous: excluded };
    const acceptanceBound = canonicalJson(acceptance.confusionCounts) === canonicalJson(counts)
      && acceptance.evaluatedTargetCount === targetByKey.size && acceptance.includedBinaryTargetCount === tp + tn + fp + fn && acceptance.excludedTargetCount === excluded
      && acceptance.eligibleHoldoutDocuments === includedDocs.size && acceptance.eligibleHoldoutOriginGroups === includedOrigins.size
      && canonicalJson(acceptance.gates) === canonicalJson(plan.gates);
    if (!acceptanceBound) issue(issues, "lineage-acceptance-binding", `${base}/artifacts/acceptanceReport`, "acceptance counts or gates differ from frozen target rows");
    for (const gate of plan.gates) {
      const expectedOperator = gate.metric === "false-positive-rate" ? "<=" : ">=";
      const observed = metricFromCounts(counts, gate.metric);
      if (gate.operator !== expectedOperator || observed === null || (gate.operator === ">=" ? observed < gate.threshold : observed > gate.threshold)) issue(issues, "lineage-acceptance-gate", `${base}/artifacts/acceptancePlan`, `${gate.metric} is invalid or failed`);
    }
    const chronology = occursNoLater(plan.createdAt, receipt.issuedAt)
      && occursNoLater(receipt.issuedAt, snapshot.freeze.frozenAt)
      && validatedMeasurement !== null && occursNoLater(snapshot.freeze.frozenAt, validatedMeasurement.receipt.createdAt)
      && validatedMeasurement.receipt.rows.every((row) => occursNoLater(snapshot.freeze.frozenAt, row.measuredAt) && occursNoLater(row.measuredAt, validatedMeasurement.receipt.createdAt))
      && validatedProduction !== null && occursNoLater(validatedMeasurement.receipt.createdAt, validatedProduction.evaluation.createdAt)
      && occursNoLater(validatedProduction.evaluation.createdAt, outcome.createdAt)
      && occursNoLater(outcome.createdAt, acceptance.createdAt)
      && occursNoLater(acceptance.createdAt, snapshot.createdAt)
      && Boolean(event && occursNoLater(snapshot.createdAt, event.createdAt));
    if (!chronology) issue(issues, "lineage-time-order", base, "required order is plan <= receipt <= freeze <= measurement <= production <= outcome <= acceptance <= lineage snapshot <= event");
    if (manifest.holdoutFreeze?.holdoutLineageId === snapshot.holdoutLineageId) {
      const currentSplits = manifest.documents.map((document) => ({ documentId: document.documentId, split: document.split })).sort((left, right) => left.documentId.localeCompare(right.documentId, "en"));
      const currentOutcomeHashes = new Set(manifest.evaluationLedger.map((entry) => entry.outcomeSha256));
      if (canonicalJson(snapshot.freeze) !== canonicalJson(manifest.holdoutFreeze) || canonicalJson(snapshot.targetTuples) !== canonicalJson(lineageTargetTuples(manifest)) || canonicalJson(snapshot.documentSplits) !== canonicalJson(currentSplits) || [...currentOutcomeHashes].some((hash) => !snapshot.knownOutcomeSha256s.includes(hash))) issue(issues, "lineage-current-freeze-binding", base, "current lineage snapshot differs from the current manifest freeze, split/target projection or known outcomes");
    }
    if (issues.length === issueStart) lineageSnapshotByHash.set(decoded.sha256, snapshot);
  }
  for (const event of manifest.evaluationLedger) {
    const snapshot = lineageSnapshotByHash.get(event.lineageSnapshotSha256);
    if (!snapshot || snapshot.eventId !== event.eventId) issue(issues, "evaluation-lineage-snapshot-missing", `/evaluationLedger/${event.eventId}`, "every evaluation event requires its exact validated external lineage snapshot bytes");
  }
  for (const event of manifest.evaluationLedger) {
    if (event.holdoutLineageId !== manifest.holdoutFreeze?.holdoutLineageId) continue;
    const production = productionByHash.get(event.productionEvaluationSha256)?.evaluation;
    const outcome = derivedOutcomeByHash.get(event.outcomeSha256)?.outcome;
    const acceptance = acceptanceByHash.get(event.acceptanceReportSha256);
    if (!production || !outcome || !acceptance || !occursNoLater(production.createdAt, outcome.createdAt) || !occursNoLater(outcome.createdAt, acceptance.createdAt) || !occursNoLater(acceptance.createdAt, event.createdAt)) issue(issues, "evaluation-time-order", `/evaluationLedger/${event.eventId}`, "evaluation ledger entry must follow validated production, outcome and acceptance artifacts");
  }
  const rules = {} as Record<RuleId, RuleReadiness>;
  let registryConsistent = true;
  for (const ruleId of RULE_IDS) {
    const eligibleDocuments = manifest.documents.filter((document) => document.targets.some((target) => target.ruleId === ruleId && targetEligible(document, target, issues, verifiedArtifacts, verifiedTargets, trustedDocuments)));
    const uniqueEligible = eligibleDocuments.filter((document, index, all) => all.findIndex((other) => other.artifact.sha256 === document.artifact.sha256) === index);
    const documentCount = uniqueEligible.length;
    const originCount = new Set(uniqueEligible.map((document) => document.originGroupId)).size;
    const development = uniqueEligible.some((document) => document.split === "development");
    const tuning = uniqueEligible.some((document) => document.split === "tuning");
    const matchingClaims = manifest.readinessClaims.filter((entry) => entry.ruleId === ruleId);
    const claim = matchingClaims[0];
    if (!claim) { issue(issues, "readiness-claim-missing", `/readinessClaims/${ruleId}`, "every rule requires claim"); rules[ruleId] = emptyRules()[ruleId]; continue; }
    if (matchingClaims.length !== 1) issue(issues, "readiness-claim-duplicate", `/readinessClaims/${ruleId}`, "rule requires exactly one claim");
    const expectedMode = ruleId === "svg/text-overflows-viewport" ? "structural-validation" : "empirical-threshold";
    if (claim.calibrationMode !== expectedMode) issue(issues, "calibration-mode", `/readinessClaims/${ruleId}`, `expected ${expectedMode}`);
    if (claim.eligibleRealDocuments !== documentCount || claim.eligibleOriginGroups !== originCount) issue(issues, "readiness-count-mismatch", `/readinessClaims/${ruleId}`, "declared counts differ from unique verified byte/origin counts");
    if (expectedMode === "structural-validation" && claim.thresholdCandidateHash !== null) issue(issues, "structural-threshold-candidate", `/readinessClaims/${ruleId}/thresholdCandidateHash`, "structural rule has no tunable threshold");
    const selections = manifest.candidateSelections.filter((entry) => entry.ruleId === ruleId && entry.candidateConfigHash === claim.candidateConfigHash);
    if (claim.candidateConfigHash !== null && selections.length !== 1) issue(issues, "candidate-selection-binding", `/readinessClaims/${ruleId}/candidateConfigHash`, "candidate requires exactly one selection");
    if (selections[0] && selections[0].thresholdCandidateHash !== claim.thresholdCandidateHash) issue(issues, "candidate-threshold-binding", `/readinessClaims/${ruleId}/thresholdCandidateHash`, "threshold candidate differs");
    const selection = selections[0];
    const selectionPlan = selection ? planByHash.get(selection.planSha256) : undefined;
    if (selection && claim.acceptancePlanSha256 !== selection.planSha256) issue(issues, "acceptance-plan-claim-binding", `/readinessClaims/${ruleId}/acceptancePlanSha256`, "claim must bind the candidate's exact external acceptance plan");
    const planBound = Boolean(selection && selectionPlan && planBoundSelections.has(selection.selectionId) && claim.acceptancePlanSha256 === selection.planSha256);
    const readyForCalibration = claim.acceptedSamplingPlan && development && tuning && documentCount > 0 && originCount > 0 && trustLedgerSchemaValid && acceptancePlansValid && planBound;
    const acceptance = claim.acceptanceReportSha256 ? acceptanceByHash.get(claim.acceptanceReportSha256) : undefined;
    const rendererHash = claim.rendererFreezeId ? rendererHashById.get(claim.rendererFreezeId) : undefined;
    let acceptanceBound = false;
    if (acceptance) {
      acceptanceBound = Boolean(manifest.holdoutFreeze && selectionPlan && acceptance.planSha256 === claim.acceptancePlanSha256 && acceptance.planSha256 === selection?.planSha256 && manifest.holdoutFreeze.acceptancePlanHashes.includes(acceptance.planSha256) && acceptance.ruleId === ruleId && acceptance.holdoutLineageId === claim.holdoutLineageId && acceptance.holdoutLineageId === manifest.holdoutFreeze.holdoutLineageId && acceptance.holdoutId === manifest.holdoutFreeze.holdoutId && acceptance.holdoutVersion === manifest.holdoutFreeze.version && acceptance.holdoutManifestHash === manifest.holdoutFreeze.manifestHash && acceptance.candidateConfigHash === claim.candidateConfigHash && acceptance.rendererFreezeId === claim.rendererFreezeId && acceptance.rendererContentHash === claim.rendererContentHash && acceptance.rendererContentHash === rendererHash && acceptance.acceptanceGateVersion === claim.acceptanceGateVersion && acceptance.outcomeSha256 === claim.outcomeSha256 && acceptance.preregistrationReceiptSha256 === claim.preregistrationReceiptSha256 && acceptance.preregistrationReceiptSha256 === manifest.holdoutFreeze.preregistrationReceiptSha256 && selection?.preregisteredPlanId === acceptance.preregisteredPlanId);
      if (!acceptanceBound) issue(issues, "acceptance-report-binding", `/readinessClaims/${ruleId}`, "external acceptance report binding failed");
      if (!manifest.evaluationLedger.some((entry) => entry.acceptanceReportSha256 === claim.acceptanceReportSha256 && entry.outcomeSha256 === claim.outcomeSha256 && entry.preregistrationReceiptSha256 === claim.preregistrationReceiptSha256 && entry.holdoutLineageId === claim.holdoutLineageId && entry.candidateConfigHash === claim.candidateConfigHash && entry.planSha256 === claim.acceptancePlanSha256 && lineageSnapshotByHash.has(entry.lineageSnapshotSha256))) { acceptanceBound = false; issue(issues, "acceptance-ledger-binding", `/readinessClaims/${ruleId}`, "acceptance, outcome, receipt, plan and immutable lineage snapshot binding absent from evaluation ledger"); }
    }
    const claimOutcome = claim.outcomeSha256 ? derivedOutcomeByHash.get(claim.outcomeSha256) : undefined;
    const evidentiaryHoldoutDocuments = claimOutcome?.claimEvidentiary === true ? claimOutcome.eligibleHoldoutDocuments : 0;
    const evidentiaryHoldoutOrigins = claimOutcome?.claimEvidentiary === true ? claimOutcome.eligibleHoldoutOriginGroups : 0;
    const captureEvidenceBytesValid = claimOutcome?.captureEvidenceBytesValid === true;
    const captureAttestorTrustValid = false;
    const readyForClaim = readyForCalibration && documentCount >= MINIMUM_REAL_DOCUMENTS && originCount >= MINIMUM_REAL_DOCUMENTS && holdoutFrozen && acceptanceBound && claimOutcome?.claimEvidentiary === true && captureAttestorTrustValid;
    if (claim.ruleReadyForCalibration !== readyForCalibration) issue(issues, "calibration-readiness-false-claim", `/readinessClaims/${ruleId}/ruleReadyForCalibration`, `validated value ${readyForCalibration}`);
    if (claim.ruleReadyForCalibratedClaim !== readyForClaim) issue(issues, "calibrated-claim-readiness-false-claim", `/readinessClaims/${ruleId}/ruleReadyForCalibratedClaim`, `validated value ${readyForClaim}`);
    const registryCalibrated = Boolean(RULES_BY_ID.get(ruleId)?.calibrated);
    if (claim.calibratedClaim && (!readyForClaim || !registryCalibrated)) { issue(issues, "calibrated-claim-without-gate", `/readinessClaims/${ruleId}/calibratedClaim`, "calibrated:true requires external gates and authorized registry state"); registryConsistent = false; }
    if (!claim.calibratedClaim && registryCalibrated) { issue(issues, "registry-calibrated-without-claim", `/readinessClaims/${ruleId}`, "registry true lacks validated claim"); registryConsistent = false; }
    rules[ruleId] = { calibration_mode: expectedMode, eligible_real_documents: documentCount, eligible_origin_groups: originCount, eligible_real_evidentiary_holdout_documents: evidentiaryHoldoutDocuments, eligible_real_evidentiary_holdout_origin_groups: evidentiaryHoldoutOrigins, capture_evidence_bytes_valid: captureEvidenceBytesValid, capture_attestor_trust_valid: captureAttestorTrustValid, rule_ready_for_calibration: readyForCalibration, rule_ready_for_calibrated_claim: readyForClaim };
  }
  const sortedIssues = issues.sort((a, b) => `${a.code}:${a.path}:${a.message}`.localeCompare(`${b.code}:${b.path}:${b.message}`, "en"));
  const has = (...prefixes: string[]): boolean => sortedIssues.some((entry) => prefixes.some((prefix) => entry.code.startsWith(prefix)));
  const captureEvidenceBytesValid = [...derivedOutcomeByHash.values()].some((outcome) => outcome.captureEvidenceBytesValid) && !has("capture-evidence");
  const checks = { schema_valid: true, provenance_valid: !has("provenance", "license", "artifact", "public-artifact", "private-artifact", "synthetic-counted", "trust-"), privacy_valid: !has("privacy", "artifact-path", "artifact-symlink"), annotation_valid: !has("annotation", "adjudication", "adjudicator", "ambiguity", "nonbinary", "guideline", "synthetic-human"), split_valid: !has("split-", "candidate-holdout", "candidate-input", "artifact-hash-duplicate"), holdout_frozen: holdoutFrozen, oracle_independent: !has("oracle-", "target-source", "target-signature", "target-id-content"), renderer_identity_complete: !has("renderer-"), external_trust_valid: trustLedgerSchemaValid && !has("trust-"), external_holdout_baseline_valid: externalBaselineValid, acceptance_plans_valid: acceptancePlansValid && !has("acceptance-plan"), acceptance_reports_valid: acceptanceReportsValid && !has("acceptance-"), capture_evidence_bytes_valid: captureEvidenceBytesValid, capture_attestor_trust_valid: false, registry_state_consistent: registryConsistent };
  return { reportSchemaVersion: 1, validatorContractVersion: "m3-0-readiness-v1", manifestSha256, status: sortedIssues.length === 0 ? "valid" : "invalid", exitCode: sortedIssues.length === 0 ? 0 : 1, checks, rules, issues: sortedIssues };
}

function optionValues(flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) if (process.argv[index] === flag && process.argv[index + 1]) values.push(process.argv[index + 1]!);
  return values;
}
async function main(): Promise<void> {
  const manifestPath = process.argv[2];
  if (!manifestPath || manifestPath.startsWith("--")) { process.stderr.write("usage: readiness-validator.ts <manifest.json> [--artifact-root <dir>] [--previous-manifest <frozen.json>] [--trust-ledger <ledger.json>] [--acceptance-plan <plan.json>]... [--preregistration-receipt <receipt.json>]... [--capture-evidence <bundle.json>]... [--capture-attestation <attestation.json>]... [--measurement-receipt <receipt.json>]... [--production-evaluation <evaluation.json>]... [--outcome <outcome.json>]... [--acceptance-report <report.json>]... [--lineage-snapshot <snapshot.json>]... [--output <report.json>]\n"); process.exitCode = 2; return; }
  const singleFlags = new Set(["--artifact-root", "--previous-manifest", "--trust-ledger", "--output"]);
  const repeatFlags = new Set(["--acceptance-plan", "--preregistration-receipt", "--capture-evidence", "--capture-attestation", "--measurement-receipt", "--production-evaluation", "--outcome", "--acceptance-report", "--lineage-snapshot"]);
  const seenSingles = new Set<string>();
  for (let index = 3; index < process.argv.length; index += 2) {
    const flag = process.argv[index]!; const value = process.argv[index + 1];
    if ((!singleFlags.has(flag) && !repeatFlags.has(flag)) || !value || value.startsWith("--") || (singleFlags.has(flag) && seenSingles.has(flag))) { process.stderr.write(`readiness validator: invalid option sequence at ${flag}\n`); process.exitCode = 2; return; }
    if (singleFlags.has(flag)) seenSingles.add(flag);
  }
  const single = (flag: string): string | null => optionValues(flag)[0] ?? null;
  const artifactRoot = single("--artifact-root") ?? dirname(resolve(manifestPath));
  const output = single("--output");
  try {
    const bytes = readFileSync(resolve(manifestPath));
    const value = JSON.parse(bytes.toString("utf8")) as unknown;
    const readExternal = (path: string): ExternalArtifact<unknown> => ({ bytes: readFileSync(resolve(path)), value: undefined });
    const readPreviousManifest = (path: string): unknown => JSON.parse(readFileSync(resolve(path), "utf8")) as unknown;
    const previousPath = single("--previous-manifest");
    const trustPath = single("--trust-ledger");
    const report = validateManifest(value, { manifestBytes: bytes, artifactRoot, ...(previousPath ? { previousManifest: readPreviousManifest(previousPath) } : {}), ...(trustPath ? { trustLedger: readExternal(trustPath) } : {}), acceptancePlans: optionValues("--acceptance-plan").map(readExternal), preregistrationReceipts: optionValues("--preregistration-receipt").map(readExternal), captureEvidenceBundles: optionValues("--capture-evidence").map(readExternal), captureAttestations: optionValues("--capture-attestation").map(readExternal), measurementReceipts: optionValues("--measurement-receipt").map(readExternal), productionEvaluations: optionValues("--production-evaluation").map(readExternal), outcomes: optionValues("--outcome").map(readExternal), acceptanceReports: optionValues("--acceptance-report").map(readExternal), lineageSnapshots: optionValues("--lineage-snapshot").map(readExternal) });
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (output) writeFileSync(resolve(output), json);
    process.stdout.write(json);
    process.exitCode = report.exitCode;
  } catch (error) { process.stderr.write(`readiness validator: input unreadable: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; }
}
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) void main();
