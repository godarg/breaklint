#!/usr/bin/env node
/**
 * The release workflow's recovery logic: everything the publish job decides about a state an
 * earlier, partly successful run may have left behind.
 *
 * WHY THIS EXISTS. On 2026-11-21 the 0.11.0 publish failed after its tag was public: no npm
 * version, no GitHub Release. The workflow then made its own rerun impossible in two ways. It
 * demanded that the tag commit BE origin/main, so one merge before the rerun ended the release for
 * good; and it refused any existing GitHub Release, so a rerun after a half-created release could
 * never finish either. Its release notes came from `--generate-notes` (commit titles), not from the
 * CHANGELOG section the tag carries.
 *
 * WHAT IT DECIDES, each in a function the self-test drives with negative controls:
 *   --assert-on-main <commit> <ref>   the tag commit is an ancestor of (or equal to) main:
 *                                     `git merge-base --is-ancestor`. Exit 1 of git is "not on
 *                                     main", any other status is "git could not decide"; neither
 *                                     passes. The workflow still requires a successful ci.yml main
 *                                     push run for exactly this commit.
 *   --notes <v> --changelog <f> --out <f>
 *                                     the release notes are the `## <v> — YYYY-MM-DD` section of
 *                                     the tag commit's CHANGELOG: present once, dated, non-empty.
 *   --registry-decide                 npm has no such version (E404: publish), or it has one whose
 *                                     integrity and provenance verify (no publish). The provenance
 *                                     lookup is retried in a bounded window, because the registry
 *                                     serves attestations minutes after the version. Any other
 *                                     lookup failure never becomes "publish".
 *   --github-release <tag> --notes-file <f> <asset>...
 *                                     no release: create it. A draft (what `gh release create`
 *                                     leaves when an upload fails): verify the assets it has
 *                                     byte for byte, upload only the missing ones, publish it. A
 *                                     published release: every asset present and byte-identical,
 *                                     else fail. Nothing is ever overwritten or deleted, and every
 *                                     write is followed by a byte-for-byte read-back.
 *
 * `--self-test` runs the pure decisions over constructed states, then the real script over a real
 * temporary Git repository and over stand-in `gh`/`npm` executables on PATH, and prints how many
 * negative controls it saw rejected. It runs in `npm run test:release-tag`, on every CI run.
 *
 * TEST HOOK, accepted: BREAKLINT_RECOVERY_TEST_PAUSE_MS shortens the retry pause so the self-test
 * does not wait out the real window. It changes only the pause, never the number of attempts or a
 * decision; release.yml does not set it.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PACKAGE = "breaklint";
const REGISTRY = "https://registry.npmjs.org";
const WORKFLOW_PATH = ".github/workflows/release.yml";

// 20 attempts, 15 s apart: five minutes for the registry to serve the attestations of a version
// it already serves. The post-publish verification in release.yml has its own fifteen minutes.
export const REGISTRY_ATTEMPTS = 20;
const REGISTRY_PAUSE_MS = 15_000;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

// --- release notes -------------------------------------------------------------------------------

/** The body of the `## <version> — YYYY-MM-DD` section, exactly as the CHANGELOG carries it. */
export function changelogSection(text, version) {
  const lines = text.replace(/\r\n/gu, "\n").split("\n");
  const heading = new RegExp(`^## ${escapeRegExp(version)} — (.*)$`, "u");
  const at = lines.flatMap((line, index) => (heading.test(line) ? [index] : []));
  if (at.length === 0) throw new Error(`CHANGELOG.md has no "## ${version} — YYYY-MM-DD" section`);
  if (at.length > 1) throw new Error(`CHANGELOG.md has ${at.length} "## ${version}" sections`);
  const date = heading.exec(lines[at[0]])[1].trim();
  if (date === "TBD-at-tag") throw new Error(`CHANGELOG.md section ${version} is still dated TBD-at-tag; a tag is cut only from the dated commit`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error(`CHANGELOG.md section ${version} is dated "${date}", not YYYY-MM-DD`);
  const end = lines.findIndex((line, index) => index > at[0] && /^## /u.test(line));
  const body = lines.slice(at[0] + 1, end === -1 ? undefined : end).join("\n").trim();
  if (body === "") throw new Error(`CHANGELOG.md: the ${version} section is empty`);
  return `${body}\n`;
}

// --- the tag commit and main ---------------------------------------------------------------------

/** `git merge-base --is-ancestor` exit status, read as a release decision. */
export function ancestryVerdict(status) {
  if (status === 0) return { onMain: true };
  if (status === 1) return { onMain: false, reason: "is not on main (not an ancestor of it)" };
  return { onMain: false, reason: `could not be placed against main (git merge-base exited ${status})` };
}

function assertOnMain(commit, ref) {
  const run = spawnSync("git", ["merge-base", "--is-ancestor", commit, ref], { encoding: "utf8" });
  const verdict = ancestryVerdict(run.error ? null : run.status);
  if (!verdict.onMain) {
    process.stderr.write(`release commit ${commit} ${verdict.reason} ${ref}\n${run.stderr ?? ""}`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`release commit ${commit} is on ${ref}\n`);
}

// --- npm registry --------------------------------------------------------------------------------

/** One `npm view <pkg>@<version> ... --json` run, read as absent, present or an error. */
export function classifyLookup({ status, stdout, stderr }, version) {
  if (status === 0) {
    let metadata;
    try {
      metadata = JSON.parse(stdout);
    } catch {
      return { state: "error", reason: "npm view printed no JSON" };
    }
    if (metadata?.version !== version) return { state: "error", reason: `npm view answered version ${JSON.stringify(metadata?.version)}, not ${version}` };
    return { state: "present", metadata };
  }
  if (/\bE404\b/u.test(stderr ?? "")) return { state: "absent" };
  const last = (stderr ?? "").trim().split("\n").filter(Boolean).slice(-3).join(" | ");
  return { state: "error", reason: last || `npm view exited ${status}` };
}

/**
 * Absent: publish. Present: verify, retrying the lookup in a bounded window. An error is retried in
 * the same window and is never read as absent.
 */
export async function decideRegistry({ lookup, verify, attempts, sleep }) {
  let failure = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await lookup();
    if (result.state === "absent") return { publishNeeded: true, attempts: attempt };
    if (result.state === "present") {
      if (await verify(result)) return { publishNeeded: false, attempts: attempt };
      failure = { kind: "provenance" };
    } else {
      failure = { kind: "lookup", reason: result.reason };
    }
    if (attempt < attempts) await sleep();
  }
  if (failure?.kind === "provenance") {
    throw new Error(`the provenance of the published version did not verify in ${attempts} attempts; npm versions are immutable, inspect it before anything else`);
  }
  throw new Error(`the registry lookup failed in ${attempts} attempts: ${failure?.reason ?? "no attempt ran"}`);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`--registry-decide needs ${name}`);
  return value;
}

async function registryDecide() {
  const version = requiredEnv("RELEASE_VERSION");
  const packageFile = requiredEnv("PACKAGE_FILE");
  const output = requiredEnv("GITHUB_OUTPUT");
  const expected = {
    EXPECTED_PACKAGE_NAME: PACKAGE,
    EXPECTED_VERSION: version,
    EXPECTED_SRI: readFileSync(`${packageFile}.sri`, "utf8").trim(),
    EXPECTED_COMMIT: requiredEnv("RELEASE_COMMIT"),
    EXPECTED_REPOSITORY_URL: `https://github.com/${requiredEnv("GITHUB_REPOSITORY")}`,
    EXPECTED_REF: requiredEnv("GITHUB_REF"),
    EXPECTED_WORKFLOW_PATH: WORKFLOW_PATH,
  };
  const scratch = mkdtempSync(join(tmpdir(), "breaklint-registry-"));
  const pause = process.env.BREAKLINT_RECOVERY_TEST_PAUSE_MS === undefined ? REGISTRY_PAUSE_MS : Number(process.env.BREAKLINT_RECOVERY_TEST_PAUSE_MS);
  try {
    const decision = await decideRegistry({
      attempts: REGISTRY_ATTEMPTS,
      sleep: () => new Promise((done) => setTimeout(done, pause)),
      lookup: async () =>
        classifyLookup(
          spawnSync("npm", ["view", `${PACKAGE}@${version}`, "version", "dist.integrity", "dist.attestations", "gitHead", "--json", `--registry=${REGISTRY}`], { encoding: "utf8" }),
          version,
        ),
      verify: async ({ metadata }) => {
        const response = await fetch(`${REGISTRY}/-/npm/v1/attestations/${PACKAGE}@${version}`).catch((error) => ({ ok: false, status: error.message }));
        if (!response.ok) {
          process.stderr.write(`attestations for ${PACKAGE}@${version} not served yet (${response.status})\n`);
          return false;
        }
        writeFileSync(join(scratch, "metadata.json"), JSON.stringify(metadata));
        writeFileSync(join(scratch, "attestations.json"), await response.text());
        const run = spawnSync(process.execPath, [join(ROOT, "tests/tools/registry-provenance-contract.mjs"), "--verify", join(scratch, "metadata.json"), join(scratch, "attestations.json")], {
          encoding: "utf8",
          env: { ...process.env, ...expected },
        });
        if (run.status !== 0) process.stderr.write(`provenance did not verify yet:\n${run.stdout}${run.stderr}`);
        return run.status === 0;
      },
    });
    appendFileSync(output, `publish_needed=${decision.publishNeeded}\n`);
    process.stdout.write(
      decision.publishNeeded
        ? `${PACKAGE}@${version} is not on npm: first publish\n`
        : `${PACKAGE}@${version} already contains these exact bytes (attempt ${decision.attempts}); continuing recovery verification\n`,
    );
  } catch (error) {
    process.stderr.write(`registry decision: ${error.message}\n`);
    process.exitCode = 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// --- GitHub Release ------------------------------------------------------------------------------

/**
 * What to do with the GitHub Release of `tag`. `local` and `release.assets` map asset names to
 * SHA-256 hex digests of their bytes.
 */
export function planGithubRelease({ tag, release, local }) {
  const names = Object.keys(local);
  if (release === null) return { action: "create", upload: names };
  if (release.tagName !== tag) throw new Error(`the existing release belongs to tag ${release.tagName}, not ${tag}`);
  for (const [name, digest] of Object.entries(release.assets)) {
    if (!(name in local)) throw new Error(`release ${tag} carries an asset this workflow did not validate: ${name}`);
    if (digest !== local[name]) throw new Error(`asset ${name} on release ${tag} differs from the validated artifact (sha256 ${digest}, expected ${local[name]})`);
  }
  const missing = names.filter((name) => !(name in release.assets));
  if (release.isDraft) return { action: "complete-draft", upload: missing };
  if (missing.length > 0) {
    throw new Error(`the published release ${tag} lacks ${missing.join(", ")}; this workflow never leaves that state, so inspect it by hand`);
  }
  return { action: "verified", upload: [] };
}

function gh(args) {
  const run = spawnSync("gh", args, { encoding: "utf8" });
  if (run.error) throw new Error(`gh ${args[0]} ${args[1]}: ${run.error.message}`);
  return run;
}

function mustGh(args) {
  const run = gh(args);
  if (run.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")} failed (${run.status}):\n${run.stdout}${run.stderr}`);
  return run;
}

/** The release as GitHub serves it, each asset's bytes downloaded and hashed; null if none exists. */
function readRelease(tag, scratch) {
  const view = gh(["release", "view", tag, "--json", "tagName,isDraft,assets"]);
  if (view.status !== 0) {
    if (/release not found/iu.test(view.stderr)) return null;
    throw new Error(`gh release view ${tag} failed (${view.status}):\n${view.stderr}`);
  }
  const json = JSON.parse(view.stdout);
  const dir = mkdtempSync(join(scratch, "assets-"));
  const assets = {};
  for (const { name } of json.assets ?? []) {
    mustGh(["release", "download", tag, "--pattern", name, "--dir", dir]);
    assets[name] = sha256(readFileSync(join(dir, name)));
  }
  return { tagName: json.tagName, isDraft: Boolean(json.isDraft), assets };
}

function githubRelease(tag, notesFile, assetPaths) {
  const local = Object.fromEntries(assetPaths.map((path) => [basename(path), sha256(readFileSync(path))]));
  const pathOf = Object.fromEntries(assetPaths.map((path) => [basename(path), path]));
  const title = `${PACKAGE} ${tag.replace(/^v/u, "")}`;
  const scratch = mkdtempSync(join(tmpdir(), "breaklint-release-"));
  try {
    const plan = planGithubRelease({ tag, release: readRelease(tag, scratch), local });
    if (plan.action === "create") {
      mustGh(["release", "create", tag, ...assetPaths, "--verify-tag", "--notes-file", notesFile, "--title", title]);
    } else if (plan.action === "complete-draft") {
      if (plan.upload.length > 0) mustGh(["release", "upload", tag, ...plan.upload.map((name) => pathOf[name])]);
      mustGh(["release", "edit", tag, "--draft=false", "--notes-file", notesFile, "--title", title]);
    }
    // Read back what GitHub now serves: whatever was written must be exactly the validated bytes.
    const after = planGithubRelease({ tag, release: readRelease(tag, scratch), local });
    if (after.action !== "verified") throw new Error(`after "${plan.action}" the release ${tag} is still not complete (${after.action})`);
    process.stdout.write(`GitHub Release ${tag}: ${plan.action === "verified" ? "already complete" : plan.action}; ${Object.keys(local).length} assets byte-identical to the validated artifact\n`);
  } catch (error) {
    process.stderr.write(`GitHub Release ${tag}: ${error.message}\n`);
    process.exitCode = 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// --- self-test -----------------------------------------------------------------------------------

const FAKE_GH = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const file = process.env.FAKE_GH_STATE;
const state = JSON.parse(fs.readFileSync(file, "utf8"));
const args = process.argv.slice(2);
state.calls.push(args);
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const files = (list) => list.filter((a, i) => !a.startsWith("--") && !(list[i - 1] || "").startsWith("--"));
const [group, verb, tag, ...rest] = args;
if (group !== "release") { process.stderr.write("unexpected " + args.join(" ")); process.exit(2); }
if (verb === "view") {
  save();
  if (!state.release) { process.stderr.write("release not found\\n"); process.exit(1); }
  process.stdout.write(JSON.stringify({ tagName: state.release.tagName, isDraft: state.release.isDraft,
    assets: Object.keys(state.release.assets).map((name) => ({ name })) }));
} else if (verb === "download") {
  const name = rest[rest.indexOf("--pattern") + 1];
  const dir = rest[rest.indexOf("--dir") + 1];
  fs.writeFileSync(path.join(dir, name), Buffer.from(state.release.assets[name], "base64"));
  save();
} else if (verb === "create") {
  state.release = { tagName: tag, isDraft: false, assets: {} };
  for (const f of files(rest)) state.release.assets[path.basename(f)] = fs.readFileSync(f).toString("base64");
  state.notes = fs.readFileSync(rest[rest.indexOf("--notes-file") + 1], "utf8");
  save();
} else if (verb === "upload") {
  for (const f of files(rest)) state.release.assets[path.basename(f)] = fs.readFileSync(f).toString("base64");
  save();
} else if (verb === "edit") {
  if (rest.includes("--draft=false")) state.release.isDraft = false;
  save();
} else { process.stderr.write("unexpected " + args.join(" ")); process.exit(2); }
`;

const FAKE_NPM = `#!/usr/bin/env node
const mode = process.env.FAKE_NPM_MODE;
if (process.argv[2] !== "view") { process.stderr.write("unexpected npm " + process.argv.slice(2).join(" ")); process.exit(2); }
if (mode === "absent") { process.stderr.write("npm error code E404\\nnpm error 404 Not Found - GET https://registry.npmjs.org/breaklint\\n"); process.exit(1); }
process.stderr.write("npm error code ETIMEDOUT\\nnpm error network request failed\\n");
process.exit(1);
`;

async function runSelfTest() {
  let checks = 0;
  let rejected = 0;
  const ok = (condition, message) => {
    assert.ok(condition, `self-test: ${message}`);
    checks += 1;
  };
  const rejects = (fn, pattern, name) => {
    assert.throws(fn, pattern, `self-test: ${name} was accepted`);
    rejected += 1;
  };
  const rejectsAsync = async (promise, pattern, name) => {
    await assert.rejects(promise, pattern, `self-test: ${name} was accepted`);
    rejected += 1;
  };

  // Release notes, on the real CHANGELOG and on states it must refuse.
  const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
  const released = /^## (\d+\.\d+\.\d+) — \d{4}-\d{2}-\d{2}$/mu.exec(changelog);
  ok(released, "the real CHANGELOG has no dated section to read");
  const notes = changelogSection(changelog, released[1]);
  ok(notes.trim().length > 0 && !/^## /mu.test(notes) && changelog.includes(notes.trim()), "the real CHANGELOG section was not returned exactly");
  rejects(() => changelogSection(changelog, "0.0.99"), /has no "## 0\.0\.99/u, "notes for a version without a section");
  rejects(() => changelogSection("## 1.2.3 — TBD-at-tag\n\nx\n", "1.2.3"), /still dated TBD-at-tag/u, "notes from an undated section");
  rejects(() => changelogSection("## 1.2.3 — soon\n\nx\n", "1.2.3"), /not YYYY-MM-DD/u, "notes from a section dated with a word");
  rejects(() => changelogSection("## 1.2.3 — 2026-01-01\n\n## 1.2.2 — 2025-12-01\n\nx\n", "1.2.3"), /section is empty/u, "an empty section");
  rejects(() => changelogSection("## 1.2.30 — 2026-01-01\n\nx\n", "1.2.3"), /has no "## 1\.2\.3/u, "a longer version's section");
  rejects(() => changelogSection("## 1.2.3 — 2026-01-01\n\nx\n\n## 1.2.3 — 2026-01-02\n\ny\n", "1.2.3"), /2 "## 1\.2\.3" sections/u, "two sections for one version");

  // GitHub Release states.
  const local = { "a.tgz": "1".repeat(64), "a.tgz.sha256": "2".repeat(64), "a.tgz.sri": "3".repeat(64) };
  const names = Object.keys(local);
  assert.deepEqual(planGithubRelease({ tag: "v1.0.0", release: null, local }), { action: "create", upload: names });
  assert.deepEqual(planGithubRelease({ tag: "v1.0.0", release: { tagName: "v1.0.0", isDraft: true, assets: { "a.tgz": local["a.tgz"] } }, local }), { action: "complete-draft", upload: names.slice(1) });
  assert.deepEqual(planGithubRelease({ tag: "v1.0.0", release: { tagName: "v1.0.0", isDraft: false, assets: { ...local } }, local }), { action: "verified", upload: [] });
  checks += 3;
  rejects(() => planGithubRelease({ tag: "v1.0.0", release: { tagName: "v1.0.0", isDraft: false, assets: { ...local, "a.tgz": "9".repeat(64) } }, local }), /differs from the validated artifact/u, "a complete release with other bytes");
  rejects(() => planGithubRelease({ tag: "v1.0.0", release: { tagName: "v1.0.0", isDraft: true, assets: { "a.tgz.sri": "9".repeat(64) } }, local }), /differs from the validated artifact/u, "a draft with other bytes");
  rejects(() => planGithubRelease({ tag: "v1.0.0", release: { tagName: "v1.0.0", isDraft: false, assets: { "a.tgz": local["a.tgz"] } }, local }), /published release v1\.0\.0 lacks/u, "a published release with missing assets");
  rejects(() => planGithubRelease({ tag: "v1.0.0", release: { tagName: "v1.0.0", isDraft: true, assets: { ...local, "x.zip": "4".repeat(64) } }, local }), /did not validate: x\.zip/u, "a release with a foreign asset");
  rejects(() => planGithubRelease({ tag: "v1.0.0", release: { tagName: "v1.0.1", isDraft: false, assets: { ...local } }, local }), /belongs to tag v1\.0\.1/u, "another tag's release");

  // Registry decisions.
  ok(classifyLookup({ status: 1, stdout: "", stderr: "npm error code E404\n" }, "1.0.0").state === "absent", "E404 is not absent");
  ok(classifyLookup({ status: 0, stdout: '{"version":"1.0.0"}', stderr: "" }, "1.0.0").state === "present", "a matching version is not present");
  for (const [name, run] of [
    ["a network error", { status: 1, stdout: "", stderr: "npm error code ETIMEDOUT\n" }],
    ["an authentication error", { status: 1, stdout: "", stderr: "npm error code E401\n" }],
    ["another version", { status: 0, stdout: '{"version":"1.0.1"}', stderr: "" }],
    ["output that is not JSON", { status: 0, stdout: "1.0.0", stderr: "" }],
    ["a killed npm", { status: null, stdout: "", stderr: "" }],
  ]) {
    assert.equal(classifyLookup(run, "1.0.0").state, "error", `self-test: ${name} was not an error`);
    rejected += 1;
  }
  const sleep = async () => {};
  assert.deepEqual(await decideRegistry({ lookup: async () => ({ state: "absent" }), verify: async () => true, attempts: 3, sleep }), { publishNeeded: true, attempts: 1 });
  let calls = 0;
  assert.deepEqual(await decideRegistry({ lookup: async () => ({ state: "present" }), verify: async () => (calls += 1) >= 3, attempts: 5, sleep }), { publishNeeded: false, attempts: 3 });
  let errors = 0;
  assert.deepEqual(await decideRegistry({ lookup: async () => ((errors += 1) < 2 ? { state: "error", reason: "x" } : { state: "present" }), verify: async () => true, attempts: 3, sleep }), { publishNeeded: false, attempts: 2 });
  checks += 3;
  await rejectsAsync(decideRegistry({ lookup: async () => ({ state: "present" }), verify: async () => false, attempts: 4, sleep }), /did not verify in 4 attempts/u, "provenance that never verifies");
  await rejectsAsync(decideRegistry({ lookup: async () => ({ state: "error", reason: "ETIMEDOUT" }), verify: async () => true, attempts: 4, sleep }), /lookup failed in 4 attempts: ETIMEDOUT/u, "a lookup that never answers");

  const scratch = mkdtempSync(join(tmpdir(), "breaklint-recovery-self-test-"));
  try {
    const run = (args, env = {}, cwd = scratch) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } });

    // The tag commit and main, in a real repository: an ancestor passes, a side branch does not.
    const repo = join(scratch, "repo");
    mkdirSync(repo);
    const git = (...args) => {
      const result = spawnSync("git", ["-c", "user.name=self-test", "-c", "user.email=self-test@invalid", "-c", "commit.gpgsign=false", ...args], { cwd: repo, encoding: "utf8" });
      assert.equal(result.status, 0, `self-test: git ${args.join(" ")}: ${result.stderr}`);
      return result.stdout.trim();
    };
    git("init", "-q", "-b", "main");
    git("commit", "-q", "--allow-empty", "-m", "tag commit");
    const tagged = git("rev-parse", "HEAD");
    git("commit", "-q", "--allow-empty", "-m", "main moved on");
    git("checkout", "-q", "-b", "side", tagged);
    git("commit", "-q", "--allow-empty", "-m", "never merged");
    const side = git("rev-parse", "HEAD");
    git("checkout", "-q", "main");
    ok(run(["--assert-on-main", tagged, "main"], {}, repo).status === 0, "a tag commit behind main was refused");
    ok(run(["--assert-on-main", git("rev-parse", "main"), "main"], {}, repo).status === 0, "the main tip itself was refused");
    for (const [name, commit, pattern] of [
      ["a commit on a side branch", side, /is not on main/u],
      ["a commit that does not exist", "0".repeat(40), /could not be placed against main/u],
    ]) {
      const result = run(["--assert-on-main", commit, "main"], {}, repo);
      assert.equal(result.status, 1, `self-test: ${name} passed --assert-on-main`);
      assert.match(result.stderr, pattern, `self-test: ${name} failed for the wrong reason: ${result.stderr}`);
      rejected += 1;
    }

    // The notes mode writes the section, and refuses an undated one without writing.
    writeFileSync(join(scratch, "CHANGELOG.md"), "# Changelog\n\n## 1.0.0 — 2026-01-01\n\nFirst.\n\n## 0.9.0 — 2025-12-01\n\nOld.\n");
    ok(run(["--notes", "1.0.0", "--changelog", join(scratch, "CHANGELOG.md"), "--out", join(scratch, "notes.md")]).status === 0, "--notes failed on a dated section");
    ok(readFileSync(join(scratch, "notes.md"), "utf8") === "First.\n", "--notes wrote something other than the section");
    writeFileSync(join(scratch, "CHANGELOG.md"), "# Changelog\n\n## 1.0.0 — TBD-at-tag\n\nFirst.\n");
    const undated = run(["--notes", "1.0.0", "--changelog", join(scratch, "CHANGELOG.md"), "--out", join(scratch, "undated.md")]);
    assert.equal(undated.status, 1, "self-test: --notes accepted an undated section");
    assert.throws(() => readFileSync(join(scratch, "undated.md")), /ENOENT/u, "self-test: --notes wrote notes for an undated section");
    rejected += 1;

    // The GitHub Release state machine through the real script and a stand-in gh.
    const bin = join(scratch, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "gh"), FAKE_GH);
    writeFileSync(join(bin, "npm"), FAKE_NPM);
    chmodSync(join(bin, "gh"), 0o755);
    chmodSync(join(bin, "npm"), 0o755);
    const PATH = `${bin}${delimiter}${process.env.PATH}`;
    const assets = ["breaklint-1.0.0.tgz", "breaklint-1.0.0.tgz.sha256", "breaklint-1.0.0.tgz.sri"].map((name, index) => {
      const path = join(scratch, name);
      writeFileSync(path, `validated bytes ${index}\n`);
      return path;
    });
    const b64 = (path) => readFileSync(path).toString("base64");
    const releaseRun = (release) => {
      const stateFile = join(scratch, "gh-state.json");
      writeFileSync(stateFile, JSON.stringify({ release, calls: [] }));
      const result = run(["--github-release", "v1.0.0", "--notes-file", join(scratch, "notes.md"), ...assets], { PATH, FAKE_GH_STATE: stateFile });
      const state = JSON.parse(readFileSync(stateFile, "utf8"));
      return { result, state, writes: state.calls.filter(([, verb]) => !["view", "download"].includes(verb)).map(([, verb]) => verb) };
    };
    const allAssets = () => Object.fromEntries(assets.map((path) => [basename(path), b64(path)]));

    let r = releaseRun(null);
    ok(r.result.status === 0 && r.writes.join() === "create" && r.state.notes === "First.\n" && !r.state.release.isDraft, `no release: expected one create with the CHANGELOG notes, got ${r.writes} ${r.result.stderr}`);
    r = releaseRun({ tagName: "v1.0.0", isDraft: true, assets: { [basename(assets[0])]: b64(assets[0]) } });
    ok(r.result.status === 0 && r.writes.join() === "upload,edit" && !r.state.release.isDraft, `a draft: expected upload then edit, got ${r.writes} ${r.result.stderr}`);
    ok(r.state.calls.find(([, verb]) => verb === "upload").slice(3).map((path) => basename(path)).join() === "breaklint-1.0.0.tgz.sha256,breaklint-1.0.0.tgz.sri", "a draft: something other than the missing assets was uploaded");
    r = releaseRun({ tagName: "v1.0.0", isDraft: false, assets: allAssets() });
    ok(r.result.status === 0 && r.writes.length === 0, `a complete release: expected no write, got ${r.writes} ${r.result.stderr}`);
    for (const [name, release, pattern] of [
      ["a complete release with other bytes", { tagName: "v1.0.0", isDraft: false, assets: { ...allAssets(), [basename(assets[0])]: Buffer.from("other").toString("base64") } }, /differs from the validated artifact/u],
      ["a published release missing an asset", { tagName: "v1.0.0", isDraft: false, assets: { [basename(assets[0])]: b64(assets[0]) } }, /lacks/u],
      ["a draft with a foreign asset", { tagName: "v1.0.0", isDraft: true, assets: { "notes.zip": "eA==" } }, /did not validate: notes\.zip/u],
    ]) {
      r = releaseRun(release);
      assert.equal(r.result.status, 1, `self-test: ${name} passed --github-release`);
      assert.match(r.result.stderr, pattern, `self-test: ${name} failed for the wrong reason: ${r.result.stderr}`);
      assert.deepEqual(r.writes, [], `self-test: ${name} was written to before it was refused`);
      rejected += 1;
    }

    // The registry decision through the real script and a stand-in npm.
    writeFileSync(`${assets[0]}.sri`, "sha512-AAAA\n");
    const decide = (mode) => {
      const output = join(scratch, `output-${mode}`);
      writeFileSync(output, "");
      const result = run(["--registry-decide"], {
        PATH, FAKE_NPM_MODE: mode, BREAKLINT_RECOVERY_TEST_PAUSE_MS: "0", GITHUB_OUTPUT: output,
        RELEASE_VERSION: "1.0.0", PACKAGE_FILE: assets[0], RELEASE_COMMIT: tagged,
        GITHUB_REPOSITORY: "owner/breaklint", GITHUB_REF: "refs/tags/v1.0.0",
      });
      return { result, output: readFileSync(output, "utf8") };
    };
    const absent = decide("absent");
    ok(absent.result.status === 0 && absent.output === "publish_needed=true\n", `an absent version did not lead to a publish: ${absent.result.stderr}`);
    const failing = decide("error");
    assert.equal(failing.result.status, 1, "self-test: a registry that never answers passed --registry-decide");
    assert.match(failing.result.stderr, new RegExp(`lookup failed in ${REGISTRY_ATTEMPTS} attempts: .*ETIMEDOUT`, "u"), `self-test: wrong reason: ${failing.result.stderr}`);
    assert.equal(failing.output, "", "self-test: a failed registry lookup still wrote a publish decision");
    rejected += 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  process.stdout.write(`release recovery self-test: ${checks} checks passed, ${rejected} negative controls rejected\n`);
}

// --- command line --------------------------------------------------------------------------------

function isMain() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === SCRIPT;
}

function usage(args) {
  process.stderr.write(
    `release-recovery.mjs: unknown arguments ${JSON.stringify(args)}\n` +
      "usage: release-recovery.mjs --assert-on-main <commit> <ref> | --notes <version> --changelog <file> --out <file> |\n" +
      "       --registry-decide | --github-release <tag> --notes-file <file> <asset>... | --self-test\n",
  );
  process.exitCode = 2;
}

if (isMain()) {
  // Exactly these forms; anything else is exit 2, never a quieter run.
  const args = process.argv.slice(2);
  const plain = (value) => typeof value === "string" && value !== "" && !value.startsWith("--");
  if (args.length === 1 && args[0] === "--self-test") await runSelfTest();
  else if (args.length === 3 && args[0] === "--assert-on-main" && plain(args[1]) && plain(args[2])) assertOnMain(args[1], args[2]);
  else if (args.length === 6 && args[0] === "--notes" && args[2] === "--changelog" && args[4] === "--out" && [1, 3, 5].every((i) => plain(args[i]))) {
    try {
      const notes = changelogSection(readFileSync(args[3], "utf8"), args[1]);
      writeFileSync(args[5], notes);
      process.stdout.write(`release notes: the ${args[1]} section of ${args[3]} (${notes.length} characters)\n`);
    } catch (error) {
      process.stderr.write(`release notes: ${error.message}\n`);
      process.exitCode = 1;
    }
  } else if (args.length === 1 && args[0] === "--registry-decide") await registryDecide();
  else if (args.length >= 5 && args[0] === "--github-release" && plain(args[1]) && args[2] === "--notes-file" && args.slice(3).every(plain)) {
    githubRelease(args[1], args[3], args.slice(4));
  } else usage(args);
}
