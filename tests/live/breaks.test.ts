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
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { launchBrowser, resolveBrowser, resolvePackageRoot, type BrowserLike, type PageLike } from "../../src/acquire/browser.ts";
import { PRIMITIVES_SOURCE } from "../../src/measure/primitives.ts";
import { assignPageCauses, classifyBoundary } from "../../src/paginate/breaks.ts";
import { boundaryFactsFrom, COLLECTOR_SOURCE, silentHooks, type CollectorResult } from "../../src/paginate/collector.ts";
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
 * The pagination bootstrap breaklint owns: `paged.js`, never the auto-previewing polyfill.
 *
 * The replacement is a FUNCTION, and that is not style. `String.replace` interprets `$&`, `` $` ``,
 * `$'` and `$1`..`$9` inside a replacement STRING, and the Paged.js bundle is full of `$`
 * sequences. Splicing it in as a string silently corrupted the library — the page reported
 * `SyntaxError: Invalid or unexpected token`, then `Paged is not defined`, and every case in this
 * file timed out waiting for a pagination that could never happen. A replacer function receives
 * the replacement verbatim and has no such substitution.
 */
function withPagination(html: string, pagedjs: string, collector: string): string {
  const scripts =
    `<script>${pagedjs}</script>\n<script>${collector}</script>\n` +
    `<script>window.__blPaginated = false; new Paged.Previewer().preview();</script>\n</body>`;
  return html.replace("</body>", () => scripts);
}

describe("the collector, live", () => {
  let browser: BrowserLike | null = null;
  let server: Server | null = null;
  let origin = "";
  let served = "";
  let sidByAuthorId: Record<string, string> = {};

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
    served = withPagination(injected.html, pagedjs, COLLECTOR_SOURCE);

    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(served);
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

  async function collect(): Promise<{ page: PageLike; result: CollectorResult }> {
    const page = await browser!.newPage();
    await (page as unknown as { evaluateOnNewDocument(s: string): Promise<unknown> }).evaluateOnNewDocument(
      PRIMITIVES_SOURCE,
    );
    await page.setViewport({ width: 900, height: 700 });
    await page.emulateMediaType("print");
    await page.goto(`${origin}/doc.html`, { waitUntil: "load", timeout: 30_000 });
    await page.waitForFunction("window.__blPaginated === true", { timeout: 30_000 });
    const result = await page.evaluate<CollectorResult>("window.__blCollectorResult()");
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
