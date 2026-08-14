/**
 * References to the measuring primitives, captured before any author script can reach them.
 *
 * THE ATTACK THIS CLOSES. Every geometry number in the freeze signature and in the snapshot comes
 * from `getBoundingClientRect`, `getComputedStyle` and `querySelectorAll`, called inside the
 * document being measured. A document that assigns its own function to
 * `Element.prototype.getBoundingClientRect` therefore does not have to change its layout to change
 * the measurement — it can report whatever it likes, and a frozen, drifting page would certify as
 * stable. The tool would print a clean report about a document it never saw.
 *
 * THE FIX AND ITS LIMIT, stated together because the limit is the honest part. This script is
 * installed with `Page.addScriptToEvaluateOnNewDocument`, which CDP runs after the document object
 * exists and BEFORE any script the document itself contains. It copies the primitives onto
 * `window.__blPrimitives` and calls them with the original receivers. An author script that later
 * replaces the prototype method changes what the DOCUMENT sees; it does not change the reference
 * captured here.
 *
 * What this does NOT do is make the measurement out-of-process. A design review proposed exactly
 * that — take everything through CDP and touch nothing in the page — and it is not achievable:
 * the SVG ink passes (§5.0), the `getScreenCTM()` normalisation (§11.3 component 4) and the word
 * boxes (§9) all require execution inside the page. A claim of full isolation would be an
 * unmeasured promise, so the reachable half is taken and the rest is cross-examined instead: a
 * sample of box geometry is checked against CDP's `DOM.getBoxModel`, which is an oracle from a
 * DIFFERENT source than the thing it judges — the browser's own layout tree rather than a
 * scriptable API surface.
 *
 * ORDERING IS THE WHOLE PROPERTY. Installed after the first author script has run, this file is
 * worth nothing at all: it would faithfully capture the replacement. There is a live test that
 * makes that concrete rather than leaving it as a comment.
 */

/**
 * The script CDP evaluates on every new document, before the document's own scripts.
 *
 * `Function.prototype.call` is captured too, and used explicitly — a document that replaces
 * `call` itself could otherwise intercept every invocation below. There is no defence against a
 * document that replaces `Reflect`, `Object.getOwnPropertyDescriptor` and the prototype chain in
 * a worker before this runs, and none is claimed: this raises the cost of the attack, and the
 * raster comparison in `evidence.ts` remains the check that does not run in the page at all.
 */
const TEST_APPARATUS_CAPABILITY = "breaklint-static-test-capability";
const APPARATUS_CAPABILITY_MARKER = "__BREAKLINT_NODE_CAPABILITY__";

