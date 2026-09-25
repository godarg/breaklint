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
 * that classify the boundary after page `i` sit in the paginator's source at the node page
 * `i + 1` starts at. `afterPageLayout(i)` hands out that node in the break token, so the collector
 * evaluates the decision there at layout time (see `BreakDecision`), keeps the node, evaluates it
 * again after pagination and compares the two. A difference is not silently preferred one way or the other — it means
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

/**
 * What `shouldBreak()` — Paged.js 0.4.3, `chunker/layout.js` — answers for the node the next page
 * starts at, re-evaluated by the collector from the break token of the page before.
 *
 * WHY THE DECISION AND NOT THE PAGES. Paged.js breaks for a named page when
 * `needsPageBreak(node, nodeBefore(node))` finds that the named page in force at a node (its own
 * `data-page`, else its nearest ancestor's) differs from the one in force at the node BEFORE it —
 * a previous sibling, or an ancestor's previous sibling, whose named page comes from itself and its
 * ancestors and never from its descendants. Two readings of the finished pages were measured wrong
 * against that rule. The page's first node, which on a real document is a wrapper (`<main>`)
 * continuing from the page before, called every boundary inside a named region forced. The
 * `pagedjs_<name>_page` classes on the page element record which `@page` rule a page was styled
 * with, not whether a break was forced: `<div><section style="page: chap">…</section></div><p>`
 * does not break on leaving the section — the paragraph is laid out on the `chap` page — so the
 * next overflow boundary sees a change of page style that no break caused. The same holds for any
 * reading of the rendered edges: an overflow that happens to fall right after such a section puts
 * a `chap` leaf and an unnamed leaf on the two sides of a boundary Paged.js never forced.
 *
 * WHAT IS EVALUATED. The token names the source node the next page starts at, in Paged.js' parsed
 * source, where the break attributes live (`data-break-before`, `data-previous-break-after`,
 * `data-page`). The collector evaluates the three clauses of `shouldBreak()` on it, with the same
 * limiter (the node the page's layout started at), the same previous-significant-node walk and the
 * same early exits — but only for a token at the node the layout walker handed out LAST on the page,
 * which the collector records from the `layoutNode` hook. A forced break is always such a token:
 * layout.js triggers `layoutNode(node)`, asks `shouldBreak(node)`, and on `true` breaks at that node
 * with offset 0. Any other token is an overflow: one with an offset lies inside a node whose start
 * was already asked about; one at a node the walker never handed out — a block inside an element
 * Paged.js deep-clones (`p`, `li`, `td`, `dd`, `dt`, `blockquote`, `h1`-`h6`, `pre`,
 * `figcaption`), which `createBreakToken` can still name — was never asked at all, so its break
 * attributes forced nothing. Measured: a `break-before: page` on a block inside an `<li>`,
 * classified by its attributes alone, turned every overflow at such a block into a false `forced`.
 */
