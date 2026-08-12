/**
 * The namespace collision gate (§10.5, binding conclusion 1).
 *
 * If the document already uses the string `data-bl-` anywhere, the injection would not be
 * invisible: an author selector `p[data-bl-sid]`, a `content: attr(data-bl-sid)`, a script reading
 * the attribute — each turns the measuring apparatus into part of what is measured. The contract's
 * answer is not to be clever about it. It is to refuse: exit 3, `source-id-namespace-collision`.
 *
 * WHY A CONSERVATIVE TEXT SEARCH AND NOT A SELECTOR PARSE. The check is deliberately cruder than
 * the thing it guards. CSS identifiers can spell the same attribute with ASCII case changes or
 * escapes (`data\\2d bl\\2d sid`); decoding those escapes before searching catches such semantic
 * aliases without pretending a small selector parser can decide which occurrences matter. It can
 * produce a false refusal — a document that merely mentions `data-bl-` in prose is turned away
 * — and that is the direction to fail in. The message says exactly what was found and where, so a
 * false refusal is diagnosable in one line rather than mysterious.
 *
 * WHAT IT SEES AND WHAT IT DOES NOT — measured, not assumed, because this is the point an earlier
 * design review (Gemini, Z1) left open and explicitly refused to grant:
 *
 *   SEEN    the document text: inline `<style>`, every attribute, every text node, comments
 *   SEEN    the text of every stylesheet the caller hands in — the loader reads `<link href>`
 *           and follows `@import`, and passes the result here
 *   NOT SEEN  a stylesheet CONSTRUCTED at runtime (`new CSSStyleSheet`, `insertRule`), because it
 *           does not exist until the document runs
 *
 * The third one is a real hole and is reported as one rather than argued away. There is a
 * complementary argument — a document that can construct a stylesheet has its rendered state
 * checked by the paired control run of §10.5, which runs for every injected document and compares
 * four quantities including the style signature — but that argument is a claim about the control run, and it is
 * MEASURED there rather than asserted here. Until it is, this function reports its own scope and
 * lets the caller decide what to do with the gap.
 */

/** The reserved prefix. Everything this tool injects starts with it. */
export const RESERVED_PREFIX = "data-bl-";

export interface CollisionSource {
  /** Where this text came from, for the message. `document`, or a stylesheet URL. */
  origin: string;
  text: string;
}

export interface CollisionResult {
  collided: boolean;
  /** One entry per occurrence found, with enough context to see it in an editor. */
  occurrences: { origin: string; line: number; column: number; context: string }[];
  /** What was actually searched. A verdict without this cannot be told from an unchecked one. */
  scanned: string[];
  /** Scopes this check structurally cannot reach. Never empty — see the module comment. */
  unreachable: string[];
}

function decodedCssText(text: string): { text: string; offsets: number[] } {
  let decoded = "";
  const offsets: number[] = [];
  for (let index = 0; index < text.length;) {
    const start = index;
    if (text[index] === "\\" && index + 1 < text.length) {
      index += 1;
      const hex = text.slice(index).match(/^[0-9a-f]{1,6}/iu)?.[0];
      if (hex) {
        index += hex.length;
        // CSS input preprocessing turns CRLF into one newline. For an escape terminator we must
        // therefore consume both source code units; consuming CR alone left `\nbl` in the
        // decoded string and missed a semantic `data-bl-` selector.
        if (text[index] === "\r") {
          index += 1;
          if (text[index] === "\n") index += 1;
        } else if (/\s/u.test(text[index] ?? "")) index += 1;
        const codePoint = Number.parseInt(hex, 16);
        // CSS replaces NUL, surrogate and out-of-range escapes by U+FFFD. Never let hostile
        // source turn the collision gate itself into a RangeError; later literal occurrences
        // must still be scanned and the caller must retain a deterministic fail-closed result.
        decoded += codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)
          ? "\uFFFD"
          : String.fromCodePoint(codePoint);
        offsets.push(start);
        continue;
      }
      // A non-hex CSS escape consumes its escaped character verbatim. Attribute names such as
      // `data\-bl\-sid` are semantic aliases and must be visible to the same conservative scan.
      decoded += text[index] ?? "";
      offsets.push(start);
      index += 1;
      continue;
    }
    decoded += text[index] ?? "";
    offsets.push(start);
    index += 1;
  }
  return { text: decoded, offsets };
}

function occurrencesIn(source: CollisionSource): CollisionResult["occurrences"] {
  const found: CollisionResult["occurrences"] = [];
  const decoded = decodedCssText(source.text);
  const searched = decoded.text.toLocaleLowerCase("en-US");
  let at = 0;
  for (;;) {
    at = searched.indexOf(RESERVED_PREFIX, at);
    if (at === -1) return found;
    const originalAt = decoded.offsets[at]!;
    const before = source.text.slice(0, originalAt);
    const line = before.split("\n").length;
    const column = originalAt - (before.lastIndexOf("\n") + 1) + 1;
    // A window rather than the whole line: a minified stylesheet is one line of 40 000 characters.
    found.push({
      origin: source.origin,
      line,
      column,
      context: source.text.slice(Math.max(0, originalAt - 30), originalAt + 52).replace(/\s+/gu, " ").trim(),
    });
    at += RESERVED_PREFIX.length;
  }
}

/**
 * Run the gate over the document and every stylesheet the loader could read.
 *
 * Must be called on the ORIGINAL text, before `injectSourceIds` — afterwards every injected
 * attribute is itself an occurrence, and the gate would refuse every document on earth.
 */
export function detectCollision(sources: readonly CollisionSource[]): CollisionResult {
  const occurrences = sources.flatMap((source) => occurrencesIn(source));
  return {
    collided: occurrences.length > 0,
    occurrences,
    scanned: sources.map((s) => s.origin),
    unreachable: [
      "stylesheets constructed at runtime (new CSSStyleSheet, insertRule) — they do not exist " +
        "before the document runs, so no pre-parse check can see them",
    ],
  };
}

/** The message a refusal prints. Names every occurrence, and names what was NOT searched. */
export function collisionDetail(result: CollisionResult): string {
  const lines = [
    `breaklint: this document already uses the reserved prefix ${RESERVED_PREFIX}.`,
    "  breaklint injects attributes with that prefix to attribute findings to source positions.",
    "  A document that reads or styles them would change under measurement, so the run stops",
    "  rather than measuring a document it has altered.",
    "",
    `  found ${result.occurrences.length} occurrence${result.occurrences.length === 1 ? "" : "s"}:`,
  ];
  // A document with a hundred occurrences should not print a hundred lines; the count above is
  // the fact, the first few are the orientation.
  for (const o of result.occurrences.slice(0, 5)) {
    lines.push(`    ${o.origin}:${o.line}:${o.column}  ${o.context}`);
  }
  if (result.occurrences.length > 5) lines.push(`    … and ${result.occurrences.length - 5} more`);
  lines.push("", `  searched: ${result.scanned.join(", ")}`);
  for (const gap of result.unreachable) lines.push(`  not searched: ${gap}`);
  lines.push("", "  run with --no-source-map to measure without source attribution.");
  return lines.join("\n");
}
