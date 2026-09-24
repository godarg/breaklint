/**
 * The browser floor of the pinned rasteriser, checked before any document is opened.
 *
 * THE DEFECT. `pdfjs-dist` 6.2.108 calls recent built-ins without a feature test —
 * `Map.prototype.getOrInsertComputed`, `Math.sumPrecise` and others. It LOADS on a browser that
 * lacks them and fails only when it rasterises, which is after the document has been paginated
 * and measured. Measured on Chromium 141: every live run measured its document and then ended
 * exit 3 on `this[#methodPromises].getOrInsertComputed is not a function`, naming neither the
 * browser nor what to do about it. The run now stops at the rasteriser's own start, before any
 * document, with the missing names, the browser version and the remedy.
 *
 * FOUR THINGS ARE PINNED HERE, each by the thing that would break it:
 *   1. the in-page probe reports exactly the names that are absent, evaluated as real code in a
 *      realm of its own rather than asserted over its text;
 *   2. the verdict refuses a missing name, and refuses an answer it cannot read;
 *   3. through the real `openRasterizer` and the real `renderDocuments`, a browser below the floor
 *      ends exit 3 with no content page ever opened — so no document was measured;
 *   4. the list is the pinned build's, not a guess: the build is scanned for a watch-list of
 *      recent built-ins, and an unguarded one missing from the list, or a listed one the build no
 *      longer calls, fails. A pdfjs bump therefore cannot move the floor silently.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

import { resolvePackageRoot, type BrowserLike, type PageLike } from "../../src/acquire/browser.ts";
import { renderDocuments } from "../../src/acquire/render-run.ts";
import { SUPPORTED_PDFJS_VERSION } from "../../src/core/enums.ts";
import {
  capabilityProbeSource,
  openRasterizer,
  PDFJS_REQUIRED_BUILTINS,
  rasterizerCapabilityVerdict,
} from "../../src/render/rasterizer.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const PROBE = fileURLToPath(new URL("../tools/leak-probe.ts", import.meta.url));
const OPTIONS = {
  outDir: ".tmp/rasterizer-capabilities-test",
  evidenceBinding: true,
  sourceMapInjection: true,
  network: { mode: "offline" as const, allowed: [] },
  locale: "de-DE",
};
/** What Chromium 141 lacks, measured with an in-page probe on that browser. */
const CHROMIUM_141_MISSING = [
  "Map.prototype.getOrInsert",
  "Map.prototype.getOrInsertComputed",
  "WeakMap.prototype.getOrInsertComputed",
  "Math.sumPrecise",
];

/** A fresh realm in which every required built-in exists, except those in `absent`. */
function realmWithout(absent: readonly string[]): object {
  const context = createContext({});
  for (const path of PDFJS_REQUIRED_BUILTINS) {
    // Node's own engine may lack some of them; a stub makes the baseline "all present".
    runInContext(
      `(() => {
        const parts = ${JSON.stringify(path)}.split(".");
        let at = globalThis;
        for (const part of parts.slice(0, -1)) at = at[part];
        const last = parts[parts.length - 1];
        if (typeof at[last] !== "function") at[last] = function builtInStub() {};
      })()`,
      context,
    );
  }
  for (const path of absent) {
    const parts = path.split(".");
    runInContext(`delete ${parts.slice(0, -1).length ? parts.slice(0, -1).join(".") : "globalThis"}[${JSON.stringify(parts.at(-1))}]`, context);
  }
  return context;
}

function probe(context: object): unknown {
  // Parsed into this realm, so the comparison below is not tripped by the other realm's Array.
  return JSON.parse(JSON.stringify(runInContext(capabilityProbeSource(), context)));
}

