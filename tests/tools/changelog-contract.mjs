#!/usr/bin/env node
/**
 * CHANGELOG.md says what is released and what is not, and git is the oracle for which is which.
 *
 * WHY THIS EXISTS. Two things went wrong around 0.6.0 and nothing could see either:
 *   - The tag commit carried `## 0.6.0 — unreleased`, and so did the tarball npm now serves. The
 *     heading was dated only after the tag.
 *   - Two commits after the tag changed a rule's behaviour and its advice string, and the
 *     changelog had no section to put them in: one change was not recorded at all, the other was
 *     written into the dated 0.6.0 section as an in-place erratum.
 *
 * THREE STATES, decided by git rather than by the file under test:
 *   A. After a release — `v<package.json version>` is a tag reachable from HEAD, and HEAD is a later
 *      commit. If anything under `src/` differs between that tag and HEAD, the first section must
 *      be `## Unreleased` with at least one entry, and every changed `src/rules/<ns>/<name>.ts` must
 *      name its rule id there. The released section itself must carry a date.
 *   B. Release preparation — package.json names a version that has no tag yet. It must be greater
 *      than the last release tag; the first section must be `## <version> — YYYY-MM-DD` or exactly
 *      `## <version> — TBD-at-tag` (the owner sets the date immediately before tagging); no
 *      `## Unreleased` section may be left; `docs/status.md` must not call the version unreleased.
 *   C. The release build — HEAD is the commit `v<version>` points at, which is what the release
 *      workflow checks out and what npm will serve. The rules of B apply, except that ONLY a date
 *      is accepted: a `TBD-at-tag` left in place stops the release workflow here, before any
 *      outward action, with the instruction to date the heading in a final commit and tag that.
 *
 * A SHALLOW CLONE IS NOT A PASS. Without the tags, or with history cut above them, "released" and
 * "unreleased" cannot be told apart. The check then fails and says so; CI checks out with
 * `fetch-depth: 0`. A check that went green because it could not see the tag would be the
 * idle-checker-reads-as-clean shape this repository keeps having to repair.
 *
 * `--self-test` builds throwaway git repositories for each state, including a shallow clone and
 * the 0.6.0 reproduction, and runs `--check` on each in a child process.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(import.meta.url);
const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/u;
const DATED_HEADING = (version) => new RegExp(`^## ${version.replace(/\./gu, "\\.")} — \\d{4}-\\d{2}-\\d{2}$`, "u");
/** The one placeholder release preparation may carry. It is never accepted at the tag. */
const PLACEHOLDER = "TBD-at-tag";
const RULE_FILE = /^src\/rules\/([a-z]+)\/([a-z0-9-]+)\.ts$/u;

function git(root, args) {
  const run = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return { ok: run.status === 0, out: (run.stdout ?? "").trim(), err: (run.stderr ?? "").trim() };
}

