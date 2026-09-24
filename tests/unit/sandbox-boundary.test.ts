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
import ts from "typescript";

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

/**
 * The options a launch may pass, each with why it cannot touch the sandbox. `args` is the one
 * through which a sandbox switch would travel, so it must be the literal `[]`; `ignoreDefaultArgs`
 * is not on the list at all, because it can drop the driver's own sandbox-preserving defaults.
 */
const ALLOWED_LAUNCH_OPTIONS: Record<string, string> = {
  executablePath: "which binary starts; the sandbox is a property of the switches, not the path",
  headless: "the display mode; Chrome keeps its sandbox headless",
  userDataDir: "the fresh per-run profile directory",
  args: "extra switches — pinned to the literal []",
  detached: "whether the child gets its own process group, for cleanup",
  protocolTimeout: "how long one DevTools call may take",
  pipe: "the control transport: pipes instead of a loopback DevTools port",
  handleSIGINT: "whether the driver installs its own SIGINT handler; process management only",
  handleSIGTERM: "whether the driver installs its own SIGTERM handler; process management only",
  handleSIGHUP: "whether the driver installs its own SIGHUP handler; process management only",
  timeout: "how long the driver waits for the browser to start",
  signal: "an AbortSignal that cancels the launch",
};

/**
 * Every `launch(…)` call in a TypeScript source, read with the compiler's own parser rather than
 * line by line: a spread or a second `args` on one line is a property like any other here.
 */
function launchOptionIssues(source: string, fileName: string): { calls: number; issues: string[] } {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const issues: string[] = [];
  let calls = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
      if (name === "launch") {
        calls += 1;
        const options = node.arguments[0];
        if (node.arguments.length !== 1 || !options || !ts.isObjectLiteralExpression(options)) {
          issues.push(`${fileName}: the launch options are not an object literal`);
        } else {
          const seen = new Set<string>();
          for (const property of options.properties) {
            if (ts.isSpreadAssignment(property)) { issues.push(`${fileName}: the launch spreads options from elsewhere`); continue; }
            if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
              issues.push(`${fileName}: the launch options carry a ${ts.SyntaxKind[property.kind]}`);
              continue;
            }
            if (ts.isComputedPropertyName(property.name)) { issues.push(`${fileName}: the launch options use a computed key`); continue; }
            const key = property.name.getText(file).replace(/^["']|["']$/gu, "");
            if (seen.has(key)) issues.push(`${fileName}: the launch options names ${key} twice`);
            seen.add(key);
            if (!(key in ALLOWED_LAUNCH_OPTIONS)) { issues.push(`${fileName}: ${key} is not an allowed launch option`); continue; }
            const value = ts.isPropertyAssignment(property) ? property.initializer : null;
            if (key === "args" && !(value && ts.isArrayLiteralExpression(value) && value.elements.length === 0)) {
              issues.push(`${fileName}: args must be the literal [] — it is ${value ? value.getText(file) : "a shorthand"}`);
            }
            if (key === "pipe" && value?.kind !== ts.SyntaxKind.TrueKeyword) issues.push(`${fileName}: pipe must be the literal true`);
            if (/^handleSIG/u.test(key) && value?.kind !== ts.SyntaxKind.FalseKeyword && value?.kind !== ts.SyntaxKind.TrueKeyword) {
              issues.push(`${fileName}: ${key} must be a boolean literal`);
            }
          }
          if (!seen.has("args")) issues.push(`${fileName}: the launch does not pin args: []`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { calls, issues };
}

describe("the browser sandbox", () => {
  it("the one browser launch passes no switch and keeps Puppeteer's defaults", () => {
    const sites = filesUnder("src").filter((file) => file.endsWith(".ts")).flatMap((file) => {
      const result = launchOptionIssues(readFileSync(file, "utf8"), file);
      return Array.from({ length: result.calls }, () => ({ file: relative(ROOT, file), issues: result.issues }));
    });
    assert.deepEqual(
      sites.map((site) => site.file),
      ["src/acquire/browser.ts"],
      "a browser is launched somewhere other than src/acquire/browser.ts; that path needs the same pin",
    );
    assert.deepEqual(sites[0]!.issues, [], "the one browser launch does not keep the sandbox's options shape");
  });

  it("accepts the launch shape of the lifecycle change, and refuses every way around the pin", () => {
    // The options another change of this release passes (its src/acquire/browser.ts), verbatim.
    const lifecycle = `browser = await launch({
      executablePath,
      headless: true,
      userDataDir,
      args: [],
      detached: process.platform !== "win32",
      pipe: true,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      timeout: boundMs,
      signal: abort.signal,
      protocolTimeout: 300_000,
    });`;
    assert.deepEqual(launchOptionIssues(lifecycle, "lifecycle.ts"), { calls: 1, issues: [] });
    const refused: [string, RegExp][] = [
      ["protocolTimeout: 300_000, ...extraLaunchOptions,", /spreads options/u],
      ['args: [], args: ["--no-sandbox"],', /names args twice/u],
      ["[key]: value,", /computed key/u],
      ["args: flags,", /args must be the literal \[\]/u],
      ['args: ["--no-sandbox"],', /args must be the literal \[\]/u],
      ["ignoreDefaultArgs: true,", /ignoreDefaultArgs is not an allowed launch option/u],
      ["pipe: usePipe,", /pipe must be the literal true/u],
    ];
    for (const [entry, message] of refused) {
      const result = launchOptionIssues(`launch({ headless: true, ${entry} });`, "mutant.ts");
      assert.ok(result.issues.some((issue) => message.test(issue)), `"${entry}" was not refused: ${result.issues.join("; ")}`);
    }
    assert.match(launchOptionIssues("launch(options);", "mutant.ts").issues.join(), /not an object literal/u);
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
