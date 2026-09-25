/**
 * The cause of a page boundary is the decision Paged.js' `shouldBreak()` took at the node the next
 * page starts at — re-evaluated by the collector at the break token, in the paginator's source.
 *
 * THE DEFECT, TWICE. The collector first took a page's named page from its first source-bearing
 * node. On a real document that node is a wrapper continuing from the page before — `<main>`,
 * `<article>` — rebuilt by Paged.js as a clone with no named ancestor, so every boundary inside a
 * named region and the one after it read as a named-page change (`forced`) and the boundary into
 * it read as `overflow`: 9 of 14 widow and orphan candidates declined, exit 4, on a self-authored
 * report (patched Chromium 141, no evidence binding). The first repair compared the named pages the
 * two PAGES were styled with (`pagedjs_<name>_page` on the page element). That is not Paged.js'
 * rule either: `needsPageBreak()` compares the named page in force at a node with the one in force
 * at the node BEFORE it — a previous sibling, whose named page comes from itself and its ancestors,
 * never from its descendants. `<div><section style="page: chap">…</section></div><p>` does not
 * break on leaving the section, the paragraph is laid out on the `chap` page, and the next
 * overflow boundary was read as a change of named page: a false `forced`, found by an independent
 * probe that recorded Paged.js' own `shouldBreak()` answers.
 *
 * WHAT IS UNDER TEST. The real collector payload over hand-authored trees in the structure
 * Paged.js 0.4.3 builds: the rendered pages (continuation clones carry `data-split-from`) and the
 * paginator's parsed source, whose elements carry the attributes `shouldBreak()` reads
 * (`data-break-before`, `data-previous-break-after`, `data-page`), with the break tokens
 * `afterPageLayout` hands out. For the consumer path, the real snapshot payload,
 * `assembleSnapshot`, the classifier and `runDocument`. `tests/live/breaks.test.ts` compares the
 * same classification with Paged.js' own answers on real paginations.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runDocument } from "../../src/core/engine.ts";
import { coverageFloorMap, resolveConfig } from "../../src/config/resolve.ts";
import {
  assembleSnapshot, buildSourceModel, inputIdentity, SNAPSHOT_SOURCE, validateSnapshotInvariants,
  type RawSnapshot,
} from "../../src/measure/snapshot.ts";
import { assignPageCauses, classifyBoundary } from "../../src/paginate/breaks.ts";
import { boundaryFactsFrom, COLLECTOR_SOURCE, type CollectorResult } from "../../src/paginate/collector.ts";
import { injectSourceIds } from "../../src/source/inject.ts";
import type { Snapshot } from "../../src/core/types.ts";
import { evaluatePayload, fakeDocument, pagedDocument, pagedPage, runCollector, type FakeBreakToken, type FakeNode } from "../fixtures/paged-dom.ts";

const STRIDE = 700;
const LINE = 18.66;
const pageBox = (index: number) => [0, index * STRIDE, 566.93, 453.54] as const;
const contentBox = (index: number) => [56.69, 56.69 + index * STRIDE, 453.53, 340.16] as const;
const lineBox = (index: number, line: number) => `56.69 ${56.69 + index * STRIDE + line * LINE} 453.53 ${LINE}`;

function source(html: string): { injected: ReturnType<typeof injectSourceIds>; sid: Record<string, string> } {
  const injected = injectSourceIds(html, "named-page-regions.html");
  const sid: Record<string, string> = {};
  for (const [id, ref] of Object.entries(injected.map)) {
    const author = /\bid="([^"]+)"/u.exec(html.slice(ref.offset, ref.offset + 200))?.[1];
    if (author) sid[author] = id;
  }
  return { injected, sid };
}

/** One rendered element: its source id, `data-ref`, and a continuation clone's `data-split-from`. */
function el(
  sid: Record<string, string>,
  tag: string,
  id: string,
  inner: string,
  extra: { split?: boolean; page?: string; attrs?: string; box?: string } = {},
): string {
  const ref = `ref-${id}`;
  return `<${tag} ${extra.split ? `data-id="${id}" data-split-from="${ref}"` : `id="${id}"`} data-bl-sid="${sid[id]}" ` +
    `data-ref="${ref}"${extra.page ? ` data-page="${extra.page}"` : ""}${extra.attrs ? ` ${extra.attrs}` : ""}` +
    `${extra.box ? ` data-test-box="${extra.box}"` : ""}>${inner}</${tag}>`;
}