export interface BreakDecision {
  /** False when the token carried no node, so nothing could be evaluated: the boundary is `unknown`. */
  known: boolean;
  /** `data-break-before` of the node when that clause applies (not suppressed as a doubled break), else null. */
  breakBefore: string | null;
  /** `data-previous-break-after` of the node, else null. */
  previousBreakAfter: string | null;
  /**
   * The named pages `needsPageBreak()` compares: the one in force at the node before (`pageBefore`)
   * and at the node (`pageAfter`), null for none. Both null when the comparison does not apply —
   * no node before, an ignorable or undisplayed node, or a token inside a node.
   */
  pageBefore: string | null;
  pageAfter: string | null;
  /** Nearest source id at or above the node, for the reason. */
  sid: string | null;
}

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
   * The paginator's decision at the boundary AFTER this page, re-evaluated from the break token
   * `afterPageLayout` handed out (see `BreakDecision`), at layout time and again after pagination.
   * Null when there is no token: the last page, or a blank page Paged.js inserted for parity.
   */
  decisionAtLayout: BreakDecision | null;
  decisionAfterRender: BreakDecision | null;
  /** Source id of the first and last source-bearing node on the page. */
  firstSid: string | null;
  lastSid: string | null;
  /**
   * Source id of the first source-bearing node that STARTS on the page: the first one without
   * `data-split-from`. The page's first node is often a wrapper continuing from the page before
   * (`<main>`, `<article>`, a section), which is not what opened the page. It names a forced
   * boundary when the decision's own node carries no source id. Null when nothing starts on the
   * page (the middle of one block taller than a page) or the node carries no source id.
   */
  startSid: string | null;
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
    layoutStart: null,
    lastWalked: null,
  };
  const sidOf = (el) => P.attr(el, "data-bl-sid");

  /*
   * shouldBreak(), re-evaluated at a break token. See BreakDecision in collector.ts for why the
   * decision is read here and not from the finished pages. Each function mirrors the Paged.js
   * 0.4.3 function of the same name (utils/dom.js, chunker/layout.js), reading 'dataset.x' as the
   * attribute 'data-x' through the captured primitives. Only elements have a dataset.
   */
  const FORCING = ["always", "page", "left", "right", "recto", "verso"];
  const data = (n, name) => (n && P.nodeType(n) === 1 && P.hasAttr(n, name) ? P.attr(n, name) : null);
  const isIgnorable = (n) => {
    const type = P.nodeType(n);
    return type === 8 || (type === 3 && !/[^\\t\\n\\r ]/.test(P.text(n) || ""));
  };
  const previousSibling = (n) => {
    const parent = P.parent(n);
    if (!parent) return null;
    const siblings = P.children(parent);
    const at = siblings.indexOf(n);
    return at > 0 ? siblings[at - 1] : null;
  };
  const previousSignificantNode = (n) => {
    let sibling = n;
    while ((sibling = previousSibling(sibling))) if (!isIgnorable(sibling)) return sibling;
    return null;
  };
  const nodeBefore = (node, limiter) => {
    if (limiter && node === limiter) return null;
    let significant = previousSignificantNode(node);
    if (significant) return significant;
    let at = node;
    while ((at = P.parent(at))) {
      if (limiter && at === limiter) return null;
      significant = previousSignificantNode(at);
      if (significant) return significant;
    }
    return null;
  };
  // getNodeWithNamedPage: self, then ancestors, stopping at the limiter; a name must be non-empty.
  const nodeWithNamedPage = (node, limiter) => {
    if (data(node, A.page)) return node;
    let at = node;
    while ((at = P.parent(at))) {
      if (limiter && at === limiter) return null;
      if (data(at, A.page)) return at;
    }
    return null;
  };
  // needsPageBreak's own reading of one side: 'dataset.page' if the attribute is present at all
  // (an empty value included), else the named page of the nearest named self-or-ancestor.
  const namedPageOf = (node, limiter) => {
    const own = data(node, A.page);
    if (own !== null) return own;
    const holder = nodeWithNamedPage(node, limiter);
    return holder ? data(holder, A.page) : null;
  };
  const forcing = (value) => value !== null && FORCING.indexOf(value) !== -1;
  const sidAt = (node) => {
    for (let at = node; at; at = P.parent(at)) {
      if (P.nodeType(at) !== 1) continue;
      const sid = data(at, "data-bl-sid");
      if (sid) return sid;
    }
    return null;
  };
  const decide = (token, limiter) => {
    if (!token) return null;
    const node = token.node;
    const none = { known: true, breakBefore: null, previousBreakAfter: null, pageBefore: null, pageAfter: null, sid: null };
    if (!node) return { ...none, known: false };
    none.sid = sidAt(node);
    if (token.offset) return none;
    // A token at a node the walker never handed out on this page is an overflow the paginator
    // placed there (createBreakToken can name a descendant of a deep-cloned element): shouldBreak()
    // was never asked about that node, so nothing was forced there, whatever its attributes say.
    if (!token.walked) return none;
    const previous = nodeBefore(node, limiter);
    const parent = P.parent(node);
    const before = data(node, A.before);
    // A break-before on a first child whose parent carries the same one is the parent's break.
    const doubled = forcing(before) && parent && !previous && forcing(data(parent, A.before)) &&
      before === data(parent, A.before);
    let pageBefore = null;
    let pageAfter = null;
    if (previous && !isIgnorable(node) && !data(node, "data-undisplayed")) {
      pageBefore = namedPageOf(previous, null);
      pageAfter = namedPageOf(node, previous);
    }
    return {
      known: true,
      breakBefore: doubled ? null : before,
      previousBreakAfter: data(node, A.prevAfter),
      pageBefore,
      pageAfter,
      sid: none.sid,
    };
  };

  /**
   * First and last source-bearing nodes on a page, and whether it is blank.
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
    // with data-split-from, so a page inside '<main>' begins with a '<main>' clone that did not
    // open the page. A page on which nothing starts falls back to its first node.
    const start = nodes.find((el) => !P.hasAttr(el, "data-split-from")) || first;
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
      // Blank means no author content: no source id AND no visible text. Both, because a page can
      // carry a paginator-generated wrapper with no sid while still showing text. Margin boxes sit
      // OUTSIDE the content area, so a running header does not make a parity page look occupied —
      // which is intended: the blank page inserted by break-before: recto carries the same running
      // header as every other page. This comment said so before it was true: the text and the
      // visual boxes were read from the content only, but the source nodes from the whole page.
      blank: nodes.length === 0 && text.length === 0 && visual.length === 0,
    };
  };

  // The fields the drift check compares, as scalars. Everything the classifier reads from a page
  // is in here: its edges, and the decision at the boundary after it.
  const DECISION_FIELDS = ["known", "breakBefore", "previousBreakAfter", "pageBefore", "pageAfter", "sid"];
  const driftFields = (e, decision) => {
    const out = { firstSid: e.firstSid, lastSid: e.lastSid, startSid: e.startSid, blank: e.blank, decision: decision !== null };
    for (const field of DECISION_FIELDS) out["decision." + field] = decision ? decision[field] : null;
    return out;
  };

  class BreaklintCollector extends Paged.Handler {
    beforePageLayout(page, contents, breakToken) {
      state.hooks.beforePageLayout++;
      // The node this page's layout starts at: layout.js getStart(), and the limiter it hands to
      // shouldBreak(). A blank page inserted for parity has neither contents nor token.
      state.layoutStart = breakToken && breakToken.node ? breakToken.node : (contents ? P.children(contents)[0] || null : null);
      state.lastWalked = null;
    }
    // layout.js triggers this for every node its walker hands out, immediately before it asks
    // shouldBreak() about that node. The last one is the only node on this page shouldBreak() can
    // have broken at: a node inside an element Paged.js deep-clones (p, li, td, dd, dt, blockquote,
    // h1-h6, pre, figcaption) is never walked and never asked.
    layoutNode(node) { state.hooks.layoutNode++; state.lastWalked = node || null; }
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
      // The token is read NOW, the only moment it exists as an object; the node and limiter are
      // kept so the decision can be evaluated again after pagination and compared.
      const token = breakToken
        ? { node: breakToken.node || null, offset: breakToken.offset || 0, walked: !!breakToken.node && breakToken.node === state.lastWalked }
        : null;
      const limiter = state.layoutStart;
      const decision = decide(token, limiter);
      state.byElement.set(pageElement, {
        hasBreakToken: !!breakToken,
        token,
        limiter,
        decisionAtLayout: decision,
        // Everything the classifier reads is snapshotted and compared after pagination. An audit
        // found the drift check covering only some of the fields, so an author handler that
        // rewrote one of the others produced a false forced while attributeDrift stayed empty.
        driftAtLayout: driftFields(e, decision),
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
      const decision = rec ? decide(rec.token, rec.limiter) : null;
      if (rec && rec.driftAtLayout) {
        const now = driftFields(e, decision);
        for (const field of Object.keys(now)) {
          if (rec.driftAtLayout[field] !== now[field]) {
            drift.push({ index, field, atLayout: String(rec.driftAtLayout[field]), afterRender: String(now[field]) });
          }
        }
      }
      return {
        index,
        reconciled: !!rec,
        hasBreakToken: rec ? rec.hasBreakToken : false,
        decisionAtLayout: rec ? rec.decisionAtLayout : null,
        decisionAfterRender: decision,
        firstSid: e.firstSid,
        lastSid: e.lastSid,
        startSid: e.startSid,
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
  decisionKnown: boolean;
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
    // The decision belongs to the page BEFORE the boundary: it was evaluated at that page's break
    // token, the node the page after starts at.
    const decision = known ? before.decisionAfterRender : null;
    facts.push({
      nextPageBlank: known ? after.blank : false,
      breakBefore: decision?.breakBefore ?? null,
      previousBreakAfter: decision?.previousBreakAfter ?? null,
      pageBefore: decision?.pageBefore ?? null,
      pageAfter: decision?.pageAfter ?? null,
      decisionKnown: known ? decision !== null && decision.known : true,
      // The token belongs to the page BEFORE the boundary: it is what that page could not fit.
      hasBreakToken: known ? before.hasBreakToken : false,
      sidBefore: before.lastSid,
      // The node the decision was taken at, else the first node that starts the page after —
      // never a wrapper continuing onto it.
      sidAfter: decision?.sid ?? after.startSid ?? after.firstSid,
      cascadeHint: (after.firstSid ? cascadeHints[after.firstSid] : null) ?? null,
    });
  }
  return facts;
}
