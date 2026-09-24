/**
 * Margin-box content is not part of the flow — in the snapshot, in the collector, and therefore
 * in every page-level consequence and every fingerprint.
 *
 * THE DEFECT. Paged.js implements `position: running(...)` by deep-cloning the element into the
 * margin box of EVERY page; the clone keeps the injected source id, and the in-flow original stays
 * in the page content with an inline `display: none`. `position: fixed` is implemented the same
 * way, with the clone as the first child of the page box. Both in-page payloads queried the whole
 * `.pagedjs_page`, so each clone became one more "fragment" of its source block. Measured on
 * Chromium 141 with Paged.js 0.4.3 before this change, on the live fixtures
 * `margin-running-elements.html` and `margin-running-parity.html`: ten false widow/orphan warnings
 * on a document with nothing to warn about; a parity-blank page that was not blank, with its two
 * boundaries classified `overflow` and `forced`; a false `layout/orphaned-continuation-page` on
 * that page; every page anchored to the running header, so three `layout/half-empty-page` findings
 * on three different pages carried ONE fingerprint.
 *
 * WHAT IS UNDER TEST HERE is the real payload text — `SNAPSHOT_SOURCE` and the collector — run
 * over a hand-authored page tree in the structure Paged.js 0.4.3 produces (see
 * `tests/fixtures/paged-dom.ts` for what that harness is and is not). The Node half after it is the
 * production one: `assembleSnapshot`, the break-cause classifier and `runDocument`. The live suite
 * runs the same fixtures through the real paginator.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runDocument } from "../../src/core/engine.ts";
import { coverageFloorMap, resolveConfig } from "../../src/config/resolve.ts";
import {
  assembleSnapshot, buildSourceModel, inputIdentity, SNAPSHOT_SOURCE, validateSnapshotInvariants,
  type RawSnapshot,
} from "../../src/measure/snapshot.ts";
import { COLLECTOR_SOURCE, type CollectorResult } from "../../src/paginate/collector.ts";
import { injectSourceIds } from "../../src/source/inject.ts";
import type { Finding, Snapshot } from "../../src/core/types.ts";
import { evaluatePayload, pagedDocument, pagedPage, runCollector } from "../fixtures/paged-dom.ts";

/** Page geometry as measured for a 150 x 120 mm page with 15 mm margins, pages 700 px apart. */
const STRIDE = 700;
const LINE = 18.66;
const pageBox = (index: number) => [0, index * STRIDE, 566.93, 453.54] as const;
const contentBox = (index: number) => [56.69, 56.69 + index * STRIDE, 453.53, 340.16] as const;
const lineBox = (index: number, line: number) => `56.69 ${56.69 + index * STRIDE + line * LINE} 453.53 ${LINE}`;

/** The injected source text, and the source id of every element by its author id. */
function source(html: string): { injected: ReturnType<typeof injectSourceIds>; sid: Record<string, string> } {
  const injected = injectSourceIds(html, "margin-boxes.html");
  const sid: Record<string, string> = {};
  for (const [id, ref] of Object.entries(injected.map)) {
    const author = /\bid="([^"]+)"/u.exec(html.slice(ref.offset, ref.offset + 200))?.[1];
    if (author) sid[author] = id;
  }
  return { injected, sid };
}

