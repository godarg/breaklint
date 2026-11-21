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

  it("measures semi-transparent opacity, filter, backdrop-filter, and CSS Color 4 while keeping opacity:0 and clip-path fail-closed", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    const okResult = await inspect(
      '<div id="faded" style="opacity:.5;filter:drop-shadow(0 2px 4px rgba(0,0,0,.2));backdrop-filter:blur(4px);color:oklch(0.45 0.12 240 / 0.85);background:color(display-p3 0.9 0.95 1 / 80%)">modern paint geometry</div>',
      "modern-paint-v2",
    );
    assert.equal(okResult.ok, true, JSON.stringify(okResult.report.evaluations.filter((e) => e.status === "not-measured")));
    assert.equal(okResult.report.schemaVersion, 2);
    assert.equal(okResult.report.runVerdict, "clean");

    const zeroOpacity = await inspect('<div id="invisible" style="opacity:0">invisible text</div>', "opacity-zero");
    assert.equal(zeroOpacity.ok, false);
    assert.equal(zeroOpacity.report.runVerdict, "insufficient-coverage");
    assert.ok(zeroOpacity.report.evaluations.some((entry) => entry.target.selector === "#invisible" && entry.status === "not-measured" && entry.reason === "evidence/target-not-visible" && entry.evidenceBound === false));

    const clipPath = await inspect('<div id="clipped-shape" style="clip-path:inset(10px)">clipped shape</div>', "clip-path-control");
    assert.equal(clipPath.ok, false);
    assert.equal(clipPath.report.runVerdict, "insufficient-coverage");
    assert.ok(clipPath.report.evaluations.some((entry) => entry.target.selector === "#clipped-shape" && entry.status === "not-measured" && entry.reason === "evidence/paint-unsupported"));
  });

  it("ignores renderer-only empty style serialization, stabilizes transient first-frame layout shifts, and reports structured post-capture drift details", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    const cleanPage = await open('<input id="probe" value="query"><div id="target">stable target</div>');
    try {
      const clean = await checkPage(hostPage(cleanPage, 640, async (rawPage) => {
        await rawPage.evaluate(() => document.querySelector("#probe")?.setAttribute("style", ""));
      }), { trust: "host-controlled-page", networkPolicy: "host-owned", scenario: "renderer-empty-style", output: { dir: output, screenshot: "viewport" } });
      assert.equal(clean.ok, true);
      assert.equal(clean.report.capture.drifted, false);
      assert.equal(clean.report.capture.stabilized, true);
    } finally { await cleanPage.close(); }

    // Transient shift on frame 1 settles on frame 2 within stabilizationTimeoutMs.
    const transientPage = await open('<div id="settling" style="width:100px">settling</div><script>requestAnimationFrame(() => { const el = document.getElementById("settling"); if (el) el.style.width = "160px"; });</script>');
    try {
      const settled = await checkPage(hostPage(transientPage, 640), {
        trust: "host-controlled-page", networkPolicy: "host-owned", scenario: "transient-stabilization",
        output: { dir: output, screenshot: "viewport" }, geometry: { stabilizationTimeoutMs: 1_500 },
      });
      assert.equal(settled.ok, true);
      assert.equal(settled.report.capture.stabilized, true);
      assert.equal(settled.report.capture.drifted, false);
      assert.deepEqual(settled.report.capture.driftDetails, []);
    } finally { await transientPage.close(); }

    const changedPage = await open('<div id="target" style="width:100px">layout target</div>');
    try {
      const changed = await checkPage(hostPage(changedPage, 640, async (rawPage) => {
        await rawPage.evaluate(() => { const target = document.querySelector<HTMLElement>("#target"); if (target) target.style.width = "200px"; });
      }), { trust: "host-controlled-page", networkPolicy: "host-owned", scenario: "renderer-real-geometry-change", output: { dir: output, screenshot: "viewport" } });
      assert.equal(changed.ok, false);
      assert.equal(changed.report.runVerdict, "insufficient-coverage");
      assert.equal(changed.report.capture.drifted, true);
      assert.ok(changed.report.capture.driftDetails?.some((d) => d.phase === "post-screenshot" && d.field === "box" && d.selector === "#target"));
      assert.ok(changed.report.infrastructure.some((entry) => entry.kind === "screen-capture-drift" && entry.detail.includes("#target")));
    } finally { await changedPage.close(); }

    const textChangedPage = await open('<div id="target">first</div>');
    try {
      const textChanged = await checkPage(hostPage(textChangedPage, 640, async (rawPage) => {
        await rawPage.evaluate(() => { const target = document.querySelector("#target"); if (target) target.textContent = "other"; });
      }), { trust: "host-controlled-page", networkPolicy: "host-owned", scenario: "renderer-same-length-text-change", output: { dir: output, screenshot: "viewport" } });
      assert.equal(textChanged.ok, false);
      assert.equal(textChanged.report.capture.drifted, true);
      assert.ok(textChanged.report.capture.driftDetails?.some((d) => d.phase === "post-screenshot" && d.field === "text" && d.selector === "#target"));
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

  it("detects web/sibling-overlap and web/svg-text-overflows-viewport without false positives on normal siblings or SVG shapes", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    const overlap = await inspect(
      '<div style="position:relative"><p id="first" style="margin:0;height:30px">First line</p><p id="second" style="margin:-18px 0 0;height:30px">Overlapping sibling</p></div>' +
      '<div style="width:240px;line-height:22px"><code id="wrap-a">Wrapped inline code spanning across the first line into line two</code> <bdi id="wrap-b">followed immediately by wrapped inline bdi text continuing onto line three</bdi></div>' +
      '<div style="width:300px;line-height:22px"><span id="inline-hit-a">Alpha inline</span><span id="inline-hit-b" style="margin-left:-36px">Overlap inline</span></div>' +
      '<svg width="100" height="40"><rect x="0" y="0" width="100" height="40" fill="#eee"/><rect x="10" y="5" width="80" height="30" fill="#ddd"/><text id="svg-over" x="70" y="24" font-size="20">WayTooWideLabel</text></svg>',
      "sibling-and-svg-overflow",
    );
    assert.equal(overlap.ok, true);
    assert.equal(overlap.report.runVerdict, "findings");
    assert.ok(overlap.report.findings.some((f) => f.ruleId === "web/sibling-overlap" && f.target.selector === "#second" && f.severity === "warn"));
    assert.ok(overlap.report.findings.some((f) => f.ruleId === "web/sibling-overlap" && f.target.selector === "#inline-hit-b" && f.severity === "warn"));
    // Multi-line wrapped inline siblings share a line vertically in getBoundingClientRect()
    // without overlapping in getClientRects() and must never produce a false positive.
    assert.equal(overlap.report.findings.some((f) => f.ruleId === "web/sibling-overlap" && (f.target.selector === "#wrap-a" || f.target.selector === "#wrap-b")), false);
    assert.ok(overlap.report.findings.some((f) => f.ruleId === "web/svg-text-overflows-viewport" && f.target.selector === "#svg-over" && f.severity === "error"));
    // Overlapping SVG <rect> shapes must never trigger web/sibling-overlap.
    assert.equal(overlap.report.findings.some((f) => f.ruleId === "web/sibling-overlap" && f.target.tag === "rect"), false);
  });

  it("measures below-the-fold targets in full-page screenshot mode using css-document-pixels", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    const page = await open('<div style="height:650px">above fold spacer</div><div id="below-wide" style="width:300px;height:40px"><div style="width:900px;height:30px">below fold overflow</div></div>');
    try {
      const vpRes = await checkPage(hostPage(page, 640), {
        trust: "host-controlled-page", networkPolicy: "host-owned", scenario: "viewport-excludes-below-fold",
        output: { dir: output, screenshot: "viewport" },
      });
      assert.equal(
        vpRes.report.evaluations.some((e) => e.target.selector === "#below-wide" && e.status === "excluded" && e.reason === "target/off-viewport"),
        true,
        "viewport mode must still exclude below-the-fold targets as target/off-viewport",
      );
      const fullRes = await checkPage(hostPage(page, 640), {
        trust: "host-controlled-page", networkPolicy: "host-owned", scenario: "full-page-coverage",
        output: { dir: output, screenshot: "full-page" },
      });
      assert.equal(fullRes.ok, true);
      assert.equal(fullRes.report.artifact.coordinateSystem, "css-document-pixels");
      const below = fullRes.report.findings.find((f) => f.ruleId === "web/unexpected-horizontal-overflow" && f.target.selector === "#below-wide");
      assert.ok(below, "below-the-fold overflow must be measured in full-page mode");
      assert.equal(below.target.coordinateSystem, "css-document-pixels");
      assert.ok((below.target.box?.y ?? 0) >= 600);
    } finally { await page.close(); }
  });

  it("evaluates opt-in web/small-text and web/small-touch-target and honors suite-scoped exceptions", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    const res = await inspect(
      '<p id="tiny" style="font-size:9px">Tiny text</p>' +
      '<p>Running prose with <a id="prose-link" href="#a" style="font-size:14px">inline link</a> inside paragraph.</p>' +
      '<button id="tiny-btn" style="width:16px;height:16px;padding:0;font-size:12px">x</button>',
      "opt-in-and-suite-scope",
      {
        allowedScrollContainers: [{ selector: ".unused-suite-grid", reason: "shared suite grid", scope: "suite" }],
        intentionalOverlays: [{ selector: ".unused-scenario-modal", reason: "scenario modal", scope: "scenario" }],
        rules: { smallText: { minFontSizePx: 12 }, smallTouchTarget: { minSizePx: 24 } },
      },
    );
    assert.equal(res.ok, true);
    assert.ok(res.report.findings.some((f) => f.ruleId === "web/small-text" && f.target.selector === "#tiny" && f.measurement.calibrated === false));
    assert.ok(res.report.findings.some((f) => f.ruleId === "web/small-touch-target" && f.target.selector === "#tiny-btn" && f.measurement.calibrated === false));
    // Inline link inside running prose is exempt from small-touch-target.
    assert.equal(res.report.findings.some((f) => f.ruleId === "web/small-touch-target" && f.target.selector === "#prose-link"), false);
    // Suite-scoped unused exception suppresses screen-exception-unused event while retaining count: 0 in coverage.
    assert.equal(res.report.coverage.allowedScrollContainers[0]?.scope, "suite");
    assert.equal(res.report.coverage.allowedScrollContainers[0]?.count, 0);
    assert.equal(res.report.events.some((e) => e.kind === "screen-exception-unused" && e.detail.includes(".unused-suite-grid")), false);
    assert.equal(res.report.events.some((e) => e.kind === "screen-exception-unused" && e.detail.includes(".unused-scenario-modal")), true);
  });
});
