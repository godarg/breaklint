import { strict as assert } from "node:assert";
import { appendFileSync, cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  buildM31ToM30ReadinessBridge,
  verifyStoredM31ToM30ReadinessBridge,
} from "../tools/calibration/m3-1-readiness-bridge.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const BUNDLE = join(ROOT, "corpus/public/m3-1-pilot-v1");

describe("M3-1 to M3-0 readiness bridge", () => {
  it("reproduces the stored bridge while keeping every M3-0 rule claim false", () => {
    const first = buildM31ToM30ReadinessBridge(BUNDLE);
    const second = buildM31ToM30ReadinessBridge(BUNDLE);
    assert.deepEqual(first, second);
    assert.equal(first.validatorContractVersion, "m3-0-readiness-v1");
    assert.equal(first.status, "invalid");
    assert.equal(first.exitCode, 1);
    assert.equal(first.checks.provenance_valid, true);
    assert.equal(first.checks.privacy_valid, true);
    assert.equal(first.checks.split_valid, true);
    assert.equal(first.checks.schema_valid, false);
    assert.equal(first.checks.registry_state_consistent, false);
    assert.ok(first.issues.some((entry) => entry.code === "m3-0-corpus-materialization-missing"));
    assert.ok(first.issues.some((entry) => entry.code === "m3-0-independent-human-annotation-missing"));
    assert.ok(first.issues.some((entry) => entry.code === "m3-0-external-attestor-trust-root-missing"));
    for (const rule of Object.values(first.rules)) {
      assert.equal(rule.eligible_real_documents, 0);
      assert.equal(rule.rule_ready_for_calibration, false);
      assert.equal(rule.rule_ready_for_calibrated_claim, false);
      assert.equal(rule.capture_attestor_trust_valid, false);
    }
    assert.equal(verifyStoredM31ToM30ReadinessBridge(BUNDLE).valid, true);
  });

  it("fails closed when indexed artifact bytes drift after intake", () => {
    const temporary = mkdtempSync(join(tmpdir(), "breaklint-m3-1-bridge-red-"));
    const copy = join(temporary, "bundle");
    cpSync(BUNDLE, copy, { recursive: true });
    appendFileSync(join(copy, "documents/wikimedia-carbon-cycle.svg"), "\n<!-- drift -->\n");
    const report = buildM31ToM30ReadinessBridge(copy);
    assert.equal(report.checks.provenance_valid, false);
    assert.equal(report.checks.split_valid, false);
    assert.equal(report.checks.registry_state_consistent, false);
    assert.ok(report.issues.some((entry) => entry.code === "m3-1-artifact-binding-invalid"));
    assert.equal(report.status, "invalid");
  });
});
