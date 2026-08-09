/**
 * What `openRasterizer` owns, and whether it gives it back.
 *
 * The rasteriser is served from a loopback HTTP server that starts BEFORE the browser page it
 * serves. Every failure between those two points has to shut the server down again, and an audit
 * found that only one of four such paths did: two failed starts left two listening handles and
 * the process was still alive twelve seconds after the script had ended. A listening socket keeps
 * the event loop open, so the symptom is a CLI that finishes its work and then simply does not
 * exit.
 *
 * The oracle is that symptom, not a resource counter. `process.getActiveResourcesInfo()` was
 * tried first and rejected on measurement: it still lists a server after `close()` has run, so it
 * cannot tell a released socket from a held one. A child process either ends or it does not.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { pdfjsVersionIntegrity } from "../../src/render/rasterizer.ts";

const PROBE = fileURLToPath(new URL("../tools/leak-probe.ts", import.meta.url));

interface ProbeResult {
  exited: boolean;
  code: number | null;
  stdout: string;
}

function runProbe(failAt: string, timeoutMs = 8000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", PROBE, failAt], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ exited: false, code: null, stdout });
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ exited: true, code, stdout });
    });
  });
}

describe("openRasterizer, resource ownership", () => {
  it("rejects an equally declared and loaded but unsupported pdfjs build", () => {
    const result = pdfjsVersionIntegrity("6.2.109", "6.2.109");
    assert.equal(result.ok, false);
    assert.match(result.detail, /supported=6\.2\.108/u);
    assert.equal(pdfjsVersionIntegrity("6.2.108", "6.2.108").ok, true);
  });
  for (const failAt of ["newPage", "goto", "evaluate"] as const) {
    it(`the process still ends when ${failAt}() throws`, async () => {
      const r = await runProbe(failAt);
      assert.match(r.stdout, /refused/u, "the failure did not come back as a refusal");
      assert.equal(r.exited, true, "the process did not end — a listening socket was left behind");
      assert.equal(r.code, 0);
    });
  }

  it("refuses a loaded pdfjs version that differs from its own manifest and releases ownership", async () => {
    const r = await runProbe("version-mismatch");
    assert.match(r.stdout, /refused/u);
    assert.equal(r.exited, true, "the mismatch refusal leaked its rasterizer page/server");
    assert.equal(r.code, 0);
  });

  it("the process ends on the success path once the rasteriser is closed", async () => {
    const r = await runProbe("never");
    assert.match(r.stdout, /opened/u);
    assert.equal(r.exited, true, "close() did not release the loopback server");
  });

  it("the probe can detect a leak at all", async () => {
    // The positive control, and the reason the four cases above mean something. A test that only
    // ever watches processes exit cannot tell "released correctly" from "never started".
    const r = await runProbe("leak", 4000);
    assert.match(r.stdout, /leaking/u);
    assert.equal(r.exited, false, "a process holding a listening socket exited — the oracle is blind");
  });
});
