/**
 * P4 (CDX-20, CODE-PRINT-4/5): the post-PDF out-of-flow coordinate tolerance as a pure decision
 * over facts read before and after one page.pdf(). Hand-authored geometry; nothing here is
 * produced by the function under test.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import * as renderRun from "../../src/acquire/render-run.ts";

type Judge = (input: { beforeBoxes: string; afterBoxes: string; before: unknown; after: unknown }) => boolean;
const judge = (renderRun as unknown as { judgePostPdfOofDrift?: Judge }).judgePostPdfOofDrift;

const A4 = 1122.52; // CSS px per A4 page; print rounds each page to 1123 px
const LETTER = 1056; // integer page height: no rounding at all
const style = { position: "absolute", left: "0px", top: "1px", right: "auto", bottom: "auto", transform: "none", translate: "none", marginLeft: "0px", marginTop: "0px" };

/**
 * One absolutely positioned element per page. Element i sits at boxes index 2*i+1; its in-flow
 * parent at 2*i. `shift(page)` is how far the reported box moved up after the PDF.
 */
function scenario(opts: { pages: number; height: number; shift: (page: number, content: { x: number; y: number }) => { dx: number; dy: number };
  mutateAfter?: (fact: Record<string, unknown>, page: number) => void }) {
  const pageHeights = Array.from({ length: opts.pages }, () => opts.height);
  const beforeBoxes: string[] = []; const afterBoxes: string[] = [];
  const before = { pageHeights, elements: [] as Record<string, unknown>[] };
  const after = { pageHeights, elements: [] as Record<string, unknown>[] };
  for (let page = 0; page < opts.pages; page += 1) {
    const content = { x: 75.59, y: page * (opts.height + 8) + 75.59 };
    const parent = { x: content.x, y: content.y + 20, width: 600, height: 40 };
    const box = { x: parent.x + 0, y: parent.y + 1, width: 5, height: 14.5 };
    const { dx, dy } = opts.shift(page, content);
    const moved = { ...box, x: box.x - dx, y: box.y - dy };
    const entry = (b: typeof box) => `SPAN:${b.x},${b.y},${b.width},${b.height}`;
    beforeBoxes.push(`DIV:${parent.x},${parent.y},${parent.width},${parent.height}`, entry(box));
    afterBoxes.push(`DIV:${parent.x},${parent.y},${parent.width},${parent.height}`, entry(moved));
    const fact = (b: typeof box) => ({ index: 2 * page + 1, pageIndex: page, parentIndex: 2 * page, box: b,
      parent: { x: parent.x, y: parent.y, borderLeft: 0, borderTop: 0 }, content, style: { ...style }, sameNode: true, sameParent: true });
    before.elements.push(fact(box));
    const afterFact = fact(moved);
    opts.mutateAfter?.(afterFact, page);
    after.elements.push(afterFact);
  }
  return { beforeBoxes: beforeBoxes.join(";"), afterBoxes: afterBoxes.join(";"), before, after };
}
const artifact = (page: number, content: { x: number; y: number }, extra = 0) => ({ dx: content.x, dy: content.y - page * 0.48 + extra });

describe("post-PDF OOF coordinate artifact: pure decision (P4)", () => {
  it("is exported as a pure decision over before/after facts", () => assert.equal(typeof judge, "function"));
  it("accepts the artifact on 42 A4 pages, with the rounding of the preceding page heights", () => {
    assert.equal(judge!(scenario({ pages: 42, height: A4, shift: (p, c) => artifact(p, c) })), true);
  });
  it("bounds the tolerance by the actual rounding sum, not by one pixel per page", () => {
    // Page 40 of A4: rounding sum 40 * 0.48 = 19.2 px (+2.5). A 30 px deviation is not rounding.
    assert.equal(judge!(scenario({ pages: 41, height: A4, shift: (p, c) => artifact(p, c, p === 40 ? -30 : 0) })), false);
    // Letter has integer page heights: a 6 px deviation on page 40 is not rounding either.
    assert.equal(judge!(scenario({ pages: 41, height: LETTER, shift: (p, c) => ({ dx: c.x, dy: c.y + (p === 40 ? 6 : 0) }) })), false);
    assert.equal(judge!(scenario({ pages: 41, height: LETTER, shift: (_p, c) => ({ dx: c.x, dy: c.y }) })), true);
  });
  it("rejects a changed transform, position offset or margin read after the PDF (CSSOM change)", () => {
    for (const [name, change] of [["transform", { transform: "matrix(1, 0, 0, 1, -75.59, -75.59)" }], ["top", { top: "-74.59px" }],
      ["left", { left: "-75.59px" }], ["translate", { translate: "-75.59px -75.59px" }], ["marginTop", { marginTop: "-75px" }]] as const) {
      const s = scenario({ pages: 1, height: A4, shift: (p, c) => artifact(p, c), mutateAfter: f => { f.style = { ...(f.style as object), ...change }; } });
      assert.equal(judge!(s), false, name);
    }
  });
  it("rejects a different node, a different offsetParent, or a moved parent", () => {
    assert.equal(judge!(scenario({ pages: 1, height: A4, shift: (p, c) => artifact(p, c), mutateAfter: f => { f.sameNode = false; } })), false);
    assert.equal(judge!(scenario({ pages: 1, height: A4, shift: (p, c) => artifact(p, c), mutateAfter: f => { f.sameParent = false; } })), false);
    const s = scenario({ pages: 1, height: A4, shift: (p, c) => artifact(p, c) });
    s.afterBoxes = s.afterBoxes.replace(/^DIV:[^;]+/u, "DIV:75.59,90,600,40");
    assert.equal(judge!(s), false);
  });
  it("rejects unequal shifts on one page, a downward shift, a size change and an element without facts", () => {
    const two = scenario({ pages: 1, height: A4, shift: (p, c) => artifact(p, c) });
    // A second element on the same page whose shift differs by 3 px.
    two.beforeBoxes += ";SPAN:75.59,120,5,14.5"; two.afterBoxes += `;SPAN:0,${120 - 75.59 + 3},5,14.5`;
    const extra = { ...(two.before.elements[0]!), index: 2, box: { x: 75.59, y: 120, width: 5, height: 14.5 } };
    two.before.elements.push(extra); two.after.elements.push({ ...extra, box: { x: 0, y: 120 - 75.59 + 3, width: 5, height: 14.5 } });
    assert.equal(judge!(two), false);
    assert.equal(judge!(scenario({ pages: 1, height: A4, shift: (_p, c) => ({ dx: c.x, dy: -c.y }) })), false);
    const sized = scenario({ pages: 1, height: A4, shift: (p, c) => artifact(p, c) });
    sized.afterBoxes = sized.afterBoxes.replace(/,5,14\.5$/u, ",6,14.5");
    assert.equal(judge!(sized), false);
    const noFacts = scenario({ pages: 1, height: A4, shift: (p, c) => artifact(p, c) });
    noFacts.before.elements = []; noFacts.after.elements = [];
    assert.equal(judge!(noFacts), false);
  });
});
