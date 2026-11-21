import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { renderHtml } from "../../src/report/html.ts";
import { findingsReportState, infrastructureReportState, insufficientCoverageReportState } from "../fixtures/report-states.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(REPO, "src/cli/index.ts");

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, ["--experimental-strip-types", CLI, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
  });
}

describe("Paket 3: CLI subcommands (compare, context, bundle)", () => {
  it("runs compare, context, and bundle end-to-end across the real CLI process boundary", () => {
    const dir = mkdtempSync(join(tmpdir(), "breaklint-cli-subcmd-"));
    try {
      const before = findingsReportState();
      const after = findingsReportState();
      after.runId = "after-run-id-2222";
      const beforePath = join(dir, "before.json");
      const afterPath = join(dir, "after.json");
      const cmpPath = join(dir, "cmp.json");
      const ctxPath = join(dir, "ctx.json");
      const bundleDir = join(dir, "bundle-out");
      writeFileSync(beforePath, JSON.stringify(before));
      writeFileSync(afterPath, JSON.stringify(after));

      // 1. compare
      const cmp = runCli(["compare", beforePath, afterPath, "--out", cmpPath], dir);
      assert.equal(cmp.status, 0, `${cmp.stdout}${cmp.stderr}`);
      const parsedCmp = JSON.parse(readFileSync(cmpPath, "utf8")) as { beforeRunId: string; afterRunId: string; results: unknown[] };
      assert.equal(parsedCmp.beforeRunId, before.runId);
      assert.equal(parsedCmp.afterRunId, after.runId);
      assert.ok(parsedCmp.results.length > 0);

      // 2. context (with --comparison and --max-findings)
      const ctx = runCli(["context", afterPath, "--comparison", cmpPath, "--max-findings", "3", "--out", ctxPath], dir);
      assert.equal(ctx.status, 0, `${ctx.stdout}${ctx.stderr}`);
      const parsedCtx = JSON.parse(readFileSync(ctxPath, "utf8")) as { schemaVersion: number; findings: unknown[]; comparison?: { afterRunId: string } };
      assert.equal(parsedCtx.schemaVersion, 2);
      assert.equal(parsedCtx.findings.length, 3);
      assert.equal(parsedCtx.comparison?.afterRunId, after.runId);

      // 3. bundle (with --title, --theme dark, --comparison)
      const bnd = runCli(["bundle", afterPath, "--out-dir", bundleDir, "--title", "CLI Bundle", "--theme", "dark", "--comparison", cmpPath], dir);
      assert.equal(bnd.status, 0, `${bnd.stdout}${bnd.stderr}`);
      assert.equal(existsSync(join(bundleDir, "report.html")), true);
      assert.equal(existsSync(join(bundleDir, "context.json")), true);
      assert.equal(existsSync(join(bundleDir, "bundle.json")), true);
      assert.equal(existsSync(join(bundleDir, "comparison.json")), true);
      assert.ok(readFileSync(join(bundleDir, "report.html"), "utf8").includes('data-theme="dark"'));

      // 4. Help & fail-closed usage errors (exit 2)
      for (const sub of ["compare", "context", "bundle"]) {
        assert.equal(runCli([sub, "--help"], dir).status, 0);
        assert.equal(runCli([sub, "--unknown-flag"], dir).status, 2);
      }
      assert.equal(runCli(["compare", beforePath], dir).status, 2);
      assert.equal(runCli(["context", join(dir, "missing.json")], dir).status, 2);
      assert.equal(runCli(["bundle", afterPath], dir).status, 2);
      assert.equal(runCli(["bundle", afterPath, "--out-dir", bundleDir, "--theme", "sepia"], dir).status, 2);
      // Flag tokens cannot be consumed as missing path or title values.
      assert.equal(runCli(["compare", beforePath, afterPath, "--out", "--unknown"], dir).status, 2);
      assert.equal(runCli(["context", afterPath, "--out", "--comparison", cmpPath], dir).status, 2);
      assert.equal(runCli(["bundle", afterPath, "--out-dir", "--theme", "dark"], dir).status, 2);
      assert.equal(runCli(["bundle", afterPath, "--out-dir", bundleDir, "--evidence-dir", "--title", "x"], dir).status, 2);
      assert.equal(runCli(["bundle", afterPath, "--out-dir", bundleDir, "--title", "--bogus"], dir).status, 2);

      // Malformed --comparison JSON must fail closed with exit 2.
      const badCmpPath = join(dir, "bad-cmp.json");
      writeFileSync(badCmpPath, JSON.stringify({ afterRunId: after.runId }));
      assert.equal(runCli(["context", afterPath, "--comparison", badCmpPath], dir).status, 2);
      assert.equal(runCli(["bundle", afterPath, "--out-dir", bundleDir, "--comparison", badCmpPath], dir).status, 2);

      // compare on an infrastructure-failed after report must not exit 0 (Opus audit).
      const failedAfterPath = join(dir, "failed-after.json");
      writeFileSync(failedAfterPath, JSON.stringify(infrastructureReportState()));
      assert.equal(runCli(["compare", beforePath, failedAfterPath], dir).status, 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Paket 3: Round-8 report surface follow-ups (G-148..G-151)", () => {
  it("adds explicit decline units, zero-candidate labels, base categories, state-qualified gates, and print disclosure hiding", () => {
    const findingsHtml = renderHtml(findingsReportState());
    assert.match(findingsHtml, /\bdeclines?\b/u);
    assert.match(findingsHtml, /No candidates/u);
    assert.match(findingsHtml, /class="decline-base"/u);
    assert.match(findingsHtml, /in coverage base/u);
    assert.match(findingsHtml, /\.finding-navigation \{ display: none; \}/u);

    const infraHtml = renderHtml(infrastructureReportState());
    assert.match(infraHtml, /none \(finding gate\)/u);
    assert.match(infraHtml, /Document verdict: infrastructure \(partial run\)/u);

    const covHtml = renderHtml(insufficientCoverageReportState());
    assert.match(covHtml, /none \(finding gate\)/u);
  });
});
