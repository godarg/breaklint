import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveConfig, toReportConfig } from "../../src/config/resolve.ts";
import { buildReport } from "../../src/core/build-report.ts";
import { runDocument } from "../../src/core/engine.ts";
import { RULES_BY_ID } from "../../src/rules/index.ts";
import type { Report } from "../../src/core/types.ts";
import { loadCorpus } from "../fixtures/corpus.ts";

const CLI = fileURLToPath(new URL("../../src/cli/index.ts", import.meta.url));
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "breaklint-config-contract-"));
  tempDirs.push(dir);
  return dir;
}

function runCli(cwd: string, args: readonly string[]) {
  return spawnSync(process.execPath, ["--experimental-strip-types", CLI, ...args], {
    cwd,
    encoding: "utf8",
  });
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function independentFingerprint(effective: unknown): string {
  return createHash("sha256")
    .update(`breaklint-effective-config-v1\0${canonicalJson(effective)}`)
    .digest("hex");
}

describe("Configuration Contract v1 at the CLI and engine boundary", () => {
  it("rejects invalid config before looking at a missing input and never creates a report", () => {
    const cases: { value: unknown; field: RegExp }[] = [
      { value: null, field: /config must be a JSON object/u },
      { value: { unknownTopLevel: true }, field: /unknown top-level field "unknownTopLevel"/u },
      {
        value: { rules: { "layout/unbreakable-block-too-tall": { toleranceRatio: 2 } } },
        field: /proof-source-A threshold/u,
      },
      { value: { coverageFloors: { "layout/widow": 0.4 } }, field: /coverageFloors\."layout\/widow"/u },
      {
        value: { rules: { "type/straight-quotes": { excludeSelectors: ["samp"] } } },
        field: /"excludeSelectors" was renamed to "excludeTags"/u,
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const dir = tempDir();
      const config = join(dir, `invalid-${index}.json`);
      const report = join(dir, `report-${index}.json`);
      writeJson(config, testCase.value);
      const run = runCli(dir, ["--config", config, "--format", "json", "--out", report, "does-not-exist.html"]);
      assert.equal(run.status, 2, `stderr: ${run.stderr}`);
      assert.match(run.stderr, testCase.field);
      assert.doesNotMatch(run.stderr, /input not found/u, "config must be validated before the input path");
      assert.equal(existsSync(report), false, "an invalid invocation must not leave a report artifact");
    }
  });

  it("rejects an empty CLI rule list instead of treating it as no override", () => {
    const dir = tempDir();
    const report = join(dir, "report.json");
    const run = runCli(dir, ["--demo", "--only", ",,", "--format", "json", "--out", report]);
    assert.equal(run.status, 2);
    assert.match(run.stderr, /--only needs at least one rule id/u);
    assert.equal(existsSync(report), false);
  });

  it("rejects both research-only ink definitions as unknown public rules", () => {
    for (const ruleId of ["svg/text-clipped", "svg/text-ink-collision"]) {
      const dir = tempDir();
      const report = join(dir, "report.json");
      const run = runCli(dir, ["--demo", "--only", ruleId, "--format", "json", "--out", report]);
      assert.equal(run.status, 2, `${ruleId}: ${run.stderr}`);
      assert.match(run.stderr, new RegExp(`--only ${ruleId.replace("/", "\\/")}: no such rule`, "u"));
      assert.equal(existsSync(report), false);
    }
  });

  it("rejects a CLI profile that would weaken strict coverage from the config file", () => {
    const dir = tempDir();
    const config = join(dir, "strict.json");
    const report = join(dir, "report.json");
    writeJson(config, { profile: "strict" });
    const run = runCli(dir, [
      "--config",
      config,
      "--profile",
      "default",
      "--format",
      "json",
      "--out",
      report,
      "does-not-exist.html",
    ]);
    assert.equal(run.status, 2);
    assert.match(run.stderr, /cannot lower coverage established by config profile strict/u);
    assert.doesNotMatch(run.stderr, /input not found/u);
    assert.equal(existsSync(report), false);
  });

  it("writes the complete effective strict config, leaf origins and an independently reproducible fingerprint", () => {
    const dir = tempDir();
    const config = join(dir, "strict.json");
    const reportPath = join(dir, "report.json");
    writeJson(config, {
      profile: "strict",
      failOn: "never",
      locale: "de-de",
      rules: { "type/straight-quotes": { excludeTags: ["SPAN", "em", "span"] } },
    });

    const run = runCli(dir, ["--demo", "--config", config, "--fail-on", "warn", "--format", "json", "--out", reportPath]);
    assert.ok([1, 4].includes(run.status ?? -1), `expected a measured demo verdict, got ${run.status}; ${run.stderr}`);
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as Report;
    assert.equal(report.schemaVersion, 4);
    assert.equal(report.config.contractVersion, 1);
    assert.equal(report.config.profile, "strict");
    assert.equal(report.config.failOn, "warn");
    assert.equal(report.config.effective.locale, "de-DE");
    assert.deepEqual(report.config.effective.rules["type/straight-quotes"]!.options.excludeTags, ["em", "span"]);
    assert.ok(report.config.coverageFloors.every((floor) => floor.effective === 1));
    assert.equal(report.config.profileSource, "config");
    assert.equal(report.config.sources["/failOn"], "cli");
    assert.equal(report.config.sources["/rules/type~1straight-quotes/options/excludeTags"], "config");
    assert.equal(report.config.fingerprint, independentFingerprint(report.config.effective));
    assert.match(report.config.fingerprint, /^[0-9a-f]{64}$/u);
  });

  it("passes a raised floor through resolution, engine verdict and report without divergence", () => {
    const entry = loadCorpus().find((candidate) => candidate.name === "widow-partial-coverage");
    const rule = RULES_BY_ID.get("layout/widow");
    assert.ok(entry);
    assert.ok(rule);

    const resolved = resolveConfig({
      file: { coverageFloors: { "layout/widow": 1 } },
      cli: { only: ["layout/widow"], failOn: "error" },
    });
    const outcome = runDocument(
      { path: entry.name, snapshot: entry.snapshot, infrastructure: [] },
      {
        failOn: resolved.failOn,
        activeRules: [rule],
        optionsByRule: resolved.optionsByRule,
        coverageFloors: resolved.coverageFloorsByRule,
      },
    );
    const report = buildReport({
      outcomes: [outcome],
      mode: "demo",
      source: "handwritten snapshot fixture",
      toolVersion: "0.2.0",
      commit: null,
      startedAt: new Date(0).toISOString(),
      durationMs: 0,
      rulesRun: 1,
      failOn: resolved.failOn,
      environment: {
        browserVersion: "",
        platform: "test",
        rendererPath: null,
        rendererPresent: false,
        pagedjsVersion: "0.4.3",
        rasterizer: null,
        rasterizerVersion: null,
        textPositionExtractor: null,
        fontFamiliesResolved: [],
        locale: resolved.locale,
      },
      config: toReportConfig(resolved, { interventions: [], networkBlocked: 0 }),
    });

    assert.equal(outcome.report.verdict, "insufficient-coverage");
    assert.equal(report.exitCode, 4);
    assert.equal(report.runVerdict, "insufficient-coverage");
    assert.equal(report.documents[0]!.coverage["layout/widow"]!.coverage, 0.5);
    assert.equal(report.documents[0]!.coverage["layout/widow"]!.floor, 1);
    assert.deepEqual(
      report.config.coverageFloors.find((floor) => floor.ruleId === "layout/widow"),
      { ruleId: "layout/widow", default: 0.5, effective: 1, source: "config" },
    );
  });
});
