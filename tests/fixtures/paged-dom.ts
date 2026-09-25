/**
 * A hand-authored Paged.js 0.4.3 page tree, and the captured primitives over it, so that the
 * in-page payloads that decide flow membership — `SNAPSHOT_SOURCE`, the collector, the evidence
 * overlay's `install` and the source-id integrity `status()` — can run in the unit suite without a
 * browser.
 *
 * WHAT THIS IS FOR. Both payloads are strings evaluated inside the document, and until now the only
 * thing that could observe them was the live suite. That left the unit suite unable to see the
 * margin-box defect at all: a hand-authored `Snapshot` can only model a running-element clone as a
 * record that is already there, which tests the rules, not the query that put it there. Running the
 * real payload text against a real page tree closes that gap: delete the flow test from any of the
 * payloads and a unit test turns red.
 *
 * WHAT IT IS NOT. It is not a browser and it is not a layout engine. Geometry is authored, not
 * computed: an element's box is its `data-test-box="x y width height"` attribute, a text node's
 * single line box is its parent's box, and anything under `display: none` has no box at all —
 * which is what Blink reports for such elements. Styles are the inline `style` declarations over a
 * fixed default. The selector engine covers exactly the selector forms the payloads use (compound
 * selectors of type, `*`, `.class`, `[attr]`, `[attr="v"]`, `[attr*="v"]`, joined by descendant
 * or `>` combinators, in comma lists) and throws on anything else, so a payload that starts using
 * a form this file cannot answer fails loudly here instead of matching nothing.
 *
 * THE PAGE STRUCTURE IS MEASURED, NOT ASSUMED. `pagedPage` reproduces the tree Paged.js 0.4.3 builds
 * from its page template (`chunker.js`), as read back from a real paginated document on
 * 2026-09-24: eight margin holders and then `.pagedjs_area` as children of `.pagedjs_pagebox`; the
 * area holding `.pagedjs_page_content` (whose content sits in one wrapper `div`) and
 * `.pagedjs_footnote_area`; a running element's clone inside
 * `.pagedjs_margin-<name> > .pagedjs_margin-content`; a `position: fixed` element's clone as the
 * FIRST child of the page box; Paged.js copying a page's `data-break-before` onto the page element.
 * The live suite (`tests/live/breaks.test.ts`, `tests/live/render-run.test.ts`) runs the same
 * payloads against the real paginator on `tests/fixtures/margin-running-*.html`.
 */

import { parse, type DefaultTreeAdapterMap } from "parse5";

type P5Node = DefaultTreeAdapterMap["node"];

export interface FakeNode {
  nodeType: 1 | 3 | 9;
  nodeName: string;
  /** Upper-case, as the DOM reports it for HTML elements. Absent on text nodes. */
  tagName?: string;
  attributes: Map<string, string>;
  childNodes: FakeNode[];
  parentNode: FakeNode | null;
  /** Text-node data. */
  data?: string;
  isConnected: boolean;
  documentElement?: { lang: string };
}

export interface FakeRect {
  x: number; y: number; width: number; height: number;
  top: number; right: number; bottom: number; left: number;
}

function rect(x: number, y: number, width: number, height: number): FakeRect {
  return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height };
}

const ZERO = rect(0, 0, 0, 0);

/** Parse an HTML string into the fake tree. `parse5` is already the source-side parser. */
export function fakeDocument(html: string, lang = "en"): FakeNode {
  const root: FakeNode = {
    nodeType: 9, nodeName: "#document", attributes: new Map(), childNodes: [], parentNode: null,
    isConnected: true, documentElement: { lang },
  };
  const convert = (node: P5Node, parent: FakeNode): void => {
    const name = (node as { nodeName: string }).nodeName;
    if (name === "#text") {
      parent.childNodes.push({
        nodeType: 3, nodeName: "#text", attributes: new Map(), childNodes: [], parentNode: parent,
        data: (node as unknown as { value: string }).value, isConnected: true,
      });
      return;
    }
    if (name.startsWith("#")) {
      for (const child of (node as { childNodes?: P5Node[] }).childNodes ?? []) convert(child, parent);
      return;
    }
    const element = node as DefaultTreeAdapterMap["element"];
    const fake: FakeNode = {
      nodeType: 1, nodeName: element.tagName.toUpperCase(), tagName: element.tagName.toUpperCase(),
      attributes: new Map(element.attrs.map((attr) => [attr.name, attr.value])), childNodes: [],
      parentNode: parent, isConnected: true,
    };
    parent.childNodes.push(fake);
    for (const child of element.childNodes) convert(child, fake);
  };
  for (const child of parse(html).childNodes) convert(child, root);
  return root;
}

