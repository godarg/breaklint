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

/** An imperative verb that opens the sentence or one of its clauses. */
const IMPERATIVE = /(?:^|[,;(—:]\s*|\b(?:or|and|then)\s+)(?:set|use|apply|add|insert|enable|disable|remove|replace|increase|reduce|lower|raise|adjust|specify|configure|prevent|force|keep|try|wrap|mark|make|split|tighten|enlarge|move|shorten|constrain|reword|put)\b/iu;

/** A sentence that names a lever in order to warn against it. */
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

/** Whether a sentence proposes something, rather than describing or warning. */
export function proposes(sentence: string): boolean {
  const text = plain(sentence);
  return IMPERATIVE.test(text) && !DISCOURAGING.test(text);
}

/** The levers an advice text proposes: named in a sentence that proposes and does not warn. */
export function positiveLevers(advice: string): Set<string> {
  const levers = new Set<string>();
  for (const sentence of sentencesOf(advice)) {
    if (!proposes(sentence)) continue;
    for (const lever of leversIn(sentence)) levers.add(lever);
  }
  return levers;
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

/** The levers a remedied example sets to a value its trigger does not carry. */
export function changedLevers(trigger: string, remedied: string): string[] {
  const before = declarations(trigger);
  const after = declarations(remedied);
  return [...after.entries()]
    .filter(([lever, values]) => [...values].some((value) => !before.get(lever)?.has(value)))
    .map(([lever]) => lever);
}
