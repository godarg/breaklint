/**
 * The live path and its process-boundary failure.
 *
 * The old test pinned a hard-coded "not built" event. M2d removes that branch, so this test breaks
 * the actual browser-driver boundary and pushes the acquisition result through the real engine.
 * Removing checker-crashed from the catch turns the result into exit 4 and reddens the assertion.
 */

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { buildReport } from "../../src/core/build-report.ts";
import { runDocument } from "../../src/core/engine.ts";
import { NON_FATAL_INFRA_EVENT_KINDS } from "../../src/core/enums.ts";
import {
  closeBrowserBounded,
  collisionSources,
  discoverLocalAssets,
  documentArtifactKey,
  operationalLimitEvents,
  orderedSourceSids,
  paginationApparatusSource,
  renderDocuments,
  resolvePagedjs,
  validateRuntimeSidState,
  withPagination,
  type RenderDependencies,
} from "../../src/acquire/render-run.ts";
import { ownServerLifecycle, terminateProcessTree, type PageLike } from "../../src/acquire/browser.ts";
import { writeEvidencePng, type Rasterizer } from "../../src/render/rasterizer.ts";
import { loadCorpus } from "../fixtures/corpus.ts";
import { spacedHyphen } from "../../src/rules/type/spaced-hyphen.ts";
import { injectSourceIds } from "../../src/source/inject.ts";
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

function detachedNode(source: string) {
  return spawn(process.execPath, ["-e", source], { detached: true, stdio: "ignore" });
}

/** Run the acquisition result through the engine, exactly as the CLI does. */
function exitCodeFor(documents: Awaited<ReturnType<typeof renderDocuments>>["documents"]): number {
  const outcomes = documents.map((d) =>
    runDocument(d, { failOn: "error", activeRules: [], optionsByRule: {}, loweredFloors: {} }),
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
    config: {
      profile: "default",
      failOn: "error",
      activeRules: [],
      disabledRules: [],
      loweredFloors: [],
      interventions: [],
      sourceMapInjection: true,
      evidenceBinding: true,
      network: { mode: "offline", allowed: [], blocked: 0 },
    },
  }).exitCode;
}

describe("the live path fails closed at its process boundary", () => {
  it("closes an owned loopback server with an intentionally open socket and releases its port", async () => {
    const server = createServer(() => undefined);
    const lifecycle = ownServerLifecycle(server);
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const socket = createConnection({ host: "127.0.0.1", port: address.port });
    await once(socket, "connect");
    await wait(10);
    assert.equal(lifecycle.openSockets(), 1, "the positive-control socket never reached the owned server");
    const started = Date.now();
    assert.equal(await lifecycle.close(250), null);
    assert.ok(Date.now() - started < 500);
    assert.equal(server.listening, false);
    assert.equal(lifecycle.openSockets(), 0);
    assert.equal(socket.destroyed, true);
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
    assert.equal(productionCollector.match(/breaklint-static-test-capability/gu)?.length, 2);
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
      { file: "large.html", line: index + 1, column: 1, offset: index * 10 },
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
    const child = detachedNode(`
      const { spawn } = require("node:child_process");
      spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      process.on("SIGTERM", () => {
        spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      });
      setInterval(() => {}, 1000);
    `);
    child.unref();
    assert.ok(child.pid);
    await wait(300);
    const termination = await terminateProcessTree(child.pid);
    assert.equal(termination.groupSafe, true);
    assert.ok(termination.initialPids.length >= 2, "the initial process tree was not observed");
    assert.equal(termination.killSent, true, "the SIGTERM-resistant group never reached SIGKILL");
    assert.deepEqual(termination.survivingPids, []);
    assert.equal(termination.verified, true);
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

  it("verifies the PID tree even when browser.close resolves", async () => {
    let verified = 0;
    const error = await closeBrowserBounded({
      async newPage() { throw new Error("not reached"); }, async version() { return "Fake/1"; },
      process() { return { pid: 71_001 }; }, async close() {},
    }, async (pid) => {
      verified += 1;
      return {
        rootPid: pid, pgid: pid, initialPids: [pid], survivingPids: [pid], groupSafe: true,
        termSent: true, killSent: true, verified: false,
      };
    });
    assert.equal(verified, 1);
    assert.match(error ?? "", /survivors=71001/u);
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
    assert.throws(() => process.kill(pid, 0), /ESRCH/u, "known browser root was not killed");
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
    assert.ok(elapsed >= 5_000 && elapsed < 8_000, `cleanup escaped its 5 s bounds: ${elapsed} ms`);
    assert.throws(() => process.kill(pid, 0), /ESRCH/u, "browser PID still exists after verified escalation");
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
    assert.throws(() => process.kill(pid, 0), /ESRCH/u);
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
    assert.deepEqual(result.documents[0]!.infrastructure[0]!.measured, { stage: "provenance", issues: 1 });
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
      { failOn: "warn", activeRules: [spacedHyphen], optionsByRule: {}, loweredFloors: {} },
    );
    assert.equal(outcome.report.findings.length, 1);
    assert.deepEqual(outcome.report.findings[0]!.evidence, {
      ref: "evidence/doc-page-001.png",
      bindsFinding: true,
    });
    assert.equal(outcome.report.evidence.length, 1);
  });

  it("projects evidence apparatus declines into the document report independently of rules", () => {
    const snapshot = loadCorpus().find((entry) => entry.name === "spaced-hyphen-trigger")!.snapshot;
    const decline = {
      scope: "document" as const, ruleId: null, reason: "env/evidence-overlay-removed" as const,
      target: null, count: 2,
    };
    const outcome = runDocument(
      { path: "doc.html", snapshot, infrastructure: [], notMeasured: [decline] },
      { failOn: "never", activeRules: [], optionsByRule: {}, loweredFloors: {} },
    );
    assert.deepEqual(outcome.report.notMeasured, [decline]);

    const noSnapshot = runDocument(
      { path: "doc.html", snapshot: null, infrastructure: [], notMeasured: [decline] },
      { failOn: "never", activeRules: [], optionsByRule: {}, loweredFloors: {} },
    );
    assert.deepEqual(noSnapshot.report.notMeasured, [decline]);
  });
});
