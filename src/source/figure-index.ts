/** Authored semantic relations. No browser, guessed numbering, or paginated DOM identity. */
import { serializeOuter, type DefaultTreeAdapterMap } from "parse5";
import { svgRootKey } from "../core/fingerprint.ts";
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
  return tag === "svg" ? svgRootKey({ authorId: null, outerHtml: value.replace(/\sdata-next-break-before="[^"]*"/gu, "") }) : JSON.stringify([authorId, value]);
}
export function buildFigureIndex(document: Node): FigureIndex {
  const index: FigureIndex = { complete: true, ids: Object.create(null) as Record<string, number>, figures: [], referenceBlocks: [] };
  const referenceBlocks = new Map<string, FigureIndex["referenceBlocks"][number]>();
  const walk = (node: Node, blockSid: string | null, figure: FigureIndex["figures"][number] | null, inCaption: boolean, insideSvg = false): void => {
    if (!element(node)) {
      for (const child of "childNodes" in node ? node.childNodes : []) walk(child, blockSid, figure, inCaption, insideSvg);
      return;
    }
    const a = attrs(node); const sid = a["data-bl-sid"] ?? blockSid;
    if (a.id) index.ids[a.id] = (index.ids[a.id] ?? 0) + 1;
    // Script-mutated membership and base-URI semantics are outside this authored-only inventory.
    if (node.tagName === "script" || node.tagName === "base" || Object.hasOwn(a, "data-next-break-before") || Object.keys(a).some(k => /^on[a-z]/u.test(k))) index.complete = false;
    let current = figure; let caption = inCaption;
    if (node.tagName === "figure") {
      if (!a["data-bl-sid"]) index.complete = false;
      current = { sid: a["data-bl-sid"] ?? "", captionSids: [], body: null, bodyFragments: [] };
      index.figures.push(current); caption = false;
    }
    if (node.tagName === "figcaption") {
      caption = true;
      if (current) {
        if (!a["data-bl-sid"]) index.complete = false;
        else current.captionSids.push(a["data-bl-sid"]);
      }
    }
    if (current && !caption && !insideSvg && (node.tagName === "img" || node.tagName === "svg")) {
      const body = { tag: node.tagName as "img" | "svg", identity: figureBodyIdentity(node.tagName, a.id ?? null, node.tagName === "svg" ? serializeOuter(node) : a.src ?? "") };
      // Count separately below: a second body must not overwrite the first and look supported.
      const count = bodyCounts.get(current) ?? 0; bodyCounts.set(current, count + 1);
      current.body = count === 0 ? body : null;
    }
    if (node.tagName === "a" && a.href?.startsWith("#") && /\b(?:figure|fig\.?|abbildung|abb\.?)\s+\d/iu.test(text(node))) {
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
