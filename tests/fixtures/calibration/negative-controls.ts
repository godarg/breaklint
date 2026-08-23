import { readFileSync } from "node:fs";

import { holdoutProjection } from "../../tools/calibration/readiness-validator.ts";
import type {
  Annotation,
  DocumentEntry,
  Manifest,
  Target,
} from "../../tools/calibration/readiness-validator.ts";

export interface NegativeControl {
  id: string;
  expectedCode: string;
  prepare?(manifest: Manifest): Manifest;
  mutate(manifest: Manifest): void;
}

export interface NegativeControlCase {
  manifest: Manifest;
  previousManifest?: Manifest;
}

function annotation(target: Target, suffix: string, annotatorId: string, label: Annotation["label"]): Annotation {
  const guidelineVersion = target.ruleId === "svg/text-clipped"
    ? "svg-text-clipped-v1"
    : target.ruleId === "svg/text-ink-collision"
      ? "svg-text-ink-collision-v1"
      : "svg-text-overflows-viewport-v1";
  return {
    annotationId: `ann_${suffix.padEnd(8, "0")}`,
    annotatorId,
    targetId: target.targetId,
    ruleId: target.ruleId,
    guidelineVersion,
    createdAt: "2026-08-22T20:30:00Z",
    blinded: true,
    breaklintResultExposed: false,
    label,
    rationale: `Independent blind judgement for control ${suffix}.`,
  };
}

function makePrivateReal(document: DocumentEntry): void {
  document.realDocument = true;
  document.artifact.storage = "external-private";
  document.artifact.relativePath = null;
  document.provenance.provenanceClass = "private_authorized";
  document.provenance.sourceLocator = "private_source_opaque_001";
  document.provenance.sourceEvidence = "Private evaluation authority recorded outside this public repository.";
  document.license.status = "evaluation_only_authorized";
  document.license.evidence = "Evaluation-only permission is recorded in the private rights ledger.";
  document.privacy.status = "contains_personal_data_authorized_private";
  document.privacy.reviewEvidence = "Private-only privacy review is recorded in the access ledger.";
  for (const [index, target] of document.targets.entries()) {
    target.annotations = [
      annotation(target, `base${index}a`, "annotator_blind_a001", "positive"),
      annotation(target, `base${index}b`, "annotator_blind_b001", "positive"),
    ];
    target.oracle.groundTruth = "positive";
  }
}

function cloneForSplit(manifest: Manifest, split: DocumentEntry["split"]): DocumentEntry {
  const duplicate = structuredClone(manifest.documents[0]!);
  duplicate.documentId = `doc_control_${split}_002`;
  duplicate.split = split;
  duplicate.originGroupId = `origin_control_${split}_002`;
  duplicate.duplicateGroupId = null;
  duplicate.derivationGroupId = null;
  duplicate.parentTemplateGroupId = null;
  for (const [index, target] of duplicate.targets.entries()) {
    target.targetId = `target_control_${split}_${index.toString().padStart(2, "0")}`;
    target.svgRootKey = `svgroot_control_${split}_002`;
    target.sourceIdentity = `author-id:control-${split}-${index}`;
    for (const entry of target.annotations) entry.targetId = target.targetId;
  }
  return duplicate;
}

function freezeFirstDocument(manifest: Manifest): void {
  const document = manifest.documents[0]!;
  document.split = "holdout";
  makePrivateReal(document);
  const projection = holdoutProjection(manifest);
  manifest.holdoutFreeze = {
    holdoutId: "holdout_control_immutable_001",
    holdoutLineageId: "lineage_control_immutable_001",
    preregistrationReceiptSha256: "8".repeat(64),
    version: 1,
    frozenAt: "2026-08-22T20:31:00Z",
    reason: "First immutable baseline for coordinated-mutation negative control.",
    approverId: "approver_control_001",
    ...projection,
  };
}

export function loadCleanManifest(): Manifest {
  return JSON.parse(readFileSync(new URL("./public-synthetic-manifest.json", import.meta.url), "utf8")) as Manifest;
}

