/**
 * The mark font is a binary constant in the source tree, and a binary nobody reads is a place for
 * a claim to rot. These tests read it.
 *
 * They deliberately do NOT run the generator: it needs Python and fontTools, which the runtime
 * does not, and a check that only passes where the toolchain happens to be installed is a check
 * that will be skipped. What matters downstream is the SHIPPED constant, so that is what is
 * parsed here — out of the same file the overlay imports.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { MARK_FONT_BASE64, MARK_FONT_CHARS, MARK_FONT_FAMILY, MARK_FONT_SRC } from "../../src/render/mark-font.ts";
import { OVERLAY_SOURCE } from "../../src/render/overlay.ts";
import { PRIMITIVES_SOURCE } from "../../src/measure/primitives.ts";

/** Big-endian readers. A TrueType file is a table directory and offsets, nothing more. */
const u16 = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!;
const u32 = (b: Uint8Array, o: number): number => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;

function tables(font: Uint8Array): Map<string, { offset: number; length: number }> {
  const out = new Map<string, { offset: number; length: number }>();
  const count = u16(font, 4);
  for (let i = 0; i < count; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(font[rec]!, font[rec + 1]!, font[rec + 2]!, font[rec + 3]!);
    out.set(tag, { offset: u32(font, rec + 8), length: u32(font, rec + 12) });
  }
  return out;
}

/** Every character the font's cmap maps, read out of the format-4 subtable. */
function mappedCharacters(font: Uint8Array): string {
  const cmap = tables(font).get("cmap");
  assert.ok(cmap, "the font has no cmap table");
  const base = cmap.offset;
  let sub = -1;
  for (let i = 0; i < u16(font, base + 2); i++) {
    const rec = base + 4 + i * 8;
    const format = u16(font, base + u32(font, rec + 4));
    if (format === 4) sub = base + u32(font, rec + 4);
  }
  assert.notEqual(sub, -1, "the font has no format-4 cmap subtable");
  const segX2 = u16(font, sub + 6);
  const ends = sub + 14;
  const starts = ends + segX2 + 2;
  const chars: string[] = [];
  for (let s = 0; s < segX2 / 2; s++) {
    const end = u16(font, ends + s * 2);
    const start = u16(font, starts + s * 2);
    if (start === 0xffff) continue;
    for (let c = start; c <= end && c !== 0xffff; c++) chars.push(String.fromCharCode(c));
  }
  return chars.sort().join("");
}

describe("the evidence mark font", () => {
  const font = Uint8Array.from(Buffer.from(MARK_FONT_BASE64, "base64"));

  it("is a TrueType file and not a base64 string that merely looks like one", () => {
    assert.equal(u32(font, 0), 0x00010000, "not a TrueType version tag");
    for (const required of ["cmap", "glyf", "head", "hhea", "hmtx", "loca", "maxp", "name"]) {
      assert.ok(tables(font).has(required), `the font is missing its ${required} table`);
    }
  });

  it("covers exactly the characters a mark token can contain — no more, no fewer", () => {
    // Fewer would put a .notdef in a token and make the mark unfindable. More is dead weight
    // travelling inside every PDF this tool produces.
    assert.equal(mappedCharacters(font), [...MARK_FONT_CHARS].sort().join(""));
  });

  it("has a glyph for every character, and none of them is empty", () => {
    // The reason is measured and cost a debugging round: Chrome emits NO drawing operation for a
    // glyph with zero contours, so a font of empty outlines never reaches the PDF, the tokens
    // vanish from the text stream and every mark silently fails to bind — while the raster
    // comparison reports a perfect 0. Invisibility comes from the transparent colour, never from
    // an absent outline.
    const t = tables(font);
    const indexToLocFormat = u16(font, t.get("head")!.offset + 50);
    const glyphs = u16(font, t.get("maxp")!.offset + 4);
    const loca = t.get("loca")!.offset;
    const at = (i: number): number => (indexToLocFormat === 0 ? u16(font, loca + i * 2) * 2 : u32(font, loca + i * 4));
    let empty = 0;
    for (let g = 0; g < glyphs; g++) if (at(g + 1) === at(g)) empty++;
    assert.equal(empty, 0, `${empty} of ${glyphs} glyphs have no outline`);
    assert.equal(glyphs, MARK_FONT_CHARS.length + 1, "expected one glyph per character plus .notdef");
  });

  it("is registered before the measured state, not by the overlay", () => {
    // Loading a font is a resource load even from a data: URI. Registered at overlay time it
    // counted as network activity AFTER the measured state and the run refused the document —
    // correctly, and that refusal is the rule this apparatus enforces on everyone else.
    assert.ok(PRIMITIVES_SOURCE.includes(MARK_FONT_FAMILY), "the primitives do not carry the mark font");
    assert.ok(PRIMITIVES_SOURCE.includes("FontFace"), "the primitives do not register a FontFace");
    assert.equal(OVERLAY_SOURCE.includes("new FontFace"), false, "the overlay registers the font too late");
    assert.equal(OVERLAY_SOURCE.includes("MARK_FONT_SRC"), false, "the overlay carries the font source");
  });

  it("is what the marks are actually set in, and the readback measures that it arrived", () => {
    // Read the declaration the BROWSER will see, not the escaped literal in the source. The
    // overlay ships as a string, so `"` arrives as `\"` and a naive match on the source text
    // passes or fails for reasons that have nothing to do with the style.
    const literal = /const STYLE_MARK = ("(?:[^"\\]|\\.)*");/u.exec(OVERLAY_SOURCE);
    assert.ok(literal, "STYLE_MARK is not a string literal in the overlay source any more");
    const style = JSON.parse(literal[1]!) as string;
    assert.ok(style.includes(`font-family:"${MARK_FONT_FAMILY}"!important`), "the marks do not use it");
    // No fallback: a fallback would put the marks back into the document's own font subset, which
    // is the entire defect this font removes, and it would do it silently.
    assert.equal(
      /font-family:[^;]+/u.exec(style)?.[0],
      `font-family:"${MARK_FONT_FAMILY}"!important`,
      "the mark font-family has a fallback",
    );
    // The declaration that made the marks invisible in the first place is still there. It was
    // lost once already: a dangling `+` in this concatenation turned the whole block from
    // font-size to display into the string "NaN", and TypeScript accepted it because
    // `"a" + +"b"` is valid. Only a live readback of the computed style caught it.
    assert.ok(style.includes("color:transparent!important"), "the marks are no longer transparent");
    assert.ok(style.includes("font-size:1px!important"), "the mark font-size declaration is gone");
    assert.equal(style.includes("NaN"), false, "a concatenation in STYLE_MARK produced NaN");
    // The computed family alone cannot answer whether the font LOADED — measured: with the
    // registration removed, the family still read back as ours while the glyphs came from
    // somewhere else at 5.13px for nine characters. The advance width is what caught it.
    assert.ok(OVERLAY_SOURCE.includes("advance="), "the readback does not measure the advance width");
  });

  it("declares a src that names a font file and a format", () => {
    assert.match(MARK_FONT_SRC, /^url\(data:font\/ttf;base64,[A-Za-z0-9+/=]+\) format\("truetype"\)$/u);
    assert.ok(MARK_FONT_SRC.includes(MARK_FONT_BASE64), "the src does not carry the font this file declares");
  });
});