const PRIMITIVES_TEMPLATE = `(() => {
  const apparatusCapability = "${APPARATUS_CAPABILITY_MARKER}";
  const call = Function.prototype.call;
  const rectFn = Element.prototype.getBoundingClientRect;
  const rectsFn = Element.prototype.getClientRects;
  const styleFn = window.getComputedStyle;
  const qsaFn = Element.prototype.querySelectorAll;
  const docQsaFn = Document.prototype.querySelectorAll;
  const sliceFn = Array.prototype.slice;
  const startsWithFn = String.prototype.startsWith;
  // Attribute access belongs here for the same reason geometry does. An audit found the break
  // collector calling 'el.getAttribute' and 'el.hasAttribute' directly while its own header claimed
  // everything went through captured references — a comment promising more than the code delivered.
  // Those two methods decide the break cause: a replaced 'getAttribute' returning "page" makes
  // every boundary look forced, which silences four layout rules on a whole document.
  const getAttrFn = Element.prototype.getAttribute;
  const setAttrFn = Element.prototype.setAttribute;
  const hasAttrFn = Element.prototype.hasAttribute;
  const closestFn = Element.prototype.closest;
  const textOf = Object.getOwnPropertyDescriptor(Node.prototype, "textContent").get;
  const textSet = Object.getOwnPropertyDescriptor(Node.prototype, "textContent").set;
  const parentOf = Object.getOwnPropertyDescriptor(Node.prototype, "parentNode").get;
  const nextOf = Object.getOwnPropertyDescriptor(Node.prototype, "nextSibling").get;
  const childrenOf = Object.getOwnPropertyDescriptor(Node.prototype, "childNodes").get;
  const createElementFn = Document.prototype.createElement;
  const appendChildFn = Node.prototype.appendChild;
  const removeChildFn = Node.prototype.removeChild;
  const addEventListenerFn = EventTarget.prototype.addEventListener;
  const definePropertyFn = Object.defineProperty;
  const freezeFn = Object.freeze;
  const randomValuesFn = Crypto.prototype.getRandomValues;
  const numberToStringFn = Number.prototype.toString;
  const padStartFn = String.prototype.padStart;
  const cssTextSet = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, "cssText").set;
  const setPropertyFn = CSSStyleDeclaration.prototype.setProperty;
  const createRangeFn = Document.prototype.createRange;
  const rangeSelectNodeFn = Range.prototype.selectNodeContents;
  const rangeSetStartFn = Range.prototype.setStart;
  const rangeSetEndFn = Range.prototype.setEnd;
  const rangeRectsFn = Range.prototype.getClientRects;
  const imageDecodeFn = HTMLImageElement.prototype.decode;
  const descriptor = Object.getOwnPropertyDescriptor;
  const getter = (prototype, name) => {
    let at = prototype;
    while (at) {
      const found = descriptor(at, name);
      if (found && found.get) return found.get;
      at = Object.getPrototypeOf(at);
    }
    return null;
  };
  const rectXGet = getter(DOMRectReadOnly.prototype, "x");
  const rectYGet = getter(DOMRectReadOnly.prototype, "y");
  const rectWidthGet = getter(DOMRectReadOnly.prototype, "width");
  const rectHeightGet = getter(DOMRectReadOnly.prototype, "height");
  const rectTopGet = getter(DOMRectReadOnly.prototype, "top");
  const rectRightGet = getter(DOMRectReadOnly.prototype, "right");
  const rectBottomGet = getter(DOMRectReadOnly.prototype, "bottom");
  const rectLeftGet = getter(DOMRectReadOnly.prototype, "left");
  const rectValue = (value) => ({
    x: call.call(rectXGet, value), y: call.call(rectYGet, value),
    width: call.call(rectWidthGet, value), height: call.call(rectHeightGet, value),
    top: call.call(rectTopGet, value), right: call.call(rectRightGet, value),
    bottom: call.call(rectBottomGet, value), left: call.call(rectLeftGet, value),
  });
  const rectValues = (list) => {
    const raw = call.call(sliceFn, list), out = [];
    for (let index = 0; index < raw.length; index += 1) out[index] = rectValue(raw[index]);
    return out;
  };
  const styleGet = getter(HTMLElement.prototype, "style");
  const fontsGet = getter(Document.prototype, "fonts");
  const fontReadyGet = getter(FontFaceSet.prototype, "ready");
  const fontIteratorFn = FontFaceSet.prototype[Symbol.iterator];
  const fontIterator = call.call(fontIteratorFn, call.call(fontsGet, document));
  const fontIteratorNextFn = fontIterator.next;
  const fontStatusGet = getter(FontFace.prototype, "status");
  const fontFamilyGet = getter(FontFace.prototype, "family");
  const imageCurrentSrcGet = getter(HTMLImageElement.prototype, "currentSrc");
  const imageSrcGet = getter(HTMLImageElement.prototype, "src");
  const imageNaturalWidthGet = getter(HTMLImageElement.prototype, "naturalWidth");
  const imageNaturalHeightGet = getter(HTMLImageElement.prototype, "naturalHeight");
  const videoCurrentSrcGet = getter(HTMLMediaElement.prototype, "currentSrc");
  const videoSrcGet = getter(HTMLMediaElement.prototype, "src");
  const objectDataGet = getter(HTMLObjectElement.prototype, "data");
  const frameSrcGet = getter(HTMLIFrameElement.prototype, "src");
  const svgBBoxFn = SVGGraphicsElement.prototype.getBBox;
  const svgScreenCtmFn = SVGGraphicsElement.prototype.getScreenCTM;
  const DOMPointCtor = DOMPoint;
  const matrixTransformFn = DOMPoint.prototype.matrixTransform;
  const canvasContextFn = HTMLCanvasElement.prototype.getContext;
  const canvasWidthGet = getter(HTMLCanvasElement.prototype, "width");
  const canvasHeightGet = getter(HTMLCanvasElement.prototype, "height");
  const imageDataFn = CanvasRenderingContext2D.prototype.getImageData;
  const imageDataGet = getter(ImageData.prototype, "data");
  const styleSheetsGet = getter(Document.prototype, "styleSheets");
  const adoptedStyleSheetsGet = getter(Document.prototype, "adoptedStyleSheets");
  const sheetHrefGet = getter(StyleSheet.prototype, "href");
  const sheetRulesGet = getter(CSSStyleSheet.prototype, "cssRules");
  const ruleCssTextGet = getter(CSSRule.prototype, "cssText");
  const groupingRulesGet = typeof CSSGroupingRule === "undefined" ? null : getter(CSSGroupingRule.prototype, "cssRules");
  const mutationTypeGet = getter(MutationRecord.prototype, "type");
  const mutationAttributeNameGet = getter(MutationRecord.prototype, "attributeName");
  let integrity = null;
  let collector = null;
  let pagedCapture = null;
  const capturePaged = (value) => {
      if (pagedCapture !== null || !value || typeof value.Previewer !== "function" ||
          typeof value.Handler !== "function" || typeof value.registerHandlers !== "function") {
        throw new Error("breaklint Paged.js apparatus export rejected");
      }
      pagedCapture = call.call(freezeFn, Object, {
        value,
        Previewer: value.Previewer,
        Handler: value.Handler,
        registerHandlers: value.registerHandlers,
      });
      // Registration is an apparatus capability too: an author handler installed in the interval
      // after bundle export but before Node setup can falsify transient Paged hook data. Keep the
      // captured original for Node-only registration and make the public entry fail closed.
      definePropertyFn(value, "registerHandlers", {
        value: () => { throw new Error("breaklint Paged.js handler registration rejected"); },
        writable: false,
        configurable: false,
        enumerable: true,
      });
  };
  const requireCapability = (candidate) => {
    if (candidate !== apparatusCapability) throw new Error("breaklint apparatus capability rejected");
  };

  Object.defineProperty(window, "__blPrimitives", {
    value: call.call(freezeFn, Object, {
      rect: (el) => rectValue(call.call(rectFn, el)),
      rects: (el) => rectValues(call.call(rectsFn, el)),
      style: (el, pseudo) => call.call(styleFn, window, el, pseudo),
      all: (root, selector) => {
        const fn = root === document ? docQsaFn : qsaFn;
        return call.call(sliceFn, call.call(fn, root, selector));
      },
      startsWith: (value, prefix) => call.call(startsWithFn, String(value), prefix),
      attr: (el, name) => (el ? call.call(getAttrFn, el, name) : null),
      setAttr: (el, name, value) => call.call(setAttrFn, el, name, value),
      hasAttr: (el, name) => (el ? call.call(hasAttrFn, el, name) === true : false),
      closest: (el, selector) => (el ? call.call(closestFn, el, selector) : null),
      text: (node) => (node ? call.call(textOf, node) : ""),
      setText: (node, value) => call.call(textSet, node, value),
      parent: (node) => call.call(parentOf, node),
      next: (node) => call.call(nextOf, node),
      children: (node) => (node ? call.call(sliceFn, call.call(childrenOf, node)) : []),
      create: (tag) => call.call(createElementFn, document, tag),
      append: (parent, child) => call.call(appendChildFn, parent, child),
      remove: (node) => { const parent = call.call(parentOf, node); return parent ? call.call(removeChildFn, parent, node) : null; },
      setCssText: (el, value) => call.call(cssTextSet, call.call(styleGet, el), value),
      setStyle: (el, name, value, priority) => call.call(setPropertyFn, call.call(styleGet, el), name, value, priority),
      on: (target, name, listener, options) => call.call(addEventListenerFn, target, name, listener, options),
      invoke0: (fn, receiver) => call.call(fn, receiver),
      installIntegrity: (capability, value) => {
        requireCapability(capability);
        if (integrity !== null) throw new Error("breaklint integrity apparatus installed twice");
        integrity = call.call(freezeFn, Object, value);
      },
      integrityArmLate: (capability) => { requireCapability(capability); return integrity.armLate(); },
      integrityRecordPreview: (capability) => { requireCapability(capability); return integrity.recordPreview(); },
      integrityStatus: (capability) => { requireCapability(capability); return integrity.status(); },
      installCollector: (capability, nonce, value) => {
        requireCapability(capability);
        if (collector !== null) throw new Error("breaklint collector installed twice");
        collector = call.call(freezeFn, Object, { nonce, value });
      },
      collectorResult: (capability, nonce) => {
        requireCapability(capability);
        if (!collector || collector.nonce !== nonce) throw new Error("breaklint collector identity rejected");
        return collector.value();
      },
      pagedSentinel: () => true,
      capturePaged: (value) => capturePaged(value),
      pagedApparatus: (capability) => {
        requireCapability(capability);
        if (!pagedCapture) throw new Error("breaklint Paged.js bundle was not captured");
        return pagedCapture;
      },
      registerPagedHandler: (capability, handler) => {
        requireCapability(capability);
        if (!pagedCapture || typeof handler !== "function") throw new Error("breaklint Paged.js handler rejected");
        return call.call(pagedCapture.registerHandlers, pagedCapture.value, handler);
      },
      lockPagination: (capability, target, name, value) => {
        requireCapability(capability);
        if (target !== pagedCapture?.Previewer?.prototype || name !== "preview") {
          throw new Error("breaklint pagination lock target rejected");
        }
        return call.call(definePropertyFn, Object, target, name, {
          value, writable: false, configurable: false, enumerable: false,
        });
      },
      lockPreviewer: (capability, target, name, value) => {
        requireCapability(capability);
        if (target !== pagedCapture?.value || name !== "Previewer" || value !== pagedCapture.Previewer) {
          throw new Error("breaklint Previewer lock target rejected");
        }
        return call.call(definePropertyFn, Object, target, name, {
          value, writable: false, configurable: false, enumerable: false,
        });
      },
      publishFreeze: (capability, value) => {
        requireCapability(capability);
        return call.call(definePropertyFn, Object, window, "__blFreezeParts", {
          value, writable: false, configurable: false, enumerable: false,
        });
      },
      publishOverlay: (capability, value) => {
        requireCapability(capability);
        return call.call(definePropertyFn, Object, window, "__blOverlayControl", {
          value, writable: false, configurable: false, enumerable: false,
        });
      },
      mutationType: (record) => call.call(mutationTypeGet, record),
      mutationAttributeName: (record) => call.call(mutationAttributeNameGet, record),
      randomToken: () => {
        const words = new Uint32Array(4);
        call.call(randomValuesFn, window.crypto, words);
        let token = "";
        for (let index = 0; index < words.length; index += 1) {
          token += call.call(padStartFn, call.call(numberToStringFn, words[index], 16), 8, "0");
        }
        return token;
      },
      decodeImage: (image) => call.call(imageDecodeFn, image),
      imageUri: (image) => call.call(imageCurrentSrcGet, image) || call.call(imageSrcGet, image) || "",
      fonts: () => call.call(fontsGet, document),
      fontsReady: (set) => call.call(fontReadyGet, set),
      fontFaces: (set) => {
        const out = [];
        const iterator = call.call(fontIteratorFn, set);
        while (true) {
          const item = call.call(fontIteratorNextFn, iterator);
          if (item.done) return out;
          out.push(item.value);
        }
      },
      fontStatus: (face) => call.call(fontStatusGet, face),
      fontFamily: (face) => call.call(fontFamilyGet, face),
      svgBounds: (el) => {
        const bb = call.call(svgBBoxFn, el);
        const matrix = call.call(svgScreenCtmFn, el);
        if (!matrix) return null;
        const point = (x, y) => call.call(matrixTransformFn, new DOMPointCtor(x, y), matrix);
        return { bb, first: point(bb.x, bb.y), last: point(bb.x + bb.width, bb.y + bb.height) };
      },
      replaced: (el) => {
        const tag = el.tagName;
        if (tag === "IMG") return { source: call.call(imageCurrentSrcGet, el) || call.call(imageSrcGet, el) || "",
          naturalWidth: call.call(imageNaturalWidthGet, el), naturalHeight: call.call(imageNaturalHeightGet, el) };
        if (tag === "VIDEO") return { source: call.call(videoCurrentSrcGet, el) || call.call(videoSrcGet, el) || "",
          naturalWidth: 0, naturalHeight: 0 };
        if (tag === "OBJECT") return { source: call.call(objectDataGet, el) || "", naturalWidth: 0, naturalHeight: 0 };
        return { source: call.call(frameSrcGet, el) || "", naturalWidth: 0, naturalHeight: 0 };
      },
      canvas: (el) => {
        const width = call.call(canvasWidthGet, el), height = call.call(canvasHeightGet, el);
        try {
          const context = call.call(canvasContextFn, el, "2d");
          const image = call.call(imageDataFn, context, 0, 0, width, height);
          return { width, height, data: call.call(imageDataGet, image) };
        } catch (_) {
          // Layout dimensions remain measurable even when the bitmap is tainted/unreadable.
          return { width, height, data: null };
        }
      },
      styleSheets: () => {
        const regular = call.call(sliceFn, call.call(styleSheetsGet, document));
        const adopted = adoptedStyleSheetsGet ? call.call(sliceFn, call.call(adoptedStyleSheetsGet, document)) : [];
        return regular.concat(adopted);
      },
      sheetHref: (sheet) => call.call(sheetHrefGet, sheet),
      sheetRules: (sheet) => call.call(sliceFn, call.call(sheetRulesGet, sheet)),
      ruleCssText: (rule) => call.call(ruleCssTextGet, rule),
      nestedRules: (rule) => groupingRulesGet ? call.call(sliceFn, call.call(groupingRulesGet, rule)) : [],
      range: (node, start, end) => {
        const range = call.call(createRangeFn, document);
        if (typeof start === "number" && typeof end === "number") {
          call.call(rangeSetStartFn, range, node, start);
          call.call(rangeSetEndFn, range, node, end);
        } else {
          call.call(rangeSelectNodeFn, range, node);
        }
        return rectValues(call.call(rangeRectsFn, range));
      },
      installed: true,
    }),
    writable: false,
    configurable: false,
    enumerable: false,
  });

  // The evidence marks are set in a font of their own, and it is registered HERE — before the
  // document exists, in the same breath as the rest of the apparatus — rather than at overlay
  // time. Two measured reasons.
  //
  // Its job is to keep the marks out of the font subset the document's own text is embedded
  // with. Sharing that subset made the marked PDF carry a different font program from the
  // baseline (17 584 bytes against 15 508), which pdfjs rasterises differently: 1116 differing
  // pixels on the CI runner where poppler, with its own rasteriser, found none. The overlay check
  // read that as contamination and withheld the evidence for every document on Linux.
  //
  // And it goes in early because loading a font is a resource load, even from a data: URI. Added
  // at overlay time it registered as network activity AFTER the measured state, and the run
  // refused the document — correctly. The apparatus does not get an exemption from the rule it
  // enforces; it gets in line before the measurement starts.
  if (typeof FontFace === "function" && document.fonts && document.fonts.add) {
    try {
      const markFont = new FontFace(${JSON.stringify("__MARK_FAMILY__")}, ${JSON.stringify("__MARK_SRC__")});
      document.fonts.add(markFont);
      markFont.load();
    } catch (error) {
      // Not fatal here. A mark font that failed to arrive shows up as a measurably wrong advance
      // width in the overlay readback, which drops the binding rather than reporting a number
      // nobody can stand behind.
    }
  }
})()`;

