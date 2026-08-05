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

import { launchBrowser, resolveBrowser, resolvePackageRoot, type BrowserLike, type PageLike } from "../../src/acquire/browser.ts";
import { FREEZE_COMPONENTS, FREEZE_SOURCE, sampleParts, type FreezeParts } from "../../src/measure/freeze.ts";
import { PRIMITIVES_CHECK, PRIMITIVES_SOURCE, type PrimitivesStatus } from "../../src/measure/primitives.ts";

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
    (_, i) => `<p>${i + 1}. filler text long enough to force pagination across several pages.</p>`,
  ).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
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
<script>${pagedjs}</script>
<script>
window.__blPaginated = false;
class Probe extends Paged.Handler { afterRendered() { window.__blPaginated = true; } }
Paged.registerHandlers(Probe);
new Paged.Previewer().preview();
</script>
</body></html>`;
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
  let server: Server | null = null;
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
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const address = server!.address();
    origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    const launched = await launchBrowser(REPO);
    assert.ok(launched.browser, launched.detail);
    browser = launched.browser;
  });

  after(async () => {
    await browser?.close();
    server?.close();
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
  async function paginated(): Promise<PageLike> {
    const page = await browser!.newPage();
    await (page as unknown as { evaluateOnNewDocument(s: string): Promise<unknown> }).evaluateOnNewDocument(
      PRIMITIVES_SOURCE,
    );
    await page.setViewport({ width: 1000, height: 800 });
    await page.emulateMediaType("print");
    await page.goto(`${origin}/doc.html`, { waitUntil: "load", timeout: 30_000 });
    await page.waitForFunction("window.__blPaginated === true", { timeout: 30_000 });
    await page.evaluate<void>(FREEZE_SOURCE);
    return page;
  }

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
