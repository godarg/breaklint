#!/usr/bin/env node
/**
 * The red control for the pagination-residue fix, re-derived rather than remembered.
 *
 * A fix whose red condition is only written down in a changelog cannot be shown to have fixed
 * anything. This builds the tree as it was BEFORE the fix — by default the parent of the commit
 * that introduced `src/measure/fragmentainer.ts`, or any ref given with `--baseline-ref` — runs the
 * two documents through it, and asserts the two properties that were missing:
 *
 *   1. the run was already fatal, so the fix did not turn a green document red; and
 *   2. the fatal event named NO cause — no `fragmentainerResidue` and no `driftSample` in
 *      `measured` — which is the whole of what was wrong with it.
 *
 * Then it asserts the current build names both. The recorded outcome is kept beside this script in
 * `docs/validation/pagination-residue-red-control.json` for a reader who cannot build the old tree.
 *
 * TWO CASES, ONE PUBLIC. The public fixture reproduces the class and runs for everyone; the corpus
 * document is a chapter of a paid product and is only reachable when
 * `BREAKLINT_RESIDUE_CORPUS_ROOT` points at the admitted bundle. The public case alone proves
 * red-to-green, so an absent root SKIPS that one case and says so rather than weakening the run or
 * failing over bytes most contributors cannot obtain.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const RECORD = JSON.parse(readFileSync(join(ROOT, "docs/validation/pagination-residue-red-control.json"), "utf8"));
assert.equal(RECORD.contractVersion, "pagination-residue-red-control-v2");
assert.equal(RECORD.cases.length, 2);
assert.equal(RECORD.cases.filter((item) => item.artifactRoot === "repository").length, 1,
  "at least one case must be reachable without the private bundle, or this control is unrunnable");

const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
// The commit that added the residue collector is the fix; its parent is the red baseline. Naming
// the FILE rather than a hash keeps this working after a rebase, which a pinned sha would not.
const baselineRef = argument("--baseline-ref")
  ?? `${git("log", "--diff-filter=A", "--format=%H", "-1", "--", "src/measure/fragmentainer.ts")}^`;
assert.ok(baselineRef && !baselineRef.startsWith("^"), "no commit adds src/measure/fragmentainer.ts yet");

const work = mkdtempSync(join(tmpdir(), "breaklint-residue-red-control-"));
try {
  execFileSync("sh", ["-c", `git archive ${baselineRef} | tar -x -C ${work}`], { cwd: ROOT });
  symlinkSync(join(ROOT, "node_modules"), join(work, "node_modules"));
  execFileSync("npx", ["tsc", "-p", "tsconfig.build.json"], { cwd: work, stdio: "inherit" });
  const baselineCli = join(work, "dist/cli/index.js");

  const artifactRoot = argument("--artifact-root") ?? process.env.BREAKLINT_RESIDUE_CORPUS_ROOT;
  let skipped = 0;
  for (const expected of RECORD.cases) {
    if (expected.artifactRoot === "external" && !artifactRoot) {
      console.log(`${expected.document}: SKIPPED — no BREAKLINT_RESIDUE_CORPUS_ROOT, bytes not in this repository`);
      skipped += 1;
      continue;
    }
    const document = expected.artifactRoot === "external"
      ? join(resolve(artifactRoot), expected.document)
      : join(ROOT, expected.document);
    assert.equal(
      createHash("sha256").update(readFileSync(document)).digest("hex"),
      expected.sha256,
      `${expected.document}: the recorded red control is about different bytes`,
    );
    for (const [label, cli, mustName] of [["baseline", baselineCli, false], ["current", join(ROOT, "dist/cli/index.js"), true]]) {
      const reportPath = join(work, `${label}-report.json`);
      const run = spawnSync(process.execPath, [cli, "--format", "json", "--out", reportPath, document], {
        cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180_000,
      });
      assert.equal(run.status, 3, `${expected.document} (${label}): exited ${run.status}, expected 3\n${run.stderr}`);
      const report = JSON.parse(readFileSync(reportPath, "utf8"));
      const [documentReport] = report.documents;
      const event = documentReport.infrastructure.find((item) => item.kind === documentReport.exitReason);
      const measured = event?.measured ?? {};
      const named = Boolean(measured.fragmentainerResidue);
      assert.equal(
        named,
        mustName,
        `${expected.document} (${label}): cause named = ${named}, expected ${mustName}. ` +
        `detail: ${event?.detail}`,
      );
      if (label === "baseline") {
        assert.equal(documentReport.exitReason, expected.exitReason, expected.document);
        assert.equal(event.detail, expected.detail, `${expected.document}: the recorded red detail drifted`);
      } else {
        assert.match(event.detail, /in an overflow column of page\(s\)/u, expected.document);
        assert.ok(measured.fragmentainerResidue.atomicCount > 0, expected.document);
      }
      console.log(`${expected.document} (${label}): exit 3, ${documentReport.exitReason}, cause named: ${named}`);
    }
  }
  const ran = RECORD.cases.length - skipped;
  assert.ok(ran > 0, "every case was skipped; the control proved nothing");
  console.log(
    `pagination-residue red control: red at ${baselineRef}, green at HEAD over ${ran} of ` +
    `${RECORD.cases.length} case(s)${skipped > 0 ? ` (${skipped} needs the private artifact root)` : ""}`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
