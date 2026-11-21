/**
 * SARIF rule descriptors link to the rule page of the version that wrote the report.
 *
 * GitHub Code Scanning shows a rule's `helpUri` next to every alert. Without it, a reader saw only
 * the one-line summary and never the rule page with its examples and generated remediation. The
 * link is pinned to the release tag (`blob/v<version>/docs/rules/<page>`): a link to `main` would
 * describe whatever the rule has become since, not the rule that judged this report.
 *
 * Only a page that ships gets a link. docs/ is in the package's "files", and every page named here
 * must exist in docs/rules/ of this tree. A rule without a page, or a version that cannot name a
 * release tag, gets no helpUri at all rather than a dead link.
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import * as sarifModule from "../../src/report/sarif.ts";
import { renderSarif } from "../../src/report/sarif.ts";
import { ALL_RULES } from "../../src/rules/index.ts";
import { findingsReportState } from "../fixtures/report-states.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const RULE_DOCS = join(ROOT, "docs/rules");
const TAGGED = /^https:\/\/github\.com\/godarg\/breaklint\/blob\/v(\d+\.\d+\.\d+)\/docs\/rules\/([a-z0-9-]+\.md)$/u;

type Descriptor = { id: string; helpUri?: string };

function descriptors(version: string): Descriptor[] {
  const report = findingsReportState();
  report.tool.version = version;
  return (JSON.parse(renderSarif(report)) as { runs: { tool: { driver: { rules: Descriptor[] } } }[] }).runs[0]!.tool.driver.rules;
}

describe("C9: SARIF helpUri points at the shipped rule page of the release tag", () => {
  it("every rule with a shipped page carries a tag-pinned helpUri to that page", () => {
    const rules = descriptors("0.11.1");
    assert.equal(rules.length, ALL_RULES.length);
    for (const rule of rules) {
      const page = `${rule.id.replace("/", "-")}.md`;
      assert.equal(existsSync(join(RULE_DOCS, page)), true, `${rule.id}: docs/rules/${page} does not exist`);
      assert.ok(rule.helpUri, `${rule.id} has no helpUri`);
      const match = TAGGED.exec(rule.helpUri!);
      assert.ok(match, `${rule.id}: ${rule.helpUri} is not a tag-pinned rule page link`);
      assert.equal(match![1], "0.11.1", "the link names the version that wrote the report");
      assert.equal(match![2], page);
    }
    const files = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { files: string[] }).files;
    assert.ok(files.includes("docs/"), "the rule pages are not in the published package");
  });

  it("the version in the link is the report's own", () => {
    for (const rule of descriptors("0.10.0")) assert.match(rule.helpUri ?? "", /\/blob\/v0\.10\.0\/docs\/rules\//u, rule.id);
  });

  it("a rule without a shipped page, or a version without a release tag, gets no helpUri", () => {
    const ruleHelpUri = (sarifModule as Record<string, unknown>).ruleHelpUri as ((id: string, version: string) => string | undefined) | undefined;
    assert.equal(typeof ruleHelpUri, "function", "sarif.ts exports ruleHelpUri");
    assert.equal(ruleHelpUri!("web/small-text", "0.11.1"), undefined, "no page in docs/rules for a screen rule");
    assert.equal(ruleHelpUri!("layout/not-a-rule", "0.11.1"), undefined);
    assert.equal(ruleHelpUri!("layout/widow", "0.0.0"), undefined, "the unreadable-manifest fallback names no tag");
    assert.equal(ruleHelpUri!("layout/widow", "main"), undefined);
    assert.equal(ruleHelpUri!("layout/widow", "1.2.3/../../x"), undefined);
    for (const rule of descriptors("0.0.0")) assert.equal(rule.helpUri, undefined, rule.id);
    // Pages that exist in docs/rules/ but belong to no registered rule are not linked either.
    const registered = new Set(ALL_RULES.map((rule) => `${rule.id.replace("/", "-")}.md`));
    const unregistered = readdirSync(RULE_DOCS).filter((page) => page.endsWith(".md") && !registered.has(page));
    for (const page of unregistered) {
      const id = page.replace(/\.md$/u, "").replace("-", "/");
      assert.equal(ruleHelpUri!(id, "0.11.1"), undefined, `${page} belongs to no registered rule`);
    }
  });
});
