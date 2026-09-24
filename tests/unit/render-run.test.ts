/**
 * The live path and its process-boundary failure.
 *
 * The old test pinned a hard-coded "not built" event. M2d removes that branch, so this test breaks
 * the actual browser-driver boundary and pushes the acquisition result through the real engine.
 * Removing checker-crashed from the catch turns the result into exit 4 and reddens the assertion.
 */

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { once } from "node:events";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildReport } from "../../src/core/build-report.ts";
import { runDocument, type DocumentInput } from "../../src/core/engine.ts";
import { resolveConfig, toReportConfig } from "../../src/config/resolve.ts";
import { NON_FATAL_INFRA_EVENT_KINDS } from "../../src/core/enums.ts";
import {
  closeBrowserBounded,
  collisionSources,
  discoverLocalAssets,
  documentArtifactKey,
  finalizeEvidenceAcquisition,
  withdrawFatalCleanupDocuments,
  operationalLimitEvents,
  orderedSourceSids,
  paginationApparatusSource,
  renderDocuments,
  resolvePagedjs,
  validateRuntimeSidState,
  withPagination,
  type RenderDependencies,
  BROWSER_CLOSE_TIMEOUT_MS,
} from "../../src/acquire/render-run.ts";
import {
  alive, captureProcessTreeOwnership, createInterruptRegistry, INTERRUPT_SIGNALS, launchBrowser, linuxProcessTable,
  ownServerLifecycle, processIsDefunct, profileOwnerIdentity, PROFILE_OWNER_FILE, PROFILE_PREFIX,
  STALE_PROFILE_MIN_AGE_MS, sweepStaleBrowserProfiles, terminateProcessTree, TERMINATION_GRACE_MS,
  type InterruptSignal, type PageLike, type ProcessRow, type ProfileOwnerRecord, type ProfileSweepEnvironment,
  type ProfileSweepResult, type SignalHost,
} from "../../src/acquire/browser.ts";
import type { EvidenceOutcome } from "../../src/render/evidence.ts";
import { writeEvidencePng, type Rasterizer } from "../../src/render/rasterizer.ts";
import { loadCorpus } from "../fixtures/corpus.ts";
import { spacedHyphen } from "../../src/rules/type/spaced-hyphen.ts";
import { injectSourceIds } from "../../src/source/inject.ts";
import { closeRendererOwnedResourcesBounded } from "../../src/acquire/renderer-cleanup.ts";
import { COLLECTOR_SOURCE, collectorSource } from "../../src/paginate/collector.ts";
import { FREEZE_SOURCE, MAX_DOM_NODES, MAX_MUTATIONS_AFTER_RENDERED, MAX_PAGES } from "../../src/measure/freeze.ts";
import { PRIMITIVES_SOURCE, TEST_PRIMITIVES_CAPABILITY } from "../../src/measure/primitives.ts";

