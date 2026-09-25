/**
 * The collector: what the paginator did, recorded while it was doing it.
 *
 * It observes and never intervenes. Every number it produces comes from the tree Paged.js wrote or
 * from an argument Paged.js handed to a hook; nothing here changes a style, moves a node or forces
 * a relayout.
 *
 * THE HOOKS ARE COUNTED, AND THAT IS A BUILD REQUIREMENT RATHER THAN DIAGNOSTICS. Paged.js wires
 * handlers by bare METHOD-NAME EQUALITY — there is no interface, no registration list, no error for
 * a name it does not recognise. A typo in `afterPageLayout` is a silent no-op, and the result of a
 * silent no-op here is a document with no break tokens, every boundary classified `unknown`, and a
 * clean-looking report. The worst outcome a checker can produce is a green run that measured
 * nothing, so the run refuses when a hook it registered never fired.
 *
 * TOKENS ARE TAKEN AT DECISION TIME. `afterPageLayout` is handed the break token for the page it
 * just finished; that is the only moment it exists as an object rather than as an inference. This
 * is the half of Gemini's A4 that is actually available.
 *
 * THE OTHER HALF OF A4, AND WHY IT BECAME A CHECK INSTEAD OF A MOVE. A4 proposed reading the break
 * ATTRIBUTES at decision time too, closing the window in which an author script could alter them
 * between the layout decision and the reading. That cannot be done as proposed: the attributes
 * that classify the boundary after page `i` sit on the node that starts page `i + 1`, which does
 * not exist yet when `afterPageLayout(i)` runs. So instead of moving the read, the collector takes
 * a SNAPSHOT of each page's start-node attributes and applied named pages at layout time and
 * compares it with the values read after pagination. A difference is not silently preferred one way or the other — it means
 * the tree changed under the measurement, and the run reports `document-not-quiescent`. The window
 * is not closed; it is made observable, which is the honest version of the same intent.
 *
 * RECONCILIATION IS BOUND TO NODE IDENTITY. Page numbers are useless as keys — Paged.js discards
 * and re-lays pages, so page 3 of the first attempt need not be page 3 of the result. Records are
 * kept only for page elements that are in the FINAL page list and still `isConnected`; anything
 * else is dropped and counted. Both halves matter: dropping without counting is a filter that
 * discards silently, which is a failure shape this project has already paid for once.
 */

import type { BreakCauseCascadeHint } from "../core/enums.ts";

/** One page as the collector saw it while the paginator was working. */
export interface CollectedPage {
  /** Position in the FINAL page list. Not a key — a result. */
  index: number;
  /**
   * Whether `afterPageLayout` ever reported this page.
   *
   * False means the page is in the final list and the paginator never told us about it — a page
   * inserted after `afterRendered`, or a per-page hook loss the global hook count cannot see
   * because other pages' hooks fired. Its boundaries are `unknown`, never inferred from whatever
   * attributes happen to sit on it.
   */
  reconciled: boolean;
  /** True when `afterPageLayout` handed out a break token for this page. */
  hasBreakToken: boolean;
  /**
   * The break attributes of the node that starts the page (`startSid`), and the named page the page
   * starts in, read at layout time.
   */
  attributesAtLayout: { breakBefore: string | null; previousBreakAfter: string | null; page: string | null };
  /** The same, read after pagination finished. A mismatch means the tree moved. */
  attributesAfterRender: { breakBefore: string | null; previousBreakAfter: string | null; page: string | null };
  /** Source id of the first and last source-bearing node on the page. */
  firstSid: string | null;
  lastSid: string | null;
  /**
   * Source id of the first source-bearing node that STARTS on the page: the first one without
   * `data-split-from`. The page's first node is often a wrapper continuing from the page before
   * (`<main>`, `<article>`, a section), which is not what opened the page; the break attributes
   * and the reason of a forced boundary are read from this node instead. Null when nothing starts
   * on the page (the middle of one block taller than a page) or the node carries no source id.
   */
  startSid: string | null;
  /**
   * The named pages Paged.js APPLIED to this page, sorted: every `name` for which the page element
   * carries the class `pagedjs_<name>_page` and the page area holds an element with
   * `data-page="<name>"`. Usually zero or one. See `appliedNamedPages` in the payload.
   */
  namedPages: string[];
  /**
   * The named page the page ENDS in — what the next boundary compares its own starting named page
   * against. The start is `attributesAfterRender.page`. Both are the single applied name when the
   * page carries one; a page carrying several is resolved per side, and `namedPageResolved` says
   * whether that worked.
   */
  pageAtEnd: string | null;
  namedPageResolved: { start: boolean; end: boolean };
  /** No author content at all: no source id, no visible text. */
  blank: boolean;
  /** The generation this page belongs to, so a re-laid page is distinguishable from a kept one. */
  epoch: number;
}

