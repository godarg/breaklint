/**
 * The widows/orphans guard, as pure functions — read by tests/unit/registry.test.ts.
 *
 * WHY AN ALLOW-LIST. The first version of this guard was a blacklist of phrasings ("ignored",
 * "inert", "does not honour", ...). An audit appended six other ways of saying the same false
 * thing ("disregards", "has no influence", "does not support", "unsupported", "does nothing",
 * "ineffective") and two lowering proposals to the widow advice, and the guard stayed green on all
 * eight. A vocabulary can always be walked around; an enumeration cannot. So every sentence in the
 * guarded texts that names `widows` or `orphans` must be one of the reviewed sentences in
 * `APPROVED_FRAGMENTATION_SENTENCES`, at the place it is approved for, and the approved set is
 * DERIVED FROM THE PIN: a sentence that says the browser applies a property is approved only while
 * the pinned measurement shows that. Any other sentence fails and is named with its location.
 *
 * Two vocabulary checks stay on top of the enumeration, because they must hold even for a sentence
 * someone adds to the approved set:
 *   - never, whatever the pin says: proposing to LOWER the author's own value (or set it to 0/1).
 *     The rules' threshold is that value, so lowering it silences a finding and fixes nothing;
 *   - while the pin says a property is NOT applied: proposing to set or raise it.
 */

import { readFileSync, readdirSync } from "node:fs";

import type { Rule } from "../../src/core/rule.ts";
import { generatedBlock, pageNameFor } from "../../tools/rule-docs.ts";
import {
  APPROVED_FRAGMENTATION_SENTENCES, type FragmentationProperty, type SentencePlace,
} from "../fixtures/fragmentation-levers.ts";

export const FRAGMENTATION_PROPERTIES: readonly FragmentationProperty[] = ["widows", "orphans"];

/** A guarded sentence and where it was read. */
export interface GuardedSentence {
  readonly place: string;
  readonly sentence: string;
}

export function placeLabel(where: SentencePlace): string {
  return "ruleId" in where ? `${where.ruleId} remediation.advice` : where.file;
}

/**
 * Sentences of a Markdown page, an advice text or a comment block. Code fences and HTML comments
 * are removed; a heading or table row is its own unit; blockquote and admonition markers are
 * dropped, so a sentence wrapped over several lines is judged as one. A sentence ends at `.`, `!`
 * or `?` followed by whitespace, so "Paged.js" does not end one.
 */
