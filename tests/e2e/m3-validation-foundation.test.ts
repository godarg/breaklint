import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { CLIP_FIXTURES } from "../fixtures/svg-validation/fixtures.ts";
import { NORMATIVE_CLIP_FIXTURE_IDS_V1 } from "../fixtures/svg-validation/contract-v1.ts";
import { runSvgValidationLab } from "../tools/calibration/svg-validation-lab.ts";

describe("M3-0 SVG Validation Lab through the real renderer", () => {
  it("reproduces all normative fixture invariants without making a calibrated claim", async () => {
    const report = await runSvgValidationLab();
    assert.equal(report.status, "pass");
    assert.equal(report.rendererIdentityComplete, true);
    assert.deepEqual(
      report.clipFixtures.map((entry) => (entry as { fixtureId: string }).fixtureId),
      NORMATIVE_CLIP_FIXTURE_IDS_V1,
      "the exact seven-fixture contract must not shrink or reorder silently",
    );
    assert.equal(report.clipFixtures.length, 7);
    for (const id of [
      "product-default-clip-0.05",
      "product-default-collision-8",
      "product-default-viewport-0",
      "G1-historical-selector-zero",
      "G1-target-specific-positive",
      "V-shared-mask-dilution",
      "V-target-specific-positive",
      "G1_textInGruppe-authored-clip-boundary",
      "G2_textInVerschachtelterGruppe-authored-clip-boundary",
      "G2_textInVerschachtelterGruppe-application-transform",
      "V_verduennung-authored-clip-boundary",
      "collision-bbox-negative-control",
      "collision-grazing-corner-fixed-grid-counterexample",
      "collision_pixel_boundary_7-exact-device-pixels",
      "collision_pixel_boundary_8-exact-device-pixels",
      "renderer-identity-complete",
    ]) {
      assert.equal(report.checks.find((check) => check.id === id)?.passed, true, `${id} did not pass`);
    }
    assert.equal(
      (report.grazingSamplingCounterexample as { renderObservation: { samples4px: number } }).renderObservation.samples4px,
      0,
    );
    assert.ok(
      (report.grazingSamplingCounterexample as { renderObservation: { samples025px: number } }).renderObservation.samples025px > 0,
    );
    assert.equal(report.oracleContract.productionOutputsUsedForGroundTruth, false);
    const renderer = report.renderer as {
      rendererFreezeId: string;
      rendererContentHash: string;
      sourceIdentity: { mode: "clean-commit"; commit: string } | { mode: "dirty-source-bundle"; baseCommit: string; gitDiffSha256: string; sourceTreeSha256: string; sourceBundleSha256: string };
      networkObservation: { policy: string; externalRequests: number };
    };
    assert.equal(renderer.rendererFreezeId, `renderer_${renderer.rendererContentHash}`);
    assert.match(renderer.rendererFreezeId, /^renderer_[a-f0-9]{64}$/u);
    if (renderer.sourceIdentity.mode === "clean-commit") assert.match(renderer.sourceIdentity.commit, /^[a-f0-9]{40}$/u);
    else {
      assert.match(renderer.sourceIdentity.baseCommit, /^[a-f0-9]{40}$/u);
      for (const value of [renderer.sourceIdentity.gitDiffSha256, renderer.sourceIdentity.sourceTreeSha256, renderer.sourceIdentity.sourceBundleSha256]) assert.match(value, /^[a-f0-9]{64}$/u);
    }
    assert.deepEqual(renderer.networkObservation, { policy: "intercept-and-block", externalRequests: 0 });
  });

  it("fails when G2 construction drifts from its authored transformed boundary", async () => {
    const mutated = structuredClone(CLIP_FIXTURES);
    const g2 = mutated.find((entry) => entry.id === "G2_textInVerschachtelterGruppe");
    assert.ok(g2);
    g2.svg = g2.svg.replace('width="90"', 'width="92"');
    const report = await runSvgValidationLab({ clipFixtures: mutated });
    assert.equal(report.status, "fail");
    assert.equal(report.checks.find((check) => check.id === "G2_textInVerschachtelterGruppe-authored-clip-boundary")?.passed, false);
  });

  it("fails when G2 regresses to an identity transform", async () => {
    const mutated = structuredClone(CLIP_FIXTURES);
    const g2 = mutated.find((entry) => entry.id === "G2_textInVerschachtelterGruppe"); assert.ok(g2);
    g2.svg = g2.svg.replace("translate(10,0)", "translate(0,0)");
    const report = await runSvgValidationLab({ clipFixtures: mutated });
    assert.equal(report.status, "fail");
    assert.equal(report.checks.find((check) => check.id === "G2_textInVerschachtelterGruppe-application-transform")?.passed, false);
  });

  it("fails when G1 and G2 identities are swapped despite retaining seven rows", async () => {
    const mutated = structuredClone(CLIP_FIXTURES);
    const g1 = mutated[0]!; const g2 = mutated[1]!;
    [g1.id, g2.id] = [g2.id, g1.id];
    const report = await runSvgValidationLab({ clipFixtures: mutated });
    assert.equal(report.status, "fail");
    assert.equal(report.checks.find((check) => check.id === "normative-seven-fixture-order")?.passed, false);
    assert.ok(report.checks.some((check) => check.id.endsWith("-independent-literal-contract") && !check.passed));
  });
});