export interface CollectorResult {
  pages: CollectedPage[];
  /** How many times each registered hook fired. A zero anywhere is fatal. */
  hooks: Record<string, number>;
  /** Records whose page element was not in the final list or not connected. Counted, not hidden. */
  discardedRecords: number;
  /** Final pages the paginator never reported. Fatal for those pages' boundaries, not ignorable. */
  unreconciledPages: number;
  /** Pages whose attributes differed between layout time and after rendering. */
  attributeDrift: { index: number; field: string; atLayout: string | null; afterRender: string | null }[];
  /** Highest `epoch` seen. More than one means the paginator re-laid at least one page. */
  epochCount: number;
}

/** The hooks the collector registers, and therefore the hooks that must have fired. */
export const REQUIRED_HOOKS = ["beforePageLayout", "layoutNode", "renderNode", "afterPageLayout", "afterRendered"] as const;

/**
 * Which hooks never fired.
 *
 * Kept as a named function rather than inline so a unit test can drive it: a browser cannot be
 * asked to skip a hook, and this is exactly the branch whose absence would make everything else
 * meaningless.
 */
export function silentHooks(hooks: Readonly<Record<string, number>>): string[] {
  // `?? 0` rather than a truthiness test on a possibly-absent key: a hook name that is MISSING
  // from the record and one that fired zero times must both count as silent, and `undefined > 0`
  // and `0 > 0` are both false only by accident of coercion. Stated explicitly.
  return REQUIRED_HOOKS.filter((name) => (hooks[name] ?? 0) <= 0);
}

/**
 * The content area of a Paged.js 0.4.3 page: the `.pagedjs_area` child of the page box, holding
 * `.pagedjs_page_content` and `.pagedjs_footnote_area`. A source node is part of the flow if and
 * only if it lies inside it. The rest of a page box is margin boxes, into which Paged.js clones
 * every `position: running(...)` element on every page, and `position: fixed` clones, which it
 * inserts as the first children of every page box. The collector and `SNAPSHOT_SOURCE` both
 * interpolate this one constant, so the two payloads cannot disagree about what is in the flow.
 */
export const PAGE_AREA_SELECTOR = ".pagedjs_pagebox > .pagedjs_area";

/**
 * The in-page collector.
 *
 * Registered BEFORE `new Paged.Previewer().preview()` runs, which the loader guarantees by
 * inserting this script ahead of the document's own pagination call. Everything it reads goes
 * through the captured primitives, so an author script replacing `querySelectorAll` cannot make
 * the collector see a different document from the one being rendered.
 */
const COLLECTOR_CAPABILITY_MARKER = "__BREAKLINT_COLLECTOR_CAPABILITY__";
const COLLECTOR_NONCE_MARKER = "__BREAKLINT_COLLECTOR_NONCE__";

