#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

interface Mutation {
  id: string;
  relativePath: string;
  before: string;
  after: string;
  expectedFailedCheck: string;
}

const MUTATIONS: readonly Mutation[] = Object.freeze([
  {
    id: "clip-default-0.05-to-0.6",
    relativePath: "src/rules/svg/text-clipped.ts",
    before: "defaultOptions: { maxMissingInk: 0.05 }",
    after: "defaultOptions: { maxMissingInk: 0.6 }",
    expectedFailedCheck: "product-default-clip-0.05",
  },
  {
    id: "collision-default-8-to-300",
    relativePath: "src/rules/svg/text-ink-collision.ts",
    before: "defaultOptions: { minCollisionInk: 8, minOccludedInk: 8 }",
    after: "defaultOptions: { minCollisionInk: 300, minOccludedInk: 300 }",
    expectedFailedCheck: "product-default-collision-8",
  },
  {
    id: "right-edge-forced-negative-one",
    relativePath: "tests/tools/calibration/svg-validation-lab.ts",
    before: "rightEdge = Math.max(rightEdge, pixel % actual.width);",
    after: "rightEdge = -1;",
    expectedFailedCheck: "G1_textInGruppe-t1-right-edge-relation",
  },
  {
    id: "authored-clip-boundary-drift",
    relativePath: "tests/fixtures/svg-validation/fixtures.ts",
    before: `<rect id="c1-boundary" x="20" y="20" width="90" height="80"/>`,
    after: `<rect id="c1-boundary" x="20" y="20" width="92" height="80"/>`,
    expectedFailedCheck: "G1_textInGruppe-authored-clip-boundary",
  },
]);

function copyRepository(destination: string): void {
  cpSync(ROOT, destination, {
    recursive: true,
    filter: (source) => ![".git", "node_modules", "dist", "coverage"].includes(source.split("/").at(-1) ?? ""),
  });
  symlinkSync(resolve(ROOT, "node_modules"), resolve(destination, "node_modules"), "dir");
  execFileSync("git", ["init", "--quiet"], { cwd: destination });
  execFileSync("git", ["config", "user.email", "m3-mutation@invalid.example"], { cwd: destination });
  execFileSync("git", ["config", "user.name", "M3 Mutation Control"], { cwd: destination });
  execFileSync("git", ["add", "."], { cwd: destination });
  execFileSync("git", ["commit", "--quiet", "-m", "mutation baseline"], { cwd: destination });
}

const temporary = mkdtempSync(join(tmpdir(), "breaklint-m3-mutations-"));
const copiedRoot = join(temporary, "repo");
const results: unknown[] = [];
try {
  copyRepository(copiedRoot);
  for (const mutation of MUTATIONS) {
    execFileSync("git", ["checkout", "--quiet", "--", mutation.relativePath], { cwd: copiedRoot });
    const path = join(copiedRoot, mutation.relativePath);
    const source = readFileSync(path, "utf8");
    assert.equal(source.includes(mutation.before), true, `${mutation.id}: mutation anchor is absent`);
    writeFileSync(path, source.replace(mutation.before, mutation.after));
    const output = join(temporary, `${mutation.id}.json`);
    const run = spawnSync(process.execPath, ["--experimental-strip-types", "tests/tools/calibration/svg-validation-lab.ts", "--output", output], {
      cwd: copiedRoot,
      encoding: "utf8",
      maxBuffer: 30 * 1024 * 1024,
    });
    assert.equal(run.status, 1, `${mutation.id}: lab did not return the expected red exit 1\n${run.stdout}\n${run.stderr}`);
    const report = JSON.parse(readFileSync(output, "utf8")) as { status: string; checks: { id: string; passed: boolean }[] };
    assert.equal(report.status, "fail", `${mutation.id}: report was not red`);
    assert.equal(report.checks.find((check) => check.id === mutation.expectedFailedCheck)?.passed, false, `${mutation.id}: ${mutation.expectedFailedCheck} did not detect the mutation`);
    results.push({ mutation: mutation.id, exitCode: run.status, status: report.status, failedCheck: mutation.expectedFailedCheck });
  }
  process.stdout.write(`${JSON.stringify({ contractVersion: "m3-0-lab-mutations-v1", status: "pass", results }, null, 2)}\n`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
