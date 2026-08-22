#!/usr/bin/env node

/**
 * Consumer-side Configuration Contract v1 gate.
 *
 * Run this from a clean directory after installing the packed tarball. It deliberately imports
 * no breaklint source or test helper: the installed CLI, exported schema and public JSON report
 * are the only interfaces under test, and the fingerprint is reproduced independently here.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const consumerRoot = process.cwd();
const bin = resolve(process.argv[2] ?? join("node_modules", ".bin", "breaklint"));
const scratch = mkdtempSync(join(tmpdir(), "breaklint-installed-config-"));

function writeJson(name, value) {
  const path = join(scratch, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function run(args) {
  return spawnSync(bin, args, { cwd: consumerRoot, encoding: "utf8" });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function leaves(value, segments = []) {
  if (Array.isArray(value) || value === null || typeof value !== "object") {
    return [`/${segments.map((part) => part.replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`];
  }
  return Object.entries(value).flatMap(([key, child]) => leaves(child, [...segments, key]));
}

try {
  assert.equal(existsSync(bin), true, `installed CLI not found: ${bin}`);
  const consumerRequire = createRequire(pathToFileURL(join(consumerRoot, "package.json")));
  const installedManifest = JSON.parse(
    readFileSync(consumerRequire.resolve("breaklint/package.json"), "utf8"),
  );
  const schemaPath = consumerRequire.resolve("breaklint/config.schema.json");
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  assert.equal(schema.$id, "https://dargel-solutions.de/schemas/breaklint/config-v1.json");
  assert.equal(schema.additionalProperties, false);

  const valid = writeJson("valid.json", {
    profile: "strict",
    failOn: "never",
    locale: "de-de",
    rules: { "type/straight-quotes": { excludeTags: ["SPAN", "em", "span"] } },
  });
  const reportPath = join(scratch, "valid-report.json");
  const validRun = run(["--demo", "--config", valid, "--fail-on", "warn", "--format", "json", "--out", reportPath]);
  assert.equal(validRun.status, 4, `valid strict demo: ${validRun.stderr}`);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(report.schemaVersion, 3);
  assert.equal(report.tool.version, installedManifest.version);
  assert.equal(report.config.contractVersion, 1);
  assert.equal(report.config.profile, "strict");
  assert.equal(report.config.profileSource, "config");
  assert.equal(report.config.failOn, "warn");
  assert.equal(report.config.effective.locale, "de-DE");
  assert.deepEqual(report.config.effective.rules["type/straight-quotes"].options.excludeTags, ["em", "span"]);
  assert.ok(report.config.coverageFloors.every((floor) => floor.effective === 1));
  assert.deepEqual(Object.keys(report.config.sources).sort(), leaves(report.config.effective).sort());
  const fingerprint = createHash("sha256")
    .update(`breaklint-effective-config-v1\0${canonicalJson(report.config.effective)}`)
    .digest("hex");
  assert.equal(report.config.fingerprint, fingerprint);

  const invalidCases = [
    {
      name: "unknown",
      config: { unknownTopLevel: true },
      args: [],
      message: /unknown top-level field "unknownTopLevel"/u,
    },
    {
      name: "proof-a",
      config: { rules: { "layout/unbreakable-block-too-tall": { toleranceRatio: 2 } } },
      args: [],
      message: /proof-source-A threshold/u,
    },
    {
      name: "lowered-floor",
      config: { coverageFloors: { "layout/widow": 0.4 } },
      args: [],
      message: /cannot lower the active default floor/u,
    },
    {
      name: "profile-downgrade",
      config: { profile: "strict" },
      args: ["--profile", "default"],
      message: /cannot lower coverage established by config profile strict/u,
    },
  ];

  for (const testCase of invalidCases) {
    const config = writeJson(`${testCase.name}.json`, testCase.config);
    const output = join(scratch, `${testCase.name}-report.json`);
    const result = run([
      "--config",
      config,
      ...testCase.args,
      "--format",
      "json",
      "--out",
      output,
      "does-not-exist.html",
    ]);
    assert.equal(result.status, 2, `${testCase.name}: ${result.stderr}`);
    assert.match(result.stderr, testCase.message);
    assert.doesNotMatch(result.stderr, /input not found/u);
    assert.equal(existsSync(output), false, `${testCase.name} promoted a report`);
  }

  process.stdout.write(
    `installed Configuration Contract v1: report schema 3, exported schema, ` +
      `${leaves(report.config.effective).length} sourced leaves, independent fingerprint, ` +
      `${invalidCases.length} fail-closed controls\n`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
