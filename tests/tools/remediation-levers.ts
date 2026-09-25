/**
 * Which CSS levers a rule's own advice proposes — read from `remediation.advice`, the one source.
 *
 * The rule pages, the agent contract and the context pack's repair options all restate what a
 * rule's advice says to change. Each restatement drifted at least once: "remove `break-inside:
 * avoid`" was offered for the one rule whose advice explains that doing so clears the finding
 * without fixing anything. A guard over those texts needs to know not just which levers an advice
 * NAMES but which it PROPOSES, because two advice texts name a lever only to discourage it.
 *
 * Nothing here is a second table of levers per rule. `positiveLevers` derives them from the advice
 * at run time, so a changed advice changes what every guard accepts.
 *
 * KNOWN LIMITS, accepted: the sentence reader is a heuristic over English (see `proposedLevers`),
 * and `changedLevers` compares the SET of values per lever — a declaration moved to another
 * element with the same value, or duplicated, is not a change. Its own tests are in
 * tests/unit/remediation-levers.test.ts.
 */

/** Actionable CSS levers. A property named as a measurement is not a proposal; see IMPERATIVE. */
export const LEVERS = [
  "break-inside", "break-before", "break-after", "page-break-before", "page-break-after",
  "hyphens", "text-align", "text-wrap", "word-spacing", "overflow", "widows", "orphans",
  "line-height", "font-size", "column-width", "columns", "quotes",
] as const;

/** A paraphrase of a break-* property counts as every break-* lever it could mean. */
const BREAK_PARAPHRASE = /\bbreak (?:constraint|behaviou?r|rule|propert(?:y|ies)|setting)s?\b/iu;
const BREAK_LEVERS = ["break-inside", "break-before", "break-after", "page-break-before", "page-break-after"];

/**
 * The verbs of a proposal, removal synonyms included: "delete", "drop" or "strip" a declaration
 * proposes a lever exactly as "remove" does, and "change … to", "override" and "consider" propose
 * too.
 */
const VERBS = "set|use|apply|add|insert|enable|disable|remove|delete|drop|strip|omit|unset|eliminate|clear|take out|get rid of|turn off|switch off|replace|change|override|increase|reduce|lower|raise|adjust|specify|configure|prevent|force|keep|try|consider|wrap|mark|make|split|tighten|enlarge|move|shorten|constrain|reword|put|inflate|inject|stretch";
const GERUNDS = "setting|using|applying|adding|inserting|enabling|disabling|removing|deleting|dropping|stripping|omitting|unsetting|eliminating|clearing|replacing|changing|overriding|increasing|reducing|lowering|raising|adjusting|specifying|forcing|keeping|making|splitting|tightening|moving|shortening";
/** A clause that opens with an imperative, a modal proposal ("you should remove …") or "consider …". */
const IMPERATIVE_CLAUSE = new RegExp(
  `^\\s*(?:(?:or|and|then|also|instead|otherwise|alternatively|simply|just|first|please)\\s+)*(?:(?:you|one)\\s+(?:can|could|should|may|might|must|need to|have to)\\s+)?(?:${VERBS})\\b`,
  "iu",
);
/**
 * "Removing X fixes the finding" proposes X as surely as "remove X" does. "Clears" is not a fix
 * verb: clearing a finding is exactly what a false repair does.
 */
const GERUND_PROPOSAL = new RegExp(`^\\s*(?:${GERUNDS})\\b.*\\b(?:fix(?:es)?|resolves?|removes?|eliminates?)\\b.*\\bfinding`, "iu");
/**
 * A sentence that says the gerund's fix is no fix: "never fixes the finding", "does not fix it",
 * "resolves it only because the rule has no candidate", "without making the block fit", "by
 * hiding it, which is a false repair". Read on the whole sentence with its quoted spans masked,
 * because the qualifier usually follows a comma, which ends the gerund's clause.
 */
const GERUND_VOID = /\b(?:never|not|nothing|only because|without|false repair|hid(?:e|es|ing))\b|n't\b/iu;
/** A negated proposal verb — "do not remove", "never delete", "it does not move the text". */
const NEGATED_VERB = new RegExp(
  `\\b(?:do not|don't|does not|doesn't|must not|mustn't|should not|shouldn't|never|cannot|can't)\\s+(?:(?:only|just|simply|ever)\\s+)?(?:${VERBS})\\b`,
  "iu",
);

/**
 * A clause that names a lever in order to warn against it: a negated proposal verb, or a phrase
 * that says the lever does nothing or only makes the rule stop looking. Read on the clause with
 * its quoted spans masked, so a word inside `` `…` `` cannot void the clause around it.
 */
export const DISCOURAGING = new RegExp(`${NEGATED_VERB.source}|\\b(?:ignored|inert|also clears the finding|clears the finding without|has no effect|not honou?red)\\b`, "iu");

/**
 * A hyphenated lever (`break-inside`, `line-height`) cannot be anything but the CSS property. A
 * one-word lever is also an English word — "replace spaced hyphens", "straight quotes" — so it
 * counts only as a declaration (`hyphens:`) or quoted as a name (`'quotes'`, `` `overflow` ``).
 */
const leverPattern = (lever: string): RegExp => lever.includes("-")
  ? new RegExp(`(?<![\\w-])${lever}(?![\\w-])`, "iu")
  : new RegExp(`(?<![\\w-])${lever}\\s*:|['"\`]${lever}['"\`]`, "iu");

/** Markdown emphasis says nothing about grammar, and hides a clause start behind `**`. */
const plain = (sentence: string): string => sentence.replace(/\*\*|__|\*/gu, "");

/** Sentences: a full stop, question or exclamation mark, then space and a capital, quote or bracket. */
export function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z'"(`*])/u).map((sentence) => sentence.trim()).filter(Boolean);
}

