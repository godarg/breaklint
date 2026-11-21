/**
 * breaklint screen checks in a Playwright test, against the static page next to this file.
 *
 * Run it from any project, CommonJS or ES module (this folder can be copied as it is):
 *
 *   npm i -D breaklint @playwright/test
 *   npx playwright install chromium
 *   npx playwright test examples/playwright/layout.spec.ts
 *
 * The page has one table that is wider than the page. Its wrapper scrolls on purpose.
 * The first test runs in report mode: it PASSES WITH FINDINGS. It prints each finding, adds it as
 * an annotation and attaches the report, and requires only that breaklint could judge the page.
 * The second test is the gate the first one leads to: the scroll wrapper is declared as intended,
 * and the page must then be clean.
 */
import { expect, test, type TestInfo } from "@playwright/test";
import { checkPage } from "breaklint";

// The page next to this file, found through Playwright's record of the test file: no import.meta
// (ES modules only) and no __dirname (CommonJS only). Each path segment is URL-encoded.
const pageUrl = (testInfo: TestInfo) =>
  new URL("layout-demo.html", `file://${testInfo.file.split("/").map(encodeURIComponent).join("/")}`).href;

// The boundary every call states: the page belongs to the test, and so does its network.
const HOST = { trust: "host-controlled-page", networkPolicy: "host-owned" } as const;

test("report mode: passes with findings, and lists them", async ({ page }, testInfo) => {
  await page.goto(pageUrl(testInfo));
  const { ok, report } = await checkPage(page, {
    ...HOST,
    scenario: "build-matrix",
    output: { dir: testInfo.outputPath("breaklint"), screenshot: "full-page" },
  });
  await testInfo.attach("breaklint-report.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  for (const finding of report.findings) {
    const line = `${finding.severity} ${finding.ruleId} ${finding.target.selector}`;
    console.log(line);
    testInfo.annotations.push({ type: "breaklint finding", description: line });
  }
  // ok is true for "clean" AND "findings": it says only that breaklint measured enough to judge.
  expect(ok, `breaklint could not judge the page: ${report.runVerdict}`).toBe(true);
});

test("gate: the scroll wrapper is intended, everything else must be clean", async ({ page }, testInfo) => {
  await page.goto(pageUrl(testInfo));
  const { report } = await checkPage(page, {
    ...HOST,
    scenario: "build-matrix-gate",
    output: { dir: testInfo.outputPath("breaklint"), screenshot: "full-page" },
    failOn: "error",
    geometry: {
      allowedScrollContainers: [{ selector: ".table-scroll", reason: "the build matrix scrolls sideways on purpose" }],
      rules: { smallTouchTarget: true },
    },
  });
  await testInfo.attach("breaklint-report.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  expect(report.findings.filter((finding) => finding.severity === "error")).toEqual([]);
  expect(report.runVerdict).toBe("clean");
});