// ---- selectors -----------------------------------------------------------------------------

interface Compound { tag: string | null; classes: string[]; attrs: { name: string; op: "" | "=" | "*="; value: string }[] }
interface Complex { compounds: Compound[]; combinators: (" " | ">")[] }

const COMPOUND = /^([a-zA-Z][a-zA-Z0-9-]*|\*)?((?:\.[\w-]+|\[[\w-]+(?:\*?="[^"]*")?\])*)$/u;

function parseCompound(text: string): Compound {
  const match = COMPOUND.exec(text);
  if (!match || text.length === 0) throw new Error(`paged-dom: unsupported selector part ${JSON.stringify(text)}`);
  const tag = match[1] && match[1] !== "*" ? match[1].toUpperCase() : null;
  const classes: string[] = [];
  const attrs: Compound["attrs"] = [];
  for (const part of (match[2] ?? "").matchAll(/\.([\w-]+)|\[([\w-]+)(?:(\*?=)"([^"]*)")?\]/gu)) {
    if (part[1]) classes.push(part[1]);
    else attrs.push({ name: part[2]!, op: (part[3] ?? "") as "" | "=" | "*=", value: part[4] ?? "" });
  }
  return { tag, classes, attrs };
}

function parseComplex(text: string): Complex {
  const tokens = text.trim().replace(/\s*>\s*/gu, " > ").split(/\s+/u);
  const compounds: Compound[] = [];
  const combinators: (" " | ">")[] = [];
  let pending: " " | ">" = " ";
  for (const token of tokens) {
    if (token === ">") { pending = ">"; continue; }
    if (compounds.length > 0) combinators.push(pending);
    compounds.push(parseCompound(token));
    pending = " ";
  }
  return { compounds, combinators };
}

const selectorCache = new Map<string, Complex[]>();
function parseSelector(selector: string): Complex[] {
  let parsed = selectorCache.get(selector);
  if (!parsed) {
    parsed = selector.split(",").map(parseComplex);
    selectorCache.set(selector, parsed);
  }
  return parsed;
}

function matchesCompound(node: FakeNode, compound: Compound): boolean {
  if (node.nodeType !== 1) return false;
  if (compound.tag && node.tagName !== compound.tag) return false;
  const classes = (node.attributes.get("class") ?? "").split(/\s+/u).filter(Boolean);
  if (!compound.classes.every((name) => classes.includes(name))) return false;
  return compound.attrs.every(({ name, op, value }) => {
    const actual = node.attributes.get(name);
    if (actual === undefined) return false;
    if (op === "=") return actual === value;
    if (op === "*=") return actual.includes(value);
    return true;
  });
}

function matchesFrom(node: FakeNode, complex: Complex, index: number): boolean {
  if (!matchesCompound(node, complex.compounds[index]!)) return false;
  if (index === 0) return true;
  const combinator = complex.combinators[index - 1]!;
  let ancestor = node.parentNode;
  if (combinator === ">") return ancestor !== null && matchesFrom(ancestor, complex, index - 1);
  for (; ancestor; ancestor = ancestor.parentNode) {
    if (matchesFrom(ancestor, complex, index - 1)) return true;
  }
  return false;
}

export function matches(node: FakeNode, selector: string): boolean {
  return parseSelector(selector).some((complex) => matchesFrom(node, complex, complex.compounds.length - 1));
}

function descendants(root: FakeNode): FakeNode[] {
  const out: FakeNode[] = [];
  const visit = (node: FakeNode): void => {
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue;
      out.push(child);
      visit(child);
    }
  };
  visit(root);
  return out;
}

// ---- style and geometry --------------------------------------------------------------------

const DEFAULT_STYLE: Record<string, string> = {
  display: "block", position: "static", visibility: "visible", fontFamily: "serif", fontSize: "13.33px",
  lineHeight: "18.66px", fontWeight: "400", color: "rgb(0, 0, 0)", backgroundColor: "rgba(0, 0, 0, 0)",
  textDecorationLine: "none", breakBefore: "auto", breakAfter: "auto", breakInside: "auto",
  writingMode: "horizontal-tb", columnCount: "auto", widows: "2", orphans: "2", textAlign: "start",
  wordSpacing: "0px", content: "normal",
};

/**
 * The part of Paged.js' own stylesheet (`polisher/base.js`) that a payload reads back: the page
 * content, the page box and the sheet are positioned, and the sheet clips.
 */
const CLASS_STYLE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  pagedjs_page_content: { position: "relative" },
  pagedjs_pagebox: { position: "relative", display: "grid" },
  pagedjs_sheet: { position: "relative", overflow: "hidden", display: "grid" },
};

function classStyle(node: FakeNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of (node.attributes.get("class") ?? "").split(/\s+/u)) Object.assign(out, CLASS_STYLE[name] ?? {});
  return out;
}

function inlineStyle(node: FakeNode): Record<string, string> {
  const declared: Record<string, string> = {};
  for (const declaration of (node.attributes.get("style") ?? "").split(";")) {
    const at = declaration.indexOf(":");
    if (at < 0) continue;
    const name = declaration.slice(0, at).trim().replace(/-([a-z])/gu, (_all, c: string) => c.toUpperCase());
    declared[name] = declaration.slice(at + 1).trim();
  }
  return declared;
}

function displayedChain(node: FakeNode): boolean {
  for (let at: FakeNode | null = node; at; at = at.parentNode) {
    if (at.nodeType === 1 && inlineStyle(at).display === "none") return false;
  }
  return true;
}

function boxOf(node: FakeNode): FakeRect {
  if (node.nodeType !== 1 || !displayedChain(node)) return ZERO;
  const authored = node.attributes.get("data-test-box");
  if (!authored) return ZERO;
  const [x, y, width, height] = authored.trim().split(/\s+/u).map(Number);
  return rect(x!, y!, width!, height!);
}

function textContent(node: FakeNode): string {
  if (node.nodeType === 3) return node.data ?? "";
  return node.childNodes.map(textContent).join("");
}

/** The captured-primitive surface the two payloads call, answered from the fake tree. */
export function fakePrimitives(document: FakeNode, hooks: {
  registerPagedHandler?: (handler: unknown) => void;
  installCollector?: (result: () => unknown) => void;
  installIntegrity?: (value: unknown) => void;
  publishOverlay?: (control: unknown) => void;
} = {}): Record<string, unknown> {
  return {
    installed: true,
    all: (root: FakeNode, selector: string) => descendants(root).filter((node) => matches(node, selector)),
    closest: (node: FakeNode | null, selector: string) => {
      for (let at = node; at; at = at.parentNode) if (at.nodeType === 1 && matches(at, selector)) return at;
      return null;
    },
    attr: (node: FakeNode | null, name: string) => node?.attributes.get(name) ?? null,
    hasAttr: (node: FakeNode | null, name: string) => node?.attributes.has(name) ?? false,
    text: (node: FakeNode | null) => (node ? textContent(node) : ""),
    children: (node: FakeNode | null) => (node ? [...node.childNodes] : []),
    nodeType: (node: FakeNode) => node.nodeType,
    parent: (node: FakeNode) => node.parentNode,
    startsWith: (value: unknown, prefix: string) => String(value).startsWith(prefix),
    byId: (id: string) => descendants(document).find((node) => node.attributes.get("id") === id) ?? null,
    rect: (node: FakeNode) => boxOf(node),
    rects: (node: FakeNode) => {
      const box = boxOf(node);
      return box.width > 0 || box.height > 0 ? [box] : [];
    },
    style: (node: FakeNode) => ({ ...DEFAULT_STYLE, ...classStyle(node), ...inlineStyle(node) }),
    // A text node's line box is its parent's box: one line per text node. A hidden text node has
    // none, which is what Range.getClientRects() answers under display: none.
    range: (node: FakeNode, start?: number, end?: number) => {
      const parent = node.parentNode;
      if (!parent || !displayedChain(parent)) return [];
      const box = boxOf(parent);
      if (box.width <= 0 || box.height <= 0) return [];
      if (typeof start === "number" && typeof end === "number") return [rect(box.x, box.y, 4 * (end - start), box.height)];
      return [box];
    },
    painted: () => true,
    styleSheets: () => [],
    sheetHref: () => null,
    sheetRules: () => [],
    ruleCssText: () => "",
    nestedRules: () => [],
    integrityArmLate: () => undefined,
    registerPagedHandler: (_capability: string, handler: unknown) => hooks.registerPagedHandler?.(handler),
    installCollector: (_capability: string, _nonce: string, result: () => unknown) => hooks.installCollector?.(result),
    installIntegrity: (_capability: string, value: unknown) => hooks.installIntegrity?.(value),
    publishOverlay: (_capability: string, control: unknown) => hooks.publishOverlay?.(control),
    randomToken: () => "fake-overlay-capability",
    mutationType: () => "childList",
    mutationAttributeName: () => null,
    // The overlay builds its layer from these. New nodes live in the same fake tree, so a later
    // query sees them exactly as it would see the real layer.
    create: (tag: string): FakeNode => ({
      nodeType: 1, nodeName: tag.toUpperCase(), tagName: tag.toUpperCase(), attributes: new Map(), childNodes: [],
      parentNode: null, isConnected: false,
    }),
    setAttr: (node: FakeNode, name: string, value: string) => { node.attributes.set(name, String(value)); },
    setCssText: (node: FakeNode, value: string) => { node.attributes.set("style", value); },
    setStyle: (node: FakeNode, name: string, value: string, priority?: string) => {
      node.attributes.set("style", `${node.attributes.get("style") ?? ""};${name}:${value}${priority ? " !" + priority : ""}`);
    },
    setText: (node: FakeNode, value: string) => {
      node.childNodes = [{ nodeType: 3, nodeName: "#text", attributes: new Map(), childNodes: [], parentNode: node, data: value, isConnected: true }];
    },
    append: (parent: FakeNode, child: FakeNode) => { child.parentNode = parent; child.isConnected = true; parent.childNodes.push(child); return child; },
    next: (node: FakeNode) => {
      const siblings = node.parentNode?.childNodes ?? [];
      return siblings[siblings.indexOf(node) + 1] ?? null;
    },
    remove: (node: FakeNode) => {
      const parent = node.parentNode;
      if (!parent) return null;
      parent.childNodes = parent.childNodes.filter((child) => child !== node);
      node.parentNode = null;
      return node;
    },
  };
}

// ---- running the real payloads -------------------------------------------------------------

/** Evaluate `SNAPSHOT_SOURCE` (or any payload of that shape) over the fake tree. */
export function evaluatePayload<T>(source: string, document: FakeNode): T {
  const window = { __blPrimitives: fakePrimitives(document) };
  const performance = { getEntriesByType: () => [] };
  const location = { origin: "http://127.0.0.1:0" };
  // The payload is a string by design — it is evaluated inside the document in production — so
  // the only faithful way to run it here is to evaluate the same string.
  return new Function("window", "document", "performance", "location", `return ${source};`)(
    window, document, performance, location,
  ) as T;
}

/**
 * Install the real collector over the fake tree, replay the Paged.js hooks once per page in
 * order — every page reported, a break token on every page but the last — and return what
 * `collectorResult` answers afterwards.
 */
export function runCollector<T>(source: string, document: FakeNode): T {
  let handlerClass: (new () => Record<string, (...args: unknown[]) => void>) | null = null;
  let result: (() => T) | null = null;
  const window = {
    __blPrimitives: fakePrimitives(document, {
      registerPagedHandler: (handler) => { handlerClass = handler as typeof handlerClass; },
      installCollector: (value) => { result = value as () => T; },
    }),
  };
  class Handler {}
  new Function("window", "Paged", "document", source)(window, { Handler }, document);
  if (!handlerClass || !result) throw new Error("paged-dom: the collector did not register itself");
  const handler = new (handlerClass as new () => Record<string, (...args: unknown[]) => void>)();
  const pages = (window.__blPrimitives.all as (root: FakeNode, selector: string) => FakeNode[])(document, ".pagedjs_page");
  for (const [index, page] of pages.entries()) {
    handler.beforePageLayout!();
    handler.layoutNode!();
    handler.renderNode!();
    handler.afterPageLayout!(page, {}, index < pages.length - 1 ? { token: index } : null);
  }
  handler.afterRendered!();
  return (result as () => T)();
}

/**
 * Install the real source-id integrity payload over the fake tree and return what its `status()`
 * answers now. No mutation is ever observed here: the tree does not change after installation.
 */
export function runIntegrityStatus<T>(source: string, document: FakeNode): T {
  let integrity: { status: () => T } | null = null;
  const window = { __blPrimitives: fakePrimitives(document, { installIntegrity: (value) => { integrity = value as { status: () => T }; } }) };
  class Observer { observe(): void {} }
  new Function("window", "document", "MutationObserver", source)(window, document, Observer);
  if (!integrity) throw new Error("paged-dom: the integrity payload did not install itself");
  return (integrity as { status: () => T }).status();
}

/**
 * Evaluate the real evidence-overlay payload over the fake tree and return the capability-gated
 * controller it publishes, so a caller can drive `install` exactly as `produceEvidence` does.
 */
export function overlayController(source: string, document: FakeNode): {
  capability: string;
  control: (capability: string, action: string) => { value: unknown; unauthorizedCalls: number };
} {
  let control: ((capability: string, action: string) => { value: unknown; unauthorizedCalls: number }) | null = null;
  const window = { __blPrimitives: fakePrimitives(document, { publishOverlay: (value) => { control = value as typeof control; } }) };
  const capability = new Function("window", "document", `return ${source};`)(window, document) as string;
  if (!control) throw new Error("paged-dom: the overlay did not publish its controller");
  return { capability, control };
}

// ---- building the page tree ----------------------------------------------------------------

const MARGIN_LAYOUT: readonly (readonly [string, readonly string[]])[] = [
  ["pagedjs_margin-top-left-corner-holder", ["top-left-corner"]],
  ["pagedjs_margin-top", ["top-left", "top-center", "top-right"]],
  ["pagedjs_margin-top-right-corner-holder", ["top-right-corner"]],
  ["pagedjs_margin-right", ["right-top", "right-middle", "right-bottom"]],
  ["pagedjs_margin-left", ["left-top", "left-middle", "left-bottom"]],
  ["pagedjs_margin-bottom-left-corner-holder", ["bottom-left-corner"]],
  ["pagedjs_margin-bottom", ["bottom-left", "bottom-center", "bottom-right"]],
  ["pagedjs_margin-bottom-right-corner-holder", ["bottom-right-corner"]],
];

/** One `.pagedjs_page` in the Paged.js 0.4.3 structure. Boxes are `[x, y, width, height]`. */
export function pagedPage(input: {
  pageBox: readonly [number, number, number, number];
  contentBox: readonly [number, number, number, number];
  /** Flow content, inside `.pagedjs_page_content > div`. */
  content: string;
  /** Margin-box content by margin name, e.g. `{ "top-center": "<p ...>" }`. */
  margins?: Readonly<Record<string, string>>;
  /** Footnote-area content, inside `.pagedjs_footnote_inner_content`. */
  footnotes?: string;
  /** Clones Paged.js inserts as the first children of the page box (`position: fixed`). */
  fixed?: string;
  /**
   * Attributes on the `.pagedjs_page` element itself. Paged.js copies the break attribute of the
   * first breaking node on a page onto the page element (`breaks.js`, `addBreakAttributes`), so a
   * `closest("[data-break-before]")` from any node on that page answers it.
   */
  pageAttributes?: string;
}): string {
  const box = (value: readonly number[]) => `data-test-box="${value.join(" ")}"`;
  const margins = MARGIN_LAYOUT.map(([holder, names]) =>
    `<div class="${holder}">` + names.map((name) => {
      const content = input.margins?.[name] ?? "";
      return `<div class="pagedjs_margin pagedjs_margin-${name}${content ? " hasContent" : ""}">` +
        `<div class="pagedjs_margin-content">${content}</div></div>`;
    }).join("") + "</div>").join("");
  return `<div class="pagedjs_page" ${input.pageAttributes ?? ""} ${box(input.pageBox)}><div class="pagedjs_sheet"><div class="pagedjs_pagebox">` +
    (input.fixed ?? "") + margins +
    `<div class="pagedjs_area"><div class="pagedjs_page_content" ${box(input.contentBox)}><div>${input.content}</div></div>` +
    `<div class="pagedjs_footnote_area"><div class="pagedjs_footnote_content"><div class="pagedjs_footnote_inner_content">` +
    `${input.footnotes ?? ""}</div></div></div></div></div></div></div>`;
}

/** A whole paginated document: `<div class="pagedjs_pages">` around the pages. */
export function pagedDocument(pages: readonly string[], lang = "en"): FakeNode {
  return fakeDocument(`<!doctype html><html lang="${lang}"><body><div class="pagedjs_pages">${pages.join("")}</div></body></html>`, lang);
}
