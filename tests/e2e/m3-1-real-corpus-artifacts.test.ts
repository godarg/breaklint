import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";

import {
  buildBlindContextArtifactsV2,
  buildBlindPacketV2,
  buildFreezeProjection,
  canonicalJson,
  deriveStableTargetId,
  enumerateSvgTextTargets,
  validateStrictSplits,
  verifyBlindPacketV2Custodial,
  verifyBlindPacketV2Public,
  verifySanitizedBlindSvgContextV2,
  type RuleId,
} from "../tools/calibration/m3-1-pilot.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const BUNDLE = join(ROOT, "corpus/public/m3-1-pilot-v1");
const ANNOTATION_BUNDLE = join(ROOT, "corpus/public/m3-1-annotation-packet-v1");
const BUNDLE_V2 = join(ROOT, "corpus/public/m3-1-pilot-v2");
const ANNOTATION_BUNDLE_V2 = join(ROOT, "corpus/public/m3-1-annotation-packet-v2");
const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");
const readJson = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

function validateSchema(schemaName: string, data: unknown): void {
  const schema = readJson(join(ROOT, `schemas/calibration/${schemaName}.schema.json`));
  const validate = new Ajv2020({ allErrors: true, strict: true, formats: { "date-time": true } }).compile(schema);
  assert.equal(validate(data), true, JSON.stringify(validate.errors));
}

