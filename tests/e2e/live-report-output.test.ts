import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writePartialLiveReport } from "../tools/live-report-output.mjs";

test("a live report creates a previously absent nested parent and remains partial", () => {
  const root = mkdtempSync(join(tmpdir(), "breaklint-live-report-output-"));
  try {
    const target = join(root, "absent", "nested", "measurement.json");
    const measurement = { contractVersion: "synthetic-live-measurement-v1", cases: { neutral: { pages: 1 } } };

    assert.equal(existsSync(join(root, "absent")), false);
    writePartialLiveReport(target, measurement);

    assert.equal(existsSync(target), false, "only the parent runner may promote a partial report");
    assert.deepEqual(JSON.parse(readFileSync(`${target}.partial`, "utf8")), measurement);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an existing partial report is never silently overwritten", () => {
  const root = mkdtempSync(join(tmpdir(), "breaklint-live-report-output-"));
  try {
    const target = join(root, "measurement.json");
    writePartialLiveReport(target, { sequence: 1 });
    assert.throws(() => writePartialLiveReport(target, { sequence: 2 }), /EEXIST/u);
    assert.deepEqual(JSON.parse(readFileSync(`${target}.partial`, "utf8")), { sequence: 1 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
