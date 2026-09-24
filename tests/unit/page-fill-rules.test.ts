/**
 * The two page-fill rules, through the real engine: what they judge, and what they say.
 *
 * `layout/orphaned-continuation-page` used to judge every page on which all blocks are
 * continuations. That is also true of every MIDDLE page of a block that spans three pages or
 * more, and when what goes on is running text such a page is full — its next line did not fit —
 * while its net fill, which counts glyph boxes and not line boxes, reads far below 1 at a
 * generous line height. The rule now judges a page only when what it carries ends on it
 * (`ends-on-page`): its last block in document order is that block's final fragment, or the next
 * page opens with a block that starts there, so the break fell between blocks. The second half is
 * what keeps a wrapper whose fresh child was carried over (a `<section>` with a tall
 * `break-inside: avoid` figure) from counting as full.
 *
 * Both halves rest on the order of `snapshot.blocks`: page by page, and within a page in the
 * document order of the paginated tree. The live suite checks that the real collector produces
 * that order (tests/live/render-run.test.ts); the cases here check that the rule reads that
 * order, and that blocks outside the page's flow — a margin-box clone, a `display: none` original
 * with no box — move nothing.
 *
 * `layout/half-empty-page` stated in every finding that its threshold sat "0.086 below the
 * measured ceiling of a full text page". Net fill has no ceiling: full prose pages at
 * line-height 1.5 were measured at 0.58–0.72 with this collector. The message now says what the
 * quantity is, and quotes nothing that was not measured.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { runDocument } from "../../src/core/engine.ts";
import type { BlockRecord, Snapshot, TargetEvaluation } from "../../src/core/types.ts";
import { halfEmptyPage } from "../../src/rules/layout/half-empty-page.ts";
import { orphanedContinuationPage } from "../../src/rules/layout/orphaned-continuation-page.ts";
import { loadCorpus } from "../fixtures/corpus.ts";

const corpusSnapshot = (name: string): Snapshot => {
  const entry = loadCorpus().find((item) => item.name === name);
  assert.ok(entry, `no corpus fixture named ${name}`);
  return structuredClone(entry.snapshot);
};

function run(snapshot: Snapshot, rule = orphanedContinuationPage) {
  return runDocument(
    { path: "fill.html", snapshot, infrastructure: [] },
    { failOn: "never", activeRules: [rule], optionsByRule: {}, coverageFloors: {} },
  ).report;
}

function measurementsOf(evaluations: readonly TargetEvaluation[], pageNodeKey: string) {
  const row = evaluations.find((item) => item.targetRef.nodeKey === pageNodeKey);
  assert.ok(row, `no evaluation for ${pageNodeKey}`);
  assert.equal(row.status, "measured");
  return {
    names: row.measurements.map((m) => m.name),
    values: Object.fromEntries(row.measurements.map((m) => [m.name, m.value])),
    violated: row.predicate.violated,
  };
}

/** A continuation fragment with an explicit source id and fragment position. */
function fragment(template: BlockRecord, over: Partial<BlockRecord> & Pick<BlockRecord, "nodeKey" | "sid" | "page" | "fragmentIndex" | "fragmentCount">): BlockRecord {
  return { ...structuredClone(template), ...over };
}

