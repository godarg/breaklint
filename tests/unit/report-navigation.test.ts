import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { parse, type DefaultTreeAdapterMap } from "parse5";

import type { Report } from "../../src/core/types.ts";
import { renderConsole } from "../../src/report/console.ts";
import { renderHtml } from "../../src/report/html.ts";
import { renderMarkdown } from "../../src/report/markdown.ts";
import { render } from "../../src/report/index.ts";
import { findingsReportState } from "../fixtures/report-states.ts";
import { buildHtmlReportModel } from "../../src/report/html-model.ts";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

function elements(node: HtmlNode): HtmlElement[] {
  const own = "tagName" in node ? [node] : [];
  return [...own, ...("childNodes" in node ? node.childNodes.flatMap(elements) : [])];
}

const attribute = (element: HtmlElement, name: string): string | undefined =>
  element.attrs.find((attr) => attr.name === name)?.value;

function textContent(node: HtmlNode): string {
  if ("value" in node) return node.value;
  return "childNodes" in node ? node.childNodes.map(textContent).join("") : "";
}

function assertFindingNavigationTargets(className: string, expectedLinks: number): void {
  const nodes = elements(parse(renderHtml(navigationReport())));
  const container = nodes.find((node) => attribute(node, "class")?.split(" ").includes(className));
  assert.ok(container, `Missing ${className}`);
  const links = elements(container).filter((node) => node.tagName === "a");
  assert.equal(links.length, expectedLinks);
  for (const link of links) {
    const href = attribute(link, "href");
    assert.ok(href, "Finding navigation must have an href");
    assert.ok(href.startsWith("#"), "Finding navigation must remain in-page");
    const targets = nodes.filter((node) => attribute(node, "id") === href.slice(1));
    assert.equal(targets.length, 1, `${href} must identify exactly one target`);
    assert.ok(["h1", "h2", "h3", "h4", "h5", "h6", "section"].includes(targets[0]!.tagName),
      `${href} targets <${targets[0]!.tagName}> instead of a heading or section`);
  }
  // Existing article anchors and accessible names are independent of navigation destinations.
  const articles = nodes.filter((node) => node.tagName === "article");
  assert.deepEqual(articles.map((node) => attribute(node, "id")),
    ["finding-1", "finding-2", "finding-3", "finding-4", "finding-5"]);
  for (const article of articles) {
    const titleId = `${attribute(article, "id")}-title`;
    assert.equal(attribute(article, "aria-labelledby"), titleId);
    assert.equal(elements(article).filter((node) => node.tagName === "h3" && attribute(node, "id") === titleId).length, 1);
  }
}

// Hand-written presentation oracle: five distinct findings, including two for the same rule.
// This tests navigation and disclosure, not whether a layout rule should emit these findings.
function navigationReport(): Report {
  const report = findingsReportState();
  // This hand-written navigation oracle has five findings; newly registered rules must
  // not turn its inherited source-less fixture into an unrelated coverage-failure state.
  report.runVerdict = "findings";
  report.exitCode = 1;
  report.documents[0]!.verdict = "findings";
  const seed = report.findings[0]!;
  const rules = ["layout/widow", "layout/widow", "layout/orphan", "type/straight-quotes", "layout/half-empty-page"];
  report.findings = rules.map((ruleId, index) => ({
    ...structuredClone(seed),
    runFindingId: `navigation-${index + 1}`,
    ruleId,
    severity: index === 2 ? "error" : "warn",
    experimental: index === 4,
    page: index + 1,
    message: `Visible measurement ${index + 1}: <sample> | two lines\nremain data.`,
  }));
  report.documents[0]!.findings = report.findings;
  report.documents[0]!.notMeasured = [
    { scope: "block", ruleId: "layout/widow", reason: "env/multicolumn", target: null, count: 2 },
    { scope: "block", ruleId: "layout/widow", reason: "env/multicolumn", target: null, count: 3 },
    { scope: "block", ruleId: "layout/widow", reason: "env/forced-break", target: null, count: 1 },
    { scope: "document", ruleId: null, reason: "env/vertical-writing", target: null, count: 4 },
  ];
  report.documents[0]!.coverage = {
    "layout/widow": { candidates: 20, measured: 14, notMeasured: report.documents[0]!.notMeasured.slice(0, 3), notMeasuredCount: 6, coverage: 0.7, floor: 0.5, ok: true },
  };
  return report;
}