const kindsAndReasons = (result: CollectorResult, sid: Record<string, string>): string[] => {
  const byId = Object.fromEntries(Object.entries(sid).map(([id, s]) => [s, id]));
  return boundaryFactsFrom(result.pages).map((facts) => {
    const cause = classifyBoundary(facts);
    const [what, at] = cause.reason.split("@");
    return cause.reason ? `${cause.kind} ${what}@${byId[at ?? ""] ?? at}` : cause.kind;
  });
};

/**
 * The paginator's parsed source for an injected document: the `<body>` of the injected HTML, with
 * `data-page` (and any other attribute Paged.js writes) added the way `breaks.js` writes it.
 * Returns the body, whose first child is where page 1's layout starts, and a lookup by author id.
 */
function pagedSource(html: string): { body: FakeNode; byId: (id: string) => FakeNode; text: (id: string, index?: number) => FakeNode } {
  const tree = fakeDocument(html);
  const all: FakeNode[] = [];
  const visit = (node: FakeNode): void => { all.push(node); node.childNodes.forEach(visit); };
  visit(tree);
  const body = all.find((node) => node.tagName === "BODY")!;
  const byId = (id: string) => {
    const hit = all.find((node) => node.attributes.get("id") === id);
    if (!hit) throw new Error(`no source element #${id}`);
    return hit;
  };
  const text = (id: string, index = 0) => byId(id).childNodes.filter((node) => node.nodeType === 3)[index]!;
  return { body, byId, text };
}

const token = (node: FakeNode, offset = 0): FakeBreakToken => ({ node, offset });

// ---- a named region inside a wrapper that spans every page ---------------------------------

const WRAPPER_SOURCE = `<!doctype html><html lang="en"><body><main id="wrap">` +
  `<section id="intro"><p id="i0">Intro one.</p><p id="i1">Intro two.</p></section>` +
  `<section class="wide" id="wide"><p id="w0">Wide one.</p><p id="w1">Wide two runs over the page.</p><p id="w2">Wide three.</p></section>` +
  `<section id="outro"><p id="o0">Outro.</p></section>` +
  `</main></body></html>`;

/**
 * What Paged.js 0.4.3 builds from `WRAPPER_SOURCE` with `.wide { page: wide }`: the intro on page
 * 1; the region from page 2, where `section.wide` starts; `w1` split across pages 2 and 3; the
 * outro on page 4. `<main>` continues onto pages 2-4 as a `data-split-from` clone, and it is the
 * FIRST source-bearing node of each of them. Only pages 2 and 3 carry the named page's classes.
 */
function wrapperPages(sid: Record<string, string>): string[] {
  const p = (id: string, text: string, page: number, line: number, split = false) =>
    el(sid, "p", id, text, { box: lineBox(page, line), split });
  const box = (page: number) => contentBox(page).join(" ");
  return [
    pagedPage({
      pageBox: pageBox(0), contentBox: contentBox(0), pageClasses: "pagedjs_first_page pagedjs_right_page",
      content: el(sid, "main", "wrap", el(sid, "section", "intro", p("i0", "Intro one.", 0, 0) + p("i1", "Intro two.", 0, 1), { box: box(0) }), { box: box(0) }),
    }),
    pagedPage({
      pageBox: pageBox(1), contentBox: contentBox(1),
      pageClasses: "pagedjs_left_page pagedjs_named_page pagedjs_wide_page pagedjs_wide_first_page",
      content: el(sid, "main", "wrap", el(sid, "section", "wide",
        p("w0", "Wide one.", 1, 0) + p("w1", "Wide two runs", 1, 1), { page: "wide", attrs: 'class="wide"', box: box(1) }), { split: true, box: box(1) }),
    }),
    pagedPage({
      pageBox: pageBox(2), contentBox: contentBox(2), pageClasses: "pagedjs_right_page pagedjs_named_page pagedjs_wide_page",
      content: el(sid, "main", "wrap", el(sid, "section", "wide",
        el(sid, "p", "w1", `<span data-test-box="${lineBox(2, 0)}">over</span><span data-test-box="${lineBox(2, 1)}">the page.</span>`, { split: true, box: `56.69 ${56.69 + 2 * STRIDE} 453.53 ${2 * LINE}` }) +
        p("w2", "Wide three.", 2, 2), { split: true, page: "wide", attrs: 'class="wide"', box: box(2) }), { split: true, box: box(2) }),
    }),
    pagedPage({
      pageBox: pageBox(3), contentBox: contentBox(3), pageClasses: "pagedjs_left_page",
      content: el(sid, "main", "wrap", el(sid, "section", "outro", p("o0", "Outro.", 3, 0), { box: box(3) }), { split: true, box: box(3) }),
    }),
  ];
}

