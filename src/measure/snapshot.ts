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
  Box,
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
import {
  SVG_FLOAT_NOISE_PX, SVG_OVERSHOOT_EPSILON_PX, envelope, resolveSvgFrames, resolveSvgText,
  type RawSvgFrame, type RawSvgTextFrame, type SvgBoxModel,
} from "./svg-viewport.ts";
import { boundaryFactsFrom, PAGE_AREA_SELECTOR, type CollectorResult } from "../paginate/collector.ts";
import type { BreakCauseCascadeHint } from "../core/enums.ts";
import type { InjectionResult } from "../source/inject.ts";
import { coordinateAtUtf8Byte } from "../source/bytes.ts";
import { isNotRendered } from "../rules/shared.ts";

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
  if (entries.length !== injected.blocks + injected.svgTargets) {
    issues.push(`map has ${entries.length} entries for ${injected.blocks} injected blocks and ${injected.svgTargets} SVG targets`);
  }
  const bytes = Buffer.from(original, "utf8");
  for (const [sid, ref] of entries) {
    if (ref.coordinateSystem !== "utf8-bytes-unicode-codepoints-v1" ||
      !Number.isInteger(ref.offset) || ref.offset < 0 || ref.offset >= bytes.length || bytes.subarray(ref.offset, ref.offset + 1).toString("utf8") !== "<" ||
      !Number.isInteger(ref.endOffset) || ref.endOffset <= ref.offset || ref.endOffset > bytes.length) {
      issues.push(`${sid}: offset ${ref.offset} does not point to a source opening tag`);
      continue;
    }
    const start = coordinateAtUtf8Byte(original, ref.offset);
    const end = coordinateAtUtf8Byte(original, ref.endOffset);
    if (ref.line !== start.line || ref.column !== start.column || ref.endLine !== end.line || ref.endColumn !== end.column) {
      issues.push(
        `${sid}: source position ${ref.line}:${ref.column} disagrees with offset ${ref.offset} ` +
          `(${start.line}:${start.column})`,
      );
    }
    const literal = sid.startsWith("bt") ? `data-bl-svg-target="${sid}"` : `data-bl-sid="${sid}"`;
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
interface RawSvgText extends Omit<SvgTextTarget, "targetKey" | "svgTextKey" | "ink" | "ambiguityGroupSize" | "boxScreen" | "boxLocal" | "bboxUser" | "userToLocal"> {
  /** The `<text>`'s own `id`, or null. */
  sourceIdentity: string | null;
  /** Its text content, normalised and hashed in Node when there is no id. */
  signature: string;
  /** getBBox(), getCTM() and getScreenCTM() as numbers; every box is built from them in Node. */
  geometry: RawSvgTextFrame;
}

export interface RawSvg extends Omit<SvgRecord, "sourceKey" | "texts" | "clipped" | "viewportLocal" | "viewportDiagnostic"> {
  /** The SVG root's own `id`, or null. */
  sourceIdentity: string | null;
  /** Canonicalised and hashed in Node; the paginator's `data-ref` nonce is stripped there. */
  outerHtml: string;
  texts: RawSvgText[];
  /** The facts its local frame is reconstructed from (`src/measure/svg-viewport.ts`). */
  geometry: RawSvgFrame;
  /** Index among the document's `.pagedjs_page svg` elements, for the CDP oracle; -1 unless outermost. */
  oracleIndex: number;
}

export interface RawSnapshot {
  pages: Omit<PageRecord, "incomingBreakCause" | "outgoingBreakCause" | "firstSemanticBlockKey">[];
  blocks: RawBlock[];
  textLines: TextLine[];
  svg: RawSvg[];
  /** How many `.pagedjs_page svg` elements the page saw; the CDP oracle must see the same set. */
  svgRendered: number;
  requestedUrls: string[];
  fontFamilies: string[];
  control: ControlSignature;
}

/**
 * The most potentially painted text targets one inline SVG may contribute before the whole SVG
 * is declined as `env/svg-too-many-text-targets`. A separate raw-DOM ceiling bounds the cheaper
 * classification pass without letting uninstantiated definitions consume this limit.
 *
 * This is a capacity limit, not a judgement: every target costs a `getBBox()` and a
 * `getScreenCTM()` inside the page, and a generated chart with tens of thousands of labels would
 * make the collection itself the slowest part of the run. The number is chosen, and it is chosen
 * far above real documents — the largest figure in the corpus this was measured against carries
 * 49. Exceeding it produces a decline, never silence.
 */
const SVG_TEXT_TARGET_CAP = 500;
const SVG_TEXT_RAW_TARGET_CAP = 5_000;

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
  const nonzeroLength = (value) => Math.abs(number(value, 0)) > 0.001;
  const effect = (value) => !!value && value !== "none" && !P.startsWith(value, "none ");
  const transparentPaint = (value) => value === "transparent"
    || /^rgba\\([^)]*,\\s*0(?:\\.0+)?\\s*\\)$/u.test(value)
    || /\\/\\s*0(?:\\.0+)?%?\\s*\\)$/u.test(value);
  const visiblePaint = (value, opacity) => value !== "none"
    && number(opacity, 1) > 0 && !transparentPaint(value);
  const referencedTextTargets = (referenced, seen, depth) => {
    let count = P.all(referenced, "text").length
      + (P.closest(referenced, "text") === referenced ? 1 : 0);
    const nestedUses = P.all(referenced, "use");
    if (depth >= 16) return count + (nestedUses.length > 0 ? 1 : 0);
    for (const nestedUse of nestedUses) {
      const href = P.attr(nestedUse, "href") || P.attr(nestedUse, "xlink:href") || "";
      if (!P.startsWith(href, "#") || href.length <= 1) { count += 1; continue; }
      const id = href.slice(1);
      let repeated = false;
      for (const prior of seen) if (prior === id) { repeated = true; break; }
      if (repeated) { count += 1; continue; }
      const target = P.byId(id);
      count += target ? referencedTextTargets(target, [...seen, id], depth + 1) : 1;
    }
    return count;
  };
  const pagesEls = P.all(document, ".pagedjs_page");
  // FLOW MEMBERSHIP. A source block is part of the flow if and only if it lies inside its page's
  // content area, the .pagedjs_area child of the page box: the page content and the footnote
  // area. Everything else in a page box is a copy. Paged.js implements position: running(...) by
  // deep-cloning the element into the margin box of EVERY page, and position: fixed by cloning it
  // into every page box; both clones keep the injected source id and the paginator's data-ref.
  // Querying the whole page counted each clone as one more fragment of its source block. Measured
  // on 2026-09-24 (Paged.js 0.4.3) on a six-page document: a one-line running title became seven
  // "fragments", which produced ten false widow and orphan warnings and anchored every page to
  // the title. The running element's in-flow original (display: none, no box) stays in the page
  // content and is kept.
  //
  // It is an INCLUSION test on the page structure, not an exclusion test on a class name, and
  // that direction is chosen: an author element that happens to carry a margin-box class does not
  // leave the flow, so no document can hide content from measurement by naming it. What the test
  // cannot prevent is author markup inside a margin box that itself reproduces the page structure;
  // that only brings back the old whole-page behaviour for that element, never a silent exclusion.
  const PAGE_AREA_SELECTOR = ${JSON.stringify(PAGE_AREA_SELECTOR)};
  const inFlow = (el) => P.closest(el, PAGE_AREA_SELECTOR) !== null;
  // Without an area on a page, every block on it would be excluded and the rules would judge an
  // empty document: a clean result about nothing. That is refused, never measured.
  for (let index = 0; index < pagesEls.length; index += 1) {
    if (P.all(pagesEls[index], PAGE_AREA_SELECTOR).length === 0) {
      throw new Error("breaklint: page " + (index + 1) + " has no Paged.js content area (" + PAGE_AREA_SELECTOR +
        "), so its flow content cannot be told apart from margin-box content");
    }
  }
  // Margin-box copies per source id: the clones Paged.js prints of a position: running(...)
  // element. They are not flow (see above), but that they exist is a fact about the in-flow
  // original, which Paged.js hides with display: none: without the count, a running element's
  // original cannot be told from an element the author hid. Only margin boxes count, never a
  // margin-box class inside the page area.
  const marginCopiesBySid = {};
  for (const page of pagesEls) for (const el of P.all(page, ".pagedjs_margin [data-bl-sid]")) {
    if (inFlow(el)) continue;
    const sid = P.attr(el, "data-bl-sid");
    if (sid) marginCopiesBySid[sid] = (marginCopiesBySid[sid] || 0) + 1;
  }
  const fragments = [];
  const bySidCount = {};
  for (const page of pagesEls) for (const el of P.all(page, SOURCE_BLOCK_SELECTOR)) {
    if (!inFlow(el)) continue;
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
      // A line is visible when any text on it is: visibility is read from each text node's own
      // element, not from the block, because a hidden block may hold a visible descendant
      // (p { visibility: hidden } span { visibility: visible } prints the span).
      const parentStyle = P.style(P.parent(node), null);
      const nodeVisible = (parentStyle && parentStyle.visibility) !== "hidden";
      for (const r of P.range(node)) {
        if (r.width <= 0 || r.height <= 0) continue;
        const existing = groups.find((g) => Math.abs(g.y - r.y) <= 0.5);
        const entry = existing || { x: r.x, y: r.y, right: r.x + r.width, bottom: r.y + r.height, words: [], visible: false };
        if (nodeVisible) entry.visible = true;
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
        visible: line.visible, width: round(line.right - line.x), wordBoxes: lineWords });
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
      display: s.display || "", marginCopies: sid ? (marginCopiesBySid[sid] || 0) : 0,
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
      isLast: index === pagesEls.length - 1, contentBox: cb, pageBox: box(page),
      marginBoxes: P.all(page, '[class*="pagedjs_margin"]').map(box),
      fill: { vertical: cb.height > 0 && last ? round((last[1] - cb.y) / cb.height) : 0,
        topGap: cb.height > 0 && first ? round((first[0] - cb.y) / cb.height) : 0,
        net: cb.height > 0 ? round(netHeight / cb.height) : 0,
        area: cb.width > 0 && cb.height > 0 ? round(unionArea(measuredRects) / (cb.width * cb.height)) : 0 },
      notMeasured: [] };
  });

  const svg = [];
  // Records are numbered in document order, so an enclosing <svg> always has a lower index than
  // every SVG inside it. The Node side resolves the local frames in that order.
  const svgRecordIndex = new Map();
  // The CDP oracle addresses an outermost SVG as the n-th ".pagedjs_page svg" of the document.
  const renderedSvgs = P.all(document, ".pagedjs_page svg");
  // Every computed value below is read through P.css, the captured getPropertyValue, by its CSS
  // name. A property getter such as overflowClipMargin lives on the prototype, and a document
  // that redefines it answers the question for itself: measured with a page script that shadowed
  // overflowClipMargin, a label with 570 ink pixels clipped became a clean run. Pairs, not a
  // camel-case conversion, so that no string method of the page stands between the name and the
  // read.
  const pick = (style, props) => { const out = {}; for (const [key, name] of props) out[key] = P.css(style, name); return out; };
  const SVG_BOX_PROPS = [["width", "width"], ["height", "height"], ["boxSizing", "box-sizing"],
    ["borderTopWidth", "border-top-width"], ["borderRightWidth", "border-right-width"],
    ["borderBottomWidth", "border-bottom-width"], ["borderLeftWidth", "border-left-width"],
    ["paddingTop", "padding-top"], ["paddingRight", "padding-right"], ["paddingBottom", "padding-bottom"],
    ["paddingLeft", "padding-left"], ["borderTopLeftRadius", "border-top-left-radius"],
    ["borderTopRightRadius", "border-top-right-radius"], ["borderBottomRightRadius", "border-bottom-right-radius"],
    ["borderBottomLeftRadius", "border-bottom-left-radius"], ["overflowX", "overflow-x"], ["overflowY", "overflow-y"],
    ["overflowClipMargin", "overflow-clip-margin"], ["contain", "contain"], ["contentVisibility", "content-visibility"],
    ["clipPath", "clip-path"], ["maskImage", "mask-image"], ["mask", "mask"], ["filter", "filter"], ["clip", "clip"]];
  const SVG_TRANSFORM_PROPS = [["transform", "transform"], ["rotate", "rotate"], ["scale", "scale"],
    ["translate", "translate"], ["perspective", "perspective"], ["offsetPath", "offset-path"]];
  // What may clip an outermost SVG from above, inside the page area: overflow, paint containment,
  // clip-path, masks, url() filters and legacy clip, with the radii that round an overflow clip.
  const SVG_ANCESTOR_PROPS = [["overflowX", "overflow-x"], ["overflowY", "overflow-y"], ["contain", "contain"],
    ["contentVisibility", "content-visibility"], ["clipPath", "clip-path"], ["maskImage", "mask-image"],
    ["mask", "mask"], ["filter", "filter"], ["clip", "clip"]];
  const SVG_RADIUS_PROPS = ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius",
    "border-bottom-left-radius"];
  const ancestorMayClip = (facts) => facts.overflowX !== "visible" || facts.overflowY !== "visible"
    || facts.contain !== "none" || facts.contentVisibility !== "visible" || effect(facts.clipPath)
    || effect(facts.maskImage) || effect(facts.mask) || /url\\(/u.test(facts.filter) || facts.clip !== "auto";
  // FLOW MEMBERSHIP, the same test the block collection applies: an <svg> is measured only inside
  // its page's content area, the .pagedjs_area child of the page box (page content and footnote
  // area): PAGE_AREA_SELECTOR, the one constant the block collection above uses too. Paged.js deep-clones a position: running(...) element into the margin box of every page
  // and a position: fixed one into every page box, and each clone keeps the injected target ids.
  // Read from the whole page, a running logo with one <text> became one target per page under one
  // id, and the viewport rule's per-target accounting stopped the run: "duplicate target
  // evaluation", checker-crashed, exit 3 (measured with a three-page document, Paged.js 0.4.3).
  // Margin-box SVG is unmeasured content, like everything else in a margin box. The running
  // element's in-flow original stays in the content area with display: none: its text is not
  // rendered, so it is kept and contributes no candidate.
  const SVG_FLOW_AREA_SELECTOR = PAGE_AREA_SELECTOR;
  const svgInFlow = (el) => P.closest(el, SVG_FLOW_AREA_SELECTOR) !== null;
  pagesEls.forEach((page, pageIndex) => P.all(page, "svg").filter(svgInFlow).forEach((el, i) => {
    // querySelectorAll reaches <text> inside <defs>, <symbol>, <clipPath> and <pattern>, under
    // display:none, and inside a NESTED <svg>. None of the first group is drawn; the last group
    // belongs to a different viewport and is collected with that inner SVG, which appears as its
    // own record. Counting it here as well would double every candidate and compare it against
    // the wrong box — the outer viewport instead of the one that actually clips it.
    const textEls = P.all(el, "text").filter((textEl) => P.closest(P.parent(textEl), "svg") === el);
    const useEls = P.all(el, "use").filter((useEl) => P.closest(P.parent(useEl), "svg") === el);
    const rawCapped = textEls.length + useEls.length > ${SVG_TEXT_RAW_TARGET_CAP};
    let useTextTargets = 0;
    for (const useEl of rawCapped ? [] : useEls) {
      const useRect = P.rect(useEl);
      if ((useRect.width === 0 && useRect.height === 0) || P.painted(useEl) === false) continue;
      const href = P.attr(useEl, "href") || P.attr(useEl, "xlink:href") || "";
      if (P.startsWith(href, "#") && href.length > 1) {
        const referenced = P.byId(href.slice(1));
        if (referenced) {
          useTextTargets += referencedTextTargets(referenced, [href.slice(1)], 0);
          continue;
        }
      }
      // An unresolved/external use element with painted geometry may still instantiate text, and its
      // closed instance tree is not enumerable. One conservative candidate keeps that uncertainty
      // in coverage instead of silently calling the SVG complete.
      useTextTargets += 1;
    }
    const textTargetCount = textEls.length + useTextTargets;
    const texts = [];
    let unreadableTargets = 0;
    let unsupportedTargets = useTextTargets;
    let notRenderedTargets = 0;
    const candidateTextEls = [];
    if (!rawCapped) {
      for (const textEl of textEls) {
        const rect = P.rect(textEl);
        const style = P.style(textEl, null);
        const painted = P.painted(textEl);
        const fillVisible = visiblePaint(P.css(style, "fill"), P.css(style, "fill-opacity"));
        const strokeVisible = visiblePaint(P.css(style, "stroke"), P.css(style, "stroke-opacity"))
          && nonzeroLength(P.css(style, "stroke-width"));
        const visibility = P.css(style, "visibility");
        const invisible = painted === false || (!fillVisible && !strokeVisible)
          || (painted === null && (visibility === "hidden" || visibility === "collapse"
              || parseFloat(P.css(style, "opacity")) === 0));
        if ((rect.width === 0 && rect.height === 0) || invisible) notRenderedTargets += 1;
        else candidateTextEls.push(textEl);
      }
    }
    const capped = rawCapped || candidateTextEls.length + unsupportedTargets > ${SVG_TEXT_TARGET_CAP};
    const svgStyle = P.style(el, null);
    // The viewport is reconstructed in Node, in the SVG's own coordinate system, from what is
    // collected here as plain numbers and computed-style strings (src/measure/svg-viewport.ts).
    // Nothing on this side decides whether the geometry is supported: a decision taken inside the
    // document under test is one more thing that document could answer for itself, and one that
    // only a browser could test.
    //
    // Three kinds. An <svg> with no enclosing <svg> is a CSS box: its frame is its own content box.
    // A nested <svg> lives in its parent element's user space. And an <svg> inside an enclosing
    // SVG's <foreignObject> is an outermost SVG again, clipped by the foreignObject as well.
    const parentEl = P.parent(el);
    const enclosingSvg = parentEl && P.nodeType(parentEl) === 1 ? P.closest(parentEl, "svg") : null;
    const foreignObject = enclosingSvg ? P.closest(parentEl, "foreignObject") : null;
    const kind = !enclosingSvg ? "outer"
      : foreignObject && P.closest(foreignObject, "svg") === enclosingSvg ? "foreign-object" : "nested";
    // CSS transforms on the SVG and its ancestors no longer matter for containment, which holds in
    // the SVG's own frame; they are shipped so Node can decline the 3D and motion-path cases.
    const transforms = [];
    const ancestors = [];
    if (kind === "outer") {
      for (let at = el; at && P.nodeType(at) === 1; at = P.parent(at)) {
        const facts = pick(P.style(at, null), SVG_TRANSFORM_PROPS);
        if (SVG_TRANSFORM_PROPS.some(([key]) => facts[key] && facts[key] !== "none")) transforms.push(facts);
      }
      // The HTML ancestors up to the page area, whose overflow, containment or clip may cut what
      // this SVG draws. The page area and what lies above it — the page box, the sheet that clips
      // at the page edge — are the page's business, measured by the block rules. \`up\` is the path
      // CDP follows to the same element for its content quad (src/acquire/render-run.ts).
      const flowArea = P.closest(el, SVG_FLOW_AREA_SELECTOR);
      let up = 1;
      for (let at = parentEl; at && at !== flowArea && P.nodeType(at) === 1; at = P.parent(at), up += 1) {
        const ancestorStyle = P.style(at, null);
        const facts = pick(ancestorStyle, SVG_ANCESTOR_PROPS);
        if (!ancestorMayClip(facts)) continue;
        ancestors.push({ up, ...facts, radii: SVG_RADIUS_PROPS.map((name) => P.css(ancestorStyle, name)) });
      }
    }
    let anchorIndex = -1;
    let anchorCtm = null;
    let lengths = null;
    let computedLengths = null;
    let lengthAttributes = null;
    if (kind === "nested") {
      // x/y/width/height live in the parent element's user space. getCTM() of the parent maps that
      // space into the viewport space of the parent's own nearest <svg> — or, when the parent IS
      // an <svg>, into the space of the <svg> above it (for the outermost SVG: into the frame).
      const parentIsSvg = P.closest(parentEl, "svg") === parentEl;
      const grandParent = parentIsSvg ? P.parent(parentEl) : null;
      const anchor = parentIsSvg
        ? (grandParent && P.nodeType(grandParent) === 1 ? P.closest(grandParent, "svg") : null)
        : enclosingSvg;
      anchorIndex = anchor ? (svgRecordIndex.has(anchor) ? svgRecordIndex.get(anchor) : -2) : -1;
      anchorCtm = P.svgCtm(parentEl);
      lengths = P.svgViewportLengths(el);
      computedLengths = { x: P.css(svgStyle, "x"), y: P.css(svgStyle, "y"), width: P.css(svgStyle, "width"),
        height: P.css(svgStyle, "height"), transform: P.css(svgStyle, "transform") };
      lengthAttributes = { x: P.attr(el, "x"), y: P.attr(el, "y") };
    }
    const geometry = { kind,
      parentIndex: enclosingSvg && svgRecordIndex.has(enclosingSvg) ? svgRecordIndex.get(enclosingSvg) : -1,
      anchorIndex, anchorCtm, ctm: P.svgCtm(el), screenCtm: P.svgScreenCtm(el),
      style: pick(svgStyle, SVG_BOX_PROPS), transforms, ancestors, lengths, computed: computedLengths,
      attributes: lengthAttributes };
    if (!capped) {
      for (const textEl of candidateTextEls) {
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
        const fill = P.css(style, "fill");
        const stroke = P.css(style, "stroke");
        const fillVisible = visiblePaint(fill, P.css(style, "fill-opacity"));
        const strokeVisible = visiblePaint(stroke, P.css(style, "stroke-opacity"))
          && nonzeroLength(P.css(style, "stroke-width"));
        const unpainted = !fillVisible && !strokeVisible;
        // painted === null means this browser has no checkVisibility. Then the two remaining
        // sources decide, and the ancestor-opacity case is not covered — stated here rather than
        // silently assumed, because the pinned browser does have it.
        const visibility = P.css(style, "visibility");
        const invisible = painted === false || unpainted
          || (painted === null && (visibility === "hidden" || visibility === "collapse"
              || parseFloat(P.css(style, "opacity")) === 0));
        if ((rect.width === 0 && rect.height === 0) || invisible) continue;

        // SVG getBBox() omits stroke, clipping, masks and filter effects. It also cannot expose
        // the painted result of a referenced paint server. Text decoration/shadow add ink outside
        // the glyph box by the same route. Judge none of those with a different box: retain the
        // target as an explicit coverage failure until the independent ink pass exists.
        //
        // Per-glyph rotation belongs here too. \`rotate\` on the text or any of its tspans turns each
        // glyph about its own origin, and with lengthAdjust="spacingAndGlyphs" Chromium 141 draws
        // ink 2.25 px beyond the getBBox() cell (measured on a 16 px run): the box stops being the
        // ink's outer bound. x/y/dx/dy lists and textPath were measured to keep the ink inside the
        // cell and stay measured.
        let paintedBoundsUnsupported = strokeVisible
          || /url\\(/u.test(fill) || /url\\(/u.test(stroke)
          || effect(P.css(style, "text-shadow")) || effect(P.css(style, "text-decoration-line"))
          || P.hasAttr(textEl, "rotate") || P.all(textEl, "[rotate]").length > 0;
        let ancestor = textEl;
        while (!paintedBoundsUnsupported && ancestor && P.nodeType(ancestor) === 1) {
          const ancestorStyle = P.style(ancestor, null);
          paintedBoundsUnsupported = effect(P.css(ancestorStyle, "clip-path"))
            || effect(P.css(ancestorStyle, "mask")) || effect(P.css(ancestorStyle, "mask-image"))
            || effect(P.css(ancestorStyle, "filter"));
          ancestor = P.parent(ancestor);
        }
        if (paintedBoundsUnsupported) { unsupportedTargets += 1; continue; }

        // getBBox() throws on a <text> with no rendered geometry; getCTM()/getScreenCTM() return
        // null on one that is not in a rendered tree. For an element the browser DID lay out,
        // either is a measurement this tool owed and did not deliver — declined, and counted
        // against coverage. The boxes themselves are built in Node from these raw facts, all four
        // corners through each matrix: under a rotation the min/max over one diagonal is smaller
        // than the real extent in both axes (measured on the 45-degree fixture: four corners put
        // the label 15.82 px outside the viewport, two put it 28 px inside it).
        const targetGeometry = P.svgGeometry(textEl);
        if (!targetGeometry) { unreadableTargets += 1; continue; }
        const clipPath = P.css(style, "clip-path");
        const mask = P.css(style, "mask");
        const clipped = !!clipPath && clipPath !== "none";
        const masked = !!mask && mask !== "none" && !P.startsWith(mask, "none ");
        texts.push({
          sourceIdentity: P.attr(textEl, "id"),
          // Run-local source map address only; SVG fingerprint identity remains source id/content.
          sourceAddressKey: P.attr(textEl, "data-bl-svg-target"),
          signature: P.text(textEl) || "",
          geometry: targetGeometry,
          clipState: clipped && masked ? "both" : clipped ? "clip-path" : masked ? "mask" : "none",
        });
      }
    }
    // measurable is a statement about the SVG AS A WHOLE. It is false here only when the candidate
    // cap is exceeded; Node sets it false as well when the viewport cannot be reconstructed. A
    // single unreadable or paint-complex target stays a per-target decline; that preserves every
    // sound box already measured on the SVG without silently treating the difficult target as
    // covered.
    //
    // Geometry is measured here; the ink passes are not implemented in this build. The two are
    // reported separately so a rule needing only boxes is not held back by a pass that does not
    // exist — see TOOL_CAPABILITY_ENV_IDS for what the ink rules do with that.
    svgRecordIndex.set(el, svg.length);
    svg.push({ nodeKey: "svg:" + pageIndex + ":" + i, page: pageIndex + 1,
      sourceIdentity: P.attr(el, "id"), outerHtml: P.outerHtml(el),
      measurable: !capped,
      // null, nicht undefined: undefined verschwindet beim JSON-Roundtrip, und das
      // Receipt-Schema fuehrt reason als required. Ein Feld, das nur manchmal existiert,
      // ist fuer jeden Leser ein Sonderfall mehr.
      reason: capped ? "env/svg-too-many-text-targets" : null,
      unreadableTargets, unsupportedTargets, notRenderedTargets,
      viewportScreen: box(el), overflow: P.css(svgStyle, "overflow") || "hidden",
      textTargetCount, textTargetsCapped: capped, texts, shapes: [], paths: [],
      geometry, oracleIndex: kind === "outer" ? renderedSvgs.indexOf(el) : -1,
      inkPasses: { E: { count: 0, maskHash: "" }, S: { count: 0, maskHash: "" }, F: { count: 0, maskHash: "" } },
      inkCollected: false, inkStable: false });
  }));
  return { pages, blocks, textLines, svg, svgRendered: renderedSvgs.length,
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
  sourceInput?: NonNullable<Snapshot["source"]["input"]>;
  sourceProvenance?: NonNullable<Snapshot["source"]["provenance"]>;
  /** Validated original-input digest inventory; no source bytes are retained in the snapshot. */
  sourceFiles?: NonNullable<Snapshot["source"]["files"]>;
  /** Partial producer-bound original leaves; sourceMap always describes the inspected input. */
  originalSourceMap?: Record<string, SourceRef>;
  originalSourceAmbiguity?: Record<string, SourceRef[]>;
  /**
   * CDP `DOM.getBoxModel()` for each `raw.svg` record, by index; null where CDP gave no answer.
   * Only outermost SVGs have one. Absent means no SVG frame has its independent proof, and every
   * outermost SVG — with everything nested in it — declines rather than being measured.
   */
  svgBoxModels?: readonly (SvgBoxModel | null)[];
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
    // Snapshot 5. A block without its computed display, or with a margin-copy count that is not a
    // count, cannot be classified by the rules that ask whether it has a box of its own.
    if (typeof block.display !== "string" || block.display.length === 0) issues.push(`${block.nodeKey}: computed display is absent`);
    if (!Number.isSafeInteger(block.marginCopies) || block.marginCopies < 0) issues.push(`${block.nodeKey}: marginCopies is not a count`);
    else if (block.marginCopies > 0 && block.sid === null) issues.push(`${block.nodeKey}: margin copies without a source id`);
    // The inspected input artefact's injection map is always complete. Producer provenance is
    // deliberately separate in originalMap, where generated/ambiguous output can be omitted.
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
  const finiteBox = (box: unknown): boolean => {
    const b = box as Partial<Record<"x" | "y" | "width" | "height", unknown>> | null;
    return !!b && [b.x, b.y, b.width, b.height].every((value) => typeof value === "number" && Number.isFinite(value)) &&
      (b.width as number) >= 0 && (b.height as number) >= 0;
  };
  const sameBox = (a: Box, b: Box): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  for (const svg of snapshot.svg) {
    if (!svg.measurable && !svg.reason) issues.push(`${svg.nodeKey}: unmeasurable SVG has no reason`);
    // Snapshot 5: a measurable record is measured in its local frame, and nowhere else. A record
    // that claims to be measurable without one would reach the error rule with nothing to
    // compare, and a clipped record without a clip rectangle would read as "inside everything".
    if (svg.measurable) {
      const frame = svg.viewportLocal;
      const potential = Math.max(svg.texts.length + svg.unreadableTargets + svg.unsupportedTargets,
        svg.textTargetCount - svg.notRenderedTargets);
      if (!frame) {
        if (potential > 0 || svg.viewportDiagnostic === null) issues.push(`${svg.nodeKey}: measurable SVG has no local frame`);
      } else {
        if (!finiteBox(frame.viewport) || !frame.clips.every(finiteBox)) issues.push(`${svg.nodeKey}: local frame is not finite`);
        if (svg.clipped !== frame.clips.length > 0) issues.push(`${svg.nodeKey}: clipped=${svg.clipped} disagrees with ${frame.clips.length} clip rectangle(s)`);
        // A frame whose error bound exceeds the rule's resolution would let the frame produce a
        // finding (or hide one). The resolver declines those; a projection must not smuggle one in.
        if (frame.uncertaintyPx !== null && frame.uncertaintyPx !== undefined &&
            !(frame.uncertaintyPx >= 0 && frame.uncertaintyPx + SVG_FLOAT_NOISE_PX <= SVG_OVERSHOOT_EPSILON_PX)) {
          issues.push(`${svg.nodeKey}: frame error bound ${String(frame.uncertaintyPx)} px exceeds the rule's resolution`);
        }
      }
    } else if (svg.texts.length > 0) {
      issues.push(`${svg.nodeKey}: unmeasurable SVG carries measured targets`);
    }
    if (svg.reason === "env/svg-viewport-geometry-unsupported" && svg.viewportDiagnostic === null) {
      issues.push(`${svg.nodeKey}: viewport decline names no diagnostic`);
    }
    if (svg.viewportDiagnostic !== null && svg.viewportLocal !== null) {
      issues.push(`${svg.nodeKey}: viewport diagnostic ${svg.viewportDiagnostic} on a record with a frame`);
    }
    for (const text of svg.texts) {
      if (!text.targetKey || !text.svgTextKey) issues.push(`${svg.nodeKey}: SVG text lacks target/source identity`);
      // boxLocal is derived, and it has to stay derivable: exactly the envelope of bboxUser through
      // userToLocal (JSON carries doubles exactly). A projection that edits one without the other
      // is describing two different targets.
      if (!finiteBox(text.boxLocal) || !finiteBox(text.bboxUser) || !finiteBox(text.boxScreen) ||
          !Array.isArray(text.userToLocal) || text.userToLocal.length !== 6 || !text.userToLocal.every(Number.isFinite) ||
          !sameBox(envelope(text.bboxUser, text.userToLocal), text.boxLocal)) {
        issues.push(`${svg.nodeKey}: ${text.targetKey} local box is not the envelope of its user box`);
      }
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
  const sourceInput = input.sourceInput ?? {
    identityStatus: "unknown" as const,
    rawBytesSha256: null,
    byteLength: null,
    encoding: null,
    complete: false,
  };
  const sourceIdentityPairIsComplete =
    (sourceInput.rawBytesSha256 === null) === (sourceInput.byteLength === null);
  if (!sourceIdentityPairIsComplete) {
    throw new Error("snapshot source input must provide rawBytesSha256 and byteLength together");
  }
  if (sourceInput.rawBytesSha256 !== null && !/^[a-f0-9]{64}$/u.test(sourceInput.rawBytesSha256)) {
    throw new Error("snapshot source input rawBytesSha256 must be a lowercase SHA-256 digest");
  }
  if (sourceInput.byteLength !== null && (!Number.isSafeInteger(sourceInput.byteLength) || sourceInput.byteLength < 0)) {
    throw new Error("snapshot source input byteLength must be a non-negative safe integer");
  }
  if (sourceInput.identityStatus === "verified" && sourceInput.rawBytesSha256 === null) {
    throw new Error("verified snapshot source input requires raw bytes identity");
  }
  const sourceProvenance = input.sourceProvenance ?? {
    binding: "unavailable" as const,
    copyIntegrity: "unavailable" as const,
    sourceRole: "unknown" as const,
    producerId: null,
    receiptHash: null,
    diagnostics: ["source provenance was not supplied to the legacy live acquisition path"],
  };
  const sourceFiles = input.sourceFiles ?? [];
  const sourceDigest = (value: string | null | undefined, label: string): void => {
    if (value !== undefined && value !== null && !/^[a-f0-9]{64}$/u.test(value)) {
      throw new Error(`snapshot source provenance ${label} must be a lowercase SHA-256 digest`);
    }
  };
  sourceDigest(sourceProvenance.receiptHash, "receiptHash");
  sourceDigest(sourceProvenance.codeSha256, "codeSha256");
  sourceDigest(sourceProvenance.optionsSha256, "optionsSha256");
  if (sourceProvenance.binding === "producer-bound" && (
    !sourceProvenance.producerId || !sourceProvenance.receiptHash ||
    !sourceProvenance.codeSha256 || !sourceProvenance.optionsSha256
  )) {
    throw new Error("producer-bound snapshot provenance requires producerId, receiptHash, codeSha256, and optionsSha256");
  }
  const sourceFileByPath = new Map<string, { sha256: string; byteLength: number; role: "authoring" | "dependency" | "asset" }>();
  for (const file of sourceFiles) {
    if (
      !file.file || !/^[a-f0-9]{64}$/u.test(file.sha256) || !Number.isSafeInteger(file.byteLength) || file.byteLength < 0 ||
      !["authoring", "dependency", "asset"].includes(file.role)
    ) {
      throw new Error("snapshot source files must contain a logical path, lowercase SHA-256, non-negative bytes, and a known role");
    }
    if (sourceFileByPath.has(file.file)) throw new Error(`snapshot source files contains duplicate path ${file.file}`);
    sourceFileByPath.set(file.file, file);
  }
  for (const [address, original] of Object.entries(input.originalSourceMap ?? {})) {
    if (!sourceFileByPath.has(original.file)) {
      throw new Error(`snapshot original source ${address} is absent from the source file inventory`);
    }
  }
  for (const [address, candidates] of Object.entries(input.originalSourceAmbiguity ?? {})) {
    for (const candidate of candidates) {
      if (!sourceFileByPath.has(candidate.file)) {
        throw new Error(`snapshot ambiguous original source ${address} is absent from the source file inventory`);
      }
    }
  }
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
  // A page is anchored to the first source block a reader can SEE on it. A block that was not
  // rendered — no box in either dimension and no line boxes, which is what display: none leaves —
  // is skipped (`isNotRendered`); a display: contents block, which has no box but prints its
  // lines, is not. The case that forced this is the in-flow original of a running element: Paged.js
  // leaves it in the page content with an inline display: none while its clones print in the
  // margin boxes, so it is the first block on its page in document order and would otherwise
  // anchor that page, whose findings would then change fingerprint whenever the header is edited.
  //
  // And the first block that STARTS on the page (fragment 0) wins over continuations. A wrapper
  // that spans pages — `<main>`, `<article>`, a section, a full-bleed block — has a fragment on
  // every page it covers, and as an ancestor it comes first in document order, so it used to
  // anchor all of them: four `layout/half-empty-page` findings on four pages of one `<article>`
  // carried one fingerprint. A block starts on exactly one page. Only a page on which nothing
  // starts — the middle of a single block taller than a page — falls back to its first
  // continuing block, which is deterministic; two such pages of the same block share an anchor.
  const anchorCandidates = new Map<number, BlockRecord[]>();
  for (const block of blocks) {
    if (!mappedNodeKeys.has(block.nodeKey) || isNotRendered({ textLines: input.raw.textLines }, block)) continue;
    const list = anchorCandidates.get(block.page) ?? [];
    list.push(block);
    anchorCandidates.set(block.page, list);
  }
  const pages: PageRecord[] = input.raw.pages.map((page, index) => {
    const onPage = anchorCandidates.get(page.pageNumber) ?? [];
    const first = onPage.find((b) => b.fragmentIndex === 0) ?? onPage[0];
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
  // The local frames first: they decide which records are measurable and which targets keep a box,
  // and the identity groups below are counted over what is actually measured. A target whose local
  // matrix does not carry it onto its own getScreenCTM() cannot be placed in the frame the oracle
  // proved; it becomes unreadable, per target, exactly like a target with no CTM at all.
  const frames = resolveSvgFrames(input.raw.svg.map((raw) => raw.geometry), input.svgBoxModels);
  const svgResolved = input.raw.svg.map((raw, svgIndex) => {
    const resolved = frames[svgIndex]!;
    const frame = raw.measurable ? resolved.frame : null;
    // An SVG with no potential target — every <text> unrendered, no <use> — gives the rule nothing
    // its viewport could clip, so an unprovable viewport is not a decline there. This is the
    // display:none figure and the text-free icon: CDP has no box model for the first, and neither
    // was ever a candidate. Declining them would turn a document with a hidden icon into exit 4.
    const potentialTargets = Math.max(raw.texts.length + raw.unreadableTargets + raw.unsupportedTargets,
      raw.textTargetCount - raw.notRenderedTargets);
    const measurable = raw.measurable && (frame !== null || potentialTargets <= 0);
    let unreadableTargets = raw.unreadableTargets;
    const texts = [];
    if (frame) {
      for (const text of raw.texts) {
        const boxes = resolveSvgText(frame, text.geometry);
        if (!boxes) { unreadableTargets += 1; continue; }
        texts.push({ text, boxes });
      }
    }
    return { raw, resolved, frame, measurable, unreadableTargets, texts };
  });
  // Two passes, because the group is a property of the DOCUMENT, not of one record. Two
  // structurally identical inline SVGs get the same `svgRootKey` on purpose — which of two
  // identical objects is meant is not a well-formed question — and their labels therefore share
  // `svgTextKey` across records. Counting the group inside one record reported 1 for exactly the
  // collision the field exists for.
  const svgKeys = svgResolved.map(({ raw, texts }) => {
    const rootKey = svgRootKey({ authorId: raw.sourceIdentity, outerHtml: raw.outerHtml });
    return {
      rootKey,
      textKeys: texts.map(({ text }) =>
        svgTextKey({ svgRootKey: rootKey, authorId: text.sourceIdentity, textSignature: text.signature })),
    };
  });
  const svgGroupSize = new Map<string, number>();
  for (const entry of svgKeys) {
    for (const key of entry.textKeys) svgGroupSize.set(key, (svgGroupSize.get(key) ?? 0) + 1);
  }
  const svg: SvgRecord[] = svgResolved.map(({ raw, resolved, frame, measurable, unreadableTargets, texts }, svgIndex) => {
    const {
      sourceIdentity: _rootId, outerHtml: _outerHtml, texts: _rawTexts, geometry: _geometry, oracleIndex: _oracleIndex,
      measurable: _measurable, reason: rawReason, unreadableTargets: _unreadable, ...rest
    } = raw;
    const { rootKey, textKeys } = svgKeys[svgIndex]!;
    // The page's own reason (the target cap) takes precedence, as it did before the frame existed.
    const viewportDeclined = raw.measurable && !measurable;
    return {
      ...rest,
      measurable,
      reason: rawReason ?? (viewportDeclined ? "env/svg-viewport-geometry-unsupported" : null),
      unreadableTargets,
      sourceKey: rootKey,
      clipped: resolved.clipped,
      // Unrounded, like the targets' boxLocal: the rule compares the two, and its epsilon is spent
      // on the frame's own error bound, not on a storage grid.
      viewportLocal: frame
        ? {
          viewport: frame.viewport,
          clips: frame.clips,
          localToScreen: frame.localToScreen,
          oracleDeltaPx: frame.oracleDeltaPx,
          modelDeltaPx: frame.modelDeltaPx,
          uncertaintyPx: frame.uncertaintyPx,
        }
        : null,
      // Why there is no frame, whenever there is none and the page did not already decline the
      // record for its target cap — including the target-free record that is not declined for it.
      viewportDiagnostic: raw.measurable && frame === null ? resolved.diagnostic : null,
      texts: texts.map(({ text, boxes }, index) => {
        const { sourceIdentity: _textId, signature: _signature, geometry: _textGeometry, ...target } = text;
        svgTargetCounter += 1;
        const key = textKeys[index]!;
        return {
          ...target,
          ...boxes,
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
      ...(input.originalSourceMap === undefined ? {} : { originalMap: input.originalSourceMap }),
      ...(input.originalSourceAmbiguity === undefined ? {} : { originalAmbiguity: input.originalSourceAmbiguity }),
      input: sourceInput,
      provenance: sourceProvenance,
      ...(input.sourceFiles === undefined ? {} : { files: input.sourceFiles }),
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
