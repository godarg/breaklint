import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

import { err, out } from "../../src/cli/out.ts";

/**
 * Nothing writes to a terminal except the one file that redacts.
 *
 * This test exists because a judgement was wrong three times in a row. The path redaction was
 * repaired in round 8 (it missed JSON escaping), repaired again in round 9 (it missed XML
 * escaping, markdown's pipe escape and newline flattening), moved onto the report object, and was
 * STILL open in round 10 — because three CLI messages never went through a reporter at all. Each
 * repair closed the instance in front of it and each was followed by "the class is closed now".
 *
 * A fourth statement of that kind would be worth nothing. So the property is checked instead of
 * asserted: any write to stdout or stderr anywhere in `src/`, outside `src/cli/out.ts`, fails
 * here. Adding a route without noticing is no longer possible; it requires editing this list.
 *
 * Red condition: put a `process.stderr.write` anywhere in `src/` and this test names the file and
 * the line.
 */

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
/** The one file allowed to write. It is the file that redacts. */
const CHOKE_POINT = "cli/out.ts";

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (entry.endsWith(".ts")) found.push(full);
  }
  return found;
}

describe("output routes", () => {
  it("only src/cli/out.ts writes to stdout or stderr", () => {
    const offenders: string[] = [];
    const files = sourceFiles(SRC);
    // A scan that found no files would pass vacuously, which is the failure shape this whole
    // project is about. The count is asserted before the scan is believed.
    assert.ok(files.length > 20, `only ${files.length} source files scanned — the walk is broken`);

    for (const file of files) {
      const rel = relative(SRC, file).replaceAll("\\", "/");
      if (rel === CHOKE_POINT) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        // Comments and doc blocks legitimately quote these names — this file's own header does.
        const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/u, "");
        if (/process\.(stdout|stderr)\.write|console\.(log|error|warn|info|debug)/u.test(code)) {
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    assert.deepEqual(
      offenders,
      [],
      `these write to a terminal without passing the redaction in src/${CHOKE_POINT}:\n${offenders.join("\n")}`,
    );
  });

  it("the choke point actually redacts, in both directions", () => {
    const account = "zqjvax0042";
    const realHome = process.env.HOME;
    const written: string[] = [];
    const stdout = process.stdout.write.bind(process.stdout);
    const stderr = process.stderr.write.bind(process.stderr);
    try {
      process.env.HOME = `/tmp/bl-out-${account}`;
      // Capture rather than print, so the test does not put the token on a terminal itself.
      (process.stdout as { write: unknown }).write = (s: string) => (written.push(s), true);
      (process.stderr as { write: unknown }).write = (s: string) => (written.push(s), true);
      out(`report written to ${process.env.HOME}/out.json\n`);
      err(`no renderer available. looked in: ${process.env.HOME}/.cache/puppeteer/chrome\n`);
    } finally {
      (process.stdout as { write: unknown }).write = stdout;
      (process.stderr as { write: unknown }).write = stderr;
      if (realHome === undefined) delete process.env.HOME;
      else process.env.HOME = realHome;
    }
    assert.equal(written.length, 2, "both writes must reach the stream");
    for (const text of written) {
      assert.ok(!text.includes(account), `a write leaked the account name: ${text}`);
      assert.match(text, /~/u, "the redaction marker is absent — did the payload reach it at all?");
    }
  });
});
