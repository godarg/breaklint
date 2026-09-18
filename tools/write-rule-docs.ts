#!/usr/bin/env node
/**
 * Writes (or, with `--check`, verifies) the generated remediation block of every rule page.
 *
 * The rule is the source, because it is the one under contract: `Finding.remediation` in report
 * schema 5 carries exactly this text to every consumer. A page may add context AROUND the block;
 * it may not replace it. `tests/unit/registry.test.ts` carries the same assertion from the pure
 * module `rule-docs.ts`, so the unit suite fails on drift without a second runner — and, unlike
 * this file, it imports nothing that writes.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ALL_RULES } from "../src/rules/index.ts";
import { pageNameFor, rewritePageText, type PageStatus } from "./rule-docs.ts";

const docsDir = new URL("../docs/rules/", import.meta.url);
const check = process.argv.includes("--check");
const outcomes: { rule: string; page: string; status: PageStatus }[] = [];

for (const rule of ALL_RULES) {
  const page = pageNameFor(rule);
  const target = fileURLToPath(new URL(page, docsDir));
  const before = readFileSync(target, "utf8");
  const { text, status } = rewritePageText(before, rule);
  outcomes.push({ rule: rule.id, page, status });
  if (!check && status === "rewritten") writeFileSync(target, text, "utf8");
}

const broken = outcomes.filter((o) => o.status === "no-markers");
const drifted = outcomes.filter((o) => o.status === "rewritten");

for (const o of broken) {
  process.stderr.write(`docs/rules/${o.page} has no generated remediation block for ${o.rule}\n`);
}
if (broken.length > 0) process.exitCode = 1;

if (check) {
  for (const o of drifted) {
    process.stderr.write(`docs/rules/${o.page} states a remediation its rule does not: ${o.rule}\n`);
  }
  if (drifted.length > 0) {
    process.stderr.write("run npm run docs:rules:write and review the diff\n");
    process.exitCode = 1;
  }
  if (broken.length === 0 && drifted.length === 0) {
    process.stdout.write(`rule docs carry the remediation of all ${outcomes.length} rules verbatim\n`);
  }
} else {
  process.stdout.write(`rule docs: ${drifted.length} rewritten, ${outcomes.length - drifted.length - broken.length} already current\n`);
}
