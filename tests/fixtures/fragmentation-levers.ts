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

export interface DecidedClaim {
  /** Which part of the pin decides it. */
  readonly decidedBy: "widows" | "orphans" | "soft-hyphen";
  /** Where it is published: a rule's `remediation.advice`, or a documentation file. */
  readonly where: { readonly ruleId: string } | { readonly file: string };
  /** A verbatim excerpt; the unit suite checks it is present. */
  readonly sentence: string;
}

export const CLAIMS_DECIDED_BY_THE_PIN: readonly DecidedClaim[] = Object.freeze([
  {
    decidedBy: "widows",
    where: { ruleId: "layout/widow" },
    sentence:
      "Chromium applies a paragraph's 'widows' and 'orphans' when Paged.js splits it; when the paragraph has too few lines at the break to satisfy both, the browser keeps 'orphans' and relaxes 'widows'",
  },
  {
    decidedBy: "widows",
    where: { file: "docs/rules/layout-widow.md" },
    sentence: "Chromium applies `widows` when Paged.js splits a paragraph.",
  },
  {
    decidedBy: "orphans",
    where: { ruleId: "layout/orphan" },
    sentence:
      "Chromium applies a paragraph's 'widows' and 'orphans' when Paged.js splits it, and moves the whole paragraph to the next page when the page has room for fewer lines than 'orphans'",
  },
  {
    decidedBy: "orphans",
    where: { file: "docs/rules/layout-orphan.md" },
    sentence: "Chromium applies `orphans` when Paged.js splits a paragraph.",
  },
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