const OPTIONS = {
  outDir: ".tmp/render-run-test",
  evidenceBinding: true,
  sourceMapInjection: true,
  network: { mode: "offline" as const, allowed: [] },
  locale: "de-DE",
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForObserved<T>(observe: () => T, accept: (value: T) => boolean, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = observe();
  while (!accept(value) && Date.now() < deadline) {
    await wait(5);
    value = observe();
  }
  assert.ok(accept(value), `observable state did not arrive within ${timeoutMs} ms`);
  return value;
}

/**
 * Can `pid` still run code? Deliberately independent of the product's reader. A zombie cannot: it
 * has exited and waits only for its parent to collect it, and for a child of this test process
 * that collection happens on a later turn of this very event loop, after the assertion. So on
 * Linux `Z` with one remaining thread reads as dead; elsewhere `kill(pid, 0)` decides.
 */
function canRunCode(pid: number): boolean {
  try { process.kill(pid, 0); } catch { return false; }
  if (process.platform !== "linux") return true;
  const gone = (error: unknown) => ["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "");
  let stat: string;
  try { stat = readFileSync(`/proc/${pid}/stat`, "utf8"); } catch (error) { if (gone(error)) return false; throw error; }
  if (stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/u)[0] !== "Z") return true;
  let status: string;
  try { status = readFileSync(`/proc/${pid}/status`, "utf8"); } catch (error) { if (gone(error)) return false; throw error; }
  return !/^Threads:\s*1\s*$/mu.test(status);
}

describe("renderer ownership cleanup order", () => {
  it("does not start browser cleanup before rasterizer cleanup settles", async () => {
    let releaseRasterizer!: () => void;
    const rasterizerSettled = new Promise<void>((resolve) => { releaseRasterizer = resolve; });
    const events: string[] = [];
    const cleanup = closeRendererOwnedResourcesBounded(
      async () => {
        events.push("rasterizer:start");
        await rasterizerSettled;
        events.push("rasterizer:end");
        return null;
      },
      async () => {
        events.push("browser:start");
        return null;
      },
      10_000,
    );
    await Promise.resolve();
    assert.deepEqual(events, ["rasterizer:start"]);
    releaseRasterizer();
    assert.deepEqual(await cleanup, { rasterizerError: null, browserError: null });
    assert.deepEqual(events, ["rasterizer:start", "rasterizer:end", "browser:start"]);
  });

  it("still starts bounded browser cleanup after a hung rasterizer head start", async () => {
    let announceBrowser!: () => void;
    const browserStarted = new Promise<void>((resolve) => { announceBrowser = resolve; });
    void closeRendererOwnedResourcesBounded(
      () => new Promise<string | null>(() => undefined),
      async () => {
        announceBrowser();
        return null;
      },
      1,
    );
    await browserStarted;
  });
});

function detachedNode(source: string) {
  return spawn(process.execPath, ["-e", source], { detached: true, stdio: "ignore" });
}

/** Run the acquisition result through the engine, exactly as the CLI does. */
function exitCodeFor(documents: Awaited<ReturnType<typeof renderDocuments>>["documents"]): number {
  const outcomes = documents.map((d) =>
    runDocument(d, { failOn: "error", activeRules: [], optionsByRule: {}, coverageFloors: {} }),
  );
  return buildReport({
    outcomes,
    failOn: "error",
    startedAt: new Date(0).toISOString(),
    durationMs: 0,
    rulesRun: 0,
    toolVersion: "test",
    commit: null,
    mode: "live",
    source: "rendered",
    environment: {
      browserVersion: "test",
      platform: "test",
      rendererPath: null,
      rendererPresent: false,
      pagedjsVersion: "0.4.3",
      rasterizer: null,
      rasterizerVersion: null,
      textPositionExtractor: null,
      fontFamiliesResolved: [],
      locale: "de-DE",
    },
    config: toReportConfig(resolveConfig({
      file: undefined,
      cli: { only: ["layout/widow"], disable: ["layout/widow"] },
    }), { interventions: [], networkBlocked: 0 }),
  }).exitCode;
}

describe("the live path fails closed at its process boundary", () => {
  it("closes an owned loopback server with an intentionally open socket and releases its port", async () => {
    const server = createServer(() => undefined);
    const lifecycle = ownServerLifecycle(server);
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    // Wait for the server-side "connection" event, not for a fixed 10 ms: under a loaded
    // scheduler the accept can land after the sleep, and the positive control would fail for
    // a reason unrelated to the property under test (2026-09-02, Dargel WI parallelbetrieb).
    const accepted = once(server, "connection");
    const socket = createConnection({ host: "127.0.0.1", port: address.port });
    await once(socket, "connect");
    await accepted;
    assert.equal(lifecycle.openSockets(), 1, "the positive-control socket never reached the owned server");
    // The property is "close does not wait for the intentionally open socket". It is carried
    // by the null result: had close() waited for the socket's natural end, the 250 ms race
    // timer would have resolved first and close() would report the server as unverified
    // (non-null). A wall-clock bound on top of that measured scheduler latency, not the
    // property, and could fail in a 469-test parallel run for no defect.
    assert.equal(await lifecycle.close(250), null);
    assert.equal(server.listening, false);
    assert.equal(lifecycle.openSockets(), 0);
    // The server destroys its end synchronously (openSockets() === 0 above); the CLIENT socket
    // learns about it asynchronously. Observed 2 of 5 runs red on the immediate check under
    // load (2026-09-02) — wait for the observable, bounded by the shared helper.
    await waitForObserved(() => socket.destroyed, (destroyed) => destroyed === true);
    const refusal = createConnection({ host: "127.0.0.1", port: address.port });
    const [error] = await once(refusal, "error") as [NodeJS.ErrnoException];
    assert.equal(error.code, "ECONNREFUSED", "the supposedly closed loopback port still accepted a connection");
  });

  it("inserts the harness at the parser's real body end tag, never at authored lookalikes", () => {
    const source = `<!doctype html><body><script>const marker = '</body>';</script></body><!-- </body> -->`;
    const rendered = withPagination(source, "window.Paged = Paged;", false);
    const harness = rendered.indexOf('if ("Paged" in window)');
    assert.ok(harness > rendered.indexOf("const marker"));
    assert.ok(harness < rendered.indexOf("</body><!--"));
    assert.ok(rendered.endsWith("<!-- </body> -->"));
  });

  it("keeps collector/freeze state closed and removes author-callable pagination endpoints", () => {
    assert.equal(/\bpublish\s*:/u.test(PRIMITIVES_SOURCE), false, "generic author-callable publish returned");
    assert.equal(/\block\s*:/u.test(PRIMITIVES_SOURCE), false, "generic author-callable lock returned");
    assert.equal(COLLECTOR_SOURCE.includes("window.__blCollector ="), false);
    assert.ok(COLLECTOR_SOURCE.includes("P.installCollector("));
    assert.ok(FREEZE_SOURCE.includes("P.publishFreeze(\"breaklint-static-test-capability\", freezeParts)"));
    const rendered = withPagination("<body><p>x</p></body>", "window.Paged = Paged;", true);
    assert.equal(rendered.includes("__blPaginationStatus"), false);
    assert.equal(rendered.includes("__blStartPagination"), false);
    assert.equal(rendered.includes("installCollector"), false);
    assert.equal(rendered.includes("lockPagination"), false);
    const apparatus = paginationApparatusSource(TEST_PRIMITIVES_CAPABILITY);
    assert.ok(apparatus.includes('P.lockPagination("breaklint-static-test-capability", Previewer.prototype, "preview", guardedPreview)'));
    assert.ok(apparatus.includes("P.integrityRecordPreview"));
    const productionCollector = collectorSource(TEST_PRIMITIVES_CAPABILITY, "nonce-test");
    assert.equal(productionCollector.includes("__BREAKLINT_COLLECTOR_CAPABILITY__"), false);
    assert.equal(productionCollector.match(/breaklint-static-test-capability/gu)?.length, 3);
  });

  it("rejects source-id removal, swaps and duplicate runtime ownership", () => {
    assert.deepEqual(validateRuntimeSidState(["bl-a", "bl-b"], {
      sidMutations: 0, mutationRecordsAfterRendered: 0, paginationPreviewCalls: 0, sids: ["bl-a", "bl-b"],
    }), []);
    assert.deepEqual(validateRuntimeSidState(["bl-a", "bl-b"], {
      sidMutations: 0, mutationRecordsAfterRendered: 0, paginationPreviewCalls: 1,
      sids: ["bl-a", "bl-a", "bl-b", "bl-b"],
    }), [], "contiguous Paged.js fragments are legitimate repeated ownership");
    for (const status of [
      { sidMutations: 1, mutationRecordsAfterRendered: 0, paginationPreviewCalls: 0, sids: ["bl-b", "bl-a"] },
      { sidMutations: 0, mutationRecordsAfterRendered: 0, paginationPreviewCalls: 0, sids: [] },
      { sidMutations: 0, mutationRecordsAfterRendered: 0, paginationPreviewCalls: 0, sids: ["bl-a", "bl-a"] },
    ]) assert.ok(validateRuntimeSidState(["bl-a", "bl-b"], status).length > 0);
    assert.deepEqual(validateRuntimeSidState(["bl-a", "bl-b"], {
      sidMutations: 0, mutationRecordsAfterRendered: 0, paginationPreviewCalls: 1,
      sids: ["bl-a", "bl-b", "bl-a"],
    }), [], "a later fragment of an already-owned source block is not a reordered first occurrence");
  });

  it("orders more than ten thousand source IDs by source offset, not lexical suffix", () => {
    const map = Object.fromEntries(Array.from({ length: 10_001 }, (_, index) => [
      `s${String(index).padStart(4, "0")}`,
      {
        file: "large.html", line: index + 1, column: 1, offset: index * 10,
        endLine: index + 1, endColumn: 2, endOffset: index * 10 + 1,
        coordinateSystem: "utf8-bytes-unicode-codepoints-v1" as const,
      },
    ]));
    const ordered = orderedSourceSids(map);
    assert.equal(ordered.length, 10_001);
    assert.deepEqual(ordered.slice(998, 1_003), ["s0998", "s0999", "s1000", "s1001", "s1002"]);
    assert.equal(ordered.at(-1), "s10000");
  });

  it("enforces every §13.3 structural/mutation threshold at the exact red edge", () => {
    assert.deepEqual(operationalLimitEvents({
      pages: MAX_PAGES, domNodes: MAX_DOM_NODES, mutationsAfterRendered: MAX_MUTATIONS_AFTER_RENDERED,
      resourceLimit: null,
    }), []);
    const events = operationalLimitEvents({
      pages: MAX_PAGES + 1, domNodes: MAX_DOM_NODES + 1,
      mutationsAfterRendered: MAX_MUTATIONS_AFTER_RENDERED + 1,
      resourceLimit: { maxResourceBytes: 10, resourceBytes: 11, resource: "https://example.invalid/a" },
    });
    assert.deepEqual(events.map((event) => event.kind), ["limit-exceeded", "document-not-quiescent", "limit-exceeded"]);
  });

  it("short-circuits the script-bearing control arm at the common pre-pagination limit gate", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "breaklint-control-limit-"));
    const fixture = join(fixtureRoot, "control-limit.html");
    writeFileSync(fixture, "<!doctype html><script>window.author = true</script><p>x</p>");
    let apparatusCalls = 0;
    let pagesClosed = 0;
    let contextsClosed = 0;
    const page = {
      async goto() {}, async setContent() {}, async waitForFunction() {}, async emulateMediaType() {},
      async setViewport() {}, async pdf() { return new Uint8Array(); }, on() {},
      async evaluateOnNewDocument() {}, async setRequestInterception() {},
      async evaluate(source: string) {
        if (source.includes("domNodes:")) return { pages: 0, domNodes: MAX_DOM_NODES + 1 };
        if (source.includes("lockPagination(")) apparatusCalls += 1;
        throw new Error("control proceeded past its early operational limit");
      },
      async close() { pagesClosed += 1; },
    } as unknown as PageLike;
    try {
      const result = await renderDocuments([fixture], OPTIONS, {
        async launchBrowser() {
          return { executablePath: "/fake", detail: "", browser: {
            async newPage() { throw new Error("default context forbidden"); },
            async createBrowserContext() {
              return { async newPage() { return page; }, async close() { contextsClosed += 1; } };
            },
            async version() { return "Fake/1"; }, async close() {},
          } };
        },
        async openRasterizer() { return { rasterizer: null, detail: "unit" }; },
      });
      assert.equal(apparatusCalls, 0);
      assert.equal(pagesClosed, 1);
      assert.equal(contextsClosed, 1);
      assert.ok(result.documents[0]!.infrastructure.some((event) => event.kind === "limit-exceeded"));
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("caps a referenced local resource before read and keeps duplicate evidence keys disjoint", () => {
    const root = mkdtempSync(join(tmpdir(), "breaklint-resource-cap-"));
    try {
      writeFileSync(join(root, "doc.html"), "fixture");
      writeFileSync(join(root, "asset.bin"), "too large");
      writeFileSync(join(root, "large.css"), "p { color: red; }");
      assert.throws(
        () => discoverLocalAssets('<img src="asset.bin">', join(root, "doc.html"), 1),
        /resource byte limit exceeded/u,
      );
      assert.throws(
        () => collisionSources('<link rel="stylesheet" href="large.css">', join(root, "doc.html"), 1),
        /resource byte limit exceeded/u,
      );
      const first = documentArtifactKey(join(root, "doc.html"), 0, "run-a");
      const second = documentArtifactKey(join(root, "doc.html"), 1, "run-a");
      const nextRun = documentArtifactKey(join(root, "doc.html"), 0, "run-b");
      assert.notEqual(first, second);
      assert.notEqual(first, nextRun);
      assert.match(first, /^run-a-0001-/u);
      assert.match(second, /^run-a-0002-/u);
      const exclusive = join(root, "evidence.png");
      writeEvidencePng(exclusive, Uint8Array.of(1));
      assert.throws(() => writeEvidencePng(exclusive, Uint8Array.of(2)), /EEXIST/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("closes the browser when browser.version fails during startup", async () => {
    const profile = mkdtempSync(join(tmpdir(), "breaklint-chrome-profile-unit-"));
    writeFileSync(join(profile, "sentinel"), "owned");
    let closed = 0;
    let rasterizerOpened = 0;
    const result = await renderDocuments([], OPTIONS, {
      async launchBrowser() {
        return {
          executablePath: "/measured/fake-chrome",
          userDataDir: profile,
          detail: "",
          browser: {
            async newPage() { throw new Error("not reached"); },
            async version() { throw new Error("version channel reset"); },
            async close() { closed += 1; },
          },
        };
      },
      async openRasterizer() { rasterizerOpened += 1; return { rasterizer: null, detail: "not reached" }; },
    });
    assert.equal(result.fatal?.exitCode, 3);
    assert.match(result.fatal?.message ?? "", /browser\.version.*version channel reset/u);
    assert.equal(closed, 1);
    assert.equal(rasterizerOpened, 0);
    assert.equal(existsSync(profile), false);
  });

  it("removes an explicitly owned profile after a normal browser close", async () => {
    const profile = mkdtempSync(join(tmpdir(), "breaklint-chrome-profile-unit-"));
    writeFileSync(join(profile, "sentinel"), "owned");
    const result = await renderDocuments([], OPTIONS, {
      async launchBrowser() {
        return {
          executablePath: "/measured/fake-chrome", userDataDir: profile, detail: "",
          browser: {
            async newPage() { throw new Error("not reached"); },
            async version() { return "Fake/1"; },
            async close() {},
          },
        };
      },
      async openRasterizer() { return { rasterizer: null, detail: "not installed in unit" }; },
    });
    assert.equal(result.fatal, null);
    assert.equal(existsSync(profile), false);
  });

  it("closes the browser when rasterizer startup throws", async () => {
    let closed = 0;
    const result = await renderDocuments([], OPTIONS, {
      async launchBrowser() {
        return {
          executablePath: "/measured/fake-chrome",
          detail: "",
          browser: {
            async newPage() { throw new Error("not reached"); },
            async version() { return "Fake/1"; },
            async close() { closed += 1; },
          },
        };
      },
      async openRasterizer() { throw new Error("rasterizer control channel reset"); },
    });
    assert.equal(result.fatal?.exitCode, 3);
    assert.match(result.fatal?.message ?? "", /openRasterizer.*rasterizer control channel reset/u);
    assert.equal(closed, 1);
  });

  it("reports browser.process failures instead of throwing out of startup cleanup", async () => {
    const result = await renderDocuments([], OPTIONS, {
      async launchBrowser() {
        return {
          executablePath: "/measured/fake-chrome",
          detail: "",
          browser: {
            async newPage() { throw new Error("not reached"); },
            async version() { throw new Error("version failed"); },
            process() { throw new Error("process handle failed"); },
            async close() { throw new Error("close failed"); },
          },
        };
      },
      async openRasterizer() { return { rasterizer: null, detail: "not reached" }; },
    });
    assert.equal(result.fatal?.exitCode, 3);
    assert.match(result.fatal?.message ?? "", /browser\.process failed: process handle failed/u);
  });

  it("terminates and rechecks an isolated process group, including a child born after SIGTERM", async (t) => {
    if (process.platform === "win32") return t.skip("POSIX process groups are unsupported on Windows");
    // The SIGTERM handler is installed BEFORE the first child is spawned, so that observing two
    // pids below also proves the root is armed. In the other order a SIGTERM that lands between
    // the spawn and the handler kills the root outright and the escalation is never exercised:
    // measured 3 of 10 isolated runs red that way at load 12, once zombies stopped masking it.
    const child = detachedNode(`
      const { spawn } = require("node:child_process");
      process.on("SIGTERM", () => {
        spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      });
      spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      setInterval(() => {}, 1000);
    `);
    child.unref();
    assert.ok(child.pid);
    await waitForObserved(
      () => captureProcessTreeOwnership(child.pid!),
      (ownership) => (ownership?.initialPids.length ?? 0) >= 2,
    );
    const termination = await terminateProcessTree(child.pid);
    assert.equal(termination.groupSafe, true);
    assert.ok(termination.initialPids.length >= 2, "the initial process tree was not observed");
    assert.equal(termination.killSent, true, "the SIGTERM-resistant group never reached SIGKILL");
    assert.deepEqual(termination.survivingPids, []);
    assert.equal(termination.verified, true);
  });

  /*
   * A zombie is not a survivor. The three tests below pin that from both sides. The fake-table
   * pair is platform-independent: a row proved `defunct` must not count, a row that is not proved
   * must, and the deadline runs on the injected clock. The real-kernel one builds a zombie that no
   * PID 1 can collect early — its parent is a living `sleep` that never waits — so it reproduces
   * the no-init container case on any Linux host, including a CI runner whose init reaps at once.
   * Named mutations, each run against these tests:
   *   M1 "zombie counts as alive": drop the `defunct` filter in refresh/ownership and
   *      processIsDefunct in alive() -> the first and third go red.
   *   M2 "every owned row is defunct": defunctIn() ignores the flag -> the second goes red.
   *   M3 "wall-clock deadline": terminateProcessTree ignores operations.now -> the second goes red.
   */
  it("verifies a group whose only remaining member is a proved zombie, and records it separately", async () => {
    const root = 43_001, child = 43_002;
    let table: ProcessRow[] = [
      { pid: root, ppid: 1, pgid: root },
      { pid: child, ppid: root, pgid: root },
    ];
    const signals: Array<[number, NodeJS.Signals]> = [];
    const result = await terminateProcessTree(root, () => table, {
      // kill(pid, 0) succeeds on a zombie: the fake answers exactly what the kernel answers.
      alive: (pid) => pid === root ? table.some((row) => row.pid === root) : true,
      signal(pid, signal) {
        signals.push([pid, signal]);
        // SIGTERM: the root leaves and is collected by its parent; the child exits, is orphaned,
        // and stays a zombie in the group because nobody collects it.
        if (pid === -root) table = [{ pid: child, ppid: 1, pgid: root, defunct: true }];
      },
      async wait() {},
    });
    assert.deepEqual(signals, [[-root, "SIGTERM"]], "a zombie was escalated to SIGKILL as if it were alive");
    assert.deepEqual(result.survivingPids, []);
    assert.deepEqual(result.defunctPids, [child]);
    assert.equal(result.killSent, false);
    assert.equal(result.verified, true);
  });

  it("counts an unproved member as a survivor and escalates on a fake clock at the deadline", async () => {
    const root = 43_101, child = 43_102;
    let clock = 0;
    const waits: number[] = [];
    const signals: Array<[number, NodeJS.Signals]> = [];
    // The child ignores SIGTERM and SIGKILL alike (a process in uninterruptible sleep does): it is
    // live and NOT proved defunct, so it must remain a survivor however long the loop runs.
    const table: ProcessRow[] = [
      { pid: root, ppid: 1, pgid: root, defunct: true },
      { pid: child, ppid: root, pgid: root },
    ];
    const result = await terminateProcessTree(root, () => table, {
      alive: () => true,
      signal(pid, signal) { signals.push([pid, signal]); },
      // Yield to the event loop so that a mutant that ignores the clock and spins is still
      // bounded by real time instead of starving the test runner's own timeout.
      async wait(ms) { waits.push(ms); clock += ms; await new Promise((resolve) => setImmediate(resolve)); },
      now: () => clock,
    });
    assert.deepEqual(result.survivingPids, [child]);
    assert.deepEqual(result.defunctPids, [root]);
    assert.equal(result.verified, false);
    assert.equal(result.killSent, true);
    assert.deepEqual(signals.filter(([, signal]) => signal === "SIGKILL").map(([pid]) => pid), [-root, child]);
    // The grace period is measured on the injected clock, not the wall clock: it ran to the
    // deadline and not one poll further, then the two fixed rechecks.
    assert.ok(clock >= TERMINATION_GRACE_MS + 200, `the fake clock only reached ${clock} ms`);
    assert.equal(waits.filter((ms) => ms === 50).length, TERMINATION_GRACE_MS / 50);
  });

  it("verifies a real group whose leader is a zombie that its living parent never collects", { timeout: 30_000 }, async (t) => {
    if (process.platform !== "linux") return t.skip("the zombie proof reads /proc; elsewhere kill(pid, 0) still decides");
    // `setsid` makes the backgrounded sleep the leader of its own group; `exec` then turns its
    // parent shell into a sleep that never calls wait(). Killing the group leaves the leader a
    // zombie for as long as the holder lives, whatever PID 1 does.
    const holder = spawn("sh", ["-c", "setsid sleep 300 & echo $!; exec sleep 300"], { stdio: ["ignore", "pipe", "ignore"] });
    try {
      const [line] = await once(holder.stdout!, "data") as [Buffer];
      const leader = Number(String(line).trim());
      assert.ok(Number.isSafeInteger(leader) && leader > 1, `no leader pid: ${String(line)}`);
      await waitForObserved(() => captureProcessTreeOwnership(leader), (ownership) => ownership?.groupSafe === true);
      const termination = await terminateProcessTree(leader);
      // Positive control, read independently of the product: the case really happened — the
      // leader is still in the table as a zombie with one thread, not already collected.
      const stat = readFileSync(`/proc/${leader}/stat`, "utf8");
      assert.equal(stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/u)[0], "Z", "the leader never became a zombie; the case did not run");
      assert.match(readFileSync(`/proc/${leader}/status`, "utf8"), /^Threads:\s*1\s*$/mu);
      assert.deepEqual(termination.survivingPids, [], "a zombie was reported as a surviving renderer process");
      assert.deepEqual(termination.defunctPids, [leader]);
      assert.equal(termination.killSent, false, "a zombie was escalated to SIGKILL as if it were alive");
      assert.equal(termination.verified, true);
    } finally {
      holder.kill("SIGKILL");
    }
  });

  it("reads the Linux process table from /proc: proves zombies by thread count and skips released rows", () => {
    // A synthetic /proc, so the parser's decisions are pinned on every platform. Each row names
    // its complication. Mutations: accept `Z` without the thread count -> 402 turns defunct, red;
    // drop the released-row case -> the whole table throws, red; split `comm` at the first `)` ->
    // 401 is unparseable, red.
    const proc = mkdtempSync(join(tmpdir(), "breaklint-proc-fixture-"));
    const row = (pid: number, stat: string, threads?: number) => {
      mkdirSync(join(proc, String(pid)));
      writeFileSync(join(proc, String(pid), "stat"), `${stat}\n`);
      if (threads !== undefined) writeFileSync(join(proc, String(pid), "status"), `Name:\tx\nState:\tx\nThreads:\t${threads}\n`);
    };
    try {
      row(400, "400 (chrome) S 1 400 400 0 -1", 12); // a live group leader
      row(401, "401 (a ) Z 7 (b)) Z 400 400 400 0 -1", 1); // comm with spaces and parentheses; a true zombie
      row(402, "402 (leader) Z 1 400 400 0 -1", 2); // left with pthread_exit(): Z, but a thread still runs
      row(403, "403 (ps) X 0 -1 -1 0 -1"); // released after collection: ppid 0 and pgid -1, already gone
      mkdirSync(join(proc, "404")); // vanished between readdir and read: no stat any more
      mkdirSync(join(proc, "self"));
      const table = linuxProcessTable(proc).sort((a, b) => a.pid - b.pid);
      assert.deepEqual(table, [
        { pid: 400, ppid: 1, pgid: 400 },
        { pid: 401, ppid: 400, pgid: 400, defunct: true },
        { pid: 402, ppid: 1, pgid: 400 },
      ]);
      assert.equal(processIsDefunct(401, "linux", proc), true);
      assert.equal(processIsDefunct(402, "linux", proc), false, "a zombie leader with a live thread was declared dead");
      assert.equal(processIsDefunct(403, "linux", proc), true);
      assert.equal(processIsDefunct(404, "linux", proc), true, "a pid whose /proc entry vanished is gone");
      assert.equal(processIsDefunct(400, "linux", proc), false);
      assert.equal(processIsDefunct(401, "darwin", proc), false, "only the Linux reader may prove a zombie");
      row(405, "405 (broken) S not-a-pid 400");
      assert.throws(() => linuxProcessTable(proc), /unparseable/u, "a malformed row must make the table unreadable, not disappear");
    } finally {
      rmSync(proc, { recursive: true, force: true });
    }
  });

  // Mutation "no memoisation": red, the second caller closes again and captures no ownership.
  it("closes one browser once however many callers ask, and shares the verified result", async () => {
    let closes = 0;
    let captures = 0;
    const browser = {
      async newPage() { throw new Error("not reached"); }, async version() { return "Fake/1"; },
      process() { return { pid: 71_003 }; }, async close() { closes += 1; await new Promise((resolve) => setImmediate(resolve)); },
    };
    const terminate = async (pid: number) => ({
      rootPid: pid, pgid: pid, initialPids: [pid], survivingPids: [], defunctPids: [], groupSafe: true,
      termSent: true, killSent: false, verified: true,
    });
    const capture = (pid: number) => { captures += 1; return { pgid: pid, groupSafe: true, initialPids: [pid] }; };
    const [first, second] = await Promise.all([closeBrowserBounded(browser, terminate, capture), closeBrowserBounded(browser, terminate, capture)]);
    assert.equal(first, null);
    assert.equal(second, null);
    assert.equal(closes, 1);
    assert.equal(captures, 1);
    assert.equal(await closeBrowserBounded(browser, terminate, capture), null);
    assert.equal(closes, 1, "a later caller closed the browser a second time");
  });

  /*
   * The consumer-visible path of an interrupt, without a browser: a separate node process renders
   * one document through fake driver objects whose calls never settle until the browser is
   * closed, and the test signals that process once the document is being acquired. Complication:
   * the render is blocked inside acquisition, so only the interrupt path can end it.
   */
  const interruptChild = (hostListens: boolean) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "breaklint-interrupt-")));
    const profile = mkdtempSync(join(tmpdir(), "breaklint-chrome-profile-unit-"));
    writeFileSync(join(profile, "sentinel"), "owned");
    const doc = join(root, "doc.html");
    writeFileSync(doc, "<!doctype html><p>interrupted</p>");
    const renderRun = new URL("../../src/acquire/render-run.ts", import.meta.url).href;
    const script = `
      import { writeFileSync } from "node:fs";
      const { renderDocuments } = await import(${JSON.stringify(renderRun)});
      if (${hostListens}) process.on("SIGTERM", () => {});
      let closed = false; const pending = new Set();
      const never = () => new Promise((_resolve, reject) => { if (closed) reject(new Error("Target closed")); else pending.add(reject); });
      const page = new Proxy({}, { get: (_target, key) => key === "then" ? undefined : key === "on" ? () => {} : () => never() });
      const browser = {
        async newPage() { return page; },
        async createBrowserContext() { process.stdout.write("acquiring\\n"); return { async newPage() { return page; }, async close() {} }; },
        async version() { return "Fake/1"; },
        async close() { closed = true; writeFileSync(${JSON.stringify(join(root, "browser-closed"))}, ""); for (const reject of pending) reject(new Error("Target closed")); },
      };
      const result = await renderDocuments([${JSON.stringify(doc)}], {
        outDir: ${JSON.stringify(join(root, "out"))}, evidenceBinding: false, sourceMapInjection: true,
        network: { mode: "offline", allowed: [] }, locale: "de-DE",
      }, {
        async launchBrowser() { return { executablePath: "/fake", userDataDir: ${JSON.stringify(profile)}, detail: "", browser }; },
        async openRasterizer() { return { rasterizer: null, detail: "unit" }; },
      });
      process.stdout.write(JSON.stringify({ fatal: result.fatal }) + "\\n");
      process.exit(result.fatal?.exitCode ?? 0);
    `;
    const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => child.once("exit", (code, signal) => resolveExit({ code, signal })));
    return { root, profile, child, exited, output: () => ({ stdout, stderr }) };
  };

  // Mutation "no interrupt hold in renderDocuments": red, the child dies by the default SIGTERM
  // action without closing the browser, and the profile stays.
  it("an interrupt during acquisition closes the browser, removes the profile and ends by the signal", { timeout: 60_000 }, async (t) => {
    if (process.platform === "win32") return t.skip("POSIX signals");
    const run = interruptChild(false);
    try {
      await waitForObserved(() => run.output().stdout, (stdout) => stdout.includes("acquiring"), 30_000);
      run.child.kill("SIGTERM");
      const exit = await run.exited;
      assert.deepEqual(exit, { code: null, signal: "SIGTERM" }, `stderr: ${run.output().stderr}`);
      assert.ok(existsSync(join(run.root, "browser-closed")), "the browser was not closed before the process ended");
      assert.equal(existsSync(run.profile), false, "the interrupted run left its profile");
    } finally { run.child.kill("SIGKILL"); rmSync(run.root, { recursive: true, force: true }); rmSync(run.profile, { recursive: true, force: true }); }
  });

  // Mutation "report the interrupted render normally": red, the result is not fatal.
  it("an interrupt in a host that handles the signal itself cleans up and reports exit 3, never a result", { timeout: 60_000 }, async (t) => {
    if (process.platform === "win32") return t.skip("POSIX signals");
    const run = interruptChild(true);
    try {
      await waitForObserved(() => run.output().stdout, (stdout) => stdout.includes("acquiring"), 30_000);
      run.child.kill("SIGTERM");
      const exit = await run.exited;
      assert.deepEqual(exit, { code: 3, signal: null }, `stderr: ${run.output().stderr}`);
      const result = JSON.parse(run.output().stdout.trim().split("\n").at(-1)!) as { fatal: { exitCode: number; message: string } | null };
      assert.equal(result.fatal?.exitCode, 3);
      assert.match(result.fatal?.message ?? "", /interrupted by SIGTERM/u);
      assert.ok(existsSync(join(run.root, "browser-closed")));
      assert.equal(existsSync(run.profile), false);
    } finally { run.child.kill("SIGKILL"); rmSync(run.root, { recursive: true, force: true }); rmSync(run.profile, { recursive: true, force: true }); }
  });

  it("never signals caller or group siblings when the browser process group is shared", async () => {
    const root = 41_001, child = 41_002, sibling = 41_003;
    const alive = new Set([root, child, sibling, process.pid]);
    const signalled: number[] = [];
    const table = [
      { pid: root, ppid: 1, pgid: 77 },
      { pid: child, ppid: root, pgid: 77 },
      { pid: sibling, ppid: 1, pgid: 77 },
      { pid: process.pid, ppid: 1, pgid: 77 },
    ];
    const result = await terminateProcessTree(root, () => table, {
      alive: (pid) => alive.has(pid),
      signal(pid) { signalled.push(pid); alive.delete(Math.abs(pid)); },
      async wait() {},
    });
    assert.equal(result.groupSafe, false);
    assert.deepEqual(result.initialPids, [root, child]);
    assert.deepEqual(signalled.sort((a, b) => a - b), [root, child]);
    assert.equal(signalled.includes(process.pid), false);
    assert.equal(signalled.includes(sibling), false);
    assert.equal(result.verified, true);
  });

  it("kills a reparented child from the pre-close isolated process-group ownership snapshot", async () => {
    const root = 42_420, child = 42_421;
    const alive = new Set([child]);
    const signals: Array<[number, NodeJS.Signals]> = [];
    // This is the state after browser.close(): the root has gone, and its child was adopted by
    // launchd/init but retained the former isolated PGID. Without the pre-close ownership record,
    // the old code saw neither a root nor a descendant and returned verified:true without a signal.
    const result = await terminateProcessTree(
      root,
      () => [{ pid: child, ppid: 1, pgid: root }],
      {
        alive: (pid) => alive.has(pid),
        signal(pid, signal) {
          signals.push([pid, signal]);
          if (pid === -root) alive.delete(child);
        },
        async wait() {},
      },
      { pgid: root, groupSafe: true, initialPids: [root, child] },
    );
    assert.deepEqual(signals, [[-root, "SIGTERM"]], "the reparented child was silently certified instead of signalled");
    assert.deepEqual(result.survivingPids, []);
    assert.equal(result.verified, true);
  });

  it("captures and terminates a root descendant that has left the isolated browser process group", async () => {
    const root = 42_430, detachedChild = 42_431;
    const alive = new Set([root, detachedChild]);
    const table = [
      { pid: root, ppid: 1, pgid: root },
      { pid: detachedChild, ppid: root, pgid: detachedChild },
    ];
    const ownership = captureProcessTreeOwnership(root, () => table, (pid) => alive.has(pid));
    assert.deepEqual(ownership?.initialPids, [root, detachedChild]);
    const signals: number[] = [];
    const result = await terminateProcessTree(root, () => table, {
      alive: (pid) => alive.has(pid),
      signal(pid) {
        signals.push(pid);
        if (pid === -root) alive.delete(root);
        else alive.delete(pid);
      },
      async wait() {},
    }, ownership);
    assert.ok(signals.includes(-root));
    assert.ok(signals.includes(detachedChild), "the descendant outside the group was not signalled");
    assert.equal(result.verified, true);
  });

  it("verifies the PID tree even when browser.close resolves", async () => {
    let verified = 0;
    let captured = 0;
    let forwarded: { pgid: number | null; groupSafe: boolean; initialPids: number[] } | null | undefined;
    const error = await closeBrowserBounded({
      async newPage() { throw new Error("not reached"); }, async version() { return "Fake/1"; },
      process() { return { pid: 71_001 }; }, async close() {},
    }, async (pid, _readTable, _operations, ownership) => {
      verified += 1;
      forwarded = ownership;
      return {
        rootPid: pid, pgid: pid, initialPids: [pid], survivingPids: [pid], defunctPids: [], groupSafe: true,
        termSent: true, killSent: true, verified: false,
      };
    }, (pid) => {
      captured += 1;
      return { pgid: pid, groupSafe: true, initialPids: [pid] };
    });
    assert.equal(verified, 1);
    assert.equal(captured, 1);
    assert.deepEqual(forwarded, { pgid: 71_001, groupSafe: true, initialPids: [71_001] });
    assert.match(error ?? "", /survivors=71001/u);
  });

  it("refuses a resolved browser close when pre-close process ownership could not be observed", async () => {
    const error = await closeBrowserBounded({
      async newPage() { throw new Error("not reached"); }, async version() { return "Fake/1"; },
      process() { return { pid: 71_002 }; }, async close() {},
    }, async (pid) => ({
      rootPid: pid, pgid: null, initialPids: [], survivingPids: [], defunctPids: [], groupSafe: false,
      termSent: false, killSent: false, verified: true,
    }), () => null);
    assert.match(error ?? "", /pre-close process ownership unavailable/u);
  });

  it("does not mistake an already-gone root for an empty ownership snapshot", () => {
    const root = 42_420;
    const child = 42_421;
    const ownership = captureProcessTreeOwnership(root, () => [{ pid: child, ppid: 1, pgid: root }]);
    assert.equal(ownership, null, "a reparented child cannot establish ownership after its root vanished");
  });

  it("never verifies termination when a fresh ps table is unreadable", async () => {
    const absentPid = 999_999_999;
    let reads = 0;
    const termination = await terminateProcessTree(absentPid, () => {
      reads += 1;
      if (reads === 1) return [{ pid: absentPid, ppid: 1, pgid: absentPid }];
      throw new Error("ps unavailable after signal");
    });
    assert.equal(termination.verified, false);
    assert.ok(reads >= 2, "the verifier never attempted a fresh process-table read");
  });

  it("kills the known root but reports renderer-not-terminated when the initial ps table is unreadable", async (t) => {
    if (process.platform === "win32") return t.skip("POSIX process groups are unsupported on Windows");
    const child = detachedNode("setInterval(() => {}, 1000)");
    child.unref();
    const pid = child.pid;
    assert.ok(pid);
    const profile = mkdtempSync(join(tmpdir(), "breaklint-chrome-profile-unit-"));
    writeFileSync(join(profile, "sentinel"), "owned");
    const page: PageLike = {
      async goto() { throw new Error("stop before measurement"); },
      async setContent() {}, async evaluate() { throw new Error("not reached"); },
      async waitForFunction() {}, async emulateMediaType() {}, async setViewport() {},
      async pdf() { return new Uint8Array(); }, on() {}, async evaluateOnNewDocument() {},
      async setRequestInterception() {}, async close() {},
    };
    const result = await renderDocuments(["README.md"], OPTIONS, {
      async launchBrowser() {
        return {
          executablePath: "/measured/fake-chrome", userDataDir: profile, detail: "",
          browser: {
            async newPage() { return page; }, async version() { return "Fake/1"; },
            process() { return { pid }; }, async close() { throw new Error("close channel failed"); },
          },
        };
      },
      async openRasterizer() { return { rasterizer: null, detail: "not installed in unit" }; },
      terminateBrowserProcessTree: (rootPid) => terminateProcessTree(rootPid, () => {
        throw new Error("ps unavailable at initial read");
      }),
    });
    assert.equal(canRunCode(pid), false, "known browser root was not killed");
    assert.equal(existsSync(profile), false, "profile cleanup did not follow root escalation");
    assert.ok(result.documents[0]!.infrastructure.some((event) => event.kind === "renderer-not-terminated"));
  });

  it("bounds a hung rasterizer close and still reaches verified browser PID escalation", async (t) => {
    if (process.platform === "win32") return t.skip("POSIX process groups are unsupported on Windows");
    const child = detachedNode("setInterval(() => {}, 1000)");
    child.unref();
    const pid = child.pid;
    assert.ok(pid);
    const profile = mkdtempSync(join(tmpdir(), "breaklint-chrome-profile-unit-"));
    writeFileSync(join(profile, "sentinel"), "owned");
    await wait(100);
    const never = (): Promise<never> => new Promise(() => undefined);
    const rasterizer: Rasterizer = {
      name: "pdfjs-dist",
      version: "test",
      declaredVersion: "test",
      async rasterise() { return []; },
      async diff() { return { pagesA: 0, pagesB: 0, pixels: 0 }; },
      async dropPixels() {},
      async encodePng() { return new Uint8Array(); },
      async textItems() { return []; },
      pageErrors() { return []; },
      async release() {},
      close: never,
    };
    const page: PageLike = {
      async goto() { throw new Error("fixture acquisition stops before measurement"); },
      async setContent() {},
      async evaluate() { throw new Error("not reached"); },
      async waitForFunction() {},
      async emulateMediaType() {},
      async setViewport() {},
      async pdf() { return new Uint8Array(); },
      on() {},
      async evaluateOnNewDocument() {},
      async setRequestInterception() {},
      async close() {},
    };
    const started = Date.now();
    const result = await renderDocuments(["README.md"], OPTIONS, {
      async launchBrowser() {
        return {
          executablePath: "/measured/fake-chrome",
          userDataDir: profile,
          detail: "",
          browser: {
            async newPage() { return page; },
            async version() { return "Fake/1"; },
            process() { return { pid }; },
            close: never,
          },
        };
      },
      async openRasterizer() { return { rasterizer, detail: "" }; },
    });
    const elapsed = Date.now() - started;
    assert.equal(result.fatal, null);
    // Three separate claims, because one number used to carry all three and did none of them well.
    // (1) The product bound is 5 s — pinned against the constant itself, so raising it is a visible
    // decision rather than something a widened ceiling would absorb. (2) Cleanup waits that bound
    // out instead of giving up early. (3) It finishes rather than hanging; the ceiling only has to
    // separate those two, and at 8 s it left 3 s for scheduling on a machine that starts and reaps
    // processes meanwhile — measured 8700 ms under load, failing while the product was correct.
    assert.equal(BROWSER_CLOSE_TIMEOUT_MS, 5_000, "the product's close bound moved; this test is about that bound");
    assert.ok(elapsed >= BROWSER_CLOSE_TIMEOUT_MS, `cleanup gave up before its bound: ${elapsed} ms`);
    assert.ok(elapsed < 60_000, `cleanup hung rather than finishing: ${elapsed} ms`);
    assert.equal(canRunCode(pid), false, "browser PID can still run code after verified escalation");
    assert.equal(existsSync(profile), false, "the escalated browser left its explicit profile behind");
    const infrastructure = result.documents[0]!.infrastructure;
    assert.equal(infrastructure.some((event) => event.kind === "renderer-not-terminated"), false);
    assert.ok(infrastructure.some(
      (event) => event.kind === "checker-crashed" && event.measured?.stage === "rasterizer-close",
    ));
  });

  it("enforces the document timeout, cleans the PID/profile, and never starts the next document", async (t) => {
    if (process.platform === "win32") return t.skip("POSIX process groups are unsupported on Windows");
    const child = detachedNode("setInterval(() => {}, 1000)");
    child.unref();
    const pid = child.pid;
    assert.ok(pid);
    const profile = mkdtempSync(join(tmpdir(), "breaklint-chrome-profile-unit-"));
    writeFileSync(join(profile, "sentinel"), "owned");
    let pagesOpened = 0;
    let contextsClosed = 0;
    const never = (): Promise<never> => new Promise(() => undefined);
    const page: PageLike = {
      goto: never,
      async setContent() {},
      async evaluate() { throw new Error("not reached"); },
      async waitForFunction() {},
      async emulateMediaType() {},
      async setViewport() {},
      async pdf() { return new Uint8Array(); },
      on() {},
      async evaluateOnNewDocument() {},
      async setRequestInterception() {},
      async close() {},
    };
    const result = await renderDocuments(["README.md", "README.md"], OPTIONS, {
      documentTimeoutMs: 25,
      async launchBrowser() {
        return {
          executablePath: "/measured/fake-chrome", userDataDir: profile, detail: "",
          browser: {
            async newPage() { throw new Error("default context must not be used"); },
            async createBrowserContext() {
              return { async newPage() { pagesOpened += 1; return page; }, async close() { contextsClosed += 1; } };
            },
            async version() { return "Fake/1"; },
            process() { return { pid }; },
            close: never,
          },
        };
      },
      async openRasterizer() { return { rasterizer: null, detail: "not installed in unit" }; },
    });
    assert.equal(result.documents.length, 1);
    assert.equal(pagesOpened, 1);
    assert.equal(contextsClosed, 1, "renderDocuments returned before the timed-out acquisition joined its owned context cleanup");
    assert.ok(result.documents[0]!.infrastructure.some(
      (event) => event.kind === "checker-crashed" && event.measured?.stage === "document-timeout" &&
        event.measured.timeoutMs === 25,
    ));
    // Not `ESRCH`: the product's promise is that nothing of the tree can run code any more. The
    // pid itself is a child of this test process, which collects it on a later loop turn.
    assert.equal(canRunCode(pid), false, "the timed-out browser pid can still run code");
    assert.equal(existsSync(profile), false);
  });

  it("joins and closes a context that resolves only after the timeout abort", async () => {
    let resolveContext: ((context: { newPage(): Promise<PageLike>; close(): Promise<void> }) => void) | null = null;
    const lateContext = new Promise<{ newPage(): Promise<PageLike>; close(): Promise<void> }>((resolveContextPromise) => {
      resolveContext = resolveContextPromise;
    });
    let contextsClosed = 0;
    setTimeout(() => resolveContext?.({
      async newPage() { throw new Error("late context must be closed before it creates a page"); },
      async close() { contextsClosed += 1; },
    }), 45);
    const result = await renderDocuments(["README.md"], OPTIONS, {
      documentTimeoutMs: 20,
      async launchBrowser() {
        return { executablePath: "/fake", detail: "", browser: {
          async newPage() { throw new Error("default context forbidden"); },
          createBrowserContext: async () => lateContext,
          async version() { return "Fake/1"; }, async close() {},
        } };
      },
      async openRasterizer() { return { rasterizer: null, detail: "unit" }; },
    });
    assert.equal(contextsClosed, 1, "a context produced after abort escaped the real acquisition join");
    assert.equal(result.documents.length, 1);
    assert.equal(result.documents[0]!.snapshot, null);
    assert.equal(result.documents[0]!.infrastructure.some((event) =>
      event.measured?.stage === "document-timeout-join"), false,
    "a successfully joined late context must not be misclassified as an uncertified join");
  });

  it("reports a late context close failure at the final timeout-join boundary", async () => {
    let resolveContext: ((context: { newPage(): Promise<PageLike>; close(): Promise<void> }) => void) | null = null;
    const lateContext = new Promise<{ newPage(): Promise<PageLike>; close(): Promise<void> }>((resolve) => {
      resolveContext = resolve;
    });
    let aborted = 0;
    const originalAbort = AbortController.prototype.abort;
    AbortController.prototype.abort = function (this: AbortController, reason?: unknown): void {
      originalAbort.call(this, reason);
      const resolve = resolveContext;
      if (resolve) {
        resolveContext = null;
        aborted += 1;
        resolve({
          async newPage() { throw new Error("late context must not create a page"); },
          async close() { throw new Error("late context close refused"); },
        });
      }
    };
    let result: Awaited<ReturnType<typeof renderDocuments>>;
    try {
      result = await renderDocuments(["README.md"], OPTIONS, {
        documentTimeoutMs: 20,
        async launchBrowser() {
          return { executablePath: "/fake", detail: "", browser: {
            async newPage() { throw new Error("default context forbidden"); },
            createBrowserContext: async () => lateContext,
            async version() { return "Fake/1"; }, async close() {},
          } };
        },
        async openRasterizer() { return { rasterizer: null, detail: "unit" }; },
      });
    } finally {
      AbortController.prototype.abort = originalAbort;
    }
    assert.equal(aborted, 1, "the fixture must resolve its context from the observed timeout abort");
    assert.ok(result.documents[0]!.infrastructure.some((event) =>
      event.kind === "checker-crashed" && event.measured?.stage === "document-timeout-join" &&
      /late context close refused/u.test(event.detail)));
  });

  it("joins and closes a page that resolves only after the timeout abort", async () => {
    let resolvePage: ((page: PageLike) => void) | null = null;
    const latePage = new Promise<PageLike>((resolvePagePromise) => { resolvePage = resolvePagePromise; });
    let pagesClosed = 0;
    const page = {
      async goto() {}, async setContent() {}, async evaluate() { return undefined; }, async waitForFunction() {},
      async emulateMediaType() {}, async setViewport() {}, async pdf() { return new Uint8Array(); }, on() {},
      async evaluateOnNewDocument() {}, async setRequestInterception() {}, async close() { pagesClosed += 1; },
    } as unknown as PageLike;
    setTimeout(() => resolvePage?.(page), 45);
    const result = await renderDocuments(["README.md"], OPTIONS, {
      documentTimeoutMs: 20,
      async launchBrowser() {
        return { executablePath: "/fake", detail: "", browser: {
          async newPage() { throw new Error("default context forbidden"); },
          async createBrowserContext() { return { newPage: async () => latePage, async close() {} }; },
          async version() { return "Fake/1"; }, async close() {},
        } };
      },
      async openRasterizer() { return { rasterizer: null, detail: "unit" }; },
    });
    assert.equal(pagesClosed, 1, "a page produced after abort escaped the real acquisition join");
    assert.equal(result.documents.length, 1);
    assert.equal(result.documents[0]!.snapshot, null);
  });

  it("bounds a driver that never joins after abort and reports the uncertified cleanup", async () => {
    const started = Date.now();
    const result = await renderDocuments(["README.md"], OPTIONS, {
      documentTimeoutMs: 20,
      async launchBrowser() {
        return { executablePath: "/fake", detail: "", browser: {
          async newPage() { throw new Error("default context forbidden"); },
          createBrowserContext: async () => new Promise<never>(() => undefined),
          async version() { return "Fake/1"; }, async close() {},
        } };
      },
      async openRasterizer() { return { rasterizer: null, detail: "unit" }; },
    });
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 5_000 && elapsed < 7_000, `unbounded late-ownership join: ${elapsed} ms`);
    assert.ok(result.documents[0]!.infrastructure.some((event) =>
      event.kind === "checker-crashed" &&
      /(?:late owned resource join|timed-out acquisition final join)/u.test(event.detail)));
  });

  it("closes a newly owned context when newPage rejects and never starts a later document", async () => {
    let contextsCreated = 0;
    let contextsClosed = 0;
    const result = await renderDocuments(["README.md", "README.md"], OPTIONS, {
      async launchBrowser() {
        return {
          executablePath: "/measured/fake-chrome", detail: "",
          browser: {
            async newPage() { throw new Error("default context must not be used"); },
            async createBrowserContext() {
              contextsCreated += 1;
              return {
                async newPage() { throw new Error("target creation rejected"); },
                async close() { contextsClosed += 1; },
              };
            },
            async version() { return "Fake/1"; },
            async close() {},
          },
        };
      },
      async openRasterizer() { return { rasterizer: null, detail: "unit" }; },
    });
    assert.equal(contextsCreated, 1);
    assert.equal(contextsClosed, 1, "the context established before newPage rejection leaked");
    assert.equal(result.documents.length, 1, "ownership failure allowed the later document to start");
    assert.ok(result.documents[0]!.infrastructure.some((event) =>
      event.kind === "checker-crashed" && /target creation rejected/u.test(event.detail)));
  });

  it("a browser-driver reset becomes checker-crashed and exit 3", async () => {
    const page: PageLike = {
      async goto() { throw new Error("control channel reset"); },
      async setContent() {},
      async evaluate() { throw new Error("not reached"); },
      async waitForFunction() {},
      async emulateMediaType() {},
      async setViewport() {},
      async pdf() { return new Uint8Array(); },
      on() {},
      async evaluateOnNewDocument() {},
      async setRequestInterception() {},
      async close() {},
    };
    const dependencies: RenderDependencies = {
      async launchBrowser() {
        return {
          executablePath: "/measured/fake-chrome",
          detail: "",
          browser: {
            async newPage() { throw new Error("default context must not be used"); },
            async createBrowserContext() { return { async newPage() { return page; }, async close() {} }; },
            async version() { return "Fake/1"; }, async close() {},
          },
        };
      },
      async openRasterizer() { return { rasterizer: null, detail: "injected boundary test" }; },
    };
    const result = await renderDocuments(["README.md"], OPTIONS, dependencies);
    assert.equal(result.fatal, null);
    assert.equal(result.documents.length, 1);
    const doc = result.documents[0]!;
    assert.equal(doc.snapshot, null);
    assert.ok(doc.infrastructure.some((event) => event.kind === "checker-crashed"));
    assert.match(doc.infrastructure[0]!.detail, /control channel reset/u);
    const fatal = doc.infrastructure.filter(
      (event) => !(NON_FATAL_INFRA_EVENT_KINDS as readonly string[]).includes(event.kind),
    );
    assert.ok(fatal.length > 0);
    assert.equal(exitCodeFor(result.documents), 3, "the process failure must not collapse to coverage exit 4");
  });

  it("closes the document loopback despite a content-page close rejection and starts no later document", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "breaklint-close-rejection-"));
    const fixture = join(fixtureRoot, "empty.html");
    writeFileSync(fixture, "<!doctype html><html><body></body></html>");
    let contexts = 0;
    let integrityReads = 0;
    let loopbackPort: number | null = null;
    const page = {
      async goto(url: string) { loopbackPort = Number(new URL(url).port); }, async setContent() {},
      async evaluate(source: string) {
        if (source.includes("domNodes:")) return { pages: 0, domNodes: 1 };
        if (source.includes("installCollector(") || source.includes("lockPagination(") ||
            source.includes('data-breaklint-intervention", "animations-disabled"')) return undefined;
        if (source.includes("effectViolations")) {
          return { count: 1, connected: true, ruleIntact: true, effectViolations: 0 };
        }
        if (source.includes("integrityStatus(")) {
          integrityReads += 1;
          return {
            sidMutations: 0, mutationRecordsAfterRendered: 0,
            paginationPreviewCalls: integrityReads === 1 ? 0 : 1, sids: [],
          };
        }
        if (source.includes("failedFonts")) return { failedFonts: [], failedImages: [] };
        if (source.includes("breakBefore")) return {};
        if (source.includes("new Paged.Previewer")) return { paginationError: null };
        throw new Error("measurement boundary failed after page ownership was established");
      }, async waitForFunction() {},
      async emulateMediaType() {}, async setViewport() {}, async pdf() { return new Uint8Array(); },
      on() {}, async evaluateOnNewDocument() {}, async setRequestInterception() {},
      async close() { throw new Error("page close rejected"); },
    } as unknown as PageLike;
    try {
      const result = await renderDocuments([fixture, fixture], { ...OPTIONS, sourceMapInjection: false }, {
        async launchBrowser() {
          return { executablePath: "/fake", detail: "", browser: {
            async newPage() { throw new Error("default context forbidden"); },
            async createBrowserContext() { contexts += 1; return { async newPage() { return page; }, async close() {} }; },
            async version() { return "Fake/1"; }, async close() {},
          } };
        },
        async openRasterizer() { return { rasterizer: null, detail: "unit" }; },
      });
      assert.equal(contexts, 1);
      assert.equal(result.documents.length, 1);
      assert.match(result.documents[0]!.infrastructure[0]!.detail, /page close rejected/u);
      assert.equal(result.documents[0]!.infrastructure[0]!.measured?.stage, "document-cleanup");
      assert.ok(loopbackPort !== null && loopbackPort > 0, "the positive-control loopback never listened");
      const refusal = createConnection({ host: "127.0.0.1", port: loopbackPort });
      const [error] = await once(refusal, "error") as [NodeJS.ErrnoException];
      assert.equal(error.code, "ECONNREFUSED", "page-close failure left the owned document server listening");
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("a corrupted injected source offset aborts before browser measurement", async () => {
    let pagesOpened = 0;
    const dependencies: RenderDependencies = {
      async launchBrowser() {
        return {
          executablePath: "/measured/fake-chrome",
          detail: "",
          browser: {
            async newPage() { pagesOpened += 1; throw new Error("must not be reached"); },
            async version() { return "Fake/1"; },
            async close() {},
          },
        };
      },
      async openRasterizer() { return { rasterizer: null, detail: "provenance sabotage" }; },
      injectSourceIds(source, file) {
        const injected = injectSourceIds(source, file);
        const sid = Object.keys(injected.map)[0]!;
        injected.map[sid]!.offset += 1;
        return injected;
      },
    };
    const result = await renderDocuments(["tests/fixtures/live-chain.html"], OPTIONS, dependencies);
    assert.equal(pagesOpened, 0);
    assert.equal(result.documents[0]!.snapshot, null);
    assert.equal(result.documents[0]!.infrastructure[0]!.measured?.stage, "provenance");
    assert.ok(Number(result.documents[0]!.infrastructure[0]!.measured?.issues) >= 1, "every corrupted source range must remain fatal");
    assert.equal(exitCodeFor(result.documents), 3);
  });

  it("the paged.js gate reads the version from the artefact that would be loaded", () => {
    const resolved = resolvePagedjs(process.cwd());
    assert.equal(resolved.ok, true, "this repository pins the supported version, so the gate must pass here");
    assert.equal(resolved.version, "0.4.3");
    assert.ok(resolved.path?.endsWith(".js"), "the gate resolves a bundle file, not a directory guess");
  });

  it("an unsupported paged.js is refused with no override offered", () => {
    // Resolving from a directory with no `pagedjs` reachable exercises the refusal path.
    const resolved = resolvePagedjs("/");
    assert.equal(resolved.ok, false);
    assert.match(resolved.detail, /install:/u, "the refusal carries a command that fixes it");
  });

  it("projects page evidence and SID conformance onto a rule finding", () => {
    const snapshot = loadCorpus().find((entry) => entry.name === "spaced-hyphen-trigger")!.snapshot;
    const sid = snapshot.blocks[0]!.sid!;
    const outcome = runDocument(
      {
        path: "doc.html",
        snapshot,
        infrastructure: [],
        evidence: [{
          key: "doc#1", page: 1, path: "evidence/doc-page-001.png", origin: "pdf-raster",
          pdfConformance: "verified", conformance: null,
          overlayCheck: { styleViolations: 0, rasterDiffPx: 0, removed: false }, bindsFinding: true,
        }],
        boundSids: [sid],
      },
      { failOn: "warn", activeRules: [spacedHyphen], optionsByRule: {}, coverageFloors: {} },
    );
    assert.equal(outcome.report.findings.length, 1);
    assert.deepEqual(outcome.report.findings[0]!.evidence, {
      ref: "evidence/doc-page-001.png",
      bindsFinding: true,
    });
    assert.equal(outcome.report.evidence.length, 1);
  });

  it("withdraws an otherwise usable snapshot when evidence itself adds a fatal event", () => {
    const snapshot = loadCorpus().find((entry) => entry.name === "spaced-hyphen-trigger")!.snapshot;
    const evidence = {
      evidence: [{
        key: "doc#1", page: 1, path: "doc-page-001.png", origin: "pdf-raster",
        pdfConformance: "verified", conformance: null,
        overlayCheck: { styleViolations: 0, rasterDiffPx: 0, removed: false }, bindsFinding: true,
      }],
      infrastructure: [{ kind: "checker-crashed", detail: "PNG encode failed after PDF reconciliation", measured: { stage: "evidence" } }],
      notMeasured: [], boundSids: new Set([snapshot.blocks[0]!.sid!]), marks: [], ambiguousMarks: 0,
      deliveredPdf: new Uint8Array(), deliveredWithOverlay: false, overlayInstalled: false,
      pdfArtifact: { path: "doc-checked.pdf", sha256: "a".repeat(64), byteLength: 17 },
      candidates: { marked: null, baseline: new Uint8Array() },
    } satisfies EvidenceOutcome;
    const result = finalizeEvidenceAcquisition("doc.html", snapshot, [], evidence);
    assert.equal(result.snapshot, null, "fatal evidence must withdraw the measured snapshot");
    assert.deepEqual(result.evidence, [], "fatal evidence must not be published");
    assert.deepEqual(result.boundSids, [], "fatal evidence must not bind future findings");
    assert.equal(result.renderArtifact?.kind, "diagnostic-pdf");
    assert.equal(result.renderArtifact?.delivery, "not-asserted");
    assert.equal(result.renderArtifact?.sha256, "a".repeat(64));
    const engine = runDocument(result, {
      failOn: "error", activeRules: [spacedHyphen], optionsByRule: {}, coverageFloors: {},
    });
    assert.equal(engine.report.findings.length, 0, "withdrawn evidence must leave no snapshot for rules to inspect");
    assert.deepEqual(engine.report.renderArtifact, result.renderArtifact, "the diagnostic PDF survives without claiming valid measurement");
    assert.equal(exitCodeFor([result]), 3);
  });

  it("withdraws completed findings and bindings if browser cleanup later becomes fatal", () => {
    const snapshot = loadCorpus().find((entry) => entry.name === "spaced-hyphen-trigger")!.snapshot;
    const sid = snapshot.blocks[0]!.sid!;
    const document: DocumentInput = {
      path: "doc.html", snapshot, infrastructure: [{ kind: "renderer-not-terminated", detail: "post-close survivor", measured: null }],
      evidence: [{
        key: "doc#1", page: 1, path: "doc-page-001.png", origin: "pdf-raster",
        pdfConformance: "verified", conformance: null,
        overlayCheck: { styleViolations: 0, rasterDiffPx: 0, removed: false }, bindsFinding: true,
      }], boundSids: [sid],
    };
    withdrawFatalCleanupDocuments([document]);
    const outcome = runDocument(document, {
      failOn: "error", activeRules: [spacedHyphen], optionsByRule: {}, coverageFloors: {},
    });
    assert.equal(document.snapshot, null);
    assert.deepEqual(document.evidence, []);
    assert.deepEqual(document.boundSids, []);
    assert.equal(outcome.report.findings.length, 0);
    assert.equal(exitCodeFor([document]), 3);
  });

  it("projects evidence apparatus declines into the document report independently of rules", () => {
    const snapshot = loadCorpus().find((entry) => entry.name === "spaced-hyphen-trigger")!.snapshot;
    const decline = {
      scope: "document" as const, ruleId: null, reason: "env/evidence-overlay-removed" as const,
      target: null, count: 2,
    };
    const outcome = runDocument(
      { path: "doc.html", snapshot, infrastructure: [], notMeasured: [decline] },
      { failOn: "never", activeRules: [], optionsByRule: {}, coverageFloors: {} },
    );
    assert.deepEqual(outcome.report.notMeasured, [decline]);

    const noSnapshot = runDocument(
      { path: "doc.html", snapshot: null, infrastructure: [], notMeasured: [decline] },
      { failOn: "never", activeRules: [], optionsByRule: {}, coverageFloors: {} },
    );
    assert.deepEqual(noSnapshot.report.notMeasured, [decline]);
  });
});