function assemble(raw: RawSnapshot, collector: CollectorResult, injected: ReturnType<typeof injectSourceIds>): Snapshot {
  const snapshot = assembleSnapshot({
    raw, collector,
    sourceModel: buildSourceModel(injected.html, "named-page-regions.html"),
    sourceMap: injected.map,
    sourceMapInjection: true,
    renderer: "fake", browserVersion: "fake", pagedjsVersion: "0.4.3", platform: "test", locale: "en-US",
    freezeSignature: "fake", freezeRetries: 0,
    inputIdentity: inputIdentity({ html: injected.html, browserVersion: "fake", platform: "test", fontFamilies: [], resources: [] }),
    evidenceOverlayApplied: false,
    resources: [],
  });
  const invariants = validateSnapshotInvariants(snapshot, { sourceMapInjection: true });
  assert.equal(invariants.ok, true, invariants.issues.join("; "));
  return snapshot;
}

/** The source of `WRAPPER_SOURCE` as Paged.js holds it, and the three tokens it hands out. */
function wrapperRun(sid: Record<string, string>, injectedHtml: string): { contents: FakeNode; tokens: FakeBreakToken[] } {
  const src = pagedSource(injectedHtml.replace('class="wide"', 'class="wide" data-page="wide"'));
  return {
    contents: src.body,
    // Page 1 ends where the region starts (forced); page 2 inside `w1` (offset: overflow);
    // page 3 where the outro starts (forced, leaving the region).
    tokens: [token(src.byId("wide")), token(src.text("w1"), "Wide two runs".length), token(src.byId("outro"))],
  };
}

