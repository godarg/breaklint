/**
 * The collector against a real paginator, on a document carrying every boundary kind at once.
 *
 * WHY ONE DOCUMENT AND NOT SIX. A method that always answers `forced` and a method that always
 * answers `overflow` both pass a corpus of single-purpose fixtures if each is checked only for the
 * answer it was built to give. The contract makes this explicit as the corpus red condition: the
 * mixed fixture must contain at least one forced and at least one overflow boundary, or a constant
 * answer is indistinguishable from a correct one. This document contains six kinds.
 *
 * The chain under test is the production one: the real source injector puts `data-bl-sid` into the
 * source text, the document is served from a loopback origin and NAVIGATED to, the primitives are
 * installed before any author script, and the collector registers against the real `Paged.Handler`.
 * Nothing here hand-feeds an attribute.
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
  cleanupBrowserProfile, closeBrowserBounded, integritySource, integrityStatusSource, orderedSourceSids,
  paginationApparatusSource, PAGINATION_PREVIEW_SOURCE, validateRuntimeSidState, withPagination,
  type RuntimeIntegrityStatus,
} from "../../src/acquire/render-run.ts";
import { SNAPSHOT_SOURCE, type RawSnapshot } from "../../src/measure/snapshot.ts";
import { PRIMITIVES_SOURCE, TEST_PRIMITIVES_CAPABILITY } from "../../src/measure/primitives.ts";
import { assignPageCauses, classifyBoundary } from "../../src/paginate/breaks.ts";
import { boundaryFactsFrom, collectorSource, silentHooks, type CollectorResult } from "../../src/paginate/collector.ts";
import { detectCollision } from "../../src/source/collision.ts";
import { injectSourceIds } from "../../src/source/inject.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const chromeAvailable = resolveBrowser().path !== null;
const pagedjsRoot = resolvePackageRoot("pagedjs", REPO);
const optional = process.env.BREAKLINT_LIVE_OPTIONAL === "1";
const missing = [chromeAvailable ? null : "a browser", pagedjsRoot ? null : "pagedjs"].filter(
  (x): x is string => x !== null,
);

/**
 * Every boundary kind the contract names, in one document.
 *
 * `#named` is the load-bearing one: a named page produces `data-page` and NO break attribute of
 * any kind, so a reader that knows only `data-break-before` and `data-previous-break-after` calls
 * that boundary free. It is the contract's `K17`.
 *
 * `#afterme` carries an INLINE `break-after`, measured inert in 0.4.3 — it must NOT produce a
 * boundary. Without it, a method that treated any declaration as forcing would still pass.
 */
const AUTHOR_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
@page{size:120mm 80mm;margin:10mm}
@page named { size: 120mm 80mm; margin: 10mm }
body{font:9pt/1.4 Georgia,serif;margin:0} p,h2{margin:0 0 6px} h2{font-size:11pt}
.chapter{ break-before: page }
#idchap{ break-before: page }
#named{ page: named }
#rectochap{ break-before: recto }
.endshere{ break-after: page }
section.region{ page: region }
</style></head><body>
<p id="a0">A0 opening paragraph with enough text to occupy a little of the first page here.</p>
<p id="a1">A1 more text so the page has some content before the forced break arrives now.</p>
<h2 id="chap" class="chapter">Chapter forced by a stylesheet CLASS selector</h2>
<p id="b0">B0 text after the class-forced break, filling this page for a while longer.</p>
<p id="b1" class="endshere">B1 carries a stylesheet break-after, so B2 opens a page.</p>
<p id="b2">B2 must therefore begin a new page, via data-previous-break-after.</p>
<p id="afterme" style="break-after: page">INLINE break-after, measured INERT in 0.4.3</p>
<p id="c0">C0 follows the inert inline break-after and should NOT be a forced boundary.</p>
${Array.from({ length: 10 }, (_, i) => `<p id="f${i}">F${i} overflow filler text repeated to force a natural overflow boundary somewhere.</p>`).join("\n")}
<h2 id="idchap">Chapter forced by a stylesheet ID selector</h2>
<p id="d0">D0 after the id-forced break.</p>
<div id="named">NAMED PAGE region, forced by data-page changing and nothing else</div>
<p id="e0">E0 after the named page.</p>
<section class="region" id="region">
${Array.from({ length: 7 }, (_, i) => `<p id="r${i}">R${i} paragraph inside a NAMED SECTION, long enough that the region spans two pages.</p>`).join("\n")}
</section>
<p id="postregion">POSTREGION leaves the named section; data-page lives on the SECTION, not here.</p>
<h2 id="rectochap">Chapter forced onto a recto page, which may insert a blank</h2>
<p id="g0">G0 after the recto break.</p>
</body></html>`;

/**
 * The same parity mechanism with a running header, which Paged.js clones into the margin box of
 * EVERY page — the blank verso page included — keeping the header's source id.
 *
 * The collector used to read source nodes from the whole page, so on this document the clone made
 * the blank page look occupied and both of its boundaries lost `parity`. It also became the first
 * source-bearing node of every page, because the margin boxes precede the content area in the
 * page box. The header is the first element of the source on purpose: its in-flow original, which
 * Paged.js hides with `display: none`, then sits on page 1 and is a real edge of the flow there.
 */
const RUNNING_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
@page{size:120mm 80mm;margin:10mm}
@page{ @top-center{ content: element(title) } }
body{font:9pt/1.4 Georgia,serif;margin:0} p,h2{margin:0 0 6px} h2{font-size:11pt}
.title{ position: running(title) }
.recto{ break-before: recto }
</style></head><body>
<p class="title" id="rtitle">Running title on every page</p>
<p id="rc1">Chapter one, the only paragraph on the first page.</p>
<h2 class="recto" id="rch2">Chapter two opens on a recto page</h2>
<p id="rc2">Chapter two text.</p>
</body></html>`;

