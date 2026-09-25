/**
 * What the browser that runs the live suite does with two families of CSS levers that rule advice
 * names — the PINNED half of tests/live/fragmentation-levers.test.ts.
 *
 * Until this record existed the project said, in two advice texts, two rule pages and a registry
 * guard, that CSS `widows` and `orphans` are "ignored by Paged.js". Paged.js 0.4.3 does not read
 * either property, which is true and was the whole argument; but it lays every page out in a CSS
 * multi-column fragmentainer and splits where the browser's own column break fell, and the browser
 * applies both properties there. Nobody had asked the browser. The guard then banned an effective
 * lever, which is the failure a guard exists to prevent, in the opposite direction.
 *
 * So the question is answered by measurement, the answer is pinned here, and everything published
 * that depends on it names the pin:
 *
 *   - the live test renders the fixtures through the production chain and asserts that the browser
 *     still produces exactly these splits and classes. A browser that stops applying `widows`
 *     turns it red, and so does a browser that starts doing something the pin does not say;
 *   - the unit guard in tests/unit/registry.test.ts reads `leversApplied()` from this file: advice
 *     may propose `widows`/`orphans` only while the pin says the browser applies them, and may not
 *     call them inert while it says so;
 *   - `CLAIMS_DECIDED_BY_THE_PIN` lists the published sentences the pin decides. The unit suite
 *     checks each is present verbatim; the live test prints the list when the browser disagrees,
 *     so a red CI run names the sentences to change.
 *
 * Recorded on patched Chromium 141.0.7390.37 with Paged.js 0.4.3 and no evidence binding (the
 * local browser lacks two globals the product needs; the measurement shims touch neither layout
 * nor rules). CI on the supported Chrome is the authority: if it disagrees, the live test is red
 * until this record and the sentences it names are changed together.
 */

export const PIN_RECORDED_ON =
  "patched Chromium 141.0.7390.37, Paged.js 0.4.3, no evidence binding, 2026-09-25";

export const WIDOWS_ORPHANS_FIXTURE = "tests/fixtures/widows-orphans.html";
export const SOFT_HYPHEN_FIXTURE = "tests/fixtures/soft-hyphen-boundary.html";

/**
 * Lines of the 9-line probe paragraph on its label's page and on the page after, per case in
 * tests/fixtures/widows-orphans.html. `[0, 9]` means the browser moved the whole paragraph.
 */
export const WIDOWS_ORPHANS_SPLITS = Object.freeze({
  "w1": [8, 1],
  "w-default": [7, 2],
  "w5": [4, 5],
  "o1-a": [1, 8],
  "o-default-a": [0, 9],
  "o4-a": [0, 9],
  "o1-b": [3, 6],
  "o-default-b": [3, 6],
  "o4-b": [0, 9],
  "relaxed": [6, 3],
} as const satisfies Record<string, readonly [number, number]>);

export type WidowsOrphansCase = keyof typeof WIDOWS_ORPHANS_SPLITS;
export type Splits = Readonly<Record<WidowsOrphansCase, readonly [number, number]>>;

export const WIDOWS_CASES: readonly WidowsOrphansCase[] = ["w1", "w-default", "w5"];
export const ORPHANS_CASES: readonly WidowsOrphansCase[] = [
  "o1-a", "o-default-a", "o4-a", "o1-b", "o-default-b", "o4-b",
];

/**
 * Whether a set of splits shows the browser applying each property.
 *
 * Derived, not declared, so that the pin cannot say "applied" over splits that say otherwise. A
 * browser that ignored `widows` would split all three widows cases 8+1; one that ignored `orphans`
 * would split `o-default-a` like `o1-a` and `o4-b` like `o-default-b`.
 */
export function leversApplied(splits: Splits): { widows: boolean; orphans: boolean } {
  const same = (a: WidowsOrphansCase, b: WidowsOrphansCase) =>
    splits[a][0] === splits[b][0] && splits[a][1] === splits[b][1];
  return {
    widows: !same("w1", "w-default") && !same("w-default", "w5"),
    orphans: !same("o1-a", "o-default-a") && !same("o-default-b", "o4-b"),
  };
}

