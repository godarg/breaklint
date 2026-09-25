/**
 * The browser floor of the pinned rasteriser, checked before any document is opened.
 *
 * THE DEFECT. `pdfjs-dist` 6.2.108 uses recent platform names without a feature test —
 * `Map.prototype.getOrInsertComputed`, `Math.sumPrecise`, `Blob.prototype.bytes` and others. It
 * LOADS on a browser that lacks them and fails only when it rasterises, which is after the
 * document has been paginated and measured. Measured on Chromium 141: every live run measured its
 * document and then ended exit 3 on `this[#methodPromises].getOrInsertComputed is not a function`,
 * naming neither the browser nor what to do about it. The run now stops at the rasteriser's own
 * start, before any document, with the missing names, where they are missing, the browser version
 * and the remedy.
 *
 * FIVE THINGS ARE PINNED HERE, each by the thing that would break it:
 *   1. the real probe script — page half and worker half, with the hand-off between them — reports
 *      exactly the names that are absent in each realm, run as code in realms of its own;
 *   2. the verdict refuses a missing name, refuses an answer it cannot read, and refuses a page
 *      that could not start its worker;
 *   3. through the real `openRasterizer` and the real `renderDocuments`, a browser below the floor
 *      ends exit 3 with no content page ever opened — so no document was measured;
 *   4. the lists are the pinned build's, not a memory: the build is scanned for every platform name
 *      it reaches from the global scope (web APIs included) and for recent instance members, and
 *      the check must equal what that scan, minus its reviewed exemptions, requires;
 *   5. the documentation states the checked lists exactly.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createContext, runInContext, type Context } from "node:vm";

import { resolvePackageRoot, type BrowserLike, type PageLike } from "../../src/acquire/browser.ts";
import { renderDocuments } from "../../src/acquire/render-run.ts";
import { SUPPORTED_PDFJS_VERSION } from "../../src/core/enums.ts";
import {
  capabilityProbeSource,
  openRasterizer,
  PDFJS_REQUIRED_CAPABILITIES,
  rasterizerCapabilityVerdict,
} from "../../src/render/rasterizer.ts";
import { platformGlobals, platformInventory, REALM_OF, requiredFor, type PdfjsFile } from "../tools/pdfjs-platform-inventory.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const TYPESCRIPT_LIB = join(resolvePackageRoot("typescript", REPO) ?? join(REPO, "node_modules/typescript/"), "lib");
/**
 * How long the vm hand-off may take before the test fails instead of waiting forever. Measured:
 * the whole page-to-worker exchange in these realms completes in 10-60 ms (under load too). The
 * bound is not a start-up budget - no process starts here - it only has to beat "never": a
 * worker half that is never started otherwise hangs the file indefinitely (a verifier's mutant ran
 * 620 s). 10 s is two orders of magnitude above anything measured.
 */
const HAND_OFF_LIMIT_MS = 10_000;
const PROBE = fileURLToPath(new URL("../tools/leak-probe.ts", import.meta.url));
const OPTIONS = {
  outDir: ".tmp/rasterizer-capabilities-test",
  evidenceBinding: true,
  sourceMapInjection: true,
  network: { mode: "offline" as const, allowed: [] },
  locale: "de-DE",
};
/** What Chromium 141.0.7390.37 lacks, measured through the real openRasterizer on that browser. */
const CHROMIUM_141_MISSING = {
  page: ["Map.prototype.getOrInsertComputed()", "Math.sumPrecise()", "WeakMap.prototype.getOrInsertComputed()"],
  worker: [
    "Blob.prototype.bytes()", "Map.prototype.getOrInsert()", "Map.prototype.getOrInsertComputed()", "Math.sumPrecise()",
    "WeakMap.prototype.getOrInsertComputed()",
  ],
};

/**
 * Makes every name in `names` resolve in `context`, the way a browser that has it would: a
 * constructor or a call becomes a function, anything else a value. Names the realm already
 * provides are left alone. `absent` names are then removed again.
 */
function provide(context: Context, names: readonly string[], absent: readonly string[] = []): void {
  runInContext(
    `(() => {
      const split = (name) => {
        const constructs = name.startsWith("new "), calls = name.endsWith("()");
        const path = name.slice(constructs ? 4 : 0, calls ? -2 : undefined);
        const keys = path.match(/\\[Symbol\\.[A-Za-z]+\\]|[^.[\\]]+/g).map((part) => part.startsWith("[Symbol.") ? Symbol[part.slice(8, -1)] : part);
        return { keys, callable: constructs || calls };
      };
      for (const name of ${JSON.stringify(names)}) {
        const { keys, callable } = split(name);
        let at = globalThis;
        keys.forEach((key, index) => {
          const last = index === keys.length - 1;
          if (last) {
            if (callable ? typeof at[key] !== "function" : !(key in at)) at[key] = callable ? function stub() {} : {};
          } else {
            if (at[key] === undefined || at[key] === null) at[key] = function stubHolder() {};
            if (typeof at[key] === "function" && !at[key].prototype) at[key].prototype = {};
            at = at[key];
          }
        });
      }
      for (const name of ${JSON.stringify(absent)}) {
        const { keys } = split(name);
        let at = globalThis;
        for (const key of keys.slice(0, -1)) at = at[key];
        delete at[keys[keys.length - 1]];
      }
    })()`,
    context,
  );
}

