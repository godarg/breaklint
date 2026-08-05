/**
 * The boundary classifier, and the reconciliation that feeds it.
 *
 * The oracle question: where does the truth come from? Not from the classifier — every case below
 * states its facts as literals taken from what Paged.js 0.4.3 was MEASURED to write, and asserts
 * the classification those facts must produce. The measurements are named in each case so a reader
 * can check the premise rather than the conclusion.
 *
 * The live suite runs the same shapes through a real paginator. Neither replaces the other: the
 * live suite proves the attributes appear, this file proves the branches are wired.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  assignPageCauses,
  BREAK_ATTRIBUTES,
  classifyBoundary,
  documentEnd,
  documentStart,
  FORCING_BREAK_VALUES,
  isForcingValue,
  type BoundaryFacts,
} from "../../src/paginate/breaks.ts";
import { boundaryFactsFrom, silentHooks, REQUIRED_HOOKS, type CollectedPage } from "../../src/paginate/collector.ts";

function facts(overrides: Partial<BoundaryFacts> = {}): BoundaryFacts {
  return {
    nextPageBlank: false,
    breakBefore: null,
    previousBreakAfter: null,
    pageBefore: null,
    pageAfter: null,
    hasBreakToken: false,
    sidBefore: "s0001",
    sidAfter: "s0002",
    cascadeHint: null,
    ...overrides,
  };
}

describe("the forcing values", () => {
  /**
   * The six values `shouldBreak()` treats as forcing, as a LITERAL.
   *
   * Not derived from the production set — that is the oracle mistake that survived a 153-test
   * battery in this repo. If the set changes, this line is where it shows.
   */
  it("are exactly the six the paginator acts on", () => {
    assert.deepEqual(
      [...FORCING_BREAK_VALUES].sort(),
      ["always", "left", "page", "recto", "right", "verso"],
      "the forcing set changed; that decides which boundaries silence four layout rules",
    );
  });

  it("ignores the values that do not break", () => {
    for (const value of ["auto", "avoid", "avoid-page", "", "column", "unset"]) {
      assert.equal(isForcingValue(value), false, `${value} must not be treated as forcing`);
    }
    for (const value of FORCING_BREAK_VALUES) assert.equal(isForcingValue(value), true);
    assert.equal(isForcingValue(null), false);
    assert.equal(isForcingValue(undefined), false);
  });

  /**
   * The comparison is EXACT, and the previous version of this test asserted the opposite.
   *
   * It said `isForcingValue(" Page ") === true`, with a comment reasoning that the attribute comes
   * from a third party and should be normalised. That reasoning is backwards — the attribute is
   * written by the PAGINATOR, which compares its dataset value exactly — and the test pinned the
   * wrong answer as correct, which is worse than having no test.
   *
   * Measured: an author-written `data-break-before=" Page "` produced NO break in Paged.js 0.4.3;
   * the paragraph stayed on its page. A normalising classifier would have called such a boundary
   * forced and silenced four rules on it.
   *
   * Red condition: restore `trim().toLowerCase()` and every variant below turns true.
   */
  it("does not normalise: a value the paginator would not act on is not forcing", () => {
    for (const value of [" page", "page ", " page ", "Page", "PAGE", "\tpage", "page\n", "recto "]) {
      assert.equal(
        isForcingValue(value),
        false,
        `${JSON.stringify(value)} was treated as forcing; the paginator compares exactly and did not break on it`,
      );
    }
  });

  it("names the three attributes the paginator writes and this code reads", () => {
    assert.deepEqual(BREAK_ATTRIBUTES, {
      before: "data-break-before",
      previousAfter: "data-previous-break-after",
      page: "data-page",
    });
  });
});

