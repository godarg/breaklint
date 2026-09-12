/**
 * A real-DOM regression for the page-membership boundary of the evidence overlay.
 *
 * Paged.js can expose a continuation rectangle from an adjacent displayed page through a source
 * node reached under the current page clone.  The geometry below is deliberately smaller than a
 * whole paginated book but has the same observable shape: one native inline element has both an
 * in-page client rect and a second rect at x=1800 while its containing page is only 794px wide.
 * The oracle is the browser's native getClientRects, captured before the page content runs.
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
  #right-edge { position: absolute; left: 730px; top: 120px; }
  #hidden { display: none; }
</style></head><body>
  <div class="pagedjs_page"><div class="pagedjs_page_content">
    <section id="fragmented" data-bl-sid="fragmented">current<br><span class="far">continuation</span></section>
    <section id="outside" data-bl-sid="outside">outside current page</section>
    <section id="right-edge" data-bl-sid="right-edge">near edge</section>
    <section id="hidden" data-bl-sid="hidden">historically excluded non-rendered target</section>
  </div></div>
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
    server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(FIXTURE);
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

  async function page(): Promise<PageLike> {
    const current = await browser!.newPage();
    assert.ok(current.evaluateOnNewDocument, "browser page lacks the new-document primitive boundary");
    await current.evaluateOnNewDocument(PRIMITIVES_SOURCE);
    await current.setViewport({ width: 1000, height: 800 });
    await current.goto(`${origin}/fixture.html`, { waitUntil: "load", timeout: 30_000 });
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
      assert.deepEqual(installation.marks.map((mark) => mark.sid), ["fragmented", "fragmented"]);
      assert.deepEqual(installation.marks.map((mark) => mark.side), ["start", "end"]);
      assert.ok(
        installation.marks.every((mark) => mark.page === 1 && mark.xPx >= 0 && mark.xPx < 794),
        `a mark escaped the current page: ${JSON.stringify(installation.marks)}`,
      );
      assert.deepEqual(installation.unplacedMarks, [
        { sid: "outside", page: 1, side: "start", reason: "fragment-outside-page" },
        { sid: "outside", page: 1, side: "end", reason: "fragment-outside-page" },
        { sid: "right-edge", page: 1, side: "start", reason: "fragment-outside-page" },
        { sid: "right-edge", page: 1, side: "end", reason: "fragment-outside-page" },
      ]);
      assert.deepEqual(await readbackViolations(current), []);
      assert.equal(await detachOverlay(current), 1);
      assert.equal(await removeOverlay(current), 0);
    } finally {
      await current.close();
    }
  });
});
