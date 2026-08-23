import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";

import { Ajv2020 } from "ajv/dist/2020.js";

import {
  buildFreezeProjection,
  canonicalJson,
  deriveStableTargetId,
  validateStrictSplits,
  type FreezeProjectionInput,
  type RuleId,
  type SplitDocument,
} from "./m3-1-pilot.ts";
import type { ReadinessReport, ValidationIssue } from "./readiness-validator.ts";

const RULE_IDS: readonly RuleId[] = [
  "svg/text-clipped",
  "svg/text-ink-collision",
  "svg/text-overflows-viewport",
];
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const ROOT = realpathSync(new URL("../../..", import.meta.url));

const ajv = new Ajv2020({ allErrors: true, strict: true, formats: { "date-time": DATE_TIME } });
const validateIntake = ajv.compile(JSON.parse(readFileSync(resolve(ROOT, "schemas/calibration/public-intake-manifest-v1.schema.json"), "utf8")) as object);
const validatePilotReport = ajv.compile(JSON.parse(readFileSync(resolve(ROOT, "schemas/calibration/m3-1-pilot-report-v1.schema.json"), "utf8")) as object);

const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

function safeBundleFile(bundleRoot: string, relativePath: string): string {
  if (!relativePath || isAbsolute(relativePath) || relativePath.includes("..") || relativePath.includes("~") || relativePath.includes("\\")) {
    throw new Error("bundle path is not a safe relative POSIX path");
  }
  const root = realpathSync(bundleRoot);
  const path = resolve(root, relativePath);
  const rel = relative(root, path);
  if (rel.startsWith("..") || isAbsolute(rel) || !path.startsWith(`${root}${sep}`) || !existsSync(path)) throw new Error("bundle path escapes or is absent");
  if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) throw new Error("bundle path must be a regular non-symlink file");
  return path;
}

function readJson(bundleRoot: string, relativePath: string): { bytes: Buffer; value: unknown } {
  const bytes = readFileSync(safeBundleFile(bundleRoot, relativePath));
  return { bytes, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown };
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message };
}

function missingM30Issues(): ValidationIssue[] {
  return [
    issue("m3-0-acceptance-plan-materialization-missing", "/checks/acceptance_plans_valid", "No M3-0 acceptance-plan artifact has been materialized from this intake."),
    issue("m3-0-acceptance-report-materialization-missing", "/checks/acceptance_reports_valid", "No M3-0 acceptance-report artifact exists."),
    issue("m3-0-capture-evidence-missing", "/checks/capture_evidence_bytes_valid", "No M3-0 capture-evidence bytes are bound to this intake."),
    issue("m3-0-corpus-materialization-missing", "/checks/schema_valid", "The M3-1 intake is not an M3-0 corpus manifest and is not counted as one."),
    issue("m3-0-external-attestor-trust-root-missing", "/checks/capture_attestor_trust_valid", "No externally governed attestor trust root has been verified."),
    issue("m3-0-external-freeze-receipt-missing", "/checks/holdout_frozen", "The local freeze projection has no verified external freeze receipt."),
    issue("m3-0-external-holdout-baseline-missing", "/checks/external_holdout_baseline_valid", "No external M3-0 holdout baseline is present."),
    issue("m3-0-independent-human-annotation-missing", "/checks/annotation_valid", "Two independent blind human annotations and any required adjudication are absent."),
    issue("m3-0-oracle-materialization-missing", "/checks/oracle_independent", "No independent M3-0 oracle artifact has been materialized."),
    issue("m3-0-registry-materialization-missing", "/checks/registry_state_consistent", "No M3-0 readiness registry state has been materialized from this intake."),
    issue("m3-0-renderer-freeze-missing", "/checks/renderer_identity_complete", "No complete M3-0 renderer and font identity freeze is present."),
  ];
}