describe("classifying one boundary", () => {
  /**
   * Measured: a stylesheet CLASS or ID `break-before` puts `data-break-before="page"` on the node
   * the break happens in front of.
   */
  it("a break-before attribute is forced, and names the node after the boundary", () => {
    const result = classifyBoundary(facts({ breakBefore: "page", sidAfter: "s0007" }));
    assert.equal(result.kind, "forced");
    assert.equal(result.determinedBy, "pagedjs-break-attributes");
    assert.equal(result.reason, "break-before@s0007");
  });

  /**
   * Measured: a stylesheet `break-after` puts `data-previous-break-after="page"` on the node AFTER
   * the boundary — while the DECLARATION sits on the node before it. The reason names the
   * declaring node, because that is the element the author wrote `break-after` on.
   */
  it("a previous-break-after attribute is forced, and names the node BEFORE the boundary", () => {
    const result = classifyBoundary(facts({ previousBreakAfter: "page", sidBefore: "s0004", sidAfter: "s0005" }));
    assert.equal(result.kind, "forced");
    assert.equal(result.reason, "break-after@s0004", "the reason must point at the declaring element");
  });

  /**
   * The third branch of `shouldBreak()`, and the one a partial implementation misses.
   *
   * Measured on a real boundary: a `page: named` region produced `data-page="named"` and NO break
   * attribute of any kind. A reader that knows only `data-break-before` and
   * `data-previous-break-after` calls this boundary free — and a free boundary in front of a
   * deliberately started page is exactly the `layout/half-empty-page` false alarm the contract
   * says the whole `forced` classification exists to prevent.
   *
   * Red condition: delete the page-change branch and this case, plus its live counterpart, fail.
   */
  it("a change of named page is forced even with no break attribute anywhere", () => {
    const result = classifyBoundary(facts({ pageBefore: null, pageAfter: "named", sidAfter: "s0011" }));
    assert.equal(result.kind, "forced", "the data-page branch is missing");
    assert.equal(result.reason, "page@s0011");
    // and the reverse direction: leaving a named page back to the default is also a change
    assert.equal(classifyBoundary(facts({ pageBefore: "named", pageAfter: null })).kind, "forced");
    // and the same named page on both sides is NOT a boundary cause
    assert.equal(classifyBoundary(facts({ pageBefore: "named", pageAfter: "named", hasBreakToken: true })).kind, "overflow");
  });

  it("a break token with no forcing attribute is overflow", () => {
    const result = classifyBoundary(facts({ hasBreakToken: true }));
    assert.equal(result.kind, "overflow");
    assert.equal(result.determinedBy, "break-token");
  });

  it("nothing at all is unknown, and unknown is determined-by-undetermined", () => {
    const result = classifyBoundary(facts());
    assert.equal(result.kind, "unknown");
    assert.equal(result.determinedBy, "undetermined");
  });

  /**
   * A blank page is `parity` BEFORE anything else is asked.
   *
   * Measured: `break-before: recto` inserted a genuinely blank page. That page has no first node,
   * so asking the attribute questions first would read whatever happened to be nearby — and
   * getting a `forced` out of it would silence four rules on a page that has no content to judge.
   */
  it("a blank next page is parity, and outranks every other signal", () => {
    const result = classifyBoundary(
      facts({ nextPageBlank: true, breakBefore: "page", previousBreakAfter: "page", hasBreakToken: true }),
    );
    assert.equal(result.kind, "parity");
    assert.equal(result.determinedBy, "page-blank");
  });

  /**
   * `forced` outranks `overflow` — L-33, and it is the correct attribution rather than an
   * arbitrary tie-break: `shouldBreak()` is consulted before the overflow check inside the
   * paginator, so a node that would ALSO have overflowed is still forced.
   */
  it("a forcing attribute outranks a break token", () => {
    assert.equal(classifyBoundary(facts({ breakBefore: "page", hasBreakToken: true })).kind, "forced");
  });

  /** The hint is carried, never consulted. §11.6a: a hint may stand beside a decision, never make it. */
  it("the cascade hint changes no decision", () => {
    for (const hint of ["stylesheet", "inline", "none", null] as const) {
      const result = classifyBoundary(facts({ hasBreakToken: true, cascadeHint: hint }));
      assert.equal(result.kind, "overflow", `the hint ${hint} changed the decision`);
      assert.equal(result.cascadeHint, hint, "the hint must still be carried through");
    }
  });
});

