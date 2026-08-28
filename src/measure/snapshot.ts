/**
 * The serialisable snapshot at the browser boundary.
 *
 * Collection happens after Paged.js has finished and after the freeze gate has settled. The
 * browser returns measurements only; source identity is parsed from the original text in Node and
 * joined here. This keeps layout products (page, fragment, nodeKey) separate from source identity
 * (author id, whole-block signature, source position).
 */

import { parse, type DefaultTreeAdapterMap } from "parse5";
import { dirname, resolve } from "node:path";

import { blockKey, normaliseSignature, sha256, svgRootKey, svgTextKey } from "../core/fingerprint.ts";
import { resolveDocumentUri } from "../acquire/browser.ts";
import {
  BREAK_CAUSE_CASCADE_HINTS,
  BREAK_CAUSE_DETERMINED_BY,
  BREAK_CAUSE_KINDS,
  SNAPSHOT_SCHEMA_VERSION,
} from "../core/enums.ts";
import type {
  BlockRecord,
  InputIdentity,
  PageRecord,
  Snapshot,
  SourceRef,
  SvgRecord,
  SvgTextTarget,
  TextLine,
  TextRun,
  UriRef,
  ResourceRecord,
} from "../core/types.ts";
import { assignPageCauses } from "../paginate/breaks.ts";
import { boundaryFactsFrom, type CollectorResult } from "../paginate/collector.ts";
import type { BreakCauseCascadeHint } from "../core/enums.ts";
import type { InjectionResult } from "../source/inject.ts";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

const URI_ATTRIBUTES = new Set(["href", "src", "srcset", "poster", "data", "xlink:href"]);

export interface SourceBlockModel {
  sid: string;
  authorId: string | null;
  blockSignature: string;
}

export interface OrderedSourceBlockModel {
  authorId: string | null;
  blockSignature: string;
  tag: string;
}

export interface SourceRunModel {
  sid: string | null;
  sourceBlockIndex: number;
  text: string;
  nodeType: "text";
  ancestorTags: string[];
  lang: string;
  excluded: boolean;
  excludeReason?: string;
}

export interface SourceModel {
  blocks: Record<string, SourceBlockModel>;
  orderedBlocks: OrderedSourceBlockModel[];
  runs: SourceRunModel[];
  uriRefs: Omit<UriRef, "nodeKey" | "requested">[];
  scriptBearing: boolean;
}

const SOURCE_BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "caption", "dd", "details", "div", "dl", "dt",
  "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6",
  "header", "hgroup", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "summary", "table",
  "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);

export interface ProvenanceValidation {
  ok: boolean;
  issues: string[];
}

/**
 * Cross-check the source map against both sides of the injection seam before a browser sees it.
 * A parser-derived offset is still data: if it points somewhere other than the original opening
 * tag, or its mark is absent/duplicated in the injected text, findings would carry invented
 * provenance. That is an infrastructure failure, never a source:null downgrade.
 */
export function validateInjectedProvenance(
  original: string,
  injected: InjectionResult,
): ProvenanceValidation {
  const issues: string[] = [];
  const entries = Object.entries(injected.map);
  if (entries.length !== injected.blocks) {
    issues.push(`map has ${entries.length} entries for ${injected.blocks} injected blocks`);
  }
  for (const [sid, ref] of entries) {
    if (!Number.isInteger(ref.offset) || ref.offset < 0 || ref.offset >= original.length || original[ref.offset] !== "<") {
      issues.push(`${sid}: offset ${ref.offset} does not point to a source opening tag`);
      continue;
    }
    const before = original.slice(0, ref.offset);
    const expectedLine = before.split("\n").length;
    const expectedColumn = ref.offset - (before.lastIndexOf("\n") + 1) + 1;
    if (ref.line !== expectedLine || ref.column !== expectedColumn) {
      issues.push(
        `${sid}: source position ${ref.line}:${ref.column} disagrees with offset ${ref.offset} ` +
          `(${expectedLine}:${expectedColumn})`,
      );
    }
    const literal = `data-bl-sid="${sid}"`;
    const first = injected.html.indexOf(literal);
    const second = first === -1 ? -1 : injected.html.indexOf(literal, first + literal.length);
    if (first === -1) issues.push(`${sid}: injected attribute is absent`);
    else if (second !== -1) issues.push(`${sid}: injected attribute is duplicated`);
  }
  return { ok: issues.length === 0, issues };
}

function isElement(node: Node): node is Element {
  return typeof (node as Element).tagName === "string";
}

function attrsOf(node: Element): Record<string, string> {
  return Object.fromEntries(node.attrs.map((a) => [a.name.toLowerCase(), a.value]));
}

function textOf(node: Node): string {
  if ((node as { nodeName?: string }).nodeName === "#text") {
    return (node as unknown as { value: string }).value;
  }
  return ((node as { childNodes?: Node[] }).childNodes ?? []).map(textOf).join("");
}

function uriParts(
  rawValue: string,
  file: string,
  distributionRoot: string,
): Omit<UriRef, "nodeKey" | "requested"> {
  const trimmed = rawValue.trim();
  const absolute = /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(trimmed);
  let scheme = "";
  let origin = "";
  let resolvedUri = trimmed;
  let insideDistributionRoot = false;
  try {
    // `file` is the source document/stylesheet, not decorative metadata: relative references are
    // resolved against its directory. `scheme` deliberately remains the AUTHORED scheme so a
    // portable relative path does not become an artifact/local-uri finding merely because its
    // canonical identity is a file URL during a local run.
    const resolved = resolveDocumentUri(trimmed, file, distributionRoot);
    const url = resolved.url;
    resolvedUri = url.href;
    insideDistributionRoot = resolved.insideDistributionRoot;
    if (absolute) {
      scheme = url.protocol.replace(/:$/u, "");
      origin = url.origin === "null" ? `${scheme}://` : url.origin;
    }
  } catch {
    // The rule still needs the authored value when URL parsing cannot make it canonical.
  }
  return {
    attribute: "",
    rawValue: trimmed,
    resolvedUri,
    scheme,
    origin,
    insideDistributionRoot,
  };
}

