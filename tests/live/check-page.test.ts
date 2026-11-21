import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { launchBrowser, resolveBrowser, type BrowserLike, type PageLike } from "../../src/acquire/browser.ts";
import { cleanupBrowserProfile, closeBrowserBounded } from "../../src/acquire/render-run.ts";
import { checkPage, parseCssColorAlpha, samplePage } from "../../src/api/check-page.ts";
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
  async function inspect(html: string, scenario: string, geometry: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
    const page = await open(html);
    try {
      return await checkPage(hostPage(page, 640), {
        trust: "host-controlled-page", networkPolicy: "host-owned", scenario,
        output: { dir: output, screenshot: "viewport" }, geometry, ...extra,
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

  it("excludes only an allowed scroll container's own overflow and its clipping, keeps measuring descendants, and fails closed on html/body", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    // Negative control: an allowed scroll container on body would exempt every paragraph.
    const paragraphs = '<p id="p1">First paragraph.</p><p id="p2">Second paragraph.</p><p id="p3">Third paragraph.</p>';
    for (const [field, selector] of [["allowedScrollContainers", "body"], ["allowedScrollContainers", "html"], ["intentionalOverlays", "body"]] as const) {
      const broad = await inspect(paragraphs, `broad-${field}-${selector}`, { [field]: [{ selector, reason: "too broad" }] });
      assert.equal(broad.ok, false, `${field} ${selector}`);
      assert.equal(broad.report.runVerdict, "insufficient-coverage", `${field} ${selector}`);
      assert.ok(broad.report.events.some((e) => e.kind === "screen-exception-too-broad" && e.detail.includes(selector)), `${field} ${selector}: ${JSON.stringify(broad.report.events)}`);
    }

    // Positive control: inside an allowed <main> scroller, a child that overflows itself and a
    // grandchild cut by a non-allowed clipping box are still defects.
    const scroller = await inspect(
      '<main id="main" style="display:block;width:300px;overflow-x:auto">' +
      '<div id="kid" style="width:200px"><div style="width:500px;height:20px">wide inner content</div></div>' +
      '<div id="clipbox" style="width:150px;overflow:hidden;white-space:nowrap"><div id="cut" style="width:400px">clipped by a non-allowed box</div></div>' +
      "</main>",
      "allowed-main-scroller",
      { allowedScrollContainers: [{ selector: "#main", reason: "page scroller" }] },
    );
    assert.equal(scroller.report.runVerdict, "findings", JSON.stringify(scroller.report.evaluations.filter((e) => e.target.selector.startsWith("#")).map((e) => [e.target.selector, e.ruleId, e.status, e.reason])));
    assert.ok(scroller.report.findings.some((f) => f.ruleId === "web/unexpected-horizontal-overflow" && f.target.selector === "#kid"));
    assert.ok(scroller.report.findings.some((f) => f.ruleId === "web/content-clipped" && f.target.selector === "#cut"));
    // The container's own horizontal overflow stays exempt.
    assert.ok(scroller.report.evaluations.some((e) => e.target.selector === "#main" && e.ruleId === "web/unexpected-horizontal-overflow" && e.status === "excluded" && e.reason === "target/allowed-scroll-container"));
    assert.equal(scroller.report.events.some((e) => e.kind === "screen-exception-too-broad"), false);

    // A legitimate horizontal scroll list stays clean; its items are measured.
    const items = [1, 2, 3, 4, 5, 6].map((n) => `<li id="item-${n}" style="flex:0 0 120px">Item ${n}</li>`).join("");
    const list = await inspect(
      `<ul id="list" style="display:flex;overflow-x:auto;width:300px;margin:0;padding:0;list-style:none">${items}</ul>`,
      "legit-scroll-list",
      { allowedScrollContainers: [{ selector: "#list", reason: "carousel" }] },
    );
    assert.equal(list.report.runVerdict, "clean", JSON.stringify(list.report.evaluations.filter((e) => e.status !== "measured" && e.target.selector.startsWith("#")).map((e) => [e.target.selector, e.ruleId, e.status, e.reason])));
    assert.ok(list.report.evaluations.some((e) => e.target.selector === "#item-1" && e.ruleId === "web/unexpected-horizontal-overflow" && e.status === "measured"));
    // A clipping strip (overflow:hidden carousel): items it cuts or hides are exempt as clipped by it.
    const strip = await inspect(
      `<ul id="list" style="display:flex;overflow:hidden;width:300px;margin:0;padding:0;list-style:none">${items}</ul>`,
      "legit-clipping-strip",
      { allowedScrollContainers: [{ selector: "#list", reason: "carousel" }] },
    );
    assert.equal(strip.report.runVerdict, "clean", JSON.stringify(strip.report.evaluations.filter((e) => e.status !== "measured" && e.target.selector.startsWith("#")).map((e) => [e.target.selector, e.ruleId, e.status, e.reason])));
    for (const id of ["#item-3", "#item-4"]) {
      assert.ok(strip.report.evaluations.some((e) => e.target.selector === id && e.ruleId === "web/content-clipped" && e.status === "excluded" && e.reason === "target/allowed-scroll-container"), id);
      assert.ok(strip.report.evaluations.some((e) => e.target.selector === id && e.ruleId === "web/unexpected-horizontal-overflow" && e.status === "measured"), id);
    }
  });

  it("rejects a selector the browser cannot parse before the first sample, with the option field path, regardless of scope", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    const binding = (overrides: Record<string, unknown>) => ({
      sourceBinding: { kind: "host-build-container", root: output, receiptPath: "receipt.json", compiledBuildSelector: 'meta[name="build"]', compiledBuildAttribute: "content", containers: [{ selector: "main", file: "src/Main.tsx" }], ...overrides },
    });
    // Chrome auto-closes "[role=dialog" (valid, matches nothing); these selectors throw a SyntaxError.
    const cases: [Record<string, unknown>, Record<string, unknown>, string][] = [
      [{ intentionalOverlays: [{ selector: "[", reason: "modal", scope: "suite" }] }, {}, "geometry.intentionalOverlays[0].selector"],
      [{ allowedScrollContainers: [{ selector: ".grid", reason: "grid" }, { selector: "div:has(", reason: "typo", scope: "suite" }] }, {}, "geometry.allowedScrollContainers[1].selector"],
      [{ intentionalOverlays: [{ selector: "a:nope", reason: "modal" }] }, {}, "geometry.intentionalOverlays[0].selector"],
      [{}, binding({ containers: [{ selector: "main", file: "a.tsx" }, { selector: "section[", file: "b.tsx" }] }), "sourceBinding.containers[1].selector"],
      [{}, binding({ compiledBuildSelector: "meta >" }), "sourceBinding.compiledBuildSelector"],
    ];
    for (const [geometry, extra, field] of cases) {
      const page = await open('<main><p id="only">content</p></main>');
      const calls: string[] = [];
      const host = hostPage(page, 640);
      const counted: StructuralPage = { ...host, evaluate: ((fn: (...args: unknown[]) => unknown, ...args: unknown[]) => { calls.push(String(fn).slice(0, 40)); return host.evaluate(fn, ...args); }) as StructuralPage["evaluate"], screenshot: async () => { calls.push("screenshot"); return host.screenshot(); } };
      try {
        await assert.rejects(
          checkPage(counted, { trust: "host-controlled-page", networkPolicy: "host-owned", scenario: "invalid-selector", output: { dir: output, screenshot: "viewport" }, geometry, ...extra }),
          (error: unknown) => error instanceof TypeError && error.message.includes(field) && /selector/u.test(error.message),
          field,
        );
        // Exactly one browser call (the preflight); no sample and no screenshot were taken.
        assert.equal(calls.length, 1, `${field}: ${JSON.stringify(calls)}`);
      } finally { await page.close(); }
    }
  });

  it("parses the same color table identically in the exported parser and in the in-page sampler, with channels validated per function", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    // [color, expected alpha]: null = unrecognized, fail closed.
    const table: [string, number | null][] = [
      ["transparent", 0], ["rgb(10, 20, 30)", 1], ["rgba(10, 20, 30, 0.4)", 0.4], ["rgb(10 20 30 / 50%)", 0.5], ["rgb(none 20 30)", 1],
      ["rgb(10% 20% 30% / none)", 0], ["hsl(120 40% 50% / 0.25)", 0.25], ["hsl(120deg 40% 50%)", 1], ["hsl(0.5turn, 40%, 50%)", 1],
      ["hwb(200 10% 20%)", 1], ["hwb(3rad 10% 20% / .5)", 0.5], ["lab(55% 20 -30 / 80%)", 0.8], ["lch(55% 40 240deg)", 1],
      ["oklab(0.6 0.1 -0.1 / 0)", 0], ["oklch(0.7 0.15 1turn / 0.75)", 0.75], ["color(srgb 0.2 0.4 0.6)", 1], ["color(display-p3 1 50% 0 / 50%)", 0.5],
      // Angles are hues: never an RGB, Lab, color() or saturation/lightness channel.
      ["rgb(10deg 20 30)", null], ["rgb(10, 20deg, 30)", null], ["rgba(10 20 30turn / 1)", null], ["hsl(120 40deg 50%)", null],
      ["hwb(200 10% 20rad)", null], ["lab(50% 20deg 0)", null], ["oklab(0.5 0.1 1grad)", null], ["lch(55deg 40 240)", null],
      ["oklch(0.7 1turn 180)", null], ["color(srgb 1deg 0 0)", null],
      // Legacy comma syntax has no `none`; legacy hsl needs percentages.
      ["rgb(none, 20, 30)", null], ["hsl(120, 40, 50)", null],
      ["url(#grad)", null], ["rgb(foo bar baz)", null], ["oklch(0.7 0.15 180 / 1.5)", null], ["rgb(255, 0, 0, )", null],
    ];
    const page = await open("<p>colors</p>");
    try {
      const sampled = await samplePage(hostPage(page, 640), { maxTargets: 10, allowed: [], overlays: [], containers: [], fullPage: false, siblingOverlap: false, colorProbe: table.map(([color]) => color) });
      const inPage = sampled.colorProbe ?? [];
      const exported = table.map(([color]) => parseCssColorAlpha(color));
      assert.deepEqual(inPage, exported, "in-page and exported parser disagree");
      assert.deepEqual(exported, table.map(([, expected]) => expected), JSON.stringify(table.map(([color], i) => [color, exported[i]])));
    } finally { await page.close(); }
  });

  it("measures small text in a display:contents wrapper by its text and exempts only links inside running text from small-touch-target", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    const res = await inspect(
      '<p>Normal text <span id="contents" style="display:contents;font-size:8px">tiny text without a box of its own</span> continues.</p>' +
      '<nav><ul style="margin:0"><li><a id="nav-link" href="#home" style="font-size:12px">Home</a></li><li><a id="nav-link-2" href="#about" style="font-size:12px">About</a></li></ul></nav>' +
      '<div>Running text in a div with <a id="div-link" href="#more" style="font-size:14px">an inline link</a> inside it.</div>' +
      '<p>Running prose with <a id="prose-link" href="#a" style="font-size:14px">inline link</a> inside paragraph.</p>',
      "small-rules-context",
      { rules: { smallText: { minFontSizePx: 12 }, smallTouchTarget: { minSizePx: 24 } } },
    );
    const marked = JSON.stringify(res.report.evaluations.filter((e) => e.target.selector.startsWith("#") && (e.ruleId === "web/small-text" || e.ruleId === "web/small-touch-target")).map((e) => [e.target.selector, e.ruleId, e.status, e.reason, e.measurements[0]?.value]));
    assert.ok(res.report.findings.some((f) => f.ruleId === "web/small-text" && f.target.selector === "#contents" && f.measurement.value === 8), marked);
    // A link that is the only text of its list item is navigation, not running text: measured.
    assert.ok(res.report.findings.some((f) => f.ruleId === "web/small-touch-target" && f.target.selector === "#nav-link"), marked);
    // Inline links surrounded by running text are exempt whatever the container tag.
    for (const id of ["#div-link", "#prose-link"]) assert.equal(res.report.findings.some((f) => f.ruleId === "web/small-touch-target" && f.target.selector === id), false, `${id} ${marked}`);
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

  it("measures semi-transparent opacity, filter, backdrop-filter, and CSS Color 4, excludes effectively invisible targets, and keeps clip-path fail-closed", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    const okResult = await inspect(
      '<div id="faded" style="opacity:.5;filter:drop-shadow(0 2px 4px rgba(0,0,0,.2));backdrop-filter:blur(4px);color:oklch(0.45 0.12 240 / 0.85);background:color(display-p3 0.9 0.95 1 / 80%)">modern paint geometry</div>',
      "modern-paint-v2",
    );
    assert.equal(okResult.ok, true, JSON.stringify(okResult.report.evaluations.filter((e) => e.status === "not-measured")));
    assert.equal(okResult.report.schemaVersion, 2);
    assert.equal(okResult.report.runVerdict, "clean");

    // opacity: 0 (or filter: opacity(0), multiplied along the ancestor chain) is not visible: the
    // target is excluded, never a coverage gap, and never binds a finding.
    const zeroOpacity = await inspect('<div id="invisible" style="opacity:0">invisible text</div>', "opacity-zero");
    assert.equal(zeroOpacity.ok, true);
    assert.equal(zeroOpacity.report.runVerdict, "clean");
    assert.ok(zeroOpacity.report.evaluations.filter((entry) => entry.target.selector === "#invisible").every((entry) => entry.status === "excluded" && entry.reason === "target/not-visible" && entry.evidenceBound === false));

    const filteredChain = await inspect(
      '<div style="opacity:.5"><div style="filter:blur(1px) opacity(0%)"><div id="deep-invisible" style="width:100px;overflow:hidden;white-space:nowrap">invisible clipped text far wider than its box</div></div></div>' +
      '<div id="half-filter" style="filter:opacity(.5);width:100px;overflow:hidden;white-space:nowrap">half visible clipped text far wider than its box</div>',
      "filter-opacity-chain",
    );
    assert.ok(filteredChain.report.evaluations.filter((entry) => entry.target.selector === "#deep-invisible").every((entry) => entry.status === "excluded" && entry.reason === "target/not-visible"));
    assert.equal(filteredChain.report.findings.some((f) => f.target.selector === "#deep-invisible"), false);
    // Positive control: half opacity through filter stays measured, its defect is found.
    assert.ok(filteredChain.report.findings.some((f) => f.target.selector === "#half-filter" && f.ruleId === "web/content-clipped"));

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

  it("never publishes a digest of page text: text drift records lengths only and capture digests are keyed per run", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    const first = "Balance: 1234.56 EUR";
    const second = "Balance: 1299.00 EUR";
    assert.equal(first.length, second.length);
    const page = await open(`<p id="bal">${first}</p>`);
    try {
      const result = await checkPage(hostPage(page, 640, async (rawPage) => {
        await rawPage.evaluate((text) => { const target = document.querySelector("#bal"); if (target) target.textContent = text; }, second);
      }), { trust: "host-controlled-page", networkPolicy: "host-owned", scenario: "text-drift-privacy", output: { dir: output, screenshot: "viewport" } });
      const detail = result.report.capture.driftDetails?.find((d) => d.field === "text" && d.selector === "#bal");
      assert.deepEqual(detail && { before: detail.before, after: detail.after }, { before: first.length, after: second.length });
      const json = JSON.stringify(result.report);
      for (const text of [first, second]) {
        const digest = createHash("sha256").update(text).digest("hex");
        assert.equal(json.includes(digest), false, `sha256 of ${JSON.stringify(text)} in the public report`);
        assert.equal(json.includes(digest.slice(0, 12)), false, `sha256 prefix of ${JSON.stringify(text)} in the public report`);
      }
    } finally { await page.close(); }

    // The same static page twice: equal within a run, unlinkable across runs.
    const runA = await inspect('<p id="static">Balance: 1234.56 EUR</p>', "keyed-capture-a");
    const runB = await inspect('<p id="static">Balance: 1234.56 EUR</p>', "keyed-capture-a");
    assert.equal(runA.report.capture.before, runA.report.capture.stable);
    assert.equal(runA.report.capture.stable, runA.report.capture.after);
    assert.notEqual(runA.report.capture.stable, runB.report.capture.stable);
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
      { rules: { siblingOverlap: true } },
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

  it("keeps web/sibling-overlap opt-in: off by default and out of the stability digest, on for image cards and real absolute collisions, gated by failOn", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    const badge = '<div style="position:relative;width:200px"><img id="photo" alt="product" width="200" height="100" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22100%22/%3E"><span id="badge" style="position:absolute;top:8px;right:8px;background:#fff">NEW</span></div>';

    // Default: the rule is not enabled, produces no evaluation, and the badge page is clean.
    const off = await inspect(badge, "sibling-overlap-default-off");
    assert.equal(off.report.runVerdict, "clean", JSON.stringify(off.report.findings));
    assert.equal(off.report.rulesEnabled?.includes("web/sibling-overlap"), false);
    assert.equal(off.report.evaluations.some((e) => e.ruleId === "web/sibling-overlap"), false);

    // Opt-in: no blanket position:absolute exclusion, the real overlap is visible as a warning ...
    const on = await inspect(badge, "sibling-overlap-opt-in-badge", { rules: { siblingOverlap: true } });
    assert.equal(on.report.rulesEnabled?.includes("web/sibling-overlap"), true);
    assert.equal(on.report.runVerdict, "findings");
    assert.ok(on.report.findings.some((f) => f.ruleId === "web/sibling-overlap" && f.target.selector === "#badge" && f.severity === "warn"));
    // ... failOn "error" keeps the warning in the report without failing the run ...
    const gated = await inspect(badge, "sibling-overlap-fail-on-error", { rules: { siblingOverlap: true } }, { failOn: "error" });
    assert.equal(gated.ok, true);
    assert.equal(gated.report.runVerdict, "clean");
    assert.equal(gated.report.exitCode, 0);
    assert.ok(gated.report.findings.some((f) => f.ruleId === "web/sibling-overlap" && f.target.selector === "#badge"));
    // ... and a named intentional overlay is the way to accept the badge.
    const named = await inspect(badge, "sibling-overlap-named-badge", { rules: { siblingOverlap: true }, intentionalOverlays: [{ selector: "#badge", reason: "product badge" }] });
    assert.equal(named.report.runVerdict, "clean", JSON.stringify(named.report.findings));

    // Image cards: wrappers whose only content is a replaced descendant still count as content.
    const cards = await inspect(
      '<div style="display:flex;width:400px">' +
      '<div id="card-a" style="width:150px"><img alt="first" width="150" height="80" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22150%22 height=%2280%22/%3E"></div>' +
      '<div id="card-b" style="width:150px;margin-left:-40px"><img alt="second" width="150" height="80" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22150%22 height=%2280%22/%3E"></div></div>',
      "sibling-overlap-image-cards", { rules: { siblingOverlap: true } },
    );
    assert.ok(cards.report.findings.some((f) => f.ruleId === "web/sibling-overlap" && f.target.selector === "#card-b"), JSON.stringify(cards.report.evaluations.filter((e) => e.ruleId === "web/sibling-overlap" && e.target.selector.startsWith("#card"))));

    // A real collision of two absolutely positioned text blocks stays a finding.
    const collision = await inspect(
      '<div style="position:relative;height:80px;width:300px"><p id="abs-a" style="position:absolute;top:0;left:0;margin:0;height:30px">Heading text</p><p id="abs-b" style="position:absolute;top:12px;left:0;margin:0;height:30px">Colliding text</p></div>',
      "sibling-overlap-absolute-collision", { rules: { siblingOverlap: true } },
    );
    assert.ok(collision.report.findings.some((f) => f.ruleId === "web/sibling-overlap" && f.target.selector === "#abs-b"));

    // Overlap eligibility that flips every frame without any geometry change: without the opt-in
    // the sibling fields are not part of the stability digest, so the capture is stable and clean.
    const flipping = '<div style="width:300px"><p id="flip-a" style="margin:0;height:30px">First line</p><p id="flip-b" style="margin:-18px 0 0;height:30px">Second line</p></div>' +
      '<script>let flip = false; (function tick() { flip = !flip; document.getElementById("flip-b").style.pointerEvents = flip ? "none" : "auto"; requestAnimationFrame(tick); })();</script>';
    const quiet = await inspect(flipping, "sibling-overlap-flipping-off");
    assert.equal(quiet.report.capture.stabilized, true);
    assert.equal(quiet.report.capture.drifted, false);
    assert.equal(quiet.report.runVerdict, "clean", JSON.stringify(quiet.report.infrastructure));
  });

  it("excludes content that is not rendered (closed details, content-visibility) as target/not-rendered without swallowing visible defects", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    const clippedBody = (id: string): string => `<div id="${id}" style="width:100px;overflow:hidden;white-space:nowrap">hidden body text that is far wider than its box</div>`;
    const notRendered = (report: { evaluations: { target: { selector: string }; status: string; reason: string | null }[] }, selector: string): boolean =>
      report.evaluations.filter((e) => e.target.selector === selector).every((e) => e.status === "excluded" && e.reason === "target/not-rendered");

    // Closed <details>: the body is not rendered, the first direct <summary> stays measured.
    const closed = await inspect(`<details id="closed"><summary id="closed-summary">More</summary>${clippedBody("closed-body")}</details>`, "details-closed");
    assert.equal(closed.report.runVerdict, "clean", JSON.stringify(closed.report.findings));
    assert.ok(notRendered(closed.report, "#closed-body"));
    assert.ok(closed.report.evaluations.some((e) => e.target.selector === "#closed-summary" && e.status === "measured"));

    // Open <details> with the same defect: findings.
    const opened = await inspect(`<details open><summary>More</summary>${clippedBody("open-body")}</details>`, "details-open");
    assert.equal(opened.report.runVerdict, "findings");
    assert.ok(opened.report.findings.some((f) => f.target.selector === "#open-body"));

    // Nested: open outer / closed inner keeps the inner summary measured and hides the inner body;
    // closed outer hides an open inner details entirely.
    const nested = await inspect(
      `<details open><summary>Outer</summary><details id="inner-closed"><summary id="inner-summary">Inner</summary>${clippedBody("inner-body")}</details></details>` +
      `<details><summary>Closed outer</summary><details open><summary id="hidden-summary">Inner open</summary>${clippedBody("deep-body")}</details></details>`,
      "details-nested",
    );
    assert.equal(nested.report.runVerdict, "clean", JSON.stringify(nested.report.findings));
    assert.ok(nested.report.evaluations.some((e) => e.target.selector === "#inner-summary" && e.status === "measured"));
    for (const selector of ["#inner-body", "#hidden-summary", "#deep-body"]) assert.ok(notRendered(nested.report, selector), selector);

    // content-visibility: hidden skips the element's contents, not the element itself.
    const cvHidden = await inspect(`<div id="cv-host" style="content-visibility:hidden;width:300px;height:40px">${clippedBody("cv-body")}</div>`, "content-visibility-hidden");
    assert.equal(cvHidden.report.runVerdict, "clean", JSON.stringify(cvHidden.report.findings));
    assert.ok(notRendered(cvHidden.report, "#cv-body"));
    assert.ok(cvHidden.report.evaluations.some((e) => e.target.selector === "#cv-host" && e.status === "measured"));

    // display: contents is no reason to exclude: its child's defect is still found.
    const contents = await inspect(`<div style="display:contents">${clippedBody("contents-child")}</div>`, "display-contents");
    assert.equal(contents.report.runVerdict, "findings");
    assert.ok(contents.report.findings.some((f) => f.target.selector === "#contents-child"));

    // Positive control: a visible defect in the closed details' own summary is not swallowed.
    const summaryDefect = await inspect(`<details><summary id="long-summary" style="width:100px;overflow:hidden;white-space:nowrap">a summary line far wider than its box</summary>${clippedBody("quiet-body")}</details>`, "details-summary-defect");
    assert.equal(summaryDefect.report.runVerdict, "findings");
    assert.ok(summaryDefect.report.findings.some((f) => f.target.selector === "#long-summary"));

    // content-visibility: auto far below the fold is not painted into a full-page capture.
    const page = await open(`<div style="height:2000px">spacer</div><section id="cv-auto" style="content-visibility:auto;contain-intrinsic-size:auto 200px">${clippedBody("cv-auto-body")}</section>`);
    try {
      const full = await checkPage(hostPage(page, 640), { trust: "host-controlled-page", networkPolicy: "host-owned", scenario: "content-visibility-auto-full-page", output: { dir: output, screenshot: "full-page" } });
      assert.equal(full.report.runVerdict, "clean", JSON.stringify(full.report.findings));
      assert.ok(notRendered(full.report, "#cv-auto-body"));
      assert.ok(full.report.evaluations.some((e) => e.target.selector === "#cv-auto" && e.status === "measured"));
    } finally { await page.close(); }
  });

  it("measures SVG text against its clipping SVG viewport, once per defect, and declines overflow:visible", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    type Report = Awaited<ReturnType<typeof inspect>>["report"];
    const svgFinding = (report: Report, selector: string) => report.findings.find((f) => f.ruleId === "web/svg-text-overflows-viewport" && f.target.selector === selector);
    const clipFinding = (report: Report, selector: string) => report.findings.find((f) => f.ruleId === "web/content-clipped" && f.target.selector === selector);
    const mono = 'font-family="monospace" font-size="16"';

    const result = await inspect(
      // Default overflow:hidden SVG, label partly outside: one defect, one finding.
      '<div><svg width="100" height="40"><text id="partly" x="70" y="24" font-size="20">WayTooWideLabel</text></svg></div>' +
      // Label completely outside the SVG viewport but inside the page.
      '<div><svg width="100" height="40"><text id="outside" x="150" y="20" font-size="16">Gone</text></svg></div>' +
      // Border and padding: the viewport is the content box; text in the padding is cut.
      `<div><svg width="100" height="40" style="padding:10px;border:5px solid #888"><text id="padded" x="80" y="20" ${mono}>ABC</text></svg></div>` +
      // Up-scaled viewBox: fits inside, measured in CSS pixels.
      '<div><svg width="400" height="80" viewBox="0 0 100 20"><text id="scaled-fits" x="2" y="12" font-size="8">Readable heading</text></svg></div>' +
      '<div><svg width="400" height="80" viewBox="0 0 100 20"><text id="scaled-cut" x="60" y="12" font-size="8">Readable heading</text></svg></div>' +
      // Nested SVG: its own x/y/width/height viewport clips.
      '<div><svg width="200" height="100" viewBox="0 0 100 50"><svg x="10" y="10" width="40" height="20"><text id="nested" x="20" y="15" font-size="10">NESTED</text></svg></svg></div>',
      "svg-text-viewport",
    );
    const r = result.report;
    assert.ok(svgFinding(r, "#partly"));
    assert.equal(clipFinding(r, "#partly"), undefined, "the same defect must not also be reported as web/content-clipped");
    assert.ok(svgFinding(r, "#outside"), JSON.stringify(r.evaluations.filter((e) => e.target.selector === "#outside")));
    assert.ok(svgFinding(r, "#padded"), JSON.stringify(r.evaluations.filter((e) => e.target.selector === "#padded")));
    assert.equal(svgFinding(r, "#scaled-fits"), undefined);
    assert.ok(Number(svgFinding(r, "#scaled-cut")?.measurement.value) > 20, "overflow is reported in CSS pixels of the scaled viewport");
    assert.ok(svgFinding(r, "#nested"), JSON.stringify(r.evaluations.filter((e) => e.target.selector === "#nested")));
    for (const selector of ["#partly", "#outside", "#padded", "#scaled-cut", "#nested"]) assert.equal(clipFinding(r, selector), undefined, selector);

    // overflow:visible draws the text: the SVG rule does not apply, an outer HTML clip still does.
    const visible = await inspect(
      '<div><svg width="100" height="40" style="overflow:visible"><text id="drawn" x="70" y="24" font-size="20">WayTooWideLabel</text></svg></div>' +
      '<div style="width:120px;overflow:hidden"><svg width="100" height="40" style="overflow:visible"><text id="html-cut" x="70" y="24" font-size="20">WayTooWideLabel</text></svg></div>',
      "svg-text-overflow-visible",
    );
    const v = visible.report;
    assert.ok(v.evaluations.some((e) => e.ruleId === "web/svg-text-overflows-viewport" && e.target.selector === "#drawn" && e.status === "excluded" && e.reason === "rule/target-not-applicable"));
    assert.equal(v.findings.some((f) => f.target.selector === "#drawn"), false, JSON.stringify(v.findings));
    assert.equal(svgFinding(v, "#html-cut"), undefined);
    assert.ok(clipFinding(v, "#html-cut"), "an outer HTML clip stays measurable");
  });

  it("does not measure SVG content with scrollWidth for web/unexpected-horizontal-overflow, while real HTML overflow next to it is found", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    const result = await inspect(
      '<svg width="600" height="120" viewBox="0 0 100 20"><text id="big" x="2" y="12" font-size="8">Readable heading</text></svg>' +
      '<div id="html-wide" style="width:200px;height:30px"><div style="width:500px;height:20px">wide html</div></div>',
      "svg-scroll-width",
    );
    const r = result.report;
    assert.equal(r.findings.some((f) => f.ruleId === "web/unexpected-horizontal-overflow" && f.target.selector === "#big"), false, JSON.stringify(r.findings));
    assert.ok(r.evaluations.some((e) => e.ruleId === "web/unexpected-horizontal-overflow" && e.target.selector === "#big" && e.status === "excluded" && e.reason === "rule/target-not-applicable"));
    assert.ok(r.findings.some((f) => f.ruleId === "web/unexpected-horizontal-overflow" && f.target.selector === "#html-wide"));
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

    // Broad exception on html/body must exclude targets rather than reporting measured+clean (Opus HIGH).
    const broadRes = await inspect(
      '<p id="only">hello</p>',
      "broad-body-exception-fail-closed",
      { intentionalOverlays: [{ selector: "html", reason: "overbroad overlay" }] },
    );
    assert.equal(broadRes.ok, false);
    assert.equal(broadRes.report.runVerdict, "insufficient-coverage");
    assert.equal(broadRes.report.coverage.measured, 0);

    // filter: opacity(0) is excluded as target/not-visible and never binds a finding (Codex #6).
    const hiddenFilter = await inspect(
      '<button id="ghost" style="width:16px;height:16px;filter:opacity(0)">x</button>',
      "filter-opacity-zero-not-visible",
      { rules: { smallTouchTarget: { minSizePx: 24 } } },
    );
    assert.equal(hiddenFilter.ok, true);
    assert.equal(hiddenFilter.report.runVerdict, "clean");
    assert.ok(hiddenFilter.report.evaluations.some((e) => e.target.selector === "#ghost" && e.status === "excluded" && e.reason === "target/not-visible"));
    assert.equal(hiddenFilter.report.findings.some((f) => f.target.selector === "#ghost"), false);
  });
});
