/**
 * The browser sandbox stays on, and this is the test SECURITY.md points at.
 *
 * SECURITY.md said the sandbox claim was "checked in the test suite rather than merely intended".
 * No test checked it. This one does, in the two ways a change could break it:
 *
 *   1. the one browser launch in `src/acquire/browser.ts` passes only allow-listed switches, none
 *      of which touches the sandbox, and does not drop Puppeteer's defaults — a switch added
 *      there reaches every live run;
 *   2. no source, tool, test or workflow file names a sandbox-disabling switch at all, so a second
 *      launch path, a helper script or a CI step cannot quietly carry one either.
 *
 * It reads the real files. It is static on purpose: a unit test must not need Chrome, and the
 * question "does any code path ask for the sandbox to be off" is a question about the code. One
 * question is not only about the code: puppeteer-core adds the sandbox-disabling switch itself when
 * PUPPETEER_DANGEROUS_NO_SANDBOX is set in the environment. That is checked twice — statically,
 * that the launch path refuses before it launches, and at runtime, through the real CLI and a fake
 * browser executable that records the switches it was given (no Chrome needed). The browser also
 * reads switches from its own environment (CHROME_EXTRA_FLAGS), so the launch's `env` must be the
 * allow-list builder, and a fake browser that records its environment shows what reaches it.
 *
 * KNOWN LIMITS, accepted: check 1 recognises a call whose callee is the name `launch` or a
 * property access ending in `.launch`. A launch reached any other way — `launch.call(…)`,
 * `launch.apply(…)`, `launch.bind(…)(…)`, an element access such as `puppeteer["launch"](…)`, or
 * an alias (`const start = puppeteer.launch`) — is not read, and its options are not checked.
 * Check 1 also parses only the `.ts` files under `src`; a `.mts` or `.cts` source there is not
 * read. Check 2 does read every text file, `.mts` and `.cts` included, so such a launch still
 * cannot spell out a sandbox-disabling switch, `ignoreDefaultArgs` or `chromiumSandbox` without
 * failing here; only its other options go unchecked.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { BROWSER_ENVIRONMENT_NAMES, browserEnvironment, driverEnvironmentRefusal, REFUSED_DRIVER_ENVIRONMENT } from "../../src/acquire/browser.ts";

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
 * through which a sandbox switch would travel, so it may only combine the named switch lists below
 * (each element read from its declaration) and the unit-only net-log switch; `ignoreDefaultArgs` is
 * not on the list at all, because it can drop the driver's own sandbox-preserving defaults.
 */
