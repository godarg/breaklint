/**
 * The tool as a stranger runs it: through a symlink.
 *
 * `npm install` does not copy a `bin`, it links it. `node_modules/.bin/breaklint` is a symlink
 * into `node_modules/breaklint/dist/cli/index.js`, so node receives the LINK path in
 * `process.argv[1]` while the module reports the path of the real file in `import.meta.url`.
 *
 * The entry guard compared those two with `path.resolve`, which normalises a string and never
 * asks the filesystem. Every installed copy of this tool therefore did nothing: no output, no
 * findings, and exit 0 — which a CI gate reads as a clean document. `npx breaklint --demo`, the
 * one command the README puts in front of a new reader, printed nothing.
 *
 * Nothing caught it, and the reason is worth stating rather than fixing quietly: every gate ran
 * the tool by its own source path. CI ran `node src/cli/index.ts --demo`, the exit matrix drives
 * `main()` in-process, and `npm pack` only checks what is IN the tarball, never what happens when
 * it is installed. The MECHANISM under test here — one file reached under two names — is the one
 * every installed copy runs into, and no gate had exercised it.
 *
 * The symlink is made in a temp directory rather than in the repository: a link committed here
 * would encode an absolute path from the machine that made it.
 *
 * WHAT THIS FILE DOES NOT COVER, stated because an audit found the claim overstated once already:
 * it links the SOURCE and runs it with `--experimental-strip-types`. A user runs the BUILT
 * `dist/cli/index.js` with plain node. The mechanism is identical — one file, two names — but the
 * artefact is not. The artefact is covered by the "the BUILT package runs from a clean install"
 * step in `.github/workflows/ci.yml`, which packs, installs into a foreign directory and runs
 * `npx breaklint`. Both are needed: this one fails fast on every `npm test`, that one is the only
 * check that sees what is actually shipped.
 */

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../../src/cli/index.ts", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "breaklint-bin-"));
const link = join(dir, "breaklint-link.ts");
symlinkSync(CLI, link);

after(() => rmSync(dir, { recursive: true, force: true }));

/** Runs the CLI through the symlink and returns what a shell would see. */
function runViaLink(args: readonly string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, ["--experimental-strip-types", link, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    const e = error as { status: number | null; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("the CLI runs when it is invoked through a symlink, as npm installs it", () => {
  it("--version prints the version instead of exiting silently", () => {
    const run = runViaLink(["--version"]);
    assert.equal(run.code, 0, `exit ${run.code}; stderr: ${run.stderr}`);
    assert.match(
      run.stdout.trim(),
      /^\d+\.\d+\.\d+$/u,
      "invoked through a symlink the CLI produced no version — the entry guard did not fire",
    );
  });

  it("--demo runs the real chain and ends with exit 1, not a silent 0", () => {
    const run = runViaLink(["--demo"]);
    assert.equal(
      run.code,
      1,
      `--demo through a symlink exited ${run.code}; a silent 0 here is a checker reporting ` +
        `its own idleness as a clean document. stderr: ${run.stderr}`,
    );
    assert.match(run.stdout, /layout\/unbreakable-block-too-tall/u, "no findings were printed");
    assert.match(run.stdout, /uncalibrated/u, "the calibration state is missing from the output");
  });

  it("an unknown option through a symlink still ends with the usage code", () => {
    // Exit 2 rather than a silent 0 proves the guard fires on the failure paths too, not only
    // where a success would have been indistinguishable from doing nothing.
    const run = runViaLink(["--no-such-option"]);
    assert.equal(run.code, 2, `expected exit 2 for an unknown option, got ${run.code}`);
  });
});
