// Run from the clean consumer, never resolve through this script's checkout.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(resolve("package.json"));
const entry = require.resolve("breaklint");
assert.ok(entry.startsWith(resolve("node_modules/breaklint/")), "public API must resolve from this consumer");
const api = await import(pathToFileURL(entry).href);
for (const name of ["checkProducedDocuments", "checkPage", "compareReports", "createContextPack", "renderReport", "writeReportBundle"]) assert.equal(typeof api[name], "function", name);
const cjs = require("breaklint");
assert.equal(typeof cjs.checkPage, "function", "Node require(ESM) package entry");
assert.throws(() => require.resolve("breaklint/src/core/engine.ts"), /ERR_PACKAGE_PATH_NOT_EXPORTED|not defined by/);
const { chromium } = require("@playwright/test");
const executablePath = [process.env.BREAKLINT_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((path) => path && existsSync(path));
assert.ok(executablePath, "installed web consumer requires the existing Chrome executable");
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  await page.setContent('<!doctype html><html><body style="margin:0"><div id="wide" style="width:900px;height:100px;background:#aaa">Measured overflow</div></body></html>');
  const before = await page.content();
  const result = await api.checkPage(page, { trust: "host-controlled-page", networkPolicy: "host-owned", scenario: "installed-overflow", output: { dir: resolve("api-evidence"), screenshot: "viewport" } });
  assert.ok(result.report.findings.some((finding) => finding.ruleId === "web/unexpected-horizontal-overflow"), "known visible overflow must be observed");
  assert.equal(await page.content(), before, "adapter must not alter the caller DOM");
  assert.equal(page.isClosed(), false);
  const bundle = await api.writeReportBundle(result.report, { outDir: resolve("api-bundle"), evidenceDir: resolve("api-evidence") });
  assert.deepEqual(JSON.parse(readFileSync(bundle.reportPath, "utf8")), result.report);
  assert.ok(bundle.assets.length > 0, "installed screen bundle must copy its hash-bound screenshot");
  const asset = resolve(bundle.outDir, `assets/${result.report.artifact.sha256}.png`);
  assert.equal(createHash("sha256").update(readFileSync(asset)).digest("hex"), result.report.artifact.sha256);
  assert.ok(readFileSync(bundle.htmlPath, "utf8").includes(`<img style="display:block;width:100%" src="assets/${result.report.artifact.sha256}.png"`), "verified image must be visible in the report");
  assert.equal(api.createContextPack(result.report).canonicalReport.profileKind, "screen");
  writeFileSync("installed-api-result.json", `${JSON.stringify({ version: require("breaklint/package.json").version, profile: result.report.profileKind, findings: result.report.findings.length, artifact: result.report.artifact, bundle }, null, 2)}\n`);
} finally { await browser.close(); }
writeFileSync("public-api-types.mts", `import type { Page } from '@playwright/test';\nimport { checkPage, writeReportBundle } from 'breaklint';\ndeclare const page: Page;\nconst result = await checkPage(page, {trust:'host-controlled-page',networkPolicy:'host-owned',scenario:'types',output:{dir:'out',screenshot:'viewport'}});\nawait writeReportBundle(result.report, {outDir:'out'});\n`);
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "--noEmit", "--strict", "--skipLibCheck", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "public-api-types.mts"], { stdio: "inherit" });
console.log("installed public API contract passed (ESM, require, TypeScript, real Playwright page, canonical bundle)");
