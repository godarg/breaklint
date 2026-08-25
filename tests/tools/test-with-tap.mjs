#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.env.BREAKLINT_UNIT_TAP ?? ".tmp/unit.tap";
const aggregateTarget = process.env.BREAKLINT_TEST_TAP ?? ".tmp/test.tap";

export function testFilesIn(directories) {
  return directories.flatMap((directory) => readdirSync(directory)
    .filter((name) => name.endsWith(".test.ts"))
    .sort()
    .map((name) => join(directory, name)));
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
  const finalCount = /^# tests (\d+)$/mu.exec(tap.toString("utf8"));
  if (outcome.error) process.stderr.write(`breaklint: test runner failed: ${String(outcome.error)}\n`);
  if (outcome.signal) process.stderr.write(`breaklint: test runner ended on ${outcome.signal}\n`);
  if (!finalCount) process.stderr.write(`breaklint: TAP at ${outputTarget} has no final test count\n`);
  return { code: finalCount ? outcome.code : 1, testCount: finalCount ? Number(finalCount[1]) : null };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  rmSync(target, { force: true });
  const unitFiles = testFilesIn(["tests/unit"]);
  const aggregate = await runTapSuite([...unitFiles, ...testFilesIn(["tests/e2e"])], aggregateTarget, true);
  if (aggregate.code !== 0) {
    process.exitCode = aggregate.code;
  } else {
    // The documented-figures guard consumes a real unit-only TAP. Keeping that measurement
    // separate from the public aggregate output prevents Unit + E2E from masquerading as Unit.
    const unit = await runTapSuite(unitFiles, target, false);
    process.exitCode = unit.code;
  }
}
