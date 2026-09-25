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

  /**
   * One trigger per hazard (and per property where a hazard has several), each inside an otherwise
   * plain block, and its control: the same element without the trigger records nothing.
   */
  it("records every FLOW_HAZARDS trigger inside a block, each alone", () => {
    const inside = (child: string) => blockOf(capture(
      `<div data-bl-sid="s1" ${at(56.69, 56.69, 453.53, 200)}>${child}</div>`,
    ), "s1").flowHazards.inside;
    const p = (style: string, extra = "") => `<p data-bl-sid="s2" style="${style}" ${extra} ${at(56.69, 56.69, 453.53, 18.66)}>Text.</p>`;
    const cases: [string, string][] = [
      ["position: absolute", "out-of-flow"],
      ["position: fixed", "out-of-flow"],
      ["position: sticky", "sticky"],
      ["position: relative; top: 3px", "offset"],
      ["position: relative; bottom: -3px", "offset"],
      ["position: relative; left: 3px", "offset"],
      ["position: relative; right: 3px", "offset"],
      ["transform: rotate(1deg)", "transformed"],
      ["translate: 0px 4px", "transformed"],
      ["rotate: 2deg", "transformed"],
      ["scale: 0.5", "transformed"],
      ["offset-path: path('M 0 0 L 10 10')", "transformed"],
      ["float: left", "float"],
      ["float: inline-end", "float"],
      ["column-count: 2", "multicol"],
      ["column-width: 10em", "multicol"],
      ["display: flex", "flex-or-grid"],
      ["display: inline-flex", "flex-or-grid"],
      ["display: grid", "flex-or-grid"],
      ["display: inline-grid", "flex-or-grid"],
      ["display: -webkit-box", "flex-or-grid"],
      ["display: -webkit-inline-box", "flex-or-grid"],
      ["writing-mode: vertical-rl", "vertical-writing"],
      ["writing-mode: sideways-lr", "vertical-writing"],
      ["margin-top: -4px", "negative-margin"],
      ["margin-bottom: -1px", "negative-margin"],
      ["display: inline-block", "atomic-inline"],
      ["display: inline-table", "atomic-inline"],
      ["display: table-cell", "atomic-inline"],
    ];
    for (const [style, hazard] of cases) assert.deepEqual(inside(p(style)), [hazard], style);
    // Controls: the property at its initial value, or a value that moves nothing.
    for (const style of ["position: static", "position: relative; top: 0px", "transform: none", "translate: none", "float: none",
      "column-count: auto", "display: block", "writing-mode: horizontal-tb", "margin-top: 4px", "display: inline"]) {
      assert.deepEqual(inside(p(style)), [], style);
    }
    // An inline-level box holding no text is not a text column.
    assert.deepEqual(inside(`<span style="display: inline-block" ${at(56.69, 56.69, 10, 10)}></span>`), []);
    // A shadow tree: an open shadow root, a slot, or an autonomous custom element.
    assert.deepEqual(inside(`<span data-test-shadow-root ${at(56.69, 56.69, 10, 10)}>x</span>`), ["shadow-tree"]);
    assert.deepEqual(inside(`<slot ${at(56.69, 56.69, 10, 10)}>x</slot>`), ["shadow-tree"]);
    assert.deepEqual(inside(`<my-column ${at(56.69, 56.69, 10, 10)}>x</my-column>`), ["shadow-tree"]);
    // Overflowing replaced content is recorded with the atoms (below).
  });

  it("records a table row of two cells only when its table is split", () => {
    const table = (tableAttrs: string, rowAttrs = "", cellAttrs = "") => capture(
      `<table data-bl-sid="tb" style="display: table" ${tableAttrs} ${at(56.69, 56.69, 453.53, 40)}><tbody data-bl-sid="bd" style="display: table-row-group" ${at(56.69, 56.69, 453.53, 40)}>` +
        `<tr data-bl-sid="tr" style="display: table-row" ${rowAttrs} ${at(56.69, 56.69, 453.53, 20)}><td data-bl-sid="a" style="display: table-cell" ${cellAttrs} ${at(56.69, 56.69, 200, 20)}>A</td>` +
        `<td data-bl-sid="b" style="display: table-cell" ${at(260, 56.69, 200, 20)}>B</td></tr></tbody></table>`,
    );
    // A table wholly inside one fragment is laid out as it would be unsplit.
    assert.deepEqual(blockOf(table(""), "tb").flowHazards.inside, []);
    // Split: the table piece, a row, or a cell carries the paginator's split marker.
    assert.deepEqual(blockOf(table('data-split-from="r1"'), "tb").flowHazards.inside, ["table-columns"]);
    assert.deepEqual(blockOf(table("", 'data-split-to="r2"'), "tb").flowHazards.inside, ["table-columns"]);
    assert.deepEqual(blockOf(table("", "", 'data-split-from="r3"'), "tb").flowHazards.inside, ["table-columns"]);
    assert.deepEqual(blockOf(table('data-split-to="r1"'), "tr").flowHazards.self, ["table-columns"]);
  });

  it("records a split piece whose pseudo-elements change what it carries", () => {
    const piece = (attrs: string) => blockOf(capture(
      `<div data-bl-sid="s1" ${at(56.69, 56.69, 453.53, 200)}><p data-bl-sid="s2" ${attrs} ${at(56.69, 56.69, 453.53, 18.66)}>Text.</p></div>`,
    ), "s1").flowHazards.inside;
    // Measured by the verifier (Paged.js 0.4.3): ::first-line is not unset on a continuation, so its
    // first line is set in the first line's font; an author !important ::before repeats on it.
    assert.deepEqual(piece('data-split-from="r" data-test-first-line="font-size: 20px"'), ["split-pseudo"]);
    assert.deepEqual(piece('data-split-from="r" data-test-first-line="letter-spacing: 2px"'), ["split-pseudo"]);
    assert.deepEqual(piece('data-split-from="r" data-test-first-letter="float: left"'), ["split-pseudo"]);
    assert.deepEqual(piece('data-split-from="r" data-test-first-letter="font-size: 40px"'), ["split-pseudo"]);
    assert.deepEqual(piece('data-split-from="r" data-test-before="content: &quot;x&quot;"'), ["split-pseudo"]);
    assert.deepEqual(piece('data-split-to="r" data-test-after="content: &quot;x&quot;"'), ["split-pseudo"]);
    // Controls: the same styling on a piece that is not a continuation is laid out as unsplit, and
    // a continuation whose pseudo-elements change nothing is not a hazard.
    assert.deepEqual(piece('data-test-first-line="font-size: 20px" data-test-before="content: &quot;x&quot;"'), []);
    assert.deepEqual(piece('data-split-from="r"'), []);
    // A continuation whose text starts inside a larger span: its first letter is set in the span's
    // font without any first-letter styling (measured in quirks mode, 34 px), and that is no hazard.
    assert.deepEqual(blockOf(capture(
      `<div data-bl-sid="s1" ${at(56.69, 56.69, 453.53, 200)}><p data-bl-sid="s2" data-split-from="r" ${at(56.69, 56.69, 453.53, 18.66)}>` +
        `<span style="font-size: 34px; line-height: 4px">Big</span> text.</p></div>`,
    ), "s1").flowHazards.inside, []);
    assert.deepEqual(piece('data-split-to="r" data-test-before="content: &quot;x&quot;"'), []);
  });

  it("reads every hazard through the captured getPropertyValue, not a property getter", () => {
    // A document can shadow CSSStyleDeclaration.prototype.transform (or position, display, …) and
    // answer for itself. Here every property read answers the initial value; getPropertyValue
    // answers the truth, and the hazards must still be recorded.
    const lying = (primitives: Record<string, unknown>) => {
      const style = primitives.style as (node: unknown, pseudo?: string | null) => Record<string, string>;
      const initial: Record<string, string> = { display: "block", position: "static", float: "none", transform: "none",
        translate: "none", rotate: "none", scale: "none", offsetPath: "none", columnCount: "auto", columnWidth: "auto",
        writingMode: "horizontal-tb", marginTop: "0px", marginBottom: "0px", overflowY: "visible", content: "none" };
      const truthful = primitives.css as (s: Record<string, string>, name: string) => string;
      const hidden = new WeakMap<object, Record<string, string>>();
      return {
        ...primitives,
        style: (node: unknown, pseudo?: string | null) => {
          const real = style(node, pseudo);
          const spoofed = new Proxy(real, { get: (target, key) => (typeof key === "string" && key in initial ? initial[key] : target[key as string]) });
          hidden.set(spoofed, real);
          return spoofed;
        },
        css: (s: Record<string, string>, name: string) => truthful(hidden.get(s) ?? s, name),
      };
    };
    const raw = evaluatePayload<RawSnapshot>(SNAPSHOT_SOURCE, pagedDocument([pagedPage({
      pageBox: [0, 0, 566.93, 453.54], contentBox: [56.69, 56.69, 453.53, 340.16],
      content: `<div data-bl-sid="s1" ${at(56.69, 56.69, 453.53, 200)}>` +
        `<p data-bl-sid="s2" style="position: absolute" ${at(56.69, 56.69, 453.53, 18.66)}>A.</p>` +
        `<p data-bl-sid="s3" style="transform: rotate(1deg)" ${at(56.69, 76, 453.53, 18.66)}>B.</p>` +
        `<p data-bl-sid="s4" style="display: grid" ${at(56.69, 95, 453.53, 18.66)}>C.</p></div>`,
    })]), lying);
    assert.deepEqual(blockOf(raw, "s1").flowHazards.inside, ["flex-or-grid", "out-of-flow", "transformed"]);
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

    // The engine refuses the same snapshot, stamp 5 and all: a stored file is not re-validated by
    // the live path, and an absent list would be read as "no replaced content, no hazard".
    const stored = runDocument(
      { path: "stored.html", snapshot, infrastructure: [] },
      { failOn: "error", activeRules: [...ALL_RULES], optionsByRule: {}, coverageFloors: {} },
    );
    assert.equal(stored.report.verdict, "infrastructure");
    assert.ok(stored.report.infrastructure.some((event) => event.kind === "checker-crashed" && /lacks its fields: t1: atomicBoxes absent/u.test(event.detail ?? "")),
      JSON.stringify(stored.report.infrastructure));
    assert.deepEqual(stored.report.findings, []);
    const noHazards = structuredClone(loadCorpus().find((entry) => entry.name === "too-tall-trigger")!.snapshot);
    delete (noHazards.blocks[0] as Partial<(typeof noHazards.blocks)[number]>).flowHazards;
    assert.equal(runDocument({ path: "stored.html", snapshot: noHazards, infrastructure: [] },
      { failOn: "error", activeRules: [...ALL_RULES], optionsByRule: {}, coverageFloors: {} }).report.verdict, "infrastructure");

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
