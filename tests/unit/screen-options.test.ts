import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";

import { SCREEN_OPTIONS_SCHEMA, validateCheckPageOptions } from "../../src/web/options.ts";

const base = (): Record<string, unknown> => ({
  trust: "host-controlled-page", networkPolicy: "host-owned", scenario: "dashboard",
  output: { dir: "/tmp/breaklint-screen", screenshot: "viewport" },
});

describe("screen checkPage options", () => {
  it("accepts only the named host boundary and bounded geometry values", () => {
    const value = validateCheckPageOptions({ ...base(), geometry: { maxTargets: 50, stabilizationTimeoutMs: 10, allowedScrollContainers: [{ selector: "#grid", reason: "wide grid" }] } });
    assert.equal(value.trust, "host-controlled-page");
    assert.equal(value.geometry?.maxTargets, 50);
  });

  it("keeps the exported schema aligned with the runtime source-binding contract", () => {
    const candidate = {
      ...base(), projectId: "ds-os", documentId: "dashboard", runId: "run-1",
      geometry: { intentionalOverlays: [{ selector: "[role=dialog]", reason: "modal" }], maxTargets: 20, stabilizationTimeoutMs: 100 },
      sourceBinding: { kind: "host-build-container", root: "/tmp/project", receiptPath: ".breaklint-build/receipt.json", compiledBuildSelector: "meta[name=breaklint-build]", compiledBuildAttribute: "content", containers: [{ selector: "[data-breaklint-source]", file: "src/components/Shell.tsx" }] },
    };
    assert.doesNotThrow(() => validateCheckPageOptions(candidate));
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(SCREEN_OPTIONS_SCHEMA);
    assert.equal(validate(candidate), true, JSON.stringify(validate.errors));
  });

  it("rejects ignored fields, wrong numeric types, and a forged bound source status", () => {
    assert.throws(() => validateCheckPageOptions({ ...base(), unexpected: true }), /unknown field/);
    assert.throws(() => validateCheckPageOptions({ ...base(), geometry: { maxTargets: "50" } }), /must be a number/);
    assert.throws(() => validateCheckPageOptions({ ...base(), sourceBinding: { kind: "host-build-container", root: "/tmp/project", receiptPath: ".breaklint-build/receipt.json", compiledBuildSelector: "meta", compiledBuildAttribute: "content", containers: [], status: "bound" } }), /unknown field/);
  });
});
