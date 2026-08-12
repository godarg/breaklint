/**
 * The freeze signature: proof that the page stopped moving before anything was measured.
 *
 * A layout measured while it is still settling is not a measurement of the document, it is a
 * measurement of a moment. So the signature is formed after `afterRendered`, again after a wait,
 * and the two are compared. If they differ the document is still moving and the run retries; after
 * `MAX_STABILITY_RETRIES` it stops with exit 3 and the amount of drift, never with "0 findings".
 *
 * SEVEN COMPONENTS (§11.3). The old signature was paragraph boxes alone and caught 1 drift class
 * of 6. Each component below exists because a measured drift class went undetected without it, and
 * each is separately named in the output so a drift report can say WHICH one moved — a signature
 * that only says "something changed" sends the reader to look at everything.
 *
 * THREE OF THE SEVEN ARE WEAKER THAN §11.3 DESCRIBES, and the measurements are here rather than in
 * a commit message, because a component that cannot vary is worse than an absent one: it looks
 * like coverage.
 *
 *   6. CANVAS CONTENT IS NOT MEASURABLE AT ALL after pagination. Measured on this build: a canvas
 *      drawn on before pagination reports ink (`getImageData` non-zero) and reports EXACTLY ZERO
 *      non-zero bytes afterwards — both in the clone inside the page and in the `<template>` where
 *      Paged.js parks the source. Two independent locations, same answer. §15.1b states the same
 *      thing for the clone. So the content hash in this component is CONSTANT for every document,
 *      and the drift table in §11.3 that claims the new signature detects "canvas content" is
 *      refuted by §15.1b two sections later. What this component actually detects is a canvas
 *      DIMENSION change, which is real and does move layout. The hash is still computed and still
 *      reported — as `canvasInkReadable: false` — so that the day a paginator preserves the bitmap
 *      this turns into a live check instead of staying a comment nobody revisits.
 *
 *   7. MARGIN-BOX CONTENT IS THE DECLARATION, NOT THE RENDERED TEXT. Measured: the content of a
 *      running footer sits in `::after` and `textContent` is empty — which is what §11.3 says, and
 *      it is the reason reading `textContent` alone sees nothing. But `getComputedStyle` returns
 *      `"page " counter(page)` unresolved, IDENTICALLY on every page of a three-page document.
 *      There is no API that returns the rendered text of a pseudo-element. So a page number that
 *      changed between two samples would not move this component. The box does move when the
 *      footer's SIZE changes, and that is what is claimed.
 *
 *   3. The same limit applies to `::before` / `::after` / `::marker` content generally, for the
 *      same reason and with the same consequence.
 *
 * WHY THE COMPOSITION IS SEPARATE FROM THE COLLECTION. `collectParts` runs in the page and needs a
 * browser; `composeSignature` and `awaitStableLayout` are pure and take their input as an
 * argument. That seam is where the unit tests sit — the same shape `evidence.ts` uses, and for the
 * same reason: the branches that decide an outcome must be reachable without a real document,
 * because a real document cannot be made to drift on demand.
 */

import type { PageLike } from "../acquire/browser.ts";

/** §11.3, binding. */
export const STABILITY_WINDOW_MS = 250;
export const MAX_STABILITY_RETRIES = 3;
export const PAGINATION_TIMEOUT_MS = 30_000;
export const DOCUMENT_TIMEOUT_MS = 120_000;
export const MAX_PAGES = 2_000;
export const MAX_DOM_NODES = 500_000;
export const MAX_MUTATIONS_AFTER_RENDERED = 200;
export const MAX_RESOURCE_BYTES = 268_435_456;

/**
 * The seven components, in order. Exported as a literal so a test can assert the set rather than
 * derive it from the thing under test — a table-driven test that computes its expectation from the
 * production list is an oracle drawing its truth from the object it checks, and that exact mistake
 * survived a full battery in this repo once already.
 */
export const FREEZE_COMPONENTS = [
  "pageCount",
  "boxes",
  "pseudo",
  "svgGeometry",
  "replaced",
  "canvas",
  "marginBoxes",
] as const;

export type FreezeComponent = (typeof FREEZE_COMPONENTS)[number];

/** One sample. Each field is the serialised form of one component. */
export type FreezeParts = Record<FreezeComponent, string> & {
  /** False whenever the canvas bitmap could not be read. Measured: always false after pagination. */
  canvasInkReadable: boolean;
};

