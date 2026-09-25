/**
 * Documents with footnotes reach the rules, and what the rules and the evidence then do with a
 * footnote is decided, not inherited.
 *
 * THE DEFECT (G-79). Paged.js 0.4.3 builds a footnote call for every `float: footnote` element —
 * `<a data-footnote-call="R" data-ref="R" data-data-counter-footnote-increment="1" href="#note-R">`
 * — from the note's `data-ref`, a random UUID drawn per run. The paired control run of the
 * injection check reads every `href` as a resource, so the injected run and the control run
 * disagreed about it, and every document with a footnote ended `injection-interference` (exit 3)
 * before any rule ran: measured with the real paginator on `footnotes-block.html` and
 * `footnotes-inline.html` (patched Chromium 141, no evidence binding).
 *
 * Unblocking them exposed three more places where a footnote was read as something it is not:
 *
 *   - the evidence overlay could not mark a block footnote at all (it lies in the footnote area,
 *     below the content box the marks hang in), so every page with one stayed unbound;
 *   - the collector read a block footnote as the last node of its page's flow, so inside a
 *     named-page chapter the page before an ordinary overflow boundary had no page name and the
 *     boundary came out `forced` — measured on `footnotes-named-page.html`: `layout/widow` and
 *     `layout/orphan` declined `env/forced-break` and the run ended at exit 4;
 *   - `layout/heading-at-page-bottom` counted a footnote below the content box as content
 *     following the heading, so a heading stranded above the footnotes was never reported
 *     (corpus fixture `heading-bottom-trigger-above-footnotes`).
 *
 * WHAT IS REAL HERE. The payloads (`CONTROL_SIGNATURE_SOURCE`, the collector, the overlay) are the
 * production strings, run over hand-authored Paged.js 0.4.3 page trees whose footnote structure is
 * the one read back from the live fixtures on 2026-09-25 (`tests/fixtures/paged-dom.ts`).
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { compareControlSignatures, CONTROL_SIGNATURE_SOURCE, type ControlSignature } from "../../src/measure/snapshot.ts";
import { classifyBoundary } from "../../src/paginate/breaks.ts";
import { boundaryFactsFrom, COLLECTOR_SOURCE, type CollectorResult } from "../../src/paginate/collector.ts";
import { PAGED_FOOTNOTE_CALLS_SOURCE } from "../../src/paginate/pagedjs-structure.ts";
import { produceEvidence } from "../../src/render/evidence.ts";
import { faithfulRasterizer, OverlayPage } from "../fixtures/evidence-harness.ts";
import { loadCorpus } from "../fixtures/corpus.ts";
import { runDocument } from "../../src/core/engine.ts";
import { VALIDATION_RULES_BY_ID } from "../../src/rules/index.ts";
import { printsOnlyOutsideContentBox, startsInContentBox } from "../../src/rules/shared.ts";
import { evaluatePayload, pagedDocument, pagedPage, runCollector, type FakeNode } from "../fixtures/paged-dom.ts";

const STRIDE = 700;
const LINE = 18.66;
const pageBox = (index: number) => [0, index * STRIDE, 566.93, 453.54] as const;
/** With a footnote area of 30 px, the content box shrinks by that much (measured). */
const contentBox = (index: number) => [56.69, 56.69 + index * STRIDE, 453.53, 310.16] as const;
const footnoteBox = (index: number) => [56.69, 366.85 + index * STRIDE, 453.53, 30] as const;
const lineBox = (index: number, line: number) => `56.69 ${56.69 + index * STRIDE + line * LINE} 453.53 ${LINE}`;

/** The call Paged.js 0.4.3 inserts, exactly as read back from the live fixture. */
const call = (ref: string, className = "fn") =>
  `<a class="${className}" data-footnote-call="${ref}" data-ref="${ref}" data-data-counter-footnote-increment="1" href="#note-${ref}"></a>`;
/** The note it moves into the footnote area, exactly as read back (source id optional). */
const note = (ref: string, tag: string, text: string, sid: string | null, box: string) =>
  `<${tag} ${sid ? `data-bl-sid="${sid}" ` : ""}class="fn" id="note-${ref}" data-ref="${ref}" data-note="footnote" ` +
  `data-note-policy="auto" data-note-display="block" data-footnote-marker="${ref}" data-test-box="${box}">${text}</${tag}>`;