/** The levers a sentence names, a break-* paraphrase included. */
export function leversIn(sentence: string): string[] {
  const text = plain(sentence);
  const found: string[] = LEVERS.filter((lever) => leverPattern(lever).test(text));
  if (BREAK_PARAPHRASE.test(text)) found.push(...BREAK_LEVERS.filter((lever) => !found.includes(lever)));
  return found;
}

interface Segment { text: string; masked: string; separator: string }

/**
 * The clauses of a sentence, each with the separator before it: commas, semicolons, colons,
 * dashes, brackets and the conjunctions that join clauses. Quoted and backticked spans are masked
 * first, so the colon in `'break-inside: avoid'` does not split a clause and a word inside a quote
 * is not read as grammar.
 */
function segmentsOf(sentence: string): Segment[] {
  const spans: string[] = [];
  const masked = plain(sentence).replace(/`[^`\n]*`|(?<![\w])'[^'\n]+?'(?![\w])|"[^"\n]*"/gu, (span) => `\u0000${spans.push(span) - 1}\u0000`);
  const segments: Segment[] = [];
  let separator = "";
  for (const part of masked.split(/([,;:—()])|\s(?=(?:or|and|but|while|which|so|whereas|nor)\s)/u)) {
    if (part === undefined) continue;
    if (/^[,;:—()]$/u.test(part)) { separator = part; continue; }
    if (!part.trim()) continue;
    const text = part.replace(/\u0000(\d+)\u0000/gu, (_, index: string) => spans[Number(index)]!).trim();
    segments.push({ text, masked: part.trim(), separator: separator || (/^(?:or|and|nor)\s/iu.test(part.trim()) ? "conj" : "") });
    separator = "";
  }
  return segments;
}

export function clausesOf(sentence: string): string[] {
  return segmentsOf(sentence).map((segment) => segment.text);
}

/**
 * The levers a sentence proposes — a HEURISTIC reader of English, tested in
 * tests/unit/remediation-levers.test.ts, not a parser. A clause that warns proposes nothing,
 * however the rest of the sentence reads, and a negated verb ("never inflate X, inject Y or
 * stretch Z") voids the list it opens up to the next semicolon, colon, dash or contrast ("but",
 * "instead", "rather"). The remaining clauses propose the levers they name when some clause of the
 * sentence opens with a proposal. With `requireImperative` false every non-warning clause is a
 * proposal — the shape of a repair instruction.
 *
 * A gerund opening a sentence ("Removing X fixes the finding") proposes only when a fix verb
 * follows and nothing in the sentence says the fix is none (never, not, nothing, only because,
 * without, false repair, hiding).
 *
 * Known limits: a proposal phrased without any verb it knows ("the right fix is X") or with an
 * unusual one ("override" is known, "revert" is not) proposes nothing here; a negation phrased
 * around a verb it does not know ("do not bother with X") does not void; a lever named only in
 * prose ("the overflow") is not a lever; a warning phrased in words it does not know ("Removing X
 * fixes the finding in name only") is read as a proposal. The reader errs in BOTH directions, and
 * which one passes silently depends on the text: on a restatement (a rule page, the agent
 * contract, a repair option) a missed proposal is a false pass and an invented one a loud failure;
 * on the advice itself an invented proposal widens what every guard accepts, which is the silent
 * direction. The tests of this file pin every case known in either direction.
 */
export function proposedLevers(sentence: string, { requireImperative = true } = {}): string[] {
  const live: Segment[] = [];
  let negating = false;
  const segments = segmentsOf(sentence);
  for (const segment of segments) {
    const continuesList = segment.separator === "," || segment.separator === "conj";
    if (negating && continuesList && !/^\s*(?:but|instead|rather|then)\b/iu.test(segment.masked)) continue;
    negating = false;
    if (DISCOURAGING.test(segment.masked)) {
      negating = NEGATED_VERB.test(segment.masked);
      continue;
    }
    live.push(segment);
  }
  const gerundVoided = segments.some((segment) => GERUND_VOID.test(segment.masked));
  const proposal = live.some((segment) => IMPERATIVE_CLAUSE.test(segment.masked) || (!gerundVoided && GERUND_PROPOSAL.test(segment.masked)));
  if (requireImperative && !proposal) return [];
  return [...new Set(live.flatMap((segment) => leversIn(segment.text)))];
}

/** Whether a sentence proposes any lever at all. */
export function proposes(sentence: string): boolean {
  return proposedLevers(sentence).length > 0;
}

/** The levers an advice text proposes, sentence by sentence and clause by clause. */
export function positiveLevers(advice: string): Set<string> {
  return new Set(sentencesOf(advice).flatMap((sentence) => proposedLevers(sentence)));
}

/** `lever: value` declarations in a code block, per lever, for comparing a trigger with its remedy. */
export function declarations(code: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const lever of LEVERS) {
    for (const match of code.matchAll(new RegExp(`(?<![\\w-])${lever}\\s*:\\s*([^;"'}\\n]+)`, "giu"))) {
      const values = found.get(lever) ?? new Set<string>();
      values.add(match[1]!.trim().toLowerCase());
      found.set(lever, values);
    }
  }
  return found;
}

/**
 * The levers whose declarations differ between a trigger and its remedied example — set to a new
 * value, added, or REMOVED. Deleting `break-inside: avoid` is the false repair this project warns
 * about most, and it only shows as a declaration that is no longer there.
 */
export function changedLevers(trigger: string, remedied: string): string[] {
  const before = declarations(trigger);
  const after = declarations(remedied);
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((lever) => {
      const was = before.get(lever) ?? new Set<string>();
      const is = after.get(lever) ?? new Set<string>();
      return was.size !== is.size || [...was].some((value) => !is.has(value));
    })
    .sort();
}
