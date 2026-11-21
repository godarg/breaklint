/**
 * The user documentation stays within its word budgets (tests/tools/doc-word-budgets.mjs holds the
 * one list). The tool's self-test, run here in a child process, is the negative control: a page
 * over budget and a budgeted page that vanished must both be refused.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { checkWordBudgets, countWords, WORD_BUDGETS } from "../tools/doc-word-budgets.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TOOL = join(ROOT, "tests/tools/doc-word-budgets.mjs");

describe("user documentation word budgets", () => {
  it("every budgeted page is within its budget", () => {
    const result = checkWordBudgets(ROOT);
    assert.deepEqual(result.issues, []);
    assert.ok(result.measured.length >= 20, `only ${result.measured.length} pages were measured; the guard has lost its subject`);
  });

  it("counts every word, code and generated blocks included, as wc -w does", () => {
    assert.equal(countWords("a b\n```\nc  d\n```\n<!-- begin generated remediation: x -->\ne\n"), 13);
    const page = readFileSync(join(ROOT, "docs/rules/layout-widow.md"), "utf8");
    assert.equal(countWords(page), page.trim().split(/\s+/u).length);
  });

  it("refuses a page over budget and a budgeted page that vanished (self-test)", () => {
    const run = spawnSync(process.execPath, [TOOL, "--self-test"], { encoding: "utf8", timeout: 60_000 });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /over-budget page and missing page refused/u);
  });

  it("budgets the pages the 0.11.1 documentation plan names", () => {
    assert.deepEqual(Object.keys(WORD_BUDGETS).sort(), [
      "docs/ci-recipe.md", "docs/configuration.md", "docs/known-limits.md", "docs/reporting.md", "docs/rules/*.md",
    ]);
  });
});