/** One page with a block footnote; `sids` false builds the control run's tree. */
function blockFootnotePage(ref: string, sids: boolean, extraContent = ""): string {
  const s = (id: string) => (sids ? `data-bl-sid="${id}" ` : "");
  return pagedPage({
    pageBox: pageBox(0), contentBox: contentBox(0), footnoteBox: footnoteBox(0),
    content: `<p ${s("p1")}data-ref="ref-p1" data-test-box="${lineBox(0, 0)}">The first paragraph.</p>` + call(ref) +
      `<p ${s("p2")}data-ref="ref-p2" data-test-box="${lineBox(0, 1)}">The second paragraph.</p>` + extraContent,
    footnotes: note(ref, "aside", "A block footnote.", sids ? "fn1" : null, "56.69 370 453.53 15"),
  });
}

/** One page with an inline footnote: the call is inside the sentence, the note is a span. */
function inlineFootnotePage(ref: string, sids: boolean): string {
  return pagedPage({
    pageBox: pageBox(0), contentBox: contentBox(0), footnoteBox: footnoteBox(0),
    content: `<p ${sids ? 'data-bl-sid="p1" ' : ""}data-ref="ref-p1" data-test-box="${lineBox(0, 0)}">A sentence${call(ref)} with a note.</p>`,
    footnotes: note(ref, "span", "An inline footnote.", null, "56.69 370 453.53 15"),
  });
}

const signature = (pages: string[]) => evaluatePayload<ControlSignature>(CONTROL_SIGNATURE_SOURCE, pagedDocument(pages));
const REF_A = "4a5d0ff7-896d-434f-8ddf-4d49afba3c7f";
const REF_B = "25d23bc6-d719-4609-aaf5-3b183e4badd3";

describe("the paired control run recognises Paged.js' own footnote calls, and nothing else", () => {
  it("block and inline footnotes: two runs that differ only in the paginator's random data-ref agree", () => {
    for (const build of [blockFootnotePage, inlineFootnotePage]) {
      const injected = signature([build(REF_A, true)]);
      const control = signature([build(REF_B, false)]);
      assert.ok(injected.resources.includes("pagedjs-footnote-call:1"), `premise: the call was recognised: ${injected.resources}`);
      assert.equal(injected.resources.includes(REF_A), false, "the random data-ref reached the resource signature");
      assert.deepEqual(compareControlSignatures(injected, control), { equal: true, changed: [] }, build.name);
    }
  });

  it("an author-preset data-ref is a recognised call too, and the same in both runs", () => {
    const injected = signature([blockFootnotePage("chosen-by-author", true)]);
    const control = signature([blockFootnotePage("chosen-by-author", false)]);
    assert.deepEqual(compareControlSignatures(injected, control).changed, []);
  });

  it("a planted look-alike that differs between runs is still interference", () => {
    // Every attribute of a call, and no note behind it — footnotes-planted-call.html, recorded.
    const planted = (ref: string) => `<a id="planted" data-footnote-call="${ref}" data-ref="${ref}" ` +
      `data-data-counter-footnote-increment="1" href="#note-${ref}" data-id="planted"></a>`;
    const injected = signature([blockFootnotePage(REF_A, true, planted("planted-in-the-injected-run"))]);
    const control = signature([blockFootnotePage(REF_B, false, planted("planted-in-the-control-run"))]);
    assert.deepEqual(compareControlSignatures(injected, control).changed, ["resources"]);
  });

  it("recognises a call only as the whole structure", () => {
    const calls = (pages: string[]) => evaluatePayload<Map<unknown, number>>(
      `(${PAGED_FOOTNOTE_CALLS_SOURCE})(window.__blPrimitives)`, pagedDocument(pages)).size;
    const page = (content: string, footnotes: string) => pagedPage({
      pageBox: pageBox(0), contentBox: contentBox(0), footnoteBox: footnoteBox(0), content, footnotes,
    });
    const aNote = note(REF_A, "aside", "Note.", null, "56.69 370 453.53 15");
    assert.equal(calls([page(call(REF_A), aNote)]), 1, "premise: the recorded pair");
    assert.equal(calls([page(call(REF_A), "")]), 0, "no note");
    assert.equal(calls([page(call(REF_A) + aNote, "")]), 0, "a note that is not in a footnote area");
    assert.equal(calls([page(call(REF_A), note(REF_B, "aside", "Other.", null, "56.69 370 453.53 15"))]), 0, "a note for another ref");
    assert.equal(calls([page(call(REF_A).replace(`href="#note-${REF_A}"`, `href="#note-${REF_B}"`), aNote)]), 0, "an href for another ref");
    assert.equal(calls([page(call(REF_A).replace(`href="#note-${REF_A}"`, `href="img.png#note-${REF_A}"`), aNote)]), 0, "an href that fetches");
    assert.equal(calls([page(call(REF_A).replace(`data-ref="${REF_A}"`, `data-ref="${REF_B}"`), aNote)]), 0, "a call whose data-ref differs");
    assert.equal(calls([page(call(REF_A).replace(' data-data-counter-footnote-increment="1"', ""), aNote)]), 0, "no counter attribute");
    assert.equal(calls([page(call(REF_A).replace("></a>", ">text</a>"), aNote)]), 0, "a call with content");
    assert.equal(calls([page(call(REF_A), aNote.replace(`id="note-${REF_A}"`, 'id="other"'))]), 0, "a note without Paged.js' id");
    assert.equal(calls([page(call(REF_A), aNote.replace('data-note="footnote"', 'data-note="endnote"'))]), 0, "not a footnote");
    assert.equal(calls([page(call(REF_A), aNote.replace(`data-footnote-marker="${REF_A}"`, ""))]), 0, "no marker");
  });

  it("records calls by ordinal, so a run with a different number of footnotes still differs", () => {
    const two = signature([blockFootnotePage(REF_A, true, call("second-call"))
      .replace("</aside>", `</aside>${note("second-call", "aside", "Two.", null, "56.69 385 453.53 15")}`)]);
    const one = signature([blockFootnotePage(REF_B, false)]);
    assert.ok(two.resources.includes("pagedjs-footnote-call:2"));
    assert.ok(compareControlSignatures(two, one).changed.includes("resources"));
  });
});