describe("M3-1 frozen real public corpus artifacts", () => {
  it("independently reconstructs the sanitized packet-v2 target set and neutral order", () => {
    const evidenceIndex = readJson(join(BUNDLE_V2, "bundle-index.json")) as { contractVersion: string; files: Array<{ path: string; sha256: string; byteLength: number }> };
    const annotationIndex = readJson(join(ANNOTATION_BUNDLE_V2, "bundle-index.json")) as { contractVersion: string; files: Array<{ path: string; sha256: string; byteLength: number }> };
    assert.equal(evidenceIndex.contractVersion, "m3-1-public-pipeline-bundle-index-v2");
    assert.equal(annotationIndex.contractVersion, "m3-1-blind-annotation-bundle-index-v2");
    for (const [root, index] of [[BUNDLE_V2, evidenceIndex], [ANNOTATION_BUNDLE_V2, annotationIndex]] as const) {
      for (const entry of index.files) {
        const bytes = readFileSync(join(root, entry.path));
        assert.equal(bytes.length, entry.byteLength, entry.path);
        assert.equal(sha256(bytes), entry.sha256, entry.path);
      }
    }

    const manifest = readJson(join(BUNDLE_V2, "intake-manifest.json")) as {
      documents: Array<{ documentId: string; artifact: { relativePath: string; mediaType: "text/html" | "image/svg+xml" }; targets: Array<{ ruleId: RuleId }> }>;
      calibrated: boolean;
    };
    const targets: Parameters<typeof buildBlindPacketV2>[0]["targets"] = [];
    const contextsByTargetId: Parameters<typeof buildBlindPacketV2>[0]["contextsByTargetId"] = {};
    const artifacts = new Map<string, Buffer>();
    for (const document of manifest.documents) {
      const source = readFileSync(join(BUNDLE_V2, document.artifact.relativePath));
      const ruleIds = [...new Set(document.targets.map((target) => target.ruleId))].sort();
      const documentTargets = enumerateSvgTextTargets(source, ruleIds).map((target) => ({ ...target, documentId: document.documentId }));
      const contexts = buildBlindContextArtifactsV2(source, document.artifact.mediaType, documentTargets);
      targets.push(...documentTargets);
      Object.assign(contextsByTargetId, contexts.contextsByTargetId);
      for (const artifact of contexts.artifacts) artifacts.set(artifact.path, artifact.bytes);
    }
    const packet = readJson(join(ANNOTATION_BUNDLE_V2, "blind-packet.json")) as unknown as ReturnType<typeof buildBlindPacketV2>;
    validateSchema("blind-packet-v2", packet);
    assert.deepEqual(verifyBlindPacketV2Custodial({
      packet,
      packetId: "blind_packet_m3_1_public_pilot_v2",
      orderSeed: "order_seed_m3_1_public_pilot_v2_20260824",
      targets,
      contextsByTargetId,
      artifactsByPath: artifacts,
    }), { valid: true, issues: [] });

    const reorderedTargets = [...packet.targets].reverse().map((target, index) => ({ ...target, neutralOrder: index + 1 }));
    const { packetSha256: _storedPacketSha256, ...reorderedWithoutHash } = {
      ...packet,
      orderContract: { ...packet.orderContract, orderedBlindTargetIdsSha256: sha256(canonicalJson(reorderedTargets.map((target) => target.blindTargetId))) },
      targets: reorderedTargets,
    };
    const coherentlyRehashedReorder = { ...reorderedWithoutHash, packetSha256: sha256(canonicalJson(reorderedWithoutHash)) };
    assert.deepEqual(verifyBlindPacketV2Public(coherentlyRehashedReorder, artifacts), { valid: true, issues: [] });
    assert.equal(verifyBlindPacketV2Custodial({ packet: coherentlyRehashedReorder, packetId: packet.packetId, orderSeed: "order_seed_m3_1_public_pilot_v2_20260824", targets, contextsByTargetId, artifactsByPath: artifacts }).issues.includes("packet-custodial-reconstruction-mismatch"), true);

    const firstContext = packet.targets[0]!.context;
    const injectedBytes = Buffer.from(artifacts.get(firstContext.artifactPath)!.toString("utf8").replace("</svg>", "<text>breaklint result: finding</text></svg>"));
    const injectedSha256 = sha256(injectedBytes);
    const injectedPath = `blind-context/context_${injectedSha256.slice(0, 24)}.svg`;
    const injectedTargets = packet.targets.map((target) => target.context.artifactPath === firstContext.artifactPath ? { ...target, context: { ...target.context, artifactPath: injectedPath, artifactSha256: injectedSha256, byteLength: injectedBytes.length } } : target);
    const { packetSha256: _originalPacketSha256, ...injectedWithoutHash } = { ...packet, targets: injectedTargets };
    const injectedPacket = { ...injectedWithoutHash, packetSha256: sha256(canonicalJson(injectedWithoutHash)) };
    const injectedArtifacts = new Map(artifacts);
    injectedArtifacts.delete(firstContext.artifactPath);
    injectedArtifacts.set(injectedPath, injectedBytes);
    assert.equal(verifyBlindPacketV2Public(injectedPacket, injectedArtifacts).issues.some((issue) => issue.startsWith("context-content-invalid:")), true);
    assert.equal(targets.length, 192);
    assert.equal(manifest.calibrated, false);
    for (const [path, expected] of artifacts) {
      const stored = readFileSync(join(ANNOTATION_BUNDLE_V2, path));
      assert.equal(stored.equals(expected), true, path);
      assert.deepEqual(verifySanitizedBlindSvgContextV2(stored), { valid: true, issues: [] });
      assert.equal(/(?:sodipodi:docname|<metadata\b|xmlns:(?:cc|dc|inkscape|rdf|sodipodi)|inkscape:|sodipodi:|Created with Inkscape|\/Users\/)/iu.test(stored.toString("utf8")), false, path);
    }

    const freeze = readJson(join(BUNDLE_V2, "freeze-projection.json")) as ReturnType<typeof buildFreezeProjection>;
    assert.equal(freeze.projection.sequence, 2);
    assert.equal(freeze.projection.previousFreezeSha256, "e9f880a8489e835aeeed89f1d387a8ba6d3be184d6b1297f5711138b95b42de9");
    assert.equal(freeze.projection.blindPacketSha256, (packet as { packetSha256: string }).packetSha256);
    assert.equal(freeze.projection.blindPacketBundle.bundleIndexSha256, sha256(readFileSync(join(ANNOTATION_BUNDLE_V2, "bundle-index.json"))));
    assert.deepEqual(buildFreezeProjection(freeze.projection), freeze);
  });

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
