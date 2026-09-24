/**
 * Process-lifecycle soak (Linux): run the browser's close, timeout, kill and interrupt paths N
 * times each and prove after every iteration that nothing of that run is left.
 *
 *   node --experimental-strip-types tests/tools/lifecycle-soak.mjs [--iterations 20] [--paths close,timeout,KILL,INT,TERM,HUP]
 *   python3 tests/tools/noreap.py --expect-zombies 1 -- node --experimental-strip-types tests/tools/lifecycle-soak.mjs
 *
 * Paths, each iteration:
 *   close    launchBrowser -> page -> closeBrowserBounded -> cleanupBrowserProfile, in process.
 *   timeout  renderDocuments over a document whose script never yields, with the unit-only
 *            document-timeout seam, so the run takes the abort-and-clean path.
 *   KILL, INT, TERM, HUP
 *            the real CLI over a document that blocks for 30 s, signalled once its browser is up.
 *
 * The oracle is deliberately independent of the product. It reads /proc itself, and a process
 * counts as alive unless it reads `Z` with one remaining thread (an exited process waiting for a
 * parent that may never collect it cannot run code). It scopes everything to a private TMPDIR, so
 * another browser on the machine can neither pass nor fail it. Asserted per iteration:
 *   - no live process in the browser's process group 2 s after the run (the CLI's exit, the close);
 *   - no live process anywhere whose command line names this soak's profile root;
 *   - close/timeout: no `renderer-not-terminated`, no profile directory afterwards;
 *   - INT/TERM/HUP: the CLI died by that very signal (never exit 0) and left no profile directory;
 *   - KILL: the leaked profile directory is gone once the NEXT run's browser is up (its start-up
 *     sweep removed it), and a final in-process sweep leaves zero directories;
 *   - negative control, once per soak: a sweep run while a CLI's browser is up keeps that
 *     profile, naming the live owner as the reason.
 * Under `noreap.py` the same assertions must hold although every orphan stays a zombie; the
 * wrapper's --expect-zombies is the positive control that the regime actually happened.
 *
 * The time bounds below are harness bounds on external parties (node start-up, Chrome start-up);
 * they say nothing about the product and are sized far above measured values. The one bound that
 * IS the property is POST_EXIT_MS: 2 s after the run is over, the browser group must be empty.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PROFILE_PREFIX = "breaklint-chrome-profile-";
const POST_EXIT_MS = 2_000;
const BROWSER_APPEAR_MS = 60_000;
const CLI_EXIT_MS = 60_000;
const SIGNAL_NUMBERS = { SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const iterations = Number(option("--iterations", "20"));
const paths = option("--paths", "close,timeout,KILL,INT,TERM,HUP").split(",");
const outFile = option("--out", null);
assert.ok(Number.isSafeInteger(iterations) && iterations > 0, "--iterations must be a positive integer");
if (process.platform !== "linux") {
  console.error("lifecycle-soak: Linux only (the oracle reads /proc)");
  process.exit(69);
}

// Private temporary root: the product's tmpdir() and every CLI child resolve to it.
const soakRoot = realpathSync(mkdtempSync(join(tmpdir(), "breaklint-soak-")));
const profileRoot = join(soakRoot, "tmp");
const fixtures = join(soakRoot, "fixtures");
mkdirSync(profileRoot);
mkdirSync(fixtures);
process.env.TMPDIR = profileRoot;
const blocking = join(fixtures, "blocks-30s.html");
// Complication: the document's own script holds the renderer's main thread, so the run is inside
// document acquisition (browser and page up, nothing measured yet) when the signal lands.
writeFileSync(blocking, "<!doctype html><html><body><p>soak</p><script>const t0 = Date.now(); while (Date.now() - t0 < 30000) {}</script></body></html>");
const neverSettles = join(fixtures, "never-settles.html");
// Complication: the script never yields, so no driver call on this page can complete and only the
// document timeout can end the acquisition.
writeFileSync(neverSettles, "<!doctype html><html><body><p>soak</p><script>for (;;) {}</script></body></html>");

const { launchBrowser, sweepStaleBrowserProfiles: productSweep } = await import(join(ROOT, "src/acquire/browser.ts"));
// Run against a tree without the start-up sweep (to show this soak red on older code), a missing
// sweep is a failed assertion of its own rather than a crash that hides every other result.
const sweepStaleBrowserProfiles = productSweep ?? (() => { throw new Error("this tree has no start-up profile sweep"); });
const { closeBrowserBounded, cleanupBrowserProfile, renderDocuments } = await import(join(ROOT, "src/acquire/render-run.ts"));

// ---- the independent oracle ------------------------------------------------------------------
function procEntries() {
  const rows = [];
  for (const name of readdirSync("/proc")) {
    if (!/^[1-9][0-9]*$/u.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/u);
      let live = fields[0] !== "Z";
      if (!live) live = !/^Threads:\s*1\s*$/mu.test(readFileSync(`/proc/${name}/status`, "utf8"));
      let cmdline = "";
      try { cmdline = readFileSync(`/proc/${name}/cmdline`, "utf8").replaceAll("\0", " "); } catch { /* zombies have none */ }
      rows.push({ pid: Number(name), ppid: Number(fields[1]), pgid: Number(fields[2]), live, cmdline });
    } catch { /* vanished between readdir and read */ }
  }
  return rows;
}
const liveInGroup = (pgid) => procEntries().filter((row) => row.pgid === pgid && row.live).map((row) => row.pid);
const liveNamingProfileRoot = () => procEntries().filter((row) => row.live && row.cmdline.includes(`--user-data-dir=${profileRoot}/${PROFILE_PREFIX}`)).map((row) => row.pid);
const profiles = () => readdirSync(profileRoot).filter((name) => name.startsWith(PROFILE_PREFIX)).sort();
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
function killGroup(pgid) {
  try { process.kill(-pgid, "SIGKILL"); } catch { /* already gone */ }
}
async function groupEmptyWithin(pgid, ms) {
  const started = Date.now();
  for (;;) {
    const live = liveInGroup(pgid);
    if (live.length === 0) return { empty: true, ms: Date.now() - started, live };
    if (Date.now() - started >= ms) return { empty: false, ms: Date.now() - started, live };
    await sleep(20);
  }
}