describe("the collector reads a page's edges from its page content, not from its footnotes", () => {
  it("an overflow boundary inside a named-page chapter stays overflow when page 1 carries a block footnote", () => {
    const pages = [
      pagedPage({
        pageBox: pageBox(0), contentBox: contentBox(0), footnoteBox: footnoteBox(0),
        content: `<section class="chapter" data-bl-sid="sec" data-ref="ref-sec" data-page="chapter" data-test-box="${lineBox(0, 0)}">` +
          `<p data-bl-sid="p1" data-ref="ref-p1" data-test-box="${lineBox(0, 0)}">One.</p>${call(REF_A)}` +
          `<p data-bl-sid="p2" data-ref="ref-p2" data-test-box="${lineBox(0, 1)}">Two.</p></section>`,
        footnotes: note(REF_A, "aside", "A block footnote.", "fn1", "56.69 370 453.53 15"),
      }),
      pagedPage({
        pageBox: pageBox(1), contentBox: contentBox(1),
        content: `<section class="chapter" data-bl-sid="sec" data-ref="ref-sec" data-page="chapter" data-split-from="ref-sec" data-test-box="${lineBox(1, 0)}">` +
          `<p data-bl-sid="p3" data-ref="ref-p3" data-test-box="${lineBox(1, 0)}">Three.</p></section>`,
      }),
    ];
    const result = runCollector<CollectorResult>(COLLECTOR_SOURCE, pagedDocument(pages));
    assert.equal(result.pages[0]!.lastSid, "p2", "the footnote was read as the last node of page 1's flow");
    assert.equal(result.pages[0]!.lastNodePage, "chapter");
    assert.deepEqual(result.pages.map((page) => page.blank), [false, false]);
    const facts = boundaryFactsFrom(result.pages)[0]!;
    assert.equal(classifyBoundary({ ...facts, hasBreakToken: true }).kind, "overflow",
      "a footnote outside the chapter element turned an overflow into a change of named page");
  });
});