describe("breaklint's own interrupt handling while it owns a browser", () => {
  /** A fake `process`: listeners, a listener count that includes foreign ones, and a recorded kill. */
  function fakeHost(foreign: Partial<Record<InterruptSignal, number>> = {}) {
    const listeners = new Map<InterruptSignal, Set<(signal: InterruptSignal) => void>>();
    const events: string[] = [];
    const host: SignalHost = {
      pid: 4_242,
      on(signal, listener) { (listeners.get(signal) ?? listeners.set(signal, new Set()).get(signal)!).add(listener); },
      off(signal, listener) { listeners.get(signal)?.delete(listener); },
      listenerCount: (signal) => (listeners.get(signal)?.size ?? 0) + (foreign[signal] ?? 0),
      kill(pid, signal) { events.push(`kill ${pid} ${signal} listeners=${listeners.get(signal)?.size ?? 0}`); },
    };
    const emit = (signal: InterruptSignal) => { for (const listener of [...(listeners.get(signal) ?? [])]) listener(signal); };
    const installed = () => INTERRUPT_SIGNALS.map((signal) => listeners.get(signal)?.size ?? 0);
    return { host, emit, events, installed };
  }
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  // Mutation "no re-raise" (finish never calls kill): red. Mutation "re-raise before cleanup": red
  // on the event order. Mutation "listeners left installed": red on listeners=0.
  it("cleans up first, then removes its listeners and ends the process by the same signal", async () => {
    const { host, emit, events, installed } = fakeHost();
    const registry = createInterruptRegistry(host, 1_000);
    const hold = registry.hold({
      async cleanup() { events.push("cleanup:start"); await tick(); events.push("cleanup:end"); },
      force() { events.push("force"); },
    });
    assert.deepEqual(installed(), [1, 1, 1], "no listener while a browser is owned");
    emit("SIGTERM");
    assert.equal(await hold.settled(), "SIGTERM");
    assert.equal(hold.interrupted(), "SIGTERM");
    assert.deepEqual(events, ["cleanup:start", "cleanup:end", "kill 4242 SIGTERM listeners=0"]);
    assert.deepEqual(installed(), [0, 0, 0]);
  });

  // Mutation "re-raise regardless of other listeners": red.
  it("never ends a host that listens for the signal itself; the interrupted hold still settles", async () => {
    const { host, emit, events, installed } = fakeHost({ SIGINT: 1 });
    const registry = createInterruptRegistry(host, 1_000);
    const hold = registry.hold({ async cleanup() { events.push("cleanup"); }, force() { events.push("force"); } });
    emit("SIGINT");
    assert.equal(await hold.settled(), "SIGINT");
    assert.deepEqual(events, ["cleanup"], "the host's own SIGINT decision was overridden");
    hold.release();
    assert.deepEqual(installed(), [0, 0, 0], "listeners outlived the last hold");
  });

  // Mutation "second signal waits like the first": red, force is never called.
  it("forces the cleanup and ends at once on a second signal", async () => {
    const { host, emit, events } = fakeHost();
    const registry = createInterruptRegistry(host, 60_000);
    const hold = registry.hold({ cleanup: () => new Promise<void>(() => { events.push("cleanup:hangs"); }), force() { events.push("force"); } });
    emit("SIGINT");
    await tick();
    emit("SIGINT");
    assert.equal(await hold.settled(), "SIGINT");
    assert.deepEqual(events, ["cleanup:hangs", "force", "kill 4242 SIGINT listeners=0"]);
  });

  // Mutation "no bound": red, the hold never settles and the test times out.
  it("forces a cleanup that outlives its bound, then ends", { timeout: 5_000 }, async () => {
    const { host, emit, events } = fakeHost();
    const registry = createInterruptRegistry(host, 20);
    const hold = registry.hold({ cleanup: () => new Promise<void>(() => undefined), force() { events.push("force"); } });
    emit("SIGHUP");
    assert.equal(await hold.settled(), "SIGHUP");
    assert.deepEqual(events, ["force", "kill 4242 SIGHUP listeners=0"]);
  });

  it("installs nothing without a hold and leaves the default signal behaviour after the last release", () => {
    const { host, installed } = fakeHost();
    const registry = createInterruptRegistry(host, 1_000);
    assert.deepEqual(installed(), [0, 0, 0]);
    const first = registry.hold({ async cleanup() {}, force() {} });
    const second = registry.hold({ async cleanup() {}, force() {} });
    assert.deepEqual(installed(), [1, 1, 1], "one listener per signal, however many holds");
    first.release();
    assert.deepEqual(installed(), [1, 1, 1]);
    second.release();
    assert.deepEqual(installed(), [0, 0, 0]);
  });
});

