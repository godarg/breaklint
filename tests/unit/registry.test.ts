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
  APPROVED_FRAGMENTATION_TEXTS, CLAIMS_DECIDED_BY_THE_PIN, leversApplied, SOFT_HYPHEN_BOUNDARY,
  WIDOWS_ORPHANS_SPLITS,
} from "../fixtures/fragmentation-levers.ts";
import {
  approvedKeys, codeSegments, fragmentationProblems, guardedUnits, isJudged, placeLabel, proseSentences,
  type GuardedUnit,
} from "../tools/fragmentation-guard.ts";
import { changedLevers, LEVERS, positiveLevers, proposedLevers } from "../tools/remediation-levers.ts";

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

  it("every guarded unit naming widows/orphans, and the complete widow/orphan advice, is approved by the pin", () => {
    assert.deepEqual(Object.keys(APPLIED).sort(), ["orphans", "widows"], "the guard must have a pin to follow");
    const units = guardedUnits(ALL_RULES, REPO_ROOT);
    const judged = units.filter(isJudged);
    assert.ok(judged.length >= 19, `the guard reads too few units to be guarding anything (${judged.length})`);
    for (const place of ["layout/widow summary", "layout/widow finding message", "layout/orphan finding message", "README.md", "docs/agent-contract.md", "src/api/context.ts"]) {
      assert.ok(judged.some((unit) => unit.place === place), `the guard no longer reads ${place}`);
    }
    assert.deepEqual(fragmentationProblems(units, APPLIED), []);
    // And the other way round: every text approved under this pin is still published, so the list
    // cannot silently keep approvals for text that no longer exists.
    const published = new Set(judged.map(({ place, text }) => `${place}\u0000${text}`));
    const stale = [...approvedKeys(APPLIED)].filter((key) => !published.has(key)).map((key) => key.replace("\u0000", ": "));
    assert.deepEqual(stale, [], "approved texts that are no longer published — remove or update them");
  });

  /**
   * The negative controls, kept in the suite. They are the phrasings two review rounds used to walk
   * around earlier versions of this guard, plus at least one more per check. Each is judged where
   * the real text is judged, among the real units.
   */
  it("refuses every phrasing that walked around earlier versions of the guard", () => {
    const real = guardedUnits(ALL_RULES, REPO_ROOT);
    const notApplied = { widows: false, orphans: false };
    const widowAdvice = placeLabel({ ruleId: "layout/widow" });
    const withUnit = (unit: GuardedUnit, replacing?: (other: GuardedUnit) => boolean) =>
      [...real.filter((other) => !(replacing?.(other) ?? false)), unit];
    const prose = (place: string, text: string): GuardedUnit => ({ place, text, kind: "prose" });
    const problemsWith = (units: readonly GuardedUnit[], applied = APPLIED, approved?: ReadonlySet<string>) =>
      fragmentationProblems(units, applied, approved).join("\n");

    // 1. Appended to the widow advice: the complete text is pinned, so ANY addition fails — including
    //    one that refers to the property without naming it.
    const advice = real.find((unit) => unit.place === widowAdvice && unit.kind === "prose")!;
    for (const sentence of [
      "Paged.js disregards 'widows' entirely.", "The 'widows' property has no influence under Paged.js.",
      "Paged.js does not support 'widows'.", "'widows' is unsupported by the paginator.", "Setting 'widows' does nothing here.",
      "Paged.js 0.4.3 has no widows implementation, so it is ineffective.", "Chromium overlooks 'orphans' in paginated output.",
      "Paged.js ignores it anyway.", "Both properties are inert under Paged.js.",
    ]) {
      const units = withUnit(prose(widowAdvice, `${advice.text} ${sentence}`), (other) => other === advice);
      assert.match(problemsWith(units), /is not the approved complete advice text/u, `accepted in the widow advice: ${sentence}`);
    }

    // 2. Lowering: refused in every pin state even when the unit is approved.
    for (const sentence of [
      "Or set 'widows: 1' on the paragraph.", "Lowering the paragraph's widows makes the finding disappear.",
      "Reduce the block's orphans to 1 so the split conforms.", "Set widows to 1 to silence it.", "Set `widows` to `1`.",
      "A widows value of 1 avoids this.", "Declare widows: 1", "Choose widows = 1", "A smaller widows value keeps the finding away.",
      "Lower widow-control to 1.", "Remove the widows declaration from the paragraph.", "Reset widows on the paragraph.",
    ]) {
      const unit = prose("docs/rules/layout-widow.md", sentence);
      const approvedAnyway = new Set([`${unit.place}\u0000${unit.text}`]);
      for (const applied of [APPLIED, notApplied]) {
        assert.match(problemsWith([unit], applied, approvedAnyway), /proposes lowering/u, `lowering accepted under ${JSON.stringify(applied)}: ${sentence}`);
      }
    }

    // 3. Setting or raising while the pin says not applied, even when approved.
    for (const sentence of ["Raising the paragraph's 'widows' to 3 keeps more lines together.", "Try widows 3.", "Increase 'orphans' on the block.", "Declare orphans: 4 on the paragraph."]) {
      const unit = prose("docs/rules/layout-widow.md", sentence);
      const approvedAnyway = new Set([`${unit.place}\u0000${unit.text}`]);
      assert.match(problemsWith([unit], notApplied, approvedAnyway), /proposes setting (widows|orphans), which the pinned measurement shows the browser NOT applying/u, `raising accepted: ${sentence}`);
    }

    // 4. Code: fences, HTML comments and inline style attributes are not approvable prose, but the
    //    lowering check always, and the setting check while not applied, run on them.
    const page = "docs/rules/layout-widow.md";
    const code = (markdown: string) => codeSegments(markdown).map((text): GuardedUnit => ({ place: page, text, kind: "code" }));
    for (const markdown of [
      "```css\np { widows: 1 }\n```",
      "```html\n<p style=\"orphans: 1\">text</p>\n```",
      "Remedied: <p style='widows:1'>short</p>.",
      "<!-- remedied by lowering widows to one -->",
      "```css\n.fix { orphans: initial; }\n```",
    ]) {
      const units = code(markdown);
      assert.ok(units.length > 0, `no code segment was read from: ${markdown}`);
      assert.match(problemsWith(units), /proposes lowering .*\(code\)/u, `code lowering accepted: ${markdown}`);
    }
    for (const markdown of ["```css\np { widows: 3 }\n```", "<p style=\"orphans: 4\">x</p>"]) {
      assert.match(problemsWith(code(markdown), notApplied), /proposes setting (widows|orphans).*\(code\)/u, `code setting accepted while not applied: ${markdown}`);
      assert.doesNotMatch(problemsWith(code(markdown)), /proposes/u, `a numeric value above 1 in code is not a lowering while applied: ${markdown}`);
    }

    // 5. A sentence added to a pinned paragraph fails although it names nothing; a paragraph that
    //    names the properties by a looser spelling is judged too.
    const note = real.find((unit) => unit.place === page && unit.text.startsWith("Chromium applies `widows`"))!;
    assert.match(problemsWith(withUnit(prose(page, `${note.text} Both properties are inert under Paged.js.`), (other) => other === note)),
      /names widows\/orphans in a unit that is not approved/u);
    assert.match(problemsWith(withUnit(prose(page, "Widow/orphan handling is ignored by Paged.js."))), /not approved/u);

    // 6. The newly guarded places: summary, finding message, README, docs/*.md.
    for (const [place, text] of [
      ["layout/widow summary", "The first fragment of a block on a page has fewer lines than its own widows value, which Paged.js ignores."],
      ["layout/orphan finding message", "N line(s) of this block remain at the foot of page N; its own orphans value is inert here."],
      ["README.md", "Paged.js makes widows and orphans inert, so breaklint only reports them."],
      ["docs/configuration.md", "The orphans property has no effect under Paged.js."],
    ] as const) {
      assert.match(problemsWith(withUnit(prose(place, text))), /not approved/u, `accepted at ${place}: ${text}`);
    }

    // 7. Derived from the pin: under a pin that says "not applied", every text asserting
    //    application — the 6+3 measured split included — loses its approval.
    const underInertPin = problemsWith(real, notApplied);
    const asserting = APPROVED_FRAGMENTATION_TEXTS.filter((item) => item.requires.length > 0);
    assert.ok(asserting.some((item) => item.text.includes("splits 6+3")), "the measured 6+3 relaxation must require the pin");
    for (const entry of asserting) {
      assert.ok(underInertPin.includes(entry.text), `still approved under a pin that says not applied: ${entry.text}`);
    }
  });

  it("every published sentence the pinned measurement decides is present, and agrees with the pin", () => {
    assert.ok(CLAIMS_DECIDED_BY_THE_PIN.length >= 6, "the pin names too few of the sentences it decides");
    const softHyphenMarked =
      SOFT_HYPHEN_BOUNDARY.shy.boundaryHyphen && !SOFT_HYPHEN_BOUNDARY.space.boundaryHyphen;
    const wordLocalLeversWork =
      !SOFT_HYPHEN_BOUNDARY["span-none"].boundaryHyphen && !SOFT_HYPHEN_BOUNDARY.nowrap.boundaryHyphen;
    const published = guardedUnits(ALL_RULES, REPO_ROOT);
    for (const claim of CLAIMS_DECIDED_BY_THE_PIN) {
      if ("ruleId" in claim.where) {
        const advice = RULES_BY_ID.get(claim.where.ruleId)?.remediation?.advice ?? "";
        assert.ok(advice.includes(claim.sentence), `${claim.where.ruleId} remediation.advice no longer says: ${claim.sentence}`);
      } else {
        // Judged on the same normalised units the guard reads (a wrapped blockquote paragraph is
        // one unit; a source file's comment markers are removed).
        const file = claim.where.file;
        assert.ok(published.some((unit) => unit.place === file && unit.text.includes(claim.sentence)), `${file} no longer says: ${claim.sentence}`);
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
    // Actionable levers only (LEVERS, shared with the Examples guard below). A property named as a
    // MEASUREMENT ("a page of prose at line-height: 1.5 reaches ...") is not a proposal, so the
    // guard also requires an imperative nearby.
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
   * The Remediation section is not the only place a page proposes a cure. Its Examples section
   * shows a trigger and a "remedied" document, and the difference between the two IS a repair
   * recommendation — read by people and copied by agents. Until 0.7.0 that section was unguarded,
   * and two pages used it to propose a lever their rule does not: `font-size` for
   * `layout/orphaned-continuation-page`, and `break-inside: auto` for
   * `layout/unbreakable-block-too-tall`, whose advice names removing `break-inside: avoid` only to
   * warn that it clears the finding without shortening the block.
   *
   * The comparison is against the levers the advice PROPOSES (`positiveLevers`, derived from the
   * advice text at run time), not merely names: that is the polarity a substring check misses.
   */
  it("every rule page's remedied example changes only levers its rule's advice proposes", () => {
    const dir = new URL("../../docs/rules/", import.meta.url);
    // A page another change is still correcting, with the EXACT foreign levers it is known to
    // carry. Anything added to that example fails like on any other page, and once the page is
    // corrected this test fails until the entry is deleted, so the list can only shrink. Empty.
    const PENDING: Record<string, { foreign: string[]; reason: string }> = {};
    let compared = 0;
    for (const rule of ALL_RULES) {
      const page = pageNameFor(rule);
      const text = readFileSync(new URL(page, dir), "utf8");
      const block = (heading: string): string | null => {
        const at = text.indexOf(`\n### ${heading}\n`);
        if (at === -1) return null;
        const open = text.indexOf("\n```", at);
        const close = text.indexOf("\n```", open + 4);
        return open === -1 || close === -1 ? null : text.slice(open, close);
      };
      const trigger = block("Firing case (trigger)");
      const remedied = block("Non-firing case (remedied)");
      if (trigger === null || remedied === null) continue;
      compared += 1;
      const positive = positiveLevers(rule.remediation!.advice);
      const foreign = changedLevers(trigger, remedied).filter((lever) => !positive.has(lever));
      const pending = PENDING[rule.id];
      if (pending) {
        assert.notDeepEqual(foreign, [], `docs/rules/${page} no longer needs its pending entry (${pending.reason}); delete it`);
        assert.deepEqual(foreign, pending.foreign, `docs/rules/${page}: the remedied example changes ${foreign.join(", ")}; its pending entry covers only ${pending.foreign.join(", ")}`);
        continue;
      }
      assert.deepEqual(
        foreign,
        [],
        `docs/rules/${page}: the remedied example changes ${foreign.join(", ")}, which ${rule.id}'s advice does not propose (it proposes: ${[...positive].join(", ") || "no CSS lever"})`,
      );
    }
    assert.ok(compared >= 10, `only ${compared} rule pages carry a trigger/remedied pair; the guard has lost its subject`);
    assert.ok(LEVERS.length > 10);
  });

  /*
   * The repair map in src/api/context.ts is a third restatement of the advice, and the one an
   * agent receives in context.json and on the HTML bundle's cards. Its entry for
   * `layout/unbreakable-block-too-tall` said "adjust the verified block's break constraint" —
   * the lever the advice warns is a false repair. Each entry may propose only levers its rule's
   * advice proposes; a clause that warns ("do not …") is not a proposal.
   */
  it("the agent-facing repair map proposes only levers its rule's advice proposes", () => {
    const source = readFileSync(new URL("../../src/api/context.ts", import.meta.url), "utf8");
    const start = source.indexOf("function repairOptions(");
    const end = source.indexOf("return options[", start);
    assert.ok(start !== -1 && end > start, "repairOptions is gone — this guard has lost its subject");
    const entries = [...source.slice(start, end).matchAll(/"([a-z]+\/[a-z0-9-]+)":\s*"((?:[^"\\]|\\.)*)"/gu)];
    const released = entries.filter(([, id]) => ALL_RULES.some((rule) => rule.id === id));
    assert.ok(released.length >= 4, `only ${released.length} released-rule entries were read from repairOptions`);
    for (const [, id, option] of released) {
      const positive = positiveLevers(ALL_RULES.find((rule) => rule.id === id)!.remediation!.advice);
      // A repair option is an instruction throughout: every clause that does not warn proposes.
      const foreign = proposedLevers(option!, { requireImperative: false }).filter((lever) => !positive.has(lever));
      assert.deepEqual(foreign, [], `src/api/context.ts repair option for ${id} proposes ${foreign.join(", ")}, which its advice does not: ${option}`);
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
      guardedUnits(ALL_RULES, REPO_ROOT).some((unit) => unit.place === "src/api/context.ts" && isJudged(unit)),
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
