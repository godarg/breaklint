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
 * This module answers "what must the page say" and nothing else. It performs no I/O ON PURPOSE:
 * the first shape put the generator and the answer in one file, the unit test imported it for the
 * answer, and importing it REWROTE the pages the test was about to check — so the gate repaired
 * its own subject, and a mutation probe found the mutant green. The writing lives in
 * `write-rule-docs.ts`, which nothing under `tests/` imports.
 */

import type { Rule } from "../src/core/rule.ts";

export const BEGIN = (id: string) => `<!-- begin generated remediation: ${id} -->`;
export const END = (id: string) => `<!-- end generated remediation: ${id} -->`;

export function pageNameFor(rule: Rule): string {
  return `${rule.id.replace("/", "-")}.md`;
}

/** The exact text the page must carry between its markers, including both delimiter lines. */
export function generatedBlock(rule: Rule): string {
  const advice = rule.remediation?.advice ?? "";
  return `${BEGIN(rule.id)}\n${advice}\n${END(rule.id)}`;
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
