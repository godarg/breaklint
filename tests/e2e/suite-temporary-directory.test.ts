/**
 * `npm test` fails when a test leaves a temporary entry behind.
 *
 * Measured before the check existed: one `npm test` left twelve `breaklint-*` directories in the
 * shared temporary directory — nine from `tests/unit/m3-1-pilot.test.ts`, one from
 * `tests/unit/m3-1-readiness-bridge.test.ts`, two from `tests/e2e/m3-1-real-corpus-pilot.test.ts`
 * — and nothing failed. The runner now gives both of its child runs one private temporary
 * directory and fails if anything in it is not on its allowlist afterwards.
 *
 * Driven here through the runner's real suite function with real child test runs, because the
 * property is about processes: a checker handed a directory that the children never actually
 * used would pass every time. The leaking fixture therefore writes through `os.tmpdir()` in the
 * child, exactly as the leaking tests did, and the check has to find it there.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  runSuiteInPrivateTemporaryDirectory,
  strayTemporaryEntries,
  SUITE_TEMPORARY_ALLOWLIST,
} from "../tools/test-with-tap.mjs";

const workspace = mkdtempSync(join(tmpdir(), "breaklint-suite-check-"));
after(() => rmSync(workspace, { recursive: true, force: true }));

function fixture(name: string, body: string): string {
  const file = join(workspace, name);
  writeFileSync(file, `import test from "node:test";\nimport { mkdtempSync, rmSync } from "node:fs";\nimport { tmpdir } from "node:os";\nimport { join } from "node:path";\n${body}\n`);
  return file;
}

/**
 * Runs the runner's suite function with `testFile` as the aggregate run and a no-op file as the
 * unit-only run, which the runner starts only after a green aggregate.
 */
async function suite(testFile: string): Promise<{ code: number; reported: string; parentAfter: string[] }> {
  // A parent of our own, so the private root the runner creates can be looked for afterwards.
  const parent = mkdtempSync(join(workspace, "parent-"));
  let reported = "";
  const plan = {
    aggregate: { testFiles: [testFile], outputTarget: `${testFile}.aggregate.tap`, mirrorStdout: false },
    unit: { testFiles: [fixture("unit-noop.test.mjs", 'test("noop", () => {});')], outputTarget: `${testFile}.unit.tap`, mirrorStdout: false },
  };
  const code = await runSuiteInPrivateTemporaryDirectory(plan, {
    temporaryParent: parent,
    report: (text) => {
      reported += text;
    },
  });
  return { code, reported, parentAfter: readdirSync(parent) };
}

describe("the npm test runner's temporary-directory check", () => {
  it("reports exactly the entries the allowlist does not account for", () => {
    const directory = mkdtempSync(join(workspace, "listing-"));
    for (const name of Object.keys(SUITE_TEMPORARY_ALLOWLIST)) mkdirSync(join(directory, name));
    mkdirSync(join(directory, "breaklint-m3-1-unit-abc123"));
    writeFileSync(join(directory, "stray-file"), "");
    assert.deepEqual(strayTemporaryEntries(directory), ["breaklint-m3-1-unit-abc123", "stray-file"]);
    for (const [name, reason] of Object.entries(SUITE_TEMPORARY_ALLOWLIST)) {
      assert.ok(reason.length > 0, `allowlisted entry ${name} carries no justification`);
    }
  });

  it("fails a passing suite whose test leaves a directory in the child's os.tmpdir()", async () => {
    const leaky = fixture("leaky.test.mjs", 'test("leaks", () => { mkdtempSync(join(tmpdir(), "breaklint-leaky-fixture-")); });');
    const result = await suite(leaky);
    assert.equal(result.code, 1, `a leaking suite ended ${result.code}; reported: ${result.reported}`);
    assert.match(result.reported, /left 1 temporary entry behind: breaklint-leaky-fixture-/u);
    assert.deepEqual(result.parentAfter, [], "the private temporary root was not removed");
  });

  it("passes a suite that removes what it creates, and removes its private root", async () => {
    const tidy = fixture(
      "tidy.test.mjs",
      'test("tidy", () => { const d = mkdtempSync(join(tmpdir(), "breaklint-tidy-fixture-")); rmSync(d, { recursive: true }); });',
    );
    const result = await suite(tidy);
    assert.equal(result.code, 0, `reported: ${result.reported}`);
    assert.equal(result.reported, "");
    assert.deepEqual(result.parentAfter, []);
  });

  it("keeps a failing suite's own exit code and still names the leak", async () => {
    const both = fixture(
      "failing-and-leaky.test.mjs",
      'test("fails and leaks", () => { mkdtempSync(join(tmpdir(), "breaklint-failing-fixture-")); throw new Error("red on purpose"); });',
    );
    const result = await suite(both);
    assert.notEqual(result.code, 0);
    assert.match(result.reported, /left 1 temporary entry behind: breaklint-failing-fixture-/u);
    assert.deepEqual(result.parentAfter, []);
  });
});