describe("the break decision is Paged.js' own, evaluated at the break token", () => {
  it("a region inside a wrapper: forced into and out of it, overflow inside it", () => {
    const { injected, sid } = source(WRAPPER_SOURCE);
    const result = runCollector<CollectorResult>(COLLECTOR_SOURCE, pagedDocument(wrapperPages(sid)), wrapperRun(sid, injected.html));
    // The complication, checked before the answer: pages 2-4 begin with the continuing wrapper.
    assert.deepEqual(result.pages.map((page) => page.firstSid), [sid["wrap"], sid["wrap"], sid["wrap"], sid["wrap"]]);
    assert.deepEqual(kindsAndReasons(result, sid), ["forced page@wide", "overflow", "forced page@outro"]);
    assert.deepEqual(result.pages[0]!.decisionAfterRender, {
      known: true, breakBefore: null, previousBreakAfter: null, pageBefore: null, pageAfter: "wide", sid: sid["wide"],
    });
    assert.deepEqual(result.attributeDrift, []);
  });

  /**
   * Leaving a named region that is NOT the previous sibling of what follows. Paged.js compares the
   * paragraph with the `<div>` around the section, whose named page (self or ancestors) is none, so
   * it does not break: the page after the region is not forced even when an overflow puts the
   * boundary exactly there, and even though that page is no longer styled `chap`. Both the
   * page-style comparison and a comparison of the leaves on either side call this boundary forced.
   */
  it("leaving a nested region is not a break, even where an overflow ends the page right after it", () => {
    const html = `<!doctype html><html lang="en"><body><main id="wrap"><p id="lead">Lead.</p>
<div id="holder"><section class="chap" id="chap"><p id="c0">C0.</p></section></div>
<!-- a comment and whitespace between siblings are not significant -->
<p id="o0">O0.</p><p id="o1">O1.</p></main></body></html>`;
    const { injected, sid } = source(html);
    const src = pagedSource(injected.html.replace('class="chap"', 'class="chap" data-page="chap"'));
    const main = (page: number, content: string, split: boolean) => el(sid, "main", "wrap", content, { split, box: lineBox(page, 0) });
    const pages = [
      pagedPage({ pageBox: pageBox(0), contentBox: contentBox(0), pageClasses: "pagedjs_first_page pagedjs_right_page",
        content: main(0, el(sid, "p", "lead", "Lead.", { box: lineBox(0, 0) }), false) }),
      pagedPage({ pageBox: pageBox(1), contentBox: contentBox(1), pageClasses: "pagedjs_left_page pagedjs_named_page pagedjs_chap_page pagedjs_chap_first_page",
        content: main(1, el(sid, "div", "holder", el(sid, "section", "chap", el(sid, "p", "c0", "C0.", { box: lineBox(1, 0) }),
          { page: "chap", attrs: 'class="chap"', box: lineBox(1, 0) }), { box: lineBox(1, 0) }), true) }),
      pagedPage({ pageBox: pageBox(2), contentBox: contentBox(2), pageClasses: "pagedjs_right_page",
        content: main(2, el(sid, "p", "o0", "O0.", { box: lineBox(2, 0) }) + el(sid, "p", "o1", "O1.", { box: lineBox(2, 1) }), true) }),
    ];
    const result = runCollector<CollectorResult>(COLLECTOR_SOURCE, pagedDocument(pages),
      { contents: src.body, tokens: [token(src.byId("chap")), token(src.byId("o0"))] });
    assert.deepEqual(kindsAndReasons(result, sid), ["forced page@chap", "overflow"]);
    assert.deepEqual([result.pages[1]!.decisionAfterRender!.pageBefore, result.pages[1]!.decisionAfterRender!.pageAfter], [null, null],
      "the node before o0 is the div around the region, whose named page is none");
  });

  /**
   * A `page:` on an inline element whose text crosses a page break. Paged.js asks `shouldBreak()`
   * of text nodes too: the text inside the span is under the span's named page, the text before it
   * is not, so it breaks at the start of the span's text. Where the span's text is split by an
   * overflow instead, the token has an offset into it and nothing is forced.
   */
  it("an inline named page: forced at the start of its text, not where an overflow splits it", () => {
    const html = `<!doctype html><html lang="en"><body><p id="host">Before <span class="x" id="span">inside the span</span> after.</p></body></html>`;
    const { injected, sid } = source(html);
    const src = pagedSource(injected.html.replace('class="x"', 'class="x" data-page="x"'));
    const pages = [0, 1, 2].map((page) => pagedPage({ pageBox: pageBox(page), contentBox: contentBox(page),
      pageClasses: page === 0 ? "pagedjs_first_page pagedjs_right_page" : "pagedjs_left_page pagedjs_named_page pagedjs_x_page",
      content: el(sid, "p", "host", ["Before", "inside", "the span after."][page]!, { split: page > 0, box: lineBox(page, 0) }) }));
    const inside = src.byId("span").childNodes[0]!;
    const result = runCollector<CollectorResult>(COLLECTOR_SOURCE, pagedDocument(pages),
      { contents: src.body, tokens: [token(inside), token(inside, "inside ".length)] });
    // An inline element carries no source id, so the reason names the block the text is in.
    assert.equal(sid["span"], undefined, "premise: the span has no source id of its own");
    assert.deepEqual(kindsAndReasons(result, sid), ["forced page@host", "overflow"]);
    // The second token is also the node page 3's layout started at, which alone stops the
    // comparison. The offset decides by itself too: a token inside a node on a page whose layout
    // started elsewhere is not forced, because shouldBreak() was asked of that node where it began.
    const [inner] = runCollector<CollectorResult>(COLLECTOR_SOURCE, pagedDocument(pages.slice(0, 2)),
      { contents: src.body, tokens: [token(inside, "inside ".length), null] }).pages;
    assert.deepEqual([inner!.decisionAfterRender!.pageBefore, inner!.decisionAfterRender!.pageAfter], [null, null]);
  });

  /**
   * `data-previous-break-after` sits on the element after the declaring one, and that can be an
   * inline element at the head of a page inside a continuing wrapper. It is read on the token node.
   */
  it("a break-after whose following element is inline content inside a continuing wrapper is forced", () => {
    const html = `<!doctype html><html lang="en"><body><main id="wrap"><section id="s1"><p class="ba" id="ba">Declares.</p><em id="em">loose</em> text</section></main></body></html>`;
    const { injected, sid } = source(html);
    const src = pagedSource(injected.html.replace('class="ba"', 'class="ba" data-break-after="page"').replace('<em ', '<em data-previous-break-after="page" '));
    const main = (page: number, content: string, split: boolean) => el(sid, "main", "wrap", content, { split, box: lineBox(page, 0) });
    const pages = [
      pagedPage({ pageBox: pageBox(0), contentBox: contentBox(0), content: main(0, el(sid, "section", "s1", el(sid, "p", "ba", "Declares.", { box: lineBox(0, 0) }), { box: lineBox(0, 0) }), false) }),
      pagedPage({ pageBox: pageBox(1), contentBox: contentBox(1), content: main(1, el(sid, "section", "s1", "<em>loose</em> text", { split: true, box: lineBox(1, 0) }), true) }),
    ];
    const result = runCollector<CollectorResult>(COLLECTOR_SOURCE, pagedDocument(pages), { contents: src.body, tokens: [token(src.byId("em"))] });
    assert.deepEqual(result.pages.map((page) => page.startSid), [sid["wrap"], sid["wrap"]], "premise: nothing source-bearing starts on page 2");
    assert.deepEqual(kindsAndReasons(result, sid), ["forced break-after@ba"]);
  });

  /** The rest of `shouldBreak()`, clause by clause, on one source tree. */
  it("mirrors the doubled break-before, the limiter, an undisplayed node and a missing node", () => {
    const html = `<!doctype html><html lang="en"><body><p id="lead">Lead.</p>` +
      `<section class="chap" id="chap"><h2 class="h" id="h">Heading</h2><p id="c0">C0.</p></section>` +
      `<p class="gone" id="gone">Hidden.</p></body></html>`;
    const { injected, sid } = source(html);
    const src = pagedSource(injected.html
      .replace('class="chap"', 'class="chap" data-page="chap" data-break-before="page"')
      .replace('class="h"', 'class="h" data-break-before="page"')
      .replace('class="gone"', 'class="gone" data-page="other" data-undisplayed="undisplayed"'));
    const two = [0, 1].map((page) => pagedPage({ pageBox: pageBox(page), contentBox: contentBox(page),
      content: el(sid, "p", page === 0 ? "lead" : "c0", "x", { box: lineBox(page, 0) }) }));
    const decisionAt = (tok: FakeBreakToken | null, layoutStartsAt?: FakeBreakToken) => runCollector<CollectorResult>(COLLECTOR_SOURCE, pagedDocument(two),
      { contents: src.body, tokens: layoutStartsAt ? [layoutStartsAt, tok] : [tok, null] }).pages[layoutStartsAt ? 1 : 0]!.decisionAfterRender;
    assert.equal(decisionAt(token(src.byId("chap")))!.breakBefore, "page");
    // The heading's node before is `lead`, reached through the section, so its own break-before
    // counts and the named pages differ.
    const free = decisionAt(token(src.byId("h")))!;
    assert.deepEqual([free.breakBefore, free.pageBefore, free.pageAfter], ["page", null, "chap"]);
    // If the page's layout started at the section, the walk stops at that limiter: no node before,
    // so the heading's break-before is the section's own (a doubled break) and no names compare.
    const limited = decisionAt(token(src.byId("h")), token(src.byId("chap")))!;
    assert.deepEqual([limited.breakBefore, limited.pageBefore, limited.pageAfter], [null, null, null],
      "nodeBefore() stops at the node the page started at");
    // An undisplayed node is never a named-page break.
    const gone = decisionAt(token(src.byId("gone")))!;
    assert.deepEqual([gone.pageBefore, gone.pageAfter], [null, null]);
    // A token without a node cannot be evaluated: unknown, not overflow.
    const [facts] = boundaryFactsFrom(runCollector<CollectorResult>(COLLECTOR_SOURCE, pagedDocument(two),
      { contents: src.body, tokens: [{ node: null }, null] }).pages);
    assert.equal(facts!.decisionKnown, false);
    assert.equal(classifyBoundary(facts!).kind, "unknown");
  });

  /**
   * Paged.js asks `shouldBreak()` only about nodes its walker hands out, and it deep-clones `li`,
   * `td` and the other `isContainer` elements, so a block inside one is never asked. An overflow
   * token can still name such a block with offset 0; only a token at the node the walker handed
   * out last (the `layoutNode` hook) can be a forced break.
   */
  it("a token at a node the walker never handed out is an overflow, whatever its attributes", () => {
    const html = `<!doctype html><html lang="en"><body><ul id="ul"><li id="li"><p id="lp">Item.</p><div class="bb" id="box">Box.</div></li></ul></body></html>`;
    const { injected, sid } = source(html);
    const src = pagedSource(injected.html.replace('class="bb"', 'class="bb" data-break-before="page"'));
    const pages = [0, 1].map((page) => pagedPage({ pageBox: pageBox(page), contentBox: contentBox(page),
      content: el(sid, "p", page === 0 ? "lp" : "box", "x", { box: lineBox(page, 0) }) }));
    const run = (walked: FakeNode) => runCollector<CollectorResult>(COLLECTOR_SOURCE, pagedDocument(pages),
      { contents: src.body, tokens: [token(src.byId("box")), null], walked: [walked, null] });
    assert.deepEqual(kindsAndReasons(run(src.byId("li")), sid), ["overflow"], "the walker handed out the li, never the box inside it");
    assert.deepEqual(kindsAndReasons(run(src.byId("box")), sid), ["forced break-before@box"], "the control: a walked box does break");
  });

  it("a source attribute changed after layout is reported as drift, not silently re-read", () => {
    const { injected, sid } = source(WRAPPER_SOURCE);
    const run = wrapperRun(sid, injected.html);
    const result = runCollector<CollectorResult>(COLLECTOR_SOURCE, pagedDocument(wrapperPages(sid)), {
      ...run,
      afterRendered: () => { run.tokens[0]!.node!.attributes.set("data-page", "spoofed"); },
    });
    // The section is the node Paged.js compares at both boundaries: entering it (page 1's token is
    // the section) and leaving it (the section is the node before the outro).
    assert.deepEqual(result.attributeDrift.map((row) => `${row.index}:${row.field}:${row.afterRender}`),
      ["0:decision.pageAfter:spoofed", "2:decision.pageBefore:spoofed"]);
  });
});