// Independent presentation arithmetic: three applicable SVG/widow evaluations are measured,
// two applicable widow evaluations are declined, and two SVG evaluations leave coverage.
// The document-level count is deliberately unrelated to those rule accounts.
function coverageAccountingReport(): Report {
  const report = navigationReport();
  const nonApplicable = { scope: "block" as const, ruleId: "svg/text-overflows-viewport", reason: "env/svg-overflow-visible" as const, target: null, count: 1 };
  const toolUnavailable = { scope: "block" as const, ruleId: "svg/text-overflows-viewport", reason: "env/pixel-oracle-unavailable" as const, target: null, count: 1 };
  const applicable = { scope: "block" as const, ruleId: "layout/widow", reason: "env/multicolumn" as const, target: null, count: 2 };
  report.documents[0]!.coverage = {
    "svg/text-overflows-viewport": { candidates: 1, measured: 1, notMeasured: [nonApplicable, toolUnavailable], notMeasuredCount: 2, coverage: 1, floor: 1, ok: true },
    "layout/widow": { candidates: 4, measured: 2, notMeasured: [applicable], notMeasuredCount: 2, coverage: 0.5, floor: 1, ok: false },
  };
  report.documents[0]!.notMeasured = [nonApplicable, toolUnavailable, applicable,
    { scope: "document", ruleId: null, reason: "env/vertical-writing", target: null, count: 9 }];
  report.runVerdict = "insufficient-coverage";
  report.exitCode = 4;
  report.documents[0]!.verdict = "insufficient-coverage";
  return report;
}

