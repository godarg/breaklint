/**
 * The release and docs tools this repository's workflows call refuse any argument they do not
 * know, with exit 2.
 *
 * `docs-truth.mjs --release=no`, `--release-dry` or `--Release` used to run pull-request mode and
 * exit 0 — at a tag, the one mode that lets known-stale sentences through. A tool a workflow calls
 * must not have a misspelling that reads as success. Each case runs the real script in a child
 * process; exit 2 is also what every one of them returns before it does any work.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const tool = (name: string) => join(ROOT, "tests/tools", name);

const REFUSED: [string, string[]][] = [
  ["docs-truth.mjs", ["--package", ROOT, "--release=no"]],
  ["docs-truth.mjs", ["--package", ROOT, "--release-dry"]],
  ["docs-truth.mjs", ["--package", ROOT, "--Release"]],
  ["docs-truth.mjs", ["--package", ROOT, "--release", "--release"]],
  ["docs-truth.mjs", ["--package", ROOT, "--pending"]],
  ["docs-truth.mjs", ["--package", ROOT, "--pending", "--release"]],
  ["docs-truth.mjs", ["--package", ROOT, "stray"]],
  ["docs-truth.mjs", ["--release"]],
  ["docs-truth.mjs", []],
  ["changelog-contract.mjs", ["--check", "--extra"]],
  ["changelog-contract.mjs", ["--check", "--root"]],
  ["changelog-contract.mjs", ["--check", "--root", ROOT, "--strict"]],
  ["changelog-contract.mjs", ["--Check"]],
  ["changelog-contract.mjs", ["--self-test", "now"]],
  ["changelog-contract.mjs", []],
  ["release-workflow-contract.mjs", ["--check", "--bogus"]],
  ["release-workflow-contract.mjs", ["--check", "--root"]],
  ["release-workflow-contract.mjs", ["--derive-env", "x"]],
  ["release-workflow-contract.mjs", ["--derive-env=1"]],
  ["release-workflow-contract.mjs", []],
  ["readme-demo-contract.mjs", ["--consumer"]],
  ["readme-demo-contract.mjs", ["--consumer", "--release"]],
  ["readme-demo-contract.mjs", ["--consumer=."]],
  ["readme-demo-contract.mjs", ["--Consumer", "."]],
  ["readme-demo-contract.mjs", ["--package", ".", "--extra"]],
];

describe("the workflow tools' arguments", () => {
  for (const [name, args] of REFUSED) {
    it(`${name} ${JSON.stringify(args)} is refused with exit 2`, () => {
      const run = spawnSync(process.execPath, [tool(name), ...args], { cwd: ROOT, encoding: "utf8", timeout: 60_000, env: { ...process.env, GITHUB_ENV: "" } });
      assert.equal(run.status, 2, `exit ${run.status}\n${run.stdout}${run.stderr}`);
      assert.match(run.stderr, /usage:/u, "a refusal must say how the tool is called");
    });
  }

  it("the documented forms are not refused", () => {
    const check = spawnSync(process.execPath, [tool("release-workflow-contract.mjs"), "--check", "--root", ROOT], { encoding: "utf8" });
    assert.equal(check.status, 0, check.stdout + check.stderr);
    const bare = spawnSync(process.execPath, [tool("release-workflow-contract.mjs"), "--check"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(bare.status, 0, bare.stdout + bare.stderr);
  });
});