function assemble(raw: RawSnapshot, collector: CollectorResult, injected: ReturnType<typeof injectSourceIds>): Snapshot {
  const snapshot = assembleSnapshot({
    raw, collector,
    sourceModel: buildSourceModel(injected.html, "margin-boxes.html"),
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

function findingsOf(snapshot: Snapshot, rules: Record<string, unknown> = {}): Finding[] {
  const config = resolveConfig({ file: { rules }, cli: {} });
  return runDocument(
    { path: "margin-boxes.html", snapshot, infrastructure: [] },
    { failOn: config.failOn, activeRules: config.activeRules, optionsByRule: config.optionsByRule, coverageFloors: coverageFloorMap(config) },
  ).report.findings;
}

/**
 * THE FINGERPRINT GUARD. No two findings of one rule may share a fingerprint when the document's
 * content is distinct. It is a test and not an engine assertion on purpose: the v1 key is derived
 * from content or author id, and two genuinely identical source blocks legitimately share it
 * (`src/core/fingerprint.ts`, `src/rules/shared.ts`), so an engine that refused every collision
 * would turn a document with a repeated paragraph into exit 3. What must never happen is a
 * collision the tool manufactures itself — one source element, duplicated by the paginator, keying
 * findings on several pages. Every fixture below has distinct content by construction, so any
 * collision in it is manufactured.
 */
function assertFingerprintsUnique(findings: readonly Finding[]): void {
  const byRule = new Map<string, { page: number; fingerprint: string }[]>();
  for (const finding of findings) {
    byRule.set(finding.ruleId, [...(byRule.get(finding.ruleId) ?? []), { page: finding.page, fingerprint: finding.fingerprint }]);
  }
  const collisions: string[] = [];
  for (const [rule, rows] of byRule) {
    for (const fingerprint of new Set(rows.map((row) => row.fingerprint))) {
      const pages = rows.filter((row) => row.fingerprint === fingerprint).map((row) => row.page);
      if (pages.length > 1) collisions.push(`${rule} on pages ${pages.join(", ")} share ${fingerprint.slice(0, 16)}`);
    }
  }
  assert.deepEqual(collisions, [], "findings of one rule share a fingerprint on a document with distinct content");
}

// ---- the running-header parity document --------------------------------------------------

const PARITY_SOURCE = `<!doctype html><html lang="en"><body>
<p class="title" id="running-title">Running title on every page</p>
${Array.from({ length: 9 }, (_, i) => `<p id="c1p${i + 1}">Chapter one paragraph ${i + 1}.</p>`).join("\n")}
<h2 class="recto" id="chapter-two">Chapter two</h2>
${Array.from({ length: 3 }, (_, i) => `<p id="c2p${i + 1}">Chapter two paragraph ${i + 1}.</p>`).join("\n")}
</body></html>`;

/**
 * What Paged.js 0.4.3 builds from `PARITY_SOURCE` with `@top-center { content: element(title) }`
 * and `.recto { break-before: recto }`: chapter one on page 1, an inserted blank verso page 2,
 * chapter two on page 3 — and the header cloned into the top-center margin box of all three,
 * the blank one included.
 */
function parityPages(sid: Record<string, string>): string[] {
  const title = (index: number) =>
    `<p class="title" id="running-title" data-bl-sid="${sid["running-title"]}" data-ref="ref-title" ` +
    `data-test-box="56.69 ${19.02 + index * STRIDE} 453.53 ${LINE}">Running title on every page</p>`;
  const hiddenOriginal =
    `<p class="title" id="running-title" data-bl-sid="${sid["running-title"]}" data-ref="ref-title" style="display: none;">Running title on every page</p>`;
  const para = (id: string, text: string, index: number, line: number) =>
    `<p id="${id}" data-bl-sid="${sid[id]}" data-ref="ref-${id}" data-test-box="${lineBox(index, line)}">${text}</p>`;
  return [
    pagedPage({
      pageBox: pageBox(0), contentBox: contentBox(0), margins: { "top-center": title(0) },
      content: hiddenOriginal + Array.from({ length: 9 }, (_, i) => para(`c1p${i + 1}`, `Chapter one paragraph ${i + 1}.`, 0, i)).join(""),
    }),
    pagedPage({ pageBox: pageBox(1), contentBox: contentBox(1), margins: { "top-center": title(1) }, content: "" }),
    pagedPage({
      pageBox: pageBox(2), contentBox: contentBox(2), margins: { "top-center": title(2) },
      pageAttributes: 'data-break-before="recto"',
      content:
        `<h2 class="recto" id="chapter-two" data-bl-sid="${sid["chapter-two"]}" data-ref="ref-h2" data-break-before="recto" ` +
        `data-test-box="56.69 ${56.69 + 2 * STRIDE} 453.53 22.39">Chapter two</h2>` +
        Array.from({ length: 3 }, (_, i) => para(`c2p${i + 1}`, `Chapter two paragraph ${i + 1}.`, 2, i + 1.2)).join(""),
    }),
  ];
}

// ---- the running-elements document -------------------------------------------------------

const ELEMENTS_SOURCE = `<!doctype html><html lang="en"><body>
<p class="title" id="running-title">Running title on every page</p>
<div class="side" id="running-side">${Array.from({ length: 8 }, (_, i) => `<span>Side ${i + 1}</span>`).join("<br>")}</div>
<div class="stamp" id="stamp"><p id="stamp-text">DRAFT</p></div>
${Array.from({ length: 12 }, (_, i) => `<p id="b${i + 1}">Body paragraph ${i + 1}.</p>`).join("\n")}
<aside class="note" id="note">A footnote moved into the footnote area.</aside>
<div class="pagedjs_margin" id="author-wrapper"><p id="wrapped">Author markup borrowing a margin-box class name.</p></div>
</body></html>`;

/**
 * Three pages: a one-line running title in `@top-center`, an eight-line `break-inside: avoid`
 * running element in `@left-middle`, a `position: fixed` stamp cloned into every page box, body
 * paragraphs in the flow, a footnote in page 3's footnote area, and — as the negative control for
 * an EXCLUSION test — author content whose wrapper carries a margin-box class name.
 */
function elementsPages(sid: Record<string, string>): string[] {
  const s = (id: string) => `id="${id}" data-bl-sid="${sid[id]}" data-ref="ref-${id}"`;
  const title = (index: number) =>
    `<p class="title" ${s("running-title")} data-test-box="56.69 ${19.02 + index * STRIDE} 453.53 ${LINE}">Running title on every page</p>`;
  const side = (index: number) =>
    `<div class="side" ${s("running-side")} style="break-inside: avoid;" data-test-box="0 ${178.27 + index * STRIDE} 56.69 97">` +
    Array.from({ length: 8 }, (_, i) => `<span data-test-box="0 ${178.27 + index * STRIDE + i * 12.13} 30 12.13">Side ${i + 1}</span>`).join("<br>") +
    "</div>";
  const stamp = (index: number) =>
    `<div class="stamp" ${s("stamp")} style="position: absolute;" data-test-box="523.22 ${index * STRIDE} 43.7 ${LINE}">` +
    `<p ${s("stamp-text")} data-test-box="523.22 ${index * STRIDE} 43.7 ${LINE}">DRAFT</p></div>`;
  const hidden = `<p class="title" ${s("running-title")} style="display: none;">Running title on every page</p>` +
    `<div class="side" ${s("running-side")} style="display: none; break-inside: avoid;">${Array.from({ length: 8 }, (_, i) => `<span>Side ${i + 1}</span>`).join("<br>")}</div>`;
  const body = (index: number, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) =>
    `<p ${s(`b${from + i}`)} data-test-box="${lineBox(index, i)}">Body paragraph ${from + i}.</p>`).join("");
  return [
    pagedPage({
      pageBox: pageBox(0), contentBox: contentBox(0), fixed: stamp(0),
      margins: { "top-center": title(0), "left-middle": side(0) }, content: hidden + body(0, 1, 5),
    }),
    pagedPage({
      pageBox: pageBox(1), contentBox: contentBox(1), fixed: stamp(1),
      margins: { "top-center": title(1), "left-middle": side(1) }, content: body(1, 6, 10),
    }),
    pagedPage({
      pageBox: pageBox(2), contentBox: contentBox(2), fixed: stamp(2),
      margins: { "top-center": title(2), "left-middle": side(2) },
      content: body(2, 11, 12) +
        `<div class="pagedjs_margin" ${s("author-wrapper")} data-test-box="${lineBox(2, 2)}"><p ${s("wrapped")} data-test-box="${lineBox(2, 2)}">Author markup borrowing a margin-box class name.</p></div>`,
      footnotes: `<aside class="note" ${s("note")} data-test-box="56.69 ${378.5 + 2 * STRIDE} 453.53 ${LINE}">A footnote moved into the footnote area.</aside>`,
    }),
  ];
}

describe("margin-box content is not part of the flow", () => {
  it("the snapshot records no running or fixed clone, keeps the in-flow original, footnotes and author content", () => {
    const { sid } = source(ELEMENTS_SOURCE);
    const document = pagedDocument(elementsPages(sid));
    const raw = evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, document);
    const records = (id: string) => raw.blocks.filter((block) => block.sid === sid[id]);

    // One record per running element: its in-flow original, which has no box. Before this
    // change there were four — the original plus one margin-box clone per page.
    for (const id of ["running-title", "running-side"]) {
      assert.equal(records(id).length, 1, `${id}: ${records(id).length} records, clones counted as fragments`);
      assert.equal(records(id)[0]!.page, 1);
      assert.deepEqual(records(id)[0]!.box, { x: 0, y: 0, width: 0, height: 0 }, `${id}: the record is not the hidden original`);
    }
    // A position: fixed element has no in-flow original at all: Paged.js removes it from the
    // flow and inserts a clone into every page box. It is therefore not measured anywhere.
    assert.equal(records("stamp").length, 0, "a position: fixed clone was recorded as flow content");
    assert.equal(records("stamp-text").length, 0, "the descendant of a position: fixed clone was recorded");
    // No text line belongs to any clone: every line lies inside a page's content area.
    const cloneKeys = new Set(raw.blocks.filter((block) => ["running-title", "running-side", "stamp", "stamp-text"]
      .some((id) => block.sid === sid[id])).map((block) => block.nodeKey));
    assert.equal(raw.textLines.filter((line) => cloneKeys.has(line.blockKey)).length, 0, "a clone contributed text lines");
    for (const line of raw.textLines) {
      assert.ok(line.box.x >= 56.69 && line.box.y % STRIDE >= 56.69, `line ${line.blockKey}#${line.index} lies outside the content area`);
    }

    // What must NOT be excluded. The footnote area is inside the page area, so its content stays
    // part of the page it is printed on — restricting the flow to .pagedjs_page_content would drop
    // it. And author markup is not excluded by a class name it happens to carry: an exclusion test
    // ("inside something called pagedjs_margin") would let a document hide content from measurement.
    assert.equal(records("note").length, 1, "footnote-area content was dropped from the flow");
    assert.equal(records("note")[0]!.page, 3);
    assert.equal(records("wrapped").length, 1, "author content was excluded because of a class name");
    assert.equal(records("author-wrapper").length, 1);
    // Every body paragraph is still there, exactly once.
    for (let i = 1; i <= 12; i += 1) assert.equal(records(`b${i}`).length, 1, `b${i}`);
  });

  it("the collector's page edges ignore margin boxes and page-box clones", () => {
    const { sid } = source(ELEMENTS_SOURCE);
    const result = runCollector<CollectorResult>(COLLECTOR_SOURCE, pagedDocument(elementsPages(sid)));
    // Before this change the first source-bearing node of every page was the position: fixed
    // clone (first child of the page box) and the last one on pages 1-2 was a body paragraph only
    // because the area comes last in the page box.
    assert.deepEqual(result.pages.map((page) => page.firstSid), [sid["running-title"], sid["b6"], sid["b11"]]);
    assert.deepEqual(result.pages.map((page) => page.lastSid), [sid["b5"], sid["b10"], sid["note"]]);
    assert.deepEqual(result.pages.map((page) => page.blank), [false, false, false]);
    assert.deepEqual(result.attributeDrift, []);
  });

  it("a running header does not occupy the parity-blank page, in the collector and in the snapshot", () => {
    const { injected, sid } = source(PARITY_SOURCE);
    const document = pagedDocument(parityPages(sid));
    const collector = runCollector<CollectorResult>(COLLECTOR_SOURCE, document);
    assert.deepEqual(collector.pages.map((page) => page.blank), [false, true, false], "the inserted verso page is blank");
    assert.equal(collector.pages[1]!.firstSid, null);
    assert.equal(collector.pages[1]!.lastSid, null);
    assert.equal(collector.pages[2]!.firstSid, sid["chapter-two"], "page 3 opens with the recto heading, not the header clone");
    assert.equal(collector.pages[2]!.attributesAfterRender.breakBefore, "recto");

    const raw = evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, document);
    const snapshot = assemble(raw, collector, injected);
    assert.deepEqual(snapshot.pages.map((page) => page.blank), [false, true, false]);
    const blank = snapshot.pages[1]!;
    assert.equal(blank.incomingBreakCause.kind, "parity");
    assert.equal(blank.outgoingBreakCause.kind, "parity");
    assert.equal(blank.outgoingBreakCause.determinedBy, "page-blank");
    // Anchors: the first block a reader sees on each page. Not the header clone, and on page 1
    // not the header's hidden in-flow original either — it has no box, and a page anchored to it
    // would change fingerprint whenever the header text is edited.
    assert.deepEqual(snapshot.pages.map((page) => page.firstSemanticBlockKey), ["id:c1p1", null, "id:chapter-two"]);
    assert.equal(snapshot.blocks.filter((block) => block.sid === sid["running-title"]).length, 1);
    assert.equal(snapshot.blocks.find((block) => block.sid === sid["running-title"])!.fragmentCount, 1);
  });

  const paritySnapshot = (): Snapshot => {
    const { injected, sid } = source(PARITY_SOURCE);
    const document = pagedDocument(parityPages(sid));
    return assemble(
      evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, document),
      runCollector<CollectorResult>(COLLECTOR_SOURCE, document),
      injected,
    );
  };

  it("the parity document has no findings under the default profile", () => {
    // Measured before this change: a widow on page 2, an orphan on page 1 and an orphaned
    // continuation page on the blank page, all about the header clone.
    assert.deepEqual(findingsOf(paritySnapshot()).map((finding) => `${finding.ruleId}@${finding.page}`), []);
  });

  it("page findings on the parity document never share a fingerprint", () => {
    // With the one off-by-default rule on, the chapter pages are sparsely filled and may be
    // reported — but each under its own anchor, and never on the blank page. Measured before
    // this change: three findings, one per page, all anchored to the running header and all
    // carrying the same fingerprint.
    const halfEmpty = findingsOf(paritySnapshot(), { "layout/half-empty-page": true });
    assert.ok(halfEmpty.length > 0, "premise: the sparse chapter pages must produce page findings, or the guard checks nothing");
    assertFingerprintsUnique(halfEmpty);
    assert.equal(halfEmpty.some((finding) => finding.page === 2), false, "a finding on the parity-blank page");
  });

  it("the running-elements document has no finding about a clone", () => {
    const { injected, sid } = source(ELEMENTS_SOURCE);
    const document = pagedDocument(elementsPages(sid));
    const snapshot = assemble(
      evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, document),
      runCollector<CollectorResult>(COLLECTOR_SOURCE, document),
      injected,
    );
    const findings = findingsOf(snapshot, { "layout/half-empty-page": true });
    const clones = new Set(["running-title", "running-side", "stamp", "stamp-text"].map((id) => sid[id]));
    assert.deepEqual(
      findings.filter((finding) => clones.has(finding.target.sid ?? "")).map((finding) => `${finding.ruleId}@${finding.page}`),
      [],
      "a finding was reported about a margin-box or page-box clone",
    );
    assert.deepEqual(findings.filter((finding) => ["layout/widow", "layout/orphan", "layout/unbreakable-block-too-tall"].includes(finding.ruleId)), []);
    assertFingerprintsUnique(findings);
  });

  it("fails closed when a page has no Paged.js content area to decide flow membership against", () => {
    // Without an area every block would be excluded and the rules would judge an empty document:
    // a clean exit about nothing. The payload must refuse instead.
    const document = pagedDocument([
      `<div class="pagedjs_page" data-test-box="0 0 566.93 453.54"><div class="pagedjs_sheet"><div class="pagedjs_pagebox">` +
        `<div class="pagedjs_page_content" data-test-box="56.69 56.69 453.53 340.16"><div>` +
        `<p data-bl-sid="s0000" data-ref="r0" data-test-box="${lineBox(0, 0)}">Flow text.</p></div></div></div></div></div>`,
    ]);
    assert.throws(() => evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, document), /content area/u);
  });
});