/**
 * Runs the real probe script in a page realm whose `Worker` runs the worker half in a worker realm,
 * and returns what the page published. `page`/`worker` name what each realm lacks.
 */
async function runProbe(
  lacking: { page?: readonly string[]; worker?: readonly string[] },
  options: { workerFails?: boolean; alterPage?: string } = {},
): Promise<unknown> {
  const pageRealm = createContext({});
  const workerRealm = createContext({});
  // A page's window is its global object, as in a browser, so window.* stubs land on the global.
  runInContext("globalThis.window = globalThis;", pageRealm);
  provide(pageRealm, PDFJS_REQUIRED_CAPABILITIES.page, lacking.page);
  provide(workerRealm, PDFJS_REQUIRED_CAPABILITIES.worker, lacking.worker);
  if (options.alterPage) runInContext(options.alterPage, pageRealm);
  const blobs = new Map<string, string>();
  let published: unknown;
  const pageGlobal = pageRealm as Record<string, unknown>;
  // The probe's own mechanics, installed over whatever stubs `provide` left for these names.
  pageGlobal.Blob = function Blob(this: { source: string }, parts: string[]) {
    this.source = parts.join("");
  };
  (pageGlobal.URL as Record<string, unknown>).createObjectURL = (blob: { source: string }) => {
    const url = `blob:probe/${blobs.size}`;
    blobs.set(url, blob.source);
    return url;
  };
  (pageGlobal.URL as Record<string, unknown>).revokeObjectURL = (url: string) => blobs.delete(url);
  const delivered = new Promise<void>((resolve) => {
    pageGlobal.Worker = function Worker(this: Record<string, unknown>, url: string, init: { type?: string }) {
      assert.equal(init?.type, "module", "the capability worker must be a module worker, as pdfjs's is");
      if (options.workerFails) throw new Error("worker construction refused");
      const source = blobs.get(url);
      assert.ok(source, "the worker was not started from the probe's own blob");
      (workerRealm as Record<string, unknown>).postMessage = (data: unknown) => {
        setImmediate(() => {
          (this.onmessage as (event: { data: unknown }) => void)({ data });
          resolve();
        });
      };
      this.terminate = () => {};
      setImmediate(() => runInContext(source, workerRealm));
    };
    if (options.workerFails) setImmediate(resolve);
  });
  runInContext(capabilityProbeSource(), pageRealm);
  let limit: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      delivered,
      new Promise<never>((_, reject) => {
        limit = setTimeout(
          () => reject(new Error(`the probe's worker half never answered within ${HAND_OFF_LIMIT_MS} ms`)),
          HAND_OFF_LIMIT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(limit);
  }
  published = pageGlobal.__blCapabilities;
  // Parsed into this realm, so the comparison is not tripped by the other realm's Array.
  return JSON.parse(JSON.stringify(published));
}

describe("the rasteriser's capability floor", () => {
  it("the probe names exactly what each realm lacks, through the real page-to-worker hand-off", async () => {
    assert.deepEqual(await runProbe({}), { page: [], worker: [] });
    assert.deepEqual(await runProbe(CHROMIUM_141_MISSING), CHROMIUM_141_MISSING);
    // The verifier's web APIs, each in the form the probe tests: a symbol-keyed method, a static
    // and a prototype method, and a constant that must merely exist.
    // Listed in the order of the checked list, which is the order the probe reports in.
    const webApis = ["AbortSignal.any()", "ReadableStream.prototype[Symbol.asyncIterator]()", "Response.prototype.bytes()", "URL.parse()"];
    assert.deepEqual(await runProbe({ page: webApis }), { page: webApis, worker: [] });
    assert.deepEqual(await runProbe({ page: ["XMLHttpRequest.DONE", "new Path2D"] }), {
      page: ["XMLHttpRequest.DONE", "new Path2D"],
      worker: [],
    });
  });

  it("a name that exists but is not callable is missing when the build calls it", async () => {
    const answer = await runProbe({}, { alterPage: "Math.sumPrecise = 1; URL.parse = undefined;" });
    assert.deepEqual(answer, { page: ["Math.sumPrecise()", "URL.parse()"], worker: [] });
  });

  it("a page that cannot start its worker publishes the failure instead of hanging", async () => {
    const answer = (await runProbe({}, { workerFails: true })) as { page: unknown; worker: { error: string } };
    assert.deepEqual(answer.page, []);
    assert.match(answer.worker.error, /worker construction refused/u);
    assert.equal(rasterizerCapabilityVerdict(answer, "Chrome/150").ok, false);
    assert.match(rasterizerCapabilityVerdict(answer, "Chrome/150").detail, /could not start a worker/u);
  });

  it("the verdict names what is missing and where, the browser and the remedy, and refuses what it cannot read", () => {
    assert.deepEqual(rasterizerCapabilityVerdict({ page: [], worker: [] }, "Chrome/150.0.0.0"), { ok: true, detail: "" });
    const refused = rasterizerCapabilityVerdict(CHROMIUM_141_MISSING, "HeadlessChrome/141.0.7390.37");
    assert.equal(refused.ok, false);
    assert.ok(refused.detail.includes(`in the page ${CHROMIUM_141_MISSING.page.join(", ")}`), refused.detail);
    assert.ok(refused.detail.includes(`in its worker ${CHROMIUM_141_MISSING.worker.join(", ")}`), refused.detail);
    assert.match(refused.detail, /HeadlessChrome\/141\.0\.7390\.37/u);
    assert.ok(refused.detail.includes(`pdfjs-dist ${SUPPORTED_PDFJS_VERSION}`));
    assert.match(refused.detail, /BREAKLINT_CHROME=/u);
    for (const unreadable of [
      undefined, null, SUPPORTED_PDFJS_VERSION, {}, { missing: [] }, { page: [] }, { page: [], worker: "x" },
      { page: [1], worker: [] }, { page: "Math.sumPrecise()", worker: [] },
    ]) {
      assert.equal(rasterizerCapabilityVerdict(unreadable, "Chrome/150").ok, false, `accepted ${JSON.stringify(unreadable)}`);
    }
  });

  it("openRasterizer refuses fatally and releases its page and server", async () => {
    const result = await new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ["--experimental-strip-types", PROBE, "capabilities-missing"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.once("error", reject);
      // The oracle is that the child ENDS: a leaked loopback server keeps it alive (see
      // rasterizer-lifecycle.test.ts, whose positive control shows this probe can see a leak).
      child.once("close", (code) => resolve({ code, stdout }));
    });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /^refused fatal$/mu, "a browser below the floor was not a fatal refusal");
    assert.match(result.stdout, /in its worker Math\.sumPrecise\(\)/u);
    assert.match(result.stdout, /browser \(fake\)/u, "the message does not name the browser version");
  });

  it("a browser below the floor ends the run with exit 3 before any document is opened", async () => {
    const opened = { pages: 0, contexts: 0, closed: 0, waitedForLibrary: 0 };
    // The capability answer appears only once the page has been waited for, as the worker half of
    // the real probe answers after load: a start-up that read it without waiting would read
    // nothing and refuse for the wrong reason.
    let answered = false;
    const rasteriserPage = {
      async goto() {},
      async setContent() {},
      async waitForFunction(expression: string) {
        if (expression.includes("__blReady")) opened.waitedForLibrary += 1;
        if (expression.includes("__blCapabilities")) answered = true;
      },
      async emulateMediaType() {},
      async setViewport() {},
      async pdf() {
        return new Uint8Array();
      },
      on() {},
      async evaluate(expression: unknown) {
        if (expression === "window.__blCapabilities") return answered ? CHROMIUM_141_MISSING : undefined;
        if (expression === "window.__blVersion") return SUPPORTED_PDFJS_VERSION;
        throw new Error(`the rasteriser page was asked for more than its capabilities: ${String(expression).slice(0, 80)}`);
      },
      async close() {},
    } as unknown as PageLike;
    const browser: BrowserLike = {
      async newPage() {
        opened.pages += 1;
        return rasteriserPage;
      },
      async createBrowserContext() {
        opened.contexts += 1;
        throw new Error("a document context was opened");
      },
      async version() {
        return "HeadlessChrome/141.0.7390.37";
      },
      async close() {
        opened.closed += 1;
      },
    };
    const result = await renderDocuments(["never-opened.html"], OPTIONS, {
      async launchBrowser() {
        return { executablePath: "/measured/fake-chrome", detail: "", browser };
      },
      openRasterizer,
    });
    assert.equal(result.fatal?.exitCode, 3, `expected exit 3, got ${JSON.stringify(result.fatal)}`);
    assert.ok(
      (result.fatal?.message ?? "").startsWith(
        "breaklint: renderer startup failed at openRasterizer: the browser (HeadlessChrome/141.0.7390.37) lacks what " +
          `the pinned rasteriser pdfjs-dist 6.2.108 uses without a feature test: in the page ${CHROMIUM_141_MISSING.page.join(", ")}; ` +
          `in its worker ${CHROMIUM_141_MISSING.worker.join(", ")}.`,
      ),
      result.fatal?.message,
    );
    assert.deepEqual(result.documents, [], "a document was produced");
    assert.equal(opened.pages, 1, "only the rasteriser page may be opened");
    assert.equal(opened.contexts, 0, "a document context was opened, so acquisition had started");
    assert.equal(opened.waitedForLibrary, 0, "the floor was checked only after waiting for the library");
    assert.equal(opened.closed, 1, "the browser was not closed");
  });

  it("the checked lists are exactly what the scan of the pinned build requires, per realm", () => {
    const root = resolvePackageRoot("pdfjs-dist", REPO);
    assert.ok(root, "pdfjs-dist is not installed; the scan would check nothing");
    const declared = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
    assert.equal(declared, SUPPORTED_PDFJS_VERSION, "the scan and its classification belong to the pinned build");
    for (const file of ["pdf.mjs", "pdf.worker.mjs"] as PdfjsFile[]) {
      const source = readFileSync(join(root, "build", file), "utf8");
      const globals = platformGlobals(REALM_OF[file], TYPESCRIPT_LIB);
      assert.ok(globals.size > 250, `only ${globals.size} platform globals were read for the ${REALM_OF[file]}; the lib scan is broken`);
      assert.ok(platformInventory(source, globals).length > 100, `the scan of ${file} found almost nothing; it is broken`);
      const { required, staleRules } = requiredFor(file, source, globals);
      assert.deepEqual(staleRules, [], `${file}: exemptions that no longer match the build — review them`);
      const checked = [...PDFJS_REQUIRED_CAPABILITIES[REALM_OF[file]]].sort();
      const unchecked = required.filter((name) => !checked.includes(name));
      const unused = checked.filter((name) => !required.includes(name));
      assert.deepEqual(
        { unchecked, unused },
        { unchecked: [], unused: [] },
        `${file}: a platform name the build uses is not checked (add it to PDFJS_REQUIRED_CAPABILITIES.${REALM_OF[file]} ` +
          "or classify it in tests/tools/pdfjs-platform-inventory.ts), or a checked name is no longer used",
      );
    }
  });

  it("a new web API in the build is caught by the scan, not only an ECMAScript built-in", () => {
    // The negative control for the test above: the same classification over the pinned build plus
    // one line using a web API nobody listed. It must come back as required and unchecked.
    const root = resolvePackageRoot("pdfjs-dist", REPO)!;
    const source = readFileSync(join(root, "build", "pdf.mjs"), "utf8");
    // `reportError` is never bound in the build: the unbound-call rule must find it. The file also
    // gains a local function named `queueMicrotask`, the shape that hid the global fetch() once:
    // only the realm's declared globals can still find the global call next to it.
    const extended =
      `${source}\nfunction queueMicrotask(task) { return task; }\n` +
      "const entry = await FileSystemObserver.observe(scheduler.yield(), reportError(x), queueMicrotask(f));\n";
    const { required } = requiredFor("pdf.mjs", extended, platformGlobals("page", TYPESCRIPT_LIB));
    for (const name of ["FileSystemObserver.observe()", "scheduler.yield()", "reportError()", "queueMicrotask()"]) {
      assert.ok(required.includes(name), `${name} was not found by the scan`);
      assert.ok(!PDFJS_REQUIRED_CAPABILITIES.page.includes(name), `${name} would already be checked`);
    }
    assert.ok(
      !requiredFor("pdf.mjs", extended, new Map()).required.includes("queueMicrotask()"),
      "the control is void: without the declared globals the shadowed call should have been hidden",
    );
  });

  it("the documentation states the checked lists exactly", () => {
    const limitations = readFileSync(join(REPO, "docs/limitations.md"), "utf8");
    const counts = /`PDFJS_REQUIRED_CAPABILITIES`\s+in\s+`src\/render\/rasterizer\.ts`:\s+(\d+)\s+names\s+in\s+the\s+page\s+and\s+(\d+)\s+in\s+its\s+worker/u.exec(limitations);
    assert.ok(counts, "docs/limitations.md does not state the checked lists' sizes in the expected sentence");
    assert.deepEqual(
      [Number(counts[1]), Number(counts[2])],
      [PDFJS_REQUIRED_CAPABILITIES.page.length, PDFJS_REQUIRED_CAPABILITIES.worker.length],
    );
    const named = [...new Set([...CHROMIUM_141_MISSING.page, ...CHROMIUM_141_MISSING.worker])];
    const undocumented = named.filter((name) => !limitations.includes(`\`${name.replace(/\(\)$/u, "")}\``));
    assert.deepEqual(undocumented, [], "docs/limitations.md does not name what the measured browser lacks");
  });
});