describe("page-fill rules", () => {
  it("judges a continuation page only when what it carries ends there, and records ends-on-page", () => {
    // One paragraph over four pages, pages 2 and 3 at net fill 0.49 against 0.50: the numbers of
    // a real full page at line-height 2.2. Before the guard both pages were reported.
    const snapshot = corpusSnapshot("orphaned-continuation-clean-full-middle-page");
    const report = run(snapshot);
    assert.deepEqual(report.findings.map((f) => f.page), [], "a middle page of a continuing block was reported");

    const rows = ["pg1", "pg2", "pg3", "pg4"].map((key) => measurementsOf(report.evaluations, key));
    for (const row of rows) assert.deepEqual(row.names, ["continuation-only", "ends-on-page", "net-fill"]);
    assert.deepEqual(rows.map((row) => row.values["continuation-only"]), [false, true, true, true]);
    assert.deepEqual(rows.map((row) => row.values["ends-on-page"]), [false, false, false, true]);
    assert.deepEqual(rows.map((row) => row.values["net-fill"]), [0.46, 0.49, 0.49, 0.73]);
    assert.deepEqual(rows.map((row) => row.violated), [false, false, false, false]);
    assert.equal(report.coverage["layout/orphaned-continuation-page"]!.measured, 4);

    // The page the rule exists for is still judged: the same paragraph ending on page 4 in two
    // lines reports page 4, and only page 4.
    snapshot.pages[3]!.fill.net = 0.06;
    const tail = run(snapshot);
    assert.deepEqual(tail.findings.map((f) => [f.ruleId, f.page]), [["layout/orphaned-continuation-page", 4]]);
    assert.equal(
      tail.findings[0]!.message,
      "Page 4 carries only content continued from an earlier page, which ends there, and its net fill " +
        "is 6.0 %; threshold 50 %. The break into it was an overflow, not a request.",
    );
    assert.equal(measurementsOf(tail.evaluations, "pg4").violated, true);
  });

  it("reads the last block in document order, so a continuing wrapper does not hide the child that ends", () => {
    const snapshot = corpusSnapshot("orphaned-continuation-trigger");
    const template = snapshot.blocks[0]!;
    // A <section> that continues past the page, and the paragraph inside it that ends on it.
    // Document order puts the wrapper first; the page ends in the paragraph, so it is judged.
    const section = fragment(template, { nodeKey: "section:1", sid: "s-section", tag: "section", page: 1, fragmentIndex: 1, fragmentCount: 3 });
    const paragraph = fragment(template, { nodeKey: "p:1", sid: "s-p", page: 1, fragmentIndex: 1, fragmentCount: 2 });

    snapshot.blocks = [section, paragraph];
    const inOrder = run(snapshot);
    assert.deepEqual(inOrder.findings.map((f) => f.page), [1]);
    assert.equal(measurementsOf(inOrder.evaluations, "pg1").values["ends-on-page"], true);

    // The same two blocks in the other order: the rule reads the LAST one and nothing else. This
    // is what makes the collection order load-bearing, and why the live suite pins it.
    snapshot.blocks = [paragraph, section];
    const reversed = run(snapshot);
    assert.deepEqual(reversed.findings, []);
    assert.equal(measurementsOf(reversed.evaluations, "pg1").values["ends-on-page"], false);
  });

  it("judges a wrapper's page when its fresh child was carried over, and only then", () => {
    // A <section>: its paragraph ends on page 1, its own 200 px SVG sits on page 2, and its next
    // child, a break-inside: avoid figure, did not fit and opens page 3. The section continues, so
    // the page's last block does not end — but the break fell between blocks, and page 2 is two
    // thirds empty. Measured live with the same shape: net fill 0.31, and silent under the
    // last-block condition alone.
    const snapshot = corpusSnapshot("orphaned-continuation-trigger-carried-child");
    const report = run(snapshot);
    assert.deepEqual(report.findings.map((f) => f.page), [2]);
    const row = measurementsOf(report.evaluations, "pg2");
    assert.deepEqual(row.values, { "continuation-only": true, "ends-on-page": true, "net-fill": 0.31 });

    // A parity blank page between them changes nothing: the page that opens after it is read.
    const withBlank = structuredClone(snapshot);
    const blank = structuredClone(withBlank.pages[2]!);
    Object.assign(blank, {
      pageNumber: 3, nodeKey: "pg3", isLast: false, blank: true, firstSemanticBlockKey: null,
      fill: { vertical: 0, topGap: 0, net: 0, area: 0 },
      incomingBreakCause: { kind: "parity", determinedBy: "page-blank", cascadeHint: null },
      outgoingBreakCause: { kind: "parity", determinedBy: "page-blank", cascadeHint: null },
    });
    withBlank.pages[2] = { ...withBlank.pages[2]!, pageNumber: 4, nodeKey: "pg4" };
    withBlank.pages.splice(2, 0, blank);
    withBlank.blocks = withBlank.blocks.map((b) => b.page === 3 ? { ...b, page: 4 } : b);
    assert.deepEqual(run(withBlank).findings.map((f) => f.page), [2]);

    // Not when the wrapper's continuation carries content of its own ABOVE the fresh child: then
    // the break fell inside that content. This is the documented limit — the wrapper's own SVG
    // that did not fit and opens the next page — and it keeps text running on from being judged.
    const ownContentFirst = structuredClone(snapshot);
    for (const b of ownContentFirst.blocks.filter((b) => b.page === 3 && b.fragmentIndex === 0)) b.box = { ...b.box, y: b.box.y + 200 };
    assert.deepEqual(run(ownContentFirst).findings, []);
    assert.equal(measurementsOf(run(ownContentFirst).evaluations, "pg2").values["ends-on-page"], false);

    // Not when the fresh block opens a second COLUMN beside continuing content: the continuation
    // does not span it, so it is not its wrapper.
    const columns = structuredClone(snapshot);
    for (const b of columns.blocks.filter((b) => b.page === 3)) {
      b.box = b.fragmentIndex === 0 ? { ...b.box, x: 257, width: 190 } : { ...b.box, width: 190 };
    }
    assert.deepEqual(run(columns).findings, []);
  });

  it("keeps full middle pages silent when the next page opens with the continuation", () => {
    // The long paragraph again, with a fresh block on page 4 BELOW the paragraph's last lines:
    // page 4 opens with running text, so page 3, which it continues, was full.
    const snapshot = corpusSnapshot("orphaned-continuation-clean-full-middle-page");
    const template = snapshot.blocks[0]!;
    snapshot.blocks.push(fragment(template, {
      nodeKey: "after", sid: "s-after", page: 4, fragmentIndex: 0, fragmentCount: 1, box: { ...template.box, y: 400 },
    }));
    const report = run(snapshot);
    assert.deepEqual(report.findings, []);
    assert.deepEqual(
      ["pg2", "pg3"].map((key) => measurementsOf(report.evaluations, key).values["ends-on-page"]),
      [false, false],
    );
  });

  it("counts only the page's flow: a margin-box clone or a box-less original moves nothing", () => {
    // Paged.js clones a `position: running()` element into a margin box on every page, and the
    // clone keeps its source id, so the collector may record it as a fragment; the in-flow
    // original stays in the page content with `display: none` and no box. Neither is content of
    // the page. The fixture's content box starts at y = 48; the margin box sits above it.
    const base = corpusSnapshot("orphaned-continuation-clean-full-middle-page");
    const template = base.blocks[0]!;
    const clone = (page: number, fragmentIndex: number, fragmentCount: number) =>
      fragment(template, {
        nodeKey: `header:${page}`, sid: "s-header", tag: "header", page, fragmentIndex, fragmentCount,
        box: { ...template.box, y: 8, height: 20 },
      });
    const original = (page: number, fragmentIndex: number, fragmentCount: number) =>
      fragment(template, {
        nodeKey: `header-original:${page}`, sid: "s-header-2", tag: "header", page, fragmentIndex, fragmentCount,
        box: { x: 0, y: 0, width: 0, height: 0 },
      });
    base.pages[3]!.fill.net = 0.06;
    // Pages 1–3: a clone first. Page 4, the two-line tail: the FIRST clone of a second running
    // element (fragment 0, so the page would not be "continuation-only"), the paragraph's final
    // fragment, and after it that element's box-less original, which is not its final fragment
    // (so the page's last block would "continue"). Measured live in that order.
    base.blocks = [
      clone(1, 0, 3), base.blocks[0]!,
      clone(2, 1, 3), base.blocks[1]!,
      clone(3, 2, 3), base.blocks[2]!,
      { ...clone(4, 0, 3), sid: "s-header-2", nodeKey: "header-2:4" }, base.blocks[3]!, original(4, 1, 3),
    ];
    const report = run(base);
    assert.deepEqual(report.findings.map((f) => f.page), [4], "the two-line tail page was hidden by blocks outside its flow");
    assert.deepEqual(
      ["pg2", "pg3", "pg4"].map((key) => measurementsOf(report.evaluations, key).values),
      [
        { "continuation-only": true, "ends-on-page": false, "net-fill": 0.49 },
        { "continuation-only": true, "ends-on-page": false, "net-fill": 0.49 },
        { "continuation-only": true, "ends-on-page": true, "net-fill": 0.06 },
      ],
    );
  });

  it("half-empty-page says what net fill is and claims no ceiling", () => {
    const report = run(corpusSnapshot("half-empty-trigger"), halfEmptyPage);
    assert.equal(report.findings.length, 1);
    const message = report.findings[0]!.message;
    assert.equal(
      message,
      "Page 1 is 5.0 % filled; threshold 60 %. Experimental: net fill sums the glyph boxes of text, " +
        "not its line boxes, so a page a reader calls full can read below this threshold.",
    );
    assert.doesNotMatch(message, /ceiling|0\.086|0\.686/u);
    // The same sentence on the last page, after the likely-intended note.
    const lastPage = corpusSnapshot("half-empty-trigger-foot-line");
    lastPage.pages[0]!.isLast = true;
    const lastMessage = run(lastPage, halfEmptyPage).findings[0]!.message;
    assert.match(lastMessage, /^Page 1 is 4\.9 % filled; threshold 60 %\. This is the last page and carries no continuation — likely intended\. Experimental: net fill sums the glyph boxes/u);
    assert.doesNotMatch(lastMessage, /ceiling|0\.086|0\.686/u);
  });

  it("no rule page or contract document states a net-fill ceiling", () => {
    // The claim was copied into five places. It was never a bound — full prose pages at
    // line-height 1.5 read 0.58–0.72 — and a page that repeats it tells an agent to trust a
    // threshold margin that does not exist.
    const FALSE_CEILING = /0\.686|0\.086|measured ceiling|ceiling of `?net ?fill`?|eighty-six thousandths/iu;
    for (const file of [
      "README.md",
      "docs/agent-contract.md",
      "docs/limitations.md",
      "docs/rules/layout-half-empty-page.md",
      "docs/rules/layout-orphaned-continuation-page.md",
    ]) {
      const text = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      assert.equal(FALSE_CEILING.exec(text)?.[0] ?? null, null, `${file} still states a net-fill ceiling`);
    }
  });
});
