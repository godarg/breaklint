/** Authored semantic relations. No browser, guessed numbering, or paginated DOM identity. */
import { parseFragment, serializeOuter, type DefaultTreeAdapterMap } from "parse5";
import { sha256 } from "../core/fingerprint.ts";
import type { FigureBodyCandidate, FigureIndex } from "../core/types.ts";
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
        && a.name !== "data-ref" && a.name !== "data-undisplayed" && !a.name.startsWith("data-bl-"))
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
const NON_EXECUTABLE_SCRIPT_TYPES = new Set(["application/json", "application/ld+json"]);
export function isExecutableScript(scriptAttrs: Readonly<Record<string, string>>): boolean {
  const rawType = (scriptAttrs.type ?? "").trim().toLowerCase();
  if (!rawType) return true;
  const mime = rawType.split(";", 1)[0]!.trim();
  return !NON_EXECUTABLE_SCRIPT_TYPES.has(mime);
}
export function figureIndexTreeFingerprint(
  index: Pick<FigureIndex, "ids" | "namedAnchors" | "figures" | "referenceBlocks">,
): string {
  const sortedRecord = (record: Readonly<Record<string, number>> | undefined) =>
    Object.entries(record ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const figures = index.figures.map(figure => [
    figure.sid,
    figure.captionSids,
    figure.captionPosition ?? null,
    figure.body ? [figure.body.tag, figure.body.identity] : null,
    figure.bodyCandidates ? figure.bodyCandidates.map(candidate => [candidate.tag, candidate.identity]) : null,
  ]);
  const referenceBlocks = [...index.referenceBlocks]
    .sort((a, b) => (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0))
    .map(group => [group.sid, group.references.map(ref => [ref.href, ref.targetId])]);
  return sha256(JSON.stringify({
    ids: sortedRecord(index.ids),
    namedAnchors: sortedRecord(index.namedAnchors),
    figures,
    referenceBlocks,
  }));
}
export function buildFigureIndexDetail(document: Node): { index: FigureIndex; structuralComplete: boolean; scriptBearing: boolean } {
  const index: FigureIndex = { complete: true, ids: Object.create(null) as Record<string, number>, namedAnchors: Object.create(null) as Record<string, number>, figures: [], referenceBlocks: [] };
  const referenceBlocks = new Map<string, FigureIndex["referenceBlocks"][number]>();
  let structuralIncomplete = false;
  let scriptBearing = false;
  const walk = (node: Node, blockSid: string | null, figure: FigureIndex["figures"][number] | null, inCaption: boolean, insideSvg = false): void => {
    if (!element(node)) {
      for (const child of "childNodes" in node ? node.childNodes : []) walk(child, blockSid, figure, inCaption, insideSvg);
      return;
    }
    const a = attrs(node); const sid = a["data-bl-sid"] ?? blockSid;
    if (a.id) index.ids[a.id] = (index.ids[a.id] ?? 0) + 1;
    if (node.tagName === "a" && a.name) index.namedAnchors![a.name] = (index.namedAnchors![a.name] ?? 0) + 1;
    // Non-executing data scripts (JSON / JSON-LD) cannot mutate DOM membership. Executable scripts
    // and inline event handlers stay statically incomplete unless verified mutation-free at runtime.
    if ((node.tagName === "script" && isExecutableScript(a)) || Object.keys(a).some(k => /^on[a-z]/u.test(k))) {
      scriptBearing = true;
    }
    if (node.tagName === "base" || Object.hasOwn(a, "data-next-break-before") || Object.hasOwn(a, "data-ref") || Object.hasOwn(a, "data-undisplayed")) {
      structuralIncomplete = true;
    }
    let current = figure; let caption = inCaption;
    if (node.tagName === "figure") {
      if (!a["data-bl-sid"]) structuralIncomplete = true;
      current = { sid: a["data-bl-sid"] ?? "", captionSids: [], body: null, bodyFragments: [], captionPosition: null };
      index.figures.push(current); caption = false;
    }
    if (node.tagName === "figcaption") {
      caption = true;
      if (current) {
        if (!a["data-bl-sid"]) structuralIncomplete = true;
        else current.captionSids.push(a["data-bl-sid"]);
        seenCaption.add(current);
      }
    }
    if (current && !caption && !insideSvg && ["img", "svg", "table"].includes(node.tagName)) {
      const body: FigureBodyCandidate = node.tagName === "table"
        ? { tag: "table" as const, identity: `table:${a["data-bl-sid"] ?? ""}`, tableSid: a["data-bl-sid"] ?? "" }
        : { tag: node.tagName as "img" | "svg", identity: figureBodyIdentity(node.tagName, a.id ?? null, node.tagName === "svg" ? serializeOuter(node) : a.src ?? "") };
      const list = candidatesByFigure.get(current) ?? [];
      list.push(body);
      candidatesByFigure.set(current, list);
      if (seenCaption.has(current)) bodiesAfterCaption.set(current, (bodiesAfterCaption.get(current) ?? 0) + 1);
      else bodiesBeforeCaption.set(current, (bodiesBeforeCaption.get(current) ?? 0) + 1);
    }
    if (node.tagName === "a" && a.href?.startsWith("#") && /\b(?:figure|fig\.?|abbildung|abb\.?|table|tbl\.?|tabelle|tab\.?)\s+\d/iu.test(text(node))) {
      if (!sid) structuralIncomplete = true;
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
  const candidatesByFigure = new Map<FigureIndex["figures"][number], FigureBodyCandidate[]>();
  const seenCaption = new Set<FigureIndex["figures"][number]>();
  const bodiesBeforeCaption = new Map<FigureIndex["figures"][number], number>();
  const bodiesAfterCaption = new Map<FigureIndex["figures"][number], number>();
  walk(document, null, null, false);
  for (const figure of index.figures) {
    const candidates = candidatesByFigure.get(figure) ?? [];
    if (candidates.length === 1) {
      figure.body = candidates[0]!;
    } else if (candidates.length >= 2) {
      figure.body = null;
      figure.bodyCandidates = candidates;
    } else {
      figure.body = null;
    }
    if (seenCaption.has(figure)) {
      const before = bodiesBeforeCaption.get(figure) ?? 0;
      const after = bodiesAfterCaption.get(figure) ?? 0;
      figure.captionPosition = before === 0 ? "before" : after === 0 ? "after" : null;
    }
  }
  index.referenceBlocks = [...referenceBlocks.values()];
  index.complete = !structuralIncomplete && !scriptBearing;
  return { index, structuralComplete: !structuralIncomplete, scriptBearing };
}
export function buildFigureIndex(document: Node): FigureIndex {
  return buildFigureIndexDetail(document).index;
}