import { MARK_FONT_FAMILY, MARK_FONT_SRC } from "../render/mark-font.ts";

/** Build the pristine-realm payload with a Node-held capability that never enters served HTML. */
export function primitivesSource(capability: string): string {
  if (!/^[a-f0-9]{32,128}$/u.test(capability) && capability !== TEST_APPARATUS_CAPABILITY) {
    throw new Error("invalid apparatus capability");
  }
  return (
    PRIMITIVES_TEMPLATE.replace(APPARATUS_CAPABILITY_MARKER, capability)
      // Stringified HERE, not before: the src descriptor ends in `format("truetype")`, and
      // substituting it into an already-quoted literal put those quotes into the source
      // unescaped. The apparatus then failed to parse and every live case went red at once.
      .replace('"__MARK_FAMILY__"', JSON.stringify(MARK_FONT_FAMILY))
      .replace('"__MARK_SRC__"', JSON.stringify(MARK_FONT_SRC))
  );
}

/** Static payload for direct primitive tests. Production creates a fresh capability per page. */
export const PRIMITIVES_SOURCE = primitivesSource(TEST_APPARATUS_CAPABILITY);
export const TEST_PRIMITIVES_CAPABILITY = TEST_APPARATUS_CAPABILITY;

/**
 * Whether the primitives survived to measurement time.
 *
 * Checked rather than assumed: if the install failed, or a document managed to delete the binding,
 * every number after this point would come from whatever the document wanted. The measurement then
 * refuses. `installed: true` on a frozen, non-configurable property is not proof against a
 * determined attacker who ran before CDP — it is proof that the ordinary failure (the script never
 * ran, because the CDP session was not the one that loaded the document) is caught.
 */
