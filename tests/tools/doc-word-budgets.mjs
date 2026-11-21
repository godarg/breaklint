#!/usr/bin/env node
/**
 * The user documentation stays readable: each page has a word budget, and the budgets live here
 * and nowhere else.
 *
 * WHY THIS EXISTS. By 0.11.0 the pages a user reads had grown into maintainer records:
 * `docs/reporting.md` 8 584 words, `docs/ci-recipe.md` 2 375, one rule page 2 160. Each sentence
 * had a reason; together they hid the answer a reader came for. 0.11.1 moved the record to
 * `maintainers/` and cut the pages to these budgets. A budget nobody measures grows back, so this
 * measures it.
 *
 * COUNTING. A word is a run of non-whitespace characters, over the whole file — prose, tables,
 * code blocks and the generated remediation blocks alike (`wc -w` gives the same number). Nothing
 * is excluded, so nothing can be moved into an uncounted shape to pass.
 *
 * `--check` measures the repository's pages and exits 1 on any page over budget, or on a budgeted
 * page or glob that matches no file (a renamed page must take its budget with it). `--self-test`
 * runs the check against a temporary tree with one page over budget and one budgeted page missing,
 * and requires both to be refused, and the same tree within budget to pass.
 */

import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The one list of budgets. A key ending in `/*.md` applies to every Markdown file in that directory. */
export const WORD_BUDGETS = Object.freeze({
  "README.md": 1200,
  "docs/screen-checks.md": 1500,
  "docs/known-limits.md": 1000,
  "docs/reporting.md": 2000,
  "docs/ci-recipe.md": 1200,
  "docs/configuration.md": 1500,
  "docs/rules/*.md": 600,
});

export function countWords(text) {
  return text.split(/\s+/u).filter(Boolean).length;
}

function filesFor(root, key) {
  if (!key.endsWith("/*.md")) return existsSync(join(root, key)) ? [key] : [];
  const dir = key.slice(0, -"/*.md".length);
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir)).filter((name) => name.endsWith(".md")).sort().map((name) => `${dir}/${name}`);
}

/** `{ valid, issues, measured }` for the pages under `root`. */
export function checkWordBudgets(root = ROOT, budgets = WORD_BUDGETS) {
  const issues = [];
  const measured = [];
  for (const [key, budget] of Object.entries(budgets)) {
    const files = filesFor(root, key);
    if (files.length === 0) issues.push(`${key} has a budget of ${budget} words but matches no file; move the budget with the page`);
    for (const file of files) {
      const words = countWords(readFileSync(join(root, file), "utf8"));
      measured.push({ file, words, budget });
      if (words > budget) issues.push(`${file} has ${words} words, over its budget of ${budget}: cut it, or move maintainer detail to maintainers/`);
    }
  }
  return { valid: issues.length === 0, issues, measured };
}

function selfTest() {
  const scratch = mkdtempSync(join(tmpdir(), "breaklint-word-budgets-"));
  try {
    const budgets = { "docs/page.md": 5, "docs/rules/*.md": 5 };
    mkdirSync(join(scratch, "docs/rules"), { recursive: true });
    writeFileSync(join(scratch, "docs/page.md"), "one two three four five\n");
    writeFileSync(join(scratch, "docs/rules/a.md"), "one two\n```\nthree\n```\n");
    const within = checkWordBudgets(scratch, budgets);
    assert.deepEqual(within.issues, [], "positive control: a tree within budget was refused");
    writeFileSync(join(scratch, "docs/rules/b.md"), "one two three\n```css\np { x }\n```\n");
    const over = checkWordBudgets(scratch, budgets);
    assert.equal(over.valid, false, "a rule page over budget (code included) passed");
    assert.match(over.issues.join("\n"), /docs\/rules\/b\.md has 9 words, over its budget of 5/u);
    rmSync(join(scratch, "docs/page.md"));
    rmSync(join(scratch, "docs/rules/b.md"));
    const missing = checkWordBudgets(scratch, budgets);
    assert.match(missing.issues.join("\n"), /docs\/page\.md has a budget of 5 words but matches no file/u, "a budgeted page that vanished passed");
    process.stdout.write("doc word budgets self-test: over-budget page and missing page refused, page within budget accepted\n");
    return 0;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function main(args) {
  if (args.length === 1 && args[0] === "--self-test") return selfTest();
  if (args.length !== 1 || args[0] !== "--check") {
    process.stderr.write("usage: doc-word-budgets.mjs --check | --self-test\n");
    return 2;
  }
  const result = checkWordBudgets();
  if (!result.valid) {
    process.stderr.write(`doc word budgets: FAILED\n${result.issues.map((issue) => `  - ${issue}`).join("\n")}\n`);
    return 1;
  }
  process.stdout.write(`doc word budgets: ${result.measured.length} pages within budget\n`);
  return 0;
}

const isMain = Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) process.exitCode = main(process.argv.slice(2));
