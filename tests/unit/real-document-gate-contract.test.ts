import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const RUNNER = join(ROOT, "tests/tools/real-document-gate.mjs");

test("the real-document runner rejects every implicit or missing consumer cwd", () => {
  for (const args of [
    [RUNNER, "--cli", join(ROOT, "dist/cli/index.js")],
    [RUNNER, "--cwd", "--cli", join(ROOT, "dist/cli/index.js")],
  ]) {
    const run = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /--cwd (?:is required|requires an explicit directory)/u);
  }
});

test("both packed-consumer workflows pass their actual consumer cwd", () => {
  const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const release = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");
  const ciContract = [
    'node "$GITHUB_WORKSPACE/tests/tools/real-document-gate.mjs" \\',
    '            --cli "$PWD/node_modules/breaklint/dist/cli/index.js" \\',
    '            --cwd "$PWD"',
  ].join("\n");
  const releaseContract = [
    'node "$GITHUB_WORKSPACE/tests/tools/real-document-gate.mjs" \\',
    '            --cli "$consumer/node_modules/breaklint/dist/cli/index.js" \\',
    '            --cwd "$consumer"',
  ].join("\n");
  assert.ok(ci.includes(ciContract), "main CI did not bind the installed CLI to its consumer cwd");
  assert.ok(release.includes(releaseContract), "release CI did not bind the installed CLI to its consumer cwd");
});