// ---- paths -----------------------------------------------------------------------------------
async function closePath() {
  const launched = await launchBrowser(ROOT);
  assert.ok(launched.browser, launched.detail);
  const pid = launched.browser.process()?.pid;
  assert.ok(pid, "the browser has no pid");
  const page = await launched.browser.newPage();
  await page.setContent("<p>soak</p>");
  const closeError = await closeBrowserBounded(launched.browser);
  const profileError = cleanupBrowserProfile(launched.userDataDir);
  assert.equal(closeError, null, `close was not verified: ${closeError}`);
  assert.equal(profileError, null, `profile cleanup failed: ${profileError}`);
  const after = await groupEmptyWithin(pid, 0);
  if (after.live.length > 0) killGroup(pid);
  assert.deepEqual(after.live, [], `live processes in the closed browser's group: ${after.live}`);
  return { pid };
}

async function timeoutPath() {
  let pid = null;
  const result = await renderDocuments([neverSettles], {
    outDir: join(soakRoot, "out"), evidenceBinding: false, sourceMapInjection: true,
    network: { mode: "offline", allowed: [] }, locale: "de-DE",
  }, {
    async launchBrowser(fromDir) {
      const launched = await launchBrowser(fromDir);
      pid = launched.browser?.process()?.pid ?? null;
      return launched;
    },
    async openRasterizer() { return { rasterizer: null, detail: "soak: the timeout path needs no rasteriser" }; },
    documentTimeoutMs: 1_000,
  }, undefined, ROOT);
  assert.equal(result.fatal, null, `the run did not reach the document: ${result.fatal?.message}`);
  assert.ok(pid, "no browser pid was observed");
  const events = result.documents.flatMap((document) => document.infrastructure);
  assert.ok(events.some((event) => event.kind === "checker-crashed" && event.measured?.stage === "document-timeout"),
    `the document timeout path was not taken: ${events.map((event) => event.kind).join(",")}`);
  const unterminated = events.filter((event) => event.kind === "renderer-not-terminated");
  assert.deepEqual(unterminated.map((event) => event.detail), [], "renderer-not-terminated after the timeout path");
  const after = await groupEmptyWithin(pid, 0);
  if (after.live.length > 0) killGroup(pid);
  assert.deepEqual(after.live, [], `live processes in the timed-out browser's group: ${after.live}`);
  return { pid };
}