function compare(a, b) {
  const x = RELEASE_TAG.exec(a).slice(1).map(Number);
  const y = RELEASE_TAG.exec(b).slice(1).map(Number);
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

const maxTag = (tags) => [...tags].sort(compare).at(-1);

/** `## ` sections of the changelog, in order, each with its heading and body lines. */
function sectionsOf(text) {
  const sections = [];
  for (const line of text.replace(/\r\n/gu, "\n").split("\n")) {
    if (line.startsWith("## ")) sections.push({ heading: line.trimEnd(), body: [] });
    else if (sections.length) sections.at(-1).body.push(line);
  }
  return sections;
}

function releasePrepIssues(version, sections, statusText, { atTag }) {
  const issues = [];
  const first = sections[0];
  const dated = Boolean(first) && DATED_HEADING(version).test(first.heading);
  const placeholder = Boolean(first) && first.heading === `## ${version} — ${PLACEHOLDER}`;
  if (atTag && placeholder) {
    issues.push(
      `v${version} points at a commit whose CHANGELOG heading is still "## ${version} — ${PLACEHOLDER}", and a tarball ` +
        `built from it would ship that heading. Replace ${PLACEHOLDER} with the release date ("## ${version} — YYYY-MM-DD") ` +
        "in a final commit on main, let CI go green on that commit, and tag that commit. This check runs before any outward action.",
    );
  } else if (!dated && !(placeholder && !atTag)) {
    issues.push(
      (atTag
        ? `the first CHANGELOG section must be "## ${version} — YYYY-MM-DD" at the tag commit`
        : `the first CHANGELOG section must be "## ${version} — YYYY-MM-DD", or "## ${version} — ${PLACEHOLDER}" until the tag`) +
        `; it is ${first ? JSON.stringify(first.heading) : "absent"}. A tarball built from this commit would ship that heading.`,
    );
  }
  // The version's own heading was reported above; any OTHER "unreleased" heading is a leftover.
  const unreleased = sections.filter((section, index) =>
    /unreleased/iu.test(section.heading) && !(index === 0 && section.heading.startsWith(`## ${version} `)));
  for (const section of unreleased) {
    issues.push(`CHANGELOG still carries ${JSON.stringify(section.heading)}; fold its entries into the ${version} section`);
  }
  const statusClaim = new RegExp(`${version.replace(/\./gu, "\\.")}\\s*(\\(unreleased\\)|— unreleased)`, "iu");
  if (statusText !== null && statusClaim.test(statusText)) {
    issues.push(`docs/status.md still calls ${version} unreleased`);
  }
  return issues;
}

export function checkChangelog(root) {
  const issues = [];
  const fail = (message) => ({ valid: false, state: "undetermined", issues: [message] });
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const version = manifest.version;
  if (typeof version !== "string" || !RELEASE_TAG.test(`v${version}`)) return fail(`package.json version ${JSON.stringify(version)} is not X.Y.Z`);
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const statusPath = join(root, "docs/status.md");
  const statusText = existsSync(statusPath) ? readFileSync(statusPath, "utf8") : null;
  const sections = sectionsOf(changelog);

  const head = git(root, ["rev-parse", "HEAD^{commit}"]);
  if (!head.ok) return fail(`not a git checkout with a commit: ${head.err}`);
  const shallow = git(root, ["rev-parse", "--is-shallow-repository"]).out === "true";
  const allTags = git(root, ["tag", "--list", "v*.*.*"]).out.split("\n").filter((tag) => RELEASE_TAG.test(tag));
  if (allTags.length === 0) {
    return fail(
      `no release tag (vX.Y.Z) exists in this clone${shallow ? ", which is shallow" : ""}, so released and unreleased ` +
        "work cannot be told apart. Fetch the full history with its tags (actions/checkout fetch-depth: 0).",
    );
  }
  const reachable = git(root, ["tag", "--merged", "HEAD", "--list", "v*.*.*"]).out.split("\n").filter((tag) => RELEASE_TAG.test(tag));
  if (reachable.length === 0) {
    return fail(
      shallow
        ? `this clone is shallow and no release tag is reachable from HEAD (${allTags.length} tag(s) exist but their ` +
            "history is cut away). Fetch the full history (actions/checkout fetch-depth: 0)."
        : `no release tag is an ancestor of HEAD (${allTags.length} tag(s) exist elsewhere)`,
    );
  }
  const newest = maxTag(allTags);
  if (shallow && !reachable.includes(newest)) {
    return fail(`this clone is shallow and cannot establish whether ${newest} is an ancestor of HEAD. Fetch the full history (actions/checkout fetch-depth: 0).`);
  }
  const lastTag = maxTag(reachable);
  const versionTag = `v${version}`;

  if (allTags.includes(versionTag)) {
    const tagCommit = git(root, ["rev-parse", `${versionTag}^{commit}`]).out;
    if (tagCommit === head.out) {
      // The release build: this commit is what npm will serve, so only a date is accepted.
      issues.push(...releasePrepIssues(version, sections, statusText, { atTag: true }));
      return { valid: issues.length === 0, state: `release build of ${versionTag}`, issues };
    }
    if (!reachable.includes(versionTag)) {
      return fail(`${versionTag} exists but is not an ancestor of HEAD${shallow ? " (and this clone is shallow)" : ""}`);
    }
    if (compare(versionTag, lastTag) < 0) {
      issues.push(`package.json names ${version}, older than the last release tag ${lastTag} reachable from HEAD`);
    }
    const released = sections.find((section) => section.heading.startsWith(`## ${version} `) || section.heading === `## ${version}`);
    if (!released) issues.push(`CHANGELOG has no section for the released ${version}`);
    else if (!DATED_HEADING(version).test(released.heading)) {
      issues.push(`the released section ${JSON.stringify(released.heading)} carries no date`);
    }
    const diff = git(root, ["diff", "--name-only", `${versionTag}..HEAD`, "--", "src"]);
    if (!diff.ok) return fail(`git diff ${versionTag}..HEAD failed: ${diff.err}`);
    const changed = diff.out.split("\n").filter(Boolean);
    if (changed.length > 0) {
      const first = sections[0];
      if (!first || first.heading !== "## Unreleased") {
        issues.push(
          `${changed.length} file(s) under src/ changed since ${versionTag}, but the first CHANGELOG section is ` +
            `${first ? JSON.stringify(first.heading) : "absent"}, not "## Unreleased": ${changed.slice(0, 5).join(", ")}`,
        );
      } else {
        const body = first.body.join("\n");
        if (!first.body.some((line) => /^\s*- \S/u.test(line))) {
          issues.push(`## Unreleased has no entry, but src/ changed since ${versionTag}: ${changed.slice(0, 5).join(", ")}`);
        }
        for (const path of changed) {
          const match = RULE_FILE.exec(path);
          if (!match) continue;
          const id = `${match[1]}/${match[2]}`;
          const atHead = git(root, ["show", `HEAD:${path}`]).out;
          const atTag = git(root, ["show", `${versionTag}:${path}`]).out;
          // A rule module declares its id as a string literal; a helper in the same directory does not.
          if (!atHead.includes(`"${id}"`) && !atTag.includes(`"${id}"`)) continue;
          if (!body.includes(id)) issues.push(`${path} changed since ${versionTag}, but ## Unreleased does not name ${id}`);
        }
      }
    }
    return { valid: issues.length === 0, state: `after ${versionTag}, ${changed.length} src file(s) changed`, issues };
  }

  // Release preparation: a version with no tag yet.
  if (compare(versionTag, lastTag) <= 0) {
    issues.push(`package.json names ${version}, which has no tag and is not newer than the last release tag ${lastTag}`);
  }
  issues.push(...releasePrepIssues(version, sections, statusText, { atTag: false }));
  return { valid: issues.length === 0, state: `release preparation of ${version} after ${lastTag}`, issues };
}

function runCheck(root) {
  const result = checkChangelog(root);
  if (!result.valid) {
    process.stderr.write(`changelog contract (${result.state}): FAILED\n${result.issues.map((issue) => `  - ${issue}`).join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`changelog contract (${result.state}): CHANGELOG.md agrees with git\n`);
}

// --- self-test -----------------------------------------------------------------------------------

const RULE_SOURCE = 'export const rule = { id: "layout/widow" };\n';
const DATED = "## 1.0.0 — 2026-01-01\n\n- First release.\n";

function sh(cwd, args) {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(run.status, 0, `git ${args.join(" ")} failed: ${run.stderr}`);
  return run.stdout.trim();
}

function write(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

function commitAll(root, message) {
  sh(root, ["add", "-A"]);
  sh(root, ["commit", "--quiet", "--allow-empty", "-m", message]);
}

/** A repository whose only release, v1.0.0, is an annotated tag on its first commit. */
function releasedRepo(scratch, name) {
  const root = join(scratch, name);
  mkdirSync(root, { recursive: true });
  sh(root, ["init", "--quiet"]);
  sh(root, ["config", "user.name", "breaklint changelog canary"]);
  sh(root, ["config", "user.email", "changelog-canary@example.invalid"]);
  sh(root, ["config", "commit.gpgsign", "false"]);
  sh(root, ["config", "tag.gpgsign", "false"]);
  write(root, {
    "package.json": JSON.stringify({ name: "canary", version: "1.0.0" }),
    "CHANGELOG.md": `# Changelog\n\n${DATED}`,
    "src/rules/layout/widow.ts": RULE_SOURCE,
    "src/rules/layout/shared.ts": "export const helper = 1;\n",
    "docs/status.md": "# Status\n",
  });
  commitAll(root, "release 1.0.0");
  sh(root, ["tag", "-a", "v1.0.0", "-m", "canary 1.0.0"]);
  return root;
}

function runSelfTest() {
  const scratch = mkdtempSync(join(tmpdir(), "breaklint-changelog-"));
  const unreleased = (body) => `# Changelog\n\n## Unreleased\n\n${body}\n${DATED}`;
  const prep = (heading, extra = "") => `# Changelog\n\n${extra}${heading}\n\n- Second release.\n\n${DATED}`;
  const cases = [
    { name: "a src change after the tag with no Unreleased section", expect: 1, match: /not "## Unreleased"/u,
      after: { "src/rules/layout/widow.ts": `${RULE_SOURCE}// changed\n` } },
    { name: "an Unreleased section that names the changed rule", expect: 0,
      after: { "src/rules/layout/widow.ts": `${RULE_SOURCE}// changed\n`, "CHANGELOG.md": unreleased("- `layout/widow` now counts differently.\n") } },
    { name: "an Unreleased section that does not name the changed rule", expect: 1, match: /does not name layout\/widow/u,
      after: { "src/rules/layout/widow.ts": `${RULE_SOURCE}// changed\n`, "CHANGELOG.md": unreleased("- Something changed.\n") } },
    { name: "an Unreleased section with no entry", expect: 1, match: /## Unreleased has no entry/u,
      after: { "src/rules/layout/widow.ts": `${RULE_SOURCE}// changed\n`, "CHANGELOG.md": unreleased("Changes since the tag.\n") } },
    { name: "a helper change needs an entry but no rule id", expect: 0,
      after: { "src/rules/layout/shared.ts": "export const helper = 2;\n", "CHANGELOG.md": unreleased("- A helper changed.\n") } },
    { name: "no src change after the tag and no Unreleased section", expect: 0,
      after: { "README.md": "docs only\n" } },
    { name: "a version bump with a dated heading", expect: 0,
      after: { "package.json": JSON.stringify({ name: "canary", version: "1.1.0" }), "CHANGELOG.md": prep("## 1.1.0 — 2026-02-03") } },
    { name: "a version bump dated TBD-at-tag, before the tag", expect: 0,
      after: { "package.json": JSON.stringify({ name: "canary", version: "1.1.0" }), "CHANGELOG.md": prep("## 1.1.0 — TBD-at-tag") } },
    { name: "a version bump with any other placeholder", expect: 1, match: /or "## 1\.1\.0 — TBD-at-tag" until the tag; it is "## 1\.1\.0 — TBD"/u,
      after: { "package.json": JSON.stringify({ name: "canary", version: "1.1.0" }), "CHANGELOG.md": prep("## 1.1.0 — TBD") } },
    { name: "a version bump whose heading says unreleased (the 0.6.0 tarball)", expect: 1, match: /must be "## 1\.1\.0 — YYYY-MM-DD"/u,
      after: { "package.json": JSON.stringify({ name: "canary", version: "1.1.0" }), "CHANGELOG.md": prep("## 1.1.0 — unreleased") } },
    { name: "a version bump that leaves an Unreleased section behind", expect: 1, match: /still carries "## Unreleased"/u,
      after: { "package.json": JSON.stringify({ name: "canary", version: "1.1.0" }), "CHANGELOG.md": prep("## 1.1.0 — 2026-02-03", "## Unreleased\n\n- left over\n\n") } },
    { name: "a version bump while status.md still says unreleased", expect: 1, match: /docs\/status\.md still calls 1\.1\.0 unreleased/u,
      after: { "package.json": JSON.stringify({ name: "canary", version: "1.1.0" }), "CHANGELOG.md": prep("## 1.1.0 — 2026-02-03"), "docs/status.md": "## Current work — 1.1.0 (unreleased)\n" } },
    { name: "a version older than the last tag", expect: 1, match: /not newer than the last release tag v1\.0\.0/u,
      after: { "package.json": JSON.stringify({ name: "canary", version: "0.9.0" }), "CHANGELOG.md": prep("## 0.9.0 — 2026-02-03") } },
    { name: "the release build of a dated tag", expect: 0, tagAfter: "v1.1.0",
      after: { "package.json": JSON.stringify({ name: "canary", version: "1.1.0" }), "CHANGELOG.md": prep("## 1.1.0 — 2026-02-03") } },
    { name: "the release build of a tag whose heading is still TBD-at-tag", expect: 1, tagAfter: "v1.1.0",
      match: /Replace TBD-at-tag with the release date \("## 1\.1\.0 — YYYY-MM-DD"\) in a final commit on main, let CI go green on that commit, and tag that commit/u,
      after: { "package.json": JSON.stringify({ name: "canary", version: "1.1.0" }), "CHANGELOG.md": prep("## 1.1.0 — TBD-at-tag") } },
    { name: "the release build of a tag whose heading says unreleased (the 0.6.0 tag)", expect: 1, tagAfter: "v1.1.0", match: /must be "## 1\.1\.0 — YYYY-MM-DD" at the tag commit/u,
      after: { "package.json": JSON.stringify({ name: "canary", version: "1.1.0" }), "CHANGELOG.md": prep("## 1.1.0 — unreleased") } },
  ];
  try {
    const results = [];
    for (const [index, testCase] of cases.entries()) {
      const root = releasedRepo(scratch, `case-${index}`);
      write(root, testCase.after);
      commitAll(root, "after the release");
      if (testCase.tagAfter) sh(root, ["tag", "-a", testCase.tagAfter, "-m", testCase.tagAfter]);
      results.push({ testCase, root });
    }

    // A clone with no tags at all, and a shallow clone whose tag is present but cut away.
    const origin = releasedRepo(scratch, "origin");
    write(origin, { "src/rules/layout/widow.ts": `${RULE_SOURCE}// changed\n`, "CHANGELOG.md": unreleased("- `layout/widow` changed.\n") });
    commitAll(origin, "after the release");
    commitAll(origin, "one more");
    const untagged = join(scratch, "untagged");
    sh(scratch, ["clone", "--quiet", "--no-tags", `file://${origin}`, untagged]);
    results.push({ testCase: { name: "a clone without tags", expect: 1, match: /no release tag \(vX\.Y\.Z\) exists/u }, root: untagged });
    const shallow = join(scratch, "shallow");
    sh(scratch, ["clone", "--quiet", "--depth", "1", "--no-tags", `file://${origin}`, shallow]);
    sh(shallow, ["fetch", "--quiet", "--depth", "1", "origin", "refs/tags/v1.0.0:refs/tags/v1.0.0"]);
    results.push({ testCase: { name: "a shallow clone whose tag is cut away", expect: 1, match: /this clone is shallow and no release tag is reachable/u }, root: shallow });
    const full = join(scratch, "full");
    sh(scratch, ["clone", "--quiet", `file://${origin}`, full]);
    results.push({ testCase: { name: "the same history cloned in full", expect: 0 }, root: full });

    for (const { testCase, root } of results) {
      const run = spawnSync(process.execPath, [SCRIPT, "--check", "--root", root], { encoding: "utf8" });
      const output = `${run.stdout}${run.stderr}`;
      assert.equal(run.status, testCase.expect, `self-test "${testCase.name}": expected exit ${testCase.expect}, got ${run.status}\n${output}`);
      if (testCase.match) assert.match(output, testCase.match, `self-test "${testCase.name}" failed for the wrong reason:\n${output}`);
    }
    const rejected = results.filter(({ testCase }) => testCase.expect === 1).length;
    process.stdout.write(`changelog contract self-test: ${rejected} states rejected, ${results.length - rejected} accepted\n`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function isMain() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === SCRIPT;
}

if (isMain()) {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--root");
  const root = resolve(rootIndex >= 0 && args[rootIndex + 1] ? args[rootIndex + 1] : process.cwd());
  if (args[0] === "--check") runCheck(root);
  else if (args[0] === "--self-test" && args.length === 1) runSelfTest();
  else {
    process.stderr.write("usage: changelog-contract.mjs --check [--root <dir>] | --self-test\n");
    process.exitCode = 2;
  }
}