/**
 * Per case in tests/fixtures/soft-hyphen-boundary.html: the lines on the label's page and the page
 * after, and whether Paged.js marked the first fragment with its boundary-hyphen class — the class
 * `layout/hyphen-across-page` reports.
 */
export const SOFT_HYPHEN_BOUNDARY = Object.freeze({
  "shy": { split: [3, 3], boundaryHyphen: true },
  "space": { split: [3, 3], boundaryHyphen: false },
  "span-none": { split: [3, 3], boundaryHyphen: false },
  "nowrap": { split: [3, 3], boundaryHyphen: false },
} as const satisfies Record<string, { split: readonly [number, number]; boundaryHyphen: boolean }>);

export type SoftHyphenCase = keyof typeof SOFT_HYPHEN_BOUNDARY;

export type FragmentationProperty = "widows" | "orphans";

/** Where a sentence is published: a rule's `remediation.advice`, or a file. */
export type SentencePlace = { readonly ruleId: string } | { readonly file: string };

/**
 * EVERY sentence the guarded texts may contain that names `widows` or `orphans` — each rule's
 * advice, each rule page outside its generated block, docs/agent-contract.md and the comments of
 * src/api/context.ts (see tests/tools/fragmentation-guard.ts). Exact, whitespace-normalised
 * sentences, each bound to one place.
 *
 * `requires` says what the sentence asserts about the browser. Empty: nothing (a threshold, a
 * definition, a measured split that holds whatever the reason). Otherwise: that the browser applies
 * each listed property, and the sentence is approved only while `leversApplied(WIDOWS_ORPHANS_SPLITS)`
 * says so for all of them, which is what "derived from the pin" means. Adding a sentence here is a review decision, not a formality.
 */
export interface ApprovedSentence {
  readonly where: SentencePlace;
  readonly sentence: string;
  readonly requires: readonly FragmentationProperty[];
}

const WIDOW_ADVICE = { ruleId: "layout/widow" } as const;
const ORPHAN_ADVICE = { ruleId: "layout/orphan" } as const;
const WIDOW_PAGE = { file: "docs/rules/layout-widow.md" } as const;
const ORPHAN_PAGE = { file: "docs/rules/layout-orphan.md" } as const;

