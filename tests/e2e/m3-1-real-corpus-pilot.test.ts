import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  buildBlindPacket,
  buildBlindContextArtifacts,
  buildFreezeProjection,
  buildPilotReport,
  deriveStableTargetId,
  ingestPublicArtifact,
  validateStrictSplits,
} from "../tools/calibration/m3-1-pilot.ts";
import { createPublicPipelineBundle, verifyPublicPipelineBundle } from "../tools/calibration/m3-1-public-pipeline.ts";

describe("M3-1 public corpus pilot infrastructure", () => {
  it("runs a synthetic untrusted rehearsal end to end while external gates stay false", () => {
    const artifactRoot = mkdtempSync(join(tmpdir(), "breaklint-m3-1-e2e-"));
    writeFileSync(join(artifactRoot, "synthetic-untrusted.svg"), '<svg id="root"><text id="label">Synthetic rehearsal</text></svg>');
    const intake = ingestPublicArtifact({
      artifactRoot,
      artifactPath: "synthetic-untrusted.svg",
      sourceLocator: "source_synthetic_untrusted_0001",
      sourceCapturedAt: "2026-08-23T00:00:00Z",
      sourceCaptureMode: "synthetic-fixture-construction",
      provenanceClass: "synthetic-first-party",
      rightsBasis: "first-party-founder-authorized",
      privacyClass: "synthetic-no-personal-data",
      privacyApproved: true,
      redistributionApproved: true,
      provenanceEvidenceSha256: "a".repeat(64),
      rightsEvidenceSha256: "b".repeat(64),
      privacyEvidenceSha256: "c".repeat(64),
      originGroupId: "origin_group_synthetic_untrusted_0001",
      duplicateGroupId: "duplicate_group_synthetic_untrusted_0001",
      derivationGroupId: "derivation_group_synthetic_untrusted_0001",
      templateGroupId: "template_group_synthetic_untrusted_0001",
      versionGroupId: "version_group_synthetic_untrusted_0001",
    });
    const targetIdentity = { artifactSha256: intake.artifactSha256, svgRootKey: "author-id:root", sourceIdentity: "author-id:label", ruleId: "svg/text-clipped" as const };
    const targetId = deriveStableTargetId(targetIdentity);
    const blindTarget = { targetId, documentId: intake.documentId, ...targetIdentity, structuralPath: "/html[0]/body[0]/svg[0]/text[0]" };
    const blindContexts = buildBlindContextArtifacts(readFileSync(join(artifactRoot, "synthetic-untrusted.svg")), "image/svg+xml", [blindTarget]);
    const packet = buildBlindPacket({
      packetId: "blind_packet_synthetic_untrusted_0001",
      orderSeed: "order_seed_synthetic_untrusted_0001",
      targets: [blindTarget],
      contextsByTargetId: blindContexts.contextsByTargetId,
    });
    const split = validateStrictSplits([{ documentId: intake.documentId, split: "holdout", artifactSha256: intake.artifactSha256, originGroupId: intake.originGroupId, derivationGroupId: intake.derivationGroupId }]);
    const freeze = buildFreezeProjection({
      contractVersion: "m3-1-freeze-projection-v1",
      holdoutId: "holdout_synthetic_untrusted_0001",
      purpose: "holdout-evaluation-preregistration",
      createdAt: "2026-08-23T00:00:00Z",
      frozenAt: "2026-08-23T00:00:00Z",
      sequence: 1,
      previousFreezeSha256: null,
      blindPacketSha256: packet.packetSha256,
      blindPacketBundle: { bundleId: "blind_bundle_synthetic_untrusted_0001", bundleIndexSha256: "f".repeat(64), indexedFileCount: 2 },
      samplingPlanSha256: "a".repeat(64),
      analysisPlanSha256: "b".repeat(64),
      guidelineSha256ByRule: { "svg/text-clipped": "c".repeat(64), "svg/text-ink-collision": "d".repeat(64), "svg/text-overflows-viewport": "e".repeat(64) },
      renderer: { status: "blocked-missing-renderer-asset-freeze", rendererFreezeSha256: null, assetManifestSha256: null },
      documents: [{
        documentId: intake.documentId,
        artifactSha256: intake.artifactSha256,
        split: "holdout",
        groups: { originGroupId: intake.originGroupId, duplicateGroupId: intake.duplicateGroupId, derivationGroupId: intake.derivationGroupId, templateGroupId: intake.templateGroupId, versionGroupId: intake.versionGroupId },
        source: { sourceLocator: intake.sourceLocator, sourceCapturedAt: intake.sourceCapturedAt, sourceCaptureMode: intake.sourceCaptureMode, firstPartySourceSnapshot: intake.firstPartySourceSnapshot, provenanceClass: intake.provenanceClass, provenanceEvidenceSha256: intake.provenanceEvidenceSha256, rightsBasis: intake.rightsBasis, rightsEvidenceSha256: intake.rightsEvidenceSha256, privacyClass: intake.privacyClass, privacyEvidenceSha256: intake.privacyEvidenceSha256, founderAuthorizationSha256: intake.founderAuthorizationSha256 },
        targets: [{ targetId, ruleId: "svg/text-clipped" }],
      }],
    });
    const report = buildPilotReport({ pilotId: "pilot_synthetic_untrusted_0001", createdAt: "2026-08-23T00:00:00.000Z", manifestReference: { artifactId: "intake_manifest_synthetic_untrusted_0001", artifactSha256: "a".repeat(64), artifactContractVersion: "m3-1-public-intake-manifest-v1" }, samplingPlanId: "sampling_synthetic_untrusted_0001", samplingPlanSha256: "b".repeat(64), artifactCount: 1, realDocumentCount: 0, originGroupCount: 1, sourceGateValid: true, annotationGateValid: false, splitGateValid: split.valid, externalFreezeValid: false, externalTrustValid: false, captureEvidenceValid: false });

    assert.equal(packet.targets.length, 1);
    assert.match(freeze.freezeSha256, /^[a-f0-9]{64}$/u);
    assert.equal(split.valid, true);
    assert.equal(report.executionStatus, "infrastructure-complete-external-execution-blocked");
    assert.equal(report.limitations.length, 5);
    assert.equal(report.claims.ruleReadyForCalibratedClaim, false);
    assert.equal(report.claims.calibrated, false);
  });

  it("atomically creates and independently re-verifies a deterministic local public bundle", async () => {
    const approvedOutputRoot = mkdtempSync(join(tmpdir(), "breaklint-m3-1-pipeline-output-"));
    const sourceRoot = mkdtempSync(join(tmpdir(), "breaklint-m3-1-pipeline-source-"));
    const sourceRelativePath = "synthetic.svg";
    const sourcePath = join(sourceRoot, sourceRelativePath);
    writeFileSync(sourcePath, '<svg id="root" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" inkscape:version="1.2" data-neutral="true"><!-- Created with Inkscape --><metadata><title>source editor metadata</title></metadata><text id="label">Pipeline rehearsal</text></svg>');
    const sourceBytes = readFileSync(sourcePath);
    const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
    const evidenceBytes = Buffer.from('{"contractVersion":"synthetic-source-evidence-v1","status":"untrusted-fixture"}\n');
    writeFileSync(join(sourceRoot, "source-evidence.json"), evidenceBytes);
    const evidenceSha256 = createHash("sha256").update(evidenceBytes).digest("hex");
    const spec = {
      contractVersion: "m3-1-public-pipeline-spec-v1" as const,
      pilotId: "public_pipeline_0001",
      createdAt: "2026-08-23T00:00:00.000Z",
      approvedOutputRoot,
      outputRoot: join(approvedOutputRoot, "bundle"),
      annotationOutputRoot: join(approvedOutputRoot, "annotation-bundle"),
      exactHttpsAllowlist: [],
      orderSeed: "order_seed_public_pipeline_0001",
      holdoutId: "holdout_public_pipeline_0001",
      samplingPlanId: "sampling_public_pipeline_0001",
      samplingPlanSha256: "d".repeat(64),
      analysisPlanSha256: "e".repeat(64),
      guidelineSha256ByRule: { "svg/text-clipped": "a".repeat(64), "svg/text-ink-collision": "b".repeat(64), "svg/text-overflows-viewport": "c".repeat(64) },
      sources: [{
        source: { kind: "local" as const, sourceRoot, sourceRelativePath },
        outputRelativePath: "artifacts/synthetic.svg",
        expectedSha256: sourceSha256,
        expectedByteLength: sourceBytes.length,
        mediaType: "image/svg+xml" as const,
        split: "holdout" as const,
        ruleIds: ["svg/text-clipped", "svg/text-ink-collision", "svg/text-overflows-viewport"] as const,
        sourceLocator: "source_synthetic_pipeline_0001",
        sourceCapturedAt: "2026-08-23T00:00:00Z",
        sourceCaptureMode: "synthetic-fixture-construction" as const,
        provenanceClass: "synthetic-first-party" as const,
        rightsBasis: "first-party-founder-authorized" as const,
        privacyClass: "synthetic-no-personal-data" as const,
        privacyApproved: true as const,
        redistributionApproved: true as const,
        provenanceEvidenceSha256: evidenceSha256,
        rightsEvidenceSha256: evidenceSha256,
        privacyEvidenceSha256: evidenceSha256,
        originGroupId: "origin_group_synthetic_pipeline_0001",
        duplicateGroupId: "duplicate_group_synthetic_pipeline_0001",
        derivationGroupId: "derivation_group_synthetic_pipeline_0001",
        templateGroupId: "template_group_synthetic_pipeline_0001",
        versionGroupId: "version_group_synthetic_pipeline_0001",
      }],
      evidence: [{ evidenceRoot: sourceRoot, evidenceRelativePath: "source-evidence.json", outputRelativePath: "source-evidence/synthetic-source-evidence.json", expectedSha256: evidenceSha256, expectedByteLength: evidenceBytes.length }],
    };
    const created = await createPublicPipelineBundle(spec as never);
    assert.equal(created.reportStatus, "infrastructure-complete-external-execution-blocked");
    const verified = verifyPublicPipelineBundle(spec as never);
    assert.deepEqual(verified, { valid: true, issues: [], bundleIndexSha256: created.bundleIndexSha256, annotationBundleIndexSha256: created.annotationBundleIndexSha256 });
    assert.equal(existsSync(join(spec.outputRoot, "blind-packet.json")), false);
    assert.equal(existsSync(join(spec.outputRoot, "blind-context")), false);
    assert.equal(existsSync(join(spec.annotationOutputRoot, "intake-manifest.json")), false);
    assert.equal(existsSync(join(spec.annotationOutputRoot, "split-report.json")), false);
    const persistedSplit = JSON.parse(readFileSync(join(spec.outputRoot, "split-report.json"), "utf8")) as {
      valid: boolean;
      assignments: Array<{ documentId: string; split: string; originGroupId: string }>;
    };
    assert.equal(persistedSplit.valid, true);
    assert.deepEqual(persistedSplit.assignments, [{
      documentId: `doc_${sourceSha256.slice(0, 32)}`,
      split: "holdout",
      artifactSha256: sourceSha256,
      originGroupId: "origin_group_synthetic_pipeline_0001",
      duplicateGroupId: "duplicate_group_synthetic_pipeline_0001",
      derivationGroupId: "derivation_group_synthetic_pipeline_0001",
      templateGroupId: "template_group_synthetic_pipeline_0001",
      versionGroupId: "version_group_synthetic_pipeline_0001",
    }]);
    const specPath = join(approvedOutputRoot, "pipeline-spec.json");
    writeFileSync(specPath, JSON.stringify(spec));
    const cliOutput = execFileSync(process.execPath, ["--experimental-strip-types", "tests/tools/calibration/m3-1-pilot-cli.ts", "pipeline-verify", specPath], { cwd: new URL("../../", import.meta.url), encoding: "utf8" });
    assert.equal((JSON.parse(cliOutput) as { valid: boolean }).valid, true);

    const successorSpec = {
      ...spec,
      contractVersion: "m3-1-public-pipeline-spec-v2" as const,
      pilotId: "public_pipeline_v2_0001",
      outputRoot: join(approvedOutputRoot, "bundle-v2"),
      annotationOutputRoot: join(approvedOutputRoot, "annotation-bundle-v2"),
      previousFreezeSha256: "e9f880a8489e835aeeed89f1d387a8ba6d3be184d6b1297f5711138b95b42de9",
      sources: spec.sources.map((source) => ({ ...source, ruleIds: [...source.ruleIds] })),
    };
    const successorCreated = await createPublicPipelineBundle(successorSpec);
    assert.deepEqual(verifyPublicPipelineBundle(successorSpec), { valid: true, issues: [], bundleIndexSha256: successorCreated.bundleIndexSha256, annotationBundleIndexSha256: successorCreated.annotationBundleIndexSha256 });
    const successorFreeze = JSON.parse(readFileSync(join(successorSpec.outputRoot, "freeze-projection.json"), "utf8")) as { projection: { sequence: number; previousFreezeSha256: string }; freezeSha256: string };
    assert.equal(successorFreeze.projection.sequence, 2);
    assert.equal(successorFreeze.projection.previousFreezeSha256, successorSpec.previousFreezeSha256);
    assert.notEqual(successorFreeze.freezeSha256, successorSpec.previousFreezeSha256);
    const successorPacket = JSON.parse(readFileSync(join(successorSpec.annotationOutputRoot, "blind-packet.json"), "utf8")) as { contractVersion: string; targetCount: number; targets: unknown[] };
    assert.equal(successorPacket.contractVersion, "m3-1-blind-packet-v2");
    assert.equal(successorPacket.targetCount, successorPacket.targets.length);
    const successorContextPath = (JSON.parse(readFileSync(join(successorSpec.annotationOutputRoot, "bundle-index.json"), "utf8")) as { files: Array<{ path: string }> }).files.find((entry) => entry.path.startsWith("blind-context/"))!.path;
    const successorContext = readFileSync(join(successorSpec.annotationOutputRoot, successorContextPath), "utf8");
    assert.equal(/(?:inkscape|metadata|Created with|id="label")/iu.test(successorContext), false);

    const evidenceBundlePath = join(spec.outputRoot, "source-evidence/synthetic-source-evidence.json");
    const evidenceIndexPath = join(spec.outputRoot, "bundle-index.json");
    const driftedEvidenceBytes = Buffer.from('{"coordinated":"bundled evidence drift"}\n');
    writeFileSync(evidenceBundlePath, driftedEvidenceBytes);
    const coordinatedEvidenceIndex = JSON.parse(readFileSync(evidenceIndexPath, "utf8")) as { files: Array<{ path: string; sha256: string; byteLength: number }> };
    const evidenceEntry = coordinatedEvidenceIndex.files.find((entry) => entry.path === "source-evidence/synthetic-source-evidence.json")!;
    evidenceEntry.sha256 = createHash("sha256").update(driftedEvidenceBytes).digest("hex");
    evidenceEntry.byteLength = driftedEvidenceBytes.length;
    writeFileSync(evidenceIndexPath, JSON.stringify(coordinatedEvidenceIndex));
    const coordinatedEvidenceRehash = verifyPublicPipelineBundle(spec as never);
    assert.equal(coordinatedEvidenceRehash.valid, false);
    assert.ok(coordinatedEvidenceRehash.issues.includes("spec-evidence-byte-drift:source-evidence/synthetic-source-evidence.json"));
    writeFileSync(evidenceBundlePath, evidenceBytes);
    evidenceEntry.sha256 = evidenceSha256;
    evidenceEntry.byteLength = evidenceBytes.length;
    writeFileSync(evidenceIndexPath, JSON.stringify(coordinatedEvidenceIndex));

    writeFileSync(join(spec.outputRoot, "artifacts/synthetic.svg"), "tampered");
    const tampered = verifyPublicPipelineBundle(spec as never);
    assert.equal(tampered.valid, false);
    assert.ok(tampered.issues.some((issue) => issue.startsWith("evidence-bundle-file-drift:") || issue.startsWith("spec-source-reconstruction-failed:")));
    const indexPath = join(spec.outputRoot, "bundle-index.json");
    const coordinatedIndex = JSON.parse(readFileSync(indexPath, "utf8")) as { files: Array<{ path: string; sha256: string; byteLength: number }> };
    const coordinatedEntry = coordinatedIndex.files.find((entry) => entry.path === "artifacts/synthetic.svg")!;
    coordinatedEntry.sha256 = createHash("sha256").update("tampered").digest("hex");
    coordinatedEntry.byteLength = Buffer.byteLength("tampered");
    writeFileSync(indexPath, JSON.stringify(coordinatedIndex));
    const coordinatedRehash = verifyPublicPipelineBundle(spec as never);
    assert.equal(coordinatedRehash.valid, false);
    assert.ok(coordinatedRehash.issues.some((issue) => issue.startsWith("spec-source-reconstruction-failed:source_synthetic_pipeline_0001:")));

    writeFileSync(join(sourceRoot, "source-evidence.json"), '{"coordinated":"evidence drift"}\n');
    const evidenceDrift = verifyPublicPipelineBundle(spec as never);
    assert.equal(evidenceDrift.valid, false);
    assert.ok(evidenceDrift.issues.some((issue) => issue.startsWith("spec-evidence-reconstruction-failed:source-evidence/synthetic-source-evidence.json:")));
  });
});