type IntakeManifest = {
  contractVersion: string;
  manifestId: string;
  documents: Array<{
    documentId: string;
    artifact: { sha256: string; byteLength: number; relativePath: string };
    sourceLocator: string;
    sourceCapturedAt: string;
    sourceCaptureMode: FreezeProjectionInput["documents"][number]["source"]["sourceCaptureMode"];
    firstPartySourceSnapshot: FreezeProjectionInput["documents"][number]["source"]["firstPartySourceSnapshot"];
    provenanceClass: string;
    provenanceEvidenceSha256: string;
    rightsBasis: string;
    rightsEvidenceSha256: string;
    privacyClass: string;
    privacyEvidenceSha256: string;
    founderAuthorizationSha256: string | null;
    groups: { originGroupId: string; duplicateGroupId: string; derivationGroupId: string; templateGroupId: string; versionGroupId: string };
    targets: Array<{
      targetId: string;
      artifactSha256: string;
      ruleId: RuleId;
      svgRootLocator: { mode: string; authorId?: string; structuralPath?: string };
      targetLocator: { mode: string; authorId?: string; sourceSignatureSha256?: string };
    }>;
    claimEligible: boolean;
    captureAttestorTrustValid: boolean;
    calibrated: boolean;
  }>;
  claimEligible: boolean;
  captureAttestorTrustValid: boolean;
  calibrated: boolean;
};

type PersistedSplit = { valid: boolean; issues: unknown[]; assignments: SplitDocument[] };

function falseRules(): ReadinessReport["rules"] {
  return Object.fromEntries(RULE_IDS.map((ruleId) => [ruleId, {
    calibration_mode: ruleId === "svg/text-overflows-viewport" ? "structural-validation" : "empirical-threshold",
    eligible_real_documents: 0,
    eligible_origin_groups: 0,
    eligible_real_evidentiary_holdout_documents: 0,
    eligible_real_evidentiary_holdout_origin_groups: 0,
    capture_evidence_bytes_valid: false,
    capture_attestor_trust_valid: false,
    rule_ready_for_calibration: false,
    rule_ready_for_calibrated_claim: false,
  }])) as ReadinessReport["rules"];
}