/**
 * A stable, order-independent digest of one component.
 *
 * FNV-1a rather than a crypto hash: this runs in the page, over every layout-participating element
 * of every page, and it has to be cheap enough to run twice per stability check. It is not a
 * security boundary — it compares two samples of the same document taken 250 ms apart.
 */
export function digest(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The whole-document signature: every component, in the declared order. */
export function composeSignature(parts: FreezeParts): string {
  return FREEZE_COMPONENTS.map((c) => `${c}:${digest(parts[c])}`).join("|");
}

/** Which components differ between two samples. Empty means the layout held still. */
export function driftedComponents(a: FreezeParts, b: FreezeParts): FreezeComponent[] {
  return FREEZE_COMPONENTS.filter((c) => a[c] !== b[c]);
}

/**
 * How far it moved, for `InfraEvent.measured.driftAmount`.
 *
 * Reported as the number of components that changed plus their names. A single number would be
 * the kind of value that looks like a measurement and answers nothing — "drift 3" tells a reader
 * neither what moved nor how much.
 */
export interface Drift {
  components: FreezeComponent[];
  driftAmount: number;
  before: string;
  after: string;
}

export interface StabilityOutcome {
  stable: boolean;
  signature: string;
  /** How many extra samples were needed. 0 means it was still on the first comparison. */
  retries: number;
  /** Present only when `stable` is false. */
  drift: Drift | null;
  /** Always reported, so a reader can tell "readable and unchanged" from "never readable". */
  canvasInkReadable: boolean;
}

export interface StabilityDeps {
  sample: () => Promise<FreezeParts>;
  wait: (ms: number) => Promise<void>;
  windowMs?: number;
  maxRetries?: number;
}

/**
 * Sample, wait, sample again; retry while it moves.
 *
 * Red condition for the retry loop: a `sample` that changes on every call must exhaust the
 * retries and come back `stable: false` with the drifted components named; a `sample` that
 * changes ONCE and then settles must come back `stable: true` with `retries: 1`. Both are unit
 * cases — a real document cannot be asked to drift exactly once.
 */
export async function awaitStableLayout(deps: StabilityDeps): Promise<StabilityOutcome> {
  const windowMs = deps.windowMs ?? STABILITY_WINDOW_MS;
  const maxRetries = deps.maxRetries ?? MAX_STABILITY_RETRIES;

  let previous = await deps.sample();
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    await deps.wait(windowMs);
    const current = await deps.sample();
    const components = driftedComponents(previous, current);
    if (components.length === 0) {
      return {
        stable: true,
        signature: composeSignature(current),
        retries: attempt,
        drift: null,
        canvasInkReadable: current.canvasInkReadable,
      };
    }
    if (attempt === maxRetries) {
      return {
        stable: false,
        signature: composeSignature(current),
        retries: attempt + 1,
        drift: {
          components,
          driftAmount: components.length,
          before: composeSignature(previous),
          after: composeSignature(current),
        },
        canvasInkReadable: current.canvasInkReadable,
      };
    }
    previous = current;
  }
  /* c8 ignore next -- the loop returns on every path; this satisfies the type checker only */
  throw new Error("unreachable");
}

/**
 * The in-page collector.
 *
 * The load-bearing geometry, resource, bitmap and text primitives used here are references captured
 * BEFORE any author script could run (see `src/measure/primitives.ts`), so a document that overwrites `Element.prototype
 * .getBoundingClientRect` cannot feed this synthetic numbers. That is Gemini's A3 finding, taken
 * as far as it goes: the geometry a spot-check can cross-examine is cross-examined out of process
 * against CDP, and the parts that must run in the page say so rather than pretending otherwise.
 */
const FREEZE_CAPABILITY_MARKER = "__BREAKLINT_NODE_CAPABILITY__";

