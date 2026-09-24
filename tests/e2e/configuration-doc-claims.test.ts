/**
 * The rule-enablement sentences of docs/configuration.md, through the command a user runs.
 *
 * The page said a rule value is "true, false, or an options object" and that the two profiles
 * differ in their gate and floors. Both were incomplete in the way that matters for the one rule
 * that is off by default: any value other than `false` enables a rule — an options object, even an
 * empty one, included — and `strict` also enables `layout/half-empty-page`. A reader tuning that
 * rule's option turns it on without asking to. These cases pin what the page now says, through
 * the real CLI in a child process and the canonical JSON it writes.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../../src/cli/index.ts", import.meta.url));
const OFF = "layout/half-empty-page";
const dir = mkdtempSync(join(tmpdir(), "breaklint-config-doc-"));
after(() => rmSync(dir, { recursive: true, force: true }));

function enabledUnder(config: unknown, name: string): { enabled: boolean; source: string; rulesRun: number } {
  const file = join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(config));
  const run = spawnSync(process.execPath, ["--experimental-strip-types", CLI, "--demo", "--format", "json", "--config", file], {
    encoding: "utf8", timeout: 60_000,
  });
  // strict requires full coverage of every rule, which the demo snapshot does not give: exit 4,
  // and the report is still written. Exit 2 writes none.
  assert.ok([0, 1, 4].includes(run.status ?? -1), `${name}: the demo ended ${run.status}: ${run.stderr}`);
  const report = JSON.parse(run.stdout) as {
    rulesRun: number;
    config: { effective: { rules: Record<string, { enabled: boolean }> }; sources: Record<string, string> };
  };
  return {
    enabled: report.config.effective.rules[OFF]!.enabled,
    source: report.config.sources[`/rules/${OFF.replace("/", "~1")}/enabled`]!,
    rulesRun: report.rulesRun,
  };
}

describe("docs/configuration.md: which values enable a rule", () => {
  it("the default profile leaves the off-by-default rule off", () => {
    const run = enabledUnder({}, "default");
    assert.equal(run.enabled, false);
    assert.equal(run.rulesRun, 12);
  });

  it("strict enables it, as the profile table says", () => {
    const run = enabledUnder({ profile: "strict" }, "strict");
    assert.equal(run.enabled, true);
    assert.equal(run.rulesRun, 13);
  });

  it("an options object enables it, and so does an empty one", () => {
    const withOption = enabledUnder({ rules: { [OFF]: { minNetFill: 0.4 } } }, "option");
    assert.deepEqual([withOption.enabled, withOption.source], [true, "config"]);
    const empty = enabledUnder({ rules: { [OFF]: {} } }, "empty");
    assert.deepEqual([empty.enabled, empty.source], [true, "config"]);
  });

  it("false still turns it off under strict", () => {
    const run = enabledUnder({ profile: "strict", rules: { [OFF]: false } }, "strict-false");
    assert.deepEqual([run.enabled, run.source], [false, "config"]);
  });
});
