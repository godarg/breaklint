/**
 * The release workflow's recovery logic, run through the real module and the real script.
 *
 * 0.11.0 shows the shape this guards: a tag on GitHub, nothing on npm, and a rerun that the
 * workflow itself made impossible the moment main moved, because it demanded that the tag commit
 * BE origin/main and treated any existing GitHub Release as an error. These tests read the real
 * CHANGELOG and run tests/tools/release-recovery.mjs, its self-test included.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { changelogSection, classifyLookup, decideRegistry, planGithubRelease } from "../tools/release-recovery.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CHANGELOG = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
const ASSETS = { "breaklint-1.2.3.tgz": "a".repeat(64), "breaklint-1.2.3.tgz.sha256": "b".repeat(64), "breaklint-1.2.3.tgz.sri": "c".repeat(64) };

describe("release recovery", () => {
  it("its self-test passes, negative controls included, through the real script", () => {
    const run = spawnSync(process.execPath, ["tests/tools/release-recovery.mjs", "--self-test"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
    assert.match(run.stdout, /release recovery self-test: \d+ checks passed, \d+ negative controls rejected/u);
  });

  it("release notes are the tag commit's own CHANGELOG section: non-empty, the right version, nothing else", () => {
    // 0.10.0 is the last release whose own section carries its notes; since 0.11.1 the 0.11.0
    // section is one line pointing to 0.11.1, which lists that tag's changes against 0.10.0.
    const notes = changelogSection(CHANGELOG, "0.10.0");
    assert.ok(notes.trim().length > 200, "the 0.10.0 section is empty");
    assert.match(changelogSection(CHANGELOG, "0.11.0"), /listed under 0\.11\.1/u, "the 0.11.0 section no longer points to 0.11.1");
    assert.doesNotMatch(notes, /^## /mu, "the notes run into another version's section");
    assert.ok(CHANGELOG.includes(notes.trim()), "the notes are not the CHANGELOG's own text");
    assert.throws(() => changelogSection(CHANGELOG, "0.0.99"), /has no "## 0\.0\.99 — YYYY-MM-DD" section/u);
    assert.throws(() => changelogSection("## 1.2.3 — TBD-at-tag\n\nx\n", "1.2.3"), /still dated TBD-at-tag/u);
    assert.throws(() => changelogSection("## 1.2.3 — 2026-01-01\n\n## 1.2.2 — 2025-12-01\n\nx\n", "1.2.3"), /section is empty/u);
    assert.throws(() => changelogSection("## 1.2.30 — 2026-01-01\n\nx\n", "1.2.3"), /has no "## 1\.2\.3/u);
  });

  it("a GitHub Release is created, completed from a draft, or verified byte for byte, and never overwritten", () => {
    const names = Object.keys(ASSETS);
    assert.deepEqual(planGithubRelease({ tag: "v1.2.3", release: null, local: ASSETS }), { action: "create", upload: names });
    const draft = { tagName: "v1.2.3", isDraft: true, assets: { [names[0]!]: ASSETS[names[0] as keyof typeof ASSETS] } };
    assert.deepEqual(planGithubRelease({ tag: "v1.2.3", release: draft, local: ASSETS }), { action: "complete-draft", upload: names.slice(1) });
    const full = { tagName: "v1.2.3", isDraft: false, assets: { ...ASSETS } };
    assert.deepEqual(planGithubRelease({ tag: "v1.2.3", release: full, local: ASSETS }), { action: "verified", upload: [] });
    assert.throws(() => planGithubRelease({ tag: "v1.2.3", release: { ...full, assets: { ...ASSETS, [names[0]!]: "d".repeat(64) } }, local: ASSETS }), /differs from the validated artifact/u);
    assert.throws(() => planGithubRelease({ tag: "v1.2.3", release: { ...draft, assets: { [names[0]!]: "d".repeat(64) } }, local: ASSETS }), /differs from the validated artifact/u);
    assert.throws(() => planGithubRelease({ tag: "v1.2.3", release: { ...full, assets: { [names[0]!]: ASSETS[names[0] as keyof typeof ASSETS] } }, local: ASSETS }), /published release .* lacks/u);
    assert.throws(() => planGithubRelease({ tag: "v1.2.3", release: { ...full, assets: { ...ASSETS, "extra.txt": "e".repeat(64) } }, local: ASSETS }), /carries an asset this workflow did not validate/u);
    assert.throws(() => planGithubRelease({ tag: "v1.2.3", release: { ...full, tagName: "v1.2.4" }, local: ASSETS }), /belongs to tag v1\.2\.4/u);
  });

  it("the registry decision publishes only on an absent version and retries the provenance lookup in a bounded window", async () => {
    assert.equal(classifyLookup({ status: 1, stdout: "", stderr: "npm error code E404\nnpm error 404 Not Found" }, "1.2.3").state, "absent");
    assert.equal(classifyLookup({ status: 1, stdout: "", stderr: "npm error code ETIMEDOUT" }, "1.2.3").state, "error");
    assert.equal(classifyLookup({ status: 0, stdout: '{"version":"1.2.3"}', stderr: "" }, "1.2.3").state, "present");
    assert.equal(classifyLookup({ status: 0, stdout: '{"version":"1.2.2"}', stderr: "" }, "1.2.3").state, "error");
    assert.equal(classifyLookup({ status: 0, stdout: "not json", stderr: "" }, "1.2.3").state, "error");
    const sleep = async () => {};
    assert.deepEqual(await decideRegistry({ lookup: async () => ({ state: "absent" }), verify: async () => true, attempts: 3, sleep }), { publishNeeded: true, attempts: 1 });
    let calls = 0;
    const flaky = async () => (calls += 1) >= 3;
    assert.deepEqual(await decideRegistry({ lookup: async () => ({ state: "present" }), verify: flaky, attempts: 5, sleep }), { publishNeeded: false, attempts: 3 });
    await assert.rejects(decideRegistry({ lookup: async () => ({ state: "present" }), verify: async () => false, attempts: 4, sleep }), /provenance of the published version did not verify in 4 attempts/u);
    await assert.rejects(decideRegistry({ lookup: async () => ({ state: "error", reason: "ETIMEDOUT" }), verify: async () => true, attempts: 4, sleep }), /registry lookup failed in 4 attempts.*ETIMEDOUT/su);
  });
});