const FREEZE_TEMPLATE = `(() => {
  const P = window.__blPrimitives;
  const rect = (el) => P.rect(el);
  const style = (el, pseudo) => P.style(el, pseudo);
  const round = (n) => Math.round(n * 100) / 100;
  const box = (el) => { const b = rect(el); return round(b.x) + "," + round(b.y) + "," + round(b.width) + "," + round(b.height); };

  const freezeParts = () => {
    const pages = P.all(document, ".pagedjs_page");
    const parts = {};
    parts.pageCount = String(pages.length);

    // 2. every layout-participating element of every page, margin boxes included.
    const boxes = [];
    for (const page of pages) {
      for (const el of P.all(page, "*")) {
        const s = style(el, null);
        if (s.display === "none") continue;
        boxes.push(el.tagName + ":" + box(el));
      }
    }
    parts.boxes = boxes.join(";");

    // 3. generated content. The VALUE is the declaration, not the rendered text -- there is no
    // API for the latter, and a counter() therefore reads identically on every page.
    const pseudo = [];
    for (const page of pages) {
      for (const el of P.all(page, "*")) {
        for (const which of ["::before", "::after", "::marker"]) {
          const s = style(el, which);
          if (!s || s.content === "none" || s.content === "normal") continue;
          pseudo.push(el.tagName + which + "=" + s.content + "|" + s.width + "|" + s.height + "|" + s.paddingLeft);
        }
      }
    }
    parts.pseudo = pseudo.join(";");

    // 4. SVG inner geometry, NORMALISED. Local coordinates would miss every transform on an
    // ancestor, which is the whole class this component exists for.
    const svg = [];
    for (const page of pages) {
      for (const el of P.all(page, "svg *")) {
        let bounds;
        try { bounds = P.svgBounds(el); } catch (e) { svg.push(el.tagName + ":unreadable"); continue; }
        if (!bounds) { svg.push(el.tagName + ":noctm"); continue; }
        svg.push(el.tagName + ":" + round(bounds.first.x) + "," + round(bounds.first.y) + ":" +
          round(bounds.last.x) + "," + round(bounds.last.y));
      }
    }
    parts.svgGeometry = svg.join(";");

    // 5. replaced elements. Geometry alone does not see one image swapped for another of the
    // same size, which is the measured drift class this covers.
    const replaced = [];
    for (const page of pages) {
      for (const el of P.all(page, "img,video,object,iframe")) {
        const measured = P.replaced(el);
        const src = measured.source;
        const natural = measured.naturalWidth + "x" + measured.naturalHeight;
        replaced.push(el.tagName + ":" + src.length + ":" + src.slice(-24) + ":" + natural + ":" + box(el));
      }
    }
    parts.replaced = replaced.join(";");

    // 6. canvas. Dimensions move layout and ARE detected. The bitmap is measured unreadable after
    // pagination -- zero non-zero bytes for a canvas that carried ink before -- so the hash below
    // is constant and canvasInkReadable says so instead of the signature implying otherwise.
    const canvas = [];
    let inkReadable = false;
    for (const page of pages) {
      for (const el of P.all(page, "canvas")) {
        let ink = "unreadable";
        let dimensions = { width: 0, height: 0, data: null };
        try {
          dimensions = P.canvas(el);
          const data = dimensions.data;
          if (data) {
            let nonZero = 0;
            for (let i = 0; i < data.length; i += 1) if (data[i] !== 0) nonZero += 1;
            ink = String(nonZero);
            if (nonZero > 0) inkReadable = true;
          }
        } catch (e) { ink = "tainted"; }
        canvas.push(dimensions.width + "x" + dimensions.height + ":" + box(el) + ":" + ink);
      }
    }
    parts.canvas = canvas.join(";");
    parts.canvasInkReadable = inkReadable;

    // 7. margin boxes: box plus content, read from ::after as well as textContent. Selected by
    // HAVING content rather than by Paged.js's own 'hasContent' class -- a class name is an
    // undocumented internal, and one coupling of that kind (the break attributes) is enough.
    const margins = [];
    for (const page of pages) {
      for (const el of P.all(page, '[class*="pagedjs_margin"]')) {
        const after = style(el, "::after").content;
        const text = P.text(el).replace(/\\s+/g, " ").trim();
        if (after === "none" && text === "") { margins.push(el.className + ":" + box(el)); continue; }
        margins.push(el.className + ":" + box(el) + ":" + after + ":" + text);
      }
    }
    parts.marginBoxes = margins.join(";");

    return parts;
  };
  P.publishFreeze(${FREEZE_CAPABILITY_MARKER}, freezeParts);
})()`;

/** Build the privileged collector source with the per-page Node-held capability. */
export function freezeSource(capability: string): string {
  return FREEZE_TEMPLATE.replace(FREEZE_CAPABILITY_MARKER, JSON.stringify(capability));
}

/** Static test surface; production must use `freezeSource` with the page capability. */
export const FREEZE_SOURCE = freezeSource("breaklint-static-test-capability");

/** Take one sample from a live page. */
export async function sampleParts(page: PageLike): Promise<FreezeParts> {
  return page.evaluate<FreezeParts>("window.__blFreezeParts()");
}