/**
 * A block footnote (`float: footnote`). Paged.js moves it out of the page content into the
 * footnote area of the same page: inside the page area, after the page's content in document
 * order. It stays part of the flow for measurement, and its new position is out of source order,
 * which the source-id integrity check must accept.
 */
const FOOTNOTE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
@page{size:120mm 80mm;margin:10mm}
body{font:9pt/1.4 Georgia,serif;margin:0} p{margin:0 0 6px}
.fn{ float: footnote }
</style></head><body>
<p id="fp1">A paragraph whose footnote follows it in the source.</p>
<aside class="fn" id="fnote">A block footnote, moved into the footnote area.</aside>
<p id="fp2">A paragraph after the footnote in the source, before it on the page.</p>
</body></html>`;

/**
 * What Snapshot 5 records per block, against the real paginator: a running title (Paged.js hides
 * the in-flow original with `display: none` and clones it into a margin box of every page), a list
 * whose items are flattened with `display: contents` and keep `break-inside: avoid`, an image-only
 * `display: contents` figure, and a paragraph the author hid.
 */
const DISPLAY_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
@page{size:120mm 80mm;margin:10mm; @top-center{ content: element(title) } }
body{font:9pt/1.4 Georgia,serif;margin:0} p{margin:0 0 6px}
.title{ position: running(title) }
li{ break-inside: avoid } ul.flat, ul.flat > li { display: contents }
figure{ margin: 0 } .contents{ display: contents }
.gone{ display: none }
</style></head><body>
<p class="title" id="dtitle">Running title</p>
<p id="d1">A paragraph before the flattened list.</p>
<ul class="flat" id="dul"><li id="dli1">First flattened item.</li><li id="dli2">Second flattened item.</li></ul>
<figure class="contents" id="dfig"><img alt="" width="40" height="30" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='30'%3E%3Crect width='40' height='30'/%3E%3C/svg%3E"></figure>
<p class="gone" id="dgone">Hidden by the author.</p>
${Array.from({ length: 12 }, (_, i) => `<p id="dp${i}">Filler paragraph ${i}, one line of running text.</p>`).join("\n")}
</body></html>`;

/**
 * A `position: fixed` stamp with a nested source block, on a document with a parity-blank page.
 * Paged.js removes the element from the flow and inserts a clone at the head of EVERY page box,
 * the blank page's included: the signature the source-id check accepts for a page-box id.
 */
