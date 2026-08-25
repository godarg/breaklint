import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
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

describe("M3-1 public corpus pilot infrastructure", () => {
  it("runs an in-memory synthetic rehearsal while every external gate stays false", () => {
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

  it("has no executable legacy bundle create or verify CLI", () => {
    assert.equal(
      existsSync(new URL("../tools/calibration/m3-1-public-pipeline.ts", import.meta.url)),
      false,
      "the generic legacy SVG bundle writer must not be reintroduced",
    );
    const root = mkdtempSync(join(tmpdir(), "breaklint-retired-pipeline-cli-"));
    const inputPath = join(root, "input.json");
    writeFileSync(inputPath, "{}\n");
    for (const [mode, issue] of [["pipeline-create", "legacy-svg-pipeline-create-retired"], ["pipeline-verify", "legacy-svg-pipeline-verify-retired"]] as const) {
      const run = spawnSync(process.execPath, ["--experimental-strip-types", "tests/tools/calibration/m3-1-pilot-cli.ts", mode, inputPath], { cwd: new URL("../../", import.meta.url), encoding: "utf8" });
      assert.equal(run.status, 2, mode);
      assert.match(run.stderr, new RegExp(issue, "u"), mode);
      assert.equal(run.stdout, "", mode);
    }
  });
});