describe("the evidence overlay marks a block footnote in the footnote area", () => {
  it("places both marks against the footnote area and lets the page bind", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "breaklint-footnote-evidence-"));
    try {
      const doc: FakeNode = pagedDocument([blockFootnotePage(REF_A, true)]);
      const page = new OverlayPage(doc);
      const outcome = await produceEvidence({
        page, closePage: async () => page.close(), rasterizer: faithfulRasterizer(page, { pages: 1 }),
        options: { outDir, documentKey: "footnote", binding: true },
      });
      const installation = page.installation!;
      assert.deepEqual(installation.unplacedMarks, [], "a footnote-area fragment was refused a mark");
      const marks = installation.marks.filter((mark) => mark.sid === "fn1");
      // At the note's own edges, against the page box: nothing moved, nothing clamped.
      assert.deepEqual(marks.map((mark) => [mark.side, mark.xPx, mark.yPx]), [["start", 56.69, 370], ["end", 56.69, 385]]);
      assert.equal(installation.staticPageAreas, 0);
      assert.equal(installation.layers, 2, "one layer in the content box and one in the footnote area");
      assert.deepEqual(outcome.evidence.map((record) => record.bindsFinding), [true]);
      assert.ok(outcome.boundSids.has("fn1"), "the footnote itself did not bind");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});

