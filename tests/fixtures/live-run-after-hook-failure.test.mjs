import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { after, describe, it } from "node:test";

describe("synthetic live report producer", () => {
  after(() => {
    const target = process.env.BREAKLINT_LIVE_REPORT;
    assert.ok(target, "the fixture needs a report target");
    writeFileSync(`${target}.partial`, JSON.stringify({ cases: { synthetic: {} } }) + "\n");
    if (process.env.BREAKLINT_FIXTURE_FAIL_AFTER === "1") {
      assert.fail("synthetic after-hook failure");
    }
  });

  it("passes its visible assertion", () => {
    assert.equal(1 + 1, 2);
  });
});
