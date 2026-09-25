/**
 * The named page of a page is the one Paged.js APPLIED to it — read from the page element — and a
 * boundary is forced by a named page only when the two pages' named pages differ.
 *
 * THE DEFECT. The collector took a page's named page from its first source-bearing node. On a real
 * document that node is very often a wrapper continuing from the page before — `<main>`,
 * `<article>` — rebuilt by Paged.js as a clone with no named ancestor. Every page inside a named
 * region then read `null` against the previous page's last node, which sits inside the region:
 * a false `forced` on every boundary in the region, and on the page after it, which silences the
 * widow, orphan, half-empty and continuation-page rules there. The boundary INTO the region read
 * `null` against `null` and was missed. Measured on a self-authored report with a landscape
 * region (patched Chromium 141, no evidence binding): every boundary from the region's second page
 * on was `forced` with the reason `page@<the main wrapper>`, the region's first page `overflow`,
 * and 13 widow and 13 orphan candidates declined as `env/forced-break`, which put the document
 * below the widow coverage floor (exit 4).
 *
 * The page trees below are hand-authored in the structure Paged.js 0.4.3 builds — continuation
 * clones carry `data-split-from`, a named element's clones carry its `data-page`, and the page
 * element carries `pagedjs_named_page pagedjs_<name>_page` — as read back from real paginated
 * documents on 2026-09-25 (`tests/live/breaks.test.ts` runs the same shapes through the real
 * paginator). What runs over them is the real collector payload and, for the consumer path, the
 * real snapshot payload, `assembleSnapshot`, the classifier and `runDocument`.
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
import { evaluatePayload, pagedDocument, pagedPage, runCollector, type FakeNode } from "../fixtures/paged-dom.ts";

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

describe("named pages are read from the page element", () => {
  it("a region inside a wrapper: forced into and out of it, overflow inside it", () => {
    const { sid } = source(WRAPPER_SOURCE);
    const result = runCollector<CollectorResult>(COLLECTOR_SOURCE, pagedDocument(wrapperPages(sid)));
    // The complication, checked before the answer: pages 2-4 begin with the continuing wrapper.
    assert.deepEqual(result.pages.map((page) => page.firstSid), [sid["wrap"], sid["wrap"], sid["wrap"], sid["wrap"]]);
    assert.deepEqual(result.pages.map((page) => page.startSid), [sid["wrap"], sid["wide"], sid["w2"], sid["outro"]],
      "the node that starts a page is the first one that is not a continuation clone");
    assert.deepEqual(result.pages.map((page) => page.namedPages), [[], ["wide"], ["wide"], []]);
    assert.deepEqual(kindsAndReasons(result, sid), ["forced page@wide", "overflow", "forced page@outro"]);
    assert.deepEqual(result.attributeDrift, []);
  });

  /**
   * The class vocabulary is shared. Paged.js writes `pagedjs_first_page` on page 1 and
   * `pagedjs_named_page` on EVERY named page, so a region named `first` or `named` would be seen
   * everywhere if the class alone counted. It counts only with an element carrying that name in
   * the page area.
   */
  it("a class Paged.js also writes for other reasons does not name a page by itself", () => {
    const html = `<!doctype html><html lang="en"><body><p id="a">One.</p><div id="n">Two.</div><section id="r"><p id="r0">Three.</p></section></body></html>`;
    const { sid } = source(html);
    const pages = [
      pagedPage({ pageBox: pageBox(0), contentBox: contentBox(0), pageClasses: "pagedjs_first_page pagedjs_right_page",
        content: el(sid, "p", "a", "One.", { box: lineBox(0, 0) }) }),
      pagedPage({ pageBox: pageBox(1), contentBox: contentBox(1), pageClasses: "pagedjs_left_page pagedjs_named_page pagedjs_named_first_page",
        content: el(sid, "div", "n", "Two.", { page: "named", box: lineBox(1, 0) }) }),
      pagedPage({ pageBox: pageBox(2), contentBox: contentBox(2), pageClasses: "pagedjs_right_page pagedjs_named_page pagedjs_region_page pagedjs_region_first_page",
        content: el(sid, "section", "r", el(sid, "p", "r0", "Three.", { box: lineBox(2, 0) }), { page: "region", box: lineBox(2, 0) }) }),
    ];
    const result = runCollector<CollectorResult>(COLLECTOR_SOURCE, pagedDocument(pages));
    assert.deepEqual(result.pages.map((page) => page.namedPages), [[], ["named"], ["region"]],
      "page 3 carries pagedjs_named_page because it is a named page, not because it is the page named 'named'");
    assert.deepEqual(kindsAndReasons(result, sid), ["forced page@n", "forced page@r"]);
  });

  /**
   * And an element carrying a name counts only where the page element carries the class: the
   * rebuilt clone of an OUTER named region continues onto a page Paged.js gave the INNER name.
   * Measured: a page inside `div.inner` nested in `section.outer` carries `pagedjs_inner_page`
   * only, while the page area holds the clones of both.
   */
  it("a nested region: the name in force at each edge, and only among the names applied", () => {
    const html = `<!doctype html><html lang="en"><body><main id="wrap"><p id="lead">Lead.</p>` +
      `<section class="outer" id="outer"><div class="inner" id="inner"><p id="n0">N0.</p><p id="n1">N1.</p></div><p id="m0">M0.</p></section>` +
      `</main></body></html>`;
    const { sid } = source(html);
    const inner = (page: number, content: string, split = false) =>
      el(sid, "div", "inner", content, { page: "inner", split, attrs: 'class="inner"', box: lineBox(page, 0) });
    const outer = (page: number, content: string, split = false) =>
      el(sid, "section", "outer", content, { page: "outer", split, attrs: 'class="outer"', box: lineBox(page, 0) });
    const main = (page: number, content: string, split: boolean) => el(sid, "main", "wrap", content, { split, box: lineBox(page, 0) });
    const pages = [
      pagedPage({ pageBox: pageBox(0), contentBox: contentBox(0), pageClasses: "pagedjs_first_page pagedjs_right_page",
        content: main(0, el(sid, "p", "lead", "Lead.", { box: lineBox(0, 0) }), false) }),
      // Both regions start at the top of page 2, before any content, so both classes are applied.
      pagedPage({ pageBox: pageBox(1), contentBox: contentBox(1),
        pageClasses: "pagedjs_left_page pagedjs_named_page pagedjs_outer_page pagedjs_outer_first_page pagedjs_inner_page pagedjs_inner_first_page",
        content: main(1, outer(1, inner(1, el(sid, "p", "n0", "N0.", { box: lineBox(1, 0) }))), true) }),
      pagedPage({ pageBox: pageBox(2), contentBox: contentBox(2), pageClasses: "pagedjs_right_page pagedjs_named_page pagedjs_inner_page",
        content: main(2, outer(2, inner(2, el(sid, "p", "n1", "N1.", { box: lineBox(2, 0) }), true), true), true) }),
      pagedPage({ pageBox: pageBox(3), contentBox: contentBox(3), pageClasses: "pagedjs_left_page pagedjs_named_page pagedjs_outer_page",
        content: main(3, outer(3, el(sid, "p", "m0", "M0.", { box: lineBox(3, 0) }), true), true) }),
    ];
    const result = runCollector<CollectorResult>(COLLECTOR_SOURCE, pagedDocument(pages));
    assert.deepEqual(result.pages.map((page) => page.namedPages), [[], ["inner", "outer"], ["inner"], ["outer"]]);
    assert.deepEqual(result.pages.map((page) => [page.attributesAfterRender.page, page.pageAtEnd]),
      [[null, null], ["outer", "inner"], ["inner", "inner"], ["outer", "outer"]]);
    assert.deepEqual(kindsAndReasons(result, sid), ["forced page@outer", "overflow", "forced page@m0"]);
  });

  /**
   * A page carrying several applied names whose edge node is in force under none of them cannot be
   * compared. The boundary is `unknown` — which suppresses nothing — rather than a guessed change.
   */
  it("an edge that cannot be resolved to an applied name makes the boundary unknown", () => {
    const html = `<!doctype html><html lang="en"><body><p id="a">A.</p><section id="s"><p id="s0">S0.</p></section><p id="z">Z.</p></body></html>`;
    const { sid } = source(html);
    const pages = [
      pagedPage({ pageBox: pageBox(0), contentBox: contentBox(0), pageClasses: "pagedjs_first_page pagedjs_right_page pagedjs_named_page pagedjs_a_page pagedjs_b_page",
        content: el(sid, "p", "a", "A.", { page: "a", box: lineBox(0, 0) }) +
          el(sid, "section", "s", el(sid, "p", "s0", "S0.", { box: lineBox(0, 2) }), { page: "b", box: lineBox(0, 1) }) +
          // The last node is in force under a name the page element does not carry.
          el(sid, "p", "z", "Z.", { page: "c", box: lineBox(0, 3) }) }),
      pagedPage({ pageBox: pageBox(1), contentBox: contentBox(1), pageClasses: "pagedjs_left_page pagedjs_named_page pagedjs_b_page",
        content: el(sid, "section", "s", el(sid, "p", "s0", "S0.", { box: lineBox(1, 0) }), { page: "b", split: true, box: lineBox(1, 0) }) }),
    ];
    const result = runCollector<CollectorResult>(COLLECTOR_SOURCE, pagedDocument(pages));
    assert.deepEqual(result.pages[0]!.namedPages, ["a", "b"]);
    assert.deepEqual(result.pages[0]!.namedPageResolved, { start: true, end: false });
    const [facts] = boundaryFactsFrom(result.pages);
    assert.equal(facts!.namedPageResolved, false);
    assert.equal(classifyBoundary(facts!).kind, "unknown");
  });

  /**
   * The break attributes are read from the node that STARTS the page, not the wrapper clone in
   * front of it. Paged.js strips break attributes from rebuilt clones and puts
   * `data-previous-break-after` on the element after the declaring one — here a section inside
   * `<main>`, so a read from the first node missed it. (`data-break-before` was found anyway,
   * because Paged.js also copies it onto the page element; its reason named the wrapper.)
   */
  it("a break-after and a break-before inside a continuing wrapper are forced, and the break-before names the element that opens the page", () => {
    const html = `<!doctype html><html lang="en"><body><main id="wrap"><section id="a"><p id="a0">A0.</p></section>` +
      `<section id="b"><p id="b0">B0.</p></section><h2 class="chap" id="c">C.</h2><p id="c0">C0.</p></main></body></html>`;
    const { sid } = source(html);
    const main = (page: number, content: string, split: boolean) => el(sid, "main", "wrap", content, { split, box: lineBox(page, 0) });
    const pages = [
      pagedPage({ pageBox: pageBox(0), contentBox: contentBox(0), pageClasses: "pagedjs_first_page pagedjs_right_page",
        content: main(0, el(sid, "section", "a", el(sid, "p", "a0", "A0.", { box: lineBox(0, 0) }), { attrs: 'data-break-after="page"', box: lineBox(0, 0) }), false) }),
      pagedPage({ pageBox: pageBox(1), contentBox: contentBox(1), pageClasses: "pagedjs_left_page",
        content: main(1, el(sid, "section", "b", el(sid, "p", "b0", "B0.", { box: lineBox(1, 0) }), { attrs: 'data-previous-break-after="page"', box: lineBox(1, 0) }), true) }),
      pagedPage({ pageBox: pageBox(2), contentBox: contentBox(2), pageClasses: "pagedjs_right_page", pageAttributes: 'data-break-before="page"',
        content: main(2, el(sid, "h2", "c", "C.", { attrs: 'class="chap" data-break-before="page"', box: lineBox(2, 0) }) +
          el(sid, "p", "c0", "C0.", { box: lineBox(2, 1) }), true) }),
    ];
    const result = runCollector<CollectorResult>(COLLECTOR_SOURCE, pagedDocument(pages));
    assert.deepEqual(result.pages.map((page) => page.firstSid), [sid["wrap"], sid["wrap"], sid["wrap"]], "premise: the wrapper is every page's first node");
    // A break-after names the last node before the boundary, as before this change; the
    // break-before names the heading, where it used to name the wrapper.
    assert.deepEqual(kindsAndReasons(result, sid), ["forced break-after@a0", "forced break-before@c"]);
  });

  it("a page element re-classed after layout is reported as drift, not silently re-read", () => {
    const { sid } = source(WRAPPER_SOURCE);
    const document = pagedDocument(wrapperPages(sid));
    const result = runCollector<CollectorResult>(COLLECTOR_SOURCE, document, () => {
      const find = (node: FakeNode): FakeNode | null => {
        if (node.attributes.get("class")?.includes("pagedjs_wide_first_page")) return node;
        for (const child of node.childNodes) { const hit = find(child); if (hit) return hit; }
        return null;
      };
      const page = find(document)!;
      page.attributes.set("class", "pagedjs_page pagedjs_left_page");
    });
    assert.deepEqual(result.attributeDrift.map((row) => `${row.index}:${row.field}`).sort(), ["1:namedPages", "1:page", "1:pageAtEnd"]);
  });
});

describe("the consumer path: snapshot causes and the rules that decline on a forced break", () => {
  it("a region inside a wrapper declines widows and orphans only at the two boundaries its named page forced", () => {
    const { injected, sid } = source(WRAPPER_SOURCE);
    const document = pagedDocument(wrapperPages(sid));
    const collector = runCollector<CollectorResult>(COLLECTOR_SOURCE, document);
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
