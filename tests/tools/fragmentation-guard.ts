/**
 * The widows/orphans guard, as pure functions — read by tests/unit/registry.test.ts.
 *
 * WHY AN ALLOW-LIST. The first version of this guard was a blacklist of phrasings ("ignored",
 * "inert", "does not honour", ...). An audit appended six other ways of saying the same false
 * thing ("disregards", "has no influence", "does not support", "unsupported", "does nothing",
 * "ineffective") and two lowering proposals to the widow advice, and the guard stayed green on all
 * eight. A vocabulary can always be walked around; an enumeration cannot.
 *
 * WHAT IS ENUMERATED (`APPROVED_FRAGMENTATION_TEXTS` in tests/fixtures/fragmentation-levers.ts),
 * each unit bound to its place and judged after whitespace normalisation:
 *   - the COMPLETE advice texts of `layout/widow` and `layout/orphan`, always — so a sentence that
 *     refers to the property without naming it ("Paged.js ignores it anyway") cannot be added;
 *   - every other unit that names a property: a whole advice, summary or sampled finding message of
 *     any rule, and every PARAGRAPH (or heading, table row, list item) of a rule page, of README.md,
 *     of docs/*.md and of the comments of src/api/context.ts — so a sentence added to a paragraph
 *     that names a property fails even when the added sentence does not name it.
 * The approved set is DERIVED FROM THE PIN: a unit asserting that the browser applies a property is
 * approved only while the pinned measurement shows that.
 *
 * TWO CHECKS HOLD EVEN FOR AN APPROVED UNIT, and also run on what the enumeration cannot read —
 * fenced code, HTML comments, inline `style=` attributes and the CSS declarations in them:
 *   - in every pin state: proposing to LOWER an author's own value — a lowering verb or comparative
 *     near a property name, or a 0/1 (or `initial`/`unset`/`revert`) value given to it with `:`,
 *     `=`, `to`, `of` or "value of". The rules' threshold is that value, so lowering it silences a
 *     finding and fixes nothing;
 *   - while the pin says a property is NOT applied: proposing to set or raise it, including any
 *     numeric value given to it.
 * A numeric value above 1 is not treated as lowering: it is how a measured case is named
 * (`widows: 6; orphans: 6`), and it is judged by the enumeration and the second check instead.
 *
 * WHAT IS NOT COVERED: a paragraph that neither names a property nor sits in a pinned advice text
 * ("Both properties are inert under Paged.js." as a paragraph of its own on some page).
 */

import { readFileSync, readdirSync } from "node:fs";

import { runDocument } from "../../src/core/engine.ts";
import type { Rule } from "../../src/core/rule.ts";
import { generatedBlock, pageNameFor } from "../../tools/rule-docs.ts";
import { loadCorpus } from "../fixtures/corpus.ts";
import {
  APPROVED_FRAGMENTATION_TEXTS, PINNED_WHOLE_ADVICE, type FragmentationProperty, type TextPlace,
} from "../fixtures/fragmentation-levers.ts";

export const FRAGMENTATION_PROPERTIES: readonly FragmentationProperty[] = ["widows", "orphans"];

/** A guarded unit of prose, or a code segment, and where it was read. */
export interface GuardedUnit {
  readonly place: string;
  readonly text: string;
  /** Code is judged by the lowering and setting checks only; it cannot be approved. */
  readonly kind: "prose" | "code";
}

export function placeLabel(where: TextPlace): string {
  if ("file" in where) return where.file;
  const field = where.field ?? "advice";
  return `${where.ruleId} ${field === "advice" ? "remediation.advice" : field === "summary" ? "summary" : "finding message"}`;
}

const FENCE = /```[\s\S]*?```/gu;
const HTML_COMMENT = /<!--[\s\S]*?-->/gu;

/**
 * The prose units of a Markdown page, an advice text or a comment block: paragraphs separated by
 * blank lines, with each heading, table row and list item its own unit. Code fences and HTML
 * comments are removed (they are judged as code), blockquote and admonition markers are dropped,
 * whitespace is collapsed.
 */
