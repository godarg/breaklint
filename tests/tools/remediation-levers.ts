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
 * An imperative verb opening a clause, removal synonyms included: "delete", "drop" or "strip" a
 * declaration proposes a lever exactly as "remove" does.
 */
const IMPERATIVE_VERB = "(?:set|use|apply|add|insert|enable|disable|remove|delete|drop|strip|omit|unset|eliminate|clear|take out|get rid of|turn off|switch off|replace|increase|reduce|lower|raise|adjust|specify|configure|prevent|force|keep|try|wrap|mark|make|split|tighten|enlarge|move|shorten|constrain|reword|put)";
const IMPERATIVE_CLAUSE = new RegExp(`^\\s*(?:(?:or|and|then|also|instead|simply|just|first|please)\\s+)*${IMPERATIVE_VERB}\\b`, "iu");

/** A clause that names a lever in order to warn against it. */
export const DISCOURAGING = /\b(?:do not|does not|don't|never|ignored|inert|also clears the finding|only where|only helps|not honou?r)\b/iu;

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

/**
 * The clauses of a sentence, split at commas, semicolons, colons, dashes, brackets and the
 * conjunctions that join clauses. Quoted and backticked spans are masked first, so that the colon
 * in `'break-inside: avoid'` does not split a clause in two.
 */
export function clausesOf(sentence: string): string[] {
  const spans: string[] = [];
  const masked = plain(sentence).replace(/`[^`\n]*`|(?<![\w])'[^'\n]+?'(?![\w])|"[^"\n]*"/gu, (span) => `\u0000${spans.push(span) - 1}\u0000`);
  return masked
    .split(/[,;:—()]|\s(?=(?:or|and|but|while|which|so|whereas)\s)/u)
    .map((clause) => clause.replace(/\u0000(\d+)\u0000/gu, (_, index: string) => spans[Number(index)]!).trim())
    .filter(Boolean);
}

/**
 * The levers a sentence proposes. A clause that warns ("do not …", "… also clears the finding")
 * proposes nothing, however the rest of the sentence reads; the other clauses propose the levers
 * they name when some clause of the sentence opens with an imperative. With `requireImperative`
 * false every non-warning clause is a proposal — the shape of a repair instruction.
 */
export function proposedLevers(sentence: string, { requireImperative = true } = {}): string[] {
  const clauses = clausesOf(sentence).filter((clause) => !DISCOURAGING.test(clause));
  if (requireImperative && !clauses.some((clause) => IMPERATIVE_CLAUSE.test(clause))) return [];
  return [...new Set(clauses.flatMap(leversIn))];
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
