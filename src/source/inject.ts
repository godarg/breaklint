/**
 * The provenance layer: source positions before the browser ever sees the document.
 *
 * A finding has to be able to say WHERE in the author's file the thing it found lives, and after
 * pagination that information is gone — the paginator splits blocks, clones nodes and discards
 * attributes it does not need. So the ids are put into the SOURCE TEXT, before parsing, and the
 * map from id to position is built from the parser's own position information rather than
 * reconstructed later.
 *
 * TWO ATTRIBUTES, both run-local, both covered by the paired control run in §10.5:
 *
 *   data-bl-sid          on every block element   — source attribution, survives the split
 *   data-bl-svg-target   on every <text> in SVG   — addressing for the isolation passes (§5.0)
 *
 * WHY THE TEXT AND NOT THE TREE. Serialising a parsed tree back to HTML would rewrite the whole
 * document — attribute quoting, entity spelling, whitespace in tags, the omitted `</p>` — and
 * every one of those is a change to the thing being measured. Splicing into the original string
 * changes exactly the bytes of the inserted attributes and nothing else.
 *
 * TWO PASSES, AND THE ORDER IS THE POINT. Ids are assigned in DOCUMENT order, then the splices are
 * applied BACK TO FRONT. Measured while prototyping this against the real parse5: deriving the id
 * from the splice index produced ids in reverse document order (`s0002` for the only block on the
 * page), and splicing front to back shifts every later offset by the length of everything inserted
 * before it — so the map would point into text that had moved. Neither of those throws. The map is
 * simply wrong, and every source line in every finding is wrong with it.
 */

import { parse, type DefaultTreeAdapterMap } from "parse5";

import type { SourceRef } from "../core/types.ts";

type Element = DefaultTreeAdapterMap["element"];
type Node = DefaultTreeAdapterMap["node"];

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * The elements that carry a source id.
 *
 * A findings tool is about blocks: a widow is lines of a paragraph, a half-empty page is bands of
 * block content. Inline elements are addressed through the block that contains them, which is also
 * what the fingerprint keys off (§10.2). Marking every element instead would multiply the marks in
 * the overlay by an order of magnitude for no gain in attribution.
 */
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  "address", "article", "aside", "blockquote", "caption", "dd", "details", "div", "dl", "dt",
  "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6",
  "header", "hgroup", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "summary", "table",
  "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);

export interface InjectionResult {
  /** The document text with the attributes spliced in. Byte-identical otherwise. */
  html: string;
  /** `sid` -> position in the ORIGINAL text. */
  map: Record<string, SourceRef>;
  /** How many `data-bl-sid` were placed. */
  blocks: number;
  /** How many `data-bl-svg-target` were placed. */
  svgTargets: number;
  /**
   * Elements the parser synthesised, which therefore have no source position. Counted rather than
   * silently skipped: `sid === null` for a node with no source is the contract's rule (§9,
   * invariant 5), and a count is the difference between "none were skipped" and "nobody looked".
   */
  synthesised: number;
}

interface Target {
  kind: "block" | "svg-text";
  tagName: string;
  startOffset: number;
  startLine: number;
  startCol: number;
  id: string;
}

function isElement(node: Node): node is Element {
  return typeof (node as Element).tagName === "string";
}

/**
 * Walk in document order and collect what gets an attribute.
 *
 * Synthesised elements — the `html`, `head` and `body` that parse5 inserts around a fragment —
 * carry no `sourceCodeLocation`. They are skipped on exactly that test rather than by tag name,
 * because a document that DOES write `<body>` gets a real location for it and should be treated
 * like any other element.
 */
function collect(document: Node): { targets: Target[]; synthesised: number } {
  const targets: Target[] = [];
  let synthesised = 0;

  const walk = (node: Node): void => {
    if (isElement(node)) {
      const loc = node.sourceCodeLocation;
      if (!loc) {
        synthesised += 1;
      } else {
        const svg = node.namespaceURI === SVG_NS;
        const kind: Target["kind"] | null = svg
          ? node.tagName === "text"
            ? "svg-text"
            : null
          : BLOCK_TAGS.has(node.tagName)
            ? "block"
            : null;
        if (kind !== null) {
          targets.push({
            kind,
            tagName: node.tagName,
            startOffset: loc.startOffset,
            startLine: loc.startLine,
            startCol: loc.startCol,
            id: "",
          });
        }
      }
    }
    for (const child of (node as { childNodes?: Node[] }).childNodes ?? []) walk(child);
  };

  walk(document);
  return { targets, synthesised };
}

export function injectSourceIds(html: string, file: string): InjectionResult {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const { targets, synthesised } = collect(document);

  // Pass 1: ids in DOCUMENT order. An id is a property of where the element is, never of the
  // order in which a later loop happens to reach it.
  let blocks = 0;
  let svgTargets = 0;
  for (const target of targets) {
    target.id =
      target.kind === "block"
        ? `s${String(blocks++).padStart(4, "0")}`
        : `bt${String(svgTargets++).padStart(3, "0")}`;
  }

  // Pass 2: splice BACK TO FRONT, so no insertion moves an offset that a later insertion needs.
  const map: Record<string, SourceRef> = {};
  let out = html;
  const byPosition = [...targets].sort((a, b) => b.startOffset - a.startOffset);
  for (const target of byPosition) {
    // Immediately after the tag name. Measured against the real parser over uppercase tags, void
    // elements, self-closing syntax, SVG foreign content and an attribute value containing `>`:
    // this lands correctly in every case, because `startOffset` is the `<` and the tag name has
    // the same LENGTH in the source as in the parser's lower-cased `tagName`.
    const at = target.startOffset + 1 + target.tagName.length;
    const attribute =
      target.kind === "block" ? `data-bl-sid="${target.id}"` : `data-bl-svg-target="${target.id}"`;
    if (target.kind === "block") {
      map[target.id] = {
        file,
        line: target.startLine,
        column: target.startCol,
        offset: target.startOffset,
      };
    }
    out = `${out.slice(0, at)} ${attribute}${out.slice(at)}`;
  }

  return { html: out, map, blocks, svgTargets, synthesised };
}