export function proseUnits(text: string): string[] {
  const withoutCode = text.replace(FENCE, "\n\n").replace(HTML_COMMENT, "\n\n");
  const units: string[] = [];
  for (const block of withoutCode.split(/\n\s*\n/u)) {
    let current: string[] = [];
    for (const raw of block.split("\n")) {
      const line = raw.replace(/^\s*>\s?/u, "");
      if (/^\s*(#|\||\d+\.\s|[-*+]\s)/u.test(line) && current.length > 0) {
        units.push(current.join(" "));
        current = [];
      }
      current.push(line);
    }
    if (current.length > 0) units.push(current.join(" "));
  }
  return units
    .map((unit) => unit.replace(/\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/gu, "").replace(/\s+/gu, " ").trim())
    .filter((unit) => unit.length > 0);
}

/** Sentences of the prose units. A sentence ends at `.`, `!` or `?` followed by whitespace. */
export function proseSentences(text: string): string[] {
  return proseUnits(text).flatMap((unit) => unit.split(/(?<=[.!?])\s+/u)).filter((sentence) => sentence.length > 0);
}

/** Code the prose units do not contain: fences, HTML comments, and every inline `style=` value. */
export function codeSegments(text: string): string[] {
  const segments = [...(text.match(FENCE) ?? []), ...(text.match(HTML_COMMENT) ?? [])];
  for (const match of text.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)) segments.push(match[1] ?? match[2] ?? "");
  return segments;
}

/** Comment text of a source file, with the comment markers removed. Code lines pass through. */
function sourceProse(source: string): string {
  return source.split("\n").map((line) => line.replace(/^\s*(\/\*\*|\/\*|\*\/|\*|\/\/)\s?/u, "")).join("\n");
}

/**
 * A property name as prose may spell it. Rule ids are removed first: `layout/widow` is a rule, and so
 * is "the widow/orphan rule" of CSS Fragmentation §4.3, which the spec says a browser may DROP.
 */
const PROPERTY = String.raw`(?:widows|orphans|(?:widow|orphan)[ -](?:control|property|properties|setting|settings|value|values|handling)|widow\/orphan(?! rule)|widow and orphan(?! rule)|orphan and widow)`;

function withoutRuleIds(text: string): string {
  return text.replace(/\blayout\/(widow|orphan)\b/gu, "");
}

export function namesFragmentationProperty(text: string): boolean {
  return new RegExp(String.raw`\b${PROPERTY}\b`, "iu").test(withoutRuleIds(text));
}

/** Sampled finding messages, with numbers normalised so that one template covers every run. */
export function messageTemplate(message: string): string {
  return message.replace(/\d+(\.\d+)?/gu, "N")
    .replace(/\bN lines? of this block (continue|remain)s?\b/gu, "N line(s) of this block $1")
    .replace(/\bN lines?\b(?!\(s\))/gu, "N line(s)");
}

function sampledMessages(rules: readonly Rule[]): Map<string, Set<string>> {
  const byRule = new Map<string, Set<string>>();
  for (const entry of loadCorpus()) {
    const report = runDocument(
      { path: entry.name, snapshot: entry.snapshot, infrastructure: [] },
      { failOn: "never", activeRules: rules, optionsByRule: {}, coverageFloors: {} },
    ).report;
    for (const finding of report.findings) {
      const set = byRule.get(finding.ruleId) ?? new Set<string>();
      set.add(messageTemplate(finding.message));
      byRule.set(finding.ruleId, set);
    }
  }
  return byRule;
}

/**
 * Every unit the guard covers: each rule's advice, summary and sampled finding messages (the
 * corpus fixtures are the representative inputs); each rule page outside its generated block,
 * which IS the advice, proven verbatim elsewhere; README.md and docs/*.md; the comments of
 * src/api/context.ts. Prose units and code segments both.
 */
export function guardedUnits(rules: readonly Rule[], repoRoot: URL): GuardedUnit[] {
  const units: GuardedUnit[] = [];
  const push = (place: string, text: string, whole: boolean) => {
    for (const unit of whole ? [text.replace(/\s+/gu, " ").trim()] : proseUnits(text)) units.push({ place, text: unit, kind: "prose" });
    for (const segment of codeSegments(text)) units.push({ place, text: segment, kind: "code" });
  };
  const messages = sampledMessages(rules);
  for (const rule of rules) {
    push(placeLabel({ ruleId: rule.id }), rule.remediation?.advice ?? "", true);
    push(placeLabel({ ruleId: rule.id, field: "summary" }), rule.summary, true);
    for (const message of messages.get(rule.id) ?? []) push(placeLabel({ ruleId: rule.id, field: "message" }), message, true);
  }
  const byPage = new Map(rules.map((rule) => [pageNameFor(rule), rule]));
  const rulesDir = new URL("docs/rules/", repoRoot);
  for (const page of readdirSync(rulesDir).filter((name) => name.endsWith(".md")).sort()) {
    let text = readFileSync(new URL(page, rulesDir), "utf8");
    const rule = byPage.get(page);
    if (rule) text = text.replace(generatedBlock(rule), "");
    push(`docs/rules/${page}`, text, false);
  }
  const docsDir = new URL("docs/", repoRoot);
  for (const page of readdirSync(docsDir).filter((name) => name.endsWith(".md")).sort()) {
    push(`docs/${page}`, readFileSync(new URL(page, docsDir), "utf8"), false);
  }
  push("README.md", readFileSync(new URL("README.md", repoRoot), "utf8"), false);
  push("src/api/context.ts", sourceProse(readFileSync(new URL("src/api/context.ts", repoRoot), "utf8")), false);
  return units;
}

