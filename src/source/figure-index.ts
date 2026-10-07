/** Authored semantic relations. No browser, guessed numbering, or paginated DOM identity. */
import { parseFragment, serializeOuter, type DefaultTreeAdapterMap } from "parse5";
import { sha256 } from "../core/fingerprint.ts";
import type { FigureIndex } from "../core/types.ts";
type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
const element = (node: Node): node is Element => "tagName" in node;
const attrs = (node: Element) => Object.fromEntries(node.attrs.map(a => [a.name, a.value]));
const text = (node: Node): string => "value" in node ? node.value : ("childNodes" in node ? node.childNodes.map(text).join("") : "");
export function figureBodyIdentity(tag: string, authorId: string | null, value: string): string {
  // Paged.js 0.4.3 Breaks.processBreaks writes this field onto the SVG immediately
  // before a forced caption break. Source inventory refuses authored ownership of it.
  // Keep every authored class/style/drawing/content field in the identity.
  if (tag !== "svg") return JSON.stringify([authorId, value]);
  // Paged.js 0.4.3 Parser removes comments/formatting nodes and adds data-id from id.
  // Normalise only these proven transformations. Preserve drawing/style and meaningful
  // SVG text whitespace; source-owned data-id values are never discarded or overwritten.
  const fragment = parseFragment(value);
  const clean = (node: Node, textContext = false): void => {
    if (element(node)) {
      const a = attrs(node);
      if (a.id && a["data-id"] === undefined) node.attrs.push({ name: "data-id", value: a.id });
      node.attrs = node.attrs.filter(a => a.name !== "data-next-break-before"
        && a.name !== "data-ref" && !a.name.startsWith("data-bl-"))
        .sort((left, right) => left.name.localeCompare(right.name));
      textContext ||= ["text", "tspan", "textPath", "style", "title", "desc"].includes(node.tagName)
        || a["xml:space"] === "preserve";
    }
    if ("childNodes" in node) {
      node.childNodes = node.childNodes.filter(child => child.nodeName !== "#comment"
        && !(!textContext && "value" in child && child.value.trim() === ""));
      for (const child of node.childNodes) clean(child, textContext);
    }
  };
  clean(fragment);
  const root = fragment.childNodes.find(node => element(node) && node.tagName === "svg");
  // Body equality is a source witness, not a finding fingerprint. Do not use the
  // fingerprint canonicaliser here: it collapses meaningful SVG text whitespace.
  return `svgbody:${sha256(root ? serializeOuter(root as Element) : value)}`;
}
export function buildFigureIndex(document: Node): FigureIndex {
  const index: FigureIndex = { complete: true, ids: Object.create(null) as Record<string, number>, namedAnchors: Object.create(null) as Record<string, number>, figures: [], referenceBlocks: [] };
  const referenceBlocks = new Map<string, FigureIndex["referenceBlocks"][number]>();
  const walk = (node: Node, blockSid: string | null, figure: FigureIndex["figures"][number] | null, inCaption: boolean, insideSvg = false): void => {
    if (!element(node)) {
      for (const child of "childNodes" in node ? node.childNodes : []) walk(child, blockSid, figure, inCaption, insideSvg);
      return;
    }
    const a = attrs(node); const sid = a["data-bl-sid"] ?? blockSid;
    if (a.id) index.ids[a.id] = (index.ids[a.id] ?? 0) + 1;
    if (node.tagName === "a" && a.name) index.namedAnchors![a.name] = (index.namedAnchors![a.name] ?? 0) + 1;
    // Script-mutated membership and base-URI semantics are outside this authored-only inventory.
    if (node.tagName === "script" || node.tagName === "base" || Object.hasOwn(a, "data-next-break-before")
      || Object.hasOwn(a, "data-ref") || Object.keys(a).some(k => /^on[a-z]/u.test(k))) index.complete = false;
    let current = figure; let caption = inCaption;
    if (node.tagName === "figure") {
      if (!a["data-bl-sid"]) index.complete = false;
      current = { sid: a["data-bl-sid"] ?? "", captionSids: [], body: null, bodyFragments: [], captionPosition: null };
      index.figures.push(current); caption = false;
    }
    if (node.tagName === "figcaption") {
      caption = true;
      if (current) {
        if (!a["data-bl-sid"]) index.complete = false;
        else current.captionSids.push(a["data-bl-sid"]);
        current.captionPosition = (bodyCounts.get(current) ?? 0) === 0 ? "before" : "after";
      }
    }
    if (current && !caption && !insideSvg && ["img", "svg", "table"].includes(node.tagName)) {
      const body = node.tagName === "table"
        ? { tag: "table" as const, identity: `table:${a["data-bl-sid"] ?? ""}`, tableSid: a["data-bl-sid"] ?? "" }
        : { tag: node.tagName as "img" | "svg", identity: figureBodyIdentity(node.tagName, a.id ?? null, node.tagName === "svg" ? serializeOuter(node) : a.src ?? "") };
      // Count separately below: a second body must not overwrite the first and look supported.
      const count = bodyCounts.get(current) ?? 0; bodyCounts.set(current, count + 1);
      current.body = count === 0 ? body : null;
    }
    if (node.tagName === "a" && a.href?.startsWith("#") && /\b(?:figure|fig\.?|abbildung|abb\.?|table|tbl\.?|tabelle|tab\.?)\s+\d/iu.test(text(node))) {
      if (!sid) index.complete = false;
      else {
        let targetId: string | null = null;
        try { targetId = decodeURIComponent(a.href.slice(1)) || null; } catch { /* explicitly unmeasurable */ }
        const group = referenceBlocks.get(sid) ?? { sid, references: [] };
        group.references.push({ href: a.href, targetId }); referenceBlocks.set(sid, group);
      }
    }
    // A nested SVG is part of its root, not another authored figure body.
    for (const child of node.childNodes) {
      walk(child, sid, current, caption, insideSvg || node.tagName === "svg");
    }
  };
  const bodyCounts = new Map<FigureIndex["figures"][number], number>();
  walk(document, null, null, false);
  for (const figure of index.figures) if (bodyCounts.get(figure) !== 1) figure.body = null;
  index.referenceBlocks = [...referenceBlocks.values()];
  return index;
}
