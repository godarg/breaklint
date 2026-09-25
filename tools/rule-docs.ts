/**
 * One remediation text per rule, in one place — the pure half.
 *
 * Until 0.6.0 every rule carried two: `remediation.advice` in `src/rules/**`, which the CLI prints
 * and which travels to every consumer as `Finding.remediation`, and a hand-written `## Remediation`
 * section in `docs/rules/<id>.md`, which is what a person reads. Measured on 2026-09-17: 10 of 13
 * pairs disagreed, and between them the pages named eight levers the rules do not know. A
 * correction to either source never reached the other, and the drifting copy was the one a human
 * read.
 *
 * The block carries the advice and, where the rule declares `remediation.interactions`, one
 * precedence line per interaction, so a precedence is written once, in the rule, like the advice.
 *
 * This module answers "what must the page say" and nothing else. It performs no I/O ON PURPOSE:
 * the first shape put the generator and the answer in one file, the unit test imported it for the
 * answer, and importing it REWROTE the pages the test was about to check — so the gate repaired
 * its own subject, and a mutation probe found the mutant green. The writing lives in
 * `write-rule-docs.ts`, which nothing under `tests/` imports.
 */

import { INTERACTION_LEVERS, INTERACTION_SCOPES, type Rule } from "../src/core/rule.ts";

export const BEGIN = (id: string) => `<!-- begin generated remediation: ${id} -->`;
export const END = (id: string) => `<!-- end generated remediation: ${id} -->`;

export function pageNameFor(rule: Pick<Rule, "id">): string {
  return `${rule.id.replace("/", "-")}.md`;
}

/**
 * One line per declared `remediation.interactions` entry, rendered from the registry and nothing
 * else. Two advice texts that pull one lever in opposite directions have to say which one owns
 * it, and a person reading one page must see the same order an agent reads in the finding. The
 * pairing itself (both sides declared, opposite relations) is enforced by `interactionProblems`.
 */
export function precedenceLines(rule: Rule): string[] {
  return (rule.remediation?.interactions ?? []).map((interaction) => {
    const other = `[\`${interaction.ruleId}\`](${pageNameFor({ id: interaction.ruleId })})`;
    const lever = INTERACTION_LEVERS[interaction.lever];
    const where = `${lever.subject} ${INTERACTION_SCOPES[interaction.scope]}`;
    return interaction.relation === "prevails"
      ? `**Precedence.** ${where}: this rule owns ${lever.owned}, and ${other} defers to it, acting only on the affected word.`
      : `**Precedence.** ${where}: ${other} owns ${lever.owned}, and this rule defers to it, acting only on the affected word.`;
  });
}

/** The exact text the page must carry between its markers, including both delimiter lines. */
export function generatedBlock(rule: Rule): string {
  const advice = rule.remediation?.advice ?? "";
  const precedence = precedenceLines(rule);
  const body = precedence.length === 0 ? advice : `${advice}\n\n${precedence.join("\n\n")}`;
  return `${BEGIN(rule.id)}\n${body}\n${END(rule.id)}`;
}

export type PageStatus = "current" | "rewritten" | "no-markers";

export function markerPairCount(text: string, rule: Rule): { begins: number; ends: number } {
  const count = (needle: string) => text.split(needle).length - 1;
  return { begins: count(BEGIN(rule.id)), ends: count(END(rule.id)) };
}

export function rewritePageText(text: string, rule: Rule): { text: string; status: PageStatus } {
  // Exactly one pair, or none. `indexOf` would silently bind to the first pair and leave a second,
  // contradicting block below it untouched and unseen — a page could then carry the generated
  // advice and, further down, its opposite.
  const pairs = markerPairCount(text, rule);
  if (pairs.begins !== 1 || pairs.ends !== 1) return { text, status: "no-markers" };
  const begin = text.indexOf(BEGIN(rule.id));
  const end = text.indexOf(END(rule.id));
  if (begin === -1 || end === -1 || end < begin) return { text, status: "no-markers" };
  const current = text.slice(begin, end + END(rule.id).length);
  const wanted = generatedBlock(rule);
  if (current === wanted) return { text, status: "current" };
  return { text: text.slice(0, begin) + wanted + text.slice(end + END(rule.id).length), status: "rewritten" };
}