function cssUriParts(
  text: string,
  file: string,
  distributionRoot: string,
  attribute: string,
): SourceModel["uriRefs"] {
  const refs: SourceModel["uriRefs"] = [];
  const add = (raw: string): void => {
    const value = raw.trim();
    if (value.length > 0) refs.push({ ...uriParts(value, file, distributionRoot), attribute });
  };
  // Quoted @import without url(). url(...) imports are covered exactly once by the second loop.
  for (const match of text.matchAll(/@import\s+["']([^"']+)["']/giu)) if (match[1]) add(match[1]);
  for (const match of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)'";]+))\s*\)/giu)) {
    add(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return refs;
}

/** Parse identities and type runs from the injected source text, never from paginated clones. */
export function buildSourceModel(
  html: string,
  file: string,
  additionalCss: readonly { origin: string; text: string }[] = [],
  distributionRoot: string = dirname(resolve(file)),
): SourceModel {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const blocks: Record<string, SourceBlockModel> = {};
  const orderedBlocks: OrderedSourceBlockModel[] = [];
  const runs: SourceRunModel[] = [];
  const uriRefs: SourceModel["uriRefs"] = [];
  let scriptBearing = false;

  const walk = (
    node: Node,
    ancestors: Element[],
    currentSid: string | null,
    currentSourceBlockIndex: number | null,
    inheritedLang: string,
  ): void => {
    if (isElement(node)) {
      const attrs = attrsOf(node);
      const sid = attrs["data-bl-sid"] ?? currentSid;
      const lang = attrs.lang ?? inheritedLang;
      if (node.tagName.toLowerCase() === "script" || Object.keys(attrs).some((name) => /^on[a-z]/u.test(name))) {
        scriptBearing = true;
      }
      const ownSid = attrs["data-bl-sid"] ?? null;
      let ownSourceBlockIndex = currentSourceBlockIndex;
      if (SOURCE_BLOCK_TAGS.has(node.tagName.toLowerCase())) {
        ownSourceBlockIndex = orderedBlocks.length;
        orderedBlocks.push({
          authorId: attrs.id ?? null,
          blockSignature: normaliseSignature(textOf(node)),
          tag: node.tagName.toLowerCase(),
        });
      }
      if (ownSid) {
        blocks[ownSid] = {
          sid: ownSid,
          authorId: attrs.id ?? null,
          blockSignature: normaliseSignature(textOf(node)),
        };
      }
      for (const [attribute, value] of Object.entries(attrs)) {
        if (!URI_ATTRIBUTES.has(attribute)) continue;
        const values = attribute === "srcset"
          ? value.split(",").map((candidate) => candidate.trim().split(/\s+/u)[0] ?? "").filter(Boolean)
          : [value];
        for (const raw of values) uriRefs.push({ ...uriParts(raw, file, distributionRoot), attribute });
      }
      if (attrs.style) uriRefs.push(...cssUriParts(attrs.style, file, distributionRoot, "style"));
      if (node.tagName.toLowerCase() === "style") {
        uriRefs.push(...cssUriParts(textOf(node), file, distributionRoot, "style-sheet"));
      }
      for (const child of (node as { childNodes?: Node[] }).childNodes ?? []) {
        walk(child, [node, ...ancestors], sid, ownSourceBlockIndex, lang);
      }
      return;
    }

    if ((node as { nodeName?: string }).nodeName === "#text" && currentSourceBlockIndex !== null) {
      const text = (node as unknown as { value: string }).value;
      if (text.trim().length > 0) {
        runs.push({
          sid: currentSid,
          sourceBlockIndex: currentSourceBlockIndex,
          text,
          nodeType: "text",
          ancestorTags: ancestors.map((a) => a.tagName.toLowerCase()),
          lang: inheritedLang,
          excluded: false,
        });
      }
    }
    for (const child of (node as { childNodes?: Node[] }).childNodes ?? []) {
      walk(child, ancestors, currentSid, currentSourceBlockIndex, inheritedLang);
    }
  };

  walk(document, [], null, null, "");
  for (const sheet of additionalCss) {
    uriRefs.push(...cssUriParts(sheet.text, sheet.origin, distributionRoot, "style-sheet"));
  }
  return { blocks, orderedBlocks, runs, uriRefs, scriptBearing };
}

export interface ControlSignature {
  pages: number;
  geometry: string;
  text: string;
  style: string;
  resources: string;
}

export function compareControlSignatures(
  injected: ControlSignature,
  control: ControlSignature,
): { equal: boolean; changed: (keyof ControlSignature)[] } {
  const keys: (keyof ControlSignature)[] = ["pages", "geometry", "text", "style", "resources"];
  const changed = keys.filter((key) => injected[key] !== control[key]);
  return { equal: changed.length === 0, changed };
}

/** Five §10.5 quantities. It deliberately does not depend on injected ids. */
export const CONTROL_SIGNATURE_SOURCE = `(() => {
  const P = window.__blPrimitives;
  const round = (n) => Math.round(n * 100) / 100;
  const pages = P.all(document, ".pagedjs_page");
  const geometry = [];
  const styles = [];
  const texts = [];
  const resourceUris = new Set();
  const sourceBase = location.origin + "/source.html";
  const addResource = (raw, base = sourceBase) => {
    const value = (raw || "").trim();
    if (!value) return;
    try { resourceUris.add(new URL(value, base).href); } catch (_) { resourceUris.add(value); }
  };
  const addCssResources = (css, base) => {
    for (const match of css.matchAll(/url\\(\\s*(?:"([^"]*)"|'([^']*)'|([^\\s)'";]+))\\s*\\)/giu)) {
      addResource(match[1] || match[2] || match[3] || "", base);
    }
  };
  for (const page of pages) {
    texts.push(P.text(page).replace(/\\s+/g, " ").trim());
    for (const el of P.all(page, "*")) {
      const b = P.rect(el);
      const s = P.style(el, null);
      geometry.push([el.tagName, round(b.x), round(b.y), round(b.width), round(b.height)].join(":"));
      styles.push([el.tagName, s.display, s.position, s.fontFamily, s.fontSize, s.lineHeight,
        s.fontWeight, s.color, s.backgroundColor, s.textDecorationLine,
        s.breakBefore, s.breakAfter, s.breakInside, s.writingMode].join(":"));
      for (const attribute of ["href", "src", "poster", "data", "xlink:href"]) {
        const value = P.attr(el, attribute); if (value) addResource(value);
      }
      const srcset = P.attr(el, "srcset");
      if (srcset) for (const candidate of srcset.split(",")) addResource(candidate.trim().split(/\\s+/u)[0] || "");
      const inlineStyle = P.attr(el, "style"); if (inlineStyle) addCssResources(inlineStyle, sourceBase);
    }
  }
  const sheets = P.styleSheets();
  const visitRules = (rules, base) => {
    for (const rule of rules) {
      addCssResources(P.ruleCssText(rule) || "", base);
      try { const nested = P.nestedRules(rule); if (nested.length) visitRules(nested, base); } catch (_) {}
    }
  };
  for (const sheet of sheets) {
    const base = P.sheetHref(sheet) || sourceBase;
    try { visitRules(P.sheetRules(sheet), base); } catch (_) { resourceUris.add("unreadable-css:" + base); }
  }
  const resources = [...resourceUris].sort().join(";");
  return { pages: pages.length, geometry: geometry.join(";"), text: texts.join("\\n"),
    style: styles.join(";"), resources };
})()`;

interface RawBlock extends Omit<BlockRecord, "authorId" | "blockSignature" | "fragmentIndex" | "fragmentCount"> {
  sourceOrder: number;
  sourceIdentity: string;
  plainText: string;
}

/**
 * An SVG as the browser hands it over: measurements plus the raw material for identity. The keys
 * are computed in Node for the same reason block keys are — `svgRootKey` hashes canonicalised
 * markup, and hashing belongs on this side of the boundary, not in a string evaluated inside the
 * document under test.
 */
interface RawSvgText extends Omit<SvgTextTarget, "targetKey" | "svgTextKey" | "ink"> {
  /** The `<text>`'s own `id`, or null. */
  sourceIdentity: string | null;
  /** Its text content, normalised and hashed in Node when there is no id. */
  signature: string;
}

interface RawSvg extends Omit<SvgRecord, "sourceKey" | "texts"> {
  /** The SVG root's own `id`, or null. */
  sourceIdentity: string | null;
  /** Canonicalised and hashed in Node; the paginator's `data-ref` nonce is stripped there. */
  outerHtml: string;
  texts: RawSvgText[];
}

export interface RawSnapshot {
  pages: Omit<PageRecord, "incomingBreakCause" | "outgoingBreakCause" | "firstSemanticBlockKey">[];
  blocks: RawBlock[];
  textLines: TextLine[];
  svg: RawSvg[];
  requestedUrls: string[];
  fontFamilies: string[];
  control: ControlSignature;
}

/**
 * The most `<text>` elements one inline SVG may contribute before the whole SVG is declined as
 * `env/svg-too-many-text-targets`.
 *
 * This is a capacity limit, not a judgement: every target costs a `getBBox()` and a
 * `getScreenCTM()` inside the page, and a generated chart with tens of thousands of labels would
 * make the collection itself the slowest part of the run. The number is chosen, and it is chosen
 * far above real documents — the largest figure in the corpus this was measured against carries
 * 49. Exceeding it produces a decline, never silence.
 */
const SVG_TEXT_TARGET_CAP = 500;

/**
 * Read the paginated tree through the pristine primitives. Inline SVG text targets are measured
 * geometrically — `getBBox()` normalised through `getScreenCTM()`, all four corners — because
 * `svg/text-overflows-viewport` needs boxes and nothing else. The SVG ink passes belong to M3 and
 * are not collected; the two ink rules decline for that reason and say so.
 */
export const SNAPSHOT_SOURCE = `(() => {
  const P = window.__blPrimitives;
  const SOURCE_BLOCK_SELECTOR = "[data-bl-sid],address[data-ref],article[data-ref],aside[data-ref],blockquote[data-ref],caption[data-ref],dd[data-ref],details[data-ref],div[data-ref],dl[data-ref],dt[data-ref],fieldset[data-ref],figcaption[data-ref],figure[data-ref],footer[data-ref],form[data-ref],h1[data-ref],h2[data-ref],h3[data-ref],h4[data-ref],h5[data-ref],h6[data-ref],header[data-ref],hgroup[data-ref],hr[data-ref],li[data-ref],main[data-ref],nav[data-ref],ol[data-ref],p[data-ref],pre[data-ref],section[data-ref],summary[data-ref],table[data-ref],tbody[data-ref],td[data-ref],tfoot[data-ref],th[data-ref],thead[data-ref],tr[data-ref],ul[data-ref]";
  const round = (n) => Math.round(n * 100) / 100;
  const box = (el) => { const b = P.rect(el); return { x: round(b.x), y: round(b.y), width: round(b.width), height: round(b.height) }; };
  const number = (value, fallback) => { const n = parseFloat(value); return Number.isFinite(n) ? n : fallback; };
  const pagesEls = P.all(document, ".pagedjs_page");
  const fragments = [];
  const bySidCount = {};
  for (const page of pagesEls) for (const el of P.all(page, SOURCE_BLOCK_SELECTOR)) {
    const sid = P.attr(el, "data-bl-sid");
    const sourceIdentity = sid || ("ref:" + (P.attr(el, "data-ref") || String(fragments.length)));
    bySidCount[sourceIdentity] = (bySidCount[sourceIdentity] || 0) + 1;
    fragments.push({ page, el, sid, sourceIdentity });
  }
  const seenBySid = {};
  const lineBaseBySid = {};
  const blocks = [];
  const textLines = [];
  const fonts = new Set();
  const textNodes = (root) => {
    const out = [];
    const visit = (node) => {
      for (const child of P.children(node)) {
        if (child.nodeType === 3) { if ((P.text(child) || "").trim()) out.push(child); continue; }
        if (child.nodeType === 1 && !/^(SCRIPT|STYLE)$/u.test(child.tagName)) {
          const childStyle = P.style(child, null);
          if (childStyle.display === "none" || childStyle.visibility === "hidden") continue;
          visit(child);
        }
      }
    };
    visit(root);
    return out;
  };
  const linesFor = (el, justify) => {
    const groups = [];
    const words = [];
    let spaceWidth = 0;
    for (const node of textNodes(el)) {
      const value = P.text(node) || "";
      for (const r of P.range(node)) {
        if (r.width <= 0 || r.height <= 0) continue;
        const existing = groups.find((g) => Math.abs(g.y - r.y) <= 0.5);
        const entry = existing || { x: r.x, y: r.y, right: r.x + r.width, bottom: r.y + r.height, words: [] };
        entry.x = Math.min(entry.x, r.x); entry.right = Math.max(entry.right, r.x + r.width);
        entry.y = Math.min(entry.y, r.y); entry.bottom = Math.max(entry.bottom, r.y + r.height);
        if (!existing) groups.push(entry);
      }
      for (const match of value.matchAll(/\\S+/gu)) {
        const start = match.index || 0;
        const end = start + match[0].length;
        const rs = P.range(node, start, end);
        for (const r of rs) words.push({ text: match[0], x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) });
      }
      if (spaceWidth === 0) {
        const at = value.search(/\\s/u);
        if (at >= 0) {
          const rs = P.range(node, at, at + 1);
          if (rs[0] && rs[0].width > 0) spaceWidth = round(rs[0].width);
        }
      }
    }
    groups.sort((a, b) => a.y - b.y || a.x - b.x);
    return { groups, words: justify ? words : null, spaceWidth };
  };

  fragments.forEach((item, sourceOrder) => {
    const { page, el, sid, sourceIdentity } = item;
    const s = P.style(el, null);
    const fontSize = number(s.fontSize, 0);
    const lineHeight = number(s.lineHeight, fontSize * 1.2);
    const justify = /justify/u.test(s.textAlign);
    const measured = linesFor(el, justify);
    const nodeKey = "bl:" + sourceIdentity + ":" + String(seenBySid[sourceIdentity] || 0);
    const base = lineBaseBySid[sourceIdentity] || 0;
    measured.groups.forEach((line, local) => {
      const lineWords = measured.words === null ? null : measured.words.filter((w) => Math.abs(w.y - line.y) <= 0.5);
      textLines.push({ blockKey: nodeKey, index: base + local,
        box: { x: round(line.x), y: round(line.y), width: round(line.right - line.x), height: round(line.bottom - line.y) },
        visible: s.visibility !== "hidden", width: round(line.right - line.x), wordBoxes: lineWords });
    });
    lineBaseBySid[sourceIdentity] = base + measured.groups.length;
    fonts.add(s.fontFamily);
    blocks.push({
      nodeKey, sid, sourceIdentity, sourceOrder, plainText: (P.text(el) || "").replace(/\\s+/g, " ").trim(),
      page: pagesEls.indexOf(page) + 1, box: box(el), tag: el.tagName.toLowerCase(),
      classList: (P.attr(el, "class") || "").split(/\\s+/u).filter(Boolean), lineHeight,
      spaceWidth: measured.spaceWidth || round(fontSize * 0.33),
      effectiveStyle: { breakInside: s.breakInside || "auto", breakBefore: s.breakBefore || "auto",
        breakAfter: s.breakAfter || "auto", columns: s.columnCount || "auto", writingMode: s.writingMode || "horizontal-tb",
        visibility: s.visibility || "visible", widows: number(s.widows, 2), orphans: number(s.orphans, 2),
        textAlign: s.textAlign || "start", wordSpacing: s.wordSpacing || "normal", fontFamily: s.fontFamily || "",
        fontSize, lineHeight, lang: P.attr(el, "lang") || document.documentElement.lang || "" },
      lines: measured.groups.map((_, i) => base + i), inertBreak: null,
    });
    seenBySid[sourceIdentity] = (seenBySid[sourceIdentity] || 0) + 1;
  });

  const clipped = (r, cb) => {
    const x = Math.max(cb.x, r.x), y = Math.max(cb.y, r.y);
    const right = Math.min(cb.x + cb.width, r.x + r.width), bottom = Math.min(cb.y + cb.height, r.y + r.height);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
  };
  const mergedBands = (rects) => {
    const intervals = rects.map((r) => [r.y, r.y + r.height]).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const interval of intervals) {
      const last = merged[merged.length - 1];
      if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
      else merged.push([...interval]);
    }
    return merged;
  };
  const unionArea = (rects) => {
    const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.width]))].sort((a, b) => a - b);
    let area = 0;
    for (let i = 0; i + 1 < xs.length; i++) {
      const left = xs[i], right = xs[i + 1];
      const active = rects.filter((r) => r.x < right && r.x + r.width > left);
      const bands = mergedBands(active);
      area += (right - left) * bands.reduce((sum, band) => sum + band[1] - band[0], 0);
    }
    return area;
  };

  const pages = pagesEls.map((page, index) => {
    const content = P.all(page, ".pagedjs_page_content")[0] || page;
    const cb = box(content);
    const pageBlocks = blocks.filter((b) => b.page === index + 1);
    // Page fill is independent of source-block identity. Anonymous/inline-only authored text has
    // no BlockRecord, but its visible Range boxes still consume the page and must prevent blank.
    const rectangles = [];
    for (const node of textNodes(content)) {
      for (const rect of P.range(node)) if (rect.width > 0 && rect.height > 0) rectangles.push(rect);
    }
    for (const el of P.all(content, "img,svg,canvas,video,table")) {
      const style = P.style(el, null);
      if (style.display === "none" || style.visibility === "hidden") continue;
      rectangles.push(box(el));
    }
    const measuredRects = rectangles.map((rect) => clipped(rect, cb)).filter(Boolean);
    const merged = mergedBands(measuredRects);
    const netHeight = merged.reduce((sum, band) => sum + band[1] - band[0], 0);
    const first = merged[0] || null;
    const last = merged[merged.length - 1] || null;
    return { pageNumber: index + 1, nodeKey: "page:" + (index + 1), epoch: 0,
      blank: measuredRects.length === 0 && pageBlocks.length === 0,
      isLast: index === pagesEls.length - 1, contentBox: cb,
      marginBoxes: P.all(page, '[class*="pagedjs_margin"]').map(box),
      fill: { vertical: cb.height > 0 && last ? round((last[1] - cb.y) / cb.height) : 0,
        topGap: cb.height > 0 && first ? round((first[0] - cb.y) / cb.height) : 0,
        net: cb.height > 0 ? round(netHeight / cb.height) : 0,
        area: cb.width > 0 && cb.height > 0 ? round(unionArea(measuredRects) / (cb.width * cb.height)) : 0 },
      notMeasured: [] };
  });

  const svg = [];
  pagesEls.forEach((page, pageIndex) => P.all(page, "svg").forEach((el, i) => {
    // querySelectorAll reaches <text> inside <defs>, <symbol>, <clipPath> and <pattern>, under
    // display:none, and inside a NESTED <svg>. None of the first group is drawn; the last group
    // belongs to a different viewport and is collected with that inner SVG, which appears as its
    // own record. Counting it here as well would double every candidate and compare it against
    // the wrong box — the outer viewport instead of the one that actually clips it.
    const textEls = P.all(el, "text").filter((textEl) => P.closest(P.parent(textEl), "svg") === el);
    const capped = textEls.length > ${SVG_TEXT_TARGET_CAP};
    const texts = [];
    let unreadableTargets = 0;
    let notRenderedTargets = 0;
    if (!capped) {
      for (const textEl of textEls) {
        // Is this element painted at all? Asked FIRST, because getBBox alone gets it wrong exactly
        // where it matters. Measured in Chrome 152: a <text> inside <defs> answers getBBox() and
        // getScreenCTM() perfectly happily and yields a full screen box — 609.65 px outside its
        // viewport, reported as an error finding by a gating rule, about an element nobody sees.
        //
        // Three sources, and each covers what the others miss:
        //
        //   - an empty client rect: the not-laid-out cases (<defs>, <symbol>, display:none);
        //   - checkVisibility: visibility, content-visibility and opacity INCLUDING opacity
        //     inherited from an ancestor — <g opacity="0"><text> reports opacity 1 on the child,
        //     so reading the child's computed style alone does not see it;
        //   - fill and stroke both absent: painted nothing, which is not a CSS visibility
        //     question and therefore outside what checkVisibility answers.
        //
        // A target that is not painted is not a target: the question "does the viewport clip it?"
        // does not arise for it, as for an SVG holding no text at all.
        const rect = P.rect(textEl);
        const style = P.style(textEl, null);
        const painted = P.painted(textEl);
        const unpainted = (style.fill === "none" || parseFloat(style.fillOpacity) === 0)
          && (style.stroke === "none" || parseFloat(style.strokeOpacity) === 0);
        // painted === null means this browser has no checkVisibility. Then the two remaining
        // sources decide, and the ancestor-opacity case is not covered — stated here rather than
        // silently assumed, because the pinned browser does have it.
        const invisible = painted === false || unpainted
          || (painted === null && (style.visibility === "hidden" || style.visibility === "collapse"
              || parseFloat(style.opacity) === 0));
        if ((rect.width === 0 && rect.height === 0) || invisible) { notRenderedTargets += 1; continue; }

        let bounds = null;
        // getBBox() throws on a <text> with no rendered geometry; getScreenCTM() returns null on
        // one that is not in a rendered tree. For an element the browser DID lay out, either is a
        // measurement this tool owed and did not deliver — declined, and counted against coverage.
        try { bounds = P.svgBounds(textEl); } catch (e) { bounds = null; }
        if (!bounds) { unreadableTargets += 1; continue; }

        // All four corners, not two opposite ones: under a rotation the min/max over one diagonal
        // is smaller than the real extent in both axes, and the rules compare extents. Measured on
        // the 45-degree fixture: four corners put the label 15.82 px outside the viewport, two put
        // it 28 px inside it.
        let minX = bounds.corners[0].x, maxX = minX, minY = bounds.corners[0].y, maxY = minY;
        for (const corner of bounds.corners) {
          if (corner.x < minX) minX = corner.x;
          if (corner.x > maxX) maxX = corner.x;
          if (corner.y < minY) minY = corner.y;
          if (corner.y > maxY) maxY = corner.y;
        }
        const textStyle = style;
        const clipped = !!textStyle.clipPath && textStyle.clipPath !== "none";
        const masked = !!textStyle.mask && textStyle.mask !== "none" && !P.startsWith(textStyle.mask, "none ");
        texts.push({
          sourceIdentity: P.attr(textEl, "id"),
          signature: P.text(textEl) || "",
          boxScreen: { x: round(minX), y: round(minY), width: round(maxX - minX), height: round(maxY - minY) },
          clipState: clipped && masked ? "both" : clipped ? "clip-path" : masked ? "mask" : "none",
        });
      }
    }
    // measurable is a statement about the SVG AS A WHOLE and there is exactly one way it can be
    // false: more targets than the collector will gather. A single unreadable target used to set
    // it, which threw away every box already measured on that SVG and took an error rule with a
    // coverage floor of 1 down to zero — one such element anywhere ended the run in exit 4.
    // Per-target failures are counted per target and declined per target.
    //
    // Geometry is measured here; the ink passes are not implemented in this build. The two are
    // reported separately so a rule needing only boxes is not held back by a pass that does not
    // exist — see TOOL_CAPABILITY_ENV_IDS for what the ink rules do with that.
    svg.push({ nodeKey: "svg:" + pageIndex + ":" + i, page: pageIndex + 1,
      sourceIdentity: P.attr(el, "id"), outerHtml: P.outerHtml(el),
      measurable: !capped,
      // null, nicht undefined: undefined verschwindet beim JSON-Roundtrip, und das
      // Receipt-Schema fuehrt reason als required. Ein Feld, das nur manchmal existiert,
      // ist fuer jeden Leser ein Sonderfall mehr.
      reason: capped ? "env/svg-too-many-text-targets" : null,
      unreadableTargets, notRenderedTargets,
      viewportScreen: box(el), overflow: P.style(el, null).overflow || "hidden",
      textTargetCount: textEls.length, textTargetsCapped: capped, texts, shapes: [], paths: [],
      inkPasses: { E: { count: 0, maskHash: "" }, S: { count: 0, maskHash: "" }, F: { count: 0, maskHash: "" } },
      inkCollected: false, inkStable: false });
  }));
  return { pages, blocks, textLines, svg,
    requestedUrls: performance.getEntriesByType("resource").map((e) => e.name),
    fontFamilies: [...fonts].filter(Boolean).sort(),
    control: (${CONTROL_SIGNATURE_SOURCE}) };
})()`;

export interface AssembleSnapshotInput {
  raw: RawSnapshot;
  collector: CollectorResult;
  sourceModel: SourceModel;
  sourceMap: Record<string, SourceRef>;
  sourceMapInjection: boolean;
  renderer: string | null;
  browserVersion: string;
  pagedjsVersion: string;
  platform: string;
  locale: string;
  freezeSignature: string;
  freezeRetries: number;
  inputIdentity: InputIdentity;
  /** True only after the overlay path actually ran, never merely because the option was enabled. */
  evidenceOverlayApplied: boolean;
  cascadeHints?: Readonly<Record<string, BreakCauseCascadeHint | null>>;
  resources: ResourceRecord[];
}

export interface SnapshotInvariantValidation {
  ok: boolean;
  issues: string[];
}

/** Runtime gate for the §9 invariants that belong to snapshot construction (all except #6). */
export function validateSnapshotInvariants(
  snapshot: Snapshot,
  options: { sourceMapInjection: boolean },
): SnapshotInvariantValidation {
  const issues: string[] = [];
  const cause = (value: unknown, where: string): void => {
    if (!value || typeof value !== "object") {
      issues.push(`${where}: break cause is absent`);
      return;
    }
    const item = value as { kind?: string; determinedBy?: string; cascadeHint?: string | null };
    if (!(BREAK_CAUSE_KINDS as readonly string[]).includes(item.kind ?? "")) issues.push(`${where}: invalid cause kind`);
    if (!(BREAK_CAUSE_DETERMINED_BY as readonly string[]).includes(item.determinedBy ?? "")) {
      issues.push(`${where}: invalid determinedBy`);
    }
    if (item.cascadeHint !== null && !(BREAK_CAUSE_CASCADE_HINTS as readonly string[]).includes(item.cascadeHint ?? "")) {
      issues.push(`${where}: invalid cascadeHint`);
    }
    if (item.kind === "unknown" && item.determinedBy !== "undetermined") {
      issues.push(`${where}: unknown cause is not determinedBy undetermined`);
    }
  };
  snapshot.pages.forEach((page, index) => {
    cause(page.incomingBreakCause, `page ${index + 1} incoming`);
    cause(page.outgoingBreakCause, `page ${index + 1} outgoing`);
  });
  for (let index = 0; index + 1 < snapshot.pages.length; index++) {
    const outgoing = snapshot.pages[index]!.outgoingBreakCause;
    const incoming = snapshot.pages[index + 1]!.incomingBreakCause;
    if (JSON.stringify(outgoing) !== JSON.stringify(incoming)) {
      issues.push(`boundary ${index + 1}/${index + 2}: outgoing and incoming causes disagree`);
    }
  }
  if (snapshot.pages.length > 0) {
    if (snapshot.pages[0]!.incomingBreakCause.kind !== "document-start") issues.push("first page is not document-start");
    if (snapshot.pages.at(-1)!.outgoingBreakCause.kind !== "document-end") issues.push("last page is not document-end");
  }
  const epochByNodeKey = new Map<string, number>();
  for (const page of snapshot.pages) {
    const previous = epochByNodeKey.get(page.nodeKey);
    if (previous !== undefined && previous !== page.epoch) issues.push(`${page.nodeKey}: appears in multiple epochs`);
    epochByNodeKey.set(page.nodeKey, page.epoch);
  }
  for (const block of snapshot.blocks) {
    if (block.lines === null && !block.notMeasuredReason) issues.push(`${block.nodeKey}: lines absent without reason`);
    if (options.sourceMapInjection && block.sid !== null && !snapshot.source.map[block.sid]) {
      issues.push(`${block.nodeKey}: sid ${block.sid} has no SourceRef`);
    }
    for (const lineIndex of block.lines ?? []) {
      const line = snapshot.textLines.find((item) => item.blockKey === block.nodeKey && item.index === lineIndex);
      if (!line) issues.push(`${block.nodeKey}: referenced line ${lineIndex} is absent`);
      else if (block.effectiveStyle.textAlign === "justify" && line.wordBoxes === null) {
        issues.push(`${block.nodeKey}: justified line ${line.index} has no wordBoxes`);
      }
    }
  }
  for (const svg of snapshot.svg) {
    if (!svg.measurable && !svg.reason) issues.push(`${svg.nodeKey}: unmeasurable SVG has no reason`);
    for (const text of svg.texts) {
      if (!text.targetKey || !text.svgTextKey) issues.push(`${svg.nodeKey}: SVG text lacks target/source identity`);
    }
  }
  for (const page of snapshot.pages.filter((item) => item.blank)) {
    if (snapshot.blocks.some((block) => block.page === page.pageNumber && block.sid !== null)) {
      issues.push(`blank page ${page.pageNumber} carries a sid`);
    }
    if (page.fill.net !== 0 || page.fill.area !== 0) issues.push(`blank page ${page.pageNumber} has non-zero fill`);
  }
  // V-M2-I / contract v11 disposition: invariant #5 cannot mean "sid:null => generated" when
  // --no-source-map intentionally removes every SID from author blocks. In that mode provenance
  // is null but ordered source identity remains mandatory and is proven by the fail-closed ordered
  // join in assembleSnapshot. Empty normalised signatures are valid identities for hr/figure/image
  // containers; Paged.js data-ref is runtime addressing only, never the identity oracle.
  if (!options.sourceMapInjection) {
    for (const block of snapshot.blocks) {
      if (block.sid !== null) issues.push(`${block.nodeKey}: --no-source-map block unexpectedly carries a sid`);
    }
  }
  return { ok: issues.length === 0, issues };
}

/** Join browser measurements to source identity and classify each page boundary exactly once. */
export function assembleSnapshot(input: AssembleSnapshotInput): Snapshot {
  const counts = new Map<string, number>();
  for (const block of input.raw.blocks) counts.set(block.sourceIdentity, (counts.get(block.sourceIdentity) ?? 0) + 1);
  const seen = new Map<string, number>();
  const fallbackSourceByIdentity = new Map<string, OrderedSourceBlockModel & { sourceBlockIndex: number }>();
  let fallbackSourceIndex = 0;
  if (!input.sourceMapInjection) {
    for (const raw of [...input.raw.blocks].sort((a, b) => a.sourceOrder - b.sourceOrder)) {
      if (fallbackSourceByIdentity.has(raw.sourceIdentity)) continue;
      const rawSignature = normaliseSignature(raw.plainText);
      const candidates = input.sourceModel.orderedBlocks
        .map((candidate, index) => ({ candidate, index }))
        .filter(({ candidate, index }) =>
          index >= fallbackSourceIndex && candidate.tag === raw.tag && candidate.blockSignature === rawSignature,
        );
      if (candidates.length !== 1) {
        throw new Error(
          `sid-less exact source identity join ${candidates.length === 0 ? "missing" : "ambiguous"} ` +
          `for ${raw.sourceIdentity} (${raw.tag}, signature=${JSON.stringify(rawSignature)})`,
        );
      }
      const matchAt = candidates[0]!.index;
      const source = input.sourceModel.orderedBlocks[matchAt];
      if (source) {
        fallbackSourceByIdentity.set(raw.sourceIdentity, { ...source, sourceBlockIndex: matchAt });
        fallbackSourceIndex = matchAt + 1;
      }
    }
    const unmatched = [...new Set(input.raw.blocks.map((block) => block.sourceIdentity))]
      .filter((identity) => !fallbackSourceByIdentity.has(identity));
    if (unmatched.length > 0) {
      throw new Error(`sid-less source identity join failed for ${unmatched.join(", ")}`);
    }
  }
  const mappedNodeKeys = new Set<string>();
  const blocks: BlockRecord[] = input.raw.blocks.map(({ sourceOrder: _sourceOrder, sourceIdentity, plainText, ...raw }) => {
    const sid = raw.sid ?? "";
    const fragmentIndex = seen.get(sourceIdentity) ?? 0;
    seen.set(sourceIdentity, fragmentIndex + 1);
    const source = input.sourceModel.blocks[sid] ?? fallbackSourceByIdentity.get(sourceIdentity);
    if (source) mappedNodeKeys.add(raw.nodeKey);
    return {
      ...raw,
      authorId: source?.authorId ?? null,
      blockSignature: source?.blockSignature ?? normaliseSignature(plainText),
      fragmentIndex,
      fragmentCount: counts.get(sourceIdentity) ?? 1,
    };
  });

  const causes = assignPageCauses(
    input.collector.pages.length,
    boundaryFactsFrom(input.collector.pages, input.cascadeHints),
    input.collector.pages.map((p) => p.blank),
  );
  const pages: PageRecord[] = input.raw.pages.map((page, index) => {
    const first = blocks.find((b) => b.page === page.pageNumber && mappedNodeKeys.has(b.nodeKey));
    const identity = first ? blockKey({ authorId: first.authorId, blockSignature: first.blockSignature }) : null;
    return {
      ...page,
      epoch: input.collector.pages[index]?.epoch ?? 0,
      blank: page.blank,
      incomingBreakCause: causes[index]?.incoming ?? {
        kind: index === 0 ? "document-start" : "unknown",
        determinedBy: index === 0 ? "document-boundary" : "undetermined",
        cascadeHint: null,
      },
      outgoingBreakCause: causes[index]?.outgoing ?? {
        kind: index === input.raw.pages.length - 1 ? "document-end" : "unknown",
        determinedBy: index === input.raw.pages.length - 1 ? "document-boundary" : "undetermined",
        cascadeHint: null,
      },
      firstSemanticBlockKey: identity,
      fill: page.blank ? { vertical: 0, topGap: 0, net: 0, area: 0 } : page.fill,
    };
  });

  const firstBlockBySid = new Map<string, string>();
  for (const block of blocks) if (block.sid && !firstBlockBySid.has(block.sid)) firstBlockBySid.set(block.sid, block.nodeKey);
  const firstBlockBySourceIndex = new Map<number, string>();
  if (!input.sourceMapInjection) {
    for (const raw of input.raw.blocks) {
      const source = fallbackSourceByIdentity.get(raw.sourceIdentity);
      if (source && !firstBlockBySourceIndex.has(source.sourceBlockIndex)) {
        firstBlockBySourceIndex.set(source.sourceBlockIndex, raw.nodeKey);
      }
    }
  }
  const textRuns: TextRun[] = input.sourceModel.runs.flatMap((run) => {
    const blockKeyValue = input.sourceMapInjection
      ? run.sid ? firstBlockBySid.get(run.sid) : undefined
      : firstBlockBySourceIndex.get(run.sourceBlockIndex);
    if (!blockKeyValue) return [];
    const { sid: _sid, sourceBlockIndex: _sourceBlockIndex, ...textRun } = run;
    return [{ ...textRun, blockKey: blockKeyValue }];
  });
  // SVG identity is joined here, not in the page: `svgRootKey` hashes the canonicalised markup
  // after the paginator's `data-ref` nonce is stripped, and a hash computed inside the document
  // under test would be one more thing that document could answer for itself.
  //
  // `targetKey` is run-local addressing and deliberately a counter; `svgTextKey` is the identity
  // that travels into fingerprints. Keeping them apart is not tidiness — conflating them was a
  // measured defect, ten mis-attributions against one.
  let svgTargetCounter = 0;
  // Two passes, because the group is a property of the DOCUMENT, not of one record. Two
  // structurally identical inline SVGs get the same `svgRootKey` on purpose — which of two
  // identical objects is meant is not a well-formed question — and their labels therefore share
  // `svgTextKey` across records. Counting the group inside one record reported 1 for exactly the
  // collision the field exists for.
  const svgKeys = input.raw.svg.map((raw) => {
    const rootKey = svgRootKey({ authorId: raw.sourceIdentity, outerHtml: raw.outerHtml });
    return {
      rootKey,
      textKeys: raw.texts.map((text) =>
        svgTextKey({ svgRootKey: rootKey, authorId: text.sourceIdentity, textSignature: text.signature })),
    };
  });
  const svgGroupSize = new Map<string, number>();
  for (const entry of svgKeys) {
    for (const key of entry.textKeys) svgGroupSize.set(key, (svgGroupSize.get(key) ?? 0) + 1);
  }
  const svg: SvgRecord[] = input.raw.svg.map((raw, svgIndex) => {
    const { sourceIdentity: _rootId, outerHtml: _outerHtml, texts, ...rest } = raw;
    const { rootKey, textKeys } = svgKeys[svgIndex]!;
    return {
      ...rest,
      sourceKey: rootKey,
      texts: texts.map((text, index) => {
        const { sourceIdentity: _textId, signature: _signature, ...target } = text;
        svgTargetCounter += 1;
        const key = textKeys[index]!;
        return {
          ...target,
          targetKey: `bt${String(svgTargetCounter).padStart(3, "0")}`,
          svgTextKey: key,
          ambiguityGroupSize: svgGroupSize.get(key) ?? 1,
          ink: {
            T: { count: 0, maskHash: "" },
            T0: { count: 0, maskHash: "" },
          },
        };
      }),
    };
  });
  const requested = new Set(input.resources.map((resource) => resource.resolvedUri));
  const uriRefs: UriRef[] = input.sourceModel.uriRefs.map((ref, index) => ({
    ...ref,
    nodeKey: `uri:${index}`,
    requested: requested.has(ref.resolvedUri),
  }));

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    meta: {
      renderer: input.renderer,
      browserVersion: input.browserVersion,
      pagedjsVersion: input.pagedjsVersion,
      platform: input.platform,
      locale: input.locale,
      inputIdentity: input.inputIdentity,
      freezeSignature: input.freezeSignature,
      freezeRetries: input.freezeRetries,
      epochCount: input.collector.epochCount,
      interventions: [
        "animations-disabled",
        ...(input.sourceMapInjection ? ["source-id-injection"] : []),
        "pagedjs-pagination",
        ...(input.evidenceOverlayApplied && input.sourceMapInjection ? ["evidence-overlay"] : []),
      ],
    },
    source: {
      map: input.sourceMapInjection ? input.sourceMap : {},
      parser: "parse5@8",
      complete: input.sourceMapInjection,
      injectedAttribute: "data-bl-sid",
      collisionChecked: input.sourceMapInjection,
    },
    pages,
    blocks,
    textLines: input.raw.textLines,
    textRuns,
    svg,
    uriRefs,
    resources: input.resources,
    notMeasured: [],
  };
}

export function inputIdentity(input: {
  html: string;
  browserVersion: string;
  platform: string;
  fontFamilies: string[];
  resources: readonly ResourceRecord[];
  redirects?: { from: string; to: string; status: number }[];
}): InputIdentity {
  const resources = input.resources
    .map(({ resolvedUri, status, bytes, sha256: digest, outcome }) => ({ resolvedUri, status, bytes, sha256: digest, outcome }))
    .sort((a, b) => a.resolvedUri.localeCompare(b.resolvedUri) ||
      (a.status ?? -1) - (b.status ?? -1) || a.outcome.localeCompare(b.outcome) ||
      (a.sha256 ?? "").localeCompare(b.sha256 ?? ""));
  return {
    html: sha256(input.html),
    resources,
    resourcesHash: sha256(JSON.stringify(resources)),
    browserVersion: input.browserVersion,
    platform: input.platform,
    fontFamilies: input.fontFamilies,
    systemFontIds: [],
    redirects: [...(input.redirects ?? [])].sort((a, b) =>
      a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.status - b.status,
    ),
  };
}
