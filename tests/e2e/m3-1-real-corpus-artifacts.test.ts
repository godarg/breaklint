import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";

import {
  buildFreezeProjection,
  deriveStableTargetId,
  validateStrictSplits,
  type RuleId,
} from "../tools/calibration/m3-1-pilot.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const BUNDLE = join(ROOT, "corpus/public/m3-1-pilot-v1");
const ANNOTATION_BUNDLE = join(ROOT, "corpus/public/m3-1-annotation-packet-v1");
const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");
const readJson = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

function validateSchema(schemaName: string, data: unknown): void {
  const schema = readJson(join(ROOT, `schemas/calibration/${schemaName}.schema.json`));
  const validate = new Ajv2020({ allErrors: true, strict: true, formats: { "date-time": true } }).compile(schema);
  assert.equal(validate(data), true, JSON.stringify(validate.errors));
}

describe("M3-1 frozen real public corpus artifacts", () => {
  it("re-hashes every indexed byte and validates the public contracts", () => {
    const index = readJson(join(BUNDLE, "bundle-index.json")) as {
      contractVersion: string;
      files: Array<{ path: string; sha256: string; byteLength: number }>;
    };
    assert.equal(index.contractVersion, "m3-1-public-pipeline-bundle-index-v1");
    assert.equal(index.files.length, 12);
    for (const entry of index.files) {
      const bytes = readFileSync(join(BUNDLE, entry.path));
      assert.equal(bytes.length, entry.byteLength, entry.path);
      assert.equal(sha256(bytes), entry.sha256, entry.path);
    }

    const manifest = readJson(join(BUNDLE, "intake-manifest.json")) as {
      documents: Array<{
        documentId: string;
        sourceLocator: string;
        sourceCapturedAt: string;
        sourceCaptureMode: "https-byte-capture" | "founder-authorized-source-snapshot" | "synthetic-fixture-construction";
        firstPartySourceSnapshot: { commitSha: string; blobSha1: string; commitTime: string } | null;
        provenanceClass: "public-first-party" | "public-redistributable" | "synthetic-first-party";
        provenanceEvidenceSha256: string;
        rightsBasis: "first-party-founder-authorized" | "public-domain" | "cc0-1.0";
        rightsEvidenceSha256: string;
        privacyClass: "synthetic-no-personal-data" | "reviewed-no-personal-data" | "reviewed-public-business-identity";
        privacyEvidenceSha256: string;
        founderAuthorizationSha256: string | null;
        artifact: { sha256: string; byteLength: number; relativePath: string };
        groups: { originGroupId: string; duplicateGroupId: string; derivationGroupId: string; templateGroupId: string; versionGroupId: string };
        targets: Array<{
          targetId: string;
          artifactSha256: string;
          ruleId: RuleId;
          svgRootLocator: { mode: string; authorId?: string; structuralPath?: string; sourceSignatureSha256?: string };
          targetLocator: { mode: string; authorId?: string; structuralPath?: string; sourceSignatureSha256?: string };
        }>;
      }>;
      claimEligible: boolean;
      captureAttestorTrustValid: boolean;
      calibrated: boolean;
    };
    validateSchema("public-intake-manifest-v1", manifest);
    assert.equal(manifest.documents.length, 3);
    assert.equal(new Set(manifest.documents.map((document) => document.groups.originGroupId)).size, 3);
    assert.equal(manifest.documents.reduce((sum, document) => sum + document.targets.length, 0), 192);
    assert.deepEqual(manifest.documents.map((document) => document.sourceLocator).sort(), [
      "source_dargel_kleingewerbe_0001",
      "source_wikimedia_carbon_cycle_0001",
      "source_wikimedia_grua_maquina_0001",
    ]);
    assert.equal(manifest.claimEligible, false);
    assert.equal(manifest.captureAttestorTrustValid, false);
    assert.equal(manifest.calibrated, false);

    for (const document of manifest.documents) {
      const bytes = readFileSync(join(BUNDLE, document.artifact.relativePath));
      assert.equal(sha256(bytes), document.artifact.sha256);
      assert.equal(bytes.length, document.artifact.byteLength);
      for (const target of document.targets) {
        const svgRootKey = target.svgRootLocator.mode === "author-id"
          ? `author-id:${target.svgRootLocator.authorId}`
          : `structural-path:${target.svgRootLocator.structuralPath}`;
        const sourceIdentity = target.targetLocator.mode === "author-id"
          ? `author-id:${target.targetLocator.authorId}`
          : `source-signature:${target.targetLocator.sourceSignatureSha256}`;
        assert.equal(deriveStableTargetId({ artifactSha256: target.artifactSha256, svgRootKey, sourceIdentity, ruleId: target.ruleId }), target.targetId);
      }
    }

    assert.equal(index.files.some((entry) => entry.path === "blind-packet.json" || entry.path.startsWith("blind-context/")), false);
    assert.equal(index.files.filter((entry) => entry.path.startsWith("source-evidence/")).length, 4);
    const annotationIndex = readJson(join(ANNOTATION_BUNDLE, "bundle-index.json")) as { contractVersion: string; files: Array<{ path: string; sha256: string; byteLength: number }> };
    assert.equal(annotationIndex.contractVersion, "m3-1-blind-annotation-bundle-index-v1");
    assert.equal(annotationIndex.files.length, 5);
    assert.equal(annotationIndex.files.some((entry) => entry.path.includes("manifest") || entry.path.includes("split") || entry.path.startsWith("documents/")), false);
    for (const entry of annotationIndex.files) {
      const bytes = readFileSync(join(ANNOTATION_BUNDLE, entry.path));
      assert.equal(bytes.length, entry.byteLength, entry.path);
      assert.equal(sha256(bytes), entry.sha256, entry.path);
    }
    const packet = readJson(join(ANNOTATION_BUNDLE, "blind-packet.json")) as {
      humanExecutable: boolean;
      targets: Array<{ context: { artifactPath: string; artifactSha256: string } }>;
    };
    validateSchema("blind-packet-v1", packet);
    assert.equal(packet.humanExecutable, true);
    assert.equal(packet.targets.length, 192);
    const encodedPacket = JSON.stringify(packet);
    assert.equal(encodedPacket.includes('"split"'), false);
    for (const document of manifest.documents) {
      assert.equal(encodedPacket.includes(document.documentId), false);
      assert.equal(encodedPacket.includes(document.sourceLocator), false);
      assert.equal(encodedPacket.includes(document.artifact.sha256), false);
    }
    const sourceHashes = new Set(manifest.documents.map((document) => document.artifact.sha256));
    const contextBindings = new Map(packet.targets.map((target) => [target.context.artifactPath, target.context.artifactSha256]));
    assert.equal(contextBindings.size, 4);
    for (const [path, digest] of contextBindings) {
      assert.equal(sha256(readFileSync(join(ANNOTATION_BUNDLE, path))), digest);
      assert.equal(sourceHashes.has(digest), false, `blind context ${path} must not expose a source artifact hash`);
    }
  });

  it("persists an origin-strict split and a holdout-only freeze without outcomes", () => {
    const split = readJson(join(BUNDLE, "split-report.json")) as {
      valid: boolean;
      issues: unknown[];
      assignments: Array<{
        documentId: string;
        split: "development" | "tuning" | "holdout";
        artifactSha256: string;
        originGroupId: string;
        duplicateGroupId: string;
        derivationGroupId: string;
        templateGroupId: string;
        versionGroupId: string;
      }>;
    };
    assert.equal(split.valid, true);
    assert.deepEqual(split.issues, []);
    assert.deepEqual(split.assignments.map((entry) => entry.split).sort(), ["development", "holdout", "tuning"]);
    assert.equal(validateStrictSplits(split.assignments).valid, true);

    const manifest = readJson(join(BUNDLE, "intake-manifest.json")) as {
      documents: Array<{ documentId: string; artifact: { sha256: string }; sourceLocator: string; sourceCapturedAt: string; sourceCaptureMode: "https-byte-capture" | "founder-authorized-source-snapshot" | "synthetic-fixture-construction"; firstPartySourceSnapshot: { commitSha: string; blobSha1: string; commitTime: string } | null; provenanceClass: "public-first-party" | "public-redistributable" | "synthetic-first-party"; provenanceEvidenceSha256: string; rightsBasis: "first-party-founder-authorized" | "public-domain" | "cc0-1.0"; rightsEvidenceSha256: string; privacyClass: "synthetic-no-personal-data" | "reviewed-no-personal-data" | "reviewed-public-business-identity"; privacyEvidenceSha256: string; founderAuthorizationSha256: string | null; groups: { originGroupId: string; duplicateGroupId: string; derivationGroupId: string; templateGroupId: string; versionGroupId: string }; targets: Array<{ targetId: string; ruleId: RuleId }> }>;
    };
    const holdoutIds = new Set(split.assignments.filter((entry) => entry.split === "holdout").map((entry) => entry.documentId));
    const storedFreeze = readJson(join(BUNDLE, "freeze-projection.json")) as ReturnType<typeof buildFreezeProjection>;
    const annotationIndexBytes = readFileSync(join(ANNOTATION_BUNDLE, "bundle-index.json"));
    assert.equal(storedFreeze.projection.blindPacketBundle.bundleIndexSha256, sha256(annotationIndexBytes));
    assert.equal(storedFreeze.projection.blindPacketBundle.indexedFileCount, 5);
    const expectedFreeze = buildFreezeProjection({
      ...storedFreeze.projection,
      documents: manifest.documents
        .filter((document) => holdoutIds.has(document.documentId))
        .map((document) => ({ documentId: document.documentId, artifactSha256: document.artifact.sha256, split: "holdout" as const, groups: document.groups, source: { sourceLocator: document.sourceLocator, sourceCapturedAt: document.sourceCapturedAt, sourceCaptureMode: document.sourceCaptureMode, firstPartySourceSnapshot: document.firstPartySourceSnapshot, provenanceClass: document.provenanceClass, provenanceEvidenceSha256: document.provenanceEvidenceSha256, rightsBasis: document.rightsBasis, rightsEvidenceSha256: document.rightsEvidenceSha256, privacyClass: document.privacyClass, privacyEvidenceSha256: document.privacyEvidenceSha256, founderAuthorizationSha256: document.founderAuthorizationSha256 }, targets: document.targets.map((target) => ({ targetId: target.targetId, ruleId: target.ruleId })) })),
    });
    assert.deepEqual(storedFreeze, expectedFreeze);
    assert.equal(expectedFreeze.projection.documents.length, 1);
    assert.equal(expectedFreeze.projection.documents[0]!.targets.length, 45);

    const report = readJson(join(BUNDLE, "pilot-report.json")) as {
      executionStatus: string;
      documentCount: number;
      originGroupCount: number;
      annotatorCount: number;
      adjudicatorCount: number;
      claims: Record<string, boolean>;
    };
    validateSchema("m3-1-pilot-report-v1", report);
    assert.equal(report.executionStatus, "infrastructure-complete-external-execution-blocked");
    assert.equal(report.documentCount, 3);
    assert.equal(report.originGroupCount, 3);
    assert.equal(report.annotatorCount, 0);
    assert.equal(report.adjudicatorCount, 0);
    assert.equal(Object.values(report.claims).every((value) => value === false), true);
  });
});
