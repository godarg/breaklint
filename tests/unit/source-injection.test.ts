/**
 * The provenance layer, checked against the parser rather than against a description of it.
 *
 * The oracle question for this file: where does the truth come from? Not from `injectSourceIds` —
 * every assertion below is made against parse5 run a SECOND time over the INJECTED text, or
 * against the original string by index. The map is checked by slicing the original document at the
 * offset the map reports and looking at what is there. If the injector and the map agreed with
 * each other and both were wrong, these would still fail.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { parse, type DefaultTreeAdapterMap } from "parse5";

import { injectSourceIds } from "../../src/source/inject.ts";
import { collisionDetail, detectCollision, RESERVED_PREFIX } from "../../src/source/collision.ts";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
const SVG_NS = "http://www.w3.org/2000/svg";

/** Re-parse the injected text and report where each attribute actually landed. */
function placed(html: string): { sids: string[]; svgTargets: string[]; misplaced: string[] } {
  const sids: string[] = [];
  const svgTargets: string[] = [];
  const misplaced: string[] = [];
  const walk = (node: Node): void => {
    const el = node as Element;
    if (typeof el.tagName === "string") {
      for (const attr of el.attrs ?? []) {
        if (attr.name === "data-bl-sid") {
          sids.push(attr.value);
          if (el.namespaceURI === SVG_NS) misplaced.push(`sid on an SVG element <${el.tagName}>`);
        }
        if (attr.name === "data-bl-svg-target") {
          svgTargets.push(attr.value);
          if (el.namespaceURI !== SVG_NS || el.tagName !== "text") {
            misplaced.push(`svg target on <${el.tagName}> in ${el.namespaceURI}`);
          }
        }
      }
    }
    for (const child of (node as { childNodes?: Node[] }).childNodes ?? []) walk(child);
  };
  walk(parse(html, { sourceCodeLocationInfo: true }));
  return { sids, svgTargets, misplaced };
}