describe("assigning causes to pages", () => {
  /**
   * `pages[i].incoming === pages[i-1].outgoing` — by IDENTITY, not by agreement.
   *
   * The invariant breaks when two independent computations agree by construction until one of them
   * changes. Classifying once and placing the same object on both sides makes that impossible
   * rather than merely unlikely, and a fixture that broke this exact invariant has already been
   * found in this repo's corpus.
   */
  it("a boundary is the same object on both sides of it", () => {
    const causes = assignPageCauses(3, [facts({ breakBefore: "page" }), facts({ hasBreakToken: true })]);
    assert.equal(causes.length, 3);
    assert.equal(causes[0]!.outgoing, causes[1]!.incoming, "same object, not merely equal");
    assert.equal(causes[1]!.outgoing, causes[2]!.incoming);
  });

  it("the first page starts and the last page ends, never null", () => {
    const causes = assignPageCauses(2, [facts({ hasBreakToken: true })]);
    assert.deepEqual(causes[0]!.incoming, documentStart());
    assert.deepEqual(causes[1]!.outgoing, documentEnd());
    assert.equal(causes[0]!.incoming.kind, "document-start");
    assert.equal(causes[1]!.outgoing.kind, "document-end");
  });

  /**
   * §11.6 binds BOTH sides of a blank page to `parity`, and the four-branch algorithm alone does
   * not deliver that.
   *
   * The algorithm asks only whether the NEXT page is blank, so with `break-before: recto` the
   * boundary INTO the inserted blank page came out `parity` and the boundary OUT of it read the
   * recto node's forcing attribute and came out `forced`. Two statements in the same contract
   * section disagreed; the explicit invariant wins, because it is the one a rule reads.
   *
   * Red condition: drop the blank-page pass in `assignPageCauses` and the outgoing side reverts to
   * `forced`.
   */
  it("a blank page is parity on BOTH sides, not just the one the algorithm asks about", () => {
    // page 0 content, page 1 blank, page 2 forced by the recto declaration that created the blank
    const causes = assignPageCauses(
      3,
      [facts({ nextPageBlank: true }), facts({ breakBefore: "recto", sidAfter: "s0009" })],
      [false, true, false],
    );
    assert.equal(causes[1]!.incoming.kind, "parity", "the boundary INTO a blank page");
    assert.equal(causes[1]!.outgoing.kind, "parity", "the boundary OUT of a blank page");
    assert.equal(causes[1]!.outgoing.determinedBy, "page-blank");
    // and the identity invariant must survive the substitution
    assert.equal(causes[1]!.outgoing, causes[2]!.incoming, "the shared boundary object was split");
    assert.equal(causes[0]!.outgoing, causes[1]!.incoming);
  });

  it("a non-blank page keeps the classified cause on both sides", () => {
    const causes = assignPageCauses(3, [facts({ breakBefore: "page" }), facts({ hasBreakToken: true })], [false, false, false]);
    assert.equal(causes[0]!.outgoing.kind, "forced");
    assert.equal(causes[1]!.outgoing.kind, "overflow");
  });

  it("a single-page document is start and end with no boundary", () => {
    const causes = assignPageCauses(1, []);
    assert.equal(causes.length, 1);
    assert.equal(causes[0]!.incoming.kind, "document-start");
    assert.equal(causes[0]!.outgoing.kind, "document-end");
  });

  /** A miscount is a build error, not something to paper over with a default. */
  it("refuses a boundary count that does not match the page count", () => {
    assert.throws(() => assignPageCauses(3, [facts()]), /3 pages need exactly 2 boundaries, got 1/u);
    assert.throws(() => assignPageCauses(2, [facts(), facts()]), /got 2/u);
  });
});