const FIXED_BODY = Array.from({ length: 5 }, (_, i) => `<p id="fx${i}">Fixed-stamp document, paragraph ${i}, one line.</p>`).join("\n");
const FIXED_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
@page{size:120mm 80mm;margin:10mm}
body{font:9pt/1.4 Georgia,serif;margin:0} p,h2{margin:0 0 6px}
.stamp{ position: fixed; top: 2mm; right: 2mm; font-size: 7pt }
.recto{ break-before: recto }
</style></head><body>
<div class="stamp" id="stamp"><p id="stamp-text">DRAFT</p></div>
${FIXED_BODY}
<h2 class="recto" id="fxh">After the blank page</h2>
<p id="fxlast">The last paragraph.</p>
</body></html>`;

/**
 * The negative control, reproduced from the round-2 verification: a script that moves an in-flow
 * paragraph into the page box once Paged.js has laid it out. It is then outside every measurement;
 * the source-id check must refuse it.
 */
const PAGEBOX_MOVE_HTML = FIXED_HTML.replace("</body>", `<script>
(() => {
  let done = false;
  new MutationObserver(() => {
    if (done) return;
    const el = document.querySelector(".pagedjs_page_content #fx3");
    if (!el) return;
    done = true;
    el.closest(".pagedjs_page").querySelector(".pagedjs_pagebox").appendChild(el);
  }).observe(document.documentElement, { subtree: true, childList: true });
})();
</script>
</body>`);

/**
 * The pagination bootstrap breaklint owns: `paged.js`, never the auto-previewing polyfill.
 *
 * The replacement is a FUNCTION, and that is not style. `String.replace` interprets `$&`, `` $` ``,
 * `$'` and `$1`..`$9` inside a replacement STRING, and the Paged.js bundle is full of `$`
 * sequences. Splicing it in as a string silently corrupted the library — the page reported
 * `SyntaxError: Invalid or unexpected token`, then `Paged is not defined`, and every case in this
 * file timed out waiting for a pagination that could never happen. A replacer function receives
 * the replacement verbatim and has no such substitution.
 */
