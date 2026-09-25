/**
 * The font-set primitives are taken from the document's own font set, not from a global.
 *
 * THE DEFECT. The payload captured `FontFaceSet.prototype.ready` and its iterator through the
 * global `FontFaceSet`. A browser need not expose that interface object, and measured, Chromium
 * 141 does not: `typeof FontFaceSet` is "undefined" there, the payload threw a ReferenceError
 * while installing, and every live run ended with exit 3 before a single box was measured.
 *
 * THE PROPERTY, and why it is tested in a realm of our own rather than asserted over the text.
 * What matters is where the captured references come from, and a text scan can only say that a
 * word is absent. So the real payload is evaluated in a `node:vm` realm whose DOM is a stub: every
 * interface the payload reads resolves to a harmless function, except the font set, which is a
 * real object with a `ready` getter and an iterator on a prototype that no global names. Two
 * cases then pin the property from both sides:
 *
 *   1. no global `FontFaceSet` at all (Chromium 141): the payload must install, and its
 *      `fontsReady` / `fontFaces` must answer from the document's own set;
 *   2. a global `FontFaceSet` whose prototype is a DECOY: the captured references must still be
 *      the document set's own. A payload that reads the global passes neither — the first throws,
 *      the second returns the decoy's values.
 *
 * Tamper resistance is unchanged by the switch, and that is a property of ordering, not of this
 * test: the payload is installed on-new-document, before any author script (see the comment at the
 * capture in `src/measure/primitives.ts`), so at capture time the prototype is still the browser's.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createContext, runInContext } from "node:vm";

import { PRIMITIVES_SOURCE } from "../../src/measure/primitives.ts";

const inert = function inertStub(): undefined {
  return undefined;
};

/**
 * A prototype on which every property exists: as an inert method when read, as an inert accessor
 * when its descriptor is asked for. `overrides` supplies the few members a case needs for real.
 */
function stubPrototype(overrides: Record<string, PropertyDescriptor> = {}): object {
  return new Proxy({}, {
    get(_target, key, receiver) {
      if (typeof key === "string" && key in overrides) {
        const descriptor = overrides[key]!;
        return descriptor.get ? descriptor.get.call(receiver) : descriptor.value;
      }
      return typeof key === "symbol" ? undefined : inert;
    },
    getOwnPropertyDescriptor(_target, key) {
      if (typeof key === "string" && key in overrides) return { configurable: true, enumerable: false, ...overrides[key] };
      if (typeof key === "symbol") return undefined;
      return { configurable: true, enumerable: false, get: inert, set: inert };
    },
  });
}

interface FontSet {
  readonly ready: unknown;
  [Symbol.iterator](): Iterator<unknown>;
}

function fontSetWith(ready: unknown, faces: unknown[]): FontSet {
  const prototype = {
    get ready() {
      return ready;
    },
    [Symbol.iterator]() {
      return faces[Symbol.iterator]();
    },
  };
  return Object.create(prototype) as FontSet;
}

interface Primitives {
  fonts(): unknown;
  fontsReady(set: unknown): unknown;
  fontFaces(set: unknown): unknown[];
}

/** Evaluates the real payload in a stub-DOM realm and returns what it installed. */
function install(documentFonts: FontSet, globalFontFaceSet: FontSet | null): Primitives {
  const interfaces = [...new Set([...PRIMITIVES_SOURCE.matchAll(/\b([A-Z][A-Za-z0-9]*)\.prototype\b/gu)].map((m) => m[1]!))];
  const context = createContext({});
  runInContext("globalThis.window = globalThis;", context);
  const builtIn = new Set(runInContext("Object.getOwnPropertyNames(globalThis)", context) as string[]);
  const realm = context as Record<string, unknown>;
  for (const name of interfaces) {
    if (builtIn.has(name) || name === "FontFaceSet") continue;
    const ctor = function StubInterface(): void {};
    ctor.prototype = name === "Document" ? stubPrototype({ fonts: { get: () => documentFonts } }) : stubPrototype();
    realm[name] = ctor;
  }
  realm.document = Object.create((realm.Document as { prototype: object }).prototype);
  realm.getComputedStyle = inert;
  realm.crypto = {};
  if (globalFontFaceSet) {
    const decoy = function FontFaceSet(): void {};
    decoy.prototype = Object.getPrototypeOf(globalFontFaceSet) as object;
    realm.FontFaceSet = decoy;
  }
  runInContext(PRIMITIVES_SOURCE, context);
  const primitives = realm.__blPrimitives as Primitives | undefined;
  assert.ok(primitives, "the payload ran but installed no primitives");
  return primitives;
}

describe("the font-set primitives come from the document's own set", () => {
  const ownReady = { from: "the document's own font set" };
  const ownFaces = [{ face: "own-1" }, { face: "own-2" }];

  it("installs and answers when the browser exposes no global FontFaceSet", () => {
    const fonts = fontSetWith(ownReady, ownFaces);
    let primitives: Primitives | undefined;
    assert.doesNotThrow(() => {
      primitives = install(fonts, null);
    }, "the payload depends on a global FontFaceSet; Chromium 141 has none");
    assert.equal(primitives!.fonts(), fonts, "fonts() is not the document's set");
    assert.equal(primitives!.fontsReady(fonts), ownReady);
    // Spread into this realm's array: the payload builds its list in the vm realm.
    assert.deepEqual([...primitives!.fontFaces(fonts)], ownFaces);
  });

  it("ignores a global FontFaceSet that names a different prototype", () => {
    const fonts = fontSetWith(ownReady, ownFaces);
    const decoyReady = { from: "the global FontFaceSet" };
    const decoy = fontSetWith(decoyReady, [{ face: "decoy" }]);
    const primitives = install(fonts, decoy);
    assert.equal(primitives.fontsReady(fonts), ownReady, "the ready getter was captured from the global, not from the set");
    assert.deepEqual([...primitives.fontFaces(fonts)], ownFaces, "the iterator was captured from the global, not from the set");
  });
});