const ALLOWED_LAUNCH_OPTIONS: Record<string, string> = {
  executablePath: "which binary starts; the sandbox is a property of the switches, not the path",
  headless: "the display mode; Chrome keeps its sandbox headless",
  userDataDir: "the fresh per-run profile directory",
  args: "extra switches — only spreads of the allow-listed lists below, conditionally, or []",
  env: "the host's own environment with TMPDIR pointed into the profile — exactly { ...process.env, TMPDIR }; " +
    "the driver reads its sandbox variable from process.env, which the launch path refuses (below)",
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
 * Every switch the launch may pass, by name (the part before `=`), with why it cannot touch the
 * sandbox. Each is a network or diagnostics switch; none is a process, zygote or sandbox switch.
 */
const ALLOWED_SWITCHES: Record<string, string> = {
  "--disable-component-update": "stops the component updater's browser-level downloads",
  "--disable-background-networking": "stops background network services",
  "--host-resolver-rules": "maps host names to not-found before DNS; name resolution only",
  "--no-proxy-server": "direct connections only, no proxy forwarding; network only",
  "--log-net-log": "unit-only: the browser's net-log, written into the profile",
};
/** The named switch lists `args` may spread; their elements are read from their declarations. */
const SWITCH_LISTS = ["BROWSER_NETWORK_ARGS"];

function switchName(value: string): string { return value.split("=", 1)[0]!; }

/** The string elements of `export const NAME … = [ … ]` in the file, or null when not a literal list. */
function declaredSwitchList(file: ts.SourceFile, name: string): string[] | null {
  let found: string[] | null = null;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      const init = node.initializer;
      found = ts.isArrayLiteralExpression(init) && init.elements.every((element) => ts.isStringLiteral(element))
        ? init.elements.map((element) => (element as ts.StringLiteral).text)
        : null;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Why an `args` value is not an allowed combination; empty when it is. */
function argsIssues(value: ts.Expression, file: ts.SourceFile, fileName: string): string[] {
  if (!ts.isArrayLiteralExpression(value)) return [`${fileName}: args must be an array literal — it is ${value.getText(file)}`];
  const issues: string[] = [];
  const listIssues = (name: string): string[] => {
    if (!SWITCH_LISTS.includes(name)) return [`${fileName}: args spreads ${name}, which is not an allow-listed switch list`];
    const switches = declaredSwitchList(file, name);
    if (switches === null) return [`${fileName}: ${name} is not declared in this file as a literal list of strings`];
    return switches.filter((entry) => !(switchName(entry) in ALLOWED_SWITCHES)).map((entry) => `${fileName}: ${name} carries ${entry}, which is not an allowed switch`);
  };
  const literal = (element: ts.Expression): string[] => {
    const text = ts.isStringLiteral(element) ? element.text
      : ts.isTemplateExpression(element) ? element.head.text
        : ts.isNoSubstitutionTemplateLiteral(element) ? element.text : null;
    if (text === null) return [`${fileName}: args carries a computed switch ${element.getText(file)}`];
    // A template's static head must already name the switch: `--log-net-log=${…}`.
    return switchName(text) in ALLOWED_SWITCHES && (text.includes("=") || !ts.isTemplateExpression(element))
      ? [] : [`${fileName}: args carries ${text}…, which is not an allowed switch`];
  };
  const branch = (node: ts.Expression): string[] => {
    const inner = ts.isParenthesizedExpression(node) ? node.expression : node;
    if (ts.isIdentifier(inner)) return listIssues(inner.text);
    if (ts.isArrayLiteralExpression(inner)) return inner.elements.flatMap((element) => literal(element));
    return [`${fileName}: args carries ${inner.getText(file)}, which is neither a switch list nor a literal`];
  };
  for (const element of value.elements) {
    if (!ts.isSpreadElement(element)) { issues.push(...literal(element)); continue; }
    const spread = ts.isParenthesizedExpression(element.expression) ? element.expression.expression : element.expression;
    if (ts.isConditionalExpression(spread)) issues.push(...branch(spread.whenTrue), ...branch(spread.whenFalse));
    else issues.push(...branch(spread));
  }
  return issues;
}

/**
 * `env` must be exactly `browserEnvironment(process.env, <temporary directory>)`: the allow-list
 * builder, never the host's environment spread or passed through. The browser reads switches from
 * its environment (CHROME_EXTRA_FLAGS), so an inherited variable is a switch nobody allowed.
 */
function envIssues(value: ts.Expression | null, file: ts.SourceFile, fileName: string): string[] {
  const shape = value && ts.isCallExpression(value) && ts.isIdentifier(value.expression) && value.expression.text === "browserEnvironment"
    && value.arguments.length === 2 && value.arguments[0]!.getText(file) === "process.env" && !ts.isSpreadElement(value.arguments[1]!);
  return shape ? [] : [`${fileName}: env must be exactly browserEnvironment(process.env, …) — it is ${value ? value.getText(file) : "a shorthand"}`];
}

/**
 * The function that contains a launch must refuse the driver's sandbox variable first: a call to
 * `driverEnvironmentRefusal()` whose result returns early, positioned before the launch call.
 */
function refusalIssues(launchCall: ts.CallExpression, file: ts.SourceFile, fileName: string): string[] {
  let body: ts.Node | undefined = launchCall.parent;
  while (body && !ts.isFunctionLike(body)) body = body.parent;
  if (!body) return [`${fileName}: the launch is not inside a function`];
  let refusal: ts.CallExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (!refusal && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "driverEnvironmentRefusal") refusal = node;
    ts.forEachChild(node, visit);
  };
  visit(body);
  const found = refusal as ts.CallExpression | null;
  if (!found || found.getStart(file) > launchCall.getStart(file)) {
    return [`${fileName}: the launch path does not refuse the driver's environment switches before it launches`];
  }
  return [];
}

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
            if (key === "args") {
              if (!value) issues.push(`${fileName}: args must be an array literal — it is a shorthand`);
              else issues.push(...argsIssues(value, file, fileName));
            }
            if (key === "env") issues.push(...envIssues(value, file, fileName));
            if (key === "pipe" && value?.kind !== ts.SyntaxKind.TrueKeyword) issues.push(`${fileName}: pipe must be the literal true`);
            if (/^handleSIG/u.test(key) && value?.kind !== ts.SyntaxKind.FalseKeyword && value?.kind !== ts.SyntaxKind.TrueKeyword) {
              issues.push(`${fileName}: ${key} must be a boolean literal`);
            }
          }
          if (!seen.has("args")) issues.push(`${fileName}: the launch does not pin args`);
          issues.push(...refusalIssues(node, file, fileName));
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
    // The shape src/acquire/browser.ts has (its lists, its refusal, its launch), reduced.
    const lists = `export const BROWSER_NETWORK_ARGS: readonly string[] = ["--disable-component-update", "--disable-background-networking"];`;
    const launchWith = (options: string, refusal = "const refused = driverEnvironmentRefusal(); if (refused) return refused;") =>
      `${lists}\nasync function start() { ${refusal}\n browser = await launch({ ${options} }); }`;
    const lifecycleOptions = `
      executablePath,
      headless: true,
      userDataDir,
      args: [
        ...BROWSER_NETWORK_ARGS,
        \`--host-resolver-rules=\${hostResolverRules(seams.network === "allowlist" ? seams.allowedOrigins ?? [] : [])}\`,
        "--no-proxy-server",
        ...(seams.netLog ? [\`--log-net-log=\${join(userDataDir, "net-log.json")}\`] : []),
      ],
      env: browserEnvironment(process.env, browserTmp.path),
      detached: process.platform !== "win32",
      pipe: true,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      timeout: boundMs,
      signal: abort.signal,
      protocolTimeout: 300_000,`;
    assert.deepEqual(launchOptionIssues(launchWith(lifecycleOptions), "lifecycle.ts"), { calls: 1, issues: [] });
    const off = ["--no", "sandbox"].join("-"); // built, so this file's own scan below stays clean of it
    const refused: [string, RegExp, string?][] = [
      ["protocolTimeout: 300_000, ...extraLaunchOptions, args: [],", /spreads options/u],
      [`args: [], args: ["${off}"],`, /names args twice/u],
      ["[key]: value, args: [],", /computed key/u],
      ["args: flags,", /args must be an array literal/u],
      [`args: ["${off}"],`, /not an allowed switch/u],
      ["args: [...EXTRA_ARGS],", /not an allow-listed switch list/u],
      ["args: [...(cond ? [] : moreArgs)],", /not an allow-listed switch list/u],
      ["args: [`${flag}`],", /not an allowed switch/u],
      ["args: [], env: { ...process.env, TMPDIR: t, PUPPETEER_DANGEROUS_NO_SANDBOX: 'true' },", /env must be exactly/u],
      ["args: [], env: { ...process.env, TMPDIR: t },", /env must be exactly/u],
      ["args: [], env: { ...browserEnvironment(process.env, t), CHROME_EXTRA_FLAGS: f },", /env must be exactly/u],
      ["args: [], env: browserEnvironment({ ...process.env }, t),", /env must be exactly/u],
      ["args: [], env: process.env,", /env must be exactly/u],
      ["args: [], env: hostEnv,", /env must be exactly/u],
      ["args: [], ignoreDefaultArgs: true,", /ignoreDefaultArgs is not an allowed launch option/u],
      ["args: [], pipe: usePipe,", /pipe must be the literal true/u],
      ["args: [],", /does not refuse the driver's environment switches/u, ""],
    ];
    for (const [entry, message, refusal] of refused) {
      const result = launchOptionIssues(launchWith(`headless: true, ${entry}`, refusal), "mutant.ts");
      assert.ok(result.issues.some((issue) => message.test(issue)), `"${entry}" was not refused: ${result.issues.join("; ")}`);
    }
    // A refusal that runs only after the launch, or in another function, does not count.
    for (const source of [
      `${lists}\nasync function start() { browser = await launch({ headless: true, args: [] }); driverEnvironmentRefusal(); }`,
      `${lists}\nfunction check() { driverEnvironmentRefusal(); }\nasync function start() { browser = await launch({ headless: true, args: [] }); }`,
    ]) {
      assert.match(launchOptionIssues(source, "mutant.ts").issues.join(), /does not refuse the driver's environment switches/u);
    }
    // A list that is allow-listed by name but carries a sandbox switch is refused by its content.
    const poisoned = launchWith("args: [...BROWSER_NETWORK_ARGS],").replace('"--disable-component-update"', `"${off}"`);
    assert.match(launchOptionIssues(poisoned, "mutant.ts").issues.join(), /BROWSER_NETWORK_ARGS carries .*not an allowed switch/u);
    assert.match(launchOptionIssues("launch(options);", "mutant.ts").issues.join(), /not an object literal/u);
  });

  it("the launch path refuses the driver's sandbox variable, whatever its value", () => {
    assert.ok("PUPPETEER_DANGEROUS_NO_SANDBOX" in REFUSED_DRIVER_ENVIRONMENT, "the driver's sandbox variable is not on the refused list");
    for (const value of ["true", "false", "", "1"]) {
      assert.match(driverEnvironmentRefusal({ PUPPETEER_DANGEROUS_NO_SANDBOX: value }) ?? "", /PUPPETEER_DANGEROUS_NO_SANDBOX is set/u);
    }
    assert.match(driverEnvironmentRefusal({ PUPPETEER_TEST_EXPERIMENTAL_CHROME_FEATURES: "true" }) ?? "", /PUPPETEER_TEST_EXPERIMENTAL_CHROME_FEATURES is set/u);
    assert.equal(driverEnvironmentRefusal({ PUPPETEER_EXECUTABLE_PATH: "/elsewhere", PUPPETEER_WEBDRIVER_BIDI_ONLY: "true", NODE_DEBUG: "*" }), null,
      "a variable puppeteer-core 25.8 does not act on at this launch was refused");
  });

  /*
   * The real CLI, with the variable set and a fake browser executable (a shell script) that records
   * the switches it was started with. Without the refusal the driver starts it and adds the
   * sandbox-disabling switch, which the recorded argv shows; with it, nothing starts. No Chrome.
   */
  it("the CLI with PUPPETEER_DANGEROUS_NO_SANDBOX set ends with exit 3 and starts no browser", { timeout: 60_000 }, (t) => {
    if (process.platform === "win32") return t.skip("the fake browser is a POSIX shell script; Windows is refused before any launch anyway");
    const root = realpathSync(mkdtempSync(join(tmpdir(), "breaklint-sandbox-env-")));
    try {
      const tmp = join(root, "tmp");
      mkdirSync(tmp);
      const exe = join(root, "fake-chrome");
      writeFileSync(exe, `#!/bin/sh\nprintf '%s\\n' "$@" > '${root}/argv'\nexit 1\n`);
      chmodSync(exe, 0o755);
      const doc = join(root, "doc.html");
      writeFileSync(doc, "<!doctype html><p>sandbox</p>");
      const cli = join(ROOT, "src/cli/index.ts");
      const run = spawnSync(process.execPath, ["--experimental-strip-types", cli, "--format", "json", doc], {
        cwd: ROOT, encoding: "utf8", timeout: 50_000,
        env: { ...process.env, BREAKLINT_CHROME: exe, TMPDIR: tmp, PUPPETEER_DANGEROUS_NO_SANDBOX: "true" },
      });
      const argv = existsSync(join(root, "argv")) ? readFileSync(join(root, "argv"), "utf8").trim().split("\n") : null;
      const sandboxOff = argv?.filter((arg) => SANDBOX_OFF.some((pattern) => pattern.test(arg))) ?? [];
      assert.equal(argv, null, `a browser was started with the variable set; its sandbox switches: ${sandboxOff.join(" ") || "none"}; argv: ${argv?.join(" ")}`);
      assert.equal(run.status, 3, `exit ${run.status}; stderr: ${run.stderr}`);
      assert.match(run.stderr, /PUPPETEER_DANGEROUS_NO_SANDBOX is set/u);
      assert.deepEqual(readdirSync(tmp), [], "a profile was created for a refused launch");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  // Mutation "env: { ...process.env, TMPDIR }" (the previous shape): red, CHROME_EXTRA_FLAGS kept.
  it("the browser's environment is the allow-list and TMPDIR, whatever the host carries", () => {
    const host = {
      HOME: "/var/empty", PATH: "/usr/bin", LANG: "de_DE.UTF-8", LC_ALL: "C", LC_TIME: "de_DE", TZ: "Europe/Berlin", XDG_CONFIG_HOME: "/x", FONTCONFIG_FILE: "/f",
      TMPDIR: "/host-tmp",
      CHROME_EXTRA_FLAGS: "--remote-debugging-port=9333", CHROME_DEVEL_SANDBOX: "/tmp/sb", CHROME_USER_DATA_DIR: "/tmp/u", CHROME_CONFIG_HOME: "/tmp/c",
      CHROMIUM_FLAGS: "--x", GOOGLE_API_KEY: "k", SSLKEYLOGFILE: "/tmp/keys", LD_PRELOAD: "/tmp/p.so", LD_LIBRARY_PATH: "/tmp/l",
      http_proxy: "http://p:1", HTTPS_PROXY: "http://p:1", NODE_OPTIONS: "--require x", PUPPETEER_EXECUTABLE_PATH: "/x", DISPLAY: ":0", LC_: "odd", LC_lower: "odd",
    };
    const env = browserEnvironment(host, "/profile/tmp");
    assert.deepEqual(Object.keys(env).sort(), ["FONTCONFIG_FILE", "HOME", "LANG", "LC_ALL", "LC_TIME", "LC_", "PATH", "TMPDIR", "TZ", "XDG_CONFIG_HOME"].sort());
    assert.equal(env.TMPDIR, "/profile/tmp");
    for (const name of Object.keys(env)) {
      assert.ok(name === "TMPDIR" || BROWSER_ENVIRONMENT_NAMES.includes(name) || /^LC_[A-Z_]*$/u.test(name), `${name} reached the browser's environment`);
    }
    assert.deepEqual(host.CHROME_EXTRA_FLAGS, "--remote-debugging-port=9333", "the host's own environment was edited");
  });

  /*
   * The real CLI, with switch-carrying variables in its environment and a fake browser (a shell
   * script) that records the environment it was started with. Control: the same recorder, started
   * by the driver with the host's environment passed through, records the variable, so a clean
   * record is not an unobservant recorder. No Chrome; a real browser's DevTools port is the
   * live test in tests/unit/render-run.test.ts.
   */
  it("an inherited CHROME_EXTRA_FLAGS never reaches the browser; control: it does when the host environment is passed through", { timeout: 60_000 }, async (t) => {
    if (process.platform === "win32") return t.skip("the fake browser is a POSIX shell script; Windows is refused before any launch anyway");
    const root = realpathSync(mkdtempSync(join(tmpdir(), "breaklint-browser-env-")));
    try {
      const tmp = join(root, "tmp");
      mkdirSync(tmp);
      const exe = join(root, "fake-chrome");
      writeFileSync(exe, `#!/bin/sh\nenv > '${root}/env'\nprintf '%s\\n' "$@" > '${root}/argv'\nexit 1\n`);
      chmodSync(exe, 0o755);
      const doc = join(root, "doc.html");
      writeFileSync(doc, "<!doctype html><p>env</p>");
      const planted = { CHROME_EXTRA_FLAGS: "--remote-debugging-port=9333", CHROME_DEVEL_SANDBOX: join(root, "sandbox"), LD_PRELOAD: join(root, "preload.so"), SSLKEYLOGFILE: join(root, "keys") };
      const run = spawnSync(process.execPath, ["--experimental-strip-types", join(ROOT, "src/cli/index.ts"), "--format", "json", doc], {
        cwd: ROOT, encoding: "utf8", timeout: 50_000,
        env: { ...process.env, BREAKLINT_CHROME: exe, TMPDIR: tmp, ...planted },
      });
      assert.equal(run.status, 3, `exit ${run.status}; stderr: ${run.stderr}`);
      assert.ok(existsSync(join(root, "env")), `the fake browser was not started: ${run.stderr}`);
      const recorded = readFileSync(join(root, "env"), "utf8").split("\n").filter(Boolean).map((line) => line.split("=", 1)[0]!);
      for (const name of Object.keys(planted)) assert.ok(!recorded.includes(name), `${name} reached the browser`);
      const unexpected = recorded.filter((name) => !(name === "TMPDIR" || BROWSER_ENVIRONMENT_NAMES.includes(name) || /^LC_[A-Z_]*$/u.test(name) || ["PWD", "SHLVL", "_", "OLDPWD"].includes(name)));
      assert.deepEqual(unexpected, [], "the browser saw variables outside the allow-list (PWD, SHLVL and _ are the shell's own)");
      assert.equal(readFileSync(join(root, "argv"), "utf8").includes("remote-debugging-port"), false);

      // Control: the same recorder, the host's environment passed through by the driver.
      rmSync(join(root, "env"), { force: true });
      const puppeteer = (await import("puppeteer-core")).default;
      const saved = { ...process.env };
      Object.assign(process.env, planted);
      try {
        await puppeteer.launch({ executablePath: exe, headless: true, pipe: true, userDataDir: join(root, "control-profile"), env: { ...process.env }, timeout: 10_000, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false }).then((browser) => browser.close(), () => undefined);
      } finally {
        for (const name of Object.keys(planted)) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
      }
      const control = readFileSync(join(root, "env"), "utf8");
      assert.match(control, /^CHROME_EXTRA_FLAGS=--remote-debugging-port=9333$/mu, "control: the recorder did not see a passed-through variable; the check above proves nothing");
    } finally { rmSync(root, { recursive: true, force: true }); }
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
