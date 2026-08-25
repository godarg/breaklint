import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { evaluateDocumentedFigures, isMainModule as isDocumentedFiguresMain } from "../tools/documented-figures.mjs";
import {
  buildRunnerPlan,
  buildSuitePlan,
  defaultAggregateOutputTarget,
  defaultUnitOutputTarget,
  isMainModule,
  lastTapTestCount,
  runTapSuite,
  testFilesIn,
} from "../tools/test-with-tap.mjs";

const report = {
  browserVersion: "synthetic",
  cases: {
    S1_scriptRecoloursMarks: { rasterDiffPx: 200, foreignRasterDiffPx: 200 },
  },
};
const liveSummary = {
  contractVersion: "breaklint-live-summary-v1",
  suites: { passed: 4, expected: 4 },
  tests: { passed: 57, expected: 57 },
};

test("the documented-figures guard binds both TAPs, the accepted live run, report shape, and both raster oracles", () => {
  const statusText = "<!-- breaklint-status-figures-v1 unitTests=325 aggregateTests=431 liveTests=57 liveReportLeaves=3 s1RasterDiffPx=200 s1ForeignRasterDiffPx=200 -->";
  const result = evaluateDocumentedFigures({ statusText, unitTapText: "TAP version 13\n# tests 325\n", aggregateTapText: "TAP version 13\n# tests 431\n", liveSummary, liveReport: report });
  assert.deepEqual(result, {
    valid: true,
    documented: { unitTests: 325, aggregateTests: 431, liveTests: 57, liveReportLeaves: 3, s1RasterDiffPx: 200, s1ForeignRasterDiffPx: 200 },
    measured: { unitTests: 325, aggregateTests: 431, liveTests: 57, liveReportLeaves: 3, s1RasterDiffPx: 200, s1ForeignRasterDiffPx: 200 },
    issues: [],
  });
});

test("each independently measured figure makes stale prose fail closed", () => {
  const statusText = "<!-- breaklint-status-figures-v1 unitTests=324 aggregateTests=430 liveTests=56 liveReportLeaves=2 s1RasterDiffPx=199 s1ForeignRasterDiffPx=198 -->";
  const result = evaluateDocumentedFigures({ statusText, unitTapText: "# tests 325\n", aggregateTapText: "# tests 431\n", liveSummary, liveReport: report });
  assert.equal(result.valid, false);
  assert.deepEqual(result.issues, [
    "unitTests: documented=324, measured=325",
    "aggregateTests: documented=430, measured=431",
    "liveTests: documented=56, measured=57",
    "liveReportLeaves: documented=2, measured=3",
    "s1RasterDiffPx: documented=199, measured=200",
    "s1ForeignRasterDiffPx: documented=198, measured=200",
  ]);
});

test("a partial or failed live summary cannot supply a documented live-test denominator", () => {
  const statusText = "<!-- breaklint-status-figures-v1 unitTests=325 aggregateTests=431 liveTests=56 liveReportLeaves=3 s1RasterDiffPx=200 s1ForeignRasterDiffPx=200 -->";
  const result = evaluateDocumentedFigures({
    statusText,
    unitTapText: "# tests 325\n",
    aggregateTapText: "# tests 431\n",
    liveSummary: { ...liveSummary, tests: { passed: 56, expected: 57 } },
    liveReport: report,
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.issues, ["liveTests: documented=56, measured=undefined"]);
});

test("the npm runner writes a distinct real unit TAP instead of relabelling Unit + E2E", async () => {
  const root = mkdtempSync(join(tmpdir(), "breaklint-unit-tap-"));
  try {
    const fixture = join(root, "single.test.mjs");
    const tap = join(root, "unit.tap");
    const aggregateTap = join(root, "aggregate.tap");
    writeFileSync(fixture, 'import test from "node:test"; test("real child", () => {});\n');
    const { unitFiles, aggregateFiles } = buildSuitePlan();
    const e2eFiles = testFilesIn(["tests/e2e"]);
    assert.ok(unitFiles.length > 0);
    assert.ok(e2eFiles.length > 0);
    assert.deepEqual(new Set(aggregateFiles), new Set([...unitFiles, ...e2eFiles]));
    assert.equal(unitFiles.some((file) => e2eFiles.includes(file)), false);
    assert.equal(unitFiles.every((file) => file.startsWith("tests/unit/")), true);
    const defaultPlan = buildRunnerPlan();
    assert.equal(defaultUnitOutputTarget, ".tmp/unit.tap");
    assert.equal(defaultAggregateOutputTarget, ".tmp/test.tap");
    assert.equal(defaultPlan.unit.outputTarget, ".tmp/unit.tap");
    assert.equal(defaultPlan.aggregate.outputTarget, ".tmp/test.tap");
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    assert.equal(packageJson.scripts.test, "node tests/tools/test-with-tap.mjs");
    const runnerPlan = buildRunnerPlan({ unitOutputTarget: tap, aggregateOutputTarget: aggregateTap });
    assert.equal(runnerPlan.unit.outputTarget, tap);
    assert.equal(runnerPlan.aggregate.outputTarget, aggregateTap);
    assert.deepEqual(runnerPlan.unit.testFiles, unitFiles);
    assert.deepEqual(runnerPlan.aggregate.testFiles, aggregateFiles);
    assert.equal(runnerPlan.unit.mirrorStdout, false);
    assert.equal(runnerPlan.aggregate.mirrorStdout, true);
    const runnerSymlink = join(root, "test-with-tap-link.mjs");
    symlinkSync(new URL("../tools/test-with-tap.mjs", import.meta.url), runnerSymlink);
    assert.equal(isMainModule(runnerSymlink), true, "a symlinked npm bin path must not become a zero-test exit-0");
    const guardSymlink = join(root, "documented-figures-link.mjs");
    symlinkSync(new URL("../tools/documented-figures.mjs", import.meta.url), guardSymlink);
    assert.equal(isDocumentedFiguresMain(guardSymlink), true, "a symlinked guard path must not become a zero-check exit-0");
    assert.equal(lastTapTestCount("# tests 1\n# tests 2\n"), 2, "the runner and guard must consume the same final TAP count");
    const result = await runTapSuite([fixture], tap, false);
    assert.deepEqual(result, { code: 0, testCount: 1 });
    assert.match(readFileSync(tap, "utf8"), /^# tests 1$/mu);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