describe("source id injection", () => {
  /**
   * The shapes that broke the prototype or looked likely to.
   *
   * Uppercase tags matter because parse5 lower-cases `tagName` while the source keeps the author's
   * spelling — the splice point is computed from the LENGTH, which is why it survives. Void and
   * self-closing elements matter because there is no end tag to confuse the offset. The attribute
   * containing `>` matters because a naive "insert before the first `>`" would land inside the
   * attribute value and produce a document that still parses, differently.
   */
  const documents: Record<string, string> = {
    "full document": `<!doctype html><html><body><p>a</p><div><p>b</p></div></body></html>`,
    "fragment without html or body": `<p>only a paragraph</p>\n<div><p>and one nested</p></div>`,
    "uppercase, void and self-closing": `<P>A</P><IMG src=x><BR/><p>b</p>`,
    "svg with nested text": `<p>x</p><svg><text>one</text><g><text>two</text></g></svg>`,
    "attribute value containing a greater-than": `<p title="a > b">tricky</p>`,
    "block with existing attributes": `<div class="lead" id="top"><p data-x="1">c</p></div>`,
  };

  for (const [name, html] of Object.entries(documents)) {
    it(`places every attribute on the right element: ${name}`, () => {
      const result = injectSourceIds(html, "doc.html");
      const actual = placed(result.html);
      assert.deepEqual(actual.misplaced, [], `attributes landed on the wrong elements: ${name}`);
      assert.equal(actual.sids.length, result.blocks, "reported block count must match the document");
      assert.equal(actual.svgTargets.length, result.svgTargets, "reported svg count must match");
      // Not vacuous: something was injected. A document where nothing matched would pass every
      // assertion above while proving nothing.
      assert.ok(result.blocks + result.svgTargets > 0, "nothing was injected — the case is vacuous");
    });
  }

  /**
   * Ids ascend in document order, per kind.
   *
   * The prototype derived the id from the splice index, which runs BACK to front, and produced
   * `s0002` for the only block in a document and `bt001` before `bt000`. Nothing threw; the ids
   * were simply in the wrong order, and every reference to them was consistent with itself.
   *
   * Red condition: assign ids during the back-to-front splice and both sequences reverse.
   */
  it("ids ascend in document order within each kind", () => {
    const html = `<p>x</p>\n<svg><text>one</text><g><text>two</text></g></svg>\n<div><p>b</p></div>`;
    const { html: injected } = injectSourceIds(html, "doc.html");
    const order = [...injected.matchAll(/data-bl-(?:sid|svg-target)="([^"]+)"/gu)].map((m) => m[1]!);
    const sids = order.filter((id) => id.startsWith("s"));
    const targets = order.filter((id) => id.startsWith("bt"));
    assert.deepEqual(sids, ["s0000", "s0001", "s0002"], "block ids out of document order");
    assert.deepEqual(targets, ["bt000", "bt001"], "svg target ids out of document order");
  });

  /**
   * The map points into the ORIGINAL text, and it is checked by looking there.
   *
   * This is the assertion the whole layer exists for: a finding says `chapter.html:120`, and if the
   * offset drifted by the length of the attributes inserted before it, that line number is wrong
   * and nothing anywhere would say so.
   *
   * Red condition: splice front to back instead of back to front, and every offset after the first
   * insertion is off by the accumulated length.
   */
  it("every mapped position resolves to the element it claims, in the original text", () => {
    const html = [
      "<!doctype html>",
      "<html><body>",
      '  <p class="first">one</p>',
      "  <div>",
      "    <p>two</p>",
      "  </div>",
      "  <blockquote>three</blockquote>",
      "</body></html>",
    ].join("\n");
    const { map, blocks } = injectSourceIds(html, "chapter.html");
    assert.equal(Object.keys(map).length, blocks, "every block must have a map entry");
    assert.ok(blocks >= 4, `expected at least four blocks, got ${blocks}`);

    const lines = html.split("\n");
    for (const [sid, ref] of Object.entries(map)) {
      assert.equal(ref.file, "chapter.html");
      // The offset must land on a `<`, and the tag that follows must be a block tag.
      assert.equal(html[ref.offset], "<", `${sid}: offset ${ref.offset} is not a tag start`);
      // The line and column must agree with the offset. Two representations of one position that
      // are computed separately: if either drifts, they stop matching.
      const line = lines[ref.line - 1] ?? "";
      assert.equal(
        line.slice(ref.column - 1, ref.column - 1 + 1),
        "<",
        `${sid}: line ${ref.line} column ${ref.column} is not where the tag is`,
      );
      assert.equal(
        html.slice(0, ref.offset).split("\n").length,
        ref.line,
        `${sid}: offset and line disagree`,
      );
    }
  });

  /**
   * Elements the parser synthesised get no id, and the count says how many there were.
   *
   * A synthesised `<body>` has no source position, and inventing one would put a finding at a line
   * the author never wrote. §9 invariant 5 says a node the paginator produced has `source: null`,
   * never a guess; the same holds for a node the PARSER produced.
   */
  it("synthesised elements are skipped and counted rather than silently dropped", () => {
    const fragment = injectSourceIds(`<p>a</p>`, "doc.html");
    assert.ok(fragment.synthesised >= 3, `html, head and body should be synthesised, got ${fragment.synthesised}`);
    const full = injectSourceIds(`<!doctype html><html><head></head><body><p>a</p></body></html>`, "doc.html");
    assert.equal(full.synthesised, 0, "a document that writes its own structure synthesises nothing");
    // And the same block count either way — the structure elements are not blocks.
    assert.equal(fragment.blocks, full.blocks);
  });

  /** Everything outside the inserted attributes is byte-identical. */
  it("injection changes nothing but the attributes it inserts", () => {
    const html = `<!doctype html>\n<p title="a > b">x &amp; y</p>\n<!-- a comment -->\n`;
    const { html: injected } = injectSourceIds(html, "doc.html");
    const stripped = injected.replaceAll(/ data-bl-(?:sid|svg-target)="[^"]*"/gu, "");
    assert.equal(stripped, html, "the document changed beyond the injected attributes");
  });
});

