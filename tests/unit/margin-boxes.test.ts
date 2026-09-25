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
 * WHAT IS UNDER TEST HERE is the real payload text — `SNAPSHOT_SOURCE`, the collector and the
 * source-id integrity status — run over a hand-authored page tree in the structure Paged.js 0.4.3
 * produces (see
 * `tests/fixtures/paged-dom.ts` for what that harness is and is not). The Node half after it is the
 * production one: `assembleSnapshot`, the break-cause classifier, `runDocument` and
 * `validateRuntimeSidState`. The evidence overlay has its own file,
 * `tests/unit/margin-boxes-evidence.test.ts`. The live suite runs the same cases through the real
 * paginator.
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
import type { BlockRecord, Finding, Snapshot } from "../../src/core/types.ts";
import { fingerprint } from "../../src/core/fingerprint.ts";
import { renderedBox, renderingOf } from "../../src/rules/shared.ts";
import { ALL_RULES } from "../../src/rules/index.ts";
import { loadCorpus } from "../fixtures/corpus.ts";
import { integritySource, orderedSourceSids, validateRuntimeSidState, type RuntimeIntegrityStatus } from "../../src/acquire/render-run.ts";
import { evaluatePayload, pagedDocument, pagedPage, runCollector, runIntegrityStatus } from "../fixtures/paged-dom.ts";

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
<div class="side" id="running-side">${Array.from({ length: 8 }, (_, i) => `<span>Side ${i + 1}</span>`).join("<br>")}<div class="pagedjs_area" id="side-spoof"><p id="side-spoof-p">Author markup borrowing the area class.</p></div></div>
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
  // The side element carries author markup with the class name of the page AREA. Inside a margin
  // box it is not the area of any page: only a `.pagedjs_area` that is a child of the page box is.
  const spoof = (index: number) =>
    `<div class="pagedjs_area" ${s("side-spoof")} data-test-box="0 ${275.27 + index * STRIDE} 56.69 12.13">` +
    `<p ${s("side-spoof-p")} data-test-box="0 ${275.27 + index * STRIDE} 56.69 12.13">Author markup borrowing the area class.</p></div>`;
  const side = (index: number) =>
    `<div class="side" ${s("running-side")} style="break-inside: avoid;" data-test-box="0 ${178.27 + index * STRIDE} 56.69 97">` +
    Array.from({ length: 8 }, (_, i) => `<span data-test-box="0 ${178.27 + index * STRIDE + i * 12.13} 30 12.13">Side ${i + 1}</span>`).join("<br>") +
    spoof(index) + "</div>";
  const stamp = (index: number) =>
    `<div class="stamp" ${s("stamp")} style="position: absolute;" data-test-box="523.22 ${index * STRIDE} 43.7 ${LINE}">` +
    `<p ${s("stamp-text")} data-test-box="523.22 ${index * STRIDE} 43.7 ${LINE}">DRAFT</p></div>`;
  const hidden = `<p class="title" ${s("running-title")} style="display: none;">Running title on every page</p>` +
    `<div class="side" ${s("running-side")} style="display: none; break-inside: avoid;">${Array.from({ length: 8 }, (_, i) => `<span>Side ${i + 1}</span>`).join("<br>")}` +
    `<div class="pagedjs_area" ${s("side-spoof")}><p ${s("side-spoof-p")}>Author markup borrowing the area class.</p></div></div>`;
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
      // Snapshot 5: the original says what it is — hidden (`display: none`) and printed three
      // times, once per page, in a margin box. That is how the rules tell it from an element the
      // author hid.
      assert.equal(records(id)[0]!.display, "none", `${id}: the computed display was not recorded`);
      assert.equal(records(id)[0]!.marginCopies, 3, `${id}: the margin-box copies were not counted`);
    }
    // Nothing else has margin copies: not the body, not the footnote, not author content wearing a
    // margin-box class inside the page area, not the spoofed area inside the running element.
    assert.deepEqual(raw.blocks.filter((block) => block.marginCopies > 0 && !["running-title", "running-side", "side-spoof", "side-spoof-p"]
      .some((id) => block.sid === sid[id])).map((block) => block.sid), []);
    assert.ok(raw.blocks.every((block) => block.display.length > 0), "a record without its computed display");
    // A position: fixed element has no in-flow original at all: Paged.js removes it from the
    // flow and inserts a clone into every page box. It is therefore not measured anywhere.
    assert.equal(records("stamp").length, 0, "a position: fixed clone was recorded as flow content");
    assert.equal(records("stamp-text").length, 0, "the descendant of a position: fixed clone was recorded");
    // Author markup inside the running element that carries the AREA class name: in the clones it
    // is not a page's area, so it stays out; only the copy inside the hidden in-flow original is
    // kept. A test on the class alone (".pagedjs_area") would count it once per page.
    for (const id of ["side-spoof", "side-spoof-p"]) {
      assert.equal(records(id).length, 1, `${id}: ${records(id).length} records — a margin-box clone was taken for flow by its class name`);
    }
    // No text line belongs to any clone: every line lies inside a page's content area.
    const cloneKeys = new Set(raw.blocks.filter((block) => ["running-title", "running-side", "stamp", "stamp-text", "side-spoof", "side-spoof-p"]
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

  /**
   * Only margin boxes count as margin copies. A copy of an in-flow element in the page box (where
   * Paged.js puts `position: fixed` clones), in the footnote area or anywhere else outside the
   * margin boxes is not one, and a copy in a margin box is counted once per page.
   */
  it("counts margin copies in margin boxes only", () => {
    const html = `<!doctype html><html lang="en"><body><p id="p1">One.</p><p id="p2">Two.</p><p id="p3">Three.</p></body></html>`;
    const { sid } = source(html);
    const at = (id: string, box: string) => `<p id="${id}" data-bl-sid="${sid[id]}" data-ref="ref-${id}" data-test-box="${box}">${id}</p>`;
    const page = (index: number, content: string) => pagedPage({
      pageBox: pageBox(index), contentBox: contentBox(index), content,
      fixed: at("p1", `523.22 ${index * STRIDE} 43.7 ${LINE}`),
      margins: { "top-center": at("p2", `56.69 ${19.02 + index * STRIDE} 453.53 ${LINE}`) },
      footnotes: index === 1 ? at("p3", `56.69 ${378.5 + index * STRIDE} 453.53 ${LINE}`) : "",
    });
    const raw = evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, pagedDocument([
      page(0, at("p1", lineBox(0, 0)) + at("p2", lineBox(0, 1))), page(1, at("p3", lineBox(1, 0))),
    ]));
    const copies = (id: string) => raw.blocks.filter((block) => block.sid === sid[id]).map((block) => block.marginCopies);
    assert.deepEqual(copies("p1"), [0], "a page-box copy was counted as a margin copy");
    assert.deepEqual(copies("p2"), [2], "the margin copies were not counted once per page");
    assert.deepEqual(copies("p3"), [0, 0], "a footnote-area record was counted as a margin copy");
  });

  /**
   * A line is visible when any text on it is. `p { visibility: hidden } span { visibility: visible }`
   * prints the span; reading the block's visibility called its lines invisible, and
   * `type/excessive-word-spacing` excluded a block that printed.
   */
  it("reads line visibility from the text, not from the block", () => {
    const html = `<!doctype html><html lang="en"><body><p id="shown">Shown.</p><p id="gone">Gone.</p></body></html>`;
    const { sid } = source(html);
    const raw = evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, pagedDocument([pagedPage({
      pageBox: pageBox(0), contentBox: contentBox(0),
      content: `<p id="shown" data-bl-sid="${sid["shown"]}" data-ref="ref-shown" style="visibility: hidden;" data-test-box="${lineBox(0, 0)}">` +
        `<span style="visibility: visible;" data-test-box="${lineBox(0, 0)}">Shown.</span></p>` +
        `<p id="gone" data-bl-sid="${sid["gone"]}" data-ref="ref-gone" style="visibility: hidden;" data-test-box="${lineBox(0, 1)}">Gone.</p>`,
    })]));
    const visibility = (id: string) => {
      const key = raw.blocks.find((block) => block.sid === sid[id])!.nodeKey;
      return raw.textLines.filter((line) => line.blockKey === key).map((line) => line.visible);
    };
    assert.deepEqual(visibility("shown"), [true], "a visible descendant's line was recorded as invisible");
    assert.deepEqual(visibility("gone"), [false]);
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
    assert.equal(collector.pages[2]!.startSid, sid["chapter-two"], "and it is the node that starts it");

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
    const clones = new Set(["running-title", "running-side", "stamp", "stamp-text", "side-spoof", "side-spoof-p"].map((id) => sid[id]));
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

// ---- records with no layout box -----------------------------------------------------------

describe("a record with no layout box is never measured, and never anchors a page", () => {
  /**
   * The metamorphic form of the claim, over the whole registry: adding a record nothing was printed
   * from may not change any rule's candidates, measurements or findings. Two such records, told
   * apart by the facts Snapshot 5 records: the in-flow original of a running element
   * (`display: none`, printed as margin-box copies) and an element the author hid (`display: none`,
   * no copies). Each is built to be a candidate for every rule that selects blocks by style: it
   * avoids breaks, it is a heading, it is justified. Measured before the round-2 change:
   * `layout/unbreakable-block-too-tall` counted such a record as measured at 0 px (a document whose
   * only avoid block was a running element reported full coverage), `layout/heading-at-page-bottom`
   * as a measured heading "with content below it", and `type/excessive-word-spacing` as a measured
   * justified block with nothing in it. Before Snapshot 5 both carried `rule/target-not-rendered`;
   * the running original now says where it printed.
   */
  for (const [name, marginCopies, reason] of [
    ["the in-flow original of a running element", 6, "rule/target-in-margin-box"],
    ["an element the author hid", 0, "rule/target-not-rendered"],
  ] as const) {
    it(`changes no rule's candidates, measurements or findings: ${name}`, () => {
      const base = structuredClone(loadCorpus().find((item) => item.name === "too-tall-trigger")!.snapshot);
      const hidden: BlockRecord = {
        ...structuredClone(base.blocks[0]!),
        nodeKey: "bl:s9990:0", sid: "s9990", authorId: "hidden-heading", blockSignature: "Hidden heading",
        tag: "h2", box: { x: 0, y: 0, width: 0, height: 0 }, lines: [], fragmentIndex: 0, fragmentCount: 1, spaceWidth: 3,
        display: "none", marginCopies,
      };
      hidden.effectiveStyle = { ...hidden.effectiveStyle, breakInside: "avoid", textAlign: "justify", visibility: "visible" };
      const withHidden = structuredClone(base);
      withHidden.blocks = [hidden, ...withHidden.blocks];
      const changed: string[] = [];
      for (const rule of ALL_RULES) {
        const ctx = { documentPath: "doc.html", options: rule.defaultOptions, fingerprint };
        const before = rule.run(base, ctx);
        const after = rule.run(withHidden, ctx);
        if (after.candidates !== before.candidates || after.measured !== before.measured) {
          changed.push(`${rule.id}: candidates ${before.candidates}->${after.candidates}, measured ${before.measured}->${after.measured}`);
        }
        if (after.findings.some((finding) => finding.target.nodeKey === hidden.nodeKey)) changed.push(`${rule.id}: a finding on the hidden record`);
        const measuredHidden = (after.evaluations ?? []).filter((row) => row.targetRef.nodeKey === hidden.nodeKey && row.status === "measured");
        if (measuredHidden.length > 0) changed.push(`${rule.id}: the hidden record was evaluated as measured`);
        for (const row of (after.evaluations ?? []).filter((item) => item.targetRef.nodeKey === hidden.nodeKey)) {
          assert.equal(row.reason, reason, `${rule.id}: ${row.status} row for the hidden record with the wrong reason`);
          assert.equal(row.countsTowardCoverage, false, `${rule.id}: the hidden record counts toward coverage`);
        }
      }
      assert.deepEqual(changed, [], "a record nothing was printed from changed what the registry measured");
    });
  }

  /**
   * The converse, over the same registry: a `display: contents` record, which has no box of its
   * own while its text is laid out and recorded as lines, is not "not rendered". Measured on
   * 2026-09-25: a justified `<p style="display: contents">` with a word gap of 3.74× the natural
   * space was a `type/excessive-word-spacing` finding on the base and was excluded as
   * `rule/target-not-rendered` on the round-2 code, so `--fail-on warn` went from exit 1 to exit 0.
   * A rule that reads lines measures it (the word gaps; where a heading ends, from its last line).
   * `layout/unbreakable-block-too-tall` asks about a box the element does not generate, so
   * `break-inside` does not apply to it: not applicable, outside coverage. Round 3 declined it
   * against coverage instead, and a grid of `display: contents` list items with
   * `li { break-inside: avoid }` went from exit 0 to exit 4 (twelve declines, measured 2026-09-25).
   * No rule may call it unrendered.
   */
  it("measures a display: contents record from its lines, and never calls it unrendered", () => {
    const base = structuredClone(loadCorpus().find((item) => item.name === "too-tall-trigger")!.snapshot);
    const contents: BlockRecord = {
      ...structuredClone(base.blocks[0]!),
      nodeKey: "bl:s9991:0", sid: "s9991", authorId: "contents-paragraph", blockSignature: "Aa Bb Cc",
      tag: "h2", box: { x: 0, y: 0, width: 0, height: 0 }, lines: [9991], fragmentIndex: 0, fragmentCount: 1, spaceWidth: 3,
      display: "contents", marginCopies: 0,
    };
    contents.effectiveStyle = { ...contents.effectiveStyle, breakInside: "avoid", textAlign: "justify", visibility: "visible", wordSpacing: "normal" };
    const withContents = structuredClone(base);
    withContents.blocks = [...withContents.blocks, contents];
    const y = base.pages[0]!.contentBox.y + 40;
    withContents.textLines = [...withContents.textLines, {
      blockKey: contents.nodeKey, index: 9991, box: { x: 60, y, width: 60, height: 12 }, visible: true, ownText: true, width: 60,
      wordBoxes: [
        { text: "Aa", x: 60, y, width: 12, height: 12 },
        { text: "Bb", x: 60 + 12 + 11.22, y, width: 12, height: 12 },
        { text: "Cc", x: 60 + 24 + 14.44, y, width: 12, height: 12 },
      ],
    }];
    const problems: string[] = [];
    for (const rule of ALL_RULES) {
      const ctx = { documentPath: "doc.html", options: rule.defaultOptions, fingerprint };
      const before = rule.run(base, ctx);
      const after = rule.run(withContents, ctx);
      const rows = (after.evaluations ?? []).filter((row) => row.targetRef.nodeKey === contents.nodeKey);
      for (const row of rows) {
        if (row.reason === "rule/target-not-rendered" || row.reason === "rule/target-in-margin-box") {
          problems.push(`${rule.id}: labelled a printed record ${row.reason}`);
        }
      }
      if (rule.id === "type/excessive-word-spacing") {
        const measured = rows.find((row) => row.status === "measured");
        if (!measured) problems.push(`${rule.id}: the printed record was not measured from its lines`);
        else if (Math.abs(Number(measured.measurements[0]!.value) - 3.74) > 0.01) problems.push(`${rule.id}: measured ${measured.measurements[0]!.value}, not 3.74`);
        if (!after.findings.some((finding) => finding.target.nodeKey === contents.nodeKey)) problems.push(`${rule.id}: no finding on the 3.74× gap`);
      }
      if (rule.id === "layout/heading-at-page-bottom") {
        if (after.candidates !== before.candidates + 1 || after.measured !== before.measured + 1) {
          problems.push(`${rule.id}: not measured (${before.candidates}/${before.measured} -> ${after.candidates}/${after.measured})`);
        }
        const page = base.pages.find((item) => item.pageNumber === contents.page)!;
        const expected = (page.contentBox.y + page.contentBox.height - (y + 12)) / contents.lineHeight;
        const remaining = rows.find((row) => row.status === "measured")?.measurements.find((item) => item.name === "remaining-line-heights");
        if (!remaining || Math.abs(Number(remaining.value) - expected) > 1e-6) {
          problems.push(`${rule.id}: the heading was not placed at its line box (remaining ${remaining?.value}, expected ${expected})`);
        }
      }
      if (rule.id === "layout/unbreakable-block-too-tall") {
        if (after.candidates !== before.candidates) problems.push(`${rule.id}: a candidate (${before.candidates}->${after.candidates})`);
        if (after.measured !== before.measured) problems.push(`${rule.id}: its zero box was measured`);
        if (JSON.stringify(after.notMeasured) !== JSON.stringify(before.notMeasured)) problems.push(`${rule.id}: declined against coverage`);
        const row = rows.find((item) => item.targetRef.fragmentIndex === 0);
        if (row?.status !== "not-applicable" || row.reason !== "rule/target-generates-no-box" || row.countsTowardCoverage !== false) {
          problems.push(`${rule.id}: not recorded as not applicable to an element without a box: ${JSON.stringify(row && [row.status, row.reason])}`);
        }
      }
    }
    assert.deepEqual(problems, [], "a display: contents record was dropped, declined, or measured by its zero box");
  });

  /**
   * An image-only `display: contents` figure: no box of its own and no text line, while its image
   * prints. The round-3 predicate, which read "no box and no lines" as "not rendered", called it
   * `rule/target-not-rendered` (measured on 2026-09-25). The computed display says what it is.
   */
  it("does not call an image-only display: contents figure unrendered", () => {
    const base = structuredClone(loadCorpus().find((item) => item.name === "too-tall-trigger")!.snapshot);
    const figure: BlockRecord = {
      ...structuredClone(base.blocks[0]!),
      nodeKey: "bl:s9994:0", sid: "s9994", authorId: "contents-figure", blockSignature: "",
      tag: "figure", box: { x: 0, y: 0, width: 0, height: 0 }, lines: [], fragmentIndex: 0, fragmentCount: 1,
      display: "contents", marginCopies: 0,
    };
    figure.effectiveStyle = { ...figure.effectiveStyle, breakInside: "avoid", textAlign: "justify", visibility: "visible", wordSpacing: "normal" };
    const snapshot = structuredClone(base);
    snapshot.blocks = [...snapshot.blocks, figure];
    const reasons = new Map<string, string | null>();
    for (const rule of ALL_RULES) {
      const result = rule.run(snapshot, { documentPath: "doc.html", options: rule.defaultOptions, fingerprint });
      for (const row of (result.evaluations ?? []).filter((item) => item.targetRef.nodeKey === figure.nodeKey)) reasons.set(rule.id, row.reason);
    }
    assert.equal(reasons.get("layout/unbreakable-block-too-tall"), "rule/target-generates-no-box");
    assert.equal(reasons.get("type/excessive-word-spacing"), "rule/no-text-lines");
    assert.deepEqual([...reasons].filter(([, reason]) => reason === "rule/target-not-rendered"), [],
      "an element whose image prints was labelled not rendered");
  });

  /**
   * `renderedBox`, which the heading rule and WP-F4's continuation rule use to place a block in the
   * flow, agrees with the classification: a record `isNotRendered` is placed nowhere, even if it
   * carried a visible line (which a running element's `display: none` original never does, so the
   * line here is constructed). A `display: contents` record is placed by its lines.
   */
  it("places in the flow only what the classification says printed", () => {
    const snapshot = structuredClone(loadCorpus().find((item) => item.name === "too-tall-trigger")!.snapshot);
    const template = structuredClone(snapshot.blocks[0]!);
    const zero = { x: 0, y: 0, width: 0, height: 0 };
    const make = (nodeKey: string, over: Partial<BlockRecord>): BlockRecord => ({ ...structuredClone(template), nodeKey, box: zero, lines: [7], ...over });
    const records = [
      make("margin-original", { display: "none", marginCopies: 3 }),
      make("author-hidden", { display: "none", marginCopies: 0 }),
      make("contents", { display: "contents", marginCopies: 0 }),
    ];
    snapshot.textLines = [...snapshot.textLines, ...records.map((record) => ({
      blockKey: record.nodeKey, index: 7, box: { x: 60, y: 100, width: 50, height: 12 }, visible: true, ownText: true, width: 50, wordBoxes: null,
    }))];
    assert.deepEqual(records.map((record) => renderedBox(snapshot, record)),
      [null, null, { x: 60, y: 100, width: 50, height: 12 }]);
  });

  /**
   * A box of zero by zero that is not `display: contents` and not `display: none` is not proof
   * that nothing printed. `width: 0; height: 0; overflow: visible` prints its text outside the
   * box; the lines are recorded and visible. Measured on 2026-09-25 against an earlier state of
   * this change, which classified such a record "not rendered" from its box alone: a zero-size
   * avoid block with seventeen printed lines went from a counted decline (exit 4) to a clean run,
   * and a zero-box heading at the page bottom lost its finding. Per rule: the heading rule and
   * `renderedBox` place it by its lines; `type/excessive-word-spacing` measures its lines;
   * `layout/unbreakable-block-too-tall` declines it, counted — its box's height is not the height
   * of what printed, and the lines' extent is not the height of a box that could have broken.
   */
  it("treats a zero box that printed visible lines as printed, per rule", () => {
    for (const name of ["too-tall-trigger", "heading-bottom-trigger"] as const) {
      const config = resolveConfig({ file: {}, cli: {} });
      const engine = { failOn: config.failOn, activeRules: config.activeRules, optionsByRule: config.optionsByRule, coverageFloors: coverageFloorMap(config) };
      const snapshot = structuredClone(loadCorpus().find((item) => item.name === name)!.snapshot);
      const normal = runDocument({ path: "d.html", snapshot: structuredClone(snapshot), infrastructure: [] }, engine).report;
      const target = name === "too-tall-trigger"
        ? snapshot.blocks.find((block) => /avoid/u.test(block.effectiveStyle.breakInside))!
        : snapshot.blocks.find((block) => /^h[1-6]$/u.test(block.tag))!;
      assert.ok((target.lines ?? []).length > 0 && target.display === "block", "premise: a block-level target with recorded lines");
      // The printed lines, where the box was: what the browser records for `overflow: visible`.
      // (The corpus snapshot references the lines without carrying their geometry.)
      if (!snapshot.textLines.some((line) => line.blockKey === target.nodeKey)) {
        snapshot.textLines = [...snapshot.textLines, ...(target.lines ?? []).map((index) => ({
          blockKey: target.nodeKey, index, box: { ...target.box }, visible: true, ownText: true, width: target.box.width, wordBoxes: null,
        }))];
      }
      target.box = { ...target.box, width: 0, height: 0 };
      const zero = runDocument({ path: "d.html", snapshot, infrastructure: [] }, engine).report;
      const rule = name === "too-tall-trigger" ? "layout/unbreakable-block-too-tall" : "layout/heading-at-page-bottom";
      const rows = zero.evaluations.filter((row) => row.ruleId === rule && row.targetRef.nodeKey === target.nodeKey);
      assert.equal(rows.some((row) => row.reason === "rule/target-not-rendered"), false, `${name}: a record that printed lines was excluded as not rendered`);
      if (name === "too-tall-trigger") {
        assert.notEqual(normal.verdict, "clean");
        assert.equal(zero.verdict, "insufficient-coverage", `${name}: the zero box turned into ${zero.verdict}`);
        assert.deepEqual(rows.map((row) => [row.status, row.reason]), [["not-measured", "env/invalid-measurement"]]);
      } else {
        assert.equal(zero.findings.filter((finding) => finding.ruleId === rule).length,
          normal.findings.filter((finding) => finding.ruleId === rule).length, `${name}: placing the heading by its lines lost its finding`);
        assert.ok(rows.some((row) => row.status === "measured"), `${name}: the heading was not placed by its lines`);
      }
    }
  });

  /** The two things a zero box with no visible line can be, and a zero box whose lines were not recorded. */
  it("calls a zero box not rendered only when the snapshot shows nothing printed", () => {
    const snapshot = structuredClone(loadCorpus().find((item) => item.name === "too-tall-trigger")!.snapshot);
    const zero = { x: 0, y: 0, width: 0, height: 0 };
    const make = (nodeKey: string, over: Partial<BlockRecord>): BlockRecord => ({ ...structuredClone(snapshot.blocks[0]!), nodeKey, box: zero, ...over });
    snapshot.textLines = [...snapshot.textLines,
      { blockKey: "visible-line", index: 1, box: { x: 60, y: 100, width: 50, height: 12 }, visible: true, ownText: true, width: 50, wordBoxes: null },
      { blockKey: "hidden-line", index: 1, box: { x: 60, y: 100, width: 50, height: 12 }, visible: false, ownText: true, width: 50, wordBoxes: null }];
    const cases: [BlockRecord, string][] = [
      [make("display-none", { display: "none", lines: [] }), "not-rendered"],
      [make("display-none-unrecorded", { display: "none", lines: null, notMeasuredReason: "env/invalid-measurement" }), "not-rendered"],
      [make("hidden-subtree", { display: "block", lines: [] }), "not-rendered"],
      [make("hidden-line", { display: "block", lines: [1] }), "not-rendered"],
      [make("visible-line", { display: "block", lines: [1] }), "zero-box"],
      [make("unrecorded", { display: "block", lines: null, notMeasuredReason: "env/invalid-measurement" }), "zero-box"],
      [make("margin-original", { display: "none", lines: [], marginCopies: 2 }), "margin-box"],
      [make("contents", { display: "contents", lines: [] }), "contents"],
    ];
    assert.deepEqual(cases.map(([record]) => [record.nodeKey, renderingOf(snapshot, record)]), cases.map(([record, kind]) => [record.nodeKey, kind]));
  });

  /**
   * What lies below a heading is read the same way: a `display: contents` paragraph under the last
   * heading of a page is printed below it, by its line box, and the heading is not stranded. Read
   * by its zero box at the page origin, the paragraph would be "above" every heading.
   */
  it("counts a display: contents block printed below a heading as content below it", () => {
    const base = structuredClone(loadCorpus().find((item) => item.name === "too-tall-trigger")!.snapshot);
    const page = base.pages[0]!;
    const bottom = page.contentBox.y + page.contentBox.height;
    const template = structuredClone(base.blocks[0]!);
    const style = { ...template.effectiveStyle, breakInside: "auto", textAlign: "start", visibility: "visible" };
    const heading: BlockRecord = { ...structuredClone(template), nodeKey: "bl:s9992:0", sid: "s9992", authorId: "late-heading",
      blockSignature: "Late heading", tag: "h2", page: page.pageNumber, lineHeight: 16, lines: [9992], fragmentIndex: 0, fragmentCount: 1,
      box: { x: page.contentBox.x, y: bottom - 40, width: page.contentBox.width, height: 16 }, effectiveStyle: style };
    const after: BlockRecord = { ...structuredClone(template), nodeKey: "bl:s9993:0", sid: "s9993", authorId: "contents-after",
      blockSignature: "Printed below", tag: "p", page: page.pageNumber, lineHeight: 16, lines: [9993], fragmentIndex: 0, fragmentCount: 1,
      box: { x: 0, y: 0, width: 0, height: 0 }, display: "contents", effectiveStyle: style };
    const snapshot = structuredClone(base);
    // Only the two records on this page, so nothing else can be the content below the heading.
    snapshot.blocks = [...snapshot.blocks.filter((block) => block.page !== page.pageNumber), heading, after];
    snapshot.textLines = [...snapshot.textLines, {
      blockKey: after.nodeKey, index: 9993, box: { x: page.contentBox.x, y: bottom - 22, width: 120, height: 16 }, visible: true, ownText: true, width: 120, wordBoxes: null,
    }];
    const rule = ALL_RULES.find((item) => item.id === "layout/heading-at-page-bottom")!;
    const result = rule.run(snapshot, { documentPath: "doc.html", options: rule.defaultOptions, fingerprint });
    const row = (result.evaluations ?? []).find((item) => item.targetRef.nodeKey === heading.nodeKey && item.status === "measured");
    assert.equal(row?.measurements.find((item) => item.name === "following-block-count")?.value, 1,
      "a display: contents paragraph printed below the heading was not counted as content below it");
    assert.deepEqual(result.findings.filter((finding) => finding.target.nodeKey === heading.nodeKey), []);
  });

  /**
   * Both dimensions decide. An empty paragraph (full width, no height) and a zero-width block
   * that is still tall are laid out; only width AND height zero is a record the browser did not
   * lay out. Each case is the first block of its page, so each would lose its anchor to a
   * predicate on one dimension — the two survivors a mutation run found.
   */
  it("anchors a page to its first rendered block: a box in either dimension, or line boxes", () => {
    const html = `<!doctype html><html lang="en"><body>
<p id="empty"></p><p id="p1">Page one text.</p>
<div id="narrow">Narrow</div><p id="p2">Page two text.</p>
<p id="gone">Hidden</p><p id="p3">Page three text.</p>
<p id="contents"><span>Contents text</span></p><p id="p4">Page four text.</p>
</body></html>`;
    const { injected, sid } = source(html);
    const at = (id: string, box: string, text: string, extra = "") =>
      `<${id === "narrow" ? "div" : "p"} id="${id}" data-bl-sid="${sid[id]}" data-ref="ref-${id}" ${extra} data-test-box="${box}">${text}</${id === "narrow" ? "div" : "p"}>`;
    const document = pagedDocument([
      pagedPage({ pageBox: pageBox(0), contentBox: contentBox(0), content: at("empty", `56.69 56.69 453.53 0`, "") + at("p1", lineBox(0, 0), "Page one text.") }),
      pagedPage({ pageBox: pageBox(1), contentBox: contentBox(1), content: at("narrow", `56.69 ${56.69 + STRIDE} 0 ${LINE}`, "Narrow") + at("p2", lineBox(1, 1), "Page two text.") }),
      pagedPage({ pageBox: pageBox(2), contentBox: contentBox(2), content: at("gone", "0 0 0 0", "Hidden", 'style="display: none;"') + at("p3", lineBox(2, 0), "Page three text.") }),
      // `display: contents`: the element's own box is zero, its text is laid out in a line box.
      pagedPage({ pageBox: pageBox(3), contentBox: contentBox(3), content:
        at("contents", "0 0 0 0", `<span data-test-box="${lineBox(3, 0)}">Contents text</span>`, 'style="display: contents;"') + at("p4", lineBox(3, 1), "Page four text.") }),
    ]);
    const snapshot = assemble(
      evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, document), runCollector<CollectorResult>(COLLECTOR_SOURCE, document), injected);
    assert.deepEqual(snapshot.pages.map((page) => page.firstSemanticBlockKey), ["id:empty", "id:narrow", "id:p3", "id:contents"]);
    assert.ok((snapshot.blocks.find((block) => block.authorId === "contents")?.lines ?? []).length > 0, "premise: the display: contents block has lines");
  });
});

// ---- what a record prints decides how a line-reading rule treats it -----------------------

describe("a line-reading rule measures only lines that printed, and says why it did not", () => {
  const base = () => structuredClone(loadCorpus().find((item) => item.name === "too-tall-trigger")!.snapshot);
  const record = (snapshot: Snapshot, over: Partial<BlockRecord>): BlockRecord => ({
    ...structuredClone(snapshot.blocks[0]!), nodeKey: "bl:s9995:0", sid: "s9995", authorId: "probe", blockSignature: "Probe",
    fragmentIndex: 0, fragmentCount: 1, spaceWidth: 3, box: { x: 0, y: 0, width: 0, height: 0 }, display: "contents", marginCopies: 0,
    ...over,
  });
  const withRecord = (over: Partial<BlockRecord>, visible: boolean | null) => {
    const snapshot = base();
    const probe = record(snapshot, over);
    probe.effectiveStyle = { ...probe.effectiveStyle, textAlign: "justify", wordSpacing: "normal", visibility: visible === false ? "hidden" : "visible" };
    snapshot.blocks = [...snapshot.blocks, probe];
    if (probe.lines && probe.lines.length > 0) {
      const y = snapshot.pages[0]!.contentBox.y + 40;
      snapshot.textLines = [...snapshot.textLines, { blockKey: probe.nodeKey, index: probe.lines[0]!, box: { x: 60, y, width: 60, height: 12 },
        visible: visible !== false, ownText: true, width: 60, wordBoxes: [{ text: "Aa", x: 60, y, width: 12, height: 12 }, { text: "Bb", x: 90, y, width: 12, height: 12 }] }];
    }
    return { snapshot, probe };
  };
  const rowsFor = (ruleId: string, snapshot: Snapshot, nodeKey: string) => {
    const rule = ALL_RULES.find((item) => item.id === ruleId)!;
    const result = rule.run(snapshot, { documentPath: "doc.html", options: rule.defaultOptions, fingerprint });
    return { result, rows: (result.evaluations ?? []).filter((row) => row.targetRef.nodeKey === nodeKey) };
  };
  const claimsLines = (rows: readonly { measurements: readonly { name: string; value: unknown }[] }[]) =>
    rows.some((row) => row.measurements.some((item) => (item.name === "target-has-rendered-lines" && item.value === true) ||
      (item.name === "visible-line-count" && typeof item.value === "number" && item.value > 0)));

  /** The heading rule's decline branch, which no test reached (a surviving mutant). */
  it("declines a box-less heading it cannot place, counted, and states the line count it saw", () => {
    for (const [lines, expected] of [[null, null], [[], 0]] as const) {
      const { snapshot, probe } = withRecord({ tag: "h2", lines: lines === null ? null : [...lines], ...(lines === null ? { notMeasuredReason: "env/invalid-measurement" as const } : {}) }, true);
      const { result, rows } = rowsFor("layout/heading-at-page-bottom", snapshot, probe.nodeKey);
      assert.deepEqual(rows.map((row) => [row.status, row.reason]), [["not-measured", "env/invalid-measurement"]], `lines ${JSON.stringify(lines)}`);
      assert.ok(result.notMeasured.some((row) => row.reason === "env/invalid-measurement"), "the decline is not in the coverage account");
      assert.equal(rows[0]!.measurements.find((item) => item.name === "visible-line-count")?.value, expected);
      assert.equal(claimsLines(rows), false, "the decline claims rendered lines the snapshot does not show");
    }
  });

  /** A hidden `display: contents` heading prints nothing: excluded, never declined against coverage (exit 4). */
  it("excludes a box-less heading whose lines are all invisible", () => {
    const { snapshot, probe } = withRecord({ tag: "h2", lines: [9995] }, false);
    const { result, rows } = rowsFor("layout/heading-at-page-bottom", snapshot, probe.nodeKey);
    assert.deepEqual(rows.map((row) => [row.status, row.reason, row.countsTowardCoverage]), [["excluded", "rule/target-not-visible", false]]);
    assert.equal(result.notMeasured.some((row) => row.reason === "env/invalid-measurement"), false);
  });

  it("never measures word gaps at factor 0 from lines that did not print or were not recorded", () => {
    const cases = [
      { name: "lines not recorded", over: { lines: null, notMeasuredReason: "env/invalid-measurement" as const }, visible: true,
        expected: ["not-measured", "env/invalid-measurement"], counted: true },
      { name: "lines all invisible", over: { lines: [9995] }, visible: false, expected: ["excluded", "rule/target-not-visible"], counted: false },
      { name: "no line at all (empty or image-only)", over: { lines: [], box: { x: 48, y: 60, width: 399, height: 0 }, display: "block" },
        visible: true, expected: ["not-applicable", "rule/no-text-lines"], counted: false },
    ];
    for (const { name, over, visible, expected, counted } of cases) {
      const { snapshot, probe } = withRecord({ tag: "p", ...over }, visible);
      const { result, rows } = rowsFor("type/excessive-word-spacing", snapshot, probe.nodeKey);
      assert.deepEqual(rows.map((row) => [row.status, row.reason]), [expected], name);
      assert.equal(rows.some((row) => row.status === "measured"), false, `${name}: measured`);
      assert.equal(result.notMeasured.some((row) => row.reason === "env/invalid-measurement"), counted, `${name}: coverage account`);
      assert.equal(claimsLines(rows), false, `${name}: claims printed lines`);
    }
  });
});

// ---- wrappers that span pages -------------------------------------------------------------

const WRAPPER_SOURCE = `<!doctype html><html lang="en"><body>
<article id="doc">
${Array.from({ length: 12 }, (_, i) => `<p id="w${i + 1}">Wrapped paragraph ${i + 1}.</p>`).join("\n")}
</article>
</body></html>`;

/** An `<article>` that spans four sparsely filled pages: a fragment of it on every page. */
function wrapperPages(sid: Record<string, string>): string[] {
  return Array.from({ length: 4 }, (_, page) => pagedPage({
    pageBox: pageBox(page), contentBox: contentBox(page),
    content: `<article id="doc" data-bl-sid="${sid["doc"]}" data-ref="ref-doc" data-test-box="56.69 ${56.69 + page * STRIDE} 453.53 ${3 * LINE}">` +
      Array.from({ length: 3 }, (_, i) => {
        const id = `w${page * 3 + i + 1}`;
        return `<p id="${id}" data-bl-sid="${sid[id]}" data-ref="ref-${id}" data-test-box="${lineBox(page, i)}">Wrapped paragraph ${page * 3 + i + 1}.</p>`;
      }).join("") + "</article>",
  }));
}

describe("a block that spans pages anchors only the page it starts on", () => {
  /**
   * Register item G-69. Before this change every page of an `<article>` spanning four pages was
   * anchored to the article, because an ancestor comes first in document order, so the page
   * findings on all four pages carried one fingerprint. The fingerprint guard above now runs over
   * a wrapper document too.
   */
  it("keys every page of a wrapped document to the first block that starts on it", () => {
    const { injected, sid } = source(WRAPPER_SOURCE);
    const document = pagedDocument(wrapperPages(sid));
    const snapshot = assemble(
      evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, document), runCollector<CollectorResult>(COLLECTOR_SOURCE, document), injected);
    assert.equal(snapshot.blocks.filter((block) => block.sid === sid["doc"]).length, 4, "premise: the article has a fragment on every page");
    assert.deepEqual(snapshot.pages.map((page) => page.firstSemanticBlockKey), ["id:doc", "id:w4", "id:w7", "id:w10"],
      "page 1 is where the article starts; every later page is anchored to the first paragraph that starts on it");
    const halfEmpty = findingsOf(snapshot, { "layout/half-empty-page": true });
    assert.ok(halfEmpty.filter((finding) => finding.ruleId === "layout/half-empty-page").length >= 3,
      "premise: the sparse pages produce page findings, or the guard checks nothing");
    assertFingerprintsUnique(halfEmpty);
  });
});

