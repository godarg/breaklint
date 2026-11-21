/**
 * breaklint screen checks in a Playwright test, against the static page next to this file.
 *
 * Run it from a project with both packages installed (this folder can be copied as it is):
 *
 *   npm i -D breaklint @playwright/test
 *   npx playwright install chromium
 *   npx playwright test examples/playwright/layout.spec.ts
 *
 * The file is an ES module (it reads its own location from import.meta.url); in a CommonJS
 * project, replace PAGE with a path built from __dirname.
 *
 * The page has one table that is wider than the page. Its wrapper scrolls on purpose.
 * The first test runs in report mode: it attaches the report and only requires that breaklint
 * could judge the page. The second test is the gate the first one leads to: the scroll wrapper is
 * declared as intended, and the page must then be clean.
 */
import { expect, test } from "@playwright/test";
import { checkPage } from "breaklint";

const PAGE = new URL("./layout-demo.html", import.meta.url).href;

// The boundary every call states: the page belongs to the test, and so does its network.
const HOST = { trust: "host-controlled-page", networkPolicy: "host-owned" } as const;

test("report mode: measure the page and attach what breaklint found", async ({ page }, testInfo) => {
  await page.goto(PAGE);
  const { ok, report } = await checkPage(page, {
    ...HOST,
    scenario: "build-matrix",
    output: { dir: testInfo.outputPath("breaklint"), screenshot: "full-page" },
  });
  await testInfo.attach("breaklint-report.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  for (const finding of report.findings) {
    console.log(`${finding.severity} ${finding.ruleId} ${finding.target.selector}`);
  }
  // ok is true for "clean" and "findings": breaklint measured enough to judge the page.
  expect(ok, `breaklint could not judge the page: ${report.runVerdict}`).toBe(true);
});

test("gate: the scroll wrapper is intended, everything else must be clean", async ({ page }, testInfo) => {
  await page.goto(PAGE);
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