describe("round 2: what the page rules do with the footnote area", () => {
  const run = (name: string, ruleId: string) => {
    const entry = loadCorpus().find((item) => item.name === name)!;
    const rule = VALIDATION_RULES_BY_ID.get(ruleId)!;
    return runDocument({ path: name, snapshot: entry.snapshot, infrastructure: [] },
      { failOn: "never", activeRules: [rule], optionsByRule: {}, coverageFloors: {} }).report;
  };

  it("a heading inside a block footnote is not a heading-at-page-bottom candidate", () => {
    const report = run("heading-bottom-clean-heading-inside-footnote", "layout/heading-at-page-bottom");
    assert.deepEqual(report.findings.map((finding) => finding.message), [], "a heading inside a footnote was reported as stranded");
    const row = report.evaluations.find((evaluation) => evaluation.targetRef.nodeKey === "fnh");
    assert.deepEqual([row?.status, row?.reason, row?.countsTowardCoverage], ["excluded", "rule/target-outside-content-box", false]);
    assert.equal(report.coverage["layout/heading-at-page-bottom"]?.candidates, 0);
  });

  it("a page that prints only a footnote continuation is declined by both fill rules, not measured as fine", () => {
    for (const ruleId of ["layout/orphaned-continuation-page", "layout/half-empty-page"]) {
      const report = run("orphaned-continuation-clean-footnote-only-page", ruleId);
      const row = report.evaluations.find((evaluation) => evaluation.targetRef.nodeKey === "pg2");
      assert.deepEqual([row?.status, row?.reason], ["not-measured", "env/invalid-measurement"], `${ruleId}: ${JSON.stringify(row)}`);
      assert.ok(report.notMeasured.some((n) => n.ruleId === ruleId && n.reason === "env/invalid-measurement"));
      assert.equal(report.coverage[ruleId]?.measured, 1, `${ruleId}: the footnote-only page counted as measured`);
      assert.deepEqual(report.findings.map((finding) => finding.page).filter((page) => page === 2), []);
    }
  });

  it("marks both edges of a note that fills the footnote area, from a layer in the page box", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "breaklint-footnote-edges-"));
    try {
      // The only note fills the 30 px footnote area exactly: it starts on its top edge and ends on
      // its bottom edge. Round 1 hung the layer in the (clipping) footnote area and refused the end
      // mark; the page box does not clip, so both edges carry a mark.
      const doc: FakeNode = pagedDocument([pagedPage({
        pageBox: pageBox(0), contentBox: contentBox(0), footnoteBox: footnoteBox(0),
        content: `<p data-bl-sid="p1" data-ref="ref-p1" data-test-box="${lineBox(0, 0)}">Text.</p>${call(REF_A)}`,
        footnotes: note(REF_A, "aside", "A note that fills the area.", "fn1", "56.69 366.85 453.53 30"),
      })]);
      const page = new OverlayPage(doc);
      await produceEvidence({
        page, closePage: async () => page.close(), rasterizer: faithfulRasterizer(page, { pages: 1 }),
        options: { outDir, documentKey: "footnote-edges", binding: true },
      });
      const installation = page.installation!;
      assert.deepEqual(installation.unplacedMarks, []);
      assert.deepEqual(installation.marks.filter((mark) => mark.sid === "fn1").map((mark) => [mark.side, mark.yPx]),
        [["start", 366.85], ["end", 396.85]]);
      const layers = evaluatePayload<string[]>(
        `window.__blPrimitives.all(document, ".bl-overlay").map((layer) => window.__blPrimitives.attr(window.__blPrimitives.parent(layer), "class"))`, doc);
      assert.deepEqual(layers.sort(), ["pagedjs_page_content", "pagedjs_pagebox"]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("still refuses a footnote mark outside the footnote area, where the note is clipped away", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "breaklint-footnote-clipped-"));
    try {
      // The note overflows the area at the top (Paged.js packs notes to the bottom); its top is
      // clipped and not printed, so no mark may stand there. Its end is inside and is marked.
      const doc: FakeNode = pagedDocument([pagedPage({
        pageBox: pageBox(0), contentBox: contentBox(0), footnoteBox: footnoteBox(0),
        content: `<p data-bl-sid="p1" data-ref="ref-p1" data-test-box="${lineBox(0, 0)}">Text.</p>${call(REF_A)}`,
        footnotes: note(REF_A, "aside", "A note taller than its area.", "fn1", "56.69 356.85 453.53 40"),
      })]);
      const page = new OverlayPage(doc);
      await produceEvidence({
        page, closePage: async () => page.close(), rasterizer: faithfulRasterizer(page, { pages: 1 }),
        options: { outDir, documentKey: "footnote-clipped", binding: true },
      });
      assert.deepEqual(page.installation!.unplacedMarks, [{ sid: "fn1", page: 1, side: "start", reason: "fragment-outside-page" }]);
      assert.deepEqual(page.installation!.refusals?.map((r) => r.detail.split(" (")[0]), ["above the footnote area"]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});

describe("final round: a footnote fragment binds by both of its marks or not at all", () => {
  // Two notes: the first fills the 30 px footnote area (366.85-396.85), the second starts at `y`.
  const twoNotes = (y: number, height = 30) => pagedDocument([pagedPage({
    pageBox: pageBox(0), contentBox: contentBox(0), footnoteBox: footnoteBox(0),
    content: `<p data-bl-sid="p1" data-ref="ref-p1" data-test-box="${lineBox(0, 0)}">Text.</p>${call(REF_A)}${call(REF_B)}`,
    footnotes: note(REF_A, "aside", "First note.", "fn1", "56.69 366.85 453.53 30") +
      note(REF_B, "aside", "Clipped note.", "fn2", `56.69 ${y} 453.53 ${height}`),
  })]);
  const oneNote = (y: number, height: number) => pagedDocument([pagedPage({
    pageBox: pageBox(0), contentBox: contentBox(0), footnoteBox: footnoteBox(0),
    content: `<p data-bl-sid="p1" data-ref="ref-p1" data-test-box="${lineBox(0, 0)}">Text.</p>${call(REF_A)}`,
    footnotes: note(REF_A, "aside", "A note.", "fn1", `56.69 ${y} 453.53 ${height}`),
  })]);
  const evidenceOf = async (doc: FakeNode) => {
    const outDir = mkdtempSync(join(tmpdir(), "breaklint-footnote-final-"));
    try {
      const page = new OverlayPage(doc);
      const outcome = await produceEvidence({
        page, closePage: async () => page.close(), rasterizer: faithfulRasterizer(page, { pages: 1 }),
        options: { outDir, documentKey: "footnote-final", binding: true },
      });
      return { outcome, installation: page.installation! };
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  };

  for (const [label, y] of [["exactly on the bottom edge", 396.85], ["0.12 px inside the bottom edge", 396.73]] as const) {
    it(`does not bind a page whose second note starts ${label} and is clipped away`, async () => {
      const { outcome, installation } = await evidenceOf(twoNotes(y));
      assert.deepEqual(installation.marks.filter((mark) => mark.sid === "fn2"), [], "a mark was placed for a clipped-away note");
      assert.deepEqual(installation.refusals?.filter((r) => r.sid === "fn2").map((r) => [r.side, r.footnote]), [["start", true], ["end", true]]);
      assert.deepEqual(outcome.evidence.map((record) => record.bindsFinding), [false]);
    });
  }

  it("does not bind a page whose note is clipped at the bottom, although its start mark is placed", async () => {
    // Starts 13 px into the area, ends 13 px below it: the lower part is not printed.
    const { outcome, installation } = await evidenceOf(oneNote(380, 30));
    assert.deepEqual(installation.marks.filter((mark) => mark.sid === "fn1").map((mark) => mark.side), ["start"]);
    assert.deepEqual(installation.refusals?.map((r) => [r.sid, r.side, r.detail.split(" (")[0]]), [["fn1", "end", "below the footnote area"]]);
    assert.deepEqual(outcome.evidence.map((record) => record.bindsFinding), [false]);
  });

  it("does not bind a page whose note is clipped at the top, although its end mark is placed", async () => {
    const { outcome } = await evidenceOf(oneNote(356.85, 40));
    assert.deepEqual(outcome.evidence.map((record) => record.bindsFinding), [false]);
  });

  it("binds a page whose note fills the footnote area exactly, edge to edge", async () => {
    const { outcome, installation } = await evidenceOf(oneNote(366.85, 30));
    assert.deepEqual(installation.refusals, []);
    assert.deepEqual(outcome.evidence.map((record) => record.bindsFinding), [true]);
  });

  it("keeps the one-mark rule for a content-box fragment: a block pulled above the content box still binds", async () => {
    const doc = pagedDocument([pagedPage({
      pageBox: pageBox(0), contentBox: contentBox(0),
      content: `<div data-bl-sid="up" data-ref="ref-up" data-test-box="56.69 40 453.53 200">Pulled up.</div>` +
        `<p data-bl-sid="p2" data-ref="ref-p2" data-test-box="${lineBox(0, 12)}">A second block, so the page has a reference.</p>`,
    })]);
    const { outcome, installation } = await evidenceOf(doc);
    assert.deepEqual(installation.refusals?.map((r) => [r.sid, r.side, r.footnote]), [["up", "start", false]]);
    assert.deepEqual(outcome.evidence.map((record) => record.bindsFinding), [true]);
  });

  it("refuses every footnote mark, and reports the fault, when the page box is not positioned", async () => {
    const doc = pagedDocument([pagedPage({
      pageBox: pageBox(0), contentBox: contentBox(0), footnoteBox: footnoteBox(0),
      content: `<p data-bl-sid="p1" data-ref="ref-p1" data-test-box="${lineBox(0, 0)}">Text.</p>${call(REF_A)}`,
      footnotes: note(REF_A, "aside", "A note.", "fn1", "56.69 370 453.53 15"),
    }).replace('<div class="pagedjs_pagebox">', '<div class="pagedjs_pagebox" style="position: static">')]);
    const { outcome, installation } = await evidenceOf(doc);
    assert.equal(installation.staticPageAreas, 1);
    assert.deepEqual(installation.marks.filter((mark) => mark.sid === "fn1"), []);
    assert.ok(outcome.infrastructure.some((event) => event.kind === "checker-crashed"));
  });
});

describe("final round: content-box boundaries", () => {
  const page = { contentBox: { x: 48, y: 48, width: 399, height: 560 } } as unknown as Parameters<typeof startsInContentBox>[1];
  it("a block starting exactly at the foot of the content box does not start inside it", () => {
    assert.equal(startsInContentBox({ x: 48, y: 607.99, width: 10, height: 10 }, page), true);
    assert.equal(startsInContentBox({ x: 48, y: 608, width: 10, height: 10 }, page), false);
  });
  it("a page whose only block lies wholly above its content box prints only outside it", () => {
    const entry = loadCorpus().find((item) => item.name === "orphaned-continuation-clean-footnote-only-page")!;
    const snapshot = entry.snapshot;
    const pg2 = snapshot.pages[1]!;
    const above = { ...snapshot, blocks: [{ ...snapshot.blocks[2]!, box: { x: 48, y: pg2.contentBox.y - 40, width: 399, height: 40 } }] };
    assert.equal(printsOnlyOutsideContentBox(above, pg2), true);
    const touching = { ...snapshot, blocks: [{ ...snapshot.blocks[2]!, box: { x: 48, y: pg2.contentBox.y - 40, width: 399, height: 40.5 } }] };
    const pgTall = { ...pg2, contentBox: { ...pg2.contentBox, height: 10 } };
    assert.equal(printsOnlyOutsideContentBox({ ...touching, pages: [snapshot.pages[0]!, pgTall] }, pgTall), false,
      "a block that reaches half a pixel into the content box is part of its flow");
  });
});
