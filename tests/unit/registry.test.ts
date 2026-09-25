import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";

import { ALL_RULES, RULES_BY_ID, VALIDATION_RULES_BY_ID } from "../../src/rules/index.ts";
import { generatedBlock, markerPairCount, pageNameFor, precedenceLines } from "../../tools/rule-docs.ts";
import { IS, SEVERITIES } from "../../src/core/enums.ts";
import {
  defineRule, interactionProblems, type InteractionRelation, type InteractionScope, type RemediationInteraction,
  type RuleMeta,
} from "../../src/core/rule.ts";
import {
  APPROVED_FRAGMENTATION_SENTENCES, CLAIMS_DECIDED_BY_THE_PIN, leversApplied, SOFT_HYPHEN_BOUNDARY,
  WIDOWS_ORPHANS_SPLITS,
} from "../fixtures/fragmentation-levers.ts";
import {
  approvedKeys, fragmentationProblems, guardedTexts, placeLabel, proseSentences, sentencesNamingProperties,
} from "../tools/fragmentation-guard.ts";

/**
 * Whether the browser applies `widows`/`orphans` under Paged.js is a MEASUREMENT, pinned in
 * tests/fixtures/fragmentation-levers.ts and re-taken in CI by tests/live/fragmentation-levers.test.ts.
 *
 * This guard used to be a flat ban on both properties, written on the assumption that Paged.js
 * makes them inert. It was never measured, and on measurement it was wrong: the browser applies
 * both when Paged.js splits a paragraph. Its successor was a blacklist of ways to call them inert,
 * and an audit walked around it eight times. It is now an allow-list derived from the pin; see
 * tests/tools/fragmentation-guard.ts for why and how.
 */
const APPLIED = leversApplied(WIDOWS_ORPHANS_SPLITS);
const REPO_ROOT = new URL("../../", import.meta.url);

/**
 * Block-level `hyphens: none` recommended for justified text. `type/excessive-word-spacing` owns
 * the block-level `hyphens` setting of justified blocks (declared in `remediation.interactions`),
 * so a sentence naming `hyphens: none` must either be word-local markup or say that it is for a
 * block that is not justified; a warning against it is allowed.
 */
function justifiedHyphensNoneProblems(text: string, where: string): string[] {
  const problems: string[] = [];
  for (const sentence of proseSentences(text)) {
    if (!/hyphens:\s*none/iu.test(sentence)) continue;
    const wordLocal = /<span\b[^>]*hyphens:\s*none/iu.test(sentence);
    const notJustified = /\b(not justified|non-justified|unjustified)\b/iu.test(sentence);
    const warnsAgainst = /\b(do not|never)\b/iu.test(sentence);
    if (!wordLocal && !notJustified && !warnsAgainst) {
      problems.push(`${where} names block-level 'hyphens: none' without excluding justified text: ${sentence}`);
    }
  }
  for (const fence of text.match(/```[\s\S]*?```/gu) ?? []) {
    for (const style of fence.match(/style="[^"]*"/gu) ?? []) {
      if (/text-align:\s*justify/iu.test(style) && /hyphens:\s*none/iu.test(style)) {
        problems.push(`${where} shows a justified element with block-level 'hyphens: none': ${style}`);
      }
    }
  }
  return problems;
}