describe("the collector, live", () => {
  let browser: BrowserLike | null = null;
  let browserProfile: string | null = null;
  let server: Server | null = null;
  let serverLifecycle: ReturnType<typeof ownServerLifecycle> | null = null;
  let origin = "";
  let served = "";
  let servedRunning = "";
  let servedFootnote = "";
  let footnoteExpectedSids: string[] = [];
  let servedFixed = "";
  let servedDisplay = "";
  const displaySidByAuthorId: Record<string, string> = {};
  let servedPageboxMove = "";
  let fixedExpectedSids: string[] = [];
  let pageboxMoveExpectedSids: string[] = [];
  const fixedSidByAuthorId: Record<string, string> = {};
  let sidByAuthorId: Record<string, string> = {};
  const runningSidByAuthorId: Record<string, string> = {};
  const footnoteSidByAuthorId: Record<string, string> = {};

  before(async () => {
    if (missing.length > 0) {
      if (optional) return;
      assert.fail(`this suite cannot run without: ${missing.join(", ")}. Set BREAKLINT_LIVE_OPTIONAL=1 to skip.`);
    }
    // The collision gate first, exactly as the production path runs it: on the ORIGINAL text.
    assert.equal(
      detectCollision([{ origin: "document", text: AUTHOR_HTML }]).collided,
      false,
      "the fixture must not itself use the reserved prefix, or it would never reach the paginator",
    );
    const injected = injectSourceIds(AUTHOR_HTML, "fixture.html");
    // Map the author's ids to the injected source ids, so assertions can talk about `chap` rather
    // than about `s0004` — which would drift the moment a paragraph is added.
    for (const [sid, ref] of Object.entries(injected.map)) {
      const tag = AUTHOR_HTML.slice(ref.offset, ref.offset + 200);
      const id = /\bid="([^"]+)"/u.exec(tag)?.[1];
      if (id) sidByAuthorId[id] = sid;
    }
    const pagedjs = readFileSync(join(pagedjsRoot!, "dist", "paged.js"), "utf8");
    served = withPagination(injected.html, pagedjs, true);
    assert.equal(detectCollision([{ origin: "document", text: RUNNING_HTML }]).collided, false);
    const running = injectSourceIds(RUNNING_HTML, "running.html");
    for (const [sid, ref] of Object.entries(running.map)) {
      const id = /\bid="([^"]+)"/u.exec(RUNNING_HTML.slice(ref.offset, ref.offset + 200))?.[1];
      if (id) runningSidByAuthorId[id] = sid;
    }
    servedRunning = withPagination(running.html, pagedjs, true);
    const footnote = injectSourceIds(FOOTNOTE_HTML, "footnote.html");
    for (const [sid, ref] of Object.entries(footnote.map)) {
      const id = /\bid="([^"]+)"/u.exec(FOOTNOTE_HTML.slice(ref.offset, ref.offset + 200))?.[1];
      if (id) footnoteSidByAuthorId[id] = sid;
    }
    footnoteExpectedSids = orderedSourceSids(footnote.map);
    servedFootnote = withPagination(footnote.html, pagedjs, true);
    for (const html of [FIXED_HTML, PAGEBOX_MOVE_HTML]) {
      assert.equal(detectCollision([{ origin: "document", text: html }]).collided, false);
    }
    assert.equal(detectCollision([{ origin: "document", text: DISPLAY_HTML }]).collided, false);
    const display = injectSourceIds(DISPLAY_HTML, "display.html");
    for (const [sid, ref] of Object.entries(display.map)) {
      const id = /\bid="([^"]+)"/u.exec(DISPLAY_HTML.slice(ref.offset, ref.offset + 200))?.[1];
      if (id) displaySidByAuthorId[id] = sid;
    }
    servedDisplay = withPagination(display.html, pagedjs, true);
    const fixed = injectSourceIds(FIXED_HTML, "fixed.html");
    for (const [sid, ref] of Object.entries(fixed.map)) {
      const id = /\bid="([^"]+)"/u.exec(FIXED_HTML.slice(ref.offset, ref.offset + 200))?.[1];
      if (id) fixedSidByAuthorId[id] = sid;
    }
    fixedExpectedSids = orderedSourceSids(fixed.map);
    servedFixed = withPagination(fixed.html, pagedjs, true);
    const moved = injectSourceIds(PAGEBOX_MOVE_HTML, "pagebox-move.html");
    pageboxMoveExpectedSids = orderedSourceSids(moved.map);
    servedPageboxMove = withPagination(moved.html, pagedjs, true);

    server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      const routes: Record<string, string> = {
        "/running.html": servedRunning, "/footnote.html": servedFootnote, "/fixed.html": servedFixed,
        "/pagebox-move.html": servedPageboxMove, "/display.html": servedDisplay,
      };
      res.end(routes[req.url ?? ""] ?? served);
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

  async function collect(path = "/doc.html"): Promise<{ page: PageLike; result: CollectorResult }> {
    const collectorNonce = "breaks-live-collector";
    const page = await browser!.newPage();
    await (page as unknown as { evaluateOnNewDocument(s: string): Promise<unknown> }).evaluateOnNewDocument(
      PRIMITIVES_SOURCE,
    );
    await (page as unknown as { evaluateOnNewDocument(s: string): Promise<unknown> }).evaluateOnNewDocument(
      integritySource([]),
    );
    await page.setViewport({ width: 900, height: 700 });
    await page.emulateMediaType("print");
    await page.goto(`${origin}${path}`, { waitUntil: "load", timeout: 30_000 });
    await page.evaluate<void>(collectorSource(TEST_PRIMITIVES_CAPABILITY, collectorNonce));
    await page.evaluate<void>(paginationApparatusSource(TEST_PRIMITIVES_CAPABILITY));
    const pagination = await page.evaluate<{ paginationError: string | null }>(PAGINATION_PREVIEW_SOURCE);
    assert.equal(pagination.paginationError, null);
    const epoch = await page.evaluate<RuntimeIntegrityStatus>(integrityStatusSource(TEST_PRIMITIVES_CAPABILITY));
    assert.equal(epoch.paginationPreviewCalls, 1);
    const result = await page.evaluate<CollectorResult>(
      `window.__blPrimitives.collectorResult(${JSON.stringify(TEST_PRIMITIVES_CAPABILITY)}, ${JSON.stringify(collectorNonce)})`,
    );
    return { page, result };
  }

  it("every registered hook fired", async (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const { page, result } = await collect();
    assert.deepEqual(
      silentHooks(result.hooks),
      [],
      "a hook wired by method-name equality never fired — a typo here is a silent no-op, and a " +
        "silent afterPageLayout means no break tokens and every boundary classified unknown",
    );
    for (const [name, count] of Object.entries(result.hooks)) {
      assert.ok(count > 0, `${name} fired ${count} times`);
    }
    await page.close();
  });

  /**
   * The classification of every boundary in the document, against what was MEASURED.
   *
   * The expected sequence is a literal. It is not computed from the collector's own output, and it
   * is not derived from the classifier: it is what a reading of Paged.js 0.4.3's DOM produced when
   * this fixture was measured, boundary by boundary.
   */
  it("classifies all six boundary kinds, and the inline break-after produces none", async (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const { page, result } = await collect();
    const facts = boundaryFactsFrom(result.pages);
    const causes = facts.map((f) => classifyBoundary(f));
    const kinds = causes.map((c) => c.kind);

    // The corpus red condition, asserted before anything else: a document that carried only one
    // kind could not tell a correct method from a constant one.
    assert.ok(kinds.includes("forced"), "the fixture must contain a forced boundary");
    assert.ok(kinds.includes("overflow"), "the fixture must contain an overflow boundary");
    assert.ok(kinds.includes("parity"), "the fixture must contain a parity blank page");

    // The full sequence, as a literal, measured against the real paginator.
    assert.deepEqual(
      kinds,
      [
        "forced",   // break-before, stylesheet CLASS
        "forced",   // break-after, stylesheet CLASS -> data-previous-break-after on the NEXT node
        "overflow",
        "overflow",
        "forced",   // break-before, stylesheet ID
        "forced",   // INTO the named div
        "forced",   // OUT of the named div
        "forced",   // INTO the named section
        "overflow", // inside the section: both sides resolve to the same name via the ancestor
        "forced",   // OUT of the named section - resolved through the ancestor, not the leaf
        "parity",   // the blank page the recto declaration inserted
        "forced",   // break-before: recto
      ],
      `boundary kinds changed: ${JSON.stringify(causes.map((c) => [c.kind, c.reason]))}`,
    );

    // The source-id mapping must exist BEFORE it is used as an oracle. Without this, a broken
    // mapping turns every assertion below into a comparison of two undefineds, and the inert-break
    // assertion at the end becomes trivially true. An audit found exactly that hole.
    for (const id of ["chap", "b1", "idchap", "named", "region", "postregion", "rectochap", "afterme"]) {
      assert.ok(sidByAuthorId[id], `no source id was mapped for #${id}; the assertions below would be vacuous`);
    }

    // And each forced boundary must name the RIGHT element, not merely be forced.
    const reasonFor = (index: number): string => causes[index]!.reason;
    assert.equal(reasonFor(0), `break-before@${sidByAuthorId["chap"]}`, "the class-forced break");
    assert.equal(reasonFor(1), `break-after@${sidByAuthorId["b1"]}`, "a stylesheet break-after names the DECLARING node");
    assert.equal(reasonFor(4), `break-before@${sidByAuthorId["idchap"]}`, "the id-forced break");
    assert.equal(reasonFor(5), `page@${sidByAuthorId["named"]}`, "the named-page break, the third branch");
    assert.equal(reasonFor(7), `page@${sidByAuthorId["region"]}`, "entering a named SECTION");
    assert.equal(
      reasonFor(9),
      `page@${sidByAuthorId["postregion"]}`,
      "LEAVING a named section. The name lives on the SECTION, not on the leaf paragraphs, so a " +
        "reader that looks only at the leaf sees null against null and calls this an overflow.",
    );
    assert.equal(reasonFor(11), `break-before@${sidByAuthorId["rectochap"]}`, "the recto-forced break");

    // The inline break-after is inert: no boundary anywhere names it.
    assert.ok(
      !causes.some((c) => c.reason.includes(sidByAuthorId["afterme"]!)),
      "an inline break-after produced a boundary - measured inert in 0.4.3",
    );
    await page.close();
  });

  /**
   * The `data-page` branch, isolated.
   *
   * This is the one an incomplete reader misses, so it gets its own case: the boundary must be
   * forced while carrying NO break attribute at all. If it ever starts carrying one, the case
   * says so rather than passing for a different reason than the one it names.
   */
  it("the named-page boundary is forced with no break attribute present", async (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const { page, result } = await collect();
    const facts = boundaryFactsFrom(result.pages);
    const named = facts.find((f) => f.pageAfter === "named");
    assert.ok(named, "no boundary onto a named page was collected");
    assert.equal(named!.breakBefore, null, "the premise: this boundary has NO break-before");
    assert.equal(named!.previousBreakAfter, null, "the premise: and NO previous-break-after");
    assert.equal(classifyBoundary(named!).kind, "forced");
    await page.close();
  });

  /**
   * The blank page inserted by `break-before: recto`, and parity on BOTH of its sides.
   *
   * Two things an audit found wrong with the previous version of this case. It asserted only the
   * INCOMING side, while the contract binds both — and the outgoing side was in fact `forced`,
   * because the page after the blank one carries the recto declaration. And it located the blank
   * page by `p.blank`, the very field under test, so a collector that marked the wrong page blank
   * would have been checked against its own answer.
   *
   * The page is now identified independently: it is the one page carrying no author source id at
   * all, computed from the source map rather than from the collector's verdict.
   */
  it("a recto break inserts a blank page, and that page is parity on BOTH sides", async (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const { page, result } = await collect();

    const withoutAuthorContent = result.pages.filter((p) => p.firstSid === null && p.lastSid === null);
    assert.equal(withoutAuthorContent.length, 1, "exactly one page should carry no author content");
    const blankIndex = withoutAuthorContent[0]!.index;
    assert.equal(result.pages[blankIndex]!.blank, true, "the collector must agree that page is blank");
    assert.equal(
      result.pages.filter((p) => p.blank).length,
      1,
      "the collector must not mark any other page blank",
    );

    const causes = assignPageCauses(
      result.pages.length,
      boundaryFactsFrom(result.pages),
      result.pages.map((p) => p.blank),
    );
    assert.equal(causes[blankIndex]!.incoming.kind, "parity", "the boundary INTO the blank page");
    assert.equal(causes[blankIndex]!.outgoing.kind, "parity", "the boundary OUT of the blank page");
    assert.equal(causes[blankIndex]!.outgoing.determinedBy, "page-blank");
    await page.close();
  });

  /**
   * The recto blank page again, now under a running header. The premise is checked against the
   * paginated tree itself before the collector is judged: the header must really be cloned into a
   * margin box of every page, or a collector that still counted clones would pass by accident.
   */
  it("a running header cloned into every margin box does not occupy the recto blank page", async (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    for (const id of ["rtitle", "rc1", "rch2", "rc2"]) {
      assert.ok(runningSidByAuthorId[id], `no source id was mapped for #${id}; the assertions below would be vacuous`);
    }
    const { page, result } = await collect("/running.html");
    const title = runningSidByAuthorId["rtitle"]!;
    const clones = await page.evaluate<number[]>(`[...document.querySelectorAll(".pagedjs_page")].map((pageEl) =>
      pageEl.querySelectorAll(".pagedjs_margin [data-bl-sid='${title}']").length)`);
    assert.equal(result.pages.length, 3, "chapter one, the inserted verso page, chapter two");
    assert.deepEqual(clones, [1, 1, 1], "premise: Paged.js cloned the header into a margin box of every page");

    assert.deepEqual(result.pages.map((p) => p.blank), [false, true, false], "a margin-box clone made the blank page look occupied");
    assert.deepEqual(result.pages.map((p) => p.firstSid), [title, null, runningSidByAuthorId["rch2"]],
      "a margin-box clone became the first node of a page");
    assert.deepEqual(result.pages.map((p) => p.lastSid), [runningSidByAuthorId["rc1"], null, runningSidByAuthorId["rc2"]]);
    const causes = assignPageCauses(result.pages.length, boundaryFactsFrom(result.pages), result.pages.map((p) => p.blank));
    assert.equal(causes[1]!.incoming.kind, "parity", "the boundary INTO the blank page");
    assert.equal(causes[1]!.outgoing.kind, "parity", "the boundary OUT of the blank page");
    assert.equal(causes[1]!.outgoing.determinedBy, "page-blank");
    assert.deepEqual(result.attributeDrift, []);
    await page.close();
  });

  /**
   * The footnote area is part of the page area, so a block footnote stays on its page: in the
   * snapshot, and in the collector's blank test. It is not an EDGE of the page's flow: Paged.js
   * places it after the page content, out of source order and out of the element it was written
   * in, so the page edges are read from the page content (`tests/unit/footnotes.test.ts` has the
   * named-page boundary this protects). The source-id check reads the order of the page content
   * only. This is the real-paginator observation of what `tests/unit/margin-boxes.test.ts`
   * checks on a hand-built tree; the production chain runs footnotes end to end in
   * `tests/live/real-documents.test.ts`.
   */
  it("keeps a block footnote in the flow and accepts its out-of-source-order position", async (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    for (const id of ["fp1", "fnote", "fp2"]) assert.ok(footnoteSidByAuthorId[id], `no source id was mapped for #${id}`);
    const { page, result } = await collect("/footnote.html");
    const note = footnoteSidByAuthorId["fnote"]!;
    const placement = await page.evaluate<{ inFootnoteArea: boolean; pages: number }>(`(() => ({
      inFootnoteArea: !!document.querySelector(".pagedjs_footnote_area [data-bl-sid='${note}']"),
      pages: document.querySelectorAll(".pagedjs_page").length }))()`);
    assert.equal(placement.inFootnoteArea, true, "premise: Paged.js moved the footnote into the footnote area");
    const raw = await page.evaluate<RawSnapshot>(SNAPSHOT_SOURCE);
    assert.deepEqual(raw.blocks.filter((block) => block.sid === note).map((block) => block.page), [1],
      "the footnote was dropped from the flow, or recorded more than once");
    assert.equal(result.pages[0]!.lastSid, footnoteSidByAuthorId["fp2"], "the footnote was read as the end of the page's flow");
    assert.equal(result.pages[0]!.blank, false);
    const integrity = await page.evaluate<RuntimeIntegrityStatus>(integrityStatusSource(TEST_PRIMITIVES_CAPABILITY));
    assert.deepEqual(validateRuntimeSidState(footnoteExpectedSids, integrity), [],
      "the footnote's position after the page content was read as a source-id order violation");
    await page.close();
  });

  /**
   * The page box accepts only a `position: fixed` clone, observed with the real paginator: the
   * stamp and its nested paragraph are at the head of every page box, the parity-blank page's
   * included, and nowhere in the flow, and the check accepts them. The paired control moves an
   * in-flow paragraph into one page box after layout — on the round-2 code that ended exit 0 with
   * the paragraph unmeasured — and the check names it.
   */
  it("accepts a position: fixed clone in every page box and refuses a paragraph a script moved there", async (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const stamp = fixedSidByAuthorId["stamp"]!, stampText = fixedSidByAuthorId["stamp-text"]!;
    assert.ok(stamp && stampText, "no source id was mapped for the stamp");
    const fixed = await collect("/fixed.html");
    const layout = await fixed.page.evaluate<{ pages: number; blank: number; stamps: number; headOfBox: number; inFlow: number }>(`(() => {
      const pages = [...document.querySelectorAll(".pagedjs_page")];
      const boxes = pages.map((page) => page.querySelector(".pagedjs_pagebox"));
      return {
        pages: pages.length,
        blank: pages.filter((page) => page.classList.contains("pagedjs_blank_page")).length,
        stamps: boxes.filter((box) => box.querySelector(":scope > [data-bl-sid='${stamp}'] [data-bl-sid='${stampText}']")).length,
        headOfBox: boxes.filter((box) => box.firstElementChild && box.firstElementChild.getAttribute("data-bl-sid") === "${stamp}").length,
        inFlow: document.querySelectorAll(".pagedjs_page_content [data-bl-sid='${stamp}']").length,
      };
    })()`);
    assert.ok(layout.pages >= 3 && layout.blank >= 1, `premise: a multi-page document with a blank page, got ${JSON.stringify(layout)}`);
    assert.equal(layout.stamps, layout.pages, "premise: Paged.js put the stamp with its paragraph in every page box");
    assert.equal(layout.headOfBox, layout.pages, "premise: the clone is the first child of every page box");
    assert.equal(layout.inFlow, 0, "premise: the fixed element left the flow");
    const fixedStatus = await fixed.page.evaluate<RuntimeIntegrityStatus>(integrityStatusSource(TEST_PRIMITIVES_CAPABILITY));
    assert.deepEqual(validateRuntimeSidState(fixedExpectedSids, fixedStatus), [],
      "a position: fixed clone in every page box was read as a moved element");
    await fixed.page.close();

    const moved = await collect("/pagebox-move.html");
    const premise = await moved.page.evaluate<number>(
      `document.querySelectorAll(".pagedjs_pagebox > p[data-bl-sid]").length`);
    assert.equal(premise, 1, "premise: the script moved the paragraph into a page box");
    const movedStatus = await moved.page.evaluate<RuntimeIntegrityStatus>(integrityStatusSource(TEST_PRIMITIVES_CAPABILITY));
    const issues = validateRuntimeSidState(pageboxMoveExpectedSids, movedStatus);
    assert.ok(issues.some((issue) => /page box but is not a position: fixed clone/u.test(issue)),
      `a paragraph moved into the page box passed the source-id check: ${JSON.stringify(issues)}`);
    await moved.page.close();
  });

  /**
   * Snapshot 5's two block facts, read by the real snapshot payload over the real paginator. The
   * rules decide by them: the running original is `rule/target-in-margin-box`, the author-hidden
   * paragraph `rule/target-not-rendered`, and the `display: contents` items and figure are not
   * judged as boxes at all (`break-inside` does not apply) — see tests/unit/margin-boxes.test.ts.
   */
  it("records the computed display and the margin-box copies of every block", async (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    for (const id of ["dtitle", "dli1", "dli2", "dfig", "dgone", "d1"]) assert.ok(displaySidByAuthorId[id], `no source id was mapped for #${id}`);
    const { page } = await collect("/display.html");
    const pages = await page.evaluate<number>(`document.querySelectorAll(".pagedjs_page").length`);
    assert.ok(pages >= 2, `premise: the document spans pages (${pages})`);
    const raw = await page.evaluate<RawSnapshot>(SNAPSHOT_SOURCE);
    const only = (id: string) => {
      const records = raw.blocks.filter((block) => block.sid === displaySidByAuthorId[id]);
      assert.equal(records.length, 1, `#${id}: ${records.length} records`);
      return records[0]!;
    };
    const facts = (id: string) => { const b = only(id); return { display: b.display, marginCopies: b.marginCopies, hasBox: b.box.width !== 0 || b.box.height !== 0 }; };
    assert.deepEqual(facts("dtitle"), { display: "none", marginCopies: pages, hasBox: false }, "the running original");
    assert.deepEqual(facts("dgone"), { display: "none", marginCopies: 0, hasBox: false }, "the author-hidden paragraph");
    for (const id of ["dli1", "dli2", "dfig"]) assert.deepEqual(facts(id), { display: "contents", marginCopies: 0, hasBox: false }, `#${id}`);
    assert.ok((only("dli1").lines ?? []).length > 0, "premise: a display: contents item's text is laid out in lines");
    assert.deepEqual(facts("d1"), { display: "block", marginCopies: 0, hasBox: true });
    await page.close();
  });

  /** The tokens are real: the pages that ran out of room have one, the last page does not. */
  it("the last page has no break token, and the overflow pages do", async (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const { page, result } = await collect();
    const last = result.pages[result.pages.length - 1]!;
    assert.equal(last.hasBreakToken, false, "the last page cannot have run out of room");
    assert.ok(
      result.pages.some((p) => p.hasBreakToken),
      "no page had a break token at all — afterPageLayout is not receiving them",
    );
    await page.close();
  });

  /**
   * Reconciliation: nothing was dropped, and the attributes did not move under the measurement.
   *
   * `discardedRecords` and `attributeDrift` are counters attached to the verdict rather than
   * diagnostics. A filter that discards silently is a defect this project has already paid for.
   */
  it("nothing was discarded, nothing went unreconciled, and no attribute drifted", async (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const { page, result } = await collect();
    assert.equal(result.discardedRecords, 0, "a page record did not survive to the final page list");
    assert.equal(result.unreconciledPages, 0, "a final page was never reported by afterPageLayout");
    assert.deepEqual(result.attributeDrift, [], "an edge field changed after layout - the tree moved");
    // An implementation returning constant 0 / [] / 1 would satisfy everything above. These say the
    // fields are computed from something real: every page IS reconciled, and the epoch counter is
    // a count of generations rather than a literal.
    assert.ok(result.pages.length > 5, "too few pages for this to mean anything");
    assert.ok(result.pages.every((p) => p.reconciled), "every page must carry a layout record");
    assert.ok(result.epochCount >= 1, "at least one generation must have been counted");
    assert.ok(
      result.pages.every((p) => p.epoch < result.epochCount),
      "a page reported a generation the run never reached - epochCount is not counting them",
    );
    await page.close();
  });

  /**
   * The snapshot invariant, on a real document: `pages[i].incoming === pages[i-1].outgoing`.
   *
   * Held by identity rather than by two computations agreeing, and checked here against a real
   * nine-page run because a fixture that broke this exact invariant has been found in this repo's
   * corpus before.
   */
  it("every page's incoming cause is the previous page's outgoing cause", async (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const { page, result } = await collect();
    const causes = assignPageCauses(
      result.pages.length,
      boundaryFactsFrom(result.pages),
      result.pages.map((p) => p.blank),
    );
    assert.ok(causes.length > 5, "too few pages for this to mean anything");
    for (let i = 1; i < causes.length; i += 1) {
      assert.equal(causes[i]!.incoming, causes[i - 1]!.outgoing, `page ${i} disagrees with page ${i - 1}`);
    }
    assert.equal(causes[0]!.incoming.kind, "document-start");
    assert.equal(causes[causes.length - 1]!.outgoing.kind, "document-end");
    await page.close();
  });
});