let leakedByKill = null;
let negativeControlDone = false;
async function signalPath(signal) {
  let cli = null;
  try {
    return await signalPathOnce(signal, (child) => { cli = child; });
  } finally {
    // A failed assertion must not leave this iteration's CLI (and its browser) running.
    if (cli && cli.exitCode === null && cli.signalCode === null) cli.kill("SIGKILL");
  }
}
async function signalPathOnce(signal, started) {
  const cli = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "src/cli/index.ts"), "--no-evidence-binding", "--format", "json", blocking], {
    cwd: ROOT, env: { ...process.env, TMPDIR: profileRoot }, stdio: ["ignore", "ignore", "pipe"],
  });
  started(cli);
  let stderr = "";
  cli.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2_000); });
  const exited = new Promise((resolveExit) => cli.once("exit", (code, sig) => resolveExit({ code, signal: sig })));
  let root = null;
  const appear = Date.now();
  while (root === null) {
    const found = procEntries().find((row) => row.live && row.ppid === cli.pid && row.cmdline.includes(`--user-data-dir=${profileRoot}/${PROFILE_PREFIX}`));
    if (found) root = found;
    else if (Date.now() - appear > BROWSER_APPEAR_MS) {
      cli.kill("SIGKILL");
      throw new Error(`harness: no browser under the CLI within ${BROWSER_APPEAR_MS} ms; stderr: ${stderr}`);
    } else await sleep(20);
  }
  const profile = /--user-data-dir=(\S+)/u.exec(root.cmdline)?.[1];
  assert.ok(profile, "the browser command line names no profile");
  // The previous run's SIGKILL left its profile behind; this run's start-up sweep must have
  // removed it before this browser was started.
  if (leakedByKill) {
    assert.equal(existsSync(leakedByKill), false, `the profile leaked by the previous SIGKILL was not swept: ${leakedByKill}`);
    leakedByKill = null;
  }
  // Let the renderer take the document: the signal must land inside acquisition, not at launch.
  await sleep(1_000);
  if (!negativeControlDone && signal === "SIGTERM") {
    negativeControlDone = true;
    const swept = sweepStaleBrowserProfiles();
    const kept = swept.kept.find((entry) => entry.path === profile);
    assert.ok(existsSync(profile) && kept, `a concurrent sweep touched the profile of a running breaklint: ${JSON.stringify(swept)}`);
  }
  cli.kill(signal);
  const exit = await Promise.race([exited, sleep(CLI_EXIT_MS).then(() => null)]);
  if (!exit) {
    cli.kill("SIGKILL");
    throw new Error(`harness: the CLI did not exit within ${CLI_EXIT_MS} ms of ${signal}; stderr: ${stderr}`);
  }
  // Never exit 0, and for an interrupt: death by that very signal, after its own cleanup.
  assert.equal(exit.signal, signal, `the CLI ended with ${JSON.stringify(exit)} instead of dying by ${signal}; stderr: ${stderr}`);
  const after = await groupEmptyWithin(root.pgid, POST_EXIT_MS);
  if (!after.empty) killGroup(root.pgid); // measured above; do not let a survivor skew the next iteration
  assert.ok(after.empty, `browser group ${root.pgid} still has live processes ${POST_EXIT_MS} ms after the CLI exited: ${after.live}`);
  if (signal === "SIGKILL") leakedByKill = profile;
  else assert.equal(existsSync(profile), false, `the ${signal} run left its profile: ${profile}`);
  return { pid: root.pid, exit, groupEmptyMs: after.ms };
}

// ---- driver ----------------------------------------------------------------------------------
const results = [];
let failures = 0;
const started = Date.now();
for (let iteration = 1; iteration <= iterations; iteration += 1) {
  for (const path of paths) {
    const t0 = Date.now();
    let outcome;
    try {
      const detail = path === "close" ? await closePath()
        : path === "timeout" ? await timeoutPath()
        : await signalPath(`SIG${path}`);
      const strays = liveNamingProfileRoot();
      assert.deepEqual(strays, [], `live browser processes still name the soak profile root: ${strays}`);
      if (path !== "KILL") assert.deepEqual(profiles().filter((name) => leakedByKill === null || join(profileRoot, name) !== leakedByKill), [], "profile directories left behind");
      outcome = { iteration, path, ok: true, ms: Date.now() - t0, ...detail };
    } catch (error) {
      failures += 1;
      outcome = { iteration, path, ok: false, ms: Date.now() - t0, error: error instanceof Error ? error.message : String(error) };
    }
    results.push(outcome);
    console.log(JSON.stringify({ ...outcome, load: readFileSync("/proc/loadavg", "utf8").split(" ")[0] }));
  }
}
// The last SIGKILL leak has no next run: sweep once more, in process, and require an empty root.
let finalSweep;
try { finalSweep = sweepStaleBrowserProfiles(); } catch (error) { finalSweep = { error: error instanceof Error ? error.message : String(error) }; }
if (profiles().length > 0 || liveNamingProfileRoot().length > 0) {
  failures += 1;
  console.log(JSON.stringify({ final: true, ok: false, profiles: profiles(), live: liveNamingProfileRoot(), sweep: finalSweep }));
}
// Hygiene after measuring: nothing this soak started may outlive it, whatever the verdict.
for (const pid of liveNamingProfileRoot()) {
  try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
}
const summary = {
  iterations, paths, failures, durationMs: Date.now() - started,
  byPath: Object.fromEntries(paths.map((path) => {
    const rows = results.filter((row) => row.path === path);
    return [path, { runs: rows.length, failed: rows.filter((row) => !row.ok).length, maxMs: Math.max(...rows.map((row) => row.ms)) }];
  })),
  parentPid: process.ppid,
};
console.log(`SUMMARY ${JSON.stringify(summary)}`);
if (outFile) writeFileSync(outFile, JSON.stringify({ summary, results }, null, 2));
rmSync(soakRoot, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