describe("rule registry", () => {
  it("every rule declares a valid severity and a consistent proof source", () => {
    for (const rule of ALL_RULES) {
      assert.ok(SEVERITIES.includes(rule.severity), `${rule.id}: bad severity`);
      if (rule.severity === "error") assert.ok(rule.proofSource, `${rule.id}: error without proof source`);
      else assert.equal(rule.proofSource, null, `${rule.id}: proof source on a non-error`);
    }
  });

  it("no rule claims calibration", () => {
    // The corpus of >= 30 real documents with human-checked truth does not exist. Saying so in
    // the type, in every finding and in the docs is the honest form. The two withdrawn ink
    // definitions remain under this guard too: research-only must not become calibrated by drift.
    assert.equal(ALL_RULES.length, 13, "released rule count drifted");
    assert.equal(VALIDATION_RULES_BY_ID.size, 15, "released + research rule inventory drifted");
    for (const rule of VALIDATION_RULES_BY_ID.values()) assert.equal(rule.calibrated, false, `${rule.id}`);
  });

  it("every declined reason is a declared EnvId", () => {
    for (const rule of ALL_RULES) {
      for (const reason of rule.declines) {
        assert.ok(IS.envId.has(reason), `${rule.id}: ${reason} is not a declared EnvId`);
      }
    }
  });

  it("every rule has a documentation page", () => {
    // Three mandatory artefacts per rule: the module, a fixture, and a page. An agent cannot
    // half-finish a procedure whose artefacts are enforced.
    const missing = ALL_RULES.filter(
      (r) => !existsSync(new URL(`../../docs/rules/${r.id.replace("/", "-")}.md`, import.meta.url)),
    );
    assert.deepEqual(missing.map((r) => r.id), [], "rules without docs/rules/<id>.md");
  });

  it("every rule summary is one sentence in the third person about the document", () => {
    for (const rule of ALL_RULES) {
      assert.ok(rule.summary.length > 20, `${rule.id}: summary too short`);
      assert.ok(!/\byou\b|\byour\b/iu.test(rule.summary), `${rule.id}: addresses the reader`);
      assert.ok(!/[!]/u.test(rule.summary), `${rule.id}: exclamation mark`);
    }
  });

  it("every released rule declares an actionable remediation", () => {
    for (const rule of ALL_RULES) {
      assert.ok(rule.remediation && rule.remediation.advice.length > 20, `${rule.id}: missing remediation`);
      assert.equal(typeof rule.remediation!.tested, "boolean", `${rule.id}: remediation must state whether a proof pair backs it`);
    }
  });

  it("every sentence naming widows/orphans in advice, rule pages, the agent contract and the repair map is approved by the pin", () => {
    assert.deepEqual(Object.keys(APPLIED).sort(), ["orphans", "widows"], "the guard must have a pin to follow");
    const sentences = sentencesNamingProperties(guardedTexts(ALL_RULES, REPO_ROOT));
    assert.ok(sentences.length >= 15, `the guard reads too few sentences to be guarding anything (${sentences.length})`);
    assert.deepEqual(fragmentationProblems(sentences, APPLIED), []);
    // And the other way round: every sentence approved under this pin is still published, so the
    // list cannot silently keep approvals for text that no longer exists.
    const published = new Set(sentences.map(({ place, sentence }) => `${place}\u0000${sentence}`));
    const stale = [...approvedKeys(APPLIED)].filter((key) => !published.has(key)).map((key) => key.replace("\u0000", ": "));
    assert.deepEqual(stale, [], "approved sentences that are no longer published — remove or update them");
  });

  /**
   * The negative controls, kept in the suite. The first eight are the phrasings an audit appended to
   * the widow advice while the previous, blacklist version of this guard stayed green; the rest are
   * one more per direction. Each is judged exactly where the real advice is judged.
   */
  it("refuses the phrasings that walked around the old guard, lowering in any pin state, and raising while not applied", () => {
    const place = placeLabel({ ruleId: "layout/widow" });
    const judge = (sentence: string, applied: typeof APPLIED) =>
      fragmentationProblems(proseSentences(sentence).map((text) => ({ place, sentence: text })), applied);
    const inertOrUnapproved = [
      "Paged.js disregards 'widows' entirely.",
      "The 'widows' property has no influence under Paged.js.",
      "Paged.js does not support 'widows'.",
      "'widows' is unsupported by the paginator.",
      "Setting 'widows' does nothing here.",
      "Paged.js 0.4.3 has no widows implementation, so it is ineffective.",
      "Chromium overlooks 'orphans' in paginated output.",
    ];
    for (const sentence of inertOrUnapproved) {
      assert.match(judge(sentence, APPLIED).join("\n"), /not in the approved set/u, `accepted: ${sentence}`);
    }
    const lowering = [
      "Or set 'widows: 1' on the paragraph.",
      "Lowering the paragraph's widows makes the finding disappear.",
      "Reduce the block's orphans to 1 so the split conforms.",
    ];
    for (const sentence of lowering) {
      for (const applied of [APPLIED, { widows: false, orphans: false }]) {
        assert.match(judge(sentence, applied).join("\n"), /proposes lowering/u, `lowering accepted under ${JSON.stringify(applied)}: ${sentence}`);
      }
      // Pin-independent means approval-independent too: approving the sentence does not admit it.
      const approvedAnyway = new Set([`${place}\u0000${sentence}`]);
      assert.match(
        fragmentationProblems([{ place, sentence }], APPLIED, approvedAnyway).join("\n"),
        /proposes lowering/u,
        `an approved lowering sentence was accepted: ${sentence}`,
      );
    }
    const notApplied = { widows: false, orphans: false };
    for (const sentence of ["Raising the paragraph's 'widows' to 3 keeps more lines together.", "Try widows 3.", "Increase 'orphans' on the block."]) {
      const approvedAnyway = new Set([`${place}\u0000${sentence}`]);
      assert.match(
        fragmentationProblems([{ place, sentence }], notApplied, approvedAnyway).join("\n"),
        /proposes setting (widows|orphans), which the pinned measurement shows the browser NOT applying/u,
        `raising accepted while the pin says not applied: ${sentence}`,
      );
    }
    // Controls in the other direction: the real approved sentences pass, and under a pin that says
    // "not applied" the sentences asserting application stop being approved.
    const real = sentencesNamingProperties(guardedTexts(ALL_RULES, REPO_ROOT));
    assert.deepEqual(fragmentationProblems(real, APPLIED), []);
    const underInertPin = fragmentationProblems(real, notApplied).join("\n");
    for (const entry of APPROVED_FRAGMENTATION_SENTENCES.filter((item) => item.requires.length > 0)) {
      assert.ok(underInertPin.includes(entry.sentence), `still approved under a pin that says not applied: ${entry.sentence}`);
    }
  });

  /**
   * The pin decides published sentences, and names them. Each named sentence must be where the pin
   * says (so a red live run's list is accurate), and must agree with the pin (so changing the pin
   * after a disagreeing CI run is red here until the sentences change with it).
   */
  it("every published sentence the pinned measurement decides is present, and agrees with the pin", () => {
    assert.ok(CLAIMS_DECIDED_BY_THE_PIN.length >= 6, "the pin names too few of the sentences it decides");
    const softHyphenMarked =
      SOFT_HYPHEN_BOUNDARY.shy.boundaryHyphen && !SOFT_HYPHEN_BOUNDARY.space.boundaryHyphen;
    const wordLocalLeversWork =
      !SOFT_HYPHEN_BOUNDARY["span-none"].boundaryHyphen && !SOFT_HYPHEN_BOUNDARY.nowrap.boundaryHyphen;
    for (const claim of CLAIMS_DECIDED_BY_THE_PIN) {
      if ("ruleId" in claim.where) {
        const advice = RULES_BY_ID.get(claim.where.ruleId)?.remediation?.advice ?? "";
        assert.ok(advice.includes(claim.sentence), `${claim.where.ruleId} remediation.advice no longer says: ${claim.sentence}`);
      } else {
        // Judged on the same normalised prose the sentence guard reads: a wrapped blockquote
        // sentence is one sentence.
        const text = proseSentences(readFileSync(new URL(`../../${claim.where.file}`, import.meta.url), "utf8")).join(" ");
        assert.ok(text.includes(claim.sentence), `${claim.where.file} no longer says: ${claim.sentence}`);
      }
      // Every decided sentence is affirmative today: it says the lever takes effect.
      const holds = claim.decidedBy === "soft-hyphen" ? softHyphenMarked && wordLocalLeversWork : APPLIED[claim.decidedBy];
      assert.ok(holds, `the pin no longer supports "${claim.sentence}" (${"ruleId" in claim.where ? claim.where.ruleId : claim.where.file}); change the sentence with the pin`);
    }
  });

  /**
   * One remediation text, two readers.
   *
   * `remediation.advice` is what the CLI prints and what travels to every consumer as
   * `Finding.remediation`; `docs/rules/<id>.md` is what a person reads. Until 0.6.0 they were
   * written separately and 10 of 13 pairs disagreed — the pages named eight levers the rules do
   * not know, including "remove `break-inside: avoid`" for the one rule whose own advice explains
   * why that clears the finding without fixing anything. A correction to either source never
   * reached the other, and the drifting copy was the one a human read.
   *
   * The binding is a verbatim block, not a similarity check: a substring or token comparison
   * cannot say which of two readings is current, and a page is free to add context AROUND the
   * block. Mutating one word in either source turns this red.
   */
  it("every rule page carries its rule's remediation verbatim, and proposes no lever the rule does not", () => {
    const dir = new URL("../../docs/rules/", import.meta.url);
    // Actionable levers only. A property named as a MEASUREMENT ("a page of prose at
    // line-height: 1.5 reaches ...") is not a proposal, so the guard also requires an imperative
    // nearby — the same shape the inert-property guard above uses, for the same reason.
    const LEVERS = [
      "break-inside", "break-before", "break-after", "page-break-before", "page-break-after",
      "hyphens", "text-align", "text-wrap", "word-spacing", "overflow", "widows", "orphans",
      "line-height", "font-size", "column-width", "columns", "quotes",
    ];
    const IMPERATIVE = /\b(set|use|apply|add|insert|enable|disable|remove|replace|increase|reduce|lower|raise|adjust|specify|configure|prevent|force|keep|try|wrap|mark)\b/iu;
    const WARNS_AGAINST = /\b(do not|does not|never|absent|not honour|not honor|ignored|inert|reaches at most)\b/iu;

    for (const rule of ALL_RULES) {
      const page = pageNameFor(rule);
      const text = readFileSync(new URL(page, dir), "utf8");
      const block = generatedBlock(rule);
      assert.ok(
        text.includes(block),
        `docs/rules/${page} does not carry the remediation of ${rule.id} verbatim — run npm run docs:rules:write`,
      );
      // Exactly one pair. A second marker pair further down would carry a contradicting text that
      // neither the writer nor a substring check would ever look at.
      assert.deepEqual(
        markerPairCount(text, rule),
        { begins: 1, ends: 1 },
        `docs/rules/${page} does not carry exactly one generated remediation block for ${rule.id}`,
      );

      // The rest of the Remediation section may explain; it may not propose a second cure.
      const sectionStart = text.indexOf("\n## Remediation\n");
      assert.ok(sectionStart !== -1, `docs/rules/${page}: no ## Remediation section`);
      let sectionEnd = text.indexOf("\n## ", sectionStart + "\n## Remediation\n".length);
      if (sectionEnd === -1) sectionEnd = text.length;
      const section = text.slice(sectionStart, sectionEnd);
      const outside = section.replace(block, "");
      const advice = rule.remediation!.advice;
      for (const [offset, line] of outside.split("\n").entries()) {
        if (WARNS_AGAINST.test(line) || !IMPERATIVE.test(line)) continue;
        for (const lever of LEVERS) {
          if (!new RegExp(`\\b${lever}\\b`, "u").test(line)) continue;
          assert.ok(
            advice.includes(lever),
            `docs/rules/${page} (remediation section, line ${offset + 1}) proposes "${lever}", which ${rule.id} does not: ${line.trim()}`,
          );
        }
      }
    }
  });

  /*
   * The guard above reads rule.remediation only. The repair advice an agent actually receives also
   * comes from the per-rule map in src/api/context.ts, and until 2026-09-17 exactly that map
   * recommended a "widows setting" and an "orphans setting" — the one advice this project has
   * measured to be inert. A guard that cannot see the second source is not a guard.
   *
   * This reads the WHOLE file, not a slice between two delimiters: a cross-model audit pointed out
   * that a slice stops guarding the moment either delimiter moves, is renamed, or first occurs
   * inside a comment. It also asserts that the map is still reached from `card`, because a guard
   * over dead code is a guard over nothing.
   */
  it("the agent-facing repair map is still reached, so the sentence guard above covers a live map", () => {
    // The map's text, comments included, is judged by the sentence guard above; this keeps that
    // from being a guard over dead code.
    const source = readFileSync(new URL("../../src/api/context.ts", import.meta.url), "utf8");
    assert.match(source, /function repairOptions\(/u, "repairOptions is gone — this guard has lost its subject");
    assert.match(source, /repair:\s*\{[^}]*options:\s*repairOptions\(/u, "repairOptions is no longer reached from the finding card");
    assert.ok(
      sentencesNamingProperties(guardedTexts(ALL_RULES, REPO_ROOT)).some(({ place }) => place === "src/api/context.ts"),
      "the repair map's comment no longer names the properties — check the guard still reads the file",
    );
  });

  /**
   * The hyphenation pair, measured before this existed: `layout/hyphen-across-page` advised turning
   * hyphenation off for the paragraph and `type/excessive-word-spacing` advised turning it on, and
   * each text said only that the two "pull in opposite directions". An agent obeying both loops.
   * The order is now declared once, on both rules, and this is where "on both" is enforced: delete
   * either side and the validator names the missing half.
   */
  it("the hyphenation precedence is declared on both rules, as opposites, and each advice names the other rule", () => {
    assert.deepEqual(interactionProblems(ALL_RULES), []);
    const hyphenation = ALL_RULES.flatMap((rule) =>
      (rule.remediation?.interactions ?? []).filter((interaction) => interaction.lever === "hyphens" || interaction.lever === "soft-hyphen")
        .map((interaction) => ({ from: rule.id, ...interaction })));
    assert.deepEqual(hyphenation, [
      { from: "layout/hyphen-across-page", ruleId: "type/excessive-word-spacing", lever: "hyphens", relation: "defers", scope: "justified" },
      { from: "layout/hyphen-across-page", ruleId: "type/excessive-word-spacing", lever: "soft-hyphen", relation: "defers", scope: "justified" },
      { from: "type/excessive-word-spacing", ruleId: "layout/hyphen-across-page", lever: "hyphens", relation: "prevails", scope: "justified" },
      { from: "type/excessive-word-spacing", ruleId: "layout/hyphen-across-page", lever: "soft-hyphen", relation: "prevails", scope: "justified" },
    ]);
  });

  it("the precedence validator refuses a one-sided, same-sided or dangling pair and an advice that does not name its partner", () => {
    const pair = (relation: InteractionRelation, ruleId: string, overrides: Partial<RemediationInteraction> = {}): RemediationInteraction =>
      ({ ruleId, lever: "hyphens", relation, scope: "justified", ...overrides });
    const meta = (id: string, advice: string, interactions: RemediationInteraction[]) =>
      ({ id, remediation: { advice, tested: false, interactions } });
    const a = meta("layout/a", "Defers to 'type/b' on hyphens.", [pair("defers", "type/b")]);
    const b = meta("type/b", "Prevails over 'layout/a' on hyphens.", [pair("prevails", "layout/a")]);
    // The control first: a correct pair is accepted, so every rejection below is about its defect.
    assert.deepEqual(interactionProblems([a, b]), []);

    const cases: [string, Parameters<typeof interactionProblems>[0], RegExp][] = [
      ["one-sided", [a, meta("type/b", "Names 'layout/a' and hyphens.", [])], /type\/b declares no prevails in return/u],
      ["same-sided", [a, meta("type/b", "Names 'layout/a' and hyphens.", [pair("defers", "layout/a")])], /declares defers in return, not prevails/u],
      ["other lever", [a, meta("type/b", "Names 'layout/a' and &shy;.", [pair("prevails", "layout/a", { lever: "soft-hyphen" })])], /declares no prevails in return/u],
      ["dangling", [a], /type\/b is not a registered rule/u],
      ["silent advice", [meta("layout/a", "Says nothing about the other rule, only hyphens.", [pair("defers", "type/b")]), b], /does not name 'type\/b'/u],
      ["self", [meta("layout/a", "Names 'layout/a' and hyphens.", [pair("defers", "layout/a")])], /cannot take precedence over itself/u],
      ["unknown relation", [meta("layout/a", "Names 'type/b' and hyphens.", [pair("overrides" as InteractionRelation, "type/b")]), b], /relation "overrides"/u],
      ["unknown lever", [meta("layout/a", "Names 'type/b' and hyphens.", [pair("defers", "type/b", { lever: "kerning" as RemediationInteraction["lever"] })]), b], /lever "kerning"/u],
      ["lever never mentioned", [meta("layout/a", "Names 'type/b' and hyphens.", [pair("defers", "type/b", { lever: "soft-hyphen" })]), b], /never mentions &shy;/u],
      ["unknown scope", [meta("layout/a", "Names 'type/b' and hyphens.", [pair("defers", "type/b", { scope: "everywhere" as InteractionScope })]), b], /scope "everywhere"/u],
    ];
    for (const [name, rules, expected] of cases) {
      assert.match(interactionProblems(rules).join("\n"), expected, `${name}: the validator did not name the defect`);
    }

    // defineRule refuses a malformed declaration at load, before any registry exists.
    const base: RuleMeta = {
      id: "layout/a", severity: "warn", proofSource: null, calibrated: false, experimental: false, unit: "x",
      defaultOptions: {}, summary: "A synthetic rule used only by this test case.", declines: [],
    };
    const run = () => ({ findings: [], candidates: 0, measured: 0, notMeasured: [], evaluations: [] });
    assert.throws(
      () => defineRule({ ...base, remediation: { advice: "Names nobody.", tested: false, interactions: [pair("defers", "type/b")] } }, run),
      /invalid remediation\.interactions — .*does not name 'type\/b'/u,
    );
    assert.doesNotThrow(() => defineRule({ ...base, remediation: { advice: "Defers to 'type/b' on hyphens.", tested: false, interactions: [pair("defers", "type/b")] } }, run));
  });

  it("each rule page renders its precedence from remediation.interactions, and no page carries one it does not declare", () => {
    const dir = new URL("../../docs/rules/", import.meta.url);
    for (const rule of ALL_RULES) {
      const text = readFileSync(new URL(pageNameFor(rule), dir), "utf8");
      const lines = precedenceLines(rule);
      assert.equal(
        text.split("**Precedence.**").length - 1,
        lines.length,
        `docs/rules/${pageNameFor(rule)} carries a precedence line its rule does not declare, or lacks one it does`,
      );
      for (const line of lines) assert.ok(text.includes(line), `docs/rules/${pageNameFor(rule)} lacks: ${line}`);
    }
  });

  it("no advice and no rule page recommends block-level 'hyphens: none' for justified text", () => {
    const dir = new URL("../../docs/rules/", import.meta.url);
    const problems = [
      ...ALL_RULES.flatMap((rule) => justifiedHyphensNoneProblems(rule.remediation?.advice ?? "", `${rule.id} remediation.advice`)),
      ...readdirSync(dir).filter((name) => name.endsWith(".md"))
        .flatMap((page) => justifiedHyphensNoneProblems(readFileSync(new URL(page, dir), "utf8"), `docs/rules/${page}`)),
    ];
    assert.deepEqual(problems, []);
    // Not vacuous: the pair's advice does name 'hyphens: none', word-local and non-justified.
    assert.match(RULES_BY_ID.get("layout/hyphen-across-page")?.remediation?.advice ?? "", /hyphens: none/u);
  });
});
