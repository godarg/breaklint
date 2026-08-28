/**
 * The M2d production seam, through the real browser, paginator, loopback server and rasteriser.
 *
 * These cases are deliberately absent from unit mocks: their red conditions live at process and
 * HTTP boundaries. The style fixture constructs the reserved attribute name at runtime, so the
 * collision scanner cannot reject it before the paired injected/uninjected control is exercised.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, describe, it, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { renderDocuments, type RenderOptions, type RenderResult } from "../../src/acquire/render-run.ts";
import { exitCodeFor, runDocument } from "../../src/core/engine.ts";
import { resolveBrowser, resolvePackageRoot } from "../../src/acquire/browser.ts";
import { straightQuotes } from "../../src/rules/type/straight-quotes.ts";
import { textOverflowsViewport } from "../../src/rules/svg/text-overflows-viewport.ts";
import { textClipped } from "../../src/rules/svg/text-clipped.ts";
import { blockKey } from "../../src/core/fingerprint.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURES = join(REPO, "tests", "fixtures");
const optional = process.env.BREAKLINT_LIVE_OPTIONAL === "1";
const missing = [
  resolveBrowser().path ? null : "a browser",
  resolvePackageRoot("pagedjs", REPO) ? null : "pagedjs",
  resolvePackageRoot("pdfjs-dist", REPO) ? null : "pdfjs-dist",
].filter((value): value is string => value !== null);

function options(outDir: string, sourceMapInjection = true): RenderOptions {
  return {
    outDir,
    evidenceBinding: true,
    sourceMapInjection,
    network: { mode: "offline", allowed: [] },
    locale: "de-DE",
  };
}

describe("the M2d live production chain", () => {
  let root = "";
  let outside = "";
  let chain = "";
  let result: RenderResult | null = null;
  let noSource: RenderResult | null = null;

  const completeChain = (t: TestContext): boolean => {
    if (result?.documents.length === 22 && noSource?.documents.length === 4) return true;
    t.skip(
      `root acquisition failure already reported by the first subtest: injected=${result?.documents.length ?? 0}, ` +
      `no-source=${noSource?.documents.length ?? 0}`,
    );
    return false;
  };

  before(async () => {
    if (missing.length > 0) {
      if (optional) return;
      assert.fail(`this suite cannot run without: ${missing.join(", ")}. Set BREAKLINT_LIVE_OPTIONAL=1 to skip.`);
    }
    root = mkdtempSync(join(tmpdir(), "breaklint-m2d-"));
    outside = mkdtempSync(join(tmpdir(), "breaklint-m2d-outside-"));
    writeFileSync(join(root, "secret.txt"), "the loopback origin must not expose this sibling");
    writeFileSync(
      join(root, "allowed.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="black"/></svg>',
    );
    writeFileSync(join(outside, "outside.txt"), "the loopback origin must not follow this symlink");
    symlinkSync(join(outside, "outside.txt"), join(root, "escape.txt"));

    // Synchronous same-origin XHR makes the HTTP status part of the paginated text. In
    // --no-source-map mode the snapshot's fallback text runs therefore give an independent read
    // of the server boundary: changing either 403 response to 200 makes the assertion red.
    const policyProbe = `<p id="server-status">pending</p><img src="allowed.svg" alt=""><link rel="preload" href="escape.txt" as="fetch">\n<script>
      const status = (path) => { const request = new XMLHttpRequest(); request.open('GET', path, false); request.send(); return request.status; };
      document.getElementById('server-status').textContent = 'server-status:' + status('/secret.txt') + ',' + status('/escape.txt');
    </script>`;
    chain = join(root, "live-chain.html");
    const source = readFileSync(join(FIXTURES, "live-chain.html"), "utf8").replace("</body>", `${policyProbe}</body>`);
    writeFileSync(chain, source);

    result = await renderDocuments(
      [
        chain,
        join(FIXTURES, "injection-style-sabotage.html"),
        join(FIXTURES, "layout-drift.html"),
        join(FIXTURES, "injection-resource-sabotage.html"),
        join(FIXTURES, "fill-probe.html"),
        join(FIXTURES, "missing-font.html"),
        join(FIXTURES, "no-source-identities.html"),
        join(FIXTURES, "image-hidden-fill.html"),
        join(FIXTURES, "inline-fill.html"),
        join(FIXTURES, "runtime-sid-swap.html"),
        join(FIXTURES, "apparatus-sabotage.html"),
        join(FIXTURES, "late-mutation.html"),
        join(FIXTURES, "isolated-control.html"),
        join(FIXTURES, "late-network.html"),
        join(FIXTURES, "pagination-endpoint-race.html"),
        join(FIXTURES, "overlay-endpoint-race.html"),
        join(FIXTURES, "collector-preemption.html"),
        join(FIXTURES, "pdf-beforeprint-mutation.html"),
        join(FIXTURES, "animation-intervention-removal.html"),
        join(FIXTURES, "layout-drift-chaos.html"),
        join(FIXTURES, "svg-text-geometry.html"),
        join(FIXTURES, "svg-in-viewport.html"),
      ],
      options(join(root, "evidence")),
    );
    noSource = await renderDocuments(
      [
        join(FIXTURES, "live-chain.html"),
        join(FIXTURES, "no-source-identities.html"),
        join(FIXTURES, "no-source-identities.html"),
        join(FIXTURES, "no-source-ambiguous.html"),
      ],
      options(join(root, "no-source-evidence"), false),
    );
  });

  after(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    if (outside) rmSync(outside, { recursive: true, force: true });
  });

  it("binds findings and real environment metadata on the mixed break document", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const resultSummary = result?.documents.map((document, index) => ({
      index,
      infrastructure: document.infrastructure.map((event) => ({ kind: event.kind, measured: event.measured })),
    }));
    assert.equal(
      result?.documents.length,
      22,
      `the injected run stopped before every document; timeout/root cause=${JSON.stringify(resultSummary)}`,
    );
    assert.equal(
      noSource?.documents.length,
      4,
      `the sid-less run stopped before every document; timeout/root cause=${JSON.stringify(noSource?.documents.map((d) => d.infrastructure))}`,
    );
    assert.ok(result?.environment);
    assert.notEqual(result.environment.browserVersion, "");
    assert.equal(result.environment.rendererPresent, true);
    assert.ok(result.environment.rendererPath);
    assert.equal(result.environment.pagedjsVersion, "0.4.3");
    assert.ok(result.environment.rasterizer);
    assert.ok(result.environment.fontFamiliesResolved.some((family) => family.includes("Georgia")));
    assert.ok(result.environment.fontFamiliesResolved.some((family) => family === "serif"));

    const document = result.documents[0]!;
    assert.ok(document.snapshot);
    assert.equal(document.infrastructure.some((event) => event.kind === "checker-crashed"), false);
    const causes = document.snapshot.pages.flatMap((page) => [page.incomingBreakCause.kind, page.outgoingBreakCause.kind]);
    assert.ok(causes.includes("forced"), "the production chain lost its forced break");
    assert.ok(causes.includes("overflow"), "the production chain lost its overflow break");
    assert.ok(causes.includes("parity"), "the production chain lost its recto/parity break");

    const outcome = runDocument(document, {
      failOn: "warn",
      activeRules: [straightQuotes],
      optionsByRule: {},
      coverageFloors: {},
    });
    const finding = outcome.report.findings.find((item) => item.ruleId === "type/straight-quotes");
    assert.ok(finding);
    assert.ok(finding.evidence?.ref);
    assert.equal(finding.evidence.bindsFinding, true);
    assert.equal(existsSync(join(root!, "evidence", finding.evidence.ref)), true);
    assert.ok(outcome.report.evidence.length > 0);
  });

  it("returns real 403s for an unknown sibling and a referenced symlink escape", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    assert.ok(result?.environment);
    assert.ok(result.environment.networkBlocked >= 2, "the loopback deny branches were not reached");
    const document = result.documents[0]!;
    assert.ok(document.snapshot);
    const resources = document.snapshot.resources;
    assert.ok(resources.some((resource) => resource.resolvedUri.endsWith("/allowed.svg") &&
      resource.status === 200 && (resource.bytes ?? 0) > 0 && /^[a-f0-9]{64}$/u.test(resource.sha256 ?? "")));
    assert.ok(resources.some((resource) => resource.resolvedUri.endsWith("/secret.txt") &&
      resource.status === 403 && resource.bytes === 0 && resource.sha256 === null));
    assert.ok(resources.some((resource) => resource.resolvedUri.endsWith("/escape.txt") &&
      resource.status === 403 && resource.bytes === 0 && resource.sha256 === null));
    assert.deepEqual(
      document.snapshot.meta.inputIdentity?.resources,
      resources.map(({ resolvedUri, status, bytes, sha256, outcome }) => ({ resolvedUri, status, bytes, sha256, outcome }))
        .sort((a, b) => a.resolvedUri.localeCompare(b.resolvedUri)),
    );
  });

  it("keeps measuring without source ids and never treats data-ref as source identity", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const document = noSource!.documents[0]!;
    assert.ok(document.snapshot);
    assert.ok(document.snapshot.blocks.length > 0);
    assert.ok(document.snapshot.blocks.every((block) => block.sid === null));
    assert.equal(document.snapshot.source.complete, false);
    assert.deepEqual(document.snapshot.source.map, {});
    assert.deepEqual(document.boundSids, []);
    assert.ok(document.evidence?.every((evidence) => evidence.bindsFinding === false));
    assert.ok(document.snapshot.blocks.every((block) => block.nodeKey.startsWith("bl:ref:")));
    const causes = document.snapshot.pages.flatMap((page) => [page.incomingBreakCause.kind, page.outgoingBreakCause.kind]);
    assert.ok(causes.includes("forced"));
    assert.ok(causes.includes("overflow"));
    assert.ok(causes.includes("parity"));
  });

  it("detects a style-only injection effect in the paired real-browser control", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const sabotage = result!.documents[1]!;
    const event = sabotage.infrastructure.find((item) => item.kind === "injection-interference");
    assert.ok(event, "the paired control did not detect the constructed attribute selector");
    assert.deepEqual((event.measured as { changed?: string[] } | null)?.changed, ["style"]);
    assert.equal(sabotage.snapshot, null, "a fatal paired-control result was still given to the rule engine");
    assert.equal(sabotage.evidence?.length ?? 0, 0, "a fatal paired-control result wrote evidence");
  });

  it("disables animations before measurement and reports that intervention", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const animated = result!.documents[2]!;
    assert.ok(animated.snapshot);
    assert.equal(animated.infrastructure.some((item) => item.kind === "document-not-quiescent"), false);
    assert.ok(animated.snapshot.meta.interventions.includes("animations-disabled"));
  });

  it("exhausts the real freeze retry budget on author-script layout drift without a snapshot", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const drifting = result!.documents[19]!;
    assert.equal(drifting.snapshot, null, "a continuously moving document produced a snapshot");
    assert.equal(drifting.evidence?.length ?? 0, 0, "a rejected snapshot wrote evidence");
    const event = drifting.infrastructure.find((item) =>
      item.kind === "document-not-quiescent" && /layout did not settle/u.test(item.detail));
    assert.ok(event, "the real freeze loop did not fail closed");
    const measured = event.measured as { retries?: number; components?: string[] } | null;
    assert.equal(measured?.retries, 4, "the three retry budget was not exhausted");
    assert.ok(measured?.components?.includes("boxes"), `box drift was not named: ${JSON.stringify(measured)}`);
    const outcome = runDocument(drifting, {
      failOn: "never", activeRules: [], optionsByRule: {}, coverageFloors: {},
    });
    assert.equal(outcome.report.verdict, "infrastructure");
    assert.equal(exitCodeFor(outcome.report.verdict), 3, "a lone exhausted freeze failure must exit 3");
  });

  it("detects a runtime-only URI change in the paired resource signature", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const sabotage = result!.documents[3]!;
    const event = sabotage.infrastructure.find((item) => item.kind === "injection-interference");
    assert.ok(event, "the paired control ignored a URI changed only when the injected id existed");
    assert.deepEqual((event.measured as { changed?: string[] } | null)?.changed, ["resources"]);
  });

  it("measures fill from visible line/replaced/table rectangles, including foot and blank controls", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const snapshot = result!.documents[4]!.snapshot;
    assert.ok(snapshot);
    const footer = snapshot.blocks.find((block) => block.authorId === "footer-line");
    assert.ok(footer);
    const footerFill = snapshot.pages[footer.page - 1]!.fill;
    assert.ok(footerFill.vertical > 0.8, `footer vertical=${footerFill.vertical}`);
    assert.ok(footerFill.topGap > 0.7, `footer topGap=${footerFill.topGap}`);
    assert.ok(footerFill.net < 0.2, `footer net=${footerFill.net}`);
    assert.ok(footerFill.area < 0.2, `footer area=${footerFill.area}`);
    assert.ok(snapshot.pages[0]!.fill.net > 0.45, `full net=${snapshot.pages[0]!.fill.net}`);
    const blank = result!.documents[0]!.snapshot!.pages.find((page) => page.blank);
    assert.ok(blank);
    assert.deepEqual(blank.fill, { vertical: 0, topGap: 0, net: 0, area: 0 });
  });

  it("turns a failed @font-face into fatal font-load-failed", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const document = result!.documents[5]!;
    assert.equal(document.snapshot, null);
    assert.ok(document.infrastructure.some((event) => event.kind === "font-load-failed"));
  });

  it("counts a naked image but excludes hidden descendant text from fill", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const snapshot = result!.documents[7]!.snapshot;
    assert.ok(snapshot);
    assert.equal(snapshot.pages[0]!.blank, false, "an image-only page was classified as blank");
    assert.ok(snapshot.pages[0]!.fill.area > 0, "the image rectangle did not contribute real area");
    const hidden = snapshot.blocks.find((block) => block.authorId === "hidden-page");
    assert.ok(hidden);
    assert.deepEqual(hidden.lines, []);
    const hiddenPage = snapshot.pages[hidden.page - 1]!;
    assert.equal(hiddenPage.blank, false, "an authored empty-visual block became a generated blank page");
    assert.deepEqual(hiddenPage.fill, { vertical: 0, topGap: 0, net: 0, area: 0 });
  });

  it("fails closed when inline-only visible text leaves the geometry oracle without an addressable box", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const document = result!.documents[8]!;
    assert.equal(document.snapshot, null);
    assert.equal(document.evidence?.length ?? 0, 0);
    assert.ok(document.infrastructure.some((event) => event.kind === "geometry-cross-check-failed"));
  });

  it("keeps sid-less source identity, exclusions and page anchors stable across two renders", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const outcomes = noSource!.documents.slice(1, 3).map((document) => runDocument(document, {
      failOn: "warn",
      activeRules: [straightQuotes],
      optionsByRule: {},
      coverageFloors: {},
    }));
    for (const outcome of outcomes) {
      assert.equal(outcome.report.findings.length, 2, "the quote inside code was not excluded");
      assert.ok(outcome.report.findings.every((finding) => finding.source === null));
      assert.equal(new Set(outcome.report.findings.map((finding) => finding.fingerprint)).size, 2);
      assert.ok(noSource!.documents[1]!.snapshot!.pages.every((page) => page.blank || page.firstSemanticBlockKey));
    }
    const sidlessSnapshot = noSource!.documents[1]!.snapshot!;
    const emptyAnchor = sidlessSnapshot.blocks.find((block) => block.authorId === "empty-anchor");
    const emptyFigure = sidlessSnapshot.blocks.find((block) => block.authorId === "empty-figure");
    assert.ok(emptyAnchor);
    assert.ok(emptyFigure);
    assert.equal(emptyAnchor.blockSignature, "");
    assert.equal(emptyFigure.blockSignature, "");
    assert.equal(
      sidlessSnapshot.pages[0]!.firstSemanticBlockKey,
      blockKey({ authorId: "empty-anchor", blockSignature: "" }),
      "an empty first semantic source block was skipped as if empty signature meant no identity",
    );
    assert.deepEqual(
      outcomes[0]!.report.findings.map((finding) => finding.fingerprint).sort(),
      outcomes[1]!.report.findings.map((finding) => finding.fingerprint).sort(),
    );
    const mapped = runDocument(result!.documents[6]!, {
      failOn: "warn", activeRules: [straightQuotes], optionsByRule: {}, coverageFloors: {},
    });
    assert.equal(mapped.report.findings.length, 2);
  });

  it("fails closed when author code swaps injected source ids at runtime", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const document = result!.documents[9]!;
    assert.equal(document.snapshot, null);
    assert.ok(document.infrastructure.some((event) =>
      event.kind === "checker-crashed" && /runtime source-id integrity/u.test(event.detail)));
  });

  it("keeps collector/freeze/overlay measurements pristine after post-pagination global poisoning", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const document = result!.documents[10]!;
    assert.ok(document.snapshot);
    assert.equal(document.infrastructure.some((event) => event.kind === "checker-crashed"), false);
    const outcome = runDocument(document, {
      failOn: "warn", activeRules: [straightQuotes], optionsByRule: {}, coverageFloors: {},
    });
    assert.equal(outcome.report.findings.length, 1);
    assert.equal(outcome.report.findings[0]!.evidence?.bindsFinding, true);
  });

  it("rejects late scripted content through the paired control or pre-PDF reconciliation", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const event = result!.documents[11]!.infrastructure.find((item) =>
      item.kind === "document-not-quiescent" || item.kind === "injection-interference");
    assert.ok(event, "late DOM content reached the delivered state without invalidating measurement");
    assert.ok(Number(event.measured?.mutationDelta ?? 0) > 0 || event.detail.includes("control quantities"));
  });

  it("runs paired controls at one pathname in fresh storage-isolated contexts", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const document = result!.documents[12]!;
    assert.ok(document.snapshot);
    assert.equal(document.infrastructure.some((event) => event.kind === "injection-interference"), false);
  });

  it("rejects network activity that begins after the measured state", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const event = result!.documents[13]!.infrastructure.find((item) => item.kind === "document-not-quiescent");
    assert.ok(event);
    assert.ok(Number(event.measured?.networkActivity ?? 0) > 0);
  });

  it("rejects an author-triggered pagination preview before the Node-controlled epoch", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const document = result!.documents[14]!;
    assert.equal(document.snapshot, null);
    assert.ok(document.infrastructure.some((event) =>
      event.kind === "checker-crashed" && /pagination|Paged was defined/iu.test(event.detail)));
  });

  it("rejects an author call racing the capability-gated evidence overlay", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const document = result!.documents[15]!;
    assert.equal(document.snapshot, null, "fatal overlay evidence must withdraw the earlier snapshot");
    assert.equal(document.evidence?.length ?? 0, 0, "fatal overlay evidence must not be published");
    assert.ok(document.infrastructure.some((event) =>
      event.kind === "checker-crashed" && /overlay.*raced by author code/u.test(event.detail)));
  });

  it("rejects author collector installation without the Node-held capability", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const document = result!.documents[16]!;
    assert.equal(document.snapshot, null);
    assert.ok(document.infrastructure.some((event) =>
      event.kind === "checker-crashed" && /capability rejected|page error/iu.test(event.detail)));
  });

  it("invalidates a PDF when beforeprint mutates the measured page", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const document = result!.documents[17]!;
    assert.equal(document.snapshot, null, "a PDF produced across mutation remained reportable");
    assert.ok(document.infrastructure.some((event) =>
      event.kind === "checker-crashed" && /PDF changed the measured state|PDF precondition failed/iu.test(event.detail)));
  });

  it("fails closed when author code removes the animation intervention", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const document = result!.documents[18]!;
    assert.equal(document.snapshot, null);
    assert.ok(document.infrastructure.some((event) =>
      event.kind === "checker-crashed" && /animation intervention failed/iu.test(event.detail)));
  });

  it("refuses uppercase and CSS-escaped reserved source-id selectors before injection", async (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    for (const [name, selector] of [
      ["uppercase", "[DATA-BL-SID]"],
      ["escaped", String.raw`[data\2d bl\2d sid]`],
      ["line-continuation", "[data-\\\nbl-sid]"],
    ]) {
      const file = join(root, `reserved-prefix-${name}.html`);
      writeFileSync(file, `<!doctype html><style>p${selector}{break-before:page}</style><p>must not be injected</p>`);
      const rendered = await renderDocuments([file], options(join(root, `reserved-prefix-${name}-evidence`)));
      const event = rendered.documents[0]!.infrastructure.find((item) => item.kind === "source-id-namespace-collision");
      assert.ok(event, `${name} selector altered the source-id namespace without a refusal`);
      assert.equal(rendered.documents[0]!.snapshot, null);
    }
  });

  it("refuses an ambiguous sid-less source join instead of inventing author identity", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const document = noSource!.documents[3]!;
    assert.equal(document.snapshot, null);
    assert.ok(document.infrastructure.some((event) =>
      event.kind === "checker-crashed" && /sid-less exact source identity join ambiguous/iu.test(event.detail)));
  });

  /**
   * The case the corpus did not hold until 0.2.3: an inline SVG.
   *
   * Not one live fixture contained an `<svg>`, and the consequence was not a missing report line.
   * Every document carrying a figure ended in exit 3, because the collector declared each SVG
   * unmeasurable with a reason the rule had not declared. Unit tests, mutation guard and live
   * suite were all green throughout, because none of them reached the code.
   *
   * Four SVGs in one document, four different answers, and the rotated one is the reason the
   * comparison is CTM-normalised: its local box is inside the viewport and its screen box is not.
   */
  /**
   * The case the corpus did not hold until 0.2.3: an inline SVG.
   *
   * Not one live fixture contained an `<svg>`, and the consequence was not a missing report line.
   * Every document carrying a figure ended in exit 3, because the collector declared each SVG
   * unmeasurable with a reason the rule had not declared. Unit tests, mutation guard and live
   * suite were all green throughout, because none of them reached the code.
   *
   * Six SVGs, six different answers, and three of them exist because an independent review found
   * the first three insufficient: `<defs>` text that Chrome measures happily and never paints, a
   * 45-degree label that separates four transformed corners from two, and the per-target split
   * that keeps one unmeasurable element from voiding an entire figure.
   */
  it("measures inline SVG text geometry per target, and normalises it through the CTM", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const document = result!.documents[20]!;
    assert.ok(document.snapshot, "the SVG document produced no snapshot");
    assert.equal(
      document.infrastructure.some((event) => event.kind === "checker-crashed"),
      false,
      `an inline SVG crashed the checker again: ${JSON.stringify(document.infrastructure)}`,
    );

    const svg = document.snapshot.svg;
    assert.equal(svg.length, 6, "the six figures did not all reach the snapshot");
    assert.equal(svg.every((record) => record.measurable), true, "an SVG came back unmeasurable");
    assert.equal(
      svg.every((record) => record.texts.every((text) => text.boxScreen.width > 0 && text.boxScreen.height > 0)),
      true,
      "a target came back with an empty box, which sits inside every viewport",
    );
    assert.equal(
      new Set(svg.flatMap((record) => record.texts.map((text) => text.svgTextKey))).size,
      6,
      "the six measured labels did not get six distinct source identities",
    );
    // Ink is a different question from geometry, and this build answers only the second.
    assert.equal(svg.every((record) => record.inkCollected === false), true);

    // The `<defs>` figure: two `<text>` elements, one of them never painted. Chrome answers
    // getBBox() and getScreenCTM() for it and reports a box 609.65 px outside the viewport — an
    // error finding from a gating rule about an element nobody can see. It is excluded because
    // getBoundingClientRect says it is not laid out, and it is excluded PER TARGET: the label
    // beside it keeps its measurement.
    const defs = svg.find((record) => record.textTargetCount === 2);
    assert.ok(defs, "the defs figure is missing from the snapshot");
    assert.equal(defs.notRenderedTargets, 1);
    assert.equal(defs.unreadableTargets, 0);
    assert.equal(defs.texts.length, 1);

    const outcome = runDocument(document, {
      failOn: "error",
      activeRules: [textOverflowsViewport, textClipped],
      optionsByRule: {},
      coverageFloors: {},
    });
    const viewport = outcome.report.findings.filter((item) => item.ruleId === "svg/text-overflows-viewport");
    assert.equal(viewport.every((item) => item.severity === "error"), true);
    // #outside, #rotated (90°) and #rotated45. Nothing from #inside, #visible or the `<defs>`
    // element — each of those is a way this rule has been wrong before.
    assert.deepEqual(viewport.map((item) => item.target.nodeKey).sort(), ["svg:0:1", "svg:1:0", "svg:2:1"]);

    // The four-corner claim, bound to a number rather than to a comment. At 90 degrees two
    // opposite corners span the same axis-aligned box as four, so the first rotated figure cannot
    // tell the two apart. #rotated45 is placed in the gap between them: its four-corner box
    // crosses the viewport edge by 15.82 px and its two-corner box stays 28 px inside. Rebuilding
    // the collector on [first, last] drops exactly this finding and leaves the other two.
    const corners = viewport.find((item) => item.target.nodeKey === "svg:2:1");
    assert.ok(corners, "the 45-degree label was not reported: two corners would also miss it");
    assert.ok(
      corners.measurement.value > 5 && corners.measurement.value < 25,
      `the 45-degree overshoot moved to ${corners.measurement.value}; the fixture no longer sits in the gap ` +
      "between the two-corner and four-corner boxes and has stopped testing what it claims",
    );

    // The fourth figure does not clip, so the rule has no opinion — and that decline must not
    // count against an error rule whose coverage floor is 1.
    const coverage = outcome.report.coverage["svg/text-overflows-viewport"];
    assert.equal(coverage?.candidates, 5);
    assert.equal(coverage?.measured, 5);
    assert.equal(coverage?.ok, true);
    assert.deepEqual(
      coverage?.notMeasured.map((entry) => ({ reason: entry.reason, count: entry.count })),
      [{ reason: "env/svg-overflow-visible", count: 1 }],
    );
    // And the ink rule says what it cannot do, on every target, without failing the document.
    assert.deepEqual(
      outcome.report.coverage["svg/text-clipped"]?.notMeasured.map((entry) => entry.reason),
      ["env/pixel-oracle-unavailable"],
    );
    assert.equal(outcome.report.coverage["svg/text-clipped"]?.candidates, 0);
    assert.equal(exitCodeFor(outcome.report.verdict), 1, "three error findings must end the run at exit 1");
  });

  /**
   * The positive control, and the document 0.2.2 could not check.
   *
   * `svg-text-geometry.html` ends exit 1 by design, so it can never show that a SOUND document
   * passes — a suite in which no case ends 0 cannot tell "the tool works" from "the tool always
   * complains". This is the case the release exists for: two ordinary figures, nothing wrong with
   * either, and 0.2.2 answered exit 3 on it.
   */
  it("passes a document whose inline SVGs are entirely inside their viewports", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const document = result!.documents[21]!;
    assert.ok(document.snapshot, "the sound SVG document produced no snapshot");
    assert.deepEqual(document.infrastructure, [], "a sound document produced an infrastructure event");

    const outcome = runDocument(document, {
      failOn: "error",
      activeRules: [textOverflowsViewport, textClipped],
      optionsByRule: {},
      coverageFloors: {},
    });
    assert.deepEqual(outcome.report.findings, [], "a document with nothing wrong produced a finding");
    assert.equal(outcome.report.verdict, "clean");
    assert.equal(exitCodeFor(outcome.report.verdict), 0, "the case this release exists for must end 0");
    const coverage = outcome.report.coverage["svg/text-overflows-viewport"];
    assert.equal(coverage?.candidates, 6);
    assert.equal(coverage?.measured, 6);
    assert.equal(coverage?.coverage, 1);

    // Four identical tick labels without an `id` share one content-derived identity. The group
    // size is a fact about the document, so it is counted across records rather than inside one.
    const targets = document.snapshot.svg.flatMap((record) => record.texts);
    const ticks = targets.filter((text) => text.ambiguityGroupSize > 1);
    assert.equal(ticks.length, 4, "the repeated axis labels were not recognised as one group");
    assert.equal(new Set(ticks.map((text) => text.svgTextKey)).size, 1);
    assert.equal(ticks.every((text) => text.ambiguityGroupSize === 4), true);
    assert.equal(
      targets.filter((text) => text.ambiguityGroupSize === 1).length,
      2,
      "the two unique labels must not be dragged into a group",
    );
  });

  it("keeps duplicate-input evidence paths disjoint and records loaded redirect provenance", async (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const duplicate = await renderDocuments(
      [join(FIXTURES, "apparatus-sabotage.html"), join(FIXTURES, "apparatus-sabotage.html")],
      options(join(root, "duplicate-evidence")),
    );
    const paths = duplicate.documents.flatMap((document) => document.evidence?.map((item) => item.path) ?? []);
    assert.ok(paths.length >= 2);
    assert.equal(new Set(paths).size, paths.length, "a later duplicate input overwrote an earlier evidence path");

    const server = createServer((request, response) => {
      if (request.url === "/redirect.svg") { response.writeHead(302, { location: "/image.svg" }).end(); return; }
      if (request.url === "/image.svg") {
        const body = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>';
        response.writeHead(200, {
          "content-type": "image/svg+xml", "content-length": Buffer.byteLength(body), "access-control-allow-origin": "*",
        }).end(body);
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${address.port}`;
    const networkDoc = join(root, "network.html");
    writeFileSync(networkDoc, `<!doctype html><img src="${origin}/redirect.svg"><p>network provenance</p>`);
    try {
      const network = await renderDocuments([networkDoc], {
        ...options(join(root, "network-evidence")), network: { mode: "allowlist", allowed: [origin] },
      });
      const snapshot = network.documents[0]!.snapshot;
      assert.ok(snapshot);
      const loaded = snapshot.resources.find((resource) => resource.resolvedUri === `${origin}/image.svg`);
      assert.equal(loaded?.outcome, "loaded");
      assert.equal(loaded?.status, 200);
      assert.ok((loaded?.bytes ?? 0) > 0);
      assert.match(loaded?.sha256 ?? "", /^[a-f0-9]{64}$/u);
      assert.deepEqual(snapshot.meta.inputIdentity?.redirects, [
        { from: `${origin}/redirect.svg`, to: `${origin}/image.svg`, status: 302 },
      ]);
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });
});
