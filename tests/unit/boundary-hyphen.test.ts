/**
 * The facts Snapshot 5 records so that a rule need not guess them from geometry: where Paged.js put a
 * boundary hyphen (`boundaryHyphen`), and whether a nested block sits in the flow (`float`,
 * `position`, with `display`).
 *
 * THE DEFECT the first closes. Paged.js 0.4.3 marks the PARENT of the text node it cut at a page
 * split with `pagedjs_hyphen` (`hyphenateAtBreak`, src/chunker/layout.js). When the cut word sits in
 * `<em>`, the class is on the `<em>`; `layout/hyphen-across-page` read the block's own classes and
 * missed it. Measured on patched Chromium 141, no evidence binding: the same split reported without
 * `<em>` and silent with it.
 *
 * Under test here as the real in-page payload over the fake page tree (`tests/fixtures/paged-dom.ts`)
 * and the real rule over the snapshot it makes.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runDocument } from "../../src/core/engine.ts";
import type { RawSnapshot } from "../../src/measure/snapshot.ts";
import { SNAPSHOT_SOURCE } from "../../src/measure/snapshot.ts";
import { hyphenAcrossPage } from "../../src/rules/layout/hyphen-across-page.ts";
import { loadCorpus } from "../fixtures/corpus.ts";
import { evaluatePayload, pagedDocument, pagedPage } from "../fixtures/paged-dom.ts";

function collected(content: string): RawSnapshot {
  return evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, pagedDocument([pagedPage({ pageBox: [0, 0, 500, 700], contentBox: [20, 20, 460, 660], content })]));
}
const bySid = (raw: RawSnapshot, sid: string) => raw.blocks.find((block) => block.sid === sid)!;

describe("the boundary-hyphen mark the collector records", () => {
  it("belongs to the nearest source block of the marked element: the block itself, or around an inline element", () => {
    const raw = collected(
      `<p data-bl-sid="own" class="pagedjs_hyphen" data-test-box="20 20 200 20">cut wo-</p>` +
      `<section data-bl-sid="wrap" data-test-box="20 40 200 40"><p data-bl-sid="inner" data-test-box="20 40 200 20">in <em class="pagedjs_hyphen" data-test-box="40 40 20 20">wo-</em></p></section>` +
      `<p data-bl-sid="plain" data-test-box="20 100 200 20">no mark</p>`,
    );
    assert.deepEqual(["own", "wrap", "inner", "plain"].map((sid) => bySid(raw, sid).boundaryHyphen), [true, false, true, false]);
    // classList stays the element's own class attribute.
    assert.deepEqual(bySid(raw, "inner").classList, []);
  });

  it("records the computed float and position of every block", () => {
    const raw = collected(
      `<div data-bl-sid="f" data-test-box="20 20 100 20" style="float: right">f</div>` +
      `<div data-bl-sid="a" data-test-box="20 40 100 20" style="position: absolute">a</div>` +
      `<div data-bl-sid="n" data-test-box="20 60 100 20">n</div>`,
    );
    assert.deepEqual(["f", "a", "n"].map((sid) => [bySid(raw, sid).float, bySid(raw, sid).position]),
      [["right", "static"], ["none", "absolute"], ["none", "static"]]);
  });
});

describe("layout/hyphen-across-page reads the recorded mark", () => {
  it("reports a boundary hyphen inside an inline element, which the block's own classes do not carry", () => {
    const snapshot = structuredClone(loadCorpus().find((entry) => entry.name === "hyphen-trigger")!.snapshot);
    const block = snapshot.blocks.find((item) => item.boundaryHyphen)!;
    block.classList = [];
    const run = () => runDocument({ path: "doc.html", snapshot, infrastructure: [] },
      { failOn: "never", activeRules: [hyphenAcrossPage], optionsByRule: {}, coverageFloors: {} }).report;
    assert.deepEqual(run().findings.map((finding) => finding.target.nodeKey), [block.nodeKey]);
    block.boundaryHyphen = false;
    block.classList = ["pagedjs_hyphen"];
    assert.deepEqual(run().findings, [], "a class the collector did not attribute to the block's own content is not the rule's to read");
  });
});