describe("turning collected pages into boundary facts", () => {
  const page = (over: Partial<CollectedPage> = {}): CollectedPage => ({
    index: 0,
    reconciled: true,
    hasBreakToken: false,
    attributesAtLayout: { breakBefore: null, previousBreakAfter: null, page: null },
    attributesAfterRender: { breakBefore: null, previousBreakAfter: null, page: null },
    firstSid: "s0000",
    lastSid: "s0001",
    lastNodePage: null,
    blank: false,
    epoch: 0,
    ...over,
  });

  /**
   * The off-by-one that would classify every document plausibly and wrongly.
   *
   * Boundary `i` reads the NEXT page's attributes with the PREVIOUS page's token. Swapping those
   * produces sensible-looking output on every document and correct output on none, which is why it
   * gets its own case rather than being trusted to the shape of the loop.
   */
  it("takes the token from the page before and the attributes from the page after", () => {
    const pages = [
      page({ index: 0, hasBreakToken: true, lastSid: "s0009" }),
      page({
        index: 1,
        hasBreakToken: false,
        firstSid: "s0010",
        attributesAfterRender: { breakBefore: "page", previousBreakAfter: null, page: null },
      }),
    ];
    const [boundary] = boundaryFactsFrom(pages);
    assert.equal(boundary!.hasBreakToken, true, "the token belongs to the page BEFORE the boundary");
    assert.equal(boundary!.breakBefore, "page", "the attributes belong to the page AFTER it");
    assert.equal(boundary!.sidBefore, "s0009");
    assert.equal(boundary!.sidAfter, "s0010");
  });

  it("produces exactly one boundary fewer than there are pages", () => {
    assert.equal(boundaryFactsFrom([page(), page(), page()]).length, 2);
    assert.equal(boundaryFactsFrom([page()]).length, 0);
    assert.equal(boundaryFactsFrom([]).length, 0);
  });

  it("compares data-page across the boundary, not within a page", () => {
    const pages = [
      page({ lastNodePage: "named" }),
      page({ attributesAfterRender: { breakBefore: null, previousBreakAfter: null, page: null } }),
    ];
    const [boundary] = boundaryFactsFrom(pages);
    assert.equal(boundary!.pageBefore, "named");
    assert.equal(boundary!.pageAfter, null);
    assert.equal(classifyBoundary({ ...boundary! }).kind, "forced");
  });

  /**
   * A page the paginator never reported is not a page with default values.
   *
   * The collector used to hand such a page a fabricated record — no token, no attributes, epoch 0
   * — and count it nowhere. A page inserted after `afterRendered` therefore got classified from
   * whatever attributes sat on it, exactly as if the paginator had reported it, and a per-page hook
   * loss looked identical to a healthy run because the GLOBAL hook count was still non-zero.
   *
   * Red condition: stop stripping the signals for an unreconciled pair and the boundary below
   * becomes `forced`.
   */
  it("a boundary touching an unreported page is unknown, not inferred from its attributes", () => {
    const pages = [
      page({ index: 0, hasBreakToken: true }),
      page({
        index: 1,
        reconciled: false,
        attributesAfterRender: { breakBefore: "page", previousBreakAfter: null, page: null },
      }),
    ];
    const [boundary] = boundaryFactsFrom(pages);
    assert.equal(boundary!.breakBefore, null, "an unreported page's attributes must not be read");
    assert.equal(boundary!.hasBreakToken, false);
    assert.equal(classifyBoundary(boundary!).kind, "unknown");

    // The same pair, both reported, must classify normally — otherwise the case above would pass
    // for a classifier that answered `unknown` to everything.
    const healthy = boundaryFactsFrom([pages[0]!, { ...pages[1]!, reconciled: true }]);
    assert.equal(classifyBoundary(healthy[0]!).kind, "forced");
  });

  it("attaches the cascade hint of the node after the boundary, by source id", () => {
    const pages = [page(), page({ firstSid: "s0042" })];
    const [boundary] = boundaryFactsFrom(pages, { s0042: "inline" });
    assert.equal(boundary!.cascadeHint, "inline");
    assert.equal(boundaryFactsFrom(pages, {})[0]!.cascadeHint, null, "an absent hint is null, not undefined");
  });
});

describe("the hook-fired check", () => {
  /**
   * Paged.js wires handlers by bare method-name equality: a typo is a silent no-op. The
   * consequence of a silent no-op in `afterPageLayout` is a document with no break tokens, every
   * boundary `unknown`, and a report that looks clean. The contract makes this a build
   * requirement rather than diagnostics, and a browser cannot be asked to skip a hook.
   */
  it("names every hook that never fired", () => {
    const allFired = Object.fromEntries(REQUIRED_HOOKS.map((h) => [h, 3]));
    assert.deepEqual(silentHooks(allFired), []);

    for (const missing of REQUIRED_HOOKS) {
      const hooks = { ...allFired, [missing]: 0 };
      assert.deepEqual(silentHooks(hooks), [missing], `a silent ${missing} was not reported`);
    }
  });

  it("a hook absent from the record counts as silent, exactly like one that fired zero times", () => {
    assert.deepEqual(silentHooks({}), [...REQUIRED_HOOKS]);
    assert.deepEqual(silentHooks({ layoutNode: 1 }), REQUIRED_HOOKS.filter((h) => h !== "layoutNode"));
  });

  it("the required set is the five hooks this collector registers", () => {
    assert.deepEqual(
      [...REQUIRED_HOOKS],
      ["beforePageLayout", "layoutNode", "renderNode", "afterPageLayout", "afterRendered"],
      "registering a hook without requiring it makes a silent no-op invisible again",
    );
  });
});
