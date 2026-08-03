/**
 * Stable identity for a finding across runs.
 *
 * The rule that governs every line here: **an ordinal is a layout product, not an identity.**
 * Measured over four mutations (insert a duplicate, delete a duplicate, reorder, change the
 * fragmentation), a scheme keyed on the block signature alone mis-attributed once — and that
 * once is genuinely unresolvable. Adding an ordinal to the same scheme made it *worse*, four
 * mis-attributions instead of none. The same battery over SVG text targets gave ten
 * mis-attributions for the injected running number and one for source identity.
 *
 * So the fingerprint contains none of: page number, ordinal, fragment index, node key, or the
 * paginator's `data-ref` (which is a fresh UUID per run and therefore a nonce, not an id).
 * The single exception is `page/ord:`, which applies only to a page carrying no semantic block
 * at all, and such a finding is marked ambiguous.
 */

import { createHash } from "node:crypto";
import type { KeyType } from "./enums.ts";

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function sha256Short(input: string): string {
  return sha256(input).slice(0, 16);
}

/** Whitespace collapsed, ends trimmed. Applied to the WHOLE source block, never a fragment. */
export function normaliseSignature(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

export function fingerprint(input: { ruleId: string; keyType: KeyType; key: string }): string {
  return sha256(`${input.ruleId}\0${input.keyType}\0${input.key}`);
}

/** A block: the author's id when the SOURCE block had one, otherwise the block signature. */
export function blockKey(input: { authorId: string | null; blockSignature: string }): string {
  return input.authorId ? `id:${input.authorId}` : `sig:${sha256Short(normaliseSignature(input.blockSignature))}`;
}

/**
 * A page: anchored to its first semantic block, so that inserting a page above moves the
 * fingerprint with the content instead of leaving it stuck to a number.
 */
export function pageKey(input: { firstSemanticBlockKey: string | null; pageOrdinal: number }): {
  key: string;
  ambiguous: boolean;
} {
  if (input.firstSemanticBlockKey) return { key: `first:${input.firstSemanticBlockKey}`, ambiguous: false };
  return { key: `ord:${input.pageOrdinal}`, ambiguous: true };
}

/** A resource: the URI, normalised and made relative to the input root. */
export function resourceKey(normalisedRelativeUri: string): string {
  return `uri:${normalisedRelativeUri}`;
}

/** A node the paginator produced. It has no source, and the key says which role it played. */
export function generatedKey(input: { role: string; pageSourceKey: string }): string {
  return `gen:${input.role}:${input.pageSourceKey}`;
}

/**
 * An SVG text target: the SVG root's source key plus the `<text>`'s own source identity.
 *
 * Note what is absent: `data-bl-svg-target`. That attribute is indispensable for *addressing*
 * the isolation pass and useless as *identity* — measured, ten mis-attributions against one.
 * Two different questions, two different keys; conflating them was a real defect.
 */
export function svgTextKey(input: {
  svgRootKey: string;
  authorId: string | null;
  textSignature: string;
}): string {
  const own = input.authorId
    ? `id:${input.authorId}`
    : `sig:${sha256Short(normaliseSignature(input.textSignature))}`;
  return `svg:${input.svgRootKey}|${own}`;
}

/**
 * The SVG root key.
 *
 * Paged.js stamps every element with a random `data-ref`. A signature over raw `outerHTML` is
 * therefore not an identity but a nonce — new on every run, so no finding would ever be
 * comparable across two runs. The cleanup below is what makes it an identity.
 *
 * Two structurally identical SVGs get the same key on purpose. Which of two identical objects
 * is meant is not a well-formed question; the honest answer is to key them together and mark
 * the targets ambiguous, rather than to invent a distinction from their order.
 */
export function svgRootKey(input: { authorId: string | null; outerHtml: string }): string {
  if (input.authorId) return `svgid:${input.authorId}`;
  return `svgsig:${sha256Short(canonicaliseSvg(input.outerHtml))}`;
}

/** Strips the paginator's nonce and our own injection, sorts attributes, collapses whitespace. */
export function canonicaliseSvg(outerHtml: string): string {
  const withoutNonce = outerHtml
    .replace(/\sdata-ref="[^"]*"/gu, "")
    .replace(/\sdata-bl-[a-z-]+="[^"]*"/gu, "");
  // Attributes sorted per tag so that a reordering in the source is not a different object.
  return withoutNonce
    .replace(/<([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/gu, (_all, tag, attrs, close) => {
      const pairs = [...String(attrs).matchAll(/\s+([\w:-]+)="([^"]*)"/gu)]
        .map((m) => `${m[1]}="${m[2]}"`)
        .sort();
      return `<${tag}${pairs.length ? " " + pairs.join(" ") : ""}${close}>`;
    })
    .replace(/\s+/gu, " ")
    .trim();
}
