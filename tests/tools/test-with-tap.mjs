#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

export async function runTapSuite(testFiles, outputTarget, mirrorStdout) {
  mkdirSync(dirname(outputTarget), { recursive: true });
  const { NODE_TEST_CONTEXT: _parentTestContext, ...childEnv } = process.env;
  const child = spawn(process.execPath, [
    "--test",
    "--test-reporter=tap",
    "--experimental-strip-types",
    ...testFiles,
  ], {
    cwd: process.cwd(),
    env: childEnv,
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

if (isMainModule(process.argv[1])) {
  rmSync(defaultUnitOutputTarget, { force: true });
  const plan = buildRunnerPlan();
  const aggregate = await runTapSuite(plan.aggregate.testFiles, plan.aggregate.outputTarget, plan.aggregate.mirrorStdout);
  if (aggregate.code !== 0) {
    process.exitCode = aggregate.code;
  } else {
    // The documented-figures guard consumes a real unit-only TAP. Keeping that measurement
    // separate from the public aggregate output prevents Unit + E2E from masquerading as Unit.
    const unit = await runTapSuite(plan.unit.testFiles, plan.unit.outputTarget, plan.unit.mirrorStdout);
    // The normally quiet unit-only measurement must expose its actual failure in CI logs.
    if (unit.code !== 0) process.stderr.write(readFileSync(plan.unit.outputTarget));
    process.exitCode = unit.code;
  }
}
