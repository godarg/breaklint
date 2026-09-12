import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { launchBrowser, resolveBrowser, type BrowserLike, type PageLike } from "../../src/acquire/browser.ts";
import { cleanupBrowserProfile, closeBrowserBounded } from "../../src/acquire/render-run.ts";
import { checkPage } from "../../src/api/check-page.ts";
import type { StructuralPage } from "../../src/web/types.ts";

const REPO = new URL("../..", import.meta.url).pathname;
const optional = process.env.BREAKLINT_LIVE_OPTIONAL === "1";
const missingBrowser = resolveBrowser().path === null;

describe("screen checkPage host-page adapter, live", () => {
  let browser: BrowserLike | null = null;
  let profile: string | null = null;
  const output = mkdtempSync(join(tmpdir(), "breaklint-screen-check-"));

  before(async (t) => {
    if (missingBrowser) {
      if (optional) return (t as { skip(message: string): void }).skip("missing browser");
      assert.fail("screen adapter regression requires browser");
    }
    const launched = await launchBrowser(REPO);
    assert.ok(launched.browser, launched.detail);
    browser = launched.browser;
    profile = launched.userDataDir ?? null;
  });
  after(async () => {
    const error = browser ? await closeBrowserBounded(browser) : null;
    assert.equal(error, null);
    assert.equal(cleanupBrowserProfile(profile), null);
  });

  async function open(html: string, width = 640): Promise<PageLike> {
    const page = await browser!.newPage();
    await page.setViewport({ width, height: 400 });
    await page.setContent(`<!doctype html><style>body{margin:0;font:16px sans-serif}</style>${html}`, { waitUntil: "load" });
    return page;
  }
  function hostPage(page: PageLike, width: number, beforeScreenshot?: (page: PageLike) => Promise<void>): StructuralPage {
    // Puppeteer is only the local live harness. This facade is intentionally the smaller
    // published Playwright-compatible structural contract and never gives checkPage lifecycle
    // methods such as goto, setContent, close, or viewport mutation.
    const raw = page as unknown as { screenshot(options?: { fullPage?: boolean }): Promise<Uint8Array>; url(): string };
    return {
      evaluate: page.evaluate.bind(page) as StructuralPage["evaluate"],
      screenshot: async (options) => { if (beforeScreenshot) await beforeScreenshot(page); return raw.screenshot(options); }, url: raw.url.bind(raw), viewportSize: () => ({ width, height: 400 }),
      context: () => ({ browser: () => ({ version: () => "local-live-host" }) }),
    };
  }
  async function inspect(html: string, scenario: string, geometry: Record<string, unknown> = {}) {
    const page = await open(html);
    try {
      return await checkPage(hostPage(page, 640), {
        trust: "host-controlled-page", networkPolicy: "host-owned", scenario,
        output: { dir: output, screenshot: "viewport" }, geometry,
      });
    } finally { await page.close(); }
  }

  it("reports real unexpected horizontal overflow and writes a hashed viewport PNG", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    const result = await inspect('<div id="overflow" style="width:1000px;height:30px">wide</div>', "overflow");
    assert.equal(result.ok, true);
    assert.equal(result.report.profileKind, "screen");
    assert.equal(result.report.runVerdict, "findings");
    assert.ok(result.report.findings.some((finding) => finding.ruleId === "web/unexpected-horizontal-overflow"));
    assert.ok(result.report.artifact.relativePath && existsSync(join(output, result.report.artifact.relativePath)));
    assert.ok(result.report.artifact.sha256);
    assert.equal(result.report.scope.url.includes("?"), false);
  });

  it("counts a named horizontal scroll container as an exclusion instead of a finding", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    const result = await inspect('<div id="allowed" style="width:300px;overflow-x:auto"><div style="width:1000px">wide but intended</div></div>', "allowed-scroll", { allowedScrollContainers: [{ selector: "#allowed", reason: "data grid" }] });
    assert.equal(result.ok, true);
    assert.equal(result.report.runVerdict, "clean");
    assert.equal(result.report.coverage.allowedScrollContainers[0]?.count, 1);
    assert.ok(result.report.evaluations.some((entry) => entry.reason === "target/allowed-scroll-container"));
  });

  it("finds visible content cut by an overflow:hidden rectangle", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    const result = await inspect('<div id="clip" style="width:200px;overflow:hidden"><div id="cut" style="width:500px">clipped text</div></div>', "clipping");
    assert.equal(result.ok, true);
    assert.equal(result.report.runVerdict, "findings");
    assert.ok(result.report.findings.some((finding) => finding.ruleId === "web/content-clipped"));
  });

  it("does not bind transparent paint and finds own direct text clipping unless it is named allowed scrolling", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    const transparentText = await inspect('<div style="-webkit-text-fill-color:transparent"><span id="target">hidden text</span></div>', "transparent-text-fill");
    assert.equal(transparentText.ok, false);
    assert.ok(transparentText.report.evaluations.some((entry) => entry.target.selector === "#target" && entry.status === "not-measured" && entry.reason === "evidence/target-not-visible"));

    const transparentSvg = await inspect('<svg><text id="svg-target" x="10" y="20" fill="black" fill-opacity="0" stroke="black" stroke-opacity="0">hidden svg</text></svg>', "transparent-svg-paint");
    assert.equal(transparentSvg.ok, false);
    assert.ok(transparentSvg.report.evaluations.some((entry) => entry.target.selector === "#svg-target" && entry.status === "not-measured" && entry.reason === "evidence/target-not-visible"));

    const ownClip = '<div id="target" style="width:180px;height:20px;line-height:20px;overflow:hidden;white-space:pre-wrap">one\ntwo\nthree</div>';
    const clipped = await inspect(ownClip, "own-direct-text-clipped");
    assert.equal(clipped.ok, true);
    assert.ok(clipped.report.findings.some((finding) => finding.ruleId === "web/content-clipped" && finding.target.selector === "#target"));

    const allowed = await inspect(ownClip, "own-direct-text-allowed", { allowedScrollContainers: [{ selector: "#target", reason: "intentional compact scroller" }] });
    assert.equal(allowed.ok, true);
    assert.equal(allowed.report.runVerdict, "clean");
    assert.ok(allowed.report.evaluations.some((entry) => entry.target.selector === "#target" && entry.ruleId === "web/content-clipped" && entry.reason === "target/allowed-scroll-container"));
  });

  it("keeps an opacity control observable but unbound and not successful", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    const result = await inspect('<div id="faded" style="opacity:.5">same geometry</div>', "opacity");
    assert.equal(result.ok, false);
    assert.equal(result.report.runVerdict, "insufficient-coverage");
    assert.ok(result.report.evaluations.some((entry) => entry.status === "not-measured" && entry.evidenceBound === false));
  });

  it("ignores renderer-only empty style serialization but retains real post-capture geometry drift", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    const cleanPage = await open('<input id="probe" value="query"><div id="target">stable target</div>');
    try {
      // Chromium screenshot paths may materialize this empty attribute. The host facade simulates
      // that renderer behavior; checkPage itself receives no mutating page API.
      const clean = await checkPage(hostPage(cleanPage, 640, async (rawPage) => {
        await rawPage.evaluate(() => document.querySelector("#probe")?.setAttribute("style", ""));
      }), { trust: "host-controlled-page", networkPolicy: "host-owned", scenario: "renderer-empty-style", output: { dir: output, screenshot: "viewport" } });
      assert.equal(clean.ok, true);
      assert.equal(clean.report.capture.drifted, false);
    } finally { await cleanPage.close(); }

    const changedPage = await open('<div id="target" style="width:100px">layout target</div>');
    try {
      const changed = await checkPage(hostPage(changedPage, 640, async (rawPage) => {
        await rawPage.evaluate(() => { const target = document.querySelector<HTMLElement>("#target"); if (target) target.style.width = "200px"; });
      }), { trust: "host-controlled-page", networkPolicy: "host-owned", scenario: "renderer-real-geometry-change", output: { dir: output, screenshot: "viewport" } });
      assert.equal(changed.ok, false);
      assert.equal(changed.report.runVerdict, "insufficient-coverage");
      assert.equal(changed.report.capture.drifted, true);
      assert.ok(changed.report.infrastructure.some((entry) => entry.kind === "screen-capture-drift"));
    } finally { await changedPage.close(); }

    const textChangedPage = await open('<div id="target">first</div>');
    try {
      const textChanged = await checkPage(hostPage(textChangedPage, 640, async (rawPage) => {
        await rawPage.evaluate(() => { const target = document.querySelector("#target"); if (target) target.textContent = "other"; });
      }), { trust: "host-controlled-page", networkPolicy: "host-owned", scenario: "renderer-same-length-text-change", output: { dir: output, screenshot: "viewport" } });
      assert.equal(textChanged.ok, false);
      assert.equal(textChanged.report.capture.drifted, true);
    } finally { await textChangedPage.close(); }

    const hidden = await inspect('<style>html,body,body *{display:none}</style><div>unobservable</div>', "nothing-measured");
    assert.equal(hidden.ok, false);
    assert.equal(hidden.report.runVerdict, "insufficient-coverage");
    assert.equal(hidden.report.coverage.measured, 0);
  });

  it("keeps an active animation observable but unbound and not successful", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    const result = await inspect('<style>@keyframes pulse{from{opacity:1}to{opacity:.99}}</style><div id="moving" style="animation:pulse 5s infinite">same geometry</div>', "animation");
    assert.equal(result.ok, false);
    assert.equal(result.report.runVerdict, "insufficient-coverage");
    assert.ok(result.report.evaluations.some((entry) => entry.status === "not-measured" && entry.evidenceBound === false));
  });
});