export const PRIMITIVES_CHECK = `(() => {
  const p = window.__blPrimitives;
  if (!p || p.installed !== true) return { ok: false, reason: "the primitive references were never installed" };
  const d = Object.getOwnPropertyDescriptor(window, "__blPrimitives");
  if (!d || d.writable === true || d.configurable === true) {
    return { ok: false, reason: "the primitive references are replaceable, so they prove nothing" };
  }
  for (const name of ["fontsReady", "fontFaces", "fontStatus", "fontFamily", "imageUri", "svgBounds",
    "replaced", "canvas", "styleSheets", "sheetHref", "sheetRules", "ruleCssText", "nestedRules",
    "rects", "setAttr", "setText", "parent", "next", "create", "append", "remove", "setCssText",
    "setStyle", "on", "invoke0", "installIntegrity", "integrityArmLate", "integrityRecordPreview",
    "integrityStatus", "installCollector", "collectorResult", "lockPagination", "lockPreviewer",
    "publishFreeze", "publishOverlay", "mutationType", "mutationAttributeName", "randomToken", "startsWith"]) {
    if (typeof p[name] !== "function") return { ok: false, reason: "captured primitive missing: " + name };
  }
  return { ok: true, reason: "" };
})()`;

export interface PrimitivesStatus {
  ok: boolean;
  reason: string;
}
