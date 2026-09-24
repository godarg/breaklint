/**
 * The browser sandbox stays on, and this is the test SECURITY.md points at.
 *
 * SECURITY.md said the sandbox claim was "checked in the test suite rather than merely intended".
 * No test checked it. This one does, in the two ways a change could break it:
 *
 *   1. the one browser launch in `src/acquire/browser.ts` passes no switch (`args: []`) and does
 *      not drop Puppeteer's defaults — a switch added there reaches every live run;
 *   2. no source, tool, test or workflow file names a sandbox-disabling switch at all, so a second
 *      launch path, a helper script or a CI step cannot quietly carry one either.
 *
 * It reads the real files. It is static on purpose: a unit test must not need Chrome, and the
 * question "does any code path ask for the sandbox to be off" is a question about the code.
 */

import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const SCANNED = ["src", "tools", "tests", ".github/workflows", "package.json"];
const TEXT = /\.(ts|mts|cts|mjs|cjs|js|json|ya?ml|html?|sh|py|css|svg|md)$/u;
/** Switches that turn off (part of) Chrome's sandbox, and the two driver options that can. */
const SANDBOX_OFF = [
  /--no-sandbox\b/u,
  /--disable-setuid-sandbox\b/u,
  /--disable-namespace-sandbox\b/u,
  /--disable-seccomp-filter-sandbox\b/u,
  /--no-zygote-sandbox\b/u,
  /--disable-gpu-sandbox\b/u,
  /\bignoreDefaultArgs\b/u,
  /\bchromiumSandbox\b/u,
];

function filesUnder(path: string): string[] {
  const absolute = join(ROOT, path);
  if (statSync(absolute).isFile()) return [absolute];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === ".tmp" || entry.name === "dist") return [];
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesUnder(child) : TEXT.test(entry.name) ? [join(ROOT, child)] : [];
  });
}

describe("the browser sandbox", () => {
  it("the one browser launch passes no switch and keeps Puppeteer's defaults", () => {
    const launchSites = filesUnder("src").flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return [...text.matchAll(/\blaunch\(\{/gu)].map((match) => ({ file, text, index: match.index }));
    });
    assert.deepEqual(
      launchSites.map((site) => relative(ROOT, site.file)),
      ["src/acquire/browser.ts"],
      "a browser is launched somewhere other than src/acquire/browser.ts; that path needs the same pin",
    );
    const [site] = launchSites;
    const end = site!.text.indexOf("});", site!.index);
    assert.ok(end > site!.index, "the launch call has no closing brace");
    const call = site!.text.slice(site!.index, end);
    // The options object must stay a flat literal, one `key: value,` or `key,` per line, of keys
    // known not to touch the sandbox. A spread, a computed key or a key outside the list could carry
    // `args` or `ignoreDefaultArgs` in from elsewhere, where nothing here would read it.
    const entries = call.slice("launch({".length).split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("//"));
    const keys: Record<string, string> = {};
    for (const line of entries) {
      const entry = /^([A-Za-z_$][\w$]*)(?:\s*:\s*(.+?))?,$/u.exec(line);
      assert.ok(entry, `the launch options are no longer a flat literal of named keys: "${line}"\n${call}`);
      assert.ok(!(entry[1]! in keys), `the launch options name ${entry[1]} twice`);
      keys[entry[1]!] = entry[2] ?? entry[1]!;
    }
    const ALLOWED = ["executablePath", "headless", "userDataDir", "args", "detached", "protocolTimeout", "pipe"];
    assert.deepEqual(Object.keys(keys).filter((key) => !ALLOWED.includes(key)), [], `the launch passes an option outside ${ALLOWED.join(", ")}:\n${call}`);
    assert.equal(keys.args, "[]", `the launch passes switches:\n${call}`);
    if ("pipe" in keys) assert.equal(keys.pipe, "true", "the pipe transport option must be the literal true");
  });

  it("no source, tool, test or workflow names a sandbox-disabling switch", () => {
    const offending: string[] = [];
    let scanned = 0;
    for (const file of SCANNED.flatMap(filesUnder)) {
      if (file === SELF) continue;
      scanned += 1;
      for (const [index, line] of readFileSync(file, "utf8").split("\n").entries()) {
        if (SANDBOX_OFF.some((pattern) => pattern.test(line))) offending.push(`${relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
      }
    }
    assert.ok(scanned > 200, `the scan read only ${scanned} files; it has lost its subject`);
    assert.deepEqual(offending, [], "a sandbox-disabling switch is named in the repository");
  });
});
