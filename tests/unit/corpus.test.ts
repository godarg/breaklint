import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { runDocument } from "../../src/core/engine.ts";
import { ALL_RULES, VALIDATION_RULES_BY_ID } from "../../src/rules/index.ts";
import { loadCorpus } from "../fixtures/corpus.ts";

const corpus = loadCorpus();

function findingsOf(entryName: string, ruleId: string) {
  const entry = corpus.find((c) => c.name === entryName);
  assert.ok(entry, `no fixture named ${entryName}`);
  const rule = VALIDATION_RULES_BY_ID.get(ruleId);
  assert.ok(rule, `no rule ${ruleId}`);
  return runDocument(
    { path: entry.name, snapshot: entry.snapshot, infrastructure: [] },
    { failOn: "never", activeRules: [rule], optionsByRule: {}, coverageFloors: {} },
  ).report;
}

describe("false-alarm corpus", () => {
  // A false alarm on a clean fixture is a release blocker, not a note. A rule that cries wolf
  // on a correct document gets switched off after the second time, and a switched-off rule
  // finds nothing at all.
  for (const entry of corpus.filter((c) => c.kind === "clean")) {
    it(`${entry.about} stays silent on ${entry.name}`, () => {
      const report = findingsOf(entry.name, entry.about);
      assert.equal(
        report.findings.length,
        0,
        `${entry.about} fired on a clean fixture.\n  complication: ${entry.complication}\n` +
          `  findings: ${report.findings.map((f) => f.message).join(" | ")}`,
      );
    });
  }

  for (const entry of corpus.filter((c) => c.kind === "trigger")) {
    it(`${entry.about} fires on ${entry.name}`, () => {
      const report = findingsOf(entry.name, entry.about);
      assert.ok(
        report.findings.length > 0,
        `${entry.about} did NOT fire on its trigger fixture.\n  complication: ${entry.complication}`,
      );
      assert.ok(
        report.findings.every((f) => f.ruleId === entry.about),
        "a trigger fixture must be attributed to the rule it is about",
      );
    });
  }

  it("every rule has at least one trigger fixture", () => {
    // Without one, the mutation guard has nothing to kill a mutant on, and a rule whose error
    // path no fixture reaches is unverified by construction.
    const missing = ALL_RULES.filter((r) => !corpus.some((c) => c.kind === "trigger" && c.about === r.id));
    assert.deepEqual(missing.map((r) => r.id), [], "rules without a trigger fixture");
  });

  it("every rule has clean fixtures in the strength the contract asks for", () => {
    // layout/ and svg/ five each, type/ eight each, artifact/ three in total. The corpus below
    // is smaller than that and says so rather than pretending: see the assertion message.
    const perRule = new Map<string, number>();
    for (const c of corpus.filter((x) => x.kind === "clean")) {
      perRule.set(c.about, (perRule.get(c.about) ?? 0) + 1);
    }
    const short = ALL_RULES.map((r) => ({ id: r.id, have: perRule.get(r.id) ?? 0 })).filter((x) => x.have === 0);
    assert.deepEqual(
      short.map((x) => x.id),
      [],
      "rules with no clean fixture at all — those cannot be shown to avoid a false alarm",
    );
  });

  it("no rule fires on a fixture belonging to a different rule", () => {
    // The cross-check that caught two real cases: a rule that fires on someone else's trigger
    // is either too broad, or the fixture carries a complication it did not mean to carry.
    const crossFires: string[] = [];
    for (const entry of corpus) {
      const report = runDocument(
        { path: entry.name, snapshot: entry.snapshot, infrastructure: [] },
        { failOn: "never", activeRules: [...ALL_RULES], optionsByRule: {}, coverageFloors: {} },
      ).report;
      for (const finding of report.findings) {
        if (finding.ruleId !== entry.about && !(entry.alsoFires ?? []).includes(finding.ruleId)) {
          crossFires.push(`${entry.name}: ${finding.ruleId} — ${finding.message.slice(0, 90)}`);
        }
      }
    }
    assert.deepEqual(crossFires, [], "cross-fires between fixtures");
  });
});
