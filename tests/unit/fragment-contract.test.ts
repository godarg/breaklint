/**
 * The fragment contract: a rule whose quantity belongs to the whole element must not change its
 * answer when the paginator splits that element, and must notice when it is shown only the first
 * piece.
 *
 * Until 0.6.0 `layout/unbreakable-block-too-tall` judged every block on its first fragment, and a
 * block five and a half pages tall came back clean. 0.6.0 summed the fragments — but only from the
 * third on, so a block split into exactly two pieces, the usual outcome for one between one and two
 * pages tall, still came back clean. Neither shape was visible to any gate: every rule in the
 * registry decides per record, and nothing said which rules are allowed to. `RuleMeta.quantityScope`
 * says it now, the compiler requires it, and this test holds every `element` rule to it by
 * splitting each corpus target the rule measured over two and over three pages.
 *
 * "Must not change its answer" has one exception, and it only ever costs the run: a split may turn
 * a clean element into a declined one (exit 4 on a proof-source-A rule), because a split block
 * that fits has nothing in the snapshot that proves it fits. It may never add or lose a finding.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

import { OUTPUT_FORMATS } from "../../src/core/enums.ts";
import { buildReport } from "../../src/core/build-report.ts";
import { runDocument } from "../../src/core/engine.ts";
import { fingerprint } from "../../src/core/fingerprint.ts";
import { QUANTITY_SCOPES, defineRule, type Rule, type RuleMeta } from "../../src/core/rule.ts";
import type { Snapshot } from "../../src/core/types.ts";
import { resolveConfig, toReportConfig } from "../../src/config/resolve.ts";
import { render } from "../../src/report/index.ts";
import { ALL_RULES, RESEARCH_RULES } from "../../src/rules/index.ts";
import { unbreakableBlockTooTall } from "../../src/rules/layout/unbreakable-block-too-tall.ts";
import { loadCorpus, type CorpusEntry } from "../fixtures/corpus.ts";
import { firstFragmentOnly, splitSnapshot } from "../fixtures/fragments.ts";

const SPLITS = [2, 3] as const;

/** What a consumer can see of one rule on one document: its findings' identities and the verdict. */
function observe(rule: Rule, name: string, snapshot: Snapshot): string {
  const report = runDocument(
    { path: name, snapshot, infrastructure: [] },
    { failOn: "warn", activeRules: [rule], optionsByRule: {}, coverageFloors: {} },
  ).report;
  const findings = report.findings.map((finding) => `${finding.ruleId}|${finding.fingerprint}|${finding.severity}`).sort();
  return `${report.verdict} [${findings.join(", ")}]`;
}

/** The unsplit blocks a rule actually measured on a fixture: the targets a split can move. */
function measuredBlocks(rule: Rule, snapshot: Snapshot): string[] {
  const result = rule.run(snapshot, { documentPath: "fixture.html", options: rule.defaultOptions, fingerprint });
  const keys = new Set((result.evaluations ?? [])
    .filter((row) => row.status === "measured" && row.targetRef.keyType === "block")
    .map((row) => row.targetRef.nodeKey));
  return snapshot.blocks
    .filter((block) => keys.has(block.nodeKey) && block.fragmentCount === 1)
    .map((block) => block.nodeKey);
}

const onlyFirstFragment = (rule: Rule): Rule => ({ ...rule, run: (s, c) => rule.run(firstFragmentOnly(s), c) });

/**
 * Every way the given element-scope rules break the contract on the corpus, as sentences that name
 * the rule. Empty means the contract holds.
 */
function fragmentContractFailures(rules: readonly Rule[], corpus: readonly CorpusEntry[]): string[] {
  const failures: string[] = [];
  for (const rule of rules) {
    let splitCases = 0;
    let sensitive = false;
    for (const fixture of corpus.filter((entry) => entry.about === rule.id)) {
      const unsplit = observe(rule, fixture.name, fixture.snapshot);
      for (const nodeKey of measuredBlocks(rule, fixture.snapshot)) {
        for (const k of SPLITS) {
          const split = splitSnapshot(fixture.snapshot, nodeKey, k);
          splitCases += 1;
          const seen = observe(rule, fixture.name, split);
          // The one change a split may make: a clean element becomes a DECLARED decline. A block
          // that fits cannot be shown to fit once split (the rule's inconclusive band), so the run
          // then says it could not judge it and fails on coverage. A split may never add a finding,
          // lose one, or turn a decline into a clean result.
          const declaredDecline = unsplit === "clean []" && seen === "insufficient-coverage []";
          if (seen !== unsplit && !declaredDecline) {
            failures.push(`${rule.id}: ${fixture.name} split into ${k} fragments at ${nodeKey} gives ${seen}; unsplit it gives ${unsplit}`);
          }
          if (observe(onlyFirstFragment(rule), fixture.name, split) !== seen) sensitive = true;
        }
      }
    }
    if (splitCases === 0) {
      failures.push(`${rule.id}: no corpus fixture about this rule has a measured, unsplit block with text lines to split — the contract cannot be checked`);
    } else if (!sensitive) {
      failures.push(
        `${rule.id}: reading only the first fragment changes nothing on any of its ${splitCases} split fixtures — ` +
          `either the rule never looks past the first piece, or no fixture can show that it does`,
      );
    }
  }
  return failures;
}

