/**
 * The freeze signature and the untouched primitives, against a real browser and real Paged.js.
 *
 * The unit suite covers the decision logic through injected seams — drift once and settle, drift
 * forever, retry budget — because a real document cannot be asked to do those on demand. What is
 * checked HERE is everything a fake cannot answer: that the seven components collect anything at
 * all from a real paginated document, that the primitives survive an author script replacing them,
 * and that the collector reading through those primitives sees different values from a collector
 * reading through the document's own.
 *
 * Prerequisites FAIL rather than skip. A suite that goes green by running nothing makes every
 * claim resting on it look checked, and this file's claims are the ones about a hostile document.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  launchBrowser, ownServerLifecycle, resolveBrowser, resolvePackageRoot, type BrowserLike, type PageLike,
} from "../../src/acquire/browser.ts";
import {
  cleanupBrowserProfile, closeBrowserBounded, integritySource, integrityStatusSource,
  paginationApparatusSource, PAGINATION_PREVIEW_SOURCE, withPagination,
  type RuntimeIntegrityStatus,
} from "../../src/acquire/render-run.ts";
import { FREEZE_COMPONENTS, FREEZE_SOURCE, sampleParts, type FreezeParts } from "../../src/measure/freeze.ts";
import { overlaySource } from "../../src/render/overlay.ts";
import {
  PRIMITIVES_CHECK, PRIMITIVES_SOURCE, TEST_PRIMITIVES_CAPABILITY, type PrimitivesStatus,
} from "../../src/measure/primitives.ts";
import {
  compareGeometry,
  CROSS_CHECK_MEASURED_MAX_PX,
  CROSS_CHECK_SAMPLE_SIZE,
  geometrySampleSource,
  type GeometrySample,
} from "../../src/measure/cross-check.ts";
import { collectorSource } from "../../src/paginate/collector.ts";
import { injectSourceIds } from "../../src/source/inject.ts";

/** Only the two members this suite calls; the driver's session type is not a published interface. */
interface CdpSession {
  send<R = unknown>(method: string, params?: Record<string, unknown>): Promise<R>;
}

const REPO = fileURLToPath(new URL("../..", import.meta.url));

const chromeAvailable = resolveBrowser().path !== null;
const pagedjsRoot = resolvePackageRoot("pagedjs", REPO);
const optional = process.env.BREAKLINT_LIVE_OPTIONAL === "1";
const missing = [chromeAvailable ? null : "a browser", pagedjsRoot ? null : "pagedjs"].filter(
  (x): x is string => x !== null,
);

/**
 * A document carrying ALL SEVEN component sources at once.
 *
 * A component measured on a document that does not contain its feature reports the empty string,
 * and an empty string compares equal to an empty string forever — which is a component that cannot
 * vary, dressed as one that passed. Every feature below is here so that every component has
 * something to say: a running footer for the margin boxes, a `::before` and a `::marker` for the
 * generated content, a transformed SVG for the normalised geometry, an image for the replaced
 * elements, a canvas for the canvas component, and enough text to make more than one page.
 */
