import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";

import { ALL_RULES, VALIDATION_RULES_BY_ID } from "../../src/rules/index.ts";
import { IS, SEVERITIES } from "../../src/core/enums.ts";

/**
 * The declaration form, and the three prose forms that got past the narrow first version of this
 * guard (measured: it caught 2 of 5 plausible phrasings). It must NOT match the rules' own
 * threshold source (`block.effectiveStyle.widows`) or a sentence that warns AGAINST the property,
 * so it requires an imperative or an explicit value nearby.
 */
const INERT_PROPERTY_ADVICE =
  /\b(widows|orphans)\s*:\s*\d|\b(set|increase|raise|lower|use|apply|add|specify|configure)\b[^.]{0,60}\b(widows|orphans)\b|\b(widows|orphans)\b[^.]{0,40}\b(property|setting|value)\b[^.]{0,40}\b(to|of)\b\s*\S/iu;

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

  it("every released rule declares an actionable remediation without proposing inert widows/orphans CSS", () => {
    for (const rule of ALL_RULES) {
      assert.ok(rule.remediation && rule.remediation.advice.length > 20, `${rule.id}: missing remediation`);
      assert.equal(typeof rule.remediation!.tested, "boolean", `${rule.id}: remediation must state whether a proof pair backs it`);
      // Never recommend widows: N or orphans: N as a fix — Paged.js 0.4.3 does not implement them.
      assert.ok(
        !INERT_PROPERTY_ADVICE.test(rule.remediation!.advice),
        `${rule.id}: proposes inert widows/orphans CSS property in remediation`,
      );
    }
  });

  it("no rule documentation page proposes the inert widows/orphans CSS property either", () => {
    const dir = new URL("../../docs/rules/", import.meta.url);
    const pages = readdirSync(dir).filter((name) => name.endsWith(".md"));
    assert.ok(pages.length >= 13, `expected the rule pages to be present, found ${pages.length}`);
    for (const page of pages) {
      const text = readFileSync(new URL(page, dir), "utf8");
      for (const [index, line] of text.split("\n").entries()) {
        // A sentence that warns AGAINST the property is the point, not a violation.
        if (/\b(do not|does not|never|absent|not honour|not honor|ignored)\b/iu.test(line)) continue;
        assert.ok(
          !INERT_PROPERTY_ADVICE.test(line),
          `docs/rules/${page}:${index + 1} proposes the inert widows/orphans CSS property: ${line.trim()}`,
        );
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
  it("the agent-facing repair map proposes no inert widows/orphans CSS either", () => {
    const source = readFileSync(new URL("../../src/api/context.ts", import.meta.url), "utf8");
    assert.match(source, /function repairOptions\(/u, "repairOptions is gone — this guard has lost its subject");
    assert.match(source, /repair:\s*\{[^}]*options:\s*repairOptions\(/u, "repairOptions is no longer reached from the finding card");
    for (const [index, line] of source.split("\n").entries()) {
      const code = line.replace(/\/\*.*?\*\//gu, "");
      if (/^\s*(\*|\/\/)/u.test(code)) continue;
      assert.ok(
        !/\b(widows|orphans)\s*:\s*\d/iu.test(code) && !/\b(widows|orphans)\s+(setting|property|value|declaration)/iu.test(code),
        `src/api/context.ts:${index + 1} proposes an inert widows/orphans CSS property: ${line.trim()}`,
      );
    }
  });
});