describe("the consumer path: snapshot causes and the rules that decline on a forced break", () => {
  it("a region inside a wrapper declines widows and orphans only at the two boundaries its named page forced", () => {
    const { injected, sid } = source(WRAPPER_SOURCE);
    const document = pagedDocument(wrapperPages(sid));
    const collector = runCollector<CollectorResult>(COLLECTOR_SOURCE, document, wrapperRun(sid, injected.html));
    const snapshot = assemble(evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, document), collector, injected);
    assert.deepEqual(snapshot.pages.map((page) => page.incomingBreakCause.kind), ["document-start", "forced", "overflow", "forced"]);
    assert.deepEqual(snapshot.pages.map((page) => page.outgoingBreakCause.kind), ["forced", "overflow", "forced", "document-end"]);
    // The identity invariant survives: the same boundary object on both sides.
    const causes = assignPageCauses(collector.pages.length, boundaryFactsFrom(collector.pages), collector.pages.map((page) => page.blank));
    for (let i = 1; i < causes.length; i += 1) assert.equal(causes[i]!.incoming, causes[i - 1]!.outgoing);

    const config = resolveConfig({ file: {}, cli: {} });
    const { report } = runDocument(
      { path: "named-page-regions.html", snapshot, infrastructure: [] },
      { failOn: config.failOn, activeRules: config.activeRules, optionsByRule: config.optionsByRule, coverageFloors: coverageFloorMap(config) },
    );
    const forcedDeclines = (ruleId: string) => report.evaluations
      .filter((row) => row.ruleId === ruleId && row.reason === "env/forced-break")
      .map((row) => `${snapshot.blocks.find((block) => block.nodeKey === row.targetRef.nodeKey)?.authorId}@${row.targetRef.fragmentIndex}`)
      .sort();
    // Widows are judged on the page a fragment CONTINUES onto: pages 2 and 4 were forced open, and
    // only the wrapper continues onto them. Page 3 is an overflow inside the region, so `w1`'s
    // continuation, the wrapper's and the section's are measured there.
    assert.deepEqual(forcedDeclines("layout/widow"), ["wrap@1", "wrap@3"]);
    // Orphans are judged on the page a fragment LEAVES: pages 1 and 3 were forced shut.
    assert.deepEqual(forcedDeclines("layout/orphan"), ["wrap@0", "wrap@2"]);
    const measured = (ruleId: string) => report.evaluations
      .filter((row) => row.ruleId === ruleId && row.status === "measured")
      .map((row) => `${snapshot.blocks.find((block) => block.nodeKey === row.targetRef.nodeKey)?.authorId}@${row.targetRef.fragmentIndex}`)
      .sort();
    assert.deepEqual(measured("layout/widow"), ["w1@1", "wide@1", "wrap@2"]);
    assert.deepEqual(measured("layout/orphan"), ["w1@0", "wide@0", "wrap@1"]);
  });
});
