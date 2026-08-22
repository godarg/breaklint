import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ROOT = new URL("../..", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

function audit(args) {
  const result = spawnSync("npm", ["audit", ...args, "--json"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.ok(result.stdout, `npm audit produced no JSON: ${result.stderr}`);
  return { status: result.status, report: JSON.parse(result.stdout) };
}

// Both graphs are release boundaries. A development-only browser downloader still runs in CI and
// release preparation, so calling its advisory "not shipped" would not make that execution safe.
const runtime = audit(["--omit=dev"]);
assert.equal(runtime.status, 0, "the published runtime dependency graph has an advisory");
assert.equal(runtime.report.metadata.vulnerabilities.total, 0);

const full = audit([]);
assert.equal(full.status, 0, "the complete development dependency graph has an advisory");
assert.equal(full.report.metadata.vulnerabilities.total, 0);
assert.match(manifest.devDependencies["puppeteer-core"], /^\^25\.8\./u);
assert.equal(manifest.peerDependencies["puppeteer-core"], ">=25.8.0 <26");
assert.equal(manifest.engines.node, ">=22.13.0");

process.stdout.write(
  "dependencies: published runtime and complete development graph have 0 advisories; Node >=22.13 and Puppeteer 25 contract pinned\n",
);
