import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  instantiateNegativeControl,
  loadCleanManifest,
  NEGATIVE_CONTROLS,
} from "../fixtures/calibration/negative-controls.ts";
import {
  canonicalJson,
  canonicalTargetId,
  executeProductRuleV1,
  adjudicationSnapshotSha256,
  annotationSnapshotSha256,
  contentDerivedRendererId,
  holdoutProjection,
  lineageTargetTuples,
  oracleSnapshotSha256,
  PRODUCT_RULE_EXECUTABLE_CONTRACTS,
  producerSourceIdentitySha256,
  rendererContentHash,
  validateManifest,
  type AcceptancePlan,
  type AcceptanceReport,
  type CandidateConfig,
  type CaptureAttestation,
  type CaptureEvidenceBundle,
  type ExternalArtifact,
  type LineageSnapshot,
  type Manifest,
  type MeasurementReceipt,
  type OutcomeArtifact,
  type PreregistrationReceipt,
  type ProductionEvaluation,
  type SnapshotProjection,
  type Target,
  type TrustLedger,
  type ValidationOptions,
} from "../tools/calibration/readiness-validator.ts";
import { repositorySourceIdentity } from "../tools/calibration/svg-validation-lab.ts";

const ARTIFACT_ROOT = fileURLToPath(new URL("../fixtures/calibration/", import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MANIFEST_BYTES = readFileSync(new URL("../fixtures/calibration/public-synthetic-manifest.json", import.meta.url));

function digest(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function external<T>(value: T): ExternalArtifact<T> {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  return { value, bytes };
}

function encoded<T>(artifact: ExternalArtifact<T>): { sha256: string; bytesBase64: string } {
  return { sha256: digest(artifact.bytes), bytesBase64: artifact.bytes.toString("base64") };
}

type SimulationRuleId = CandidateConfig["ruleId"];
const RULE_SHORT: Readonly<Record<SimulationRuleId, string>> = Object.freeze({ "svg/text-clipped": "clip", "svg/text-ink-collision": "collision", "svg/text-overflows-viewport": "viewport" });
const ORACLE_TRUTH_SEED = Object.freeze(["positive", "negative", "positive", "negative", "negative", "positive", "negative", "positive", "negative", "negative"] as const);
const MEASUREMENT_SCENARIO_SEED = Object.freeze(["finding", "clean", "finding", "clean", "finding", "finding", "clean", "finding", "clean", "declined"] as const);

function candidateFor(ruleId: SimulationRuleId): CandidateConfig {
  if (ruleId === "svg/text-clipped") return { ruleId, maxMissingInk: 0.05 };
  if (ruleId === "svg/text-ink-collision") return { ruleId, minCollisionInk: 8, minOccludedInk: 8 };
  return { ruleId, maxOvershootPx: 0 };
}

function snapshotFor(ruleId: SimulationRuleId, target: Target, scenario: (typeof MEASUREMENT_SCENARIO_SEED)[number], slot: number): SnapshotProjection {
  const finding = scenario === "finding";
  const declined = scenario === "declined";
  const clippedT0 = slot === 8 && ruleId === "svg/text-clipped" ? 0 : 100;
  const collisionInk = ruleId === "svg/text-ink-collision" && finding && slot !== 1 ? 8 : 0;
  const occludedInk = ruleId === "svg/text-ink-collision" && finding && slot === 1 ? 8 : 0;
  const box = ruleId === "svg/text-overflows-viewport" && finding
    ? { x: 95, y: 10, width: 20, height: 20 }
    : { x: 10, y: 10, width: 20, height: 20 };
  return {
    schemaVersion: 1 as const,
    documentPath: `opaque/${target.targetId}.html`,
    pageNumber: 1,
    svg: {
      nodeKey: `receipt-svg-${slot}`,
      sourceKey: target.svgRootKey,
      measurable: true,
      reason: null,
      viewportScreen: { x: 0, y: 0, width: 100, height: 100 },
      overflow: ruleId === "svg/text-overflows-viewport" && declined ? "visible" : "hidden",
      textTargetCount: 1,
      textTargetsCapped: ruleId === "svg/text-ink-collision" && declined,
      texts: [{
        targetKey: `receipt-target-${slot}`,
        svgTextKey: target.sourceIdentity,
        boxScreen: box,
        clipState: ruleId === "svg/text-clipped" ? "clip-path" as const : "none" as const,
        ink: {
          T: { count: ruleId === "svg/text-clipped" && finding ? 20 : clippedT0, maskHash: digest(`T-${ruleId}-${slot}`), intersectShapes: collisionInk, missingInFull: occludedInk },
          T0: { count: clippedT0, maskHash: digest(`T0-${ruleId}-${slot}`) },
        },
      }],
      shapes: [], paths: [],
      inkPasses: { E: { count: 0, maskHash: digest(`E-${ruleId}-${slot}`) }, S: { count: collisionInk, maskHash: digest(`S-${ruleId}-${slot}`) }, F: { count: 100, maskHash: digest(`F-${ruleId}-${slot}`) } },
      inkStable: !(ruleId === "svg/text-clipped" && declined),
    },
  };
}

function buildClaimGradeContractSimulation(artifactRoot: string, ruleId: SimulationRuleId = "svg/text-clipped", lineageSuffix = "contract_simulation_001", evidentiaryStatus: MeasurementReceipt["evidentiaryStatus"] = "non-evidentiary-contract-simulation"): {
  manifest: Manifest;
  previousManifest: Manifest;
  trustLedger: ExternalArtifact<TrustLedger>;
  acceptancePlan: ExternalArtifact<AcceptancePlan>;
  preregistrationReceipt: ExternalArtifact<PreregistrationReceipt>;
  captureEvidenceBundle: ExternalArtifact<CaptureEvidenceBundle> | null;
  captureAttestation: ExternalArtifact<CaptureAttestation> | null;
  measurementReceipt: ExternalArtifact<MeasurementReceipt>;
  outcome: ExternalArtifact<OutcomeArtifact>;
  productionEvaluation: ExternalArtifact<ProductionEvaluation>;
  acceptanceReport: ExternalArtifact<AcceptanceReport>;
  lineageSnapshot: ExternalArtifact<LineageSnapshot>;
} {
  const source = loadCleanManifest().documents[0]!;
  const manifest = loadCleanManifest();
  const ruleSpecs = [
    ["svg/text-clipped", "clip", "svg-text-clipped-v1"],
    ["svg/text-ink-collision", "collision", "svg-text-ink-collision-v1"],
    ["svg/text-overflows-viewport", "viewport", "svg-text-overflows-viewport-v1"],
  ] as const;
  manifest.manifestId = "manifest_contract_simulation_001";
  manifest.createdAt = "2026-08-22T20:09:00Z";
  manifest.documents = Array.from({ length: 30 }, (_, index) => {
    const suffix = index.toString().padStart(3, "0");
    const rootId = `simulation-root-${suffix}`;
    const authoredIds = ruleSpecs.map(([, short]) => `${short}-target-${suffix}`);
    const bytes = Buffer.from(`<!doctype html><html><body><svg id="${rootId}" viewBox="0 0 400 140">${authoredIds.map((id, targetIndex) => `<text id="${id}" x="20" y="${40 + targetIndex * 30}">simulation-${suffix}-${targetIndex}</text>`).join("")}</svg></body></html>`, "utf8");
    const relativePath = `simulation-${suffix}.html`;
    writeFileSync(join(artifactRoot, relativePath), bytes);
    const document = structuredClone(source);
    document.documentId = `doc_contract_simulation_${suffix}`;
    document.artifact = { sha256: digest(bytes), storage: "public-repository", relativePath, mediaType: "text/html" };
    document.realDocument = true;
    document.split = index < 10 ? "development" : index < 20 ? "tuning" : "holdout";
    document.originGroupId = `origin_contract_simulation_${suffix}`;
    document.duplicateGroupId = null;
    document.derivationGroupId = null;
    document.parentTemplateGroupId = null;
    document.provenance = { provenanceClass: "public_redistributable", sourceLocator: `source_simulated_${suffix}`, sourceEvidence: `Simulated external provenance evidence ${suffix}; test-only and not corpus evidence.` };
    document.license = { status: "first_party", evidence: `Simulated first-party rights review ${suffix}; test-only.` };
    document.privacy = { status: "reviewed_no_personal_data", reviewEvidence: `Simulated external privacy review ${suffix}; test-only.` };
    document.targets = ruleSpecs.map(([ruleId, short, guidelineVersion], targetIndex) => {
      const partial: Target = {
        targetId: "target_pending_simulation",
        svgRootKey: `author-id:${rootId}`,
        sourceIdentity: `author-id:${authoredIds[targetIndex]}`,
        ruleId,
        oracle: { oracleVersion: "m3-0-oracle-v1" as const, evidenceKinds: ["blind-human-annotation" as const, "independent-adjudication" as const], groundTruth: "negative" },
        annotations: [],
        ambiguityStatus: "unambiguous" as const,
        adjudication: null,
      };
      partial.targetId = canonicalTargetId(document, partial);
      partial.annotations = ["a", "b"].map((annotator) => ({
        annotationId: `ann_sim_${suffix}_${short}_${annotator}`,
        annotatorId: `annotator_sim_${annotator}_001`,
        targetId: partial.targetId,
        ruleId,
        guidelineVersion,
        createdAt: "2026-08-22T20:02:00Z",
        blinded: true as const,
        breaklintResultExposed: false as const,
        label: "negative" as const,
        rationale: "Independent simulated blind annotation for contract-path testing only.",
      }));
      return partial;
    });
    return document;
  });
  const renderer = structuredClone(source.rendererFreeze);
  renderer.resourceHashes = manifest.documents.map((document) => document.artifact.sha256).sort();
  renderer.rendererFreezeId = contentDerivedRendererId(renderer);
  for (const document of manifest.documents) document.rendererFreeze = structuredClone(renderer);

  const candidateConfig = candidateFor(ruleId);
  const candidateConfigHash = digest(canonicalJson(candidateConfig));
  const thresholdCandidateHash = ruleId === "svg/text-overflows-viewport" ? null : "d".repeat(64);
  const gates = [
    { metric: "precision", operator: ">=", threshold: 0.8 },
    { metric: "recall", operator: ">=", threshold: 0.8 },
    { metric: "specificity", operator: ">=", threshold: 0.8 },
    { metric: "false-positive-rate", operator: "<=", threshold: 0.2 },
  ] as AcceptancePlan["gates"];
  const plan = external<AcceptancePlan>({
    contractVersion: "m3-0-acceptance-plan-v1",
    planId: "plan_contract_simulation_001",
    planVersion: 1,
    samplingPlanId: "sampling_contract_simulation_001",
    samplingPlanVersion: 1,
    acceptanceGateVersion: "acceptance-gate-v1",
    createdAt: "2026-08-22T20:00:00Z",
    ruleId,
    candidateSelectionId: "selection_contract_simulation_001",
    candidateConfigHash,
    thresholdCandidateHash,
    gates,
  });
  const planSha256 = digest(plan.bytes);
  const holdoutLineageId = `lineage_${lineageSuffix}`;
  const holdoutId = `holdout_${lineageSuffix}`;
  const receipt = external<PreregistrationReceipt>({
    contractVersion: "m3-0-preregistration-receipt-v1",
    receiptId: `receipt_${lineageSuffix}`,
    issuedAt: "2026-08-22T20:02:00Z",
    planSha256,
    holdoutLineageId,
    holdoutId,
  });
  const receiptSha256 = digest(receipt.bytes);
  manifest.preregistrationAnchors = [{ receiptId: receipt.value.receiptId, receiptSha256, planSha256, holdoutLineageId, holdoutId, recordedAt: "2026-08-22T20:03:00Z", firstHoldoutAccessAt: "2026-08-22T20:09:00Z" }];
  manifest.candidateSelections = [{
    selectionId: "selection_contract_simulation_001",
    ruleId,
    createdAt: "2026-08-22T20:05:00Z",
    holdoutLineageId,
    holdoutId,
    preregistrationReceiptSha256: receiptSha256,
    preregisteredPlanId: "plan_contract_simulation_001",
    planSha256,
    candidateConfigHash,
    thresholdCandidateHash,
    inputSplits: ["development", "tuning"],
    inputDocumentIds: manifest.documents.filter((document) => document.split !== "holdout").map((document) => document.documentId),
    evidenceHashes: ["e".repeat(64)],
    holdoutOutcomeUsed: false,
  }];
  for (const [index, document] of manifest.documents.filter((entry) => entry.split === "holdout").entries()) {
    const target = document.targets.find((entry) => entry.ruleId === ruleId)!;
    const truth = ORACLE_TRUTH_SEED[index]!;
    target.oracle.groundTruth = truth;
    for (const annotation of target.annotations) annotation.label = truth;
  }
  manifest.holdoutFreeze = {
    holdoutId,
    holdoutLineageId,
    preregistrationReceiptSha256: receiptSha256,
    version: 1,
    frozenAt: "2026-08-22T20:10:00Z",
    reason: "Test-only immutable baseline for the complete contract-path simulation.",
    approverId: "approver_simulation_001",
    ...holdoutProjection(manifest),
  };
  const previousManifest = structuredClone(manifest);
  const rendererFreezeId = renderer.rendererFreezeId;
  const rendererHash = rendererContentHash(renderer);
  const sourceIdentity = renderer.sourceIdentity;
  const measurementReceiptId = `measurement_${lineageSuffix}`;
  const measurementRows: MeasurementReceipt["rows"] = manifest.documents.filter((document) => document.split === "holdout").map((document, index) => {
    const target = document.targets.find((entry) => entry.ruleId === ruleId)!;
    return { documentId: document.documentId, artifactSha256: document.artifact.sha256, targetId: target.targetId, ruleId, candidateConfigHash, rendererFreezeId, rendererContentHash: rendererHash, measuredAt: "2026-08-22T20:12:00Z", snapshot: snapshotFor(ruleId, target, MEASUREMENT_SCENARIO_SEED[index]!, index) };
  });
  const producerSourceHash = producerSourceIdentitySha256(sourceIdentity);
  const captureEvidenceRows: CaptureEvidenceBundle["rows"] = measurementRows.map((row) => ({
    documentId: row.documentId,
    artifactSha256: row.artifactSha256,
    targetId: row.targetId,
    ruleId: row.ruleId,
    rendererFreezeId: row.rendererFreezeId,
    rendererContentHash: row.rendererContentHash,
    measuredAt: row.measuredAt,
    rawMeasurementSha256: digest(canonicalJson(row.snapshot)),
  }));
  const captureEvidenceBundle = evidentiaryStatus === "externally-attested-real-render" ? external<CaptureEvidenceBundle>({
    contractVersion: "m3-0-capture-evidence-bundle-v1",
    bundleId: `capture_bundle_${lineageSuffix}`,
    capturedAt: "2026-08-22T20:12:15Z",
    measurementReceiptId,
    ruleId,
    candidateConfigHash,
    rendererFreezeId,
    rendererContentHash: rendererHash,
    producerSourceIdentitySha256: producerSourceHash,
    productRuleSourceSha256: PRODUCT_RULE_EXECUTABLE_CONTRACTS[ruleId].sourceSha256,
    rowsSha256: digest(canonicalJson(measurementRows)),
    artifactTargetSetSha256: digest(canonicalJson(measurementRows.map((row) => ({ documentId: row.documentId, artifactSha256: row.artifactSha256, targetId: row.targetId, ruleId: row.ruleId })).sort((left, right) => `${left.documentId}\0${left.targetId}`.localeCompare(`${right.documentId}\0${right.targetId}`, "en")))),
    rawMeasurementsSha256: digest(canonicalJson(captureEvidenceRows.map((row) => ({ documentId: row.documentId, targetId: row.targetId, rawMeasurementSha256: row.rawMeasurementSha256 })))),
    rows: captureEvidenceRows,
  }) : null;
  const captureAttestation = evidentiaryStatus === "externally-attested-real-render" ? external<CaptureAttestation>({
    contractVersion: "m3-0-capture-attestation-v1",
    attestationId: `capture_attestation_${lineageSuffix}`,
    attestorId: `capture_attestor_${lineageSuffix}`,
    issuedAt: "2026-08-22T20:12:30Z",
    measurementReceiptId,
    ruleId,
    candidateConfigHash,
    rendererFreezeId,
    rendererContentHash: rendererHash,
    producerSourceIdentitySha256: producerSourceHash,
    rowsSha256: digest(canonicalJson(measurementRows)),
    artifactTargetSetSha256: digest(canonicalJson(measurementRows.map((row) => ({ documentId: row.documentId, artifactSha256: row.artifactSha256, targetId: row.targetId, ruleId: row.ruleId })).sort((left, right) => `${left.documentId}\0${left.targetId}`.localeCompare(`${right.documentId}\0${right.targetId}`, "en")))),
    captureEvidenceSha256: digest(captureEvidenceBundle!.bytes),
  }) : null;
  const measurementReceipt = external<MeasurementReceipt>({
    contractVersion: "m3-0-measurement-receipt-v1",
    receiptId: measurementReceiptId,
    createdAt: "2026-08-22T20:13:00Z",
    evidentiaryStatus,
    captureAttestationSha256: captureAttestation ? digest(captureAttestation.bytes) : null,
    producer: { contractId: "breaklint-svg-measurement-producer", contractVersion: "m3-0-measurement-producer-v1", sourceIdentity, sourceIdentitySha256: producerSourceHash },
    ruleContract: { ruleId, ...PRODUCT_RULE_EXECUTABLE_CONTRACTS[ruleId] },
    ruleId,
    candidateConfig,
    candidateConfigHash,
    rendererFreezeId,
    rendererContentHash: rendererHash,
    rows: measurementRows,
  });
  const measurementReceiptSha256 = digest(measurementReceipt.bytes);
  const productionEvaluation = external<ProductionEvaluation>({
    contractVersion: "m3-0-production-evaluation-v1", evaluationId: "production_contract_simulation_001", createdAt: "2026-08-22T20:14:00Z", ruleId,
    ruleExecutableContractVersion: PRODUCT_RULE_EXECUTABLE_CONTRACTS[ruleId].executableContractVersion,
    productRuleSourceSha256: PRODUCT_RULE_EXECUTABLE_CONTRACTS[ruleId].sourceSha256,
    measurementReceiptSha256,
    candidateConfig, candidateConfigHash,
    rows: measurementReceipt.value.rows.map((measurementRow) => {
      const executed = executeProductRuleV1(ruleId, candidateConfig, measurementRow.snapshot);
      return { documentId: measurementRow.documentId, artifactSha256: measurementRow.artifactSha256, targetId: measurementRow.targetId, ruleId, candidateConfigHash, rendererFreezeId, rendererContentHash: rendererHash, measurementReceiptRowSha256: digest(canonicalJson(measurementRow)), ruleResult: executed.result, productionDecision: executed.decision };
    }),
  });
  const productionEvaluationSha256 = digest(productionEvaluation.bytes);
  const outcome = external<OutcomeArtifact>({
    contractVersion: "m3-0-outcome-v1",
    outcomeId: "outcome_contract_simulation_001",
    createdAt: "2026-08-22T20:15:00Z",
    ruleId,
    holdoutLineageId,
    holdoutId,
    holdoutVersion: manifest.holdoutFreeze.version,
    holdoutManifestHash: manifest.holdoutFreeze.manifestHash,
    candidateConfigHash,
    rendererFreezeId,
    rendererContentHash: rendererHash,
    planSha256,
    preregistrationReceiptSha256: receiptSha256,
    productionEvaluationSha256,
    rows: manifest.documents.filter((document) => document.split === "holdout").map((document) => {
      const target = document.targets.find((entry) => entry.ruleId === ruleId)!;
      const productionRow = productionEvaluation.value.rows.find((row) => row.documentId === document.documentId && row.targetId === target.targetId)!;
      const declined = productionRow.productionDecision === "declined";
      return {
        documentId: document.documentId,
        artifactSha256: document.artifact.sha256,
        targetId: target.targetId,
        ruleId: target.ruleId,
        oracleSnapshotSha256: oracleSnapshotSha256(target),
        annotationSnapshotSha256: annotationSnapshotSha256(target),
        adjudicationSnapshotSha256: adjudicationSnapshotSha256(target),
        evaluationDisposition: declined ? "excluded" as const : "included" as const,
        groundTruth: declined ? null : target.oracle.groundTruth as "positive" | "negative",
        excludedReason: declined ? "production-declined" as const : null,
        candidateConfigHash,
        rendererFreezeId,
        rendererContentHash: rendererHash,
        planSha256,
        preregistrationReceiptSha256: receiptSha256,
        productionEvaluationRowSha256: digest(canonicalJson(productionRow)),
        holdoutLineageId,
        holdoutId,
        holdoutVersion: manifest.holdoutFreeze!.version,
        productionDecision: productionRow.productionDecision,
      };
    }),
  });
  const outcomeSha256 = digest(outcome.bytes);
  const acceptanceReport = external<AcceptanceReport>({
    contractVersion: "m3-0-acceptance-report-v1",
    reportId: "acceptance_contract_simulation_001",
    createdAt: "2026-08-22T20:20:00Z",
    ruleId,
    holdoutLineageId,
    holdoutId: manifest.holdoutFreeze.holdoutId,
    holdoutVersion: manifest.holdoutFreeze.version,
    holdoutManifestHash: manifest.holdoutFreeze.manifestHash,
    candidateConfigHash,
    rendererFreezeId,
    rendererContentHash: rendererHash,
    acceptanceGateVersion: "acceptance-gate-v1",
    preregisteredPlanId: "plan_contract_simulation_001",
    planSha256,
    preregistrationReceiptSha256: receiptSha256,
    outcomeSha256,
    eligibleHoldoutDocuments: 9,
    eligibleHoldoutOriginGroups: 9,
    ambiguityExcluded: true,
    evaluatedTargetCount: 10,
    includedBinaryTargetCount: 9,
    excludedTargetCount: 1,
    confusionCounts: { truePositive: 4, trueNegative: 4, falsePositive: 1, falseNegative: 0, excludedAmbiguous: 1 },
    gates,
  });
  const reportSha256 = digest(acceptanceReport.bytes);
  const candidateSelection = external(manifest.candidateSelections[0]!);
  const lineageSnapshot = external<LineageSnapshot>({
    contractVersion: "m3-0-lineage-snapshot-v1",
    snapshotId: `lineage_snapshot_${lineageSuffix}`,
    createdAt: "2026-08-22T20:20:30Z",
    eventId: `eval_${lineageSuffix}`,
    holdoutLineageId,
    holdoutId,
    holdoutVersion: manifest.holdoutFreeze.version,
    freeze: structuredClone(manifest.holdoutFreeze),
    documentSplits: manifest.documents.map((document) => ({ documentId: document.documentId, split: document.split })).sort((left, right) => left.documentId.localeCompare(right.documentId, "en")),
    knownOutcomeSha256s: [outcomeSha256],
    targetTuples: lineageTargetTuples(manifest),
    artifacts: { preregistrationReceipt: encoded(receipt), acceptancePlan: encoded(plan), candidateSelection: encoded(candidateSelection), captureEvidenceBundle: captureEvidenceBundle ? encoded(captureEvidenceBundle) : null, captureAttestation: captureAttestation ? encoded(captureAttestation) : null, measurementReceipt: encoded(measurementReceipt), productionEvaluation: encoded(productionEvaluation), outcome: encoded(outcome), acceptanceReport: encoded(acceptanceReport) },
  });
  const lineageSnapshotSha256 = digest(lineageSnapshot.bytes);
  manifest.evaluationLedger = [{ eventId: `eval_${lineageSuffix}`, createdAt: "2026-08-22T20:21:00Z", purpose: "final-holdout-evaluation", holdoutLineageId, holdoutId, holdoutVersion: manifest.holdoutFreeze.version, holdoutManifestHash: manifest.holdoutFreeze.manifestHash, rendererFreezeIds: manifest.holdoutFreeze.rendererFreezeIds, preregistrationReceiptSha256: receiptSha256, candidateConfigHash, planSha256, productionEvaluationSha256, outcomeSha256, acceptanceReportSha256: reportSha256, lineageSnapshotSha256, appendOnlySequence: 1 }];
  for (const claim of manifest.readinessClaims) {
    claim.eligibleRealDocuments = 30;
    claim.eligibleOriginGroups = 30;
    if (claim.ruleId !== ruleId) continue;
    claim.acceptedSamplingPlan = true;
    claim.candidateConfigHash = candidateConfigHash;
    claim.thresholdCandidateHash = thresholdCandidateHash;
    claim.rendererFreezeId = rendererFreezeId;
    claim.rendererContentHash = rendererHash;
    claim.acceptanceGateVersion = "acceptance-gate-v1";
    claim.acceptancePlanSha256 = planSha256;
    claim.preregistrationReceiptSha256 = receiptSha256;
    claim.holdoutLineageId = holdoutLineageId;
    claim.outcomeSha256 = outcomeSha256;
    claim.acceptanceReportSha256 = reportSha256;
    claim.ruleReadyForCalibration = true;
    claim.ruleReadyForCalibratedClaim = false;
    claim.calibratedClaim = false;
  }
  const trustLedger = external<TrustLedger>({
    contractVersion: "m3-0-trust-ledger-v1",
    ledgerId: "trust_contract_simulation_001",
    createdAt: "2026-08-22T20:03:00Z",
    attestations: manifest.documents.map((document, index) => ({
      attestationId: `attest_contract_sim_${index.toString().padStart(3, "0")}`,
      reviewerId: "reviewer_contract_simulation_001",
      reviewedAt: "2026-08-22T20:03:00Z",
      documentId: document.documentId,
      artifactSha256: document.artifact.sha256,
      originGroupId: document.originGroupId,
      provenanceEvidenceSha256: digest(document.provenance.sourceEvidence),
      licenseEvidenceSha256: digest(document.license.evidence),
      privacyEvidenceSha256: digest(document.privacy.reviewEvidence),
      approvedForCalibration: true,
    })),
  });
  return { manifest, previousManifest, trustLedger, acceptancePlan: plan, preregistrationReceipt: receipt, captureEvidenceBundle, captureAttestation, measurementReceipt, productionEvaluation, outcome, acceptanceReport, lineageSnapshot };
}

function rebindSimulationArtifacts(simulation: ReturnType<typeof buildClaimGradeContractSimulation>): void {
  simulation.productionEvaluation = external(simulation.productionEvaluation.value);
  const productionSha256 = digest(simulation.productionEvaluation.bytes);
  simulation.outcome.value.productionEvaluationSha256 = productionSha256;
  simulation.outcome = external(simulation.outcome.value);
  const outcomeSha256 = digest(simulation.outcome.bytes);
  simulation.acceptanceReport.value.outcomeSha256 = outcomeSha256;
  simulation.acceptanceReport = external(simulation.acceptanceReport.value);
  const acceptanceSha256 = digest(simulation.acceptanceReport.bytes);
  const event = simulation.manifest.evaluationLedger.at(-1)!;
  event.productionEvaluationSha256 = productionSha256;
  event.outcomeSha256 = outcomeSha256;
  event.acceptanceReportSha256 = acceptanceSha256;
  const claim = simulation.manifest.readinessClaims.find((entry) => entry.ruleId === simulation.productionEvaluation.value.ruleId)!;
  claim.outcomeSha256 = outcomeSha256;
  claim.acceptanceReportSha256 = acceptanceSha256;
  simulation.lineageSnapshot.value.artifacts.captureEvidenceBundle = simulation.captureEvidenceBundle ? encoded(simulation.captureEvidenceBundle) : null;
  simulation.lineageSnapshot.value.artifacts.captureAttestation = simulation.captureAttestation ? encoded(simulation.captureAttestation) : null;
  simulation.lineageSnapshot.value.artifacts.measurementReceipt = encoded(simulation.measurementReceipt);
  simulation.lineageSnapshot.value.artifacts.productionEvaluation = encoded(simulation.productionEvaluation);
  simulation.lineageSnapshot.value.artifacts.outcome = encoded(simulation.outcome);
  simulation.lineageSnapshot.value.artifacts.acceptanceReport = encoded(simulation.acceptanceReport);
  simulation.lineageSnapshot.value.knownOutcomeSha256s = [outcomeSha256];
  simulation.lineageSnapshot = external(simulation.lineageSnapshot.value);
  event.lineageSnapshotSha256 = digest(simulation.lineageSnapshot.bytes);
}

function rebindCaptureArtifacts(simulation: ReturnType<typeof buildClaimGradeContractSimulation>): void {
  if (!simulation.captureEvidenceBundle || !simulation.captureAttestation) throw new Error("external capture artifacts required");
  simulation.captureEvidenceBundle = external(simulation.captureEvidenceBundle.value);
  simulation.captureAttestation.value.captureEvidenceSha256 = digest(simulation.captureEvidenceBundle.bytes);
  simulation.captureAttestation = external(simulation.captureAttestation.value);
  simulation.measurementReceipt.value.captureAttestationSha256 = digest(simulation.captureAttestation.bytes);
  simulation.measurementReceipt = external(simulation.measurementReceipt.value);
  simulation.productionEvaluation.value.measurementReceiptSha256 = digest(simulation.measurementReceipt.bytes);
  simulation.productionEvaluation.value.rows.forEach((row, index) => { row.measurementReceiptRowSha256 = digest(canonicalJson(simulation.measurementReceipt.value.rows[index]!)); });
  rebindSimulationArtifacts(simulation);
}

function simulationValidationOptions(simulation: ReturnType<typeof buildClaimGradeContractSimulation>, artifactRoot: string): ValidationOptions {
  return {
    artifactRoot,
    previousManifest: simulation.previousManifest,
    trustLedger: simulation.trustLedger,
    acceptancePlans: [simulation.acceptancePlan],
    preregistrationReceipts: [simulation.preregistrationReceipt],
    captureEvidenceBundles: simulation.captureEvidenceBundle ? [simulation.captureEvidenceBundle] : [],
    captureAttestations: simulation.captureAttestation ? [simulation.captureAttestation] : [],
    measurementReceipts: [simulation.measurementReceipt],
    productionEvaluations: [simulation.productionEvaluation],
    outcomes: [simulation.outcome],
    acceptanceReports: [simulation.acceptanceReport],
    lineageSnapshots: [simulation.lineageSnapshot],
  };
}

describe("M3-0 calibration foundation", () => {
  it("executes the real registry rules at all governed boundaries and decline states", () => {
    const target = loadCleanManifest().documents[0]!.targets[0]!;
    const clipped = snapshotFor("svg/text-clipped", target, "clean", 0);
    clipped.svg.texts[0]!.ink.T0.count = 100; clipped.svg.texts[0]!.ink.T.count = 95;
    assert.equal(executeProductRuleV1("svg/text-clipped", candidateFor("svg/text-clipped"), clipped).decision, "clean");
    clipped.svg.texts[0]!.ink.T.count = 94;
    assert.equal(executeProductRuleV1("svg/text-clipped", candidateFor("svg/text-clipped"), clipped).decision, "finding");
    clipped.svg.texts[0]!.ink.T0.count = 0; clipped.svg.texts[0]!.ink.T.count = 0;
    assert.equal(executeProductRuleV1("svg/text-clipped", candidateFor("svg/text-clipped"), clipped).decision, "clean", "T0 <= 0 follows the unchanged production RuleResult");
    clipped.svg.inkStable = false;
    assert.equal(executeProductRuleV1("svg/text-clipped", candidateFor("svg/text-clipped"), clipped).decision, "declined");
    const collision = snapshotFor("svg/text-ink-collision", target, "clean", 0);
    collision.svg.texts[0]!.ink.T.intersectShapes = 7;
    assert.equal(executeProductRuleV1("svg/text-ink-collision", candidateFor("svg/text-ink-collision"), collision).decision, "clean");
    collision.svg.texts[0]!.ink.T.intersectShapes = 8;
    assert.equal(executeProductRuleV1("svg/text-ink-collision", candidateFor("svg/text-ink-collision"), collision).decision, "finding");
    collision.svg.textTargetsCapped = true;
    assert.equal(executeProductRuleV1("svg/text-ink-collision", candidateFor("svg/text-ink-collision"), collision).decision, "declined");
    const viewport = snapshotFor("svg/text-overflows-viewport", target, "finding", 0);
    assert.equal(executeProductRuleV1("svg/text-overflows-viewport", candidateFor("svg/text-overflows-viewport"), viewport).decision, "finding");
    viewport.svg.overflow = "visible";
    assert.equal(executeProductRuleV1("svg/text-overflows-viewport", candidateFor("svg/text-overflows-viewport"), viewport).decision, "declined");
    viewport.svg.measurable = false; viewport.svg.reason = "env/svg-not-inline";
    assert.equal(executeProductRuleV1("svg/text-overflows-viewport", candidateFor("svg/text-overflows-viewport"), viewport).decision, "declined");
  });
  it("accepts the public synthetic contract without claiming readiness", () => {
    const report = validateManifest(loadCleanManifest(), { manifestBytes: MANIFEST_BYTES, artifactRoot: ARTIFACT_ROOT });
    assert.equal(report.status, "valid");
    assert.equal(report.exitCode, 0);
    assert.equal(report.checks.schema_valid, true);
    assert.equal(report.checks.provenance_valid, true);
    assert.equal(report.checks.privacy_valid, true);
    assert.equal(report.checks.annotation_valid, true);
    assert.equal(report.checks.split_valid, true);
    assert.equal(report.checks.oracle_independent, true);
    assert.equal(report.checks.renderer_identity_complete, true);
    assert.equal(report.checks.holdout_frozen, false, "the example honestly has no holdout");
    for (const rule of Object.values(report.rules)) {
      assert.equal(rule.eligible_real_documents, 0);
      assert.equal(rule.eligible_origin_groups, 0);
      assert.equal(rule.rule_ready_for_calibration, false);
      assert.equal(rule.rule_ready_for_calibrated_claim, false);
    }
  });

  it("is byte-for-byte deterministic for the same manifest and artifact root", () => {
    const first = validateManifest(loadCleanManifest(), { manifestBytes: MANIFEST_BYTES, artifactRoot: ARTIFACT_ROOT });
    const second = validateManifest(loadCleanManifest(), { manifestBytes: MANIFEST_BYTES, artifactRoot: ARTIFACT_ROOT });
    assert.deepEqual(second, first);
  });

  it("changes dirty source identity when bytes change at the same path", () => {
    const repository = mkdtempSync(join(tmpdir(), "breaklint-m3-source-identity-"));
    try {
      writeFileSync(join(repository, "source.ts"), "export const value = 0;\n");
      execFileSync("git", ["init", "--quiet"], { cwd: repository });
      execFileSync("git", ["config", "user.email", "m3-source@invalid.example"], { cwd: repository });
      execFileSync("git", ["config", "user.name", "M3 Source Identity"], { cwd: repository });
      execFileSync("git", ["add", "source.ts"], { cwd: repository });
      execFileSync("git", ["commit", "--quiet", "-m", "source baseline"], { cwd: repository });
      writeFileSync(join(repository, "source.ts"), "export const value = 1;\n");
      const first = repositorySourceIdentity(repository);
      writeFileSync(join(repository, "source.ts"), "export const value = 2;\n");
      const second = repositorySourceIdentity(repository);
      assert.equal(first.mode, "dirty-source-bundle");
      assert.equal(second.mode, "dirty-source-bundle");
      if (first.mode !== "dirty-source-bundle" || second.mode !== "dirty-source-bundle") assert.fail("dirty source union was not selected");
      assert.notEqual(first.gitDiffSha256, second.gitDiffSha256);
      assert.notEqual(first.sourceTreeSha256, second.sourceTreeSha256);
      assert.notEqual(first.sourceBundleSha256, second.sourceBundleSha256);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("simulates the complete claim-grade contract path without constituting real-corpus evidence", () => {
    const artifactRoot = mkdtempSync(join(tmpdir(), "breaklint-m3-claim-contract-"));
    try {
      const build = (ruleId: SimulationRuleId = "svg/text-clipped") => buildClaimGradeContractSimulation(artifactRoot, ruleId);
      const validate = (simulation: ReturnType<typeof build>) => validateManifest(simulation.manifest, {
        artifactRoot,
        previousManifest: simulation.previousManifest,
        trustLedger: simulation.trustLedger,
        acceptancePlans: [simulation.acceptancePlan],
        preregistrationReceipts: [simulation.preregistrationReceipt],
        captureEvidenceBundles: simulation.captureEvidenceBundle ? [simulation.captureEvidenceBundle] : [],
        captureAttestations: simulation.captureAttestation ? [simulation.captureAttestation] : [],
        measurementReceipts: [simulation.measurementReceipt],
        productionEvaluations: [simulation.productionEvaluation],
        outcomes: [simulation.outcome],
        acceptanceReports: [simulation.acceptanceReport],
        lineageSnapshots: [simulation.lineageSnapshot],
      });
      for (const ruleId of Object.keys(RULE_SHORT) as SimulationRuleId[]) {
        const positive = build(ruleId);
        const positiveReport = validate(positive);
        assert.equal(positiveReport.status, "valid", `${ruleId}: ${JSON.stringify(positiveReport.issues)}`);
        assert.equal(positiveReport.rules[ruleId].rule_ready_for_calibration, true);
        assert.equal(positiveReport.rules[ruleId].rule_ready_for_calibrated_claim, false, "contract simulation is never claim evidence");
        assert.equal(positiveReport.rules[ruleId].eligible_real_evidentiary_holdout_documents, 0);
        assert.equal(positiveReport.rules[ruleId].eligible_real_evidentiary_holdout_origin_groups, 0);
        assert.equal(positive.manifest.readinessClaims.find((claim) => claim.ruleId === ruleId)!.calibratedClaim, false, "registry remains false in M3-0");
        assert.equal(positive.outcome.value.rows.length, 10);
        assert.equal(Object.values(positive.acceptanceReport.value.confusionCounts).reduce((sum, value) => sum + value, 0), 10, "ten frozen holdout targets produce exactly ten derived dispositions");
        assert.deepEqual(positive.outcome.value.rows.map((row) => row.groundTruth ?? row.excludedReason), [...ORACLE_TRUTH_SEED.slice(0, 9), "production-declined"]);
        assert.deepEqual(positive.productionEvaluation.value.rows.map((row) => row.productionDecision), MEASUREMENT_SCENARIO_SEED, "measurement decisions come from their separate deterministic seed and real Rule.run");
        assert.notDeepEqual(positive.productionEvaluation.value.rows.slice(0, 9).map((row) => row.productionDecision === "finding" ? "positive" : "negative"), ORACLE_TRUTH_SEED.slice(0, 9), "the production-measurement seed must not mirror the oracle labels");
        assert.equal(positive.acceptanceReport.value.confusionCounts.falsePositive, 1, "the independent simulation seed deliberately contains a false positive");

        const externallyAttested = buildClaimGradeContractSimulation(artifactRoot, ruleId, `external_reachability_${RULE_SHORT[ruleId]}`, "externally-attested-real-render");
        const externalReport = validate(externallyAttested);
        assert.equal(externalReport.status, "valid", `${ruleId} external reachability: ${JSON.stringify(externalReport.issues)}`);
        assert.equal(externalReport.rules[ruleId].capture_evidence_bytes_valid, true, "separately supplied capture bytes and bindings are mechanically valid");
        assert.equal(externalReport.rules[ruleId].capture_attestor_trust_valid, false, "M3-0 has no externally governed trust root");
        assert.equal(externalReport.rules[ruleId].rule_ready_for_calibrated_claim, false, "byte-valid self-issued capture is not independent claim evidence");
        assert.equal(externalReport.rules[ruleId].eligible_real_evidentiary_holdout_documents, 0);
        assert.equal(externalReport.rules[ruleId].eligible_real_evidentiary_holdout_origin_groups, 0);
        assert.equal(externalReport.checks.capture_evidence_bytes_valid, true);
        assert.equal(externalReport.checks.capture_attestor_trust_valid, false);
        assert.equal(externallyAttested.manifest.readinessClaims.find((claim) => claim.ruleId === ruleId)!.calibratedClaim, false);

        const declinedDecisionMutation = build(ruleId);
        const declinedRow = declinedDecisionMutation.productionEvaluation.value.rows.at(-1)!;
        assert.equal(declinedRow.productionDecision, "declined", `${ruleId} must exercise its real production decline`);
        declinedRow.productionDecision = "clean";
        declinedDecisionMutation.productionEvaluation = external(declinedDecisionMutation.productionEvaluation.value);
        assert.ok(validate(declinedDecisionMutation).issues.some((issue) => issue.code === "production-evaluation-row-binding"), `${ruleId} declined-decision manipulation must fail real Rule.run replay`);
      }

      const relabeledSimulation = build();
      relabeledSimulation.measurementReceipt.value.evidentiaryStatus = "externally-attested-real-render";
      relabeledSimulation.measurementReceipt = external(relabeledSimulation.measurementReceipt.value);
      const relabeledReport = validate(relabeledSimulation);
      assert.equal(relabeledReport.status, "invalid");
      assert.ok(relabeledReport.issues.some((issue) => issue.code === "measurement-receipt-schema" || issue.code === "capture-evidence-binding"), "status relabel without separately supplied capture evidence must fail closed");

      const mixedSimulation = build();
      const unrelatedExternal = buildClaimGradeContractSimulation(artifactRoot, "svg/text-clipped", "unrelated_external_capture", "externally-attested-real-render");
      const mixedReport = validateManifest(mixedSimulation.manifest, {
        artifactRoot,
        previousManifest: mixedSimulation.previousManifest,
        trustLedger: mixedSimulation.trustLedger,
        acceptancePlans: [mixedSimulation.acceptancePlan],
        preregistrationReceipts: [mixedSimulation.preregistrationReceipt],
        captureEvidenceBundles: unrelatedExternal.captureEvidenceBundle ? [unrelatedExternal.captureEvidenceBundle] : [],
        captureAttestations: unrelatedExternal.captureAttestation ? [unrelatedExternal.captureAttestation] : [],
        measurementReceipts: [mixedSimulation.measurementReceipt, unrelatedExternal.measurementReceipt],
        productionEvaluations: [mixedSimulation.productionEvaluation, unrelatedExternal.productionEvaluation],
        outcomes: [mixedSimulation.outcome],
        acceptanceReports: [mixedSimulation.acceptanceReport],
        lineageSnapshots: [mixedSimulation.lineageSnapshot],
      });
      assert.equal(mixedReport.status, "valid", JSON.stringify(mixedReport.issues));
      assert.equal(mixedReport.rules["svg/text-clipped"].rule_ready_for_calibrated_claim, false, "unrelated external capture evidence cannot upgrade a simulation-bound outcome");
      assert.equal(mixedReport.rules["svg/text-clipped"].eligible_real_evidentiary_holdout_documents, 0);

      const buildLineageRestart = () => {
        const historical = buildClaimGradeContractSimulation(artifactRoot, "svg/text-clipped", "historical_lineage_a");
        const current = buildClaimGradeContractSimulation(artifactRoot, "svg/text-clipped", "new_lineage_b");
        const previous = structuredClone(historical.manifest);
        previous.preregistrationAnchors.push(structuredClone(current.manifest.preregistrationAnchors[0]!));
        current.previousManifest = previous;
        current.manifest.preregistrationAnchors = structuredClone(previous.preregistrationAnchors);
        current.manifest.evaluationLedger = [structuredClone(previous.evaluationLedger[0]!), { ...current.manifest.evaluationLedger[0]!, appendOnlySequence: 2 }];
        current.lineageSnapshot.value.knownOutcomeSha256s = [digest(historical.outcome.bytes), digest(current.outcome.bytes)].sort();
        current.lineageSnapshot = external(current.lineageSnapshot.value);
        current.manifest.evaluationLedger[1]!.lineageSnapshotSha256 = digest(current.lineageSnapshot.bytes);
        return { historical, current };
      };
      const validateRestart = ({ historical, current }: ReturnType<typeof buildLineageRestart>) => validateManifest(current.manifest, {
        artifactRoot, previousManifest: current.previousManifest, trustLedger: current.trustLedger,
        acceptancePlans: [current.acceptancePlan], preregistrationReceipts: [current.preregistrationReceipt], captureEvidenceBundles: current.captureEvidenceBundle ? [current.captureEvidenceBundle] : [], captureAttestations: current.captureAttestation ? [current.captureAttestation] : [], measurementReceipts: [current.measurementReceipt], productionEvaluations: [current.productionEvaluation], outcomes: [current.outcome], acceptanceReports: [current.acceptanceReport],
        lineageSnapshots: [historical.lineageSnapshot, current.lineageSnapshot],
      });
      const lineageRestart = buildLineageRestart();
      assert.equal(validateRestart(lineageRestart).status, "valid", JSON.stringify(validateRestart(lineageRestart).issues));
      const arbitraryHistoricalHashes = buildLineageRestart();
      arbitraryHistoricalHashes.historical.manifest.evaluationLedger[0]!.planSha256 = "0".repeat(64);
      arbitraryHistoricalHashes.current.previousManifest.evaluationLedger[0]!.planSha256 = "0".repeat(64);
      arbitraryHistoricalHashes.current.manifest.evaluationLedger[0]!.planSha256 = "0".repeat(64);
      assert.ok(validateRestart(arbitraryHistoricalHashes).issues.some((entry) => entry.code === "lineage-event-binding"), "arbitrary historical hashes must fail against A's own external snapshot bytes");

      const mutateHistoricalCandidate = (restart: ReturnType<typeof buildLineageRestart>, mutate: (candidate: Manifest["candidateSelections"][number], snapshot: LineageSnapshot) => void) => {
        const candidate = structuredClone(restart.historical.manifest.candidateSelections[0]!);
        mutate(candidate, restart.historical.lineageSnapshot.value);
        restart.historical.lineageSnapshot.value.artifacts.candidateSelection = encoded(external(candidate));
        restart.historical.lineageSnapshot = external(restart.historical.lineageSnapshot.value);
        const snapshotHash = digest(restart.historical.lineageSnapshot.bytes);
        restart.current.previousManifest.evaluationLedger[0]!.lineageSnapshotSha256 = snapshotHash;
        restart.current.manifest.evaluationLedger[0]!.lineageSnapshotSha256 = snapshotHash;
      };
      const historicalCandidateControls: { name: string; code: string; mutate: (candidate: Manifest["candidateSelections"][number], snapshot: LineageSnapshot) => void }[] = [
        { name: "holdout split", code: "candidate-holdout-input", mutate: (candidate) => { candidate.inputSplits = ["development", "tuning", "holdout"]; } },
        { name: "holdout document with coordinated split relabel", code: "lineage-document-splits", mutate: (candidate, snapshot) => { const entry = snapshot.documentSplits.find((item) => item.split === "holdout")!; candidate.inputDocumentIds.push(entry.documentId); entry.split = "tuning"; } },
        { name: "known outcome", code: "candidate-holdout-outcome", mutate: (candidate, snapshot) => { candidate.holdoutOutcomeUsed = true; candidate.evidenceHashes.push(snapshot.knownOutcomeSha256s[0]!); } },
        { name: "future candidate", code: "acceptance-plan-time-order", mutate: (candidate) => { candidate.createdAt = "2099-01-01T00:00:00Z"; } },
      ];
      for (const control of historicalCandidateControls) {
        const restart = buildLineageRestart();
        mutateHistoricalCandidate(restart, control.mutate);
        const report = validateRestart(restart);
        assert.equal(report.status, "invalid", `${control.name} coordinated historical rehash unexpectedly passed`);
        assert.ok(report.issues.some((entry) => entry.code === control.code), `${control.name} lacked ${control.code}: ${JSON.stringify(report.issues)}`);
      }

      const trustMutation = build();
      trustMutation.trustLedger.value.attestations[0]!.artifactSha256 = "0".repeat(64);
      trustMutation.trustLedger = external(trustMutation.trustLedger.value);
      assert.ok(validate(trustMutation).issues.some((issue) => issue.code === "trust-attestation-mismatch"));

      const rawMeasurementMutation = build();
      const rawReceiptRow = rawMeasurementMutation.measurementReceipt.value.rows[0]!;
      rawReceiptRow.snapshot.svg.texts[0]!.ink.T.count = rawReceiptRow.snapshot.svg.texts[0]!.ink.T0.count;
      rawMeasurementMutation.measurementReceipt = external(rawMeasurementMutation.measurementReceipt.value);
      rawMeasurementMutation.productionEvaluation.value.measurementReceiptSha256 = digest(rawMeasurementMutation.measurementReceipt.bytes);
      rawMeasurementMutation.productionEvaluation.value.rows[0]!.measurementReceiptRowSha256 = digest(canonicalJson(rawReceiptRow));
      rawMeasurementMutation.productionEvaluation = external(rawMeasurementMutation.productionEvaluation.value);
      assert.ok(validate(rawMeasurementMutation).issues.some((issue) => issue.code === "production-evaluation-row-binding"));

      const productionDecisionMutation = build();
      productionDecisionMutation.productionEvaluation.value.rows[0]!.productionDecision = "clean";
      productionDecisionMutation.productionEvaluation = external(productionDecisionMutation.productionEvaluation.value);
      assert.ok(validate(productionDecisionMutation).issues.some((issue) => issue.code === "production-evaluation-row-binding"));

      const ruleIdentityMutation = build();
      ruleIdentityMutation.measurementReceipt.value.ruleContract.sourceSha256 = "0".repeat(64);
      ruleIdentityMutation.measurementReceipt = external(ruleIdentityMutation.measurementReceipt.value);
      assert.ok(validate(ruleIdentityMutation).issues.some((issue) => issue.code === "measurement-receipt-contract-binding"), "rule source identity must be independently pinned");

      const candidateConfigMutation = build();
      if (candidateConfigMutation.measurementReceipt.value.candidateConfig.ruleId !== "svg/text-clipped") assert.fail("default simulation must exercise clipped candidate mutation");
      candidateConfigMutation.measurementReceipt.value.candidateConfig.maxMissingInk = 0.6;
      candidateConfigMutation.measurementReceipt = external(candidateConfigMutation.measurementReceipt.value);
      assert.ok(validate(candidateConfigMutation).issues.some((issue) => issue.code === "measurement-receipt-contract-binding"), "candidate options cannot drift away from their bound hash");

      const groundTruthPredictionCoupling = build();
      const falsePositiveRow = groundTruthPredictionCoupling.outcome.value.rows[4]!;
      assert.equal(falsePositiveRow.productionDecision, "finding");
      assert.equal(falsePositiveRow.groundTruth, "negative");
      falsePositiveRow.groundTruth = "positive";
      groundTruthPredictionCoupling.outcome = external(groundTruthPredictionCoupling.outcome.value);
      assert.ok(validate(groundTruthPredictionCoupling).issues.some((issue) => issue.code === "outcome-row-disposition" || issue.code === "lineage-outcome-disposition"), "prediction-derived ground truth must fail against the frozen oracle tuple");

      const futureProduction = build();
      futureProduction.productionEvaluation.value.createdAt = "2099-01-01T00:00:00Z";
      rebindSimulationArtifacts(futureProduction);
      const futureReport = validate(futureProduction);
      assert.ok(futureReport.issues.some((issue) => issue.code === "production-outcome-time-order" || issue.code === "lineage-time-order"), "freeze <= production <= outcome chronology must fail closed");

      const futureLineageSnapshot = build();
      futureLineageSnapshot.lineageSnapshot.value.createdAt = "2099-01-01T00:00:00Z";
      futureLineageSnapshot.lineageSnapshot = external(futureLineageSnapshot.lineageSnapshot.value);
      futureLineageSnapshot.manifest.evaluationLedger[0]!.lineageSnapshotSha256 = digest(futureLineageSnapshot.lineageSnapshot.bytes);
      assert.ok(validate(futureLineageSnapshot).issues.some((issue) => issue.code === "lineage-time-order"), "acceptance <= external lineage snapshot <= event chronology must fail closed");

      const productionRowHashMutation = build();
      productionRowHashMutation.outcome.value.rows[0]!.productionEvaluationRowSha256 = "0".repeat(64);
      productionRowHashMutation.outcome = external(productionRowHashMutation.outcome.value);
      assert.ok(validate(productionRowHashMutation).issues.some((issue) => issue.code === "outcome-row-binding"));

      const developmentRendererMutation = build();
      const devRenderer = structuredClone(developmentRendererMutation.manifest.documents[0]!.rendererFreeze);
      devRenderer.browserVersion = "999.0.0.0"; devRenderer.rendererFreezeId = contentDerivedRendererId(devRenderer);
      developmentRendererMutation.manifest.documents[0]!.rendererFreeze = devRenderer;
      developmentRendererMutation.manifest.readinessClaims[0]!.rendererFreezeId = devRenderer.rendererFreezeId;
      developmentRendererMutation.outcome.value.rendererFreezeId = devRenderer.rendererFreezeId;
      for (const row of developmentRendererMutation.outcome.value.rows) row.rendererFreezeId = devRenderer.rendererFreezeId;
      developmentRendererMutation.outcome = external(developmentRendererMutation.outcome.value);
      assert.ok(validate(developmentRendererMutation).issues.some((issue) => issue.code === "outcome-row-binding" || issue.code === "acceptance-report-binding"));

      const planMutation = build();
      planMutation.acceptancePlan.value.gates = planMutation.acceptancePlan.value.gates.map((gate) => ({ ...gate, threshold: gate.operator === ">=" ? 0 : 1 }));
      planMutation.acceptancePlan = external(planMutation.acceptancePlan.value);
      const changedPlanHash = digest(planMutation.acceptancePlan.bytes);
      planMutation.preregistrationReceipt.value.planSha256 = changedPlanHash;
      planMutation.preregistrationReceipt = external(planMutation.preregistrationReceipt.value);
      const changedReceiptHash = digest(planMutation.preregistrationReceipt.bytes);
      planMutation.manifest.candidateSelections[0]!.planSha256 = changedPlanHash;
      planMutation.manifest.candidateSelections[0]!.preregistrationReceiptSha256 = changedReceiptHash;
      planMutation.manifest.preregistrationAnchors[0]!.planSha256 = changedPlanHash;
      planMutation.manifest.preregistrationAnchors[0]!.receiptSha256 = changedReceiptHash;
      planMutation.manifest.holdoutFreeze!.version = 2;
      planMutation.manifest.holdoutFreeze!.preregistrationReceiptSha256 = changedReceiptHash;
      Object.assign(planMutation.manifest.holdoutFreeze!, holdoutProjection(planMutation.manifest));
      assert.ok(validate(planMutation).issues.some((issue) => issue.code === "preregistration-external-baseline-missing" || issue.code === "holdout-lineage-plan-locked"), "post-hoc easy gates remain invalid despite holdout version 2 on the same lineage");

      const holdoutMutation = build();
      const changedDocument = holdoutMutation.manifest.documents.at(-1)!;
      changedDocument.originGroupId = "origin_contract_simulation_changed";
      holdoutMutation.trustLedger.value.attestations.at(-1)!.originGroupId = changedDocument.originGroupId;
      holdoutMutation.trustLedger = external(holdoutMutation.trustLedger.value);
      Object.assign(holdoutMutation.manifest.holdoutFreeze!, holdoutProjection(holdoutMutation.manifest));
      assert.ok(validate(holdoutMutation).issues.some((issue) => issue.code === "holdout-version-mutated"));

      const acceptanceMutation = build();
      acceptanceMutation.acceptanceReport.value.confusionCounts = { truePositive: 1, trueNegative: 1, falsePositive: 9, falseNegative: 9, excludedAmbiguous: 0 };
      acceptanceMutation.acceptanceReport = external(acceptanceMutation.acceptanceReport.value);
      assert.ok(validate(acceptanceMutation).issues.some((issue) => issue.code === "acceptance-outcome-binding"));

      const aggregateOnly = build();
      const aggregateReport = validateManifest(aggregateOnly.manifest, { artifactRoot, previousManifest: aggregateOnly.previousManifest, trustLedger: aggregateOnly.trustLedger, acceptancePlans: [aggregateOnly.acceptancePlan], preregistrationReceipts: [aggregateOnly.preregistrationReceipt], outcomes: [], acceptanceReports: [aggregateOnly.acceptanceReport] });
      assert.ok(aggregateReport.issues.some((issue) => issue.code === "acceptance-outcome-missing"));

      const rowSeams: [string, (row: OutcomeArtifact["rows"][number]) => void][] = [
        ["artifact", (row) => { row.artifactSha256 = "0".repeat(64); }],
        ["target", (row) => { row.targetId = "target_mutated_contract_001"; }],
        ["oracle", (row) => { row.oracleSnapshotSha256 = "0".repeat(64); }],
        ["annotation", (row) => { row.annotationSnapshotSha256 = "0".repeat(64); }],
        ["adjudication", (row) => { row.adjudicationSnapshotSha256 = "0".repeat(64); }],
        ["candidate", (row) => { row.candidateConfigHash = "0".repeat(64); }],
        ["renderer", (row) => { row.rendererContentHash = "0".repeat(64); }],
        ["plan", (row) => { row.planSha256 = "0".repeat(64); }],
        ["receipt", (row) => { row.preregistrationReceiptSha256 = "0".repeat(64); }],
        ["lineage", (row) => { row.holdoutLineageId = "lineage_mutated_contract_001"; }],
        ["holdout", (row) => { row.holdoutVersion += 1; }],
        ["decision", (row) => { row.productionDecision = row.productionDecision === "finding" ? "clean" : "finding"; }],
      ];
      for (const [name, mutate] of rowSeams) {
        const simulation = build();
        mutate(simulation.outcome.value.rows[0]!);
        simulation.outcome = external(simulation.outcome.value);
        const result = validate(simulation);
        assert.equal(result.status, "invalid", `${name} row seam unexpectedly passed`);
        assert.ok(result.issues.some((entry) => entry.code.startsWith("outcome-row") || entry.code === "acceptance-outcome-binding" || entry.code === "acceptance-outcome-missing"), `${name} row seam lacked a binding failure`);
      }

      const externalWithoutEvidence = buildClaimGradeContractSimulation(artifactRoot, "svg/text-clipped", "missing_capture_evidence", "externally-attested-real-render");
      const missingEvidenceReport = validateManifest(externalWithoutEvidence.manifest, {
        artifactRoot, previousManifest: externalWithoutEvidence.previousManifest, trustLedger: externalWithoutEvidence.trustLedger,
        acceptancePlans: [externalWithoutEvidence.acceptancePlan], preregistrationReceipts: [externalWithoutEvidence.preregistrationReceipt], captureEvidenceBundles: [], captureAttestations: [externalWithoutEvidence.captureAttestation!], measurementReceipts: [externalWithoutEvidence.measurementReceipt], productionEvaluations: [externalWithoutEvidence.productionEvaluation], outcomes: [externalWithoutEvidence.outcome], acceptanceReports: [externalWithoutEvidence.acceptanceReport], lineageSnapshots: [externalWithoutEvidence.lineageSnapshot],
      });
      assert.equal(missingEvidenceReport.status, "invalid");
      assert.ok(missingEvidenceReport.issues.some((issue) => issue.code === "capture-evidence-binding"));

      const captureBindingControls: { name: string; mutate: (bundle: CaptureEvidenceBundle) => void }[] = [
        { name: "target", mutate: (bundle) => { bundle.rows[0]!.targetId = "target_capture_drift_001"; bundle.artifactTargetSetSha256 = digest(canonicalJson(bundle.rows.map((row) => ({ documentId: row.documentId, artifactSha256: row.artifactSha256, targetId: row.targetId, ruleId: row.ruleId })))); } },
        { name: "renderer", mutate: (bundle) => { bundle.rendererFreezeId = `renderer_${"a".repeat(64)}`; bundle.rows[0]!.rendererFreezeId = bundle.rendererFreezeId; } },
        { name: "raw measurement", mutate: (bundle) => { bundle.rows[0]!.rawMeasurementSha256 = "b".repeat(64); bundle.rawMeasurementsSha256 = digest(canonicalJson(bundle.rows.map((row) => ({ documentId: row.documentId, targetId: row.targetId, rawMeasurementSha256: row.rawMeasurementSha256 })))); } },
        { name: "capture chronology", mutate: (bundle) => { bundle.capturedAt = "2026-08-22T20:11:59Z"; } },
      ];
      for (const control of captureBindingControls) {
        const simulation = buildClaimGradeContractSimulation(artifactRoot, "svg/text-clipped", `capture_${control.name.replaceAll(" ", "_")}`, "externally-attested-real-render");
        control.mutate(simulation.captureEvidenceBundle!.value);
        rebindCaptureArtifacts(simulation);
        const report = validate(simulation);
        assert.equal(report.status, "invalid", `${control.name} coordinated capture rehash unexpectedly passed`);
        assert.ok(report.issues.some((issue) => issue.code === "capture-evidence-binding"), `${control.name}: ${JSON.stringify(report.issues)}`);
        assert.equal(report.checks.capture_attestor_trust_valid, false);
      }

      const arbitraryAttestor = buildClaimGradeContractSimulation(artifactRoot, "svg/text-clipped", "arbitrary_attestor", "externally-attested-real-render");
      arbitraryAttestor.captureAttestation!.value.attestorId = "capture_attestor_self_issued_999";
      rebindCaptureArtifacts(arbitraryAttestor);
      const arbitraryAttestorReport = validate(arbitraryAttestor);
      assert.equal(arbitraryAttestorReport.status, "valid", JSON.stringify(arbitraryAttestorReport.issues));
      assert.equal(arbitraryAttestorReport.rules["svg/text-clipped"].capture_evidence_bytes_valid, true);
      assert.equal(arbitraryAttestorReport.rules["svg/text-clipped"].capture_attestor_trust_valid, false);
      assert.equal(arbitraryAttestorReport.rules["svg/text-clipped"].rule_ready_for_calibrated_claim, false);

      const selfSuppliedKey = buildClaimGradeContractSimulation(artifactRoot, "svg/text-clipped", "self_supplied_key", "externally-attested-real-render");
      (selfSuppliedKey.captureAttestation!.value as unknown as Record<string, unknown>).publicKey = "self-supplied-public-key";
      selfSuppliedKey.captureAttestation = external(selfSuppliedKey.captureAttestation!.value);
      selfSuppliedKey.measurementReceipt.value.captureAttestationSha256 = digest(selfSuppliedKey.captureAttestation.bytes);
      selfSuppliedKey.measurementReceipt = external(selfSuppliedKey.measurementReceipt.value);
      const selfSuppliedKeyReport = validate(selfSuppliedKey);
      assert.equal(selfSuppliedKeyReport.status, "invalid");
      assert.ok(selfSuppliedKeyReport.issues.some((issue) => issue.code === "capture-attestation-schema" || issue.code === "lineage-artifact-schema"));
      assert.equal(selfSuppliedKeyReport.checks.capture_attestor_trust_valid, false);

      const rendererMutation = build();
      for (const document of rendererMutation.manifest.documents) document.rendererFreeze.rendererFreezeId = `renderer_${"a".repeat(64)}`;
      rendererMutation.manifest.readinessClaims[0]!.rendererFreezeId = `renderer_${"a".repeat(64)}`;
      Object.assign(rendererMutation.manifest.holdoutFreeze!, holdoutProjection(rendererMutation.manifest));
      assert.ok(validate(rendererMutation).issues.some((issue) => issue.code === "renderer-id-content-mismatch"));

      const registryMutation = build();
      registryMutation.manifest.readinessClaims[0]!.calibratedClaim = true;
      assert.ok(validate(registryMutation).issues.some((issue) => issue.code === "calibrated-claim-without-gate"));
    } finally {
      rmSync(artifactRoot, { recursive: true, force: true });
    }
  });

  it("uses authoritative decoded bytes for every external artifact class through API and CLI", () => {
    const artifactRoot = mkdtempSync(join(tmpdir(), "breaklint-m3-external-decoder-artifacts-"));
    const inputRoot = mkdtempSync(join(tmpdir(), "breaklint-m3-external-decoder-inputs-"));
    try {
      const build = () => buildClaimGradeContractSimulation(artifactRoot, "svg/text-clipped", "external_decoder", "externally-attested-real-render");
      type Descriptor = {
        name: string;
        issuePrefix: string;
        get(options: ValidationOptions): ExternalArtifact<unknown>;
        set(options: ValidationOptions, artifact: ExternalArtifact<unknown>): void;
        flag: string;
      };
      const descriptors: Descriptor[] = [
        { name: "trust", issuePrefix: "trust-ledger", flag: "--trust-ledger", get: (options) => options.trustLedger!, set: (options, artifact) => { options.trustLedger = artifact; } },
        { name: "plan", issuePrefix: "acceptance-plan", flag: "--acceptance-plan", get: (options) => options.acceptancePlans![0]!, set: (options, artifact) => { options.acceptancePlans = [artifact]; } },
        { name: "preregistration", issuePrefix: "preregistration-receipt", flag: "--preregistration-receipt", get: (options) => options.preregistrationReceipts![0]!, set: (options, artifact) => { options.preregistrationReceipts = [artifact]; } },
        { name: "capture-evidence", issuePrefix: "capture-evidence", flag: "--capture-evidence", get: (options) => options.captureEvidenceBundles![0]!, set: (options, artifact) => { options.captureEvidenceBundles = [artifact]; } },
        { name: "capture-attestation", issuePrefix: "capture-attestation", flag: "--capture-attestation", get: (options) => options.captureAttestations![0]!, set: (options, artifact) => { options.captureAttestations = [artifact]; } },
        { name: "measurement", issuePrefix: "measurement-receipt", flag: "--measurement-receipt", get: (options) => options.measurementReceipts![0]!, set: (options, artifact) => { options.measurementReceipts = [artifact]; } },
        { name: "production", issuePrefix: "production-evaluation", flag: "--production-evaluation", get: (options) => options.productionEvaluations![0]!, set: (options, artifact) => { options.productionEvaluations = [artifact]; } },
        { name: "outcome", issuePrefix: "outcome", flag: "--outcome", get: (options) => options.outcomes![0]!, set: (options, artifact) => { options.outcomes = [artifact]; } },
        { name: "acceptance", issuePrefix: "acceptance-report", flag: "--acceptance-report", get: (options) => options.acceptanceReports![0]!, set: (options, artifact) => { options.acceptanceReports = [artifact]; } },
        { name: "lineage", issuePrefix: "lineage-snapshot", flag: "--lineage-snapshot", get: (options) => options.lineageSnapshots![0]!, set: (options, artifact) => { options.lineageSnapshots = [artifact]; } },
      ];

      const byteOnlySimulation = build();
      const byteOnlyOptions = simulationValidationOptions(byteOnlySimulation, artifactRoot);
      for (const descriptor of descriptors) {
        const original = descriptor.get(byteOnlyOptions);
        descriptor.set(byteOnlyOptions, { bytes: original.bytes, value: undefined });
      }
      const byteOnlyReport = validateManifest(byteOnlySimulation.manifest, byteOnlyOptions);
      assert.equal(byteOnlyReport.status, "valid", JSON.stringify(byteOnlyReport.issues));
      assert.equal(byteOnlyReport.checks.capture_evidence_bytes_valid, true);
      assert.equal(byteOnlyReport.checks.capture_attestor_trust_valid, false);
      assert.equal(byteOnlyReport.rules["svg/text-clipped"].rule_ready_for_calibrated_claim, false);

      const invalidByteForms = [
        { name: "invalid-utf8", bytes: Buffer.from([0xff]) },
        { name: "empty-object", bytes: Buffer.from("{}", "utf8") },
        { name: "malformed-json", bytes: Buffer.from("{", "utf8") },
        { name: "schema-invalid", bytes: Buffer.from('{"contractVersion":"wrong"}', "utf8") },
      ];
      for (const descriptor of descriptors) {
        for (const form of invalidByteForms) {
          const simulation = build();
          const options = simulationValidationOptions(simulation, artifactRoot);
          const original = descriptor.get(options);
          descriptor.set(options, { bytes: form.bytes, value: original.value });
          const report = validateManifest(simulation.manifest, options);
          assert.equal(report.status, "invalid", `${descriptor.name}/${form.name} bytes unexpectedly passed`);
          assert.ok(report.issues.some((entry) => entry.code.startsWith(descriptor.issuePrefix)), `${descriptor.name}/${form.name}: ${JSON.stringify(report.issues)}`);
          if (descriptor.name === "capture-evidence") assert.equal(report.checks.capture_evidence_bytes_valid, false);
        }

        const mismatched = build();
        const mismatchOptions = simulationValidationOptions(mismatched, artifactRoot);
        const original = descriptor.get(mismatchOptions);
        descriptor.set(mismatchOptions, { bytes: original.bytes, value: { contractVersion: "parallel-object-mismatch" } });
        const mismatchReport = validateManifest(mismatched.manifest, mismatchOptions);
        assert.equal(mismatchReport.status, "invalid", `${descriptor.name} parallel value mismatch unexpectedly passed`);
        assert.ok(mismatchReport.issues.some((entry) => entry.code === `${descriptor.issuePrefix}-value-mismatch`), JSON.stringify(mismatchReport.issues));

        const swapped = build();
        const swappedOptions = simulationValidationOptions(swapped, artifactRoot);
        const descriptorIndex = descriptors.indexOf(descriptor);
        const foreign = descriptors[(descriptorIndex + 1) % descriptors.length]!.get(swappedOptions);
        descriptor.set(swappedOptions, { bytes: foreign.bytes, value: undefined });
        const swappedReport = validateManifest(swapped.manifest, swappedOptions);
        assert.equal(swappedReport.status, "invalid", `${descriptor.name} accepted another artifact class's valid bytes`);
        assert.ok(swappedReport.issues.some((entry) => entry.code.startsWith(descriptor.issuePrefix)), JSON.stringify(swappedReport.issues));
      }

      const coordinated = build();
      const validBundleValue = coordinated.captureEvidenceBundle!.value;
      coordinated.captureEvidenceBundle = { value: validBundleValue, bytes: Buffer.from("{}", "utf8") };
      coordinated.captureAttestation!.value.captureEvidenceSha256 = digest(coordinated.captureEvidenceBundle.bytes);
      coordinated.captureAttestation = external(coordinated.captureAttestation!.value);
      coordinated.measurementReceipt.value.captureAttestationSha256 = digest(coordinated.captureAttestation.bytes);
      coordinated.measurementReceipt = external(coordinated.measurementReceipt.value);
      coordinated.productionEvaluation.value.measurementReceiptSha256 = digest(coordinated.measurementReceipt.bytes);
      coordinated.productionEvaluation.value.rows.forEach((row, index) => { row.measurementReceiptRowSha256 = digest(canonicalJson(coordinated.measurementReceipt.value.rows[index]!)); });
      rebindSimulationArtifacts(coordinated);
      const coordinatedReport = validateManifest(coordinated.manifest, simulationValidationOptions(coordinated, artifactRoot));
      assert.equal(coordinatedReport.status, "invalid", "reviewer coordinated capture rehash unexpectedly passed");
      assert.equal(coordinatedReport.checks.capture_evidence_bytes_valid, false);
      assert.equal(coordinatedReport.checks.capture_attestor_trust_valid, false);
      assert.equal(coordinatedReport.rules["svg/text-clipped"].rule_ready_for_calibrated_claim, false);
      assert.ok(coordinatedReport.issues.some((entry) => entry.code === "capture-evidence-schema"), JSON.stringify(coordinatedReport.issues));

      const cliSimulation = build();
      const cliOptions = simulationValidationOptions(cliSimulation, artifactRoot);
      const validator = fileURLToPath(new URL("../tools/calibration/readiness-validator.ts", import.meta.url));
      const write = (name: string, bytes: Buffer): string => { const path = join(inputRoot, `${name}.json`); writeFileSync(path, bytes); return path; };
      const manifestPath = write("manifest", Buffer.from(JSON.stringify(cliSimulation.manifest), "utf8"));
      const previousPath = write("previous", Buffer.from(JSON.stringify(cliSimulation.previousManifest), "utf8"));
      const artifactPaths = new Map(descriptors.map((descriptor) => [descriptor.name, write(descriptor.name, descriptor.get(cliOptions).bytes)]));
      const cliArgs = () => ["--experimental-strip-types", validator, manifestPath, "--artifact-root", artifactRoot, "--previous-manifest", previousPath, ...descriptors.flatMap((descriptor) => [descriptor.flag, artifactPaths.get(descriptor.name)!])];
      const runCli = () => spawnSync(process.execPath, cliArgs(), { encoding: "utf8", timeout: 30_000 });
      const validCli = runCli();
      assert.equal(validCli.status, 0, validCli.stderr || validCli.stdout);
      for (const descriptor of descriptors) {
        const path = artifactPaths.get(descriptor.name)!;
        const originalBytes = descriptor.get(cliOptions).bytes;
        for (const invalidBytes of [Buffer.from([0xff]), Buffer.from("{", "utf8")]) {
          writeFileSync(path, invalidBytes);
          const invalid = runCli();
          assert.equal(invalid.status, 1, `${descriptor.name} invalid CLI bytes: ${invalid.stderr}`);
          const invalidReport = JSON.parse(invalid.stdout) as { issues: { code: string }[] };
          assert.ok(invalidReport.issues.some((entry) => entry.code === `${descriptor.issuePrefix}-bytes`), JSON.stringify(invalidReport.issues));
        }
        const next = descriptors[(descriptors.indexOf(descriptor) + 1) % descriptors.length]!;
        writeFileSync(path, next.get(cliOptions).bytes);
        const swapped = runCli();
        assert.equal(swapped.status, 1, `${descriptor.name} swapped CLI bytes: ${swapped.stderr}`);
        writeFileSync(path, originalBytes);
      }
    } finally {
      rmSync(artifactRoot, { recursive: true, force: true });
      rmSync(inputRoot, { recursive: true, force: true });
    }
  });

  it("turns red when the actual pinned product rule is mutated in an isolated executable clone", () => {
    const artifactRoot = mkdtempSync(join(tmpdir(), "breaklint-m3-rule-source-artifacts-"));
    const runnerRoot = mkdtempSync(join(tmpdir(), "breaklint-m3-rule-source-runner-"));
    const inputs = join(runnerRoot, "inputs");
    try {
      const simulation = buildClaimGradeContractSimulation(artifactRoot, "svg/text-clipped");
      cpSync(join(REPOSITORY_ROOT, "src"), join(runnerRoot, "src"), { recursive: true });
      cpSync(join(REPOSITORY_ROOT, "schemas"), join(runnerRoot, "schemas"), { recursive: true });
      mkdirSync(join(runnerRoot, "tests", "tools", "calibration"), { recursive: true });
      cpSync(join(REPOSITORY_ROOT, "tests", "tools", "calibration", "readiness-validator.ts"), join(runnerRoot, "tests", "tools", "calibration", "readiness-validator.ts"));
      cpSync(join(REPOSITORY_ROOT, "package.json"), join(runnerRoot, "package.json"));
      symlinkSync(join(REPOSITORY_ROOT, "node_modules"), join(runnerRoot, "node_modules"), "dir");
      const rulePath = join(runnerRoot, "src", "rules", "svg", "text-clipped.ts");
      const originalRule = readFileSync(rulePath, "utf8");
      const mutatedRule = originalRule.replace("if (missing <= maxMissingInk) continue;", "if (missing < maxMissingInk) continue;");
      assert.notEqual(mutatedRule, originalRule, "product-rule mutation control did not change source bytes");
      writeFileSync(rulePath, mutatedRule);
      mkdirSync(inputs, { recursive: true });
      const write = (name: string, bytes: Buffer) => { const path = join(inputs, name); writeFileSync(path, bytes); return path; };
      const manifestPath = write("manifest.json", Buffer.from(JSON.stringify(simulation.manifest), "utf8"));
      const previousPath = write("previous.json", Buffer.from(JSON.stringify(simulation.previousManifest), "utf8"));
      const trustPath = write("trust.json", simulation.trustLedger.bytes);
      const planPath = write("plan.json", simulation.acceptancePlan.bytes);
      const receiptPath = write("receipt.json", simulation.preregistrationReceipt.bytes);
      const measurementPath = write("measurement.json", simulation.measurementReceipt.bytes);
      const productionPath = write("production.json", simulation.productionEvaluation.bytes);
      const outcomePath = write("outcome.json", simulation.outcome.bytes);
      const acceptancePath = write("acceptance.json", simulation.acceptanceReport.bytes);
      const lineagePath = write("lineage.json", simulation.lineageSnapshot.bytes);
      const run = spawnSync(process.execPath, ["--experimental-strip-types", join(runnerRoot, "tests", "tools", "calibration", "readiness-validator.ts"), manifestPath, "--artifact-root", artifactRoot, "--previous-manifest", previousPath, "--trust-ledger", trustPath, "--acceptance-plan", planPath, "--preregistration-receipt", receiptPath, "--measurement-receipt", measurementPath, "--production-evaluation", productionPath, "--outcome", outcomePath, "--acceptance-report", acceptancePath, "--lineage-snapshot", lineagePath], { encoding: "utf8", timeout: 30_000 });
      assert.equal(run.status, 1, run.stderr);
      const report = JSON.parse(run.stdout) as { issues: { code: string }[] };
      assert.ok(report.issues.some((issue) => issue.code === "measurement-receipt-contract-binding" || issue.code === "production-evaluation-contract-binding"), JSON.stringify(report.issues));
    } finally {
      rmSync(artifactRoot, { recursive: true, force: true });
      rmSync(runnerRoot, { recursive: true, force: true });
    }
  });

  it("fails closed for every registered negative control", () => {
    assert.equal(NEGATIVE_CONTROLS.length, 30, "the named control ledger must not silently shrink");
    for (const control of NEGATIVE_CONTROLS) {
      const kase = instantiateNegativeControl(control);
      const report = validateManifest(kase.manifest, {
        artifactRoot: ARTIFACT_ROOT,
        ...(kase.previousManifest ? { previousManifest: kase.previousManifest } : {}),
      });
      assert.equal(report.status, "invalid", `${control.id} unexpectedly passed`);
      assert.equal(report.exitCode, 1, `${control.id} returned the wrong contract exit code`);
      assert.ok(
        report.issues.some((issue) => issue.code === control.expectedCode),
        `${control.id} lacked ${control.expectedCode}: ${JSON.stringify(report.issues)}`,
      );
    }
  });

  it("cannot inflate readiness by cloning three artifacts to thirty declarations", () => {
    const manifest = loadCleanManifest();
    const source = manifest.documents[0]!;
    const artifacts = [
      { relativePath: "synthetic-clean.svg", sha256: "3d11b5581edfedbb7ef63d8cec97cc12d46ba23a43e86187a3b44ceefcd0c582" },
      { relativePath: "synthetic-clean-b.svg", sha256: "863d696198bd509491691decfb6dcbfae0ec71db523469a2f2c315de2e9791b8" },
      { relativePath: "synthetic-clean-c.svg", sha256: "788dd5592bb4201f10b6d58123ed63a46e88231d7f0e61fc67fea7eb3f3ae496" },
    ];
    manifest.documents = Array.from({ length: 30 }, (_, index) => {
      const document = structuredClone(source);
      const artifact = artifacts[index % artifacts.length]!;
      document.documentId = `doc_clone_attack_${index.toString().padStart(3, "0")}`;
      document.originGroupId = `origin_clone_attack_${index.toString().padStart(3, "0")}`;
      document.realDocument = true;
      document.artifact.relativePath = artifact.relativePath;
      document.artifact.sha256 = artifact.sha256;
      document.provenance.provenanceClass = "public_redistributable";
      document.license.status = "permissive_redistribution_verified";
      document.privacy.status = "reviewed_no_personal_data";
      for (const [targetIndex, target] of document.targets.entries()) {
        target.targetId = canonicalTargetId(document, target);
        const guidelineVersion = target.ruleId === "svg/text-clipped" ? "svg-text-clipped-v1" : target.ruleId === "svg/text-ink-collision" ? "svg-text-ink-collision-v1" : "svg-text-overflows-viewport-v1";
        target.annotations = ["a", "b"].map((suffix) => ({
          annotationId: `ann_clone_${index.toString().padStart(3, "0")}_${targetIndex}_${suffix}`,
          annotatorId: `annotator_clone_${suffix}001`,
          targetId: target.targetId,
          ruleId: target.ruleId,
          guidelineVersion,
          createdAt: "2026-08-22T20:30:00Z",
          blinded: true as const,
          breaklintResultExposed: false as const,
          label: "negative" as const,
          rationale: "Blind negative annotation for the three-byte clone attack control.",
        }));
      }
      return document;
    });
    for (const claim of manifest.readinessClaims) {
      claim.eligibleRealDocuments = 30;
      claim.eligibleOriginGroups = 30;
      claim.ruleReadyForCalibration = true;
      claim.ruleReadyForCalibratedClaim = true;
      claim.calibratedClaim = true;
    }
    const report = validateManifest(manifest, { artifactRoot: ARTIFACT_ROOT });
    assert.equal(report.status, "invalid");
    assert.ok(report.issues.some((issue) => issue.code === "artifact-hash-duplicate"));
    for (const rule of Object.values(report.rules)) {
      assert.ok(rule.eligible_real_documents <= 3);
      assert.equal(rule.rule_ready_for_calibrated_claim, false);
    }
  });

  it("rejects a symlink even when its declared path is inside the artifact root", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "breaklint-m3-symlink-"));
    try {
      symlinkSync(join(ARTIFACT_ROOT, "synthetic-clean.svg"), join(temporaryRoot, "opaque.svg"));
      const manifest = loadCleanManifest();
      manifest.documents[0]!.artifact.relativePath = "opaque.svg";
      const report = validateManifest(manifest, { artifactRoot: temporaryRoot });
      assert.equal(report.status, "invalid");
      assert.ok(report.issues.some((issue) => issue.code === "artifact-symlink-escape"));
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("marks agreeing non-binary annotations invalid at the annotation check", () => {
    const control = NEGATIVE_CONTROLS.find((entry) => entry.id === "agreeing-nonbinary-annotations-forced-binary");
    assert.ok(control);
    const kase = instantiateNegativeControl(control);
    const report = validateManifest(kase.manifest, { artifactRoot: ARTIFACT_ROOT });
    assert.equal(report.status, "invalid");
    assert.equal(report.checks.annotation_valid, false);
  });

  it("recomputes acceptance metrics and rejects a self-declared-looking report whose counts fail", () => {
    const plan = {
      contractVersion: "m3-0-acceptance-plan-v1",
      planId: "plan_recomputed_failure_001",
      planVersion: 1,
      samplingPlanId: "sampling_recomputed_failure_001",
      samplingPlanVersion: 1,
      acceptanceGateVersion: "acceptance-gate-v1",
      createdAt: "2026-08-22T20:35:00Z",
      ruleId: "svg/text-clipped",
      candidateSelectionId: "selection_recomputed_failure_001",
      candidateConfigHash: "2".repeat(64),
      thresholdCandidateHash: "4".repeat(64),
      gates: [
        { metric: "precision", operator: ">=", threshold: 0.9 },
        { metric: "recall", operator: ">=", threshold: 0.9 },
        { metric: "specificity", operator: ">=", threshold: 0.9 },
        { metric: "false-positive-rate", operator: "<=", threshold: 0.1 },
      ],
    };
    const planBytes = Buffer.from(JSON.stringify(plan), "utf8");
    const planSha256 = createHash("sha256").update(planBytes).digest("hex");
    const acceptance = {
      contractVersion: "m3-0-acceptance-report-v1",
      reportId: "acceptance_recomputed_failure_001",
      createdAt: "2026-08-22T20:40:00Z",
      ruleId: "svg/text-clipped",
      holdoutId: "holdout_recomputed_failure_001",
      holdoutVersion: 1,
      holdoutManifestHash: "1".repeat(64),
      candidateConfigHash: "2".repeat(64),
      rendererFreezeId: `renderer_${"3".repeat(64)}`,
      rendererContentHash: "3".repeat(64),
      acceptanceGateVersion: "acceptance-gate-v1",
      preregisteredPlanId: "plan_recomputed_failure_001",
      planSha256,
      eligibleHoldoutDocuments: 30,
      eligibleHoldoutOriginGroups: 30,
      ambiguityExcluded: true,
      confusionCounts: { truePositive: 1, trueNegative: 1, falsePositive: 9, falseNegative: 9, excludedAmbiguous: 0 },
      gates: [
        { metric: "precision", operator: ">=", threshold: 0.9 },
        { metric: "recall", operator: ">=", threshold: 0.9 },
        { metric: "specificity", operator: ">=", threshold: 0.9 },
        { metric: "false-positive-rate", operator: "<=", threshold: 0.1 },
      ],
    };
    const bytes = Buffer.from(JSON.stringify(acceptance), "utf8");
    const report = validateManifest(loadCleanManifest(), {
      artifactRoot: ARTIFACT_ROOT,
      acceptancePlans: [{ value: plan, bytes: planBytes }],
      acceptanceReports: [{ value: acceptance, bytes }],
    });
    assert.equal(report.status, "invalid");
    assert.equal(report.checks.acceptance_reports_valid, false);
    assert.ok(report.issues.some((issue) => issue.code === "acceptance-report-schema" || issue.code === "acceptance-outcome-missing"));
  });

  it("rejects undeclared fields instead of silently accepting contract drift", () => {
    const manifest = loadCleanManifest();
    Object.assign(manifest.documents[0]!, { undeclaredTruth: true });
    const report = validateManifest(manifest, { artifactRoot: ARTIFACT_ROOT });
    assert.equal(report.status, "invalid");
    assert.ok(report.issues.some((issue) => issue.code === "schema" && /additionalProperties/u.test(issue.message)));
  });

  it("rejects unknown, duplicate-single and valueless CLI options with usage exit 2", () => {
    const validator = fileURLToPath(new URL("../tools/calibration/readiness-validator.ts", import.meta.url));
    const manifest = fileURLToPath(new URL("../fixtures/calibration/public-synthetic-manifest.json", import.meta.url));
    for (const args of [["--unknown", "x"], ["--artifact-root", ARTIFACT_ROOT, "--artifact-root", ARTIFACT_ROOT], ["--output"]]) {
      const run = spawnSync(process.execPath, ["--experimental-strip-types", validator, manifest, ...args], { encoding: "utf8" });
      assert.equal(run.status, 2, `${args.join(" ")} was not rejected`);
    }
  });

  it("rejects a newer holdout version when no prior external receipt baseline is supplied", () => {
    const control = NEGATIVE_CONTROLS.find((entry) => entry.id === "coordinated-holdout-rewrite-same-version");
    assert.ok(control);
    const kase = instantiateNegativeControl(control);
    assert.ok(kase.previousManifest);
    kase.manifest.holdoutFreeze!.version += 1;
    const report = validateManifest(kase.manifest, {
      artifactRoot: ARTIFACT_ROOT,
      previousManifest: kase.previousManifest,
    });
    assert.equal(report.status, "invalid");
    assert.ok(report.issues.some((issue) => issue.code === "preregistration-external-baseline-missing"));
  });
});