describe("the fragment contract", () => {
  const corpus = loadCorpus();

  it("every rule declares what its quantity belongs to, and an undeclared or unknown scope is refused", () => {
    for (const rule of [...ALL_RULES, ...RESEARCH_RULES]) {
      assert.ok((QUANTITY_SCOPES as readonly string[]).includes(rule.quantityScope), `${rule.id}: ${String(rule.quantityScope)}`);
    }
    // Today exactly one rule measures a property of the whole element. A second one is enrolled in
    // this contract by declaring it, and the test below then has to find fixtures for it.
    assert.deepEqual(ALL_RULES.filter((rule) => rule.quantityScope === "element").map((rule) => rule.id), [
      "layout/unbreakable-block-too-tall",
    ]);

    const meta = {
      id: "layout/scope-test", severity: "warn", proofSource: null, calibrated: false, experimental: false,
      unit: "px", defaultOptions: {}, summary: "Test-only scope guard.", declines: [],
    } as const;
    const run = () => ({ findings: [], candidates: 0, measured: 0, notMeasured: [], evaluations: [] });
    // @ts-expect-error — a rule that does not say what its quantity belongs to must not compile.
    const undeclared: RuleMeta = meta;
    assert.throws(() => defineRule(undeclared, run), /quantityScope undefined is not one of/u);
    assert.throws(() => defineRule({ ...meta, quantityScope: "whole" } as unknown as RuleMeta, run), /quantityScope "whole" is not one of/u);
    assert.equal(defineRule({ ...meta, quantityScope: "element" }, run).quantityScope, "element");
  });

  it("a split changes nothing an element-scope rule says, and reading only the first fragment is noticed", () => {
    const rules = [...ALL_RULES, ...RESEARCH_RULES].filter((rule) => rule.quantityScope === "element");
    assert.deepEqual(fragmentContractFailures(rules, corpus), []);
  });

  /**
   * The contract has to be able to fail. A throwaway rule that is the real one shown only the first
   * fragment of every element — the 0.5.0 shape — must be named by it, twice: once because a split
   * trigger stops firing, and once because the first-fragment-only mutant of it changes nothing.
   */
  it("names a rule that reads only the first fragment", () => {
    const throwaway = onlyFirstFragment(unbreakableBlockTooTall);
    const failures = fragmentContractFailures([throwaway], corpus);
    assert.ok(
      failures.some((line) => /^layout\/unbreakable-block-too-tall: too-tall-trigger split into 2 fragments at t1 gives clean/u.test(line)),
      `the split trigger was not reported: ${JSON.stringify(failures)}`,
    );
    assert.ok(
      failures.some((line) => /reading only the first fragment changes nothing on any of its \d+ split fixtures/u.test(line)),
      `the insensitive rule was not reported: ${JSON.stringify(failures)}`,
    );
  });

  it("keeps quantityScope out of every report format", () => {
    const parsed = JSON.parse(readFileSync(new URL("../../examples/demo-snapshot.json", import.meta.url), "utf8")) as { snapshot: Snapshot };
    const outcome = runDocument(
      { path: "examples/demo.html", snapshot: parsed.snapshot, infrastructure: [] },
      { failOn: "error", activeRules: [...ALL_RULES], optionsByRule: {}, coverageFloors: {} },
    );
    assert.ok(outcome.report.findings.some((finding) => finding.ruleId === "layout/unbreakable-block-too-tall"), "premise: the element-scope rule reports on the demo");
    const report = buildReport({
      outcomes: [outcome], mode: "demo", source: "handwritten snapshot fixture", toolVersion: "0.0.0", commit: null,
      startedAt: new Date(0).toISOString(), durationMs: 0, rulesRun: ALL_RULES.length, failOn: "error",
      environment: {
        browserVersion: "", platform: "test", rendererPath: null, rendererPresent: false, pagedjsVersion: "0.4.3",
        rasterizer: null, rasterizerVersion: null, textPositionExtractor: null, fontFamiliesResolved: [], locale: "de-DE",
      },
      config: toReportConfig(resolveConfig({ file: undefined, cli: {} }), { interventions: [], networkBlocked: 0 }),
    });
    for (const format of OUTPUT_FORMATS) {
      assert.doesNotMatch(render(report, format), /quantityScope/u, `${format} carries the internal quantityScope`);
    }
  });
});