function documentSource(pagedjs: string): string {
  const filler = Array.from(
    { length: 14 },
    (_, i) => `<p id="f${i}">${i + 1}. filler text long enough to force pagination across several pages.</p>`,
  ).join("\n");
  const author = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
@page{size:148mm 105mm;margin:12mm; @bottom-center{ content: "page " counter(page); } }
body{font:10pt/1.45 Georgia,serif;margin:0} p{margin:0 0 8px}
p.marked::before{ content:"MARK "; padding-left:3px }
ul li::marker{ content:"* " }
</style></head><body>
<p class="marked">alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron.</p>
<ul><li>a list item, for the marker</li></ul>
<svg width="60" height="40" viewBox="0 0 60 40"><g transform="translate(5,5) scale(2)"><rect x="1" y="2" width="10" height="6"/></g></svg>
<img width="40" height="30" src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==">
<canvas id="cv" width="50" height="20"></canvas>
${filler}
<script>
  const c = document.getElementById("cv").getContext("2d");
  c.fillStyle = "#c00"; c.fillRect(2, 2, 40, 12);
  window.__preInk = c.getImageData(0, 0, 50, 20).data.some((v) => v !== 0);
</script>
</body></html>`;
  // The product sampler addresses the source identities injected before parsing, not incidental
  // author IDs. Keeping that route here prevents the live oracle from certifying a different
  // sampler than the one render-run.ts uses.
  return withPagination(injectSourceIds(author, "measure-live.html").html, pagedjs, false);
}

/**
 * The same collection, through the DOCUMENT's own primitives.
 *
 * This is the positive control, and without it the hostile case proves nothing: if the hijack
 * never reached the surface the probe uses, "the probe was unaffected" would be true and empty.
 */
const NAIVE_SOURCE = `(() => {
  const round = (n) => Math.round(n * 100) / 100;
  const pages = [...document.querySelectorAll(".pagedjs_page")];
  const boxes = [];
  for (const pg of pages) for (const el of [...pg.querySelectorAll("*")]) {
    const b = el.getBoundingClientRect();
    boxes.push(el.tagName + ":" + round(b.x) + "," + round(b.y) + "," + round(b.width) + "," + round(b.height));
  }
  const pseudo = [];
  for (const pg of pages) for (const el of [...pg.querySelectorAll("*")]) {
    const s = getComputedStyle(el, "::before");
    if (s.content !== "none" && s.content !== "normal") pseudo.push(el.tagName + "=" + s.content);
  }
  return { boxes: boxes.join(";"), pseudo: pseudo.join(";") };
})()`;

/** An author script replacing the primitives AFTER pagination — the reachable attack. */
const HIJACK_SOURCE = `(() => {
  Element.prototype.getBoundingClientRect = function () {
    return { x: 999, y: 999, width: 999, height: 999, top: 999, left: 999, right: 999, bottom: 999 };
  };
  const real = window.getComputedStyle;
  window.getComputedStyle = function (el, p) {
    const s = real.call(window, el, p);
    return new Proxy(s, { get: (t, k) => (k === "content" ? '"HIJACKED"' : Reflect.get(t, k)) });
  };
  Element.prototype.querySelectorAll = function () { return []; };
  return "patched";
})()`;

describe("the measurement probe, live", () => {
  let browser: BrowserLike | null = null;
  let browserProfile: string | null = null;
  let server: Server | null = null;
  let serverLifecycle: ReturnType<typeof ownServerLifecycle> | null = null;
  let origin = "";
  let source = "";

  before(async () => {
    if (missing.length > 0) {
      const why = `this suite cannot run without: ${missing.join(", ")}`;
      if (optional) return;
      assert.fail(`${why}. Set BREAKLINT_LIVE_OPTIONAL=1 to allow skipping.`);
    }
    source = documentSource(readFileSync(join(pagedjsRoot!, "dist", "paged.js"), "utf8"));
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(source);
    });
    serverLifecycle = ownServerLifecycle(server);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const address = server!.address();
    origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    const launched = await launchBrowser(REPO);
    assert.ok(launched.browser, launched.detail);
    browser = launched.browser;
    browserProfile = launched.userDataDir ?? null;
  });

  after(async () => {
    let browserError: string | null = null;
    let serverError: string | null = null;
    let profileError: string | null = null;
    const serverClose = serverLifecycle?.close() ?? Promise.resolve(null);
    try {
      if (browser) browserError = await closeBrowserBounded(browser);
    } finally {
      serverError = await serverClose;
      profileError = cleanupBrowserProfile(browserProfile);
    }
    assert.equal(browserError, null);
    assert.equal(serverError, null);
    assert.equal(profileError, null);
    assert.equal(browserProfile ? existsSync(browserProfile) : false, false);
  });

  /**
   * Load the way the production loader must: NAVIGATE to a URL.
   *
   * Measured, and the reason this helper exists rather than `setContent`: with `setContent` the
   * primitives are NOT installed — `window.__blPrimitives` came back `undefined` and the collector
   * threw. `setContent` writes into the existing document, so CDP's on-new-document script never
   * fires. Two independent measurements now point at the same loader design: this one, and the
   * `file://` origin measurement in `docs/status.md` that showed `cssRules` unreadable off a file.
   */
  async function loaded(): Promise<PageLike> {
    const page = await browser!.newPage();
    await (page as unknown as { evaluateOnNewDocument(s: string): Promise<unknown> }).evaluateOnNewDocument(
      PRIMITIVES_SOURCE,
    );
    await (page as unknown as { evaluateOnNewDocument(s: string): Promise<unknown> }).evaluateOnNewDocument(
      integritySource([]),
    );
    await page.setViewport({ width: 1000, height: 800 });
    await page.emulateMediaType("print");
    await page.goto(`${origin}/doc.html`, { waitUntil: "load", timeout: 30_000 });
    return page;
  }

  async function paginated(): Promise<PageLike> {
    const page = await loaded();
    // Production installs the collector before the pagination apparatus.  The rendered Paged
    // tree receives its runtime `data-ref` identities there, so the live sampler must exercise
    // the same order rather than certifying source IDs that Paged.js no longer carries.
    await page.evaluate<void>(collectorSource(TEST_PRIMITIVES_CAPABILITY, "measure-live-collector"));
    await page.evaluate<void>(paginationApparatusSource(TEST_PRIMITIVES_CAPABILITY));
    const pagination = await page.evaluate<{ paginationError: string | null }>(PAGINATION_PREVIEW_SOURCE);
    assert.equal(pagination.paginationError, null);
    const epoch = await page.evaluate<RuntimeIntegrityStatus>(integrityStatusSource(TEST_PRIMITIVES_CAPABILITY));
    assert.equal(epoch.paginationPreviewCalls, 1);
    await page.evaluate<void>(FREEZE_SOURCE);
    return page;
  }

  it("rejects author preemption of every privileged apparatus factory before Node installs it", async (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const page = await loaded();
    const attempted = await page.evaluate<{ errors: string[]; previewConfigurable: boolean; constructorConfigurable: boolean; registrationConfigurable: boolean; freeze: boolean; overlay: boolean }>(`(() => {
      const P = window.__blPrimitives;
      const errors = [];
      for (const action of [
        () => P.lockPagination("author-forged", Paged.Previewer.prototype, "preview", () => null),
        () => P.lockPreviewer("author-forged", Paged, "Previewer", Paged.Previewer),
        () => P.publishFreeze("author-forged", () => null),
        () => P.publishOverlay("author-forged", () => null),
        () => Paged.registerHandlers(class AuthorPreemption extends Paged.Handler {}),
      ]) {
        try { action(); } catch (error) { errors.push(String(error)); }
      }
      return {
        errors,
        previewConfigurable: Object.getOwnPropertyDescriptor(Paged.Previewer.prototype, "preview").configurable,
        constructorConfigurable: Object.getOwnPropertyDescriptor(Paged, "Previewer").configurable,
        registrationConfigurable: Object.getOwnPropertyDescriptor(Paged, "registerHandlers").configurable,
        freeze: Object.prototype.hasOwnProperty.call(window, "__blFreezeParts"),
        overlay: Object.prototype.hasOwnProperty.call(window, "__blOverlayControl"),
      };
    })()`);
    assert.equal(attempted.errors.length, 5);
    assert.ok(attempted.errors.slice(0, 4).every((error) => /capability rejected/u.test(error)), attempted.errors.join(" | "));
    assert.match(attempted.errors[4]!, /handler registration rejected/u);
    assert.equal(attempted.previewConfigurable, true, "author call sealed Previewer.prototype.preview before Node apparatus");
    assert.equal(attempted.constructorConfigurable, true, "author call sealed Paged.Previewer before Node apparatus");
    assert.equal(attempted.registrationConfigurable, false, "author retained a Paged handler registration entry point");
    assert.equal(attempted.freeze, false, "author call published a forged freeze collector");
    assert.equal(attempted.overlay, false, "author call published a forged overlay controller");

    await page.evaluate<void>(paginationApparatusSource(TEST_PRIMITIVES_CAPABILITY));
    const pagination = await page.evaluate<{ paginationError: string | null }>(PAGINATION_PREVIEW_SOURCE);
    assert.equal(pagination.paginationError, null, "the real Node apparatus could not install after rejected preemption");
    await page.evaluate<void>(FREEZE_SOURCE);
    await page.evaluate<string>(overlaySource(TEST_PRIMITIVES_CAPABILITY));
    const installed = await page.evaluate<{ freeze: string; overlay: string }>(
      '({ freeze: typeof window.__blFreezeParts, overlay: typeof window.__blOverlayControl })',
    );
    assert.deepEqual(installed, { freeze: "function", overlay: "function" });
    await page.close();
  });

  it("the primitives are installed and cannot be replaced", async (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const page = await paginated();
    const status = await page.evaluate<PrimitivesStatus>(PRIMITIVES_CHECK);
    assert.equal(status.ok, true, status.reason);
    await page.close();
  });

  /**
   * `setContent` does not install them — pinned so the loader design cannot regress quietly.
   *
   * Red condition: switch the loader back to `setContent` and this case reports `ok: true`,
   * meaning the primitives silently stopped protecting anything.
   */
  it("setContent leaves the primitives uninstalled, which is why the loader navigates", async (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const page = await browser!.newPage();
    await (page as unknown as { evaluateOnNewDocument(s: string): Promise<unknown> }).evaluateOnNewDocument(
      PRIMITIVES_SOURCE,
    );
    await page.setContent("<!doctype html><p>x</p>", { waitUntil: "load" });
    const status = await page.evaluate<PrimitivesStatus>(PRIMITIVES_CHECK);
    assert.equal(status.ok, false, "if setContent DID install them, the loader could use it and this pin is stale");
    await page.close();
  });

  it("every one of the seven components collects something from a real paginated document", async (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const page = await paginated();
    const parts = await sampleParts(page);
    const empty = FREEZE_COMPONENTS.filter((c) => !parts[c] || parts[c].length === 0);
    assert.deepEqual(empty, [], `components that measured nothing: ${empty.join(", ")}`);
    // The exact count, not a floor. A floor under a comment claiming exactness is a defect this
    // repo already had once: `rows.length >= 21` with 27 rows present let six vanish silently.
    // Two is what this fixture measures, and two is enough — the component that needs more than
    // one page is `pageCount` itself, and one page boundary is what makes it non-trivial.
    assert.equal(parts.pageCount, "2", "the fixture changed size; update this deliberately");
    // Each component must contain the feature it exists for, or it is measuring something else.
    assert.match(parts.pseudo, /"MARK "/u, "generated content missing from the pseudo component");
    assert.match(parts.pseudo, /counter\(page\)/u, "the running footer must reach the pseudo component");
    assert.match(parts.svgGeometry, /^g:|;rect:/u, "svg children missing from the geometry component");
    assert.match(parts.replaced, /IMG:/u, "the image missing from the replaced component");
    assert.match(parts.canvas, /50x20/u, "canvas dimensions missing from the canvas component");
    assert.match(parts.marginBoxes, /pagedjs_margin/u, "margin boxes missing from their component");
    await page.close();
  });

  /**
   * The measured limit, asserted so that it is a recorded fact rather than a comment.
   *
   * A canvas drawn on BEFORE pagination reports ink; after pagination it reports zero non-zero
   * bytes, in the page clone and in the `<template>` where Paged.js parks the source. §11.3's
   * drift table claims the signature detects "canvas content"; §15.1b two sections later says the
   * bitmap does not survive the clone. This asserts which of the two is true on this build.
   *
   * Red condition: if a future Paged.js preserves the bitmap, `preInk && canvasInkReadable` becomes
   * true and this case fails — which is the correct moment to revisit the claim rather than a
   * silent improvement nobody notices.
   */
  it("the canvas bitmap does not survive pagination, so its content cannot be a drift signal", async (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const page = await paginated();
    const preInk = await page.evaluate<boolean>("window.__preInk === true");
    assert.equal(preInk, true, "premise: the canvas carried ink BEFORE pagination — else this proves nothing");
    const parts = await sampleParts(page);
    assert.equal(
      parts.canvasInkReadable,
      false,
      "the bitmap survived pagination on this build — §11.3's canvas-content claim needs revisiting",
    );
    assert.match(parts.canvas, /:0$/u, "zero non-zero bytes is the measured value");
    await page.close();
  });

  /**
   * The second opinion, from the browser's own layout tree.
   *
   * This is the only check in the whole measurement path whose truth comes from outside the page.
   * Everything else — however carefully the primitives are captured — is still the page reporting
   * on itself.
   *
   * Two measured facts are asserted rather than assumed. The quad agrees with
   * `getBoundingClientRect` to within thousandths of a pixel; `model.width`/`model.height` do NOT,
   * because CDP rounds them to integers (469 against 468.66). A tolerance chosen to accommodate
   * that rounding would have been about seventy times too loose, and would have been a number
   * invented to cover reading the wrong field. The second assertion below exists so that if a
   * future build ever makes `model.width` exact, this stops claiming a discrepancy that is gone.
   */
  it("the browser's layout tree agrees with the probe, and the rounded fields are why the quad is used", async (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const page = await paginated();
    const inPage = await page.evaluate<GeometrySample[]>(geometrySampleSource(CROSS_CHECK_SAMPLE_SIZE));
    assert.ok(inPage.length > 0, "the sample is empty — this case would confirm nothing");

    const session = await (page as unknown as { createCDPSession(): Promise<CdpSession> }).createCDPSession();
    await session.send("DOM.enable");
    const { root } = await session.send<{ root: { nodeId: number } }>("DOM.getDocument", { depth: -1, pierce: false });

    const outOfProcess: GeometrySample[] = [];
    let worstModelDelta = 0;
    for (const sample of inPage) {
      const { nodeIds } = await session.send<{ nodeIds: number[] }>("DOM.querySelectorAll", {
        nodeId: root.nodeId,
        selector: sample.selector!,
      });
      const nodeId = nodeIds[sample.occurrence!];
      if (!nodeId) continue;
      let model: { border: number[]; width: number; height: number };
      try {
        ({ model } = await session.send<{ model: { border: number[]; width: number; height: number } }>(
          "DOM.getBoxModel",
          { nodeId },
        ));
      } catch {
        // Match the production oracle: an inaccessible CDP box is retained as a missing answer,
        // which compareGeometry turns into an attributable fatal disagreement rather than a test
        // harness exception.
        continue;
      }
      const q = model.border;
      outOfProcess.push({ key: sample.key, x: q[0]!, y: q[1]!, width: q[2]! - q[0]!, height: q[5]! - q[1]! });
      worstModelDelta = Math.max(worstModelDelta, Math.abs(model.width - sample.width));
    }
    await page.close();

    const result = compareGeometry(inPage, outOfProcess);
    assert.equal(result.ok, true, `disagreements: ${JSON.stringify(result.disagreements)}`);
    assert.ok(
      result.maxDelta <= CROSS_CHECK_MEASURED_MAX_PX,
      `the corpus exceeded its own measured maximum: ${result.maxDelta} > ${CROSS_CHECK_MEASURED_MAX_PX}. ` +
        "The tolerance's headroom cannot be allowed to erode unnoticed.",
    );
    assert.ok(
      worstModelDelta > CROSS_CHECK_MEASURED_MAX_PX,
      "model.width is no longer rounded; the reason this code reads the quad instead has expired",
    );
  });

  /**
   * The whole point of the captured primitives, with its own positive control in the same case.
   *
   * The probe must read identical values under a hijack; the naive collector must NOT. If both
   * were unaffected, the hijack never reached the surface being defended and the first assertion
   * would be true and worthless.
   */
  it("an author script replacing the primitives changes what the document sees and not what the probe sees", async (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const clean = await paginated();
    const cleanParts = await sampleParts(clean);
    const cleanNaive = await clean.evaluate<{ boxes: string; pseudo: string }>(NAIVE_SOURCE);
    await clean.close();

    const attacked = await paginated();
    assert.equal(await attacked.evaluate<string>(HIJACK_SOURCE), "patched");
    const attackedParts = await sampleParts(attacked);
    const attackedNaive = await attacked.evaluate<{ boxes: string; pseudo: string }>(NAIVE_SOURCE);
    await attacked.close();

    // The control first: if the hijack did not land, nothing below means anything.
    assert.notEqual(cleanNaive.boxes, attackedNaive.boxes, "the hijack did not reach the naive collector");
    assert.equal(attackedNaive.boxes, "", "measured: a querySelectorAll returning [] wipes the naive boxes");
    assert.notEqual(cleanNaive.pseudo, attackedNaive.pseudo, "the hijack did not reach the naive pseudo read");

    // And then the claim.
    for (const component of FREEZE_COMPONENTS) {
      assert.equal(
        attackedParts[component],
        cleanParts[component],
        `${component} moved under a hijack — the probe is reading the document's primitives`,
      );
    }
  });
});
