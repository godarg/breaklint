#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const target = process.env.BREAKLINT_UNIT_TAP ?? ".tmp/unit.tap";
const testFiles = ["tests/unit", "tests/e2e"]
  .flatMap((directory) => readdirSync(directory)
    .filter((name) => name.endsWith(".test.ts"))
    .sort()
    .map((name) => join(directory, name)));

mkdirSync(dirname(target), { recursive: true });

const child = spawn(process.execPath, [
  "--test",
  "--test-reporter=tap",
  "--experimental-strip-types",
  ...testFiles,
], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["ignore", "pipe", "inherit"],
});

const chunks = [];
child.stdout.on("data", (chunk) => {
  chunks.push(chunk);
  process.stdout.write(chunk);
});

const outcome = await new Promise((resolve) => {
  child.once("error", (error) => resolve({ code: 1, error }));
  child.once("close", (code, signal) => resolve({ code: code ?? 1, signal }));
});

const tap = Buffer.concat(chunks);
writeFileSync(target, tap);

if (outcome.error) process.stderr.write(`breaklint: unit/e2e runner failed: ${String(outcome.error)}\n`);
if (outcome.signal) process.stderr.write(`breaklint: unit/e2e runner ended on ${outcome.signal}\n`);
if (!/^# tests \d+$/mu.test(tap.toString("utf8"))) {
  process.stderr.write("breaklint: unit/e2e TAP has no final test count\n");
  process.exitCode = 1;
} else {
  process.exitCode = outcome.code;
}
