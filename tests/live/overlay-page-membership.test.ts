/**
 * A real-DOM regression for the page-membership boundary of the evidence overlay.
 *
 * Paged.js can expose a continuation rectangle from an adjacent displayed page through a source
 * node reached under the current page clone.  The geometry below is deliberately smaller than a
 * whole paginated book but has the same observable shape: one native inline element has both an
 * in-page client rect and a second rect at x=1800 while its containing page is only 794px wide.
 * The oracle is the browser's native getClientRects, captured before the page content runs.
 *
 * The page is wrapped in the structure Paged.js 0.4.3 builds (sheet, page box, margin box, page
 * area), because membership has two boundaries and both are pinned here. Across the page the bound
 * for a mark is the PAGE box: `#right-edge` sits in the right margin, inside the page, and is
 * marked there; `#past-edge` would put its mark's envelope past the page edge and is refused. And
 * only the page AREA is marked at all: `#clone` is what Paged.js leaves in a margin box for a
 * `position: running(...)` element — no finding can target it, and marking it anyway is what left
 * every page of a document with a running header unbound.
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";

import { launchBrowser, resolveBrowser, type BrowserLike, type PageLike } from "../../src/acquire/browser.ts";
import { cleanupBrowserProfile, closeBrowserBounded } from "../../src/acquire/render-run.ts";
import { PRIMITIVES_SOURCE } from "../../src/measure/primitives.ts";
import {
  detachOverlay, installOverlay, readbackViolations, removeOverlay,
} from "../../src/render/overlay.ts";

const REPO = new URL("../..", import.meta.url).pathname;
const optional = process.env.BREAKLINT_LIVE_OPTIONAL === "1";
const missingBrowser = resolveBrowser().path === null;

const FIXTURE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
  body { margin: 0; }
  .pagedjs_page { position: relative; width: 794px; height: 1123px; }
  .pagedjs_page_content { position: relative; width: 733px; height: 994px; }
  #fragmented { display: inline; font: 16px/20px Georgia, serif; }
  #fragmented .far { position: relative; left: 1800px; }
  #outside { position: absolute; left: 1800px; top: 80px; }
  #right-edge { position: absolute; left: 740px; top: 120px; }
  #past-edge { position: absolute; left: 785px; top: 160px; }
  #hidden { display: none; }
  .pagedjs_margin-top { position: absolute; left: 0; top: 0; width: 794px; }
</style></head><body>
  <div class="pagedjs_page"><div class="pagedjs_sheet"><div class="pagedjs_pagebox">
    <div class="pagedjs_margin-top"><div class="pagedjs_margin pagedjs_margin-top-center hasContent"><div class="pagedjs_margin-content">
      <p id="clone" data-bl-sid="clone">running title clone</p>
    </div></div></div>
    <div class="pagedjs_area"><div class="pagedjs_page_content">
      <section id="fragmented" data-bl-sid="fragmented">current<br><span class="far">continuation</span></section>
      <section id="outside" data-bl-sid="outside">outside current page</section>
      <section id="right-edge" data-bl-sid="right-edge">near edge</section>
      <section id="past-edge" data-bl-sid="past-edge">past</section>
      <section id="hidden" data-bl-sid="hidden">historically excluded non-rendered target</section>
    </div></div>
  </div></div></div>
</body></html>`;

// Paged.js keeps an unbreakable block in a side fragmentainer on the preceding page, then
// creates the printable clone on the next page. Its physical page box is taller than the
// preview's viewport-height wrapper; the latter is not the sheet boundary in the PDF.
const DEFERRED_FIXTURE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
  body { margin: 0; }
  .pagedjs_page { position: relative; width: 794px; height: 800px; }
  .pagedjs_pagebox { position: relative; width: 794px; height: 1123px; }
  .pagedjs_page_content { position: relative; width: 733px; height: 994px; }
  .continued { height: 994px; }
  .deferred { position: absolute; left: 1800px; top: 20px; break-inside: avoid; }
  .visible-keep { position: relative; break-inside: avoid; }
  .escaped-child { position: absolute; left: 1800px; top: 0; }
  .pagedjs_footnote_area { position: absolute; top: 1000px; height: 40px; overflow: hidden; }
  .pagedjs_footnote_area.in-band { top: 954px; height: 40px; overflow: hidden; }
  .clipped-note { position: absolute; top: 39px; height: 20px; }
  .footnote-inner-band { position: absolute; left: 0; top: 0; width: 200px; height: 39.5px; }
  .zero-height-bottom { position: absolute; left: 0; top: 994px; width: 733px; height: 0; }
  .zero-height-inner-band { position: absolute; left: 0; top: 993.3px; width: 733px; height: 0; }
  .inner-band-end { position: absolute; left: 0; top: 950px; width: 733px; height: 43.25px; }
  .overflow-bottom { position: absolute; left: 0; top: 950px; width: 733px; height: 45.5px; }
</style></head><body>
  <div class="pagedjs_page"><div class="pagedjs_sheet"><div class="pagedjs_pagebox"><div class="pagedjs_area">
    <div class="pagedjs_page_content">
      <section class="continued" data-bl-sid="continued"><p>visible first fragment</p></section>
      <div class="zero-height-bottom" data-bl-sid="zero-height-bottom"></div>
      <div class="zero-height-inner-band" data-bl-sid="zero-height-inner-band"></div>
      <div class="inner-band-end" data-bl-sid="inner-band-end">ends 0.75px inside content area</div>
      <div class="overflow-bottom" data-bl-sid="overflow-bottom">overflows 1.5px below content area</div>
      <div class="deferred" data-bl-sid="deferred"><p data-bl-sid="deferred-child">next page only</p></div>
      <div class="deferred" data-bl-sid="deferred-later">two pages later</div>
      <div class="deferred" data-bl-sid="clipped-note">same SID as the separately clipped footnote</div>
      <div class="deferred" data-bl-sid="orphan">no printable clone exists</div>
      <section class="visible-keep">visible block <p class="escaped-child" data-bl-sid="escaped-child">escaped child</p></section>
    </div>
    <div class="pagedjs_footnote_area"><aside class="clipped-note" data-bl-sid="clipped-note">not printed here</aside></div>
  </div></div></div></div>
  <div class="pagedjs_page"><div class="pagedjs_sheet"><div class="pagedjs_pagebox"><div class="pagedjs_area">
    <div class="pagedjs_page_content">
      <section data-bl-sid="continued">visible continuation</section>
      <div data-bl-sid="deferred"><p data-bl-sid="deferred-child">next page only</p></div>
      <p data-bl-sid="escaped-child">a later copy does not redeem the escaped child of a visible block</p>
      <aside data-bl-sid="clipped-note">printable clone elsewhere does not justify the clipped note</aside>
    </div>
  </div></div></div></div>
  <div class="pagedjs_page"><div class="pagedjs_sheet"><div class="pagedjs_pagebox"><div class="pagedjs_area">
    <div class="pagedjs_page_content"><div data-bl-sid="deferred-later">two pages later</div></div>
    <div class="pagedjs_footnote_area in-band"><aside class="footnote-inner-band" data-bl-sid="footnote-inner-band">footnote ending 0.5px inside areaBox</aside></div>
  </div></div></div></div>
</body></html>`;

// P7 (CDX-21): the 0.5 px sub-pixel allowance below areaBox.bottom is reserved for fragments
// Paged.js marked as split (data-split-to on the fragment that continues, data-split-from or
// data-split-to on a zero-height split wrapper). An ordinary block ending 0.4 px below the area
// is a real overflow. The 1 px mark envelope above areaBox.bottom stays separate and unchanged.
const ROUNDING_FIXTURE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
  body { margin: 0; }
  .pagedjs_page { position: relative; width: 794px; height: 1123px; }
  .pagedjs_pagebox { position: relative; width: 794px; height: 1123px; }
  .pagedjs_page_content { position: relative; width: 733px; height: 994px; }
  .end-04 { position: absolute; left: 0; top: 950px; width: 300px; height: 44.4px; }
  .zero-03 { position: absolute; left: 0; top: 994.3px; width: 300px; height: 0; }
  .end-in-band { position: absolute; left: 400px; top: 950px; width: 300px; height: 43.6px; }
  .pagedjs_footnote_area { position: absolute; top: 954px; height: 40.4px; }
  .note-04 { position: absolute; left: 0; top: 0; width: 200px; height: 40.4px; }
</style></head><body>
  <div class="pagedjs_page"><div class="pagedjs_sheet"><div class="pagedjs_pagebox"><div class="pagedjs_area">
    <div class="pagedjs_page_content">
      <div class="end-04" data-bl-sid="split-end" data-split-to="t1">continues on the next page</div>
      <div class="end-04" data-bl-sid="plain-end">ends 0.4 px below the content area</div>
      <div class="zero-03" data-bl-sid="split-wrapper" data-split-from="t2"></div>
      <div class="zero-03" data-bl-sid="plain-zero"></div>
      <div class="end-in-band" data-bl-sid="in-band-end">ends 0.4 px inside the content area</div>
    </div>
    <div class="pagedjs_footnote_area"><aside class="note-04" data-bl-sid="split-note" data-split-to="t3">footnote</aside></div>
  </div></div></div></div>
</body></html>`;

describe("evidence overlay page membership, live", () => {
  let server: Server | null = null;
  let origin = "";
  let browser: BrowserLike | null = null;
  let profile: string | null = null;

  before(async (t) => {
    if (missingBrowser) {
      if (optional) return (t as { skip(message: string): void }).skip("missing browser");
      assert.fail("the page-membership regression requires a browser");
    }
    server = createServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(request.url === "/deferred.html" ? DEFERRED_FIXTURE : request.url === "/rounding.html" ? ROUNDING_FIXTURE : FIXTURE);
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    origin = `http://127.0.0.1:${address.port}`;
    const launched = await launchBrowser(REPO);
    assert.ok(launched.browser, launched.detail);
    browser = launched.browser;
    profile = launched.userDataDir ?? null;
  });

  after(async () => {
    let browserError: string | null = null;
    let serverError: string | null = null;
    try {
      if (browser) browserError = await closeBrowserBounded(browser);
    } finally {
      if (server) {
        try {
          await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
        } catch (error) {
          serverError = String(error);
        }
      }
    }
    assert.equal(browserError, null);
    assert.equal(serverError, null);
    assert.equal(cleanupBrowserProfile(profile), null);
  });

  async function page(path = "/fixture.html"): Promise<PageLike> {
    const current = await browser!.newPage();
    assert.ok(current.evaluateOnNewDocument, "browser page lacks the new-document primitive boundary");
    await current.evaluateOnNewDocument(PRIMITIVES_SOURCE);
    await current.setViewport({ width: 1000, height: 800 });
    await current.goto(`${origin}${path}`, { waitUntil: "load", timeout: 30_000 });
    return current;
  }

  it("uses only current-page client rects and records an all-outside source as unplaced", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    const current = await page();
    try {
      const rawRects = await current.evaluate<{ left: number; top: number }[]>(
        "window.__blPrimitives.rects(document.getElementById('fragmented'))",
      );
      assert.ok(rawRects.some((rect) => rect.left >= 0 && rect.left < 794), "fixture lost its in-page fragment");
      assert.ok(rawRects.some((rect) => rect.left > 794), "fixture lost its adjacent-page fragment");

      const installation = await installOverlay(current);
      assert.equal(installation.layers, 1);
      assert.deepEqual(installation.marks.map((mark) => mark.sid), ["fragmented", "fragmented", "right-edge", "right-edge"],
        "a flow fragment in the side margin, inside the page, was refused — or a margin-box clone was marked");
      assert.deepEqual(installation.marks.map((mark) => mark.side), ["start", "end", "start", "end"]);
      assert.ok(
        installation.marks.every((mark) => mark.page === 1 && mark.xPx >= 0 && mark.xPx < 794),
        `a mark escaped the current page: ${JSON.stringify(installation.marks)}`,
      );
      assert.ok(
        installation.marks.filter((mark) => mark.sid === "right-edge").every((mark) => mark.xPx > 733),
        "premise: the right-edge fragment starts in the margin, right of the 733 px content box",
      );
      assert.deepEqual(installation.unplacedMarks, [
        { sid: "outside", page: 1, side: "start", reason: "fragment-outside-page" },
        { sid: "outside", page: 1, side: "end", reason: "fragment-outside-page" },
        { sid: "past-edge", page: 1, side: "start", reason: "fragment-outside-page" },
        { sid: "past-edge", page: 1, side: "end", reason: "fragment-outside-page" },
      ], "the clone must be neither marked nor unplaced; only envelopes past the page edge are refused");
      assert.deepEqual(await readbackViolations(current), []);
      assert.equal(await detachOverlay(current), 1);
      assert.equal(await removeOverlay(current), 0);
    } finally {
      await current.close();
    }
  });

  it("uses the physical page box for a real boundary and excludes only proven deferred clones", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    const current = await page("/deferred.html");
    try {
      const geometry = await current.evaluate<{
        viewportBottom: number; physicalBottom: number; firstEnd: number; deferredX: number;
        collidedSideX: number; clippedNoteX: number; clippedNoteTop: number; areaBottom: number;
      }>(`(() => {
        const first = document.querySelector('.pagedjs_page');
        return {
          viewportBottom: first.getBoundingClientRect().bottom,
          physicalBottom: first.querySelector('.pagedjs_pagebox').getBoundingClientRect().bottom,
          firstEnd: first.querySelector('[data-bl-sid="continued"]').getBoundingClientRect().bottom,
          deferredX: first.querySelector('[data-bl-sid="deferred"]').getBoundingClientRect().x,
          collidedSideX: first.querySelector('.pagedjs_page_content [data-bl-sid="clipped-note"]').getBoundingClientRect().x,
          clippedNoteX: first.querySelector('.pagedjs_footnote_area [data-bl-sid="clipped-note"]').getBoundingClientRect().x,
          clippedNoteTop: first.querySelector('.pagedjs_footnote_area [data-bl-sid="clipped-note"]').getBoundingClientRect().top,
          areaBottom: first.querySelector('.pagedjs_page_content').getBoundingClientRect().bottom,
        };
      })()`);
      assert.ok(geometry.firstEnd > geometry.viewportBottom && geometry.firstEnd < geometry.physicalBottom,
        "fixture must place the real continuation edge outside the viewport but inside the physical page");
      assert.ok(geometry.deferredX > 794, "fixture must put deferred content in the side fragmentainer");
      assert.ok(geometry.collidedSideX > 794 && geometry.clippedNoteX < 794 &&
        geometry.clippedNoteTop > geometry.areaBottom && geometry.clippedNoteTop < geometry.physicalBottom,
      "fixture must put the colliding SID in both the deferrable side lane and the clipped footnote area");
      const installation = await installOverlay(current);
      assert.ok(installation.marks.some((mark) => mark.page === 1 && mark.sid === "continued" && mark.side === "end"),
        "the measured continuation boundary was refused despite lying on the physical page");
      assert.ok(installation.marks.some((mark) => mark.page === 1 && mark.sid === "zero-height-bottom" && mark.side === "start"),
        "a zero-height opening wrapper flush with areaBox.bottom must be placed inside the physical page");
      assert.equal(installation.unplacedMarks.some((mark) => mark.page === 1 && mark.sid === "zero-height-bottom"), false,
        "a zero-height opening wrapper flush with areaBox.bottom must not emit env/evidence-fragment-outside-page");
      assert.ok(installation.marks.some((mark) => mark.page === 1 && mark.sid === "zero-height-inner-band" && mark.side === "start") &&
        installation.marks.some((mark) => mark.page === 1 && mark.sid === "zero-height-inner-band" && mark.side === "end"),
      "a zero-height split wrapper strictly inside the final 1 px of areaBox must place both marks");
      assert.equal(installation.unplacedMarks.some((mark) => mark.page === 1 && mark.sid === "zero-height-inner-band"), false,
        "a zero-height split wrapper strictly inside areaBox must not emit env/evidence-fragment-outside-page");
      assert.ok(installation.marks.some((mark) => mark.page === 1 && mark.sid === "inner-band-end" && mark.side === "end"),
        "a container ending 0.75 px strictly inside areaBox must place its end mark");
      assert.equal(installation.unplacedMarks.some((mark) => mark.page === 1 && mark.sid === "inner-band-end"), false,
        "a container ending strictly inside areaBox must not emit env/evidence-fragment-outside-page");
      assert.deepEqual(installation.unplacedMarks.filter((mark) => mark.page === 1 && mark.sid === "overflow-bottom")
        .map((mark) => mark.side), ["end"],
      "a genuine 1.5 px overflow below areaBox.bottom must still refuse its end mark");
      assert.equal(installation.unplacedMarks.some((mark) => mark.page === 1 && mark.sid === "deferred"), false,
        "the next-page clone remained a phantom fragment of page 1");
      assert.equal(installation.unplacedMarks.some((mark) => mark.page === 1 && mark.sid === "deferred-child"), false,
        "descendants of the unbreakable deferred block remained phantom fragments");
      assert.equal(installation.unplacedMarks.some((mark) => mark.page === 1 && mark.sid === "deferred-later"), false,
        "a table-sized deferred clone two pages later remained a phantom fragment");
      assert.ok(installation.unplacedMarks.some((mark) => mark.page === 1 && mark.sid === "orphan"),
        "an avoid-break element outside the page was excluded without a printable clone");
      assert.ok(installation.unplacedMarks.some((mark) => mark.page === 1 && mark.sid === "escaped-child"),
        "an off-sheet child of a visible avoid-break container was mistaken for a deferred container");
      assert.deepEqual(installation.unplacedMarks.filter((mark) => mark.page === 1 && mark.sid === "clipped-note")
        .map((mark) => mark.side), ["start", "end"],
      "the side-lane clone may be excluded, but both marks of the separate clipped footnote must remain unplaced");
      assert.deepEqual(installation.unplacedMarks.filter((mark) => mark.page === 3 && mark.sid === "footnote-inner-band")
        .map((mark) => mark.side), ["end"],
      "G-100: a footnote edge inside the final 1 px band of areaBox must stay refused by notInFootnote");
      assert.deepEqual(await readbackViolations(current), []);
      assert.equal(await detachOverlay(current), 3);
      assert.equal(await removeOverlay(current), 0);
    } finally {
      await current.close();
    }
  });
  it("keeps the 0.5 px rounding allowance for proven split fragments only (P7)", async (t) => {
    if (missingBrowser && optional) return t.skip("missing browser");
    const current = await page("/rounding.html");
    try {
      const installation = await installOverlay(current);
      const placed = (sid: string, side: string) => installation.marks.some((mark) => mark.sid === sid && mark.side === side);
      const refused = (sid: string) => installation.unplacedMarks.filter((mark) => mark.sid === sid).map((mark) => mark.side).sort();
      // Positive controls: a fragment Paged.js split to the next page, and a zero-height split wrapper.
      assert.ok(placed("split-end", "end"), "a split fragment's end edge 0.4 px below areaBox is rounding");
      assert.ok(placed("split-wrapper", "start") && placed("split-wrapper", "end"), "a zero-height split wrapper 0.3 px below areaBox is rounding");
      // The separate 1 px mark envelope inside the area is unchanged for any element.
      assert.ok(placed("in-band-end", "end"), "an end edge inside the final 1 px band keeps its mark");
      // Negative controls: an ordinary end edge and an unsplit zero-height box past the area bottom.
      assert.deepEqual(refused("plain-end"), ["end"], "an unfragmented block ending 0.4 px below areaBox overflows");
      assert.deepEqual(refused("plain-zero"), ["end", "start"], "a zero-height box without split evidence gets no rounding");
      // Footnotes never get the allowance, split or not (G-100).
      assert.deepEqual(refused("split-note"), ["end"], "a footnote edge past areaBox stays refused");
      assert.deepEqual(await readbackViolations(current), []);
      await detachOverlay(current);
      await removeOverlay(current);
    } finally {
      await current.close();
    }
  });
});
