/**
 * The live path is deliberately unfinished, and its ONLY promise is how it fails.
 *
 * `render-run.ts` states in its header that an unready stage "ends with exit 3 and an
 * infrastructure event that names the stage. It never ends with 0 and no findings." Until this
 * file existed that sentence had nothing behind it: no test in the repository imported
 * `renderDocuments` or `resolvePagedjs`, and two independent audits measured the consequence —
 * emptying the returned `infrastructure` array left the whole suite green while turning the
 * promised exit 3 into a silent exit 4.
 *
 * The assertions below therefore run the real function and push its output through the real
 * engine, because the promise is about an exit code and an exit code is not produced here. A test
 * that only checked the returned shape would be checking the shape this file happens to build,
 * not the promise the header makes.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { buildReport } from "../../src/core/build-report.ts";
import { runDocument } from "../../src/core/engine.ts";
import { NON_FATAL_INFRA_EVENT_KINDS } from "../../src/core/enums.ts";
import { renderDocuments, resolvePagedjs } from "../../src/acquire/render-run.ts";

const OPTIONS = {
  outDir: ".tmp/render-run-test",
  evidenceBinding: true,
  sourceMapInjection: true,
  network: { mode: "offline" as const, allowed: [] },
  locale: "de-DE",
};

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

describe("the unfinished live path fails closed", () => {
  it("never returns a document that would read as measured-and-clean", async () => {
    const result = await renderDocuments(["README.md"], OPTIONS);

    // Either the run was stopped outright (no renderer, wrong paged.js), or it produced documents
    // that carry no snapshot AND say why. There is no third shape, and in particular there is no
    // shape that reports a document as measured.
    if (result.fatal) {
      assert.equal(result.fatal.exitCode, 3, "a stopped run is exit 3, never 2 or 4");
      assert.match(result.fatal.message, /install:/u, "a stopped run names a command that fixes it");
      return;
    }

    assert.ok(result.documents.length > 0, "no fatal means documents were produced");
    for (const doc of result.documents) {
      assert.equal(doc.snapshot, null, "the probe is not built; a snapshot here would be fabricated");
      assert.ok(doc.infrastructure.length > 0, "a document with neither snapshot nor event exits 4, silently");
      const fatal = doc.infrastructure.filter(
        (e) => !(NON_FATAL_INFRA_EVENT_KINDS as readonly string[]).includes(e.kind),
      );
      assert.ok(fatal.length > 0, "at least one event must be fatal, or the run reports coverage rather than failure");
      assert.ok(
        fatal.some((e) => typeof e.measured?.stage === "string" && e.measured.stage.length > 0),
        "the event names the stage that was not ready — the header promises this specifically",
      );
    }

    assert.equal(exitCodeFor(result.documents), 3, "the whole point: exit 3, not 4 and never 0");
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
});