const LOWERING_WORDS = String.raw`(?:lower|lowers|lowering|lowered|smaller|reduce|reduces|reducing|reduced|decrease|decreases|decreasing|decreased|drop|drops|dropping|dropped|remove|removes|removing|removed|reset|resets|resetting|unset|unsets|unsetting|delete|deletes|deleting|deleted|omit|omits|omitting|minimi[sz]e|minimi[sz]es|minimi[sz]ing|down)`;
const LOW_VALUE = String.raw`(?:0|1|zero|one|none|initial|unset|revert|revert-layer)`;
const ASSIGN = String.raw`['"\x60]?\s*(?:[:=]|\bto\b|\bof\b|\b(?:value|setting)\b\s*(?:of|to|[:=])?)\s*['"\x60]?\s*`;

/** Proposing to lower an author's own value. Never allowed, in any pin state, approved or not. */
export function proposesLowering(text: string): boolean {
  const t = withoutRuleIds(text);
  return new RegExp(String.raw`\b${LOWERING_WORDS}\b.{0,60}\b${PROPERTY}\b`, "isu").test(t) ||
    new RegExp(String.raw`\b${PROPERTY}\b.{0,40}\b${LOWERING_WORDS}\b`, "isu").test(t) ||
    new RegExp(String.raw`\b${PROPERTY}\b${ASSIGN}${LOW_VALUE}(?![\w.-])`, "iu").test(t);
}

/** Proposing to set or raise a property. Allowed only while the pin shows the browser applying it. */
export function proposesSetting(property: FragmentationProperty, text: string): boolean {
  const name = property === "widows" ? String.raw`(?:widows|widow[ -]control)` : String.raw`(?:orphans|orphan[ -]control)`;
  return new RegExp(
    String.raw`\b${name}\b${ASSIGN}(?:\d|${LOW_VALUE})|` +
      String.raw`\b(?:set|sets|setting|raise|raises|raising|increase|increases|increasing|declare|declares|declaring|choose|use|using|apply|applying|add|adding|specify|configure|try|trying|give|giving)\b.{0,60}\b${name}\b|` +
      String.raw`\b${name}\b.{0,40}\b(?:higher|larger|greater|raised|increased|up)\b|` +
      String.raw`\b${name}\s+\d`,
    "isu",
  ).test(withoutRuleIds(text));
}

/** The approved set under a given pin state, as `place + text` keys. */
export function approvedKeys(applied: Readonly<Record<FragmentationProperty, boolean>>): Set<string> {
  return new Set(APPROVED_FRAGMENTATION_TEXTS
    .filter((entry) => entry.requires.every((property) => applied[property]))
    .map((entry) => `${placeLabel(entry.where)}\u0000${entry.text}`));
}

const PINNED_WHOLE = new Set(PINNED_WHOLE_ADVICE.map((ruleId) => placeLabel({ ruleId })));

/** Whether a guarded unit is judged at all: it names a property, or it is a pinned advice text. */
export function isJudged(unit: GuardedUnit): boolean {
  return namesFragmentationProperty(unit.text) || (unit.kind === "prose" && PINNED_WHOLE.has(unit.place));
}

/**
 * Every problem with the guarded units under a given pin state and approved set: an unapproved
 * prose unit, a lowering proposal (prose or code), or — while the pin says a property is not
 * applied — a proposal to set or raise it. Each message names the unit and where it was read.
 */
export function fragmentationProblems(
  units: readonly GuardedUnit[],
  applied: Readonly<Record<FragmentationProperty, boolean>>,
  approved: ReadonlySet<string> = approvedKeys(applied),
): string[] {
  const problems: string[] = [];
  for (const unit of units) {
    if (!isJudged(unit)) continue;
    const { place, text, kind } = unit;
    if (proposesLowering(text)) {
      problems.push(`${place}: proposes lowering an author's own widows/orphans value, which only moves the threshold (${kind}): ${text}`);
    }
    for (const property of FRAGMENTATION_PROPERTIES) {
      if (!applied[property] && proposesSetting(property, text)) {
        problems.push(`${place}: proposes setting ${property}, which the pinned measurement shows the browser NOT applying (${kind}): ${text}`);
      }
    }
    if (kind === "prose" && !approved.has(`${place}\u0000${text}`)) {
      problems.push(`${place}: ${PINNED_WHOLE.has(place) ? "is not the approved complete advice text" : "names widows/orphans in a unit that is not approved"} ` +
        `under the pin (tests/fixtures/fragmentation-levers.ts, APPROVED_FRAGMENTATION_TEXTS): ${text}`);
    }
  }
  return problems;
}
