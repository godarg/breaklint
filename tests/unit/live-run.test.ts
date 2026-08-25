import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const RUNNER = join(REPO, "tests/tools/live-run.mjs");
const FIXTURE = join(REPO, "tests/fixtures/live-run-after-hook-failure.test.mjs");
const scratch = mkdtempSync(join(tmpdir(), "breaklint-live-run-"));

after(() => rmSync(scratch, { recursive: true, force: true }));

function runFixture(
  name: string,
  failAfter: boolean,
  options: {
    file?: string;
    expectedLeaves?: number;
    expectedSuite?: string;
    extraEnv?: Record<string, string>;
  } = {},
) {
  const target = join(scratch, `${name}.json`);
  const summary = join(scratch, `${name}.summary.json`);
  const childEnv = { ...process.env };
  // The integration child is a fresh runner, not a recursively registered child of this test.
  // Node marks test workers with this private context variable; forwarding it makes run() refuse
  // to execute the explicit fixture and would turn the regression check into a zero-test green.
  delete childEnv.NODE_TEST_CONTEXT;
  return {
    target,
    summary,
    run: spawnSync(process.execPath, [RUNNER, options.file ?? FIXTURE], {
      cwd: REPO,
      encoding: "utf8",
      timeout: 20_000,
      env: {
        ...childEnv,
        BREAKLINT_LIVE_REPORT: target,
        BREAKLINT_LIVE_SUMMARY: summary,
        BREAKLINT_LIVE_EXPECTED_LEAVES: String(options.expectedLeaves ?? 1),
        BREAKLINT_LIVE_EXPECTED_SUITE: options.expectedSuite ?? "synthetic live report producer",
        BREAKLINT_FIXTURE_FAIL_AFTER: failAfter ? "1" : "0",
        ...options.extraEnv,
      },
    }),
  };
}

function syntheticFixture(name: string, testBody: string, afterBody = ""): string {
  const path = join(scratch, `${name}.test.mjs`);
  writeFileSync(
    path,
    `import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { after, describe, it } from "node:test";
describe("${name}", () => {
  after(() => {
    const target = process.env.BREAKLINT_LIVE_REPORT;
    assert.ok(target);
    writeFileSync(target + ".partial", JSON.stringify({ cases: { synthetic: {} } }) + "\\n");
    ${afterBody}
  });
  ${testBody}
});
`,
  );
  return path;
}

describe("the live report gate uses structured test truth", () => {
  it("rejects an after-hook failure even when the visible test assertion passed", () => {
    const stale = join(scratch, "red.json");
    writeFileSync(stale, "stale report that must not survive\n");
    const { target, summary, run } = runFixture("red", true);
    assert.equal(run.status, 1, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
    assert.match(run.stdout, /not ok/u, "the synthetic hook failure was not visible in TAP");
    assert.match(run.stderr, /structured test verdict is red/u);
    assert.equal(existsSync(target), false, "an old or newly promoted target survived a red run");
    assert.equal(existsSync(`${target}.partial`), false, "a partial report survived a red run");
    assert.equal(existsSync(summary), false, "a structured summary survived a red run");
    assert.equal(existsSync(`${summary}.partial`), false, "a partial structured summary survived a red run");
  });

  it("promotes a nonempty report after structured success", () => {
    const { target, summary, run } = runFixture("green", false);
    assert.equal(run.status, 0, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
    assert.match(run.stdout, /structured live total: suites 1\/1, tests 1\/1/u);
    assert.equal(existsSync(`${target}.partial`), false);
    assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { cases: { synthetic: {} } });
    assert.deepEqual(JSON.parse(readFileSync(summary, "utf8")), {
      contractVersion: "breaklint-live-summary-v1",
      suites: { passed: 1, expected: 1 },
      tests: { passed: 1, expected: 1 },
    });
  });

  it("terminates a judged per-file runner only after its complete top-level pass", () => {
    const file = syntheticFixture(
      "synthetic judged hang",
      'it("passes", () => assert.equal(1 + 1, 2));',
      'setInterval(() => {}, 1_000);',
    );
    const started = Date.now();
    const { target, run } = runFixture("judged-hang", false, {
      file,
      expectedSuite: "synthetic judged hang",
    });
    assert.equal(run.status, 0, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
    assert.ok(Date.now() - started < 10_000, "the judged runner was not terminated after its exit grace");
    assert.match(run.stdout, /ok 1 - synthetic judged hang/u);
    assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { cases: { synthetic: {} } });
  });

  it("rejects a top-level pass whose exact leaf denominator is wrong", () => {
    const { target, run } = runFixture("wrong-denominator", false, { expectedLeaves: 2 });
    assert.equal(run.status, 1, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
    assert.match(run.stderr, /leaf pass denominator was 1, expected 2/u);
    assert.equal(existsSync(target), false);
    assert.equal(existsSync(`${target}.partial`), false);
  });

  it("rejects a child that exits nonzero after a valid marker but before parent termination", () => {
    const { target, run } = runFixture("post-marker-nonzero", false, {
      extraEnv: { BREAKLINT_LIVE_CHILD_CANARY_EXIT_AFTER_PASS: "7" },
    });
    assert.equal(run.status, 1, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
    assert.match(run.stderr, /ended naturally after its marker with code=7, signal=none/u);
    assert.equal(existsSync(target), false);
    assert.equal(existsSync(`${target}.partial`), false);
  });

  it("rejects a skipped leaf even though its top-level suite passes", () => {
    const file = syntheticFixture(
      "synthetic skipped leaf",
      'it("does not run", { skip: "intentional canary" }, () => assert.fail("ran"));',
    );
    const { target, run } = runFixture("skipped", false, {
      file,
      expectedSuite: "synthetic skipped leaf",
    });
    assert.equal(run.status, 1, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
    assert.match(run.stderr, /leaf skip event/u);
    assert.equal(existsSync(target), false);
    assert.equal(existsSync(`${target}.partial`), false);
  });
});
