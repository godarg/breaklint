#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const defaultUnitOutputTarget = process.env.BREAKLINT_UNIT_TAP ?? ".tmp/unit.tap";
export const defaultAggregateOutputTarget = process.env.BREAKLINT_TEST_TAP ?? ".tmp/test.tap";

export function testFilesIn(directories) {
  return directories.flatMap((directory) => readdirSync(directory)
    .filter((name) => name.endsWith(".test.ts"))
    .sort()
    .map((name) => join(directory, name)));
}

export function buildSuitePlan() {
  const unitFiles = testFilesIn(["tests/unit"]);
  const e2eFiles = testFilesIn(["tests/e2e"]);
  return { unitFiles, aggregateFiles: [...unitFiles, ...e2eFiles] };
}

export function buildRunnerPlan({ unitOutputTarget = defaultUnitOutputTarget, aggregateOutputTarget = defaultAggregateOutputTarget } = {}) {
  const { unitFiles, aggregateFiles } = buildSuitePlan();
  return {
    aggregate: { testFiles: aggregateFiles, outputTarget: aggregateOutputTarget, mirrorStdout: true },
    unit: { testFiles: unitFiles, outputTarget: unitOutputTarget, mirrorStdout: false },
  };
}

export function isMainModule(argvPath, modulePath = fileURLToPath(import.meta.url)) {
  return Boolean(argvPath) && realpathSync(argvPath) === realpathSync(modulePath);
}

export function lastTapTestCount(tapText) {
  const matches = [...tapText.matchAll(/^# tests (\d+)$/gmu)];
  return matches.length ? Number(matches.at(-1)[1]) : null;
}

export async function runTapSuite(testFiles, outputTarget, mirrorStdout, extraEnv = {}) {
  mkdirSync(dirname(outputTarget), { recursive: true });
  const { NODE_TEST_CONTEXT: _parentTestContext, ...childEnv } = process.env;
  const child = spawn(process.execPath, [
    "--test",
    "--test-reporter=tap",
    "--experimental-strip-types",
    ...testFiles,
  ], {
    cwd: process.cwd(),
    env: { ...childEnv, ...extraEnv },
    stdio: ["ignore", "pipe", "inherit"],
  });

  const chunks = [];
  child.stdout.on("data", (chunk) => {
    chunks.push(chunk);
    if (mirrorStdout) process.stdout.write(chunk);
  });

  const outcome = await new Promise((resolveOutcome) => {
    child.once("error", (error) => resolveOutcome({ code: 1, error }));
    child.once("close", (code, signal) => resolveOutcome({ code: code ?? 1, signal }));
  });

  const tap = Buffer.concat(chunks);
  writeFileSync(outputTarget, tap);
  const finalCount = lastTapTestCount(tap.toString("utf8"));
  if (outcome.error) process.stderr.write(`breaklint: test runner failed: ${String(outcome.error)}\n`);
  if (outcome.signal) process.stderr.write(`breaklint: test runner ended on ${outcome.signal}\n`);
  if (finalCount === null) process.stderr.write(`breaklint: TAP at ${outputTarget} has no final test count\n`);
  return { code: finalCount === null ? 1 : outcome.code, testCount: finalCount };
}

/**
 * What may remain in the suite's private temporary directory, and why each entry is not a leak.
 *
 * Measured before this check existed: every `npm test` left twelve `breaklint-*` directories in
 * the shared temporary directory, from three test files that created them and never removed them.
 * Nothing failed, so nothing said so. The suite now runs with a temporary directory of its own,
 * and anything in it afterwards that is not named here fails the run. A private directory rather
 * than a before/after listing of the shared one, because the shared one is also written by every
 * concurrent run on the machine and a diff of it would blame the wrong process.
 */
export const SUITE_TEMPORARY_ALLOWLIST = Object.freeze({
  // Node's own on-disk module compile cache. `module.enableCompileCache()` creates it under the
  // temporary directory — the pinned TypeScript compiler turns it on, and the pipe-integrity test
  // runs that compiler. It belongs to Node, holds no test state and is reused, not leaked.
  "node-compile-cache": "Node's module compile cache (module.enableCompileCache)",
});

/** Entries of `directory` that the allowlist does not account for, sorted. */
export function strayTemporaryEntries(directory, allowlist = SUITE_TEMPORARY_ALLOWLIST) {
  return readdirSync(directory).filter((name) => !Object.hasOwn(allowlist, name)).sort();
}

/** The environment that points a child's temporary files at `directory`, on every platform. */
export function privateTemporaryEnvironment(directory) {
  return { TMPDIR: directory, TMP: directory, TEMP: directory };
}

/**
 * The whole `npm test`: the aggregate run, then the unit-only run, both inside one private
 * temporary directory that must be empty of unaccounted entries afterwards. Returns the exit code.
 */
export async function runSuiteInPrivateTemporaryDirectory(plan, { temporaryParent = tmpdir(), report = (text) => process.stderr.write(text) } = {}) {
  const temporaryRoot = mkdtempSync(join(temporaryParent, "breaklint-suite-"));
  const environment = privateTemporaryEnvironment(temporaryRoot);
  try {
    let code;
    const aggregate = await runTapSuite(plan.aggregate.testFiles, plan.aggregate.outputTarget, plan.aggregate.mirrorStdout, environment);
    if (aggregate.code !== 0) {
      code = aggregate.code;
    } else {
      // The documented-figures guard consumes a real unit-only TAP. Keeping that measurement
      // separate from the public aggregate output prevents Unit + E2E from masquerading as Unit.
      const unit = await runTapSuite(plan.unit.testFiles, plan.unit.outputTarget, plan.unit.mirrorStdout, environment);
      // The normally quiet unit-only measurement must expose its actual failure in CI logs.
      if (unit.code !== 0) report(readFileSync(plan.unit.outputTarget, "utf8"));
      code = unit.code;
    }
    const stray = strayTemporaryEntries(temporaryRoot);
    if (stray.length > 0) {
      report(
        `breaklint: the suite left ${stray.length} temporary entr${stray.length === 1 ? "y" : "ies"} behind: ${stray.join(", ")}\n` +
          "  a test that creates a temporary directory must also remove it (after(), t.after() or finally)\n",
      );
      if (code === 0) code = 1;
    }
    return code;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (isMainModule(process.argv[1])) {
  rmSync(defaultUnitOutputTarget, { force: true });
  process.exitCode = await runSuiteInPrivateTemporaryDirectory(buildRunnerPlan());
}