export function buildM31ToM30ReadinessBridge(bundleRoot: string): ReadinessReport {
  const issues = missingM30Issues();
  let intakeSchemaValid = false;
  let artifactAndTargetBindingsValid = true;
  let provenanceValid = false;
  let privacyValid = false;
  let splitValid = false;
  let manifestSha256 = sha256("");

  try {
    const manifestArtifact = readJson(bundleRoot, "intake-manifest.json");
    manifestSha256 = sha256(manifestArtifact.bytes);
    const manifest = manifestArtifact.value as IntakeManifest;
    intakeSchemaValid = validateIntake(manifest);
    if (!intakeSchemaValid) {
      issues.push(issue("m3-1-intake-schema-invalid", "/intake-manifest.json", JSON.stringify(validateIntake.errors)));
      artifactAndTargetBindingsValid = false;
    } else {
      for (const document of manifest.documents) {
        try {
          const artifactBytes = readFileSync(safeBundleFile(bundleRoot, document.artifact.relativePath));
          if (sha256(artifactBytes) !== document.artifact.sha256 || artifactBytes.length !== document.artifact.byteLength) {
            artifactAndTargetBindingsValid = false;
            issues.push(issue("m3-1-artifact-binding-invalid", `/documents/${document.documentId}/artifact`, "Artifact bytes do not match the intake hash and length."));
          }
        } catch (error) {
          artifactAndTargetBindingsValid = false;
          issues.push(issue("m3-1-artifact-binding-invalid", `/documents/${document.documentId}/artifact`, error instanceof Error ? error.message : String(error)));
        }
        for (const target of document.targets) {
          const svgRootKey = target.svgRootLocator.mode === "author-id"
            ? `author-id:${target.svgRootLocator.authorId ?? ""}`
            : `structural-path:${target.svgRootLocator.structuralPath ?? ""}`;
          const sourceIdentity = target.targetLocator.mode === "author-id"
            ? `author-id:${target.targetLocator.authorId ?? ""}`
            : `source-signature:${target.targetLocator.sourceSignatureSha256 ?? ""}`;
          let derived = "";
          try { derived = deriveStableTargetId({ artifactSha256: target.artifactSha256, svgRootKey, sourceIdentity, ruleId: target.ruleId }); } catch { /* issue below */ }
          if (target.artifactSha256 !== document.artifact.sha256 || derived !== target.targetId) {
            artifactAndTargetBindingsValid = false;
            issues.push(issue("m3-1-target-binding-invalid", `/documents/${document.documentId}/targets/${target.targetId}`, "Target identity is not bound to the declared artifact bytes, locator and rule."));
          }
        }
      }
      provenanceValid = artifactAndTargetBindingsValid && manifest.documents.every((document) => Boolean(document.provenanceClass && document.rightsBasis));
      privacyValid = artifactAndTargetBindingsValid && manifest.documents.every((document) => Boolean(document.privacyClass));

      const split = readJson(bundleRoot, "split-report.json").value as PersistedSplit;
      const manifestById = new Map(manifest.documents.map((document) => [document.documentId, document]));
      const assignmentIds = new Set(split.assignments?.map((assignment) => assignment.documentId) ?? []);
      const completeAssignments = Array.isArray(split.assignments)
        && split.assignments.length === manifest.documents.length
        && assignmentIds.size === manifest.documents.length
        && manifest.documents.every((document) => assignmentIds.has(document.documentId));
      const exactAssignments = completeAssignments && split.assignments.every((assignment) => {
        const document = manifestById.get(assignment.documentId);
        return document !== undefined
          && assignment.artifactSha256 === document.artifact.sha256
          && assignment.originGroupId === document.groups.originGroupId
          && assignment.duplicateGroupId === document.groups.duplicateGroupId
          && assignment.derivationGroupId === document.groups.derivationGroupId
          && assignment.templateGroupId === document.groups.templateGroupId
          && assignment.versionGroupId === document.groups.versionGroupId;
      });
      splitValid = split.valid === true && Array.isArray(split.issues) && split.issues.length === 0 && exactAssignments && validateStrictSplits(split.assignments).valid;
      if (!splitValid) issues.push(issue("m3-1-split-binding-invalid", "/split-report.json", "Persisted split assignments are incomplete, drifted, or leak an origin/derivation group."));

      const holdoutIds = new Set((split.assignments ?? []).filter((assignment) => assignment.split === "holdout").map((assignment) => assignment.documentId));
      const actualFreeze = readJson(bundleRoot, "freeze-projection.json").value as { projection: Omit<FreezeProjectionInput, "documents"> & { documents: FreezeProjectionInput["documents"] }; freezeSha256: string };
      const expectedFreeze = buildFreezeProjection({
        ...actualFreeze.projection,
        documents: manifest.documents.filter((document) => holdoutIds.has(document.documentId)).map((document) => ({
          documentId: document.documentId,
          artifactSha256: document.artifact.sha256,
          split: "holdout" as const,
          groups: { ...document.groups },
          source: {
            sourceLocator: document.sourceLocator as string,
            sourceCapturedAt: document.sourceCapturedAt,
            sourceCaptureMode: document.sourceCaptureMode,
            firstPartySourceSnapshot: document.firstPartySourceSnapshot,
            provenanceClass: document.provenanceClass as FreezeProjectionInput["documents"][number]["source"]["provenanceClass"],
            provenanceEvidenceSha256: document.provenanceEvidenceSha256 as string,
            rightsBasis: document.rightsBasis as FreezeProjectionInput["documents"][number]["source"]["rightsBasis"],
            rightsEvidenceSha256: document.rightsEvidenceSha256 as string,
            privacyClass: document.privacyClass as FreezeProjectionInput["documents"][number]["source"]["privacyClass"],
            privacyEvidenceSha256: document.privacyEvidenceSha256 as string,
            founderAuthorizationSha256: document.founderAuthorizationSha256 as string | null,
          },
          targets: document.targets.map((target) => ({ targetId: target.targetId, ruleId: target.ruleId })),
        })),
      });
      if (canonicalJson(expectedFreeze) !== canonicalJson(actualFreeze)) {
        splitValid = false;
        issues.push(issue("m3-1-freeze-binding-invalid", "/freeze-projection.json", "Freeze projection does not reproduce from the bound holdout assignments and target IDs."));
      }

      const report = readJson(bundleRoot, "pilot-report.json").value as {
        executionStatus?: string;
        manifestReference?: { artifactId?: string; artifactSha256?: string; artifactContractVersion?: string };
        documentCount?: number;
        originGroupCount?: number;
        annotatorCount?: number;
        claims?: Record<string, unknown>;
        evidenceTrust?: string;
      };
      const reportSchemaValid = validatePilotReport(report);
      const claimsFalse = report.claims !== undefined && Object.values(report.claims).every((value) => value === false);
      const reportBindingsValid = reportSchemaValid
        && report.manifestReference?.artifactId === manifest.manifestId
        && report.manifestReference.artifactSha256 === manifestSha256
        && report.manifestReference.artifactContractVersion === manifest.contractVersion
        && report.documentCount === manifest.documents.length
        && report.originGroupCount === new Set(manifest.documents.map((document) => document.groups.originGroupId)).size
        && report.annotatorCount === 0
        && report.executionStatus === "infrastructure-complete-external-execution-blocked"
        && report.evidenceTrust === "untrusted"
        && claimsFalse
        && manifest.claimEligible === false
        && manifest.captureAttestorTrustValid === false
        && manifest.calibrated === false
        && manifest.documents.every((document) => document.claimEligible === false && document.captureAttestorTrustValid === false && document.calibrated === false);
      if (!reportBindingsValid) issues.push(issue("m3-1-report-binding-invalid", "/pilot-report.json", "Pilot report schema, intake reference, counts, blocked status, or false claims drifted."));
    }
  } catch (error) {
    artifactAndTargetBindingsValid = false;
    issues.push(issue("m3-1-bridge-input-invalid", "/", error instanceof Error ? error.message : String(error)));
  }

  const checks: ReadinessReport["checks"] = {
    schema_valid: false,
    provenance_valid: intakeSchemaValid && provenanceValid,
    privacy_valid: intakeSchemaValid && privacyValid,
    annotation_valid: false,
    split_valid: intakeSchemaValid && artifactAndTargetBindingsValid && splitValid,
    holdout_frozen: false,
    oracle_independent: false,
    renderer_identity_complete: false,
    external_trust_valid: false,
    external_holdout_baseline_valid: false,
    acceptance_plans_valid: false,
    acceptance_reports_valid: false,
    capture_evidence_bytes_valid: false,
    capture_attestor_trust_valid: false,
    // A false-claim M3-1 pilot report may be internally bound, but it is not an M3-0
    // readiness registry. Keep the M3-0 vocabulary fail-closed until materialization.
    registry_state_consistent: false,
  };
  return {
    reportSchemaVersion: 1,
    validatorContractVersion: "m3-0-readiness-v1",
    manifestSha256,
    status: "invalid",
    exitCode: 1,
    checks,
    rules: falseRules(),
    issues: issues.sort((left, right) => `${left.code}:${left.path}`.localeCompare(`${right.code}:${right.path}`, "en")),
  };
}

export function verifyStoredM31ToM30ReadinessBridge(bundleRoot: string): { valid: boolean; issues: string[]; report: ReadinessReport } {
  const report = buildM31ToM30ReadinessBridge(bundleRoot);
  const stored = readFileSync(safeBundleFile(bundleRoot, "m3-0-readiness-bridge.json"));
  const expected = Buffer.from(canonicalJson(report));
  const issues: string[] = [];
  if (!stored.equals(expected)) issues.push("m3-0-readiness-bridge-drift");
  if (report.status !== "invalid" || report.exitCode !== 1) issues.push("m3-0-readiness-bridge-false-pass");
  if (Object.values(report.rules).some((rule) => rule.rule_ready_for_calibration || rule.rule_ready_for_calibrated_claim || rule.capture_attestor_trust_valid)) issues.push("m3-0-readiness-bridge-rule-claim-drift");
  return { valid: issues.length === 0, issues, report };
}