// ---- the source-id integrity check --------------------------------------------------------

describe("the post-pagination source-id check reads the order of the flow, and still sees tampering", () => {
  /** Run the real in-page status over a page tree built from `html`, and validate it. */
  const check = (html: string, pages: (sid: Record<string, string>) => string[]): string[] => {
    const { injected, sid } = source(html);
    const expected = orderedSourceSids(injected.map);
    const status = runIntegrityStatus<RuntimeIntegrityStatus>(integritySource(expected), pagedDocument(pages(sid)));
    return validateRuntimeSidState(expected, status);
  };
  const s = (sid: Record<string, string>, id: string, box: string, text: string, extra = "") =>
    `<p id="${id}" data-bl-sid="${sid[id]}" data-ref="ref-${id}" ${extra} data-test-box="${box}">${text}</p>`;
  const clone = (sid: Record<string, string>, index: number) =>
    s(sid, "rt", `56.69 ${19.02 + index * STRIDE} 453.53 ${LINE}`, "Running title", 'class="title"');

  /**
   * Measured before this change with the real paginator: a running title that is not the first
   * element of the source, or that sits inside a section, ended the run `checker-crashed` at this
   * check, because the page-1 clone in the margin box precedes everything in the content area.
   */
  it("accepts a running title after a heading: the margin-box clone is not in the flow", () => {
    const html = `<!doctype html><html lang="en"><body><h1 id="h">Title</h1><p class="title" id="rt">Running title</p>
<p id="b1">One.</p><p id="b2">Two.</p><p id="b3">Three.</p></body></html>`;
    assert.deepEqual(check(html, (sid) => [
      pagedPage({ pageBox: pageBox(0), contentBox: contentBox(0), margins: { "top-center": clone(sid, 0) },
        content: `<h1 id="h" data-bl-sid="${sid["h"]}" data-ref="ref-h" data-test-box="${lineBox(0, 0)}">Title</h1>` +
          s(sid, "rt", "0 0 0 0", "Running title", 'class="title" style="display: none;"') + s(sid, "b1", lineBox(0, 1), "One.") }),
      pagedPage({ pageBox: pageBox(1), contentBox: contentBox(1), margins: { "top-center": clone(sid, 1) },
        content: s(sid, "b2", lineBox(1, 0), "Two.") + s(sid, "b3", lineBox(1, 1), "Three.") }),
    ]), []);
  });

  it("accepts a block footnote moved into the footnote area, and a position: fixed element cloned into every page box", () => {
    const html = `<!doctype html><html lang="en"><body><p id="p1">One.</p><aside class="fn" id="fn">A footnote.</aside>
<div class="stamp" id="stamp"><p id="stamp-text">DRAFT</p></div><p id="p2">Two.</p><p id="p3">Three.</p></body></html>`;
    const stamp = (sid: Record<string, string>, index: number) =>
      `<div class="stamp" id="stamp" data-bl-sid="${sid["stamp"]}" data-ref="ref-stamp" style="position: absolute;" data-test-box="523.22 ${index * STRIDE} 43.7 ${LINE}">` +
      s(sid, "stamp-text", `523.22 ${index * STRIDE} 43.7 ${LINE}`, "DRAFT") + "</div>";
    assert.deepEqual(check(html, (sid) => [
      pagedPage({ pageBox: pageBox(0), contentBox: contentBox(0), fixed: stamp(sid, 0),
        content: s(sid, "p1", lineBox(0, 0), "One.") + s(sid, "p2", lineBox(0, 1), "Two."),
        footnotes: `<aside class="fn" id="fn" data-bl-sid="${sid["fn"]}" data-ref="ref-fn" data-note="footnote" data-test-box="56.69 378.5 453.53 ${LINE}">A footnote.</aside>` }),
      pagedPage({ pageBox: pageBox(1), contentBox: contentBox(1), fixed: stamp(sid, 1), content: s(sid, "p3", lineBox(1, 0), "Three.") }),
    ]), []);
  });

  /**
   * The negative controls: what the check caught before, it still catches. None of these is a
   * layout Paged.js produces; each is a tampered tree.
   */
  it("still refuses an element moved out of the flow into a margin box, an unknown id, a swap and a removal", () => {
    const html = `<!doctype html><html lang="en"><body><p id="p1">One.</p><p id="p2">Two.</p><p id="p3">Three.</p></body></html>`;
    const tree = (sid: Record<string, string>, margin: string, content: string) =>
      [pagedPage({ pageBox: pageBox(0), contentBox: contentBox(0), margins: { "top-center": margin }, content })];
    const moved = check(html, (sid) => tree(sid, s(sid, "p2", lineBox(0, 0), "Two."),
      s(sid, "p1", lineBox(0, 1), "One.") + s(sid, "p3", lineBox(0, 2), "Three.")));
    assert.ok(moved.length > 0, "an element moved out of the flow into a margin box passed");
    assert.ok(moved.some((issue) => /only in margin boxes/u.test(issue)), `the move is not named: ${JSON.stringify(moved)}`);
    const unknown = check(html, (sid) => tree(sid, `<p data-bl-sid="s9999" data-test-box="${lineBox(0, 0)}">Forged.</p>`,
      s(sid, "p1", lineBox(0, 1), "One.") + s(sid, "p2", lineBox(0, 2), "Two.") + s(sid, "p3", lineBox(0, 3), "Three.")));
    assert.ok(unknown.some((issue) => /unknown .*source id/u.test(issue)), `a forged id in a margin box passed: ${JSON.stringify(unknown)}`);
    const swapped = check(html, (sid) => tree(sid, "",
      s(sid, "p2", lineBox(0, 0), "Two.") + s(sid, "p1", lineBox(0, 1), "One.") + s(sid, "p3", lineBox(0, 2), "Three.")));
    assert.ok(swapped.some((issue) => /order mismatch/u.test(issue)), `a swapped flow order passed: ${JSON.stringify(swapped)}`);
    const removed = check(html, (sid) => tree(sid, "", s(sid, "p1", lineBox(0, 0), "One.") + s(sid, "p3", lineBox(0, 1), "Three.")));
    assert.ok(removed.some((issue) => /distinct source ids/u.test(issue)), `a removed element passed: ${JSON.stringify(removed)}`);
  });

  /**
   * The page box and the footnote area accept only what Paged.js puts there. Measured on
   * 2026-09-25 on the frozen round-2 code: a script that appended an in-flow paragraph to the page
   * box, or moved it into the footnote area, ended exit 0 with the paragraph absent from every
   * evaluation, where the base refused it at this check (exit 3). A `position: fixed` clone is
   * inserted at the HEAD of EVERY page box and has no in-flow original; a note carries
   * `data-note="footnote"`, which Paged.js sets on every footnote element before it moves it.
   */
  it("refuses an element moved into the page box or the footnote area without the Paged.js signature", () => {
    const html = `<!doctype html><html lang="en"><body><p id="p1">One.</p><p id="p2">Two.</p><p id="p3">Three.</p><p id="p4">Four.</p></body></html>`;
    const two = (sid: Record<string, string>, first: Partial<Parameters<typeof pagedPage>[0]>, second: Partial<Parameters<typeof pagedPage>[0]> = {}) => [
      pagedPage({ pageBox: pageBox(0), contentBox: contentBox(0), content: s(sid, "p1", lineBox(0, 0), "One."), ...first }),
      pagedPage({ pageBox: pageBox(1), contentBox: contentBox(1), content: s(sid, "p3", lineBox(1, 0), "Three.") + s(sid, "p4", lineBox(1, 1), "Four."), ...second }),
    ];
    const p2 = (sid: Record<string, string>, extra = "") => s(sid, "p2", lineBox(0, 1), "Two.", extra);
    const refused = (name: string, issues: string[], pattern: RegExp) => {
      assert.ok(issues.length > 0, `${name}: passed the check`);
      assert.ok(issues.some((issue) => pattern.test(issue)), `${name}: not named: ${JSON.stringify(issues)}`);
    };
    // Appended to the page box, as the verifier's control does: after the area, on one page.
    refused("appended to the page box", check(html, (sid) => two(sid, { afterArea: p2(sid) })), /page box but is not a position: fixed clone/u);
    // At the head of the page box, where a fixed clone goes, but on one page of two.
    refused("at the head of one page box", check(html, (sid) => two(sid, { fixed: p2(sid) })), /in 1 of 2 page boxes/u);
    // In every page box, but appended after the area: Paged.js inserts a fixed clone at the head.
    refused("after the area of every page box", check(html, (sid) => two(sid, { afterArea: p2(sid) }, { afterArea: p2(sid) })), /follows the page area/u);
    // At the head of every page box, but also still in the flow.
    refused("in every page box and in the flow", check(html, (sid) => two(sid,
      { fixed: p2(sid), content: s(sid, "p1", lineBox(0, 0), "One.") + p2(sid) }, { fixed: p2(sid) })), /in-flow occurrence/u);
    // Into the footnote area without being a note.
    // The element IS in the footnote area; the refusal names what is missing (the note marker)
    // and does not claim it was found outside the footnote area.
    const intoFootnotes = check(html, (sid) => two(sid, { footnotes: p2(sid) }));
    refused("moved into the footnote area", intoFootnotes, /not inside a Paged\.js footnote \(data-note="footnote"\)/u);
    assert.deepEqual(intoFootnotes.filter((issue) => /outside the (page content and the )?footnote area/u.test(issue)), [],
      "the refusal says the element is outside the footnote area, where it is not");
    // The same two places with the signature pass: a fixed clone on every page, a marked note.
    assert.deepEqual(check(html, (sid) => two(sid, { fixed: p2(sid) }, { fixed: p2(sid) })), []);
    assert.deepEqual(check(html, (sid) => two(sid, { footnotes: p2(sid, 'data-note="footnote"') })), []);
  });
});
