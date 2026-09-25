/**
 * A run whose work stops without an answer ends with exit 3, not with Node's default 0.
 *
 * THE DEFECT. The entry point calls `main()` and exits from its `.then`. If `main()` is waiting on
 * a promise that can never settle — the driver's connection closed underneath it, a handle went
 * away, and nothing is left on the event loop — Node does not wait: an empty event loop ends the
 * process, and with no exit code set that is exit 0. A gate reads exit 0 as a clean document. It
 * was seen once under load (a SIGHUP run at load 19 ended exit 0 with no output) and it is the
 * exact failure this project exists to avoid: silence reported as success.
 *
 * HOW THE SITUATION IS MADE, and why this way. The real CLI source runs in a child process, over a
 * real HTML input, on the real live path. The one thing replaced is the acquisition module
 * (`src/acquire/render-run.ts`), through Node's own module-customisation hooks (`--import` of a
 * `module.register()` loader written into a temporary directory): its `renderDocuments` returns a
 * promise that never settles and holds nothing on the event loop — the shape of a driver that lost
 * its browser. Nothing in `src/` knows about it and no option or variable reaches it; it is the
 * harness, not a product hook. A marker file proves the substitute actually ran, so the case
 * cannot pass by taking some other path.
 *
 * The oracle: exit 3 and one `breaklint:` line on stderr naming the stop, and no report on stdout.
 * Red before the guard: exit 0 with nothing on either stream.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const CLI = fileURLToPath(new URL("../../src/cli/index.ts", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "breaklint-unsettled-run-"));
after(() => rmSync(work, { recursive: true, force: true }));

const marker = join(work, "acquisition-reached");
writeFileSync(
  join(work, "hooks.mjs"),
  `import { writeFileSync } from "node:fs";
export async function load(url, context, nextLoad) {
  if (new URL(url).pathname.endsWith("/src/acquire/render-run.ts")) {
    return {
      format: "module",
      shortCircuit: true,
      source: ${JSON.stringify(
        `import { writeFileSync } from "node:fs";\n` +
          `export function renderDocuments() { writeFileSync(${JSON.stringify(marker)}, "reached"); return new Promise(() => {}); }\n`,
      )},
    };
  }
  return nextLoad(url, context);
}
`,
);
writeFileSync(join(work, "register.mjs"), `import { register } from "node:module";\nregister(${JSON.stringify(pathToFileURL(join(work, "hooks.mjs")).href)});\n`);
// Complication: none needed; the document is never opened, which is the point.
writeFileSync(join(work, "page.html"), "<!doctype html><html><body><p>never measured</p></body></html>");

describe("a run that stops without an answer", () => {
  it("ends with exit 3 and one line on stderr when main() can no longer settle", () => {
    rmSync(marker, { force: true });
    const run = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--import", join(work, "register.mjs"), CLI, "--format", "json", "page.html"],
      { cwd: work, encoding: "utf8" },
    );
    assert.ok(existsSync(marker), `the never-settling acquisition was not reached; stderr: ${run.stderr}`);
    assert.equal(run.status, 3, `exited ${run.status}: an empty event loop must not become a clean exit. stderr: ${JSON.stringify(run.stderr)}`);
    const lines = run.stderr.split("\n").filter((line) => line.startsWith("breaklint:"));
    assert.equal(lines.length, 1, `expected exactly one breaklint line on stderr, got: ${JSON.stringify(run.stderr)}`);
    assert.match(lines[0]!, /stopped before it finished.*exit 3/u);
    assert.equal(run.stdout, "", "no report may be printed for a run that never finished");
  });
});