export function proseSentences(text: string): string[] {
  const withoutCode = text.replace(/```[\s\S]*?```/gu, "\n\n").replace(/<!--[\s\S]*?-->/gu, "\n\n");
  const units = withoutCode.split(/\n\s*\n/u).flatMap((block) =>
    block.split("\n").some((line) => /^\s*(#|\|)/u.test(line)) ? block.split("\n") : [block]);
  return units
    .flatMap((unit) => unit.replace(/^\s*>\s?/gmu, "").replace(/\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/gu, "")
      .replace(/\s+/gu, " ").trim().split(/(?<=[.!?])\s+/u))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** Comment text of a source file, with the comment markers removed. Code lines pass through. */
function sourceProse(source: string): string {
  return source.split("\n").map((line) => line.replace(/^\s*(\/\*\*|\/\*|\*\/|\*|\/\/)\s?/u, "")).join("\n");
}

/**
 * Whether a sentence names one of the two properties. Rule ids are removed first: `layout/widow`
 * names a rule, not a property. The singular forms count when they are used as a property name.
 */
export function namesFragmentationProperty(sentence: string): boolean {
  const withoutRuleIds = sentence.replace(/\blayout\/(widow|orphan)\b/gu, "");
  return /\b(widows|orphans)\b|\b(widow|orphan)[ -](property|properties|control|setting|settings|value|values)\b/iu.test(withoutRuleIds);
}

/** Every text the guard covers: each rule's advice, each rule page, the agent contract, the repair map. */
export function guardedTexts(rules: readonly Rule[], repoRoot: URL): { place: string; text: string }[] {
  const texts: { place: string; text: string }[] = [];
  for (const rule of rules) {
    texts.push({ place: placeLabel({ ruleId: rule.id }), text: rule.remediation?.advice ?? "" });
  }
  const rulesDir = new URL("docs/rules/", repoRoot);
  const byPage = new Map(rules.map((rule) => [pageNameFor(rule), rule]));
  for (const page of readdirSync(rulesDir).filter((name) => name.endsWith(".md")).sort()) {
    let text = readFileSync(new URL(page, rulesDir), "utf8");
    // The generated block IS the rule's advice, verbatim (a separate test proves that); it is
    // judged once, as the advice, rather than approved twice.
    const rule = byPage.get(page);
    if (rule) text = text.replace(generatedBlock(rule), "");
    texts.push({ place: `docs/rules/${page}`, text });
  }
  texts.push({ place: "docs/agent-contract.md", text: readFileSync(new URL("docs/agent-contract.md", repoRoot), "utf8") });
  texts.push({ place: "src/api/context.ts", text: sourceProse(readFileSync(new URL("src/api/context.ts", repoRoot), "utf8")) });
  return texts;
}

export function sentencesNamingProperties(texts: readonly { place: string; text: string }[]): GuardedSentence[] {
  return texts.flatMap(({ place, text }) =>
    proseSentences(text).filter(namesFragmentationProperty).map((sentence) => ({ place, sentence })));
}

/** Proposing to lower the author's own value, or to set it to 0 or 1. Never allowed. */
export function proposesLowering(sentence: string): boolean {
  return /\b(lower|lowers|lowering|lowered|reduce|reduces|reducing|decrease|decreases|decreasing|drop|drops|dropping|minimi[sz]e|minimi[sz]ing)\b.{0,60}\b(widows|orphans)\b/iu.test(sentence) ||
    /\b(widows|orphans)\b.{0,40}\b(lower|smaller|reduced|decreased|down)\b/iu.test(sentence) ||
    /\b(set|sets|setting|use|using|try|trying|give|giving|apply|applying|change|changing|put|putting)\b.{0,60}\b(widows|orphans)\s*[:=]?\s*['"`]?\s*[01]\b/iu.test(sentence);
}

/** Proposing to set or raise the property. Allowed only while the pin shows the browser applying it. */
export function proposesSetting(property: FragmentationProperty, sentence: string): boolean {
  return new RegExp(
    `\\b${property}\\s*[:=]?\\s*['"\`]?\\s*\\d|` +
      `\\b(set|sets|setting|raise|raises|raising|increase|increases|increasing|use|using|apply|applying|add|adding|specify|configure|try|trying|give|giving)\\b.{0,60}\\b${property}\\b|` +
      `\\b${property}\\b.{0,40}\\b(higher|larger|greater|raised|increased|up)\\b|` +
      `\\b${property}\\b.{0,40}\\b(property|setting|value)\\b.{0,40}\\b(to|of)\\b\\s*\\S`,
    "iu",
  ).test(sentence);
}

/** The approved set under a given pin state, as `place + sentence` keys. */
export function approvedKeys(applied: Readonly<Record<FragmentationProperty, boolean>>): Set<string> {
  return new Set(APPROVED_FRAGMENTATION_SENTENCES
    .filter((entry) => entry.requires.every((property) => applied[property]))
    .map((entry) => `${placeLabel(entry.where)}\u0000${entry.sentence}`));
}

/**
 * Every problem with the guarded sentences under a given pin state and approved set: an unapproved
 * sentence, a lowering proposal, or — while the pin says a property is not applied — a proposal to
 * set or raise it. Each message names the sentence and where it was read.
 */
export function fragmentationProblems(
  sentences: readonly GuardedSentence[],
  applied: Readonly<Record<FragmentationProperty, boolean>>,
  approved: ReadonlySet<string> = approvedKeys(applied),
): string[] {
  const problems: string[] = [];
  for (const { place, sentence } of sentences) {
    if (!namesFragmentationProperty(sentence)) continue;
    if (proposesLowering(sentence)) {
      problems.push(`${place}: proposes lowering an author's own widows/orphans value, which only moves the threshold: ${sentence}`);
    }
    for (const property of FRAGMENTATION_PROPERTIES) {
      if (!applied[property] && proposesSetting(property, sentence)) {
        problems.push(`${place}: proposes setting ${property}, which the pinned measurement shows the browser NOT applying: ${sentence}`);
      }
    }
    if (!approved.has(`${place}\u0000${sentence}`)) {
      problems.push(`${place}: names widows/orphans in a sentence that is not in the approved set derived from the pin ` +
        `(tests/fixtures/fragmentation-levers.ts, APPROVED_FRAGMENTATION_SENTENCES): ${sentence}`);
    }
  }
  return problems;
}