export const APPROVED_FRAGMENTATION_SENTENCES: readonly ApprovedSentence[] = Object.freeze([
  // layout/widow remediation.advice
  { where: WIDOW_ADVICE, requires: [], sentence: "A block fragments across a page break and the fragment OPENING the next page carries fewer lines than the block's own 'widows' value (plus any configured extra lines) asks for." },
  { where: WIDOW_ADVICE, requires: ["widows", "orphans"], sentence: "Chromium applies a paragraph's 'widows' and 'orphans' when Paged.js splits it; when the paragraph has too few lines at the break to satisfy both, the browser keeps 'orphans' and relaxes 'widows', as CSS Fragmentation Level 3 permits, so this rule is only a warning." },
  { where: WIDOW_ADVICE, requires: [], sentence: "Changing the block's 'widows' moves the threshold with it and is not a fix." },
  // layout/orphan remediation.advice
  { where: ORPHAN_ADVICE, requires: [], sentence: "A block fragment ENDS at a page break carrying fewer lines than the block's own 'orphans' value (plus any configured extra lines) asks for." },
  { where: ORPHAN_ADVICE, requires: ["widows", "orphans"], sentence: "Chromium applies a paragraph's 'widows' and 'orphans' when Paged.js splits it, and moves the whole paragraph to the next page when the page has room for fewer lines than 'orphans'; CSS Fragmentation Level 3 still permits a split that keeps fewer, so this rule is only a warning." },
  { where: ORPHAN_ADVICE, requires: [], sentence: "Changing the block's 'orphans' moves the threshold with it and is not a fix." },
  // docs/rules/layout-widow.md, outside the generated block
  { where: WIDOW_PAGE, requires: [], sentence: "| threshold | the element's own `widows` value |" },
  { where: WIDOW_PAGE, requires: [], sentence: "So `lines < widows` does not prove a defect — it may be exactly the relaxation the specification permits, and this version has no way to prove the relaxation was unwarranted." },
  { where: WIDOW_PAGE, requires: [], sentence: "At `widows: 6; orphans: 6` a 9-line paragraph with room for 8 lines splits 6+3, which **is** a violation — a permitted one, because widows+orphans = 12 exceeds the 9 lines and no conforming split exists." },
  { where: WIDOW_PAGE, requires: ["widows", "orphans"], sentence: "The browser kept `orphans` and relaxed `widows`." },
  { where: WIDOW_PAGE, requires: ["widows"], sentence: "Chromium applies `widows` when Paged.js splits a paragraph." },
  { where: WIDOW_PAGE, requires: ["widows"], sentence: "Paged.js 0.4.3 never reads the property, but it cuts every page where the browser's own column fragmentation broke, and the browser honours `widows` there: over one geometry, `widows` 1, the initial 2 and 5 split a 9-line paragraph 8+1, 7+2 and 4+5." },
  // docs/rules/layout-orphan.md, outside the generated block
  { where: ORPHAN_PAGE, requires: [], sentence: "| threshold | the element's own `orphans` value |" },
  { where: ORPHAN_PAGE, requires: [], sentence: "The mirror of `layout/widow`, with the same permanent ceiling of `warn` for the same reason: CSS Fragmentation Level 3 §4.3 lets the browser drop the widow/orphan rule when no conforming split exists, so `lines < orphans` does not prove a defect." },
  { where: ORPHAN_PAGE, requires: ["orphans"], sentence: "Chromium applies `orphans` when Paged.js splits a paragraph." },
  { where: ORPHAN_PAGE, requires: ["orphans"], sentence: "Paged.js 0.4.3 never reads the property, but it cuts every page where the browser's own column fragmentation broke, and the browser honours `orphans` there." },
  { where: ORPHAN_PAGE, requires: ["orphans"], sentence: "With room for one line of a 9-line paragraph, `orphans: 1` splits it 1+8 while the initial 2 and `orphans: 4` move it whole to the next page; with room for three lines, `orphans: 1` and the initial value split it 3+6 and `orphans: 4` moves it." },
  // docs/agent-contract.md
  { where: { file: "docs/agent-contract.md" }, requires: ["widows", "orphans"], sentence: "*(Note: CSS `widows` and `orphans` do take effect on paragraphs: Paged.js never reads them, but the browser applies them through its own fragmentation inside Paged.js's flow." },
  // src/api/context.ts, the repair map's comment
  { where: { file: "src/api/context.ts" }, requires: [], sentence: "The CSS `widows` and `orphans` values are deliberately not offered as repairs." },
]);

export interface DecidedClaim {
  /** Which part of the pin decides it. */
  readonly decidedBy: "widows" | "orphans" | "soft-hyphen";
  /** Where it is published: a rule's `remediation.advice`, or a file. */
  readonly where: SentencePlace;
  /** A verbatim excerpt; the unit suite checks it is present. */
  readonly sentence: string;
}

/**
 * The published sentences the pin decides: every approved widows/orphans sentence that asserts the
 * browser applies a property, and the two soft-hyphen claims of `layout/hyphen-across-page`.
 */
export const CLAIMS_DECIDED_BY_THE_PIN: readonly DecidedClaim[] = Object.freeze([
  ...APPROVED_FRAGMENTATION_SENTENCES.flatMap((entry): DecidedClaim[] =>
    entry.requires.map((property) => ({ decidedBy: property, where: entry.where, sentence: entry.sentence }))),
  {
    decidedBy: "soft-hyphen",
    where: { ruleId: "layout/hyphen-across-page" },
    sentence: "a split right after a soft hyphen counts as one",
  },
  {
    decidedBy: "soft-hyphen",
    where: { ruleId: "layout/hyphen-across-page" },
    sentence: "wrap it in '<span style=\"hyphens: none\">' or 'white-space: nowrap'",
  },
]);

/** The published sentences a disagreeing browser would falsify, for a red run to print. */
export function claimsToChange(decidedBy: DecidedClaim["decidedBy"]): string {
  return CLAIMS_DECIDED_BY_THE_PIN.filter((claim) => claim.decidedBy === decidedBy)
    .map((claim) => {
      const where = "ruleId" in claim.where
        ? `${claim.where.ruleId} remediation.advice (src/rules/**, then npm run docs:rules:write)`
        : claim.where.file;
      return `  - ${where}: "${claim.sentence}"`;
    })
    .join("\n");
}