const COLLECTOR_TEMPLATE = `(() => {
  const P = window.__blPrimitives;
  const A = { before: "data-break-before", prevAfter: "data-previous-break-after", page: "data-page" };
  const PAGE_AREA_SELECTOR = ${JSON.stringify(PAGE_AREA_SELECTOR)};
  const SOURCE_BLOCK_SELECTOR = "[data-bl-sid],address[data-ref],article[data-ref],aside[data-ref],blockquote[data-ref],caption[data-ref],dd[data-ref],details[data-ref],div[data-ref],dl[data-ref],dt[data-ref],fieldset[data-ref],figcaption[data-ref],figure[data-ref],footer[data-ref],form[data-ref],h1[data-ref],h2[data-ref],h3[data-ref],h4[data-ref],h5[data-ref],h6[data-ref],header[data-ref],hgroup[data-ref],hr[data-ref],li[data-ref],main[data-ref],nav[data-ref],ol[data-ref],p[data-ref],pre[data-ref],section[data-ref],summary[data-ref],table[data-ref],tbody[data-ref],td[data-ref],tfoot[data-ref],th[data-ref],thead[data-ref],tr[data-ref],ul[data-ref]";

  const state = {
    hooks: { beforePageLayout: 0, layoutNode: 0, renderNode: 0, afterPageLayout: 0, afterRendered: 0 },
    // Keyed by the page ELEMENT, never by a page number: the paginator discards and re-lays pages,
    // so a number is not an identity. A Map on the node survives that; an index does not.
    byElement: new Map(),
    order: [],
    epoch: 0,
    discarded: 0,
  };
  const sidOf = (el) => P.attr(el, "data-bl-sid");

  /**
   * The named page in force at a node — SELF OR NEAREST ANCESTOR. Used only to choose between the
   * names Paged.js applied to a page, never as a source of a name (see appliedNamedPages).
   *
   * Measured, and this cost a real defect: a named region is usually declared on a container
   * ('section.chapter { page: chapter }'), and Paged.js puts 'data-page' on the SECTION. The
   * paragraphs inside it carry none, so the leaf alone reads null in the middle of the region.
   */
  const pageNameAt = (el) => {
    if (!el) return null;
    const holder = P.closest(el, "[" + A.page + "]");
    return holder ? P.attr(holder, A.page) : null;
  };

  /**
   * The named pages Paged.js APPLIED to a page, read from the page element.
   *
   * Paged.js 0.4.3 records a named page on the page element as classes, never as 'data-page':
   * atpage.js (beforePageLayout) adds 'pagedjs_named_page' and 'pagedjs_<name>_page' for the
   * innermost named ancestor of the element the page starts with, and layout.js adds the same two
   * for every element with 'data-page' it lays out on the page. Those classes are what its '@page
   * <name>' rules match, so they are the named page the page actually got.
   *
   * THE NODE-BASED READ THIS REPLACES WAS WRONG IN BOTH DIRECTIONS. It took the name from the
   * page's first source-bearing node, which is very often a wrapper continuing from the page
   * before ('<main>', '<article>'): a clone of an element that has no named ancestor. Every page
   * inside a named region then read null against the previous page's named last node — a false
   * 'forced' on each boundary inside the region — and the boundary INTO the region read null
   * against null and was missed. Measured on a self-authored report with a landscape region.
   *
   * The class alone is not enough, because the class vocabulary is shared: a page named 'first',
   * 'left', 'right', 'blank' or 'named' produces a class Paged.js also writes for other reasons
   * ('pagedjs_named_page' is on EVERY named page). So a name counts only when the page area also
   * holds an element carrying it in 'data-page' — the element Paged.js applied it from, or its
   * rebuilt clone. The element is the evidence that the name exists; the class is the evidence
   * that it was applied to THIS page.
   */
  const appliedNamedPages = (pageEl) => {
    const classes = (P.attr(pageEl, "class") || "").split(/\\s+/u);
    const names = [];
    for (const el of P.all(pageEl, "[" + A.page + "]")) {
      if (P.closest(el, PAGE_AREA_SELECTOR) === null) continue;
      const name = P.attr(el, A.page);
      if (!name || names.indexOf(name) !== -1) continue;
      if (classes.indexOf("pagedjs_" + name + "_page") !== -1) names.push(name);
    }
    return names.sort();
  };

  /**
   * First and last source-bearing nodes on a page, plus their break attributes.
   *
   * --no-source-map deliberately injects no data-bl-sid. Paged.js still leaves data-ref
   * on source clones, so that path can measure boundaries and blocks with sid:null instead of
   * returning an empty snapshot. The random ref is runtime addressing only and never enters a
   * finding fingerprint.
   */
  const edges = (pageEl) => {
    // Only nodes inside the page's content area (.pagedjs_pagebox > .pagedjs_area: page content
    // and footnote area) are edges of the flow. Paged.js clones a running element into the margin
    // box of every page and a position: fixed element into every page box, and both clones keep
    // the source id. Counted here, a clone made a parity-blank page look occupied, and the margin
    // boxes precede the area in the page box, so it also became the FIRST node of every page.
    // SNAPSHOT_SOURCE applies the same test and refuses a page that has no area at all.
    const nodes = P.all(pageEl, SOURCE_BLOCK_SELECTOR).filter((el) => P.closest(el, PAGE_AREA_SELECTOR) !== null);
    const first = nodes[0] || null;
    const last = nodes.length ? nodes[nodes.length - 1] : null;
    // The node that STARTS the page: the first source-bearing node that is not a continuation.
    // Paged.js rebuilds the ancestors of the element a page starts in and marks each rebuilt clone
    // with data-split-from (and strips its break attributes), so a page inside '<main>' begins with
    // a '<main>' clone. That clone did not open the page and carries none of the attributes that
    // did: read from it, a break-after on a section inside the wrapper was missed, and the reason
    // of every forced boundary named the wrapper. A page on which nothing starts falls back to its
    // first node.
    const start = nodes.find((el) => !P.hasAttr(el, "data-split-from")) || first;
    // Every read below goes through the captured primitives. An audit found this function calling
    // el.getAttribute and el.hasAttribute directly while the header of this file claimed
    // otherwise — and those two decide the break cause, so a replaced getAttribute returning
    // "page" would make every boundary in a document look forced.
    const named = appliedNamedPages(pageEl);
    // One applied name is the page's name at both edges. Several — a named element laid out at
    // the top of a page inside another named region, before any content — are resolved per edge
    // by the name in force at the edge node, and only among the names Paged.js applied; a name it
    // did not apply never enters. If that fails the edge is unresolved, and the boundary is
    // 'unknown' rather than guessed.
    const resolve = (el) => {
      if (named.length <= 1) return { name: named.length ? named[0] : null, resolved: true };
      const name = pageNameAt(el);
      return name !== null && named.indexOf(name) !== -1 ? { name, resolved: true } : { name: null, resolved: false };
    };
    const atStart = resolve(start);
    const atEnd = resolve(last);
    const attrs = (el) => {
      const beforeHolder = el ? P.closest(el, "[" + A.before + "]") : null;
      const afterHolder = el ? P.closest(el, "[" + A.prevAfter + "]") : null;
      return {
      breakBefore: beforeHolder ? P.attr(beforeHolder, A.before) : null,
      previousBreakAfter: afterHolder ? P.attr(afterHolder, A.prevAfter) : null,
      page: atStart.name,
      };
    };
    const content = P.all(pageEl, ".pagedjs_page_content")[0] || pageEl;
    const text = (P.text(content) || "").replace(/\\s+/g, " ").trim();
    const visual = P.all(content, "img,svg,canvas,video,table").filter((el) => {
      const style = P.style(el, null);
      const box = P.rect(el);
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
    });
    return {
      firstSid: sidOf(first),
      lastSid: sidOf(last),
      startSid: sidOf(start),
      attrs: attrs(start),
      namedPages: named,
      pageAtEnd: atEnd.name,
      namedPageResolved: { start: atStart.resolved, end: atEnd.resolved },
      // Blank means no author content: no source id AND no visible text. Both, because a page can
      // carry a paginator-generated wrapper with no sid while still showing text. Margin boxes sit
      // OUTSIDE the content area, so a running header does not make a parity page look occupied —
      // which is intended: the blank page inserted by break-before: recto carries the same running
      // header as every other page. This comment said so before it was true: the text and the
      // visual boxes were read from the content only, but the source nodes from the whole page.
      blank: nodes.length === 0 && text.length === 0 && visual.length === 0,
    };
  };

  // The edge fields the drift check compares, as scalars: the applied names joined, the resolution
  // as two flags. Everything the classifier reads from a page is in here or in attrs.
  const edgeFields = (e) => ({
    pageAtEnd: e.pageAtEnd, firstSid: e.firstSid, lastSid: e.lastSid, startSid: e.startSid, blank: e.blank,
    namedPages: e.namedPages.join(" "), namedPageStartResolved: e.namedPageResolved.start,
    namedPageEndResolved: e.namedPageResolved.end,
  });

  class BreaklintCollector extends Paged.Handler {
    beforePageLayout() { state.hooks.beforePageLayout++; }
    layoutNode() { state.hooks.layoutNode++; }
    renderNode() { state.hooks.renderNode++; }
    afterPageLayout(pageElement, page, breakToken) {
      state.hooks.afterPageLayout++;
      if (!pageElement) { state.discarded++; return; }
      const seen = state.byElement.get(pageElement);
      // A page element seen twice is a RE-LAY, not a second page. The record is replaced and the
      // generation counter moves, so the snapshot can say how many generations it took.
      if (seen) state.epoch++;
      else state.order.push(pageElement);
      const e = edges(pageElement);
      state.byElement.set(pageElement, {
        hasBreakToken: !!breakToken,
        attributesAtLayout: e.attrs,
        // The LEFT-hand edge fields are snapshotted too. An audit found the drift check covering
        // only the first node's three attributes, so an author handler that rewrote the PREVIOUS
        // page's last node to data-page="spoofed" produced a false forced while
        // attributeDrift stayed empty — the mutated field had never been recorded to compare
        // against. Everything the classifier reads is now compared.
        edgeAtLayout: edgeFields(e),
        epoch: state.epoch,
      });
    }
    afterRendered() {
      state.hooks.afterRendered++;
      P.integrityArmLate("${COLLECTOR_CAPABILITY_MARKER}");
    }
  }
  P.registerPagedHandler("${COLLECTOR_CAPABILITY_MARKER}", BreaklintCollector);

  /** Called after pagination. Reconciles against the FINAL page list and re-reads the attributes. */
  const collectorResult = () => {
    const finalPages = P.all(document, ".pagedjs_page");
    const finalSet = new Set(finalPages);
    let discarded = state.discarded;
    for (const el of state.order) {
      if (!finalSet.has(el) || !el.isConnected) discarded++;
    }
    const drift = [];
    let unreconciled = 0;
    const pages = finalPages.map((el, index) => {
      const rec = state.byElement.get(el);
      const e = edges(el);
      // A final page with NO layout record is not a page with default values. An audit found this
      // branch fabricating { hasBreakToken: false, attributesAtLayout: null, epoch: 0 } and
      // counting it nowhere, so a page inserted after afterRendered — or one whose hook was lost
      // while other pages' hooks still fired, which the global hook count cannot see — was
      // classified from its attributes as if the paginator had reported it. It is counted now, and
      // reconciled: false forces its boundaries to unknown rather than to a guess.
      if (!rec) unreconciled += 1;
      if (rec && rec.attributesAtLayout) {
        for (const field of ["breakBefore", "previousBreakAfter", "page"]) {
          if (rec.attributesAtLayout[field] !== e.attrs[field]) {
            drift.push({ index, field, atLayout: rec.attributesAtLayout[field], afterRender: e.attrs[field] });
          }
        }
      }
      if (rec && rec.edgeAtLayout) {
        const now = edgeFields(e);
        for (const field of Object.keys(now)) {
          if (rec.edgeAtLayout[field] !== now[field]) {
            drift.push({ index, field, atLayout: String(rec.edgeAtLayout[field]), afterRender: String(now[field]) });
          }
        }
      }
      return {
        index,
        reconciled: !!rec,
        hasBreakToken: rec ? rec.hasBreakToken : false,
        attributesAtLayout: rec && rec.attributesAtLayout ? rec.attributesAtLayout : e.attrs,
        attributesAfterRender: e.attrs,
        firstSid: e.firstSid,
        lastSid: e.lastSid,
        startSid: e.startSid,
        namedPages: e.namedPages,
        pageAtEnd: e.pageAtEnd,
        namedPageResolved: e.namedPageResolved,
        blank: e.blank,
        epoch: rec ? rec.epoch : 0,
      };
    });
    return {
      pages,
      hooks: state.hooks,
      discardedRecords: discarded,
      unreconciledPages: unreconciled,
      attributeDrift: drift,
      epochCount: state.epoch + 1,
    };
  };
  P.installCollector("${COLLECTOR_CAPABILITY_MARKER}", "${COLLECTOR_NONCE_MARKER}", collectorResult);
})()`;