/*
 * The browser launch, driven through the real driver against a fake browser binary: a shell
 * script that records its argv and its open descriptors, says something on stderr, and then
 * either exits (a browser that cannot load a library) or hangs (a browser that never answers).
 * No Chrome is involved, so this runs everywhere the suite runs; POSIX shells only.
 */
describe("browser launch: pipe transport, one bound for the whole start, a diagnosable failure", { concurrency: false }, () => {
  function fakeBrowser(mode: "exit" | "hang") {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "breaklint-fake-browser-")));
    const exe = join(root, "fake-chrome");
    writeFileSync(exe, [
      "#!/bin/sh",
      `printf '%s\\n' "$@" > '${root}/argv'`,
      `ls /proc/$$/fd > '${root}/fds' 2>/dev/null || true`,
      mode === "exit"
        ? "echo 'fake-chrome: error while loading shared libraries: libnss3.so: cannot open shared object file' >&2; exit 127"
        : `echo 'fake-chrome: starting, then never answering' >&2; echo $$ > '${root}/pid'; exec sleep 300`,
      "",
    ].join("\n"));
    chmodSync(exe, 0o755);
    return { root, exe };
  }
  async function withBrowserEnv<T>(exe: string, tmp: string, run: () => Promise<T>): Promise<T> {
    const saved = { chrome: process.env.BREAKLINT_CHROME, tmp: process.env.TMPDIR };
    process.env.BREAKLINT_CHROME = exe;
    process.env.TMPDIR = tmp;
    try { return await run(); } finally {
      if (saved.chrome === undefined) delete process.env.BREAKLINT_CHROME; else process.env.BREAKLINT_CHROME = saved.chrome;
      if (saved.tmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved.tmp;
    }
  }
  const REPO = fileURLToPath(new URL("../..", import.meta.url));

  // Mutation "pipe: false": red on --remote-debugging-pipe. Mutation "drop the stderr watch":
  // red on the library line. Mutation "keep the profile on a failed launch": red on the profile.
  it("reports a browser that dies at start with what it said on stderr, and removes the profile", { timeout: 20_000 }, async (t) => {
    if (process.platform === "win32") return t.skip("the fake browser is a POSIX shell script");
    const fake = fakeBrowser("exit");
    const tmp = join(fake.root, "tmp");
    mkdirSync(tmp);
    try {
      const error = await withBrowserEnv(fake.exe, tmp, () => launchBrowser(REPO).then(() => null, (caught: unknown) => caught as Error));
      assert.ok(error, "a browser that exits 127 at start was reported as launched");
      assert.match(error.message, /the browser failed to start/u);
      assert.match(error.message, /libnss3\.so: cannot open shared object file/u, "the browser's own explanation was lost");
      assert.match(error.message, /after \d+ ms; launch bound 30000 ms/u);
      const argv = readFileSync(join(fake.root, "argv"), "utf8").split("\n");
      assert.ok(argv.includes("--remote-debugging-pipe"), "the browser was not started on the pipe transport");
      assert.equal(argv.some((arg) => arg.startsWith("--remote-debugging-port")), false, "a DevTools TCP port was opened");
      assert.deepEqual(readdirSync(tmp).filter((name) => name.startsWith("breaklint-chrome-profile-")), [], "the failed launch left its profile");
    } finally { rmSync(fake.root, { recursive: true, force: true }); }
  });

  // Mutation "throw without waiting for the handler" (drop the settled() wait in launchBrowser's
  // failure path): red, the process ends with the caller's exit 3 instead of by the signal.
  it("an interrupt during browser start-up kills the browser, removes the profile and ends by the signal", { timeout: 60_000 }, async (t) => {
    if (process.platform === "win32") return t.skip("the fake browser is a POSIX shell script");
    const fake = fakeBrowser("hang");
    const tmp = join(fake.root, "tmp");
    mkdirSync(tmp);
    const browserTs = new URL("../../src/acquire/browser.ts", import.meta.url).href;
    // The caller behaves like the CLI: a failed launch becomes exit 3.
    const script = `const { launchBrowser } = await import(${JSON.stringify(browserTs)});
      launchBrowser(${JSON.stringify(REPO)}).then(() => process.exit(0), (error) => { process.stderr.write(String(error?.message)); process.exit(3); });`;
    const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
      stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, BREAKLINT_CHROME: fake.exe, TMPDIR: tmp },
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => child.once("exit", (code, signal) => resolveExit({ code, signal })));
    try {
      await waitForObserved(() => existsSync(join(fake.root, "pid")), (present) => present, 30_000);
      const pid = Number(readFileSync(join(fake.root, "pid"), "utf8"));
      child.kill("SIGINT");
      assert.deepEqual(await exited, { code: null, signal: "SIGINT" }, `stderr: ${stderr}`);
      assert.equal(canRunCode(pid), false, "the browser outlived the interrupted start-up");
      assert.deepEqual(readdirSync(tmp).filter((name) => name.startsWith(PROFILE_PREFIX)), [], "the interrupted start-up left its profile");
    } finally {
      child.kill("SIGKILL");
      try { process.kill(Number(readFileSync(join(fake.root, "pid"), "utf8")), "SIGKILL"); } catch { /* gone */ }
      rmSync(fake.root, { recursive: true, force: true });
    }
  });

  // Mutation "rely on the driver's timeout": red, the hang outlives the 1.5 s bound (the driver's
  // timeout does not cover the pipe handshake). Mutation "handleSIGHUP: true": red on the count.
  it("bounds a browser that never answers, kills its group, and keeps the driver's signal handlers out", { timeout: 30_000 }, async (t) => {
    if (process.platform === "win32") return t.skip("the fake browser is a POSIX shell script");
    const fake = fakeBrowser("hang");
    const tmp = join(fake.root, "tmp");
    mkdirSync(tmp);
    const listeners: number[] = [];
    const records: Array<Partial<ProfileOwnerRecord>> = [];
    const sampler = setInterval(() => {
      listeners.push(process.listenerCount("SIGHUP"));
      for (const name of readdirSync(tmp).filter((entry) => entry.startsWith(PROFILE_PREFIX))) {
        try { records.push(JSON.parse(readFileSync(join(tmp, name, PROFILE_OWNER_FILE), "utf8"))); } catch { /* not written yet */ }
      }
    }, 50);
    try {
      const started = Date.now();
      const error = await withBrowserEnv(fake.exe, tmp, () => launchBrowser(REPO, { launchTimeoutMs: 1_500 }).then(() => null, (caught: unknown) => caught as Error));
      const elapsed = Date.now() - started;
      assert.ok(error, "a browser that never answers was reported as launched");
      assert.match(error.message, /did not finish starting within 1500 ms/u);
      assert.match(error.message, /fake-chrome: starting, then never answering/u);
      assert.ok(elapsed < 15_000, `the launch bound did not hold: ${elapsed} ms`);
      const pid = Number(readFileSync(join(fake.root, "pid"), "utf8"));
      assert.equal(canRunCode(pid), false, "the hung browser survived its failed launch");
      // The profile carried an owner record naming this process and, once spawned, the browser.
      assert.ok(records.some((record) => record.pid === process.pid && record.browserPid === pid), `owner records seen: ${JSON.stringify(records.slice(-2))}`);
      assert.deepEqual(readdirSync(tmp).filter((name) => name.startsWith("breaklint-chrome-profile-")), []);
      // While the launch was pending exactly one SIGHUP listener existed: breaklint's own.
      assert.ok(listeners.length > 0 && listeners.every((count) => count <= 1), `SIGHUP listeners during launch: ${[...new Set(listeners)]}`);
      assert.ok(listeners.includes(1), "breaklint's own interrupt listener was not installed during launch");
    } finally {
      clearInterval(sampler);
      try { process.kill(Number(readFileSync(join(fake.root, "pid"), "utf8")), "SIGKILL"); } catch { /* gone, as asserted */ }
      rmSync(fake.root, { recursive: true, force: true });
    }
  });
});

