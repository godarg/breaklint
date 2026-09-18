import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";

import {
  CONFIG_CONTRACT_VERSION,
  OFF_BY_DEFAULT_RULE_IDS,
  canonicalJson,
  configPointer,
  configSchema,
  effectiveConfigFingerprint,
} from "../../src/config/contract.ts";
import { coverageFloorMap, resolveConfig, UsageError } from "../../src/config/resolve.ts";
import { runDocument } from "../../src/core/engine.ts";
import { ALL_RULES } from "../../src/rules/index.ts";
import { RULES_BY_ID } from "../../src/rules/index.ts";
import { loadCorpus } from "../fixtures/corpus.ts";

const resolve = (file: unknown = undefined, cli: Parameters<typeof resolveConfig>[0]["cli"] = {}) =>
  resolveConfig({ file, cli });

function leaves(value: unknown, segments: string[] = []): string[] {
  if (Array.isArray(value) || value === null || typeof value !== "object") {
    return [configPointer(...segments)];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => leaves(child, [...segments, key]));
}

describe("Configuration Contract v1", () => {
  it("rejects every unknown structural surface instead of ignoring it", () => {
    for (const [raw, message] of [
      [null, /config must be a JSON object/u],
      [[], /config must be a JSON object/u],
      [{ unknownTopLevel: true }, /unknown top-level field "unknownTopLevel"/u],
      [{ rules: { "layout/not-a-rule": false } }, /not a known rule/u],
      [{ rules: { "layout/widow": { bogusOption: 1 } } }, /unknown option "bogusOption"/u],
      [{ profile: "anything" }, /profile must be one of default, strict/u],
    ] as const) {
      assert.throws(() => resolve(raw), (error: unknown) => error instanceof UsageError && message.test(error.message));
    }
  });

  it("rejects wrong types, ranges, fake selectors and non-origin network values", () => {
    const cases: [unknown, Parameters<typeof resolveConfig>[0]["cli"], RegExp][] = [
      [{ locale: 123 }, {}, /locale must be a supported language tag/u],
      [{ locale: "not_a_locale" }, {}, /locale must be a supported language tag/u],
      [{ locale: "en-abc-abc" }, {}, /locale must be a supported language tag/u],
      [{ rules: { "layout/widow": 1 } }, {}, /must be true, false, or an options object/u],
      [{ rules: { "layout/widow": { extraLines: -1 } } }, {}, /finite number greater than or equal to 0/u],
      [{ rules: { "type/straight-quotes": { excludeTags: [".math"] } } }, {}, /HTML tag names, not CSS selectors/u],
      [{ rules: { "type/straight-quotes": { excludeSelectors: ["samp"] } } }, {}, /renamed to "excludeTags"/u],
      [{ coverageFloors: { "layout/widow": 1.1 } }, {}, /between 0 and 1/u],
      [undefined, { allowNetwork: ["https://example.com/path"] }, /exact http\(s\) origin/u],
    ];
    for (const [raw, cli, message] of cases) {
      assert.throws(() => resolve(raw, cli), (error: unknown) => error instanceof UsageError && message.test(error.message));
    }
  });

  it("keeps both proof-source-A thresholds invariant", () => {
    for (const rules of [
      { "layout/unbreakable-block-too-tall": { toleranceRatio: 2 } },
      { "svg/text-overflows-viewport": { maxOvershootPx: 1000 } },
    ]) {
      assert.throws(
        () => resolve({ rules }),
        (error: unknown) => error instanceof UsageError && /proof-source-A threshold/u.test(error.message),
      );
    }
  });

  it("makes default and strict real presets and respects defaults < profile < config < CLI", () => {
    const defaults = resolve();
    assert.equal(defaults.profile, "default");
    assert.equal(defaults.failOn, "error");
    assert.equal(defaults.coverageFloorsByRule["layout/widow"], 0.5);
    assert.equal(defaults.sources["/failOn"], "default");

    const strict = resolve({ profile: "strict", failOn: "never" }, { failOn: "warn" });
    assert.equal(strict.profile, "strict");
    assert.equal(strict.failOn, "warn");
    assert.ok(Object.values(strict.coverageFloorsByRule).every((floor) => floor === 1));
    assert.equal(strict.profileSource, "config");
    assert.equal(strict.sources["/failOn"], "cli");

    const cliProfile = resolve({ profile: "default" }, { profile: "strict" });
    assert.equal(cliProfile.profile, "strict");
    assert.equal(cliProfile.profileSource, "cli");
    assert.throws(
      () => resolve({ profile: "strict" }, { profile: "default" }),
      /cannot lower coverage established by config profile strict/u,
    );
  });

  /**
   * Registration is not activation.
   *
   * `layout/half-empty-page` stays registered, documented, configurable and measurable, and keeps
   * its public id — it is simply not part of what a default run reports, because it fired on 37 of
   * 40 documents of a corpus built to exercise it. The three re-entry paths below are the contract
   * this change has to keep: profile, config file, CLI. The oracle is not the resolver's own
   * notion of "enabled" but the rule list an engine would actually run (`activeRules`) and its
   * complement (`disabledRuleIds`), which is what a report prints.
   */
  it("keeps the one off-by-default rule off in the default profile and reachable by three paths", () => {
    const OFF = "layout/half-empty-page";

    const defaults = resolve();
    assert.equal(defaults.activeRules.some((rule) => rule.id === OFF), false, "default profile still runs it");
    assert.deepEqual(defaults.disabledRuleIds, [OFF], "exactly one rule is off by default");
    assert.equal(defaults.activeRules.length, ALL_RULES.length - 1);
    assert.equal(defaults.sources[configPointer("rules", OFF, "enabled")], "default");

    const strict = resolve({ profile: "strict" });
    assert.equal(strict.activeRules.some((rule) => rule.id === OFF), true, "strict must run every rule");
    assert.deepEqual(strict.disabledRuleIds, []);
    assert.equal(strict.sources[configPointer("rules", OFF, "enabled")], "profile");

    const byConfig = resolve({ rules: { [OFF]: true } });
    assert.equal(byConfig.activeRules.some((rule) => rule.id === OFF), true, "a config file must be able to ask for it");
    assert.equal(byConfig.sources[configPointer("rules", OFF, "enabled")], "config");

    const byCli = resolve(undefined, { only: [OFF] });
    assert.deepEqual(byCli.activeRules.map((rule) => rule.id), [OFF]);
    assert.equal(byCli.sources[configPointer("rules", OFF, "enabled")], "cli");

    // And the off switch still wins over the profile that turned it on.
    const strictButDisabled = resolve({ profile: "strict", rules: { [OFF]: false } });
    assert.equal(strictButDisabled.activeRules.some((rule) => rule.id === OFF), false);

    // Naming the rule with only OPTIONS turns it on too. `rules` reads as "the caller has an
    // opinion about this rule": false disables, anything else enables. For the twelve rules that
    // run anyway this is invisible; for the one that does not, tuning it also activates it. That
    // is the intended reading, and it is pinned here so it stays a decision rather than a surprise.
    const byOptionsOnly = resolve({ rules: { [OFF]: { minNetFill: 0.4 } } });
    assert.equal(byOptionsOnly.activeRules.some((rule) => rule.id === OFF), true, "an options object must not leave the rule off");
    assert.equal(byOptionsOnly.optionsByRule[OFF]!.minNetFill, 0.4);
    assert.equal(byOptionsOnly.sources[configPointer("rules", OFF, "enabled")], "config");
  });

  it("lets CLI rule selection override file enablement", () => {
    const config = resolve(
      { rules: { "layout/widow": false } },
      { only: ["layout/widow"] },
    );
    assert.deepEqual(config.activeRules.map((rule) => rule.id), ["layout/widow"]);
    assert.equal(config.sources["/rules/layout~1widow/enabled"], "cli");
  });

  it("applies stricter floors and refuses every lowering, including below a profile", () => {
    const raised = resolve({ coverageFloors: { "layout/widow": 1 } });
    assert.equal(coverageFloorMap(raised)["layout/widow"], 1);
    assert.equal(raised.effective.rules["layout/widow"]!.coverageFloor, 1);
    assert.equal(raised.sources["/rules/layout~1widow/coverageFloor"], "config");

    assert.throws(() => resolve({ coverageFloors: { "layout/widow": 0.4 } }), /permits stricter floors only/u);
    assert.throws(
      () => resolve({ profile: "strict", coverageFloors: { "layout/widow": 0.9 } }),
      /cannot lower the active strict floor/u,
    );
  });

  it("normalises set-like values before fingerprinting", () => {
    const a = resolve(
      { rules: { "type/straight-quotes": { excludeTags: ["SPAN", "em", "span"] } } },
      { allowNetwork: ["https://b.example", "https://a.example", "https://b.example"] },
    );
    const b = resolve(
      { rules: { "type/straight-quotes": { excludeTags: ["em", "span"] } } },
      { allowNetwork: ["https://a.example", "https://b.example"] },
    );
    assert.deepEqual(a.effective, b.effective);
    assert.equal(a.fingerprint, b.fingerprint);
    assert.match(a.fingerprint, /^[0-9a-f]{64}$/u);
  });

  it("canonicalises equivalent locale spellings before fingerprinting", () => {
    const lower = resolve({ locale: "de-de" });
    const canonical = resolve({ locale: "de-DE" });
    assert.equal(lower.locale, "de-DE");
    assert.equal(lower.fingerprint, canonical.fingerprint);
  });

  it("applies excludeTags to the rule candidate set instead of merely accepting the field", () => {
    const config = resolve({ rules: { "type/straight-quotes": { excludeTags: ["SPAN"] } } });
    const fixture = structuredClone(loadCorpus().find((entry) => entry.name === "straight-quotes-trigger")!);
    fixture.snapshot.textRuns[0]!.ancestorTags = ["span", "p", "body"];
    const rule = RULES_BY_ID.get("type/straight-quotes")!;
    const outcome = runDocument(
      { path: fixture.name, snapshot: fixture.snapshot, infrastructure: [] },
      {
        failOn: "never",
        activeRules: [rule],
        optionsByRule: config.optionsByRule,
        coverageFloors: config.coverageFloorsByRule,
      },
    );
    assert.equal(outcome.report.findings.length, 0);
    assert.equal(outcome.report.coverage["type/straight-quotes"]!.candidates, 0);
  });

  it("fingerprints effective semantics, not source-object key order or provenance", () => {
    const first = resolve({ failOn: "warn", rules: { "layout/widow": { extraLines: 2 } } });
    const reordered = resolve({ rules: { "layout/widow": { extraLines: 2 } }, failOn: "warn" });
    const cliEquivalent = resolve({ rules: { "layout/widow": { extraLines: 2 } } }, { failOn: "warn" });
    const changed = resolve({ failOn: "warn", rules: { "layout/widow": { extraLines: 3 } } });
    assert.equal(first.fingerprint, reordered.fingerprint);
    assert.equal(first.fingerprint, cliEquivalent.fingerprint);
    assert.notEqual(first.sources["/failOn"], cliEquivalent.sources["/failOn"]);
    assert.notEqual(first.fingerprint, changed.fingerprint);
    assert.equal(first.fingerprint, effectiveConfigFingerprint(first.effective));

    const strict = resolve({ profile: "strict" });
    const expanded = resolve({
      profile: "default",
      failOn: "warn",
      coverageFloors: Object.fromEntries(ALL_RULES.map((rule) => [rule.id, 1])),
      // Since 0.6.0 a profile also decides WHICH rules run, not only how loudly they report. The
      // hand-written equivalent of `strict` therefore has to ask for the one rule the default
      // profile leaves off; without this line the two configurations genuinely differ, and the
      // assertion below was right to say so.
      rules: Object.fromEntries([...OFF_BY_DEFAULT_RULE_IDS].map((id) => [id, true])),
    });
    assert.notEqual(strict.profile, expanded.profile);
    assert.deepEqual(strict.effective, expanded.effective);
    assert.equal(strict.fingerprint, expanded.fingerprint);
  });

  it("assigns exactly one valid origin to every effective leaf", () => {
    const config = resolve({ profile: "strict", rules: { "type/spaced-hyphen": { mathWindow: 8 } } }, { locale: "en-US" });
    const effectiveLeaves = leaves(config.effective).sort();
    const sourceLeaves = Object.keys(config.sources).sort();
    assert.deepEqual(sourceLeaves, effectiveLeaves);
    for (const source of Object.values(config.sources)) {
      assert.ok(["default", "profile", "config", "cli"].includes(source));
    }
  });

  it("derives the checked-in schema from the same registry", () => {
    assert.equal(CONFIG_CONTRACT_VERSION, 1);
    const expected = `${JSON.stringify(configSchema(), null, 2)}\n`;
    const checkedIn = readFileSync(new URL("../../breaklint.schema.json", import.meta.url), "utf8");
    assert.equal(checkedIn, expected);
    assert.equal(canonicalJson(configSchema()), canonicalJson(JSON.parse(checkedIn)));
    const properties = (configSchema().properties as Record<string, unknown>);
    assert.ok(properties.rules);
    const ruleSchemas = properties.rules as { properties: Record<string, { oneOf: { properties?: Record<string, unknown> }[] }> };
    assert.deepEqual(ruleSchemas.properties["layout/unbreakable-block-too-tall"]!.oneOf[1]!.properties, {});
    assert.deepEqual(ruleSchemas.properties["svg/text-overflows-viewport"]!.oneOf[1]!.properties, {});
    assert.ok(ruleSchemas.properties["type/straight-quotes"]!.oneOf[1]!.properties!.excludeTags);
    assert.equal(ruleSchemas.properties["type/straight-quotes"]!.oneOf[1]!.properties!.excludeSelectors, undefined);
    assert.equal(ALL_RULES.length, 13, "the independent rule-count literal changed; audit the schema surface");
    assert.equal(ruleSchemas.properties["svg/text-clipped"], undefined, "a research-only rule entered the public schema");
    assert.equal(ruleSchemas.properties["svg/text-ink-collision"], undefined, "a research-only rule entered the public schema");
  });

  it("agrees with an independent JSON Schema validator on a shared positive and negative corpus", () => {
    const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(configSchema());
    const corpus: { valid: boolean; value: unknown }[] = [
      { valid: true, value: {} },
      { valid: true, value: { profile: "strict", coverageFloors: { "layout/widow": 1 } } },
      { valid: true, value: { rules: { "type/straight-quotes": { excludeTags: ["span", "span"] } } } },
      {
        valid: true,
        value: { rules: { "type/straight-quotes": { maxOccurrences: 1, excludeTags: ["samp"] } } },
      },
      { valid: false, value: null },
      { valid: false, value: { locale: "en-abc-abc" } },
      { valid: false, value: { $schema: "./breaklint.schema.json" } },
      { valid: false, value: { profile: "strict", coverageFloors: { "layout/widow": 0.9 } } },
      { valid: false, value: { coverageFloors: { "layout/widow": 0.4 } } },
      { valid: false, value: { rules: { "layout/widow": { extraLines: -1 } } } },
      { valid: false, value: { rules: { "type/straight-quotes": { excludeSelectors: ["samp"] } } } },
      {
        valid: false,
        value: { rules: { "layout/unbreakable-block-too-tall": { toleranceRatio: 2 } } },
      },
    ];

    for (const testCase of corpus) {
      const schemaAccepted = validateSchema(testCase.value);
      let runtimeAccepted = true;
      try {
        resolve(testCase.value);
      } catch {
        runtimeAccepted = false;
      }
      assert.equal(schemaAccepted, testCase.valid, `schema disagreement for ${JSON.stringify(testCase.value)}`);
      assert.equal(runtimeAccepted, testCase.valid, `runtime disagreement for ${JSON.stringify(testCase.value)}`);
    }
  });
});