export function collectorSource(capability: string, nonce: string): string {
  return COLLECTOR_TEMPLATE
    .replaceAll(COLLECTOR_CAPABILITY_MARKER, capability)
    .replaceAll(COLLECTOR_NONCE_MARKER, nonce);
}

/** Static source retained for payload-level unit assertions; production uses a fresh nonce. */
export const COLLECTOR_SOURCE = collectorSource("breaklint-static-test-capability", "breaklint-static-test-nonce");

/**
 * Turn what the collector saw into the boundary facts the classifier consumes.
 *
 * Separate from both the collection and the classification, and pure, because this is where an
 * off-by-one lives: boundary `i` is between page `i` and page `i + 1`, and it reads the NEXT
 * page's attributes with the PREVIOUS page's token. Getting that backwards would classify every
 * document plausibly and every document wrongly.
 */
export function boundaryFactsFrom(
  pages: readonly CollectedPage[],
  cascadeHints: Readonly<Record<string, BreakCauseCascadeHint | null>> = {},
): {
  nextPageBlank: boolean;
  breakBefore: string | null;
  previousBreakAfter: string | null;
  pageBefore: string | null;
  pageAfter: string | null;
  namedPageResolved: boolean;
  hasBreakToken: boolean;
  sidBefore: string | null;
  sidAfter: string | null;
  cascadeHint: BreakCauseCascadeHint | null;
}[] {
  const facts = [];
  for (let i = 0; i + 1 < pages.length; i += 1) {
    const before = pages[i]!;
    const after = pages[i + 1]!;
    // A boundary between pages the paginator did not both report cannot be classified from
    // attributes: the evidence for it is missing, not merely negative. Stripping the signals
    // yields `unknown` through the normal path, which by §9 invariant 1 suppresses nothing —
    // the direction in which uncertainty is cheap.
    const known = before.reconciled && after.reconciled;
    facts.push({
      nextPageBlank: known ? after.blank : false,
      breakBefore: known ? after.attributesAfterRender.breakBefore : null,
      previousBreakAfter: known ? after.attributesAfterRender.previousBreakAfter : null,
      // The named page the page before ENDS in against the one the page after STARTS in, both
      // from the names Paged.js applied to those pages (their page elements), never from the
      // page's first node — which is often a wrapper continuing from the page before.
      pageBefore: known ? before.pageAtEnd : null,
      pageAfter: known ? after.attributesAfterRender.page : null,
      namedPageResolved: known ? before.namedPageResolved.end && after.namedPageResolved.start : true,
      // The token belongs to the page BEFORE the boundary: it is what that page could not fit.
      hasBreakToken: known ? before.hasBreakToken : false,
      sidBefore: before.lastSid,
      // The node that opened the page, not a wrapper continuing onto it: it is what a reader of a
      // forced boundary's reason has to find.
      sidAfter: after.startSid ?? after.firstSid,
      cascadeHint: (after.firstSid ? cascadeHints[after.firstSid] : null) ?? null,
    });
  }
  return facts;
}