describe("start-up sweep of profiles that a killed run left behind", () => {
  const HOST = "soak-host";
  function sweepFixture() {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), "breaklint-sweep-fixture-")));
    const livePids = new Set<number>();
    const liveGroups = new Set<number>();
    let clock = Date.now();
    const environment: ProfileSweepEnvironment = {
      tmp, hostname: HOST, uid: typeof process.getuid === "function" ? process.getuid() : null,
      bootId: "boot-a", pidNamespace: "pid:[1]",
      alive: (pid) => livePids.has(pid), groupAlive: (pgid) => liveGroups.has(pgid), now: () => clock,
    };
    const profile = (name: string, owner: Partial<ProfileOwnerRecord> | null, lock?: string) => {
      const path = join(tmp, `${PROFILE_PREFIX}${name}`);
      mkdirSync(path);
      writeFileSync(join(path, "Local State"), "{}");
      if (owner) writeFileSync(join(path, PROFILE_OWNER_FILE), JSON.stringify({
        tool: "breaklint", pid: 70_001, hostname: HOST, bootId: "boot-a", pidNamespace: "pid:[1]", browserPid: null, ...owner,
      }));
      if (lock) symlinkSync(lock, join(path, "SingletonLock"));
      return path;
    };
    return { tmp, environment, livePids, liveGroups, profile, advance: (ms: number) => { clock += ms; }, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
  }
  const reasonFor = (result: ProfileSweepResult, path: string) => result.kept.find((entry) => entry.path === path)?.reason;

  // Mutation "owner liveness not checked": red on the concurrent run. Mutation "browser group not
  // checked": red on the live browser. Mutation "identity not compared": red on the three foreign
  // records. Mutation "no age guard without a lock": red on the young lockless profile.
  it("removes only profiles whose owner and browser are provably gone, and never a running one", () => {
    const f = sweepFixture();
    try {
      const dead = f.profile("dead", { pid: 70_001, browserPid: 70_101 });
      const concurrent = f.profile("concurrent", { pid: 70_002, browserPid: 70_102 });
      f.livePids.add(70_002); f.liveGroups.add(70_102);
      const browserAlive = f.profile("browser-alive", { pid: 70_003, browserPid: 70_103 });
      f.liveGroups.add(70_103);
      const otherHost = f.profile("other-host", { hostname: "elsewhere" });
      const otherNamespace = f.profile("other-namespace", { pidNamespace: "pid:[2]" });
      const otherBoot = f.profile("other-boot", { bootId: "boot-b" });
      const noRecord = f.profile("no-record", null);
      const lockDead = f.profile("lock-dead", { pid: 70_004 }, `${HOST}-70104`);
      const lockAlive = f.profile("lock-alive", { pid: 70_005 }, `${HOST}-70105`);
      f.livePids.add(70_105);
      const lockForeign = f.profile("lock-foreign", { pid: 70_006 }, "elsewhere-70106");
      const young = f.profile("young", { pid: 70_007 });
      symlinkSync(dead, join(f.tmp, `${PROFILE_PREFIX}symlink`));
      const result = sweepStaleBrowserProfiles(f.environment);
      assert.deepEqual(result.removed.sort(), [dead, lockDead].sort());
      assert.equal(existsSync(dead) || existsSync(lockDead), false);
      assert.equal(reasonFor(result, concurrent), "its breaklint process is still running");
      assert.equal(reasonFor(result, browserAlive), "its browser process group still has a live member");
      for (const foreign of [otherHost, otherNamespace, otherBoot]) {
        assert.equal(reasonFor(result, foreign), "owner record names another host, boot or pid namespace");
      }
      assert.equal(reasonFor(result, noRecord), "no readable breaklint owner record");
      assert.equal(reasonFor(result, lockAlive), "its browser is still running");
      assert.equal(reasonFor(result, lockForeign), "browser lock names another host");
      assert.equal(reasonFor(result, young), "no browser record and changed too recently");
      assert.equal(reasonFor(result, join(f.tmp, `${PROFILE_PREFIX}symlink`)), "not a real directory");
      for (const kept of [concurrent, browserAlive, otherHost, otherNamespace, otherBoot, noRecord, lockAlive, lockForeign, young]) {
        assert.ok(existsSync(join(kept, "Local State")), `a kept profile was modified: ${kept}`);
      }
      // A minute later the lockless profile of a dead owner is stale; the rest still are not.
      f.advance(STALE_PROFILE_MIN_AGE_MS + 5_000);
      assert.deepEqual(sweepStaleBrowserProfiles(f.environment).removed, [young]);
    } finally { f.cleanup(); }
  });

  it("keeps the profile of a real running process and removes it once that process has gone", async () => {
    const f = sweepFixture();
    const owner = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    try {
      assert.ok(owner.pid);
      const path = f.profile("real-owner", { pid: owner.pid, browserPid: null }, `${HOST}-${owner.pid}`);
      const live = { ...f.environment, alive, groupAlive: () => false };
      assert.deepEqual(sweepStaleBrowserProfiles(live).removed, [], "the profile of a running owner was swept");
      owner.kill("SIGKILL");
      await once(owner, "exit");
      await waitForObserved(() => sweepStaleBrowserProfiles(live).removed, (removed) => removed.includes(path));
    } finally { owner.kill("SIGKILL"); f.cleanup(); }
  });

  it("states the owner identity a sweep compares: host, and on Linux boot and pid namespace", async (t) => {
    if (process.platform === "win32") return t.skip("the sweep is POSIX only");
    const record = profileOwnerIdentity();
    assert.equal(record.hostname, hostname());
    if (process.platform === "linux") {
      assert.match(record.bootId ?? "", /^[0-9a-f-]{36}$/u);
      assert.match(record.pidNamespace ?? "", /^pid:\[\d+\]$/u);
    }
  });
});