describe("human report navigation", () => {
  it("distinguishes applicable rule evaluations from outside-coverage declines without summing document objects", () => {
    const report = coverageAccountingReport();
    const original = JSON.stringify(report);
    for (const output of [renderConsole(report), textContent(parse(renderHtml(report))), renderMarkdown(report)]) {
      assert.match(output, /rule-candidate evaluations, not unique document objects/u);
      assert.match(output, /3 of 5 applicable rule-candidate evaluations measured/u);
      assert.match(output, /2 applicable evaluations not measured/u);
      assert.match(output, /outside coverage base: 1 not applicable, 1 unavailable tool capability/u);
      assert.match(output, /2 of 4 applicable rule-candidate evaluations measured; 2 applicable evaluations not measured; outside coverage base: 0 not applicable, 0 unavailable tool capability; required floor 100%/u);
      assert.doesNotMatch(output, /floor 1\./u);
    }
    const svgRow = buildHtmlReportModel(report).coverage[0]!.rows.find(row => row.ruleId === "svg/text-overflows-viewport")!;
    assert.equal(svgRow.candidates, 1);
    assert.equal(svgRow.measured, 1);
    assert.equal(svgRow.notMeasured, 0, "The unmeasured coverage cell must exclude the two outside-base evaluations");
    assert.equal(JSON.stringify(report), original, "Presentation must preserve all canonical counts and reasons");
  });

  it("targets a heading or section from every next-check link", () => {
    assertFindingNavigationTargets("next-check-list", 3);
  });

  it("targets a heading or section from every grouped-rule navigation link", () => {
    assertFindingNavigationTargets("finding-navigation", 4);
  });

  it("labels each HTML decline count before its reason and keeps label and value together", () => {
    const nodes = elements(parse(renderHtml(navigationReport())));
    const list = nodes.find((node) => attribute(node, "class") === "decline-list");
    assert.ok(list);
    const items = elements(list).filter((node) => node.tagName === "li");
    assert.equal(items.length, 3);
    const expected = [
      { reason: "env/vertical-writing", count: 4, rule: "no rule", scope: "document" },
      { reason: "env/forced-break", count: 1, rule: "layout/widow", scope: "block" },
      { reason: "env/multicolumn", count: 5, rule: "layout/widow", scope: "block" },
    ];
    for (const row of expected) {
      const item = items.find((node) => textContent(node).includes(row.reason));
      assert.ok(item, `Missing decline reason ${row.reason}`);
      const countLabels = elements(item).filter((node) => attribute(node, "class") === "decline-count");
      assert.equal(countLabels.length, 1, `${row.reason} needs one explicit count label`);
      assert.equal(textContent(countLabels[0]!), `Count ${row.count}`);
      assert.equal(textContent(item), `Count ${row.count} · examples/demo.html · ${row.rule} · ${row.scope} · ${row.reason}`);
    }
    const styles = nodes.filter((node) => node.tagName === "style").map(textContent).join("\n");
    assert.match(styles, /\.decline-count\s*\{[^}]*white-space:\s*nowrap\s*;/u);
  });

  it("discloses counted decline reasons even when the coverage floor is met", () => {
    const report = navigationReport();
    // HTML's labeled count/reason tuples are checked independently in the parsed DOM above.
    for (const output of [renderConsole(report), renderMarkdown(report)]) {
      assert.match(output, /Declined candidates/u);
      assert.match(output, /env\/multicolumn[^\n]*5/u);
      assert.match(output, /env\/forced-break[^\n]*1/u);
      assert.match(output, /env\/vertical-writing[^\n]*4/u);
    }
    assert.equal(report.documents[0]!.coverage["layout/widow"]!.ok, true);
  });

  it("selects at most three next checks with measurement limits first and no input mutation", () => {
    const report = navigationReport();
    report.runVerdict = "insufficient-coverage";
    report.exitCode = 4;
    report.documents[0]!.verdict = "insufficient-coverage";
    report.documents[0]!.coverage["layout/widow"]!.ok = false;
    const original = JSON.stringify(report);
    for (const output of [renderConsole(report), renderHtml(report), renderMarkdown(report)]) {
      assert.match(output, /Next checks/u);
      assert.match(output, /Restore measurement before interpreting partial findings/u);
      assert.ok(output.indexOf("Restore measurement") < output.indexOf("Inspect findings for"));
      assert.equal((output.match(/Restore measurement|Inspect coverage for|Inspect findings for/gu) ?? []).length, 3);
      assert.doesNotMatch(output, /reader impact|confirmed cause/iu);
    }
    assert.equal(JSON.stringify(report), original);
    assert.equal(JSON.parse(render(report, "json")).findings.length, 5);
    const reversed = structuredClone(report);
    reversed.findings.reverse();
    reversed.documents[0]!.findings = reversed.findings;
    const checks = (html: string) => /<section class="next-checks"[\s\S]*?<\/section>/u.exec(html)?.[0];
    // Only the navigation target may change with the canonical finding order.
    assert.equal(checks(renderHtml(report))?.replace(/href="#finding-\d+(?:-title)?"/gu, ""), checks(renderHtml(reversed))?.replace(/href="#finding-\d+(?:-title)?"/gu, ""));
  });

  it("offers rule count navigation while retaining all five distinct findings", () => {
    const report = navigationReport();
    const html = renderHtml(report);
    assert.match(html, /<details class="finding-navigation">/u);
    assert.match(html, /Findings by rule \(4 rules\)/u);
    const navigation = /<details class="finding-navigation">[\s\S]*?<\/details>/u.exec(html)?.[0] ?? "";
    assert.match(navigation.replace(/<[^>]+>/gu, ""), /layout\/widow[^\n]*2 findings/u);
    assert.equal((html.match(/<article class="finding /gu) ?? []).length, 5);
    for (const finding of report.findings) {
      assert.ok(renderConsole(report).includes(`Visible measurement ${finding.page}:`));
      assert.ok(renderMarkdown(report).includes(`Visible measurement ${finding.page}:`));
      assert.ok(html.includes(`Visible measurement ${finding.page}:`));
    }
  });

  it("includes each actual message and rule remedy with its tested flag in Markdown as inert text", () => {
    const report = findingsReportState();
    report.findings[0]!.message = "Measured <script>alert(1)</script> | value\ncontinued. [link](javascript:alert(1))";
    const output = renderMarkdown(report);
    for (const finding of report.findings) {
      assert.ok(output.includes(finding.runFindingId));
      if (finding.remediation) {
        const visibleText = output.replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&amp;/gu, "&").replace(/\\\|/gu, "|");
        assert.ok(visibleText.includes(finding.remediation.advice));
        assert.ok(output.includes(`Remediation tested: ${finding.remediation.tested ? "yes" : "no (untested)"}`));
      }
    }
    assert.match(output, /Measured &lt;script&gt;alert\(1\)&lt;\/script&gt; \\?\| value continued\./u);
    assert.doesNotMatch(output, /<script>/u);
    assert.doesNotMatch(output, /\[link\]\(javascript:/u);
  });
});
