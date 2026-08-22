#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(import.meta.url);

function git(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function assertAnnotatedTag(cwd, name) {
  assert.ok(name, "release tag name is required");
  const ref = `refs/tags/${name}`;
  const validRef = git(cwd, ["check-ref-format", ref]);
  assert.equal(validRef.status, 0, `invalid release tag ref ${ref}: ${validRef.stderr}`);

  // This check deliberately happens before any ^{commit} peel. Both annotated and lightweight
  // tags peel to a commit, so a commit comparison alone cannot establish the release contract.
  const type = git(cwd, ["cat-file", "-t", ref]);
  assert.equal(type.status, 0, `release tag ${name} is not readable: ${type.stderr}`);
  assert.equal(
    type.stdout.trim(),
    "tag",
    `release tag ${name} must be annotated; Git object type is ${type.stdout.trim() || "unknown"}`,
  );
}

function runSelfTest() {
  const scratch = mkdtempSync(join(tmpdir(), "breaklint-release-tag-"));
  try {
    assert.equal(git(scratch, ["init", "--quiet"]).status, 0);
    assert.equal(git(scratch, ["config", "user.name", "breaklint release-tag canary"]).status, 0);
    assert.equal(git(scratch, ["config", "user.email", "release-tag-canary@example.invalid"]).status, 0);
    assert.equal(git(scratch, ["commit", "--quiet", "--allow-empty", "-m", "canary commit"]).status, 0);
    assert.equal(git(scratch, ["tag", "v0.0.0-lightweight-canary"]).status, 0);
    assert.equal(
      git(scratch, ["tag", "-a", "v0.0.0-annotated-canary", "-m", "annotated canary"]).status,
      0,
    );

    const lightweight = spawnSync(
      process.execPath,
      [SCRIPT, "--assert-ref", "v0.0.0-lightweight-canary"],
      { cwd: scratch, encoding: "utf8" },
    );
    assert.notEqual(lightweight.status, 0, "lightweight release tag canary stayed green");
    assert.match(
      `${lightweight.stdout}${lightweight.stderr}`,
      /must be annotated; Git object type is commit/u,
      "lightweight canary failed without proving that object type commit was rejected",
    );

    const annotated = spawnSync(
      process.execPath,
      [SCRIPT, "--assert-ref", "v0.0.0-annotated-canary"],
      { cwd: scratch, encoding: "utf8" },
    );
    assert.equal(
      annotated.status,
      0,
      `annotated release tag canary was rejected: ${annotated.stdout}${annotated.stderr}`,
    );

    process.stdout.write("release tag: lightweight canary rejected, annotated canary accepted\n");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const [mode, value] = process.argv.slice(2);
if (mode === "--assert-ref" && value && process.argv.length === 4) {
  assertAnnotatedTag(process.cwd(), value);
} else if (mode === "--self-test" && process.argv.length === 3) {
  runSelfTest();
} else {
  process.stderr.write(
    "usage: release-tag-contract.mjs --assert-ref <tag-name> | --self-test\n",
  );
  process.exitCode = 2;
}