export const NEGATIVE_CONTROLS: readonly NegativeControl[] = Object.freeze([
  {
    id: "oracle-production-decision-free-field",
    expectedCode: "schema",
    mutate: (manifest) => { Object.assign(manifest.documents[0]!.targets[0]!.oracle, { inputs: ["productionDecision"] }); },
  },
  {
    id: "oracle-missing-ink-enum-bypass",
    expectedCode: "schema",
    mutate: (manifest) => { (manifest.documents[0]!.targets[0]!.oracle.evidenceKinds as unknown as string[]).push("missing_ink"); },
  },
  {
    id: "oracle-rule-output-free-field",
    expectedCode: "schema",
    mutate: (manifest) => { Object.assign(manifest.documents[0]!.targets[0]!.oracle, { derivedFrom: ["ruleOutput"] }); },
  },
  {
    id: "artifact-hash-mismatch",
    expectedCode: "artifact-hash-mismatch",
    mutate: (manifest) => { manifest.documents[0]!.artifact.sha256 = "0".repeat(64); },
  },
  {
    id: "identical-hash-development-holdout",
    expectedCode: "split-identical-hash",
    mutate: (manifest) => { manifest.documents.push(cloneForSplit(manifest, "holdout")); },
  },
  {
    id: "identical-hash-same-split-inflation",
    expectedCode: "artifact-hash-duplicate",
    mutate: (manifest) => { manifest.documents.push(cloneForSplit(manifest, "development")); },
  },
  {
    id: "same-origin-different-id-cross-split",
    expectedCode: "split-originGroupId-leakage",
    mutate: (manifest) => {
      const duplicate = cloneForSplit(manifest, "holdout");
      makePrivateReal(duplicate);
      duplicate.artifact.sha256 = "1".repeat(64);
      duplicate.originGroupId = manifest.documents[0]!.originGroupId;
      manifest.documents.push(duplicate);
    },
  },
  {
    id: "real-target-single-annotation",
    expectedCode: "annotation-count",
    mutate: (manifest) => {
      makePrivateReal(manifest.documents[0]!);
      manifest.documents[0]!.targets[0]!.annotations.splice(1);
    },
  },
  {
    id: "annotation-disagreement-without-adjudication",
    expectedCode: "adjudication-missing",
    mutate: (manifest) => {
      makePrivateReal(manifest.documents[0]!);
      manifest.documents[0]!.targets[0]!.annotations[1]!.label = "negative";
    },
  },
  {
    id: "ambiguous-forced-binary",
    expectedCode: "ambiguity-forced-binary",
    mutate: (manifest) => {
      makePrivateReal(manifest.documents[0]!);
      const target = manifest.documents[0]!.targets[0]!;
      target.annotations[1]!.label = "ambiguous";
      target.ambiguityStatus = "ambiguous";
      target.oracle.groundTruth = "ambiguous";
      target.adjudication = {
        adjudicationId: "adj_control_ambiguous_001",
        adjudicatorIds: ["annotator_adjudicator_c001"],
        guidelineVersion: "svg-text-clipped-v1",
        createdAt: "2026-08-22T20:31:00Z",
        finalLabel: "positive",
        rationale: "Invalid control deliberately forces an ambiguous judgement to positive.",
      };
    },
  },
  {
    id: "provenance-status-missing",
    expectedCode: "schema",
    mutate: (manifest) => { Reflect.deleteProperty(manifest.documents[0]!.provenance, "provenanceClass"); },
  },
  {
    id: "licence-status-missing",
    expectedCode: "schema",
    mutate: (manifest) => { Reflect.deleteProperty(manifest.documents[0]!.license, "status"); },
  },
  {
    id: "privacy-status-missing",
    expectedCode: "schema",
    mutate: (manifest) => { Reflect.deleteProperty(manifest.documents[0]!.privacy, "status"); },
  },
  {
    id: "frozen-holdout-mutated",
    expectedCode: "holdout-freeze-mismatch",
    mutate: (manifest) => {
      const holdout = cloneForSplit(manifest, "holdout");
      makePrivateReal(holdout);
      holdout.artifact.sha256 = "2".repeat(64);
      manifest.documents.push(holdout);
      manifest.holdoutFreeze = {
        holdoutId: "holdout_control_001",
        holdoutLineageId: "lineage_control_001",
        preregistrationReceiptSha256: "8".repeat(64),
        version: 1,
        frozenAt: "2026-08-22T20:31:00Z",
        reason: "Frozen before the deliberate mutation used by this negative control.",
        approverId: "approver_control_001",
        orderedDocuments: [{
          documentId: holdout.documentId,
          artifactSha256: "3".repeat(64),
          originGroupId: holdout.originGroupId,
        }],
        manifestHash: "3".repeat(64),
        annotationHash: "3".repeat(64),
        adjudicationHash: "3".repeat(64),
        rendererFreezeIds: [holdout.rendererFreeze.rendererFreezeId],
        acceptancePlanHashes: [],
      };
    },
  },
  {
    id: "coordinated-holdout-rewrite-same-version",
    expectedCode: "holdout-version-mutated",
    prepare: (manifest) => {
      freezeFirstDocument(manifest);
      return structuredClone(manifest);
    },
    mutate: (manifest) => {
      manifest.documents[0]!.artifact.sha256 = "4".repeat(64);
      Object.assign(manifest.holdoutFreeze!, holdoutProjection(manifest));
    },
  },
  {
    id: "renderer-identity-missing",
    expectedCode: "schema",
    mutate: (manifest) => { manifest.documents[0]!.rendererFreeze.fonts = []; },
  },
  {
    id: "calibration-readiness-without-real-corpus",
    expectedCode: "calibration-readiness-false-claim",
    mutate: (manifest) => { manifest.readinessClaims[0]!.ruleReadyForCalibration = true; },
  },
  {
    id: "calibrated-claim-without-holdout-gate",
    expectedCode: "calibrated-claim-without-gate",
    mutate: (manifest) => { manifest.readinessClaims[0]!.calibratedClaim = true; },
  },
  {
    id: "claim-ready-without-external-baseline-report",
    expectedCode: "calibrated-claim-readiness-false-claim",
    mutate: (manifest) => { manifest.readinessClaims[0]!.ruleReadyForCalibratedClaim = true; },
  },
  {
    id: "synthetic-counted-real",
    expectedCode: "synthetic-counted-real",
    mutate: (manifest) => { manifest.documents[0]!.realDocument = true; },
  },
  {
    id: "run-local-target-identity",
    expectedCode: "target-id-run-local",
    mutate: (manifest) => { manifest.documents[0]!.targets[0]!.targetId = "target_data-bl-svg-target_001"; },
  },
  {
    id: "unverifiable-signature-target",
    expectedCode: "target-signature-unverifiable",
    mutate: (manifest) => { manifest.documents[0]!.targets[0]!.sourceIdentity = "signature:unverifiable-target-001"; },
  },
  {
    id: "agreeing-nonbinary-annotations-forced-binary",
    expectedCode: "nonbinary-oracle-binary",
    mutate: (manifest) => {
      makePrivateReal(manifest.documents[0]!);
      const target = manifest.documents[0]!.targets[0]!;
      target.annotations[0]!.label = "ambiguous";
      target.annotations[1]!.label = "ambiguous";
      target.ambiguityStatus = "unambiguous";
      target.oracle.groundTruth = "positive";
      target.adjudication = null;
    },
  },
  {
    id: "candidate-selected-from-holdout",
    expectedCode: "candidate-holdout-input",
    mutate: (manifest) => {
      manifest.documents[0]!.split = "holdout";
      const candidateConfigHash = "5".repeat(64);
      const thresholdCandidateHash = "6".repeat(64);
      manifest.candidateSelections.push({
        selectionId: "selection_holdout_leak_001",
        ruleId: "svg/text-clipped",
        createdAt: "2026-08-22T20:32:00Z",
        holdoutLineageId: "lineage_control_leak_001",
        holdoutId: "holdout_control_leak_001",
        preregistrationReceiptSha256: "8".repeat(64),
        preregisteredPlanId: "plan_control_001",
        planSha256: "9".repeat(64),
        candidateConfigHash,
        thresholdCandidateHash,
        inputSplits: ["holdout"],
        inputDocumentIds: [manifest.documents[0]!.documentId],
        evidenceHashes: ["7".repeat(64)],
        holdoutOutcomeUsed: false,
      });
      manifest.readinessClaims[0]!.candidateConfigHash = candidateConfigHash;
      manifest.readinessClaims[0]!.thresholdCandidateHash = thresholdCandidateHash;
    },
  },
  {
    id: "duplicate-target-id",
    expectedCode: "target-id-duplicate",
    mutate: (manifest) => {
      manifest.documents[0]!.targets[1]!.targetId = manifest.documents[0]!.targets[0]!.targetId;
    },
  },
  {
    id: "duplicate-annotation-id",
    expectedCode: "annotation-id-duplicate",
    mutate: (manifest) => {
      makePrivateReal(manifest.documents[0]!);
      manifest.documents[0]!.targets[1]!.annotations[0]!.annotationId =
        manifest.documents[0]!.targets[0]!.annotations[0]!.annotationId;
    },
  },
  {
    id: "wrong-rule-guideline-version",
    expectedCode: "guideline-version-mismatch",
    mutate: (manifest) => {
      makePrivateReal(manifest.documents[0]!);
      const target = manifest.documents[0]!.targets[1]!;
      for (const entry of target.annotations) entry.guidelineVersion = "svg-text-clipped-v1";
    },
  },
  {
    id: "renderer-freeze-id-content-drift",
    expectedCode: "renderer-freeze-id-drift",
    mutate: (manifest) => {
      const duplicate = cloneForSplit(manifest, "development");
      duplicate.artifact.sha256 = "8".repeat(64);
      duplicate.rendererFreeze.browserVersion = "999.0.0.0";
      manifest.documents.push(duplicate);
    },
  },
  {
    id: "renderer-freeze-id-simple-rename",
    expectedCode: "renderer-id-content-mismatch",
    mutate: (manifest) => {
      manifest.documents[0]!.rendererFreeze.rendererFreezeId = `renderer_${"a".repeat(64)}`;
    },
  },
  {
    id: "synthetic-human-annotations",
    expectedCode: "synthetic-human-annotations",
    mutate: (manifest) => {
      const target = manifest.documents[0]!.targets[0]!;
      target.annotations = [
        annotation(target, "synthetica", "annotator_fake_a001", "negative"),
        annotation(target, "syntheticb", "annotator_fake_b001", "negative"),
      ];
    },
  },
]);

export function instantiateNegativeControl(control: NegativeControl): NegativeControlCase {
  const manifest = loadCleanManifest();
  const previousManifest = control.prepare?.(manifest);
  control.mutate(manifest);
  return { manifest, ...(previousManifest ? { previousManifest } : {}) };
}
