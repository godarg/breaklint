import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const LAB = fileURLToPath(new URL("../tools/calibration/svg-validation-lab.ts", import.meta.url));

describe("M3-0 SVG Validation Lab process contract", () => {
  it("writes the same passing machine report it emits and exits zero", () => {
    const directory = mkdtempSync(join(tmpdir(), "breaklint-m3-lab-"));
    try {
      const output = join(directory, "lab-report.json");
      const run = spawnSync(process.execPath, ["--experimental-strip-types", LAB, "--output", output], {
        encoding: "utf8",
        timeout: 60_000,
      });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.signal, null);
      const stdout = JSON.parse(run.stdout) as { status: string; checks: unknown[] };
      const file = JSON.parse(readFileSync(output, "utf8")) as { status: string; checks: unknown[] };
      assert.deepEqual(file, stdout);
      assert.equal(file.status, "pass");
      assert.ok(file.checks.length > 0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
