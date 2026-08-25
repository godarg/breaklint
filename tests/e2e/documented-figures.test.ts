import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { evaluateDocumentedFigures } from "../tools/documented-figures.mjs";
import { runTapSuite, testFilesIn } from "../tools/test-with-tap.mjs";

const report = {
  browserVersion: "synthetic",
  cases: {
    S1_scriptRecoloursMarks: { rasterDiffPx: 200, foreignRasterDiffPx: 200 },
  },
};

test("the documented-figures guard binds unit TAP, report shape, and both raster oracles", () => {
  const statusText = "<!-- breaklint-status-figures-v1 unitTests=325 liveReportLeaves=3 s1RasterDiffPx=200 s1ForeignRasterDiffPx=200 -->";
  const result = evaluateDocumentedFigures({ statusText, unitTapText: "TAP version 13\n# tests 325\n", liveReport: report });
  assert.deepEqual(result, {
    valid: true,
    documented: { unitTests: 325, liveReportLeaves: 3, s1RasterDiffPx: 200, s1ForeignRasterDiffPx: 200 },
    measured: { unitTests: 325, liveReportLeaves: 3, s1RasterDiffPx: 200, s1ForeignRasterDiffPx: 200 },
    issues: [],
  });
});

test("each independently measured figure makes stale prose fail closed", () => {
  const statusText = "<!-- breaklint-status-figures-v1 unitTests=324 liveReportLeaves=2 s1RasterDiffPx=199 s1ForeignRasterDiffPx=198 -->";
  const result = evaluateDocumentedFigures({ statusText, unitTapText: "# tests 325\n", liveReport: report });
  assert.equal(result.valid, false);
  assert.deepEqual(result.issues, [
    "unitTests: documented=324, measured=325",
    "liveReportLeaves: documented=2, measured=3",
    "s1RasterDiffPx: documented=199, measured=200",
    "s1ForeignRasterDiffPx: documented=198, measured=200",
  ]);
});

test("the npm runner writes a distinct real unit TAP instead of relabelling Unit + E2E", async () => {
  const root = mkdtempSync(join(tmpdir(), "breaklint-unit-tap-"));
  try {
    const fixture = join(root, "single.test.mjs");
    const tap = join(root, "unit.tap");
    writeFileSync(fixture, 'import test from "node:test"; test("real child", () => {});\n');
    assert.ok(testFilesIn(["tests/unit"]).length > 0);
    assert.ok(testFilesIn(["tests/e2e"]).length > 0);
    const result = await runTapSuite([fixture], tap, false);
    assert.deepEqual(result, { code: 0, testCount: 1 });
    assert.match(readFileSync(tap, "utf8"), /^# tests 1$/mu);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
