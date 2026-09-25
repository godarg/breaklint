/**
 * Snapshot 5: what the page records about a block besides its text — the boxes of the replaced
 * content inside it (`atomicBoxes`) and what lays its content out other than as one untransformed
 * block-direction flow (`flowHazards`, in three scopes). `layout/unbreakable-block-too-tall` bounds
 * a split block from these, and declines it when a hazard is recorded; a hazard the payload does
 * not record is a false `error` the rule cannot see coming.
 *
 * WHAT IS UNDER TEST is the real payload text, `SNAPSHOT_SOURCE`, over a hand-authored page tree in
 * the Paged.js 0.4.3 structure (see `tests/fixtures/paged-dom.ts` for what that harness is and is
 * not), and the Node-side invariant check that refuses a record without the fields.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { FLOW_HAZARDS, SNAPSHOT_SCHEMA_VERSION } from "../../src/core/enums.ts";
import { runDocument } from "../../src/core/engine.ts";
import type { Snapshot } from "../../src/core/types.ts";
import { SNAPSHOT_SOURCE, validateSnapshotInvariants, type RawSnapshot } from "../../src/measure/snapshot.ts";
import { ALL_RULES } from "../../src/rules/index.ts";
import { loadCorpus } from "../fixtures/corpus.ts";
import { evaluatePayload, pagedDocument, pagedPage } from "../fixtures/paged-dom.ts";

const at = (x: number, y: number, width: number, height: number) => `data-test-box="${x} ${y} ${width} ${height}"`;

function capture(content: string): RawSnapshot {
  const document = pagedDocument([pagedPage({ pageBox: [0, 0, 566.93, 453.54], contentBox: [56.69, 56.69, 453.53, 340.16], content })]);
  return evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, document);
}
const blockOf = (raw: RawSnapshot, sid: string) => {
  const found = raw.blocks.find((block) => block.sid === sid);
  assert.ok(found, `no record for ${sid}`);
  return found;
};

describe("Snapshot 5 records what a block holds besides text, and what takes it out of one flow", () => {
  it("records a hazard on ANY element inside the block, not only on block records", () => {
    const raw = capture(
      `<div data-bl-sid="s1" style="break-inside: avoid" ${at(56.69, 56.69, 453.53, 300)}>` +
        `<p data-bl-sid="s2" style="position: relative; top: -55px" ${at(56.69, 56.69, 453.53, 18.66)}>Moved up.</p>` +
        `<p data-bl-sid="s3" ${at(56.69, 75.35, 453.53, 18.66)}>A <span style="transform: rotate(2deg)">turned</span> word.</p>` +
        `<p data-bl-sid="s4" ${at(56.69, 94, 453.53, 18.66)}>A <em style="float: left">floated</em> word.</p>` +
        `<p data-bl-sid="s5" ${at(56.69, 113, 453.53, 18.66)}>A <b style="position: absolute">placed</b> word.</p>` +
        `<p data-bl-sid="s6" style="columns: 2; column-count: 2" ${at(56.69, 132, 453.53, 18.66)}>Two columns.</p>` +
        `<p data-bl-sid="s7" style="margin-top: -4px" ${at(56.69, 151, 453.53, 18.66)}>Pulled up.</p>` +
        `</div>`,
    );
    assert.deepEqual(blockOf(raw, "s1").flowHazards, {
      inside: ["float", "multicol", "negative-margin", "offset", "out-of-flow", "transformed"], self: [], around: [],
    });
    // The paragraph itself is offset; what it does to its OWN placement is `self`, not inside it.
    assert.deepEqual(blockOf(raw, "s2").flowHazards, { inside: [], self: ["offset"], around: [] });
    assert.deepEqual(blockOf(raw, "s3").flowHazards, { inside: ["transformed"], self: [], around: [] });
    assert.deepEqual(blockOf(raw, "s6").flowHazards, { inside: [], self: ["multicol"], around: [] });
    // A sideways offset counts too: it can carry a line across the page column's edge.
    const sideways = capture(`<div data-bl-sid="s1" ${at(56.69, 56.69, 453.53, 20)}><span style="position: relative; left: 12px">Aside.</span></div>`);
    assert.deepEqual(blockOf(sideways, "s1").flowHazards, { inside: ["offset"], self: [], around: [] });
    // `relative` with no offset moves nothing.
    const still = capture(`<div data-bl-sid="s1" ${at(56.69, 56.69, 453.53, 20)}><p data-bl-sid="s2" style="position: relative; top: 0px" ${at(56.69, 56.69, 453.53, 18.66)}>Still.</p></div>`);
    assert.deepEqual(blockOf(still, "s1").flowHazards, { inside: [], self: [], around: [] });
  });

  it("records the ancestors up to the page content, and stops there", () => {
    const raw = capture(
      `<div data-bl-sid="g" style="display: grid" ${at(56.69, 56.69, 453.53, 100)}>` +
        `<section data-bl-sid="t" style="transform: scale(0.5)" ${at(56.69, 56.69, 453.53, 100)}>` +
        `<p data-bl-sid="p" ${at(56.69, 56.69, 453.53, 18.66)}>Inside.</p></section></div>`,
    );
    assert.deepEqual(blockOf(raw, "p").flowHazards, { inside: [], self: [], around: ["flex-or-grid", "transformed"] });
    assert.deepEqual(blockOf(raw, "g").flowHazards, { inside: ["transformed"], self: ["flex-or-grid"], around: [] });
  });

  it("records a table row of two cells as table-columns", () => {
    const raw = capture(
      `<table data-bl-sid="tb" style="display: table" ${at(56.69, 56.69, 453.53, 40)}><tbody data-bl-sid="bd" style="display: table-row-group" ${at(56.69, 56.69, 453.53, 40)}>` +
        `<tr data-bl-sid="tr" style="display: table-row" ${at(56.69, 56.69, 453.53, 20)}><td data-bl-sid="a" style="display: table-cell" ${at(56.69, 56.69, 200, 20)}>A</td>` +
        `<td data-bl-sid="b" style="display: table-cell" ${at(260, 56.69, 200, 20)}>B</td></tr></tbody></table>`,
    );
    assert.deepEqual(blockOf(raw, "tb").flowHazards.inside, ["table-columns"]);
    assert.deepEqual(blockOf(raw, "tr").flowHazards.self, ["table-columns"]);
  });

  it("records replaced content, clipped by an ancestor that clips it, and flags one that overflows", () => {
    const raw = capture(
      `<figure data-bl-sid="f" style="break-inside: avoid" ${at(56.69, 56.69, 453.53, 330)}>` +
        `<img ${at(56.69, 56.69, 300, 200)}>` +
        `<video ${at(56.69, 256.69, 300, 50)}></video>` +
        `<div data-bl-sid="c" style="overflow: hidden; overflow-y: hidden" ${at(56.69, 306.69, 453.53, 30)}><canvas ${at(56.69, 306.69, 300, 100)}></canvas></div>` +
        `<img style="visibility: hidden" ${at(56.69, 56.69, 300, 200)}><img ${at(56.69, 56.69, 0, 0)}>` +
        `</figure>`,
    );
    const figure = blockOf(raw, "f");
    // The hidden and the empty image take no room; the canvas shows only as much as its clipping
    // parent lets it. (An svg inside an svg is skipped too; the harness has no svg primitives, so
    // that is left to the live suite.)
    assert.deepEqual(figure.atomicBoxes, [
      { tag: "img", box: { x: 56.69, y: 56.69, width: 300, height: 200 } },
      { tag: "video", box: { x: 56.69, y: 256.69, width: 300, height: 50 } },
      { tag: "canvas", box: { x: 56.69, y: 306.69, width: 300, height: 30 } },
    ]);
    assert.deepEqual(figure.flowHazards.inside, []);

    const spilling = capture(
      `<div data-bl-sid="f" ${at(56.69, 56.69, 453.53, 250)}><div data-bl-sid="h" ${at(56.69, 56.69, 453.53, 50)}><img ${at(56.69, 56.69, 300, 200)}></div></div>`,
    );
    assert.deepEqual(blockOf(spilling, "f").flowHazards.inside, ["overflowing-content"]);
    assert.deepEqual(blockOf(spilling, "f").atomicBoxes, [{ tag: "img", box: { x: 56.69, y: 56.69, width: 300, height: 200 } }]);
  });

  it("names only hazards the enum knows", () => {
    for (const hazard of ["out-of-flow", "offset", "sticky", "transformed", "float", "multicol", "flex-or-grid", "table-columns", "vertical-writing", "negative-margin", "overflowing-content"]) {
      assert.ok((FLOW_HAZARDS as readonly string[]).includes(hazard), hazard);
    }
  });
});

describe("Snapshot 5 migration", () => {
  it("stamps the demo and the corpus 5, with the new fields on every record", () => {
    const demo = JSON.parse(readFileSync(new URL("../../examples/demo-snapshot.json", import.meta.url), "utf8")) as { snapshot: Snapshot };
    const snapshots = [demo.snapshot, ...loadCorpus().map((entry) => entry.snapshot)];
    for (const snapshot of snapshots) {
      assert.equal(snapshot.schemaVersion, SNAPSHOT_SCHEMA_VERSION);
      assert.equal(SNAPSHOT_SCHEMA_VERSION, 5);
      for (const block of snapshot.blocks) {
        assert.ok(Array.isArray(block.atomicBoxes), `${block.nodeKey}: atomicBoxes`);
        for (const scope of ["inside", "self", "around"] as const) assert.ok(Array.isArray(block.flowHazards[scope]), `${block.nodeKey}: ${scope}`);
      }
      assert.deepEqual(validateSnapshotInvariants(snapshot, { sourceMapInjection: false }).issues.filter((issue) => /atomicBoxes|flowHazards/u.test(issue)), []);
    }
  });

  it("refuses a record without the fields, and a snapshot stamped 4", () => {
    const snapshot = structuredClone(loadCorpus().find((entry) => entry.name === "too-tall-trigger")!.snapshot);
    delete (snapshot.blocks[0] as Partial<(typeof snapshot.blocks)[number]>).atomicBoxes;
    (snapshot.blocks[0]!.flowHazards as unknown as { self: unknown }).self = ["levitating"];
    const issues = validateSnapshotInvariants(snapshot, { sourceMapInjection: false }).issues;
    assert.ok(issues.some((issue) => /t1: atomicBoxes absent/u.test(issue)), issues.join("; "));
    assert.ok(issues.some((issue) => /t1: flowHazards\.self absent, unknown or repeated/u.test(issue)), issues.join("; "));

    const old = structuredClone(loadCorpus().find((entry) => entry.name === "too-tall-trigger")!.snapshot);
    old.schemaVersion = 4;
    const outcome = runDocument(
      { path: "old.html", snapshot: old, infrastructure: [] },
      { failOn: "error", activeRules: [...ALL_RULES], optionsByRule: {}, coverageFloors: {} },
    );
    assert.notEqual(outcome.report.verdict, "clean");
    assert.deepEqual(outcome.report.findings, []);
  });
});