describe("the rasteriser's capability floor", () => {
  it("the probe names exactly the built-ins that are absent, in list order", () => {
    assert.deepEqual(probe(realmWithout([])), { missing: [] });
    assert.deepEqual(probe(realmWithout(CHROMIUM_141_MISSING)), { missing: CHROMIUM_141_MISSING });
    // A name that resolves to something other than a function is as missing as an absent one.
    const context = realmWithout([]);
    runInContext("Math.sumPrecise = 1; globalThis.Iterator = undefined;", context);
    assert.deepEqual(probe(context), { missing: ["Math.sumPrecise", "Iterator"] });
  });

  it("the verdict names what is missing, the browser and the remedy, and refuses what it cannot read", () => {
    assert.deepEqual(rasterizerCapabilityVerdict({ missing: [] }, "Chrome/150.0.0.0"), { ok: true, detail: "" });
    const refused = rasterizerCapabilityVerdict({ missing: CHROMIUM_141_MISSING }, "HeadlessChrome/141.0.7390.37");
    assert.equal(refused.ok, false);
    for (const name of CHROMIUM_141_MISSING) assert.ok(refused.detail.includes(name), `the message omits ${name}`);
    assert.match(refused.detail, /HeadlessChrome\/141\.0\.7390\.37/u);
    assert.ok(refused.detail.includes(`pdfjs-dist ${SUPPORTED_PDFJS_VERSION}`));
    assert.match(refused.detail, /BREAKLINT_CHROME=/u);
    for (const unreadable of [undefined, null, SUPPORTED_PDFJS_VERSION, {}, { missing: "Math.sumPrecise" }, { missing: [1] }]) {
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
    assert.match(result.stdout, /lacks Math\.sumPrecise/u);
    assert.match(result.stdout, /browser \(fake\)/u, "the message does not name the browser version");
  });

  it("a browser below the floor ends the run with exit 3 before any document is opened", async () => {
    const opened = { pages: 0, contexts: 0, closed: 0, waitedForLibrary: 0 };
    const rasteriserPage = {
      async goto() {},
      async setContent() {},
      async waitForFunction() {
        opened.waitedForLibrary += 1;
      },
      async emulateMediaType() {},
      async setViewport() {},
      async pdf() {
        return new Uint8Array();
      },
      on() {},
      async evaluate(expression: unknown) {
        if (expression === "window.__blCapabilities") return { missing: CHROMIUM_141_MISSING };
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
    assert.match(
      result.fatal?.message ?? "",
      /renderer startup failed at openRasterizer: the browser \(HeadlessChrome\/141\.0\.7390\.37\) lacks Map\.prototype\.getOrInsert, Map\.prototype\.getOrInsertComputed, WeakMap\.prototype\.getOrInsertComputed, Math\.sumPrecise, which the pinned rasteriser pdfjs-dist 6\.2\.108/u,
    );
    assert.deepEqual(result.documents, [], "a document was produced");
    assert.equal(opened.pages, 1, "only the rasteriser page may be opened");
    assert.equal(opened.contexts, 0, "a document context was opened, so acquisition had started");
    assert.equal(opened.waitedForLibrary, 0, "the floor was checked only after waiting for the library");
    assert.equal(opened.closed, 1, "the browser was not closed");
  });

  it("the list is exactly the unguarded recent built-ins the pinned build calls", () => {
    const root = resolvePackageRoot("pdfjs-dist", REPO);
    assert.ok(root, "pdfjs-dist is not installed; the scan would check nothing");
    const declared = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
    assert.equal(declared, SUPPORTED_PDFJS_VERSION, "the scan must read the pinned build");
    const build = ["build/pdf.mjs", "build/pdf.worker.mjs"].map((file) => readFileSync(join(root, file), "utf8")).join("\n");

    /**
     * ES2022-or-later built-ins (and structuredClone), by a call pattern that names them without
     * ambiguity in this build. `receivers` are the built-ins a match can reach: `.at(` may be an
     * array, a string or a typed array; `.getOrInsertComputed(` is called on Maps and on the
     * XFA cache, which is a WeakMap. A `guard` is the feature test that makes a use optional.
     */
    const WATCH: { pattern: RegExp; receivers: string[]; guard?: RegExp }[] = [
      { pattern: /\.getOrInsert\(/gu, receivers: ["Map.prototype.getOrInsert"] },
      { pattern: /\.getOrInsertComputed\(/gu, receivers: ["Map.prototype.getOrInsertComputed", "WeakMap.prototype.getOrInsertComputed"] },
      { pattern: /\bMath\.sumPrecise\(/gu, receivers: ["Math.sumPrecise"] },
      { pattern: /\bMath\.f16round\(/gu, receivers: ["Math.f16round"] },
      { pattern: /\bFloat16Array\b/gu, receivers: ["Float16Array"], guard: /typeof Float16Array !== "undefined"/u },
      { pattern: /\bPromise\.withResolvers\(/gu, receivers: ["Promise.withResolvers"] },
      { pattern: /\bPromise\.try\(/gu, receivers: ["Promise.try"] },
      { pattern: /\bUint8Array\.fromBase64\(/gu, receivers: ["Uint8Array.fromBase64"] },
      { pattern: /\bUint8Array\.fromHex\(/gu, receivers: ["Uint8Array.fromHex"] },
      { pattern: /\.toBase64\(/gu, receivers: ["Uint8Array.prototype.toBase64"] },
      { pattern: /\.toHex\(\)/gu, receivers: ["Uint8Array.prototype.toHex"] },
      { pattern: /\.setFromBase64\(/gu, receivers: ["Uint8Array.prototype.setFromBase64"] },
      { pattern: /\.setFromHex\(/gu, receivers: ["Uint8Array.prototype.setFromHex"] },
      { pattern: /\.transferToFixedLength\(/gu, receivers: ["ArrayBuffer.prototype.transferToFixedLength"] },
      { pattern: /\.transfer\(/gu, receivers: ["ArrayBuffer.prototype.transfer"] },
      { pattern: /\bIterator\.(?:prototype|from|concat)\b/gu, receivers: ["Iterator"] },
      { pattern: /\.findLast\(/gu, receivers: ["Array.prototype.findLast"] },
      { pattern: /\.findLastIndex\(/gu, receivers: ["Array.prototype.findLastIndex"] },
      { pattern: /\.toSorted\(/gu, receivers: ["Array.prototype.toSorted"] },
      { pattern: /\.toReversed\(/gu, receivers: ["Array.prototype.toReversed"] },
      { pattern: /\.toSpliced\(/gu, receivers: ["Array.prototype.toSpliced"] },
      { pattern: /\.with\(/gu, receivers: ["Array.prototype.with"] },
      { pattern: /\.at\(/gu, receivers: ["Array.prototype.at", "String.prototype.at", "Uint8Array.prototype.at"] },
      { pattern: /\bObject\.hasOwn\(/gu, receivers: ["Object.hasOwn"] },
      { pattern: /\bObject\.groupBy\(/gu, receivers: ["Object.groupBy"] },
      { pattern: /\bMap\.groupBy\(/gu, receivers: ["Map.groupBy"] },
      { pattern: /\bArray\.fromAsync\(/gu, receivers: ["Array.fromAsync"] },
      { pattern: /\.isWellFormed\(/gu, receivers: ["String.prototype.isWellFormed"] },
      { pattern: /\.toWellFormed\(/gu, receivers: ["String.prototype.toWellFormed"] },
      { pattern: /\.intersection\(/gu, receivers: ["Set.prototype.intersection"] },
      { pattern: /\.union\(/gu, receivers: ["Set.prototype.union"] },
      { pattern: /\.difference\(/gu, receivers: ["Set.prototype.difference"] },
      { pattern: /\.symmetricDifference\(/gu, receivers: ["Set.prototype.symmetricDifference"] },
      { pattern: /\.isSubsetOf\(/gu, receivers: ["Set.prototype.isSubsetOf"] },
      { pattern: /\.isSupersetOf\(/gu, receivers: ["Set.prototype.isSupersetOf"] },
      { pattern: /\.isDisjointFrom\(/gu, receivers: ["Set.prototype.isDisjointFrom"] },
      { pattern: /\bRegExp\.escape\(/gu, receivers: ["RegExp.escape"] },
      { pattern: /\bError\.isError\(/gu, receivers: ["Error.isError"] },
      { pattern: /\bAtomics\.(?:waitAsync|pause)\(/gu, receivers: ["Atomics.waitAsync"] },
      { pattern: /\b(?:Async)?DisposableStack\b|\bSymbol\.(?:async)?[dD]ispose\b/gu, receivers: ["DisposableStack"] },
      { pattern: /\bTemporal\./gu, receivers: ["Temporal"] },
      { pattern: /\bstructuredClone\(/gu, receivers: ["structuredClone"] },
    ];
    const required = new Set(PDFJS_REQUIRED_BUILTINS);
    const neededByBuild = new Set<string>();
    const problems: string[] = [];
    for (const { pattern, receivers, guard } of WATCH) {
      const uses = build.match(pattern)?.length ?? 0;
      if (uses === 0) continue;
      if (guard) {
        if (!guard.test(build)) problems.push(`${receivers.join("/")}: ${uses} use(s) and the feature test ${guard} is gone`);
        continue;
      }
      for (const name of receivers) {
        neededByBuild.add(name);
        if (!required.has(name)) problems.push(`${name}: called ${uses}x without a feature test, but not in PDFJS_REQUIRED_BUILTINS`);
      }
    }
    for (const name of required) {
      if (!neededByBuild.has(name)) problems.push(`${name}: in PDFJS_REQUIRED_BUILTINS, but the pinned build no longer calls it`);
    }
    assert.deepEqual(problems, []);
  });

  it("the documented floor is the checked floor", () => {
    const limitations = readFileSync(join(REPO, "docs/limitations.md"), "utf8");
    const undocumented = PDFJS_REQUIRED_BUILTINS.filter((name) => !limitations.includes(`\`${name}\``));
    assert.deepEqual(undocumented, [], "docs/limitations.md does not list every capability the rasteriser checks");
  });
});