describe("the reserved-prefix collision gate", () => {
  const sourcesFor = (html: string, sheets: Record<string, string> = {}) => [
    { origin: "document", text: html },
    ...Object.entries(sheets).map(([origin, text]) => ({ origin, text })),
  ];

  it("passes a document that does not use the prefix", () => {
    const result = detectCollision(sourcesFor(`<p class="data-blob">not a collision</p>`));
    assert.equal(result.collided, false);
    assert.deepEqual(result.occurrences, []);
    // The scope is reported even on a pass. A verdict that does not say what it searched cannot be
    // told from a verdict nobody computed.
    assert.deepEqual(result.scanned, ["document"]);
    assert.ok(result.unreachable.length > 0, "the known gap must always be stated");
  });

  /**
   * The four shapes §10.5 names, plus the one an audit added.
   *
   * Red condition: each of these must refuse. A gate that catches the attribute but not the
   * selector would let through exactly the document the measured risk table (§10.5) shows changing
   * its style signature.
   */
  const collisions: Record<string, { html: string; sheets?: Record<string, string> }> = {
    "author attribute": { html: `<p data-bl-sid="mine">x</p>` },
    "attribute selector in an inline style": { html: `<style>p[data-bl-sid] { color: red }</style><p>x</p>` },
    "content: attr() in an inline style": { html: `<style>p::after { content: attr(data-bl-sid) }</style><p>x</p>` },
    "a script that reads it": { html: `<script>document.querySelector("[data-bl-sid]")</script><p>x</p>` },
    "a linked stylesheet the loader read": {
      html: `<link rel="stylesheet" href="a.css"><p>x</p>`,
      sheets: { "a.css": `p[data-bl-svg-target] { outline: 1px solid red }` },
    },
    "an @import chain the loader followed": {
      html: `<link rel="stylesheet" href="a.css"><p>x</p>`,
      sheets: { "a.css": `@import "b.css";`, "b.css": `[data-bl-sid] { display: none }` },
    },
  };

  for (const [name, { html, sheets }] of Object.entries(collisions)) {
    it(`refuses: ${name}`, () => {
      const result = detectCollision(sourcesFor(html, sheets));
      assert.equal(result.collided, true, `not caught: ${name}`);
      assert.ok(result.occurrences.length > 0);
      const detail = collisionDetail(result);
      assert.match(detail, /source-id|reserved prefix/iu);
      assert.ok(detail.includes(RESERVED_PREFIX), "the message must name the prefix it found");
      // and it must name WHERE, or a false refusal is undiagnosable
      assert.ok(
        result.occurrences.every((o) => o.line >= 1 && o.column >= 1),
        "every occurrence needs a position",
      );
    });
  }

  /**
   * The gate runs on the ORIGINAL text.
   *
   * Run after injection it would refuse every document in existence, because the injected
   * attributes are themselves occurrences. That is not a hypothetical ordering mistake; it is the
   * single way this function can be misused, so it is pinned.
   */
  it("the injected text itself would collide — which is why the gate runs before injection", () => {
    const html = `<p>x</p>`;
    assert.equal(detectCollision(sourcesFor(html)).collided, false);
    const { html: injected } = injectSourceIds(html, "doc.html");
    assert.equal(
      detectCollision(sourcesFor(injected)).collided,
      true,
      "if this were false the ordering would not matter and this gate would be untestable",
    );
  });

  /** The message names the number found, not just the first one. */
  it("the refusal reports the count and caps the listing", () => {
    const many = Array.from({ length: 9 }, (_, i) => `<p data-bl-sid="x${i}">y</p>`).join("\n");
    const result = detectCollision(sourcesFor(many));
    assert.equal(result.occurrences.length, 9);
    const detail = collisionDetail(result);
    assert.match(detail, /found 9 occurrences/u);
    assert.match(detail, /… and 4 more/u, "a long list must be capped, with the remainder counted");
    assert.match(detail, /not searched:/u, "the message must carry the known gap");
  });
});
