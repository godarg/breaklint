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
import { coverageFloorMap, resolveConfig } from "../../src/config/resolve.ts";
import type { DocumentInput } from "../../src/core/engine.ts";
import type { BlockRecord, Finding } from "../../src/core/types.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURES = join(REPO, "tests", "fixtures");
const optional = process.env.BREAKLINT_LIVE_OPTIONAL === "1";
const missing = [
  resolveBrowser().path ? null : "a browser",
  resolvePackageRoot("pagedjs", REPO) ? null : "pagedjs",
  resolvePackageRoot("pdfjs-dist", REPO) ? null : "pdfjs-dist",
].filter((value): value is string => value !== null);

/** The whole registry under the default profile, optionally with rule overrides, as the CLI runs it. */
function withProfile(document: DocumentInput, rules: Record<string, unknown> = {}) {
  const config = resolveConfig({ file: { rules }, cli: {} });
  return runDocument(document, {
    failOn: config.failOn, activeRules: config.activeRules, optionsByRule: config.optionsByRule,
    coverageFloors: coverageFloorMap(config),
  });
}

/**
 * Findings of one rule that share a fingerprint, as `rule on pages a, b share <fp>`. On a document
 * whose content is distinct by construction, every entry is a collision the tool manufactured —
 * the v1 key may legitimately be shared by two IDENTICAL source blocks, which is why this is a test
 * and not an engine assertion.
 */
function fingerprintCollisions(findings: readonly Finding[]): string[] {
  const out: string[] = [];
  for (const rule of new Set(findings.map((finding) => finding.ruleId))) {
    const own = findings.filter((finding) => finding.ruleId === rule);
    for (const fingerprint of new Set(own.map((finding) => finding.fingerprint))) {
      const pages = own.filter((finding) => finding.fingerprint === fingerprint).map((finding) => finding.page);
      if (pages.length > 1) out.push(`${rule} on pages ${pages.join(", ")} share ${fingerprint.slice(0, 16)}`);
    }
  }
  return out;
}

/**
 * The evidence facts that do not depend on the PDF text layer: which marks the overlay could not
 * place. They are observable on any browser; whether the placed marks BIND is only observable
 * where the browser's PDF carries them, which is why the exit-code assertions come last.
 */
function unplacedMarks(document: DocumentInput): string[] {
  return (document.evidence ?? []).flatMap((page) =>
    (page.unplacedMarks ?? []).map((mark) => `p${page.page}:${mark.sid}:${mark.side}`));
}

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
    if (result?.documents.length === 29 && noSource?.documents.length === 4) return true;
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
        join(FIXTURES, "svg-geometry-declines.html"),
        join(FIXTURES, "fragmentainer-residue.html"),
        join(FIXTURES, "margin-running-elements.html"),
        join(FIXTURES, "margin-running-parity.html"),
        join(FIXTURES, "fullbleed-avoid.html"),
        join(FIXTURES, "margin-running-after-heading.html"),
        join(FIXTURES, "margin-running-in-section.html"),
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
      29,
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

  it("continues only when a failed image box equals authored dimensions", async (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const declared = join(root, "missing-image-declared.html");
    const undeclared = join(root, "missing-image-undeclared.html");
    const cssOverridden = join(root, "missing-image-css-overridden.html");
    writeFileSync(
      declared,
      '<!doctype html><img src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==" ' +
        'width="10" height="10" alt=""><img src="missing-image.png" width="36" height="24" alt="">' +
        '<p>declared image size</p>',
    );
    writeFileSync(
      undeclared,
      '<!doctype html><img src="missing-image.png" alt="visible replacement text"><p>no declared image size</p>',
    );
    writeFileSync(
      cssOverridden,
      '<!doctype html><style>img{width:auto}</style>' +
        '<img src="missing-image.png" width="36" height="24" alt="replacement text changes the box">' +
        '<p>declared attributes overridden by authored CSS</p>',
    );

    const imageRun = await renderDocuments(
      [declared, undeclared, cssOverridden],
      options(join(root, "missing-image-evidence")),
    );
    const declaredDocument = imageRun.documents[0]!;
    assert.ok(declaredDocument.snapshot, "authored width/height should keep the layout measurable");
    const imageEvent = declaredDocument.infrastructure.find((event) => event.kind === "image-content-unavailable");
    assert.ok(imageEvent, "the missing content must remain a named diagnostic");
    assert.deepEqual(imageEvent.measured, {
      images: [{ resourceIndex: 2, widthPx: 36, heightPx: 24, declaredWidthPx: 36, declaredHeightPx: 24 }],
    });

    const undeclaredDocument = imageRun.documents[1]!;
    assert.equal(undeclaredDocument.snapshot, null, "a replacement-text box is not stable image geometry");
    assert.ok(
      undeclaredDocument.infrastructure.some((event) =>
        event.kind === "checker-crashed" && /equal to explicit authored width and height/iu.test(event.detail)),
      `missing fatal image diagnostic: ${JSON.stringify(undeclaredDocument.infrastructure)}`,
    );
    assert.doesNotMatch(
      JSON.stringify(undeclaredDocument.infrastructure),
      /(?:file:|missing-image\.png)/u,
      "the fatal branch persisted the failed resource URI",
    );

    const cssOverriddenDocument = imageRun.documents[2]!;
    assert.equal(cssOverriddenDocument.snapshot, null, "authored CSS detached the failed-image box from its attributes");
    assert.ok(
      cssOverriddenDocument.infrastructure.some((event) =>
        event.kind === "checker-crashed" && /equal to explicit authored width and height/iu.test(event.detail)),
      `missing CSS-drift diagnostic: ${JSON.stringify(cssOverriddenDocument.infrastructure)}`,
    );
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
    // `render-unstable`, not `checker-crashed`: the apparatus did not fail, the PDF disagrees with
    // the state the rules were run against. The detail has to NAME what moved — a reconciliation
    // that reports only `freezeChanged: true` sends the reader to look at the whole document, and
    // that is what this event said for a full release cycle.
    const unstable = document.infrastructure.find((event) => event.kind === "render-unstable");
    assert.ok(
      unstable,
      `no render-unstable event: ${JSON.stringify(document.infrastructure.map((e) => e.kind))}`,
    );
    assert.match(unstable.detail, /freeze component\(s\) boxes/u, unstable.detail);
    const measured = unstable.measured as Record<string, unknown>;
    assert.deepEqual(measured.driftedComponents, ["boxes"]);
    assert.ok(Array.isArray(measured.driftSample) && measured.driftSample.length > 0);
  });

  /**
   * The negative control for the class that took six of eighteen real chapters out of measurement.
   *
   * RED WITHOUT THE FIX: the event carried `maxDeltaPx: 1816` and a sentence ending "Every number
   * in the report comes from the probe, so the report is not written" — a 1 816 px disagreement
   * blamed on this tool's own geometry, with nothing in `measured` that could be acted on. The two
   * assertions below are exactly what was missing: the cause, named, and the elements it is about.
   */
  it("names the unplaced fragmentainer content behind a geometry disagreement", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const document = result!.documents[23]!;
    assert.equal(document.snapshot, null, "a document with unplaced content remained reportable");
    const event = document.infrastructure.find((e) => e.kind === "geometry-cross-check-failed");
    assert.ok(event, `no cross-check failure: ${JSON.stringify(document.infrastructure.map((e) => e.kind))}`);
    assert.match(event.detail, /Paged\.js left \d+ element\(s\).*in an overflow column of page\(s\)/u, event.detail);
    assert.match(event.detail, /unsplittable table box/u, event.detail);
    const residue = (event.measured as Record<string, unknown>).fragmentainerResidue as {
      count: number; atomicCount: number; pages: number[]; pitchPx: number;
      sample: { tag: string; display: string; sourceId: string | null }[];
    };
    assert.ok(residue, `the cause is named in the sentence but absent from measured: ${JSON.stringify(event.measured)}`);
    assert.ok(residue.count > 0 && residue.atomicCount > 0);
    assert.ok(residue.pages.length > 0);
    // The pitch is `column-width + column-gap` on `.pagedjs_page_content`, and it is what the two
    // geometry sources disagree by. Reporting it lets a reader check the arithmetic themselves.
    assert.equal(residue.pitchPx, 1816);
    // The TABLE residue must be attributable; other tags carry no injected id and are not required
    // to. Same boundary, same reason, as tests/tools/pagination-residue-gate.mjs.
    const tableResidue = residue.sample.filter((r) => r.display.startsWith("table"));
    assert.ok(tableResidue.length > 0);
    assert.ok(tableResidue.every((r) => r.sourceId !== null), JSON.stringify(residue.sample));
    assert.ok(residue.sample.some((r) => r.display === "table-row"));
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
   * Seven SVGs, seven different answers, and four of them exist because two independent reviews
   * found the earlier ones insufficient: `<defs>` text that Chrome measures happily and never
   * paints, a 45-degree label that separates four transformed corners from two, three ways to be
   * laid out and still invisible, and the per-target split that keeps one unmeasurable element
   * from voiding an entire figure.
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
    assert.equal(svg.length, 7, "the seven figures did not all reach the snapshot");
    assert.equal(svg.every((record) => record.measurable), true, "an SVG came back unmeasurable");
    assert.equal(
      svg.every((record) => record.texts.every((text) => text.boxScreen.width > 0 && text.boxScreen.height > 0)),
      true,
      "a target came back with an empty box, which sits inside every viewport",
    );
    assert.equal(
      new Set(svg.flatMap((record) => record.texts.map((text) => text.svgTextKey))).size,
      7,
      "the seven measured labels did not get seven distinct source identities",
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

    // Laid out and still invisible, four ways: visibility:hidden, opacity:0, a <text> with
    // neither fill nor stroke, and opacity inherited from an ancestor `<g>`. All four return a
    // full client rect, so the check that catches the `<defs>` case does not see any of them —
    // and the last one also escapes a computed-style read on the element itself, which reports
    // opacity 1 on the child. Each sits far below its viewport, so counting one again is an error
    // finding about something nobody can see.
    const invisible = svg.find((record) => record.textTargetCount === 5);
    assert.ok(invisible, "the invisible-targets figure is missing from the snapshot");
    assert.equal(invisible.notRenderedTargets, 4);
    assert.equal(invisible.unreadableTargets, 0);
    assert.equal(invisible.texts.length, 1, "an invisible label was collected as a target");

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
    // The page number, which is the first thing a reader uses to go and look. Until 0.2.3 all
    // three rules derived it and all three got it wrong — one by looking an SVG nodeKey up among
    // the BLOCK keys, which never match, the other two by writing 1 outright. Every finding
    // claimed page 1 on a fixture that produces them on three different pages.
    assert.deepEqual(
      viewport.map((item) => [item.target.nodeKey, item.page]).sort(),
      [["svg:0:1", 1], ["svg:1:0", 2], ["svg:2:1", 3]],
    );

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
    assert.equal(coverage?.candidates, 6);
    assert.equal(coverage?.measured, 6);
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
    assert.deepEqual(
      document.infrastructure.map((event) => ({ kind: event.kind, measured: event.measured })),
      [{
        kind: "geometry-cross-check-passed",
        measured: {
          checked: 8,
          required: 8,
          candidates: 12,
          eligible: 12,
          excludedSvgDescendants: 0,
          excludedInlineBlockContainers: 0,
          maxDeltaPx: 0,
          tolerancePx: 0.05,
        },
      }],
      "the sound document did not retain its complete independent geometry-oracle evidence",
    );

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
    assert.equal(coverage?.candidates, 13);
    assert.equal(coverage?.measured, 13);
    assert.equal(coverage?.coverage, 1);

    // Identical tick labels without an `id` share one content-derived identity, and the two charts
    // are structurally identical, so they share one `svgRootKey` too. The group is therefore a
    // fact about the DOCUMENT: eight targets under one key across two records, not two groups of
    // four. Counted inside a record it came back as 1 — for exactly the collision the field is for.
    const targets = document.snapshot.svg.flatMap((record) => record.texts);
    const bySize = new Map<number, number>();
    for (const text of targets) bySize.set(text.ambiguityGroupSize, (bySize.get(text.ambiguityGroupSize) ?? 0) + 1);
    assert.deepEqual([...bySize.entries()].sort((a, b) => a[0] - b[0]), [[1, 3], [2, 2], [8, 8]]);
    const ticks = targets.filter((text) => text.ambiguityGroupSize === 8);
    assert.equal(new Set(ticks.map((text) => text.svgTextKey)).size, 1, "the eight ticks are one identity");
    assert.equal(
      new Set(document.snapshot.svg.filter((r) => r.textTargetCount === 5).map((r) => r.sourceKey)).size,
      1,
      "the two identical charts must share one root identity, which is what makes the group cross records",
    );

    // Nested viewports. The inner label lies OUTSIDE the outer viewport and inside its own; while
    // the outer record also collected it, it was compared against the wrong box and this sound
    // document reported an error.
    const nested = document.snapshot.svg.filter((record) => record.textTargetCount === 1);
    assert.equal(nested.length, 3, "plain, outer and inner should each hold exactly one target");
    assert.equal(
      targets.filter((text) => text.svgTextKey.includes("outer")).length,
      1,
      "the outer record claimed the inner label as well",
    );
  });

  it("fails closed when SVG paint or viewport geometry is outside the box oracle", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const document = result!.documents[22]!;
    assert.ok(document.snapshot, "the SVG decline document produced no snapshot");
    const byId = new Map(document.snapshot.svg.map((record) => [record.sourceKey, record]));
    const record = (id: string) => {
      const found = [...byId.values()].find((item) => item.sourceKey?.includes(id));
      assert.ok(found, `missing SVG ${id}`);
      return found;
    };

    const transparent = record("transparent-paints");
    assert.equal(transparent.textTargetCount, 3);
    assert.equal(transparent.notRenderedTargets, 2, "alpha-zero fills are not paint targets");
    assert.equal(transparent.unsupportedTargets, 0);
    assert.equal(transparent.texts.length, 1);

    const complex = record("complex-paints");
    assert.equal(complex.textTargetCount, 8);
    assert.equal(complex.notRenderedTargets, 1, "the source text in defs is not itself painted");
    assert.equal(complex.unsupportedTargets, 6, "clip, mask, filter, stroke, direct use and nested use must all decline");
    assert.equal(complex.texts.length, 1, "the ordinary text in the mixed SVG remains measurable");

    const border = record("border-box");
    assert.equal(border.measurable, false);
    assert.equal(border.reason, "env/svg-viewport-geometry-unsupported");

    const definitions = record("many-definitions");
    assert.equal(definitions.textTargetCount, 502);
    assert.equal(definitions.notRenderedTargets, 501);
    assert.equal(definitions.measurable, true, "the target cap must not count definitions that are never painted");
    assert.equal(definitions.texts.length, 1);

    const outcome = runDocument(document, {
      failOn: "error",
      activeRules: [textOverflowsViewport],
      optionsByRule: {},
      coverageFloors: {},
    });
    assert.deepEqual(outcome.report.findings, [], "unsupported geometry produced a guessed error finding");
    const coverage = outcome.report.coverage["svg/text-overflows-viewport"];
    assert.equal(coverage?.candidates, 10);
    assert.equal(coverage?.measured, 3);
    assert.deepEqual(
      coverage?.notMeasured.map((entry) => ({ reason: entry.reason, count: entry.count })),
      [
        { reason: "env/svg-painted-bounds-unsupported", count: 6 },
        { reason: "env/svg-viewport-geometry-unsupported", count: 1 },
      ],
    );
    assert.equal(outcome.report.verdict, "insufficient-coverage");
    assert.equal(exitCodeFor(outcome.report.verdict), 4);
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

  /**
   * `position: running(...)` clones are not part of the flow. Paged.js deep-clones both running
   * elements into a margin box of every page and each clone keeps the source id; measured before
   * this was fixed, the snapshot carried seven records per running element on this six-page
   * document and the default profile reported ten widow/orphan warnings, all about clones.
   */
  it("keeps running() margin-box clones out of the snapshot, the page anchors and the findings", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const document = result!.documents[24]!;
    const snapshot = document.snapshot;
    assert.ok(snapshot, `no snapshot: ${JSON.stringify(document.infrastructure)}`);
    assert.ok(snapshot.pages.length >= 3, `the fixture must span at least three pages, got ${snapshot.pages.length}`);
    for (const id of ["running-title", "running-side"]) {
      const records: BlockRecord[] = snapshot.blocks.filter((block) => block.authorId === id);
      assert.equal(records.length, 1, `${id}: ${records.length} records on ${snapshot.pages.length} pages — margin-box clones counted as fragments`);
      assert.equal(records[0]!.fragmentCount, 1);
      assert.deepEqual(records[0]!.box, { x: 0, y: 0, width: 0, height: 0 }, `${id}: the kept record is not the hidden in-flow original`);
      assert.equal(snapshot.textLines.some((line) => line.blockKey === records[0]!.nodeKey), false, `${id}: a clone contributed text lines`);
    }
    // Nothing in this document bleeds: every block with a box lies inside its page's content box,
    // so a box anywhere else would be margin-box content.
    for (const block of snapshot.blocks.filter((item) => item.box.width > 0 || item.box.height > 0)) {
      const box = snapshot.pages[block.page - 1]!.contentBox;
      assert.ok(
        block.box.x >= box.x - 0.5 && block.box.y >= box.y - 0.5 &&
          block.box.x + block.box.width <= box.x + box.width + 0.5 && block.box.y + block.box.height <= box.y + box.height + 0.5,
        `${block.nodeKey} (${block.authorId}) lies outside the content box of page ${block.page}: ${JSON.stringify(block.box)}`,
      );
    }
    const anchors = snapshot.pages.map((page) => page.firstSemanticBlockKey);
    assert.equal(new Set(anchors).size, anchors.length, `pages share an anchor: ${JSON.stringify(anchors)}`);
    assert.equal(anchors.some((anchor) => /running-(title|side)/u.test(anchor ?? "")), false, `a page is anchored to a running element: ${JSON.stringify(anchors)}`);

    // The hidden originals are not measured by the rules either: they have no layout box.
    const tooTall = withProfile(document).report.evaluations.filter((row) =>
      row.ruleId === "layout/unbreakable-block-too-tall" && row.targetRef.sid !== null &&
      snapshot.blocks.some((block) => block.sid === row.targetRef.sid && /running-(title|side)/u.test(block.authorId ?? "")));
    assert.deepEqual(tooTall.map((row) => [row.status, row.reason]), [["excluded", "rule/target-not-rendered"], ["excluded", "rule/target-not-rendered"]]);

    const outcome = withProfile(document);
    assert.deepEqual(
      outcome.report.findings.map((finding) => `${finding.ruleId}@${finding.page}:${finding.target.nodeKey}`),
      [],
      "a document of one-line paragraphs and two running elements has nothing to report",
    );
    assert.deepEqual(fingerprintCollisions(withProfile(document, { "layout/half-empty-page": true }).report.findings), []);
    // Evidence: no mark is required for a clone, and every flow mark fits its page. Measured
    // before this was fixed: 24 unplaced marks, 4 per page, every page unbound, exit 4.
    assert.deepEqual(unplacedMarks(document), [], "the evidence overlay tried to mark margin-box clones");
    // Everything below needs a browser whose PDF carries the marks (CI's current Chrome).
    assert.deepEqual(outcome.report.evidenceCoverage?.status, "complete", `evidence: ${JSON.stringify(outcome.report.evidenceCoverage)}`);
    assert.equal(exitCodeFor(outcome.report.verdict), 0);
  });

  /**
   * The parity-blank page stays blank under a running header. Measured before this was fixed: the
   * header clone made page 2 look occupied, its boundaries came out `overflow` and `forced`, the
   * default profile reported a widow, an orphan and an orphaned continuation page, and with
   * `layout/half-empty-page` on, three findings on three pages carried one fingerprint.
   */
  it("keeps a running header from occupying a parity-blank page or anchoring its neighbours", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const document = result!.documents[25]!;
    const snapshot = document.snapshot;
    assert.ok(snapshot, `no snapshot: ${JSON.stringify(document.infrastructure)}`);
    assert.equal(snapshot.pages.length, 3, "chapter one, the inserted verso page, chapter two");
    // The blank page identified independently of the field under test and of the block records:
    // by its measured fill, which is read from the text and replaced boxes of the page CONTENT and
    // has never seen a margin box.
    assert.deepEqual(
      snapshot.pages.map((page) => page.fill.net > 0),
      [true, false, true],
      "premise: chapter two starts on page 3 after a page 2 with nothing in its content area",
    );
    assert.deepEqual(snapshot.pages.map((page) => page.blank), [false, true, false], "a margin-box clone made the blank page look occupied");
    const blank = snapshot.pages[1]!;
    assert.equal(blank.incomingBreakCause.kind, "parity");
    assert.equal(blank.outgoingBreakCause.kind, "parity");
    assert.equal(blank.outgoingBreakCause.determinedBy, "page-blank");
    assert.deepEqual(
      snapshot.pages.map((page) => page.firstSemanticBlockKey),
      [blockKey({ authorId: "c1p1", blockSignature: "" }), null, blockKey({ authorId: "chapter-two", blockSignature: "" })],
      "a page is anchored to the running header, its hidden original, or nothing",
    );

    const outcome = withProfile(document);
    assert.deepEqual(outcome.report.findings.map((finding) => `${finding.ruleId}@${finding.page}`), []);
    const halfEmpty = withProfile(document, { "layout/half-empty-page": true }).report.findings;
    assert.ok(halfEmpty.length > 0, "premise: the sparse chapter pages produce page findings, or the fingerprint guard checks nothing");
    assert.deepEqual(fingerprintCollisions(halfEmpty), []);
    assert.equal(halfEmpty.some((finding) => finding.page === 2), false, "a finding on the parity-blank page");
    // Evidence: the header clone needs no mark any more (measured before: 6 unplaced, 2 per page).
    // The blank page carries no source block and so no mark at all.
    assert.deepEqual(unplacedMarks(document), [], "the evidence overlay tried to mark the running-header clone");
    const blankEvidence = document.evidence?.find((page) => page.page === 2);
    assert.equal(blankEvidence?.conformance, null, "premise: the blank page has no mark to bind");
    // Page 2 carries nothing to bind, and that is now proven rather than left to block the run:
    // Paged.js' blank marker, the empty page area in the DOM, and the delivered PDF's text layer
    // and raster of that area (tests/live/real-documents.test.ts). It leaves the binding
    // requirement with a declared env/parity-blank-page decline; it is never counted as bound.
    // Before that change this fixture ended insufficient-coverage (exit 4) under evidence binding.
    assert.deepEqual(document.evidenceRequirement, { required: true, expectedPages: 3, blankPages: [2] });
    // Everything below needs a browser whose PDF carries the marks (CI's current Chrome).
    assert.deepEqual(
      { status: outcome.report.evidenceCoverage?.status, boundPages: outcome.report.evidenceCoverage?.boundPages, expectedPages: outcome.report.evidenceCoverage?.expectedPages },
      { status: "complete", boundPages: 2, expectedPages: 2 },
      `evidence: ${JSON.stringify(outcome.report.evidenceCoverage)}`,
    );
    assert.deepEqual(document.evidence?.map((page) => page.bindsFinding), [true, false, true]);
    assert.equal(exitCodeFor(outcome.report.verdict), 0, `${outcome.report.verdict}: ${outcome.report.exitReason}`);
  });

  /**
   * A full-bleed `break-inside: avoid` block is still judged on all of its fragments. Its negative
   * side margins put every fragment left of the content box; the coordinate filter this rule used
   * to carry discarded all of them, measured the first fragment (335.81 px against 340.16 px) and
   * the document came back clean at exit 0.
   */
  it("reports a full-bleed unbreakable block whose fragments all lie outside the content box", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    const document = result!.documents[26]!;
    const snapshot = document.snapshot;
    assert.ok(snapshot, `no snapshot: ${JSON.stringify(document.infrastructure)}`);
    const fragments = snapshot.blocks.filter((block) => block.authorId === "full-bleed");
    assert.ok(fragments.length >= 3, `the block must split into three or more fragments, got ${fragments.length}`);
    for (const fragment of fragments) {
      const box = snapshot.pages[fragment.page - 1]!.contentBox;
      assert.ok(fragment.box.x < box.x - 1, `premise: fragment ${fragment.fragmentIndex} starts inside the content box (${fragment.box.x} vs ${box.x})`);
    }
    const outcome = withProfile(document);
    const tooTall = outcome.report.findings.filter((finding) => finding.ruleId === "layout/unbreakable-block-too-tall");
    assert.equal(tooTall.length, 1, "the full-bleed block was judged on one piece");
    const sum = fragments.reduce((total, fragment) => total + fragment.box.height, 0);
    assert.equal(tooTall[0]!.target.sid, fragments[0]!.sid);
    assert.ok(Math.abs(tooTall[0]!.measurement.value - sum) < 0.01, `value ${tooTall[0]!.measurement.value} is not the sum ${sum}`);
    assert.ok(tooTall[0]!.measurement.value > 3 * tooTall[0]!.measurement.threshold);
    assert.equal(tooTall[0]!.severity, "error");
    // Evidence: the fragments bleed into the side margin and are printed there, so their marks are
    // placed there. Measured before this was fixed: 212 unplaced marks, pages 2-7 unbound, exit 4.
    assert.deepEqual(unplacedMarks(document), [], "a mark for an in-flow fragment in the side margin was refused");
    // Everything below needs a browser whose PDF carries the marks (CI's current Chrome).
    assert.equal(outcome.report.evidenceCoverage?.status, "complete", `evidence: ${JSON.stringify(outcome.report.evidenceCoverage)}`);
    assert.equal(tooTall[0]!.evidence.bindsFinding, true, "the error finding on a full-bleed block is not evidenced");
    assert.equal(exitCodeFor(outcome.report.verdict), 1, "a build-breaking block must end the run at exit 1");
  });

  /**
   * The source-id integrity check reads the order of the flow. Paged.js puts the running title's
   * clone in the margin box, ahead of the content area in the page box, so a whole-document read
   * met it before everything that precedes the title in the source. Measured before this was
   * fixed: both documents ended `checker-crashed` at the post-pagination source-id check (exit 3).
   * The section document also spans every page, so its pages must be anchored to the first block
   * that starts on each of them, not to the section.
   */
  it("measures a running title that follows a heading or sits inside a section, without an integrity failure", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    if (!completeChain(t)) return;
    for (const [index, wrapper] of [[27, null], [28, "chapter"]] as const) {
      const document = result!.documents[index]!;
      const snapshot = document.snapshot;
      assert.ok(snapshot, `document ${index}: no snapshot: ${JSON.stringify(document.infrastructure)}`);
      assert.equal(document.infrastructure.some((event) => event.kind === "checker-crashed"), false,
        `document ${index}: ${JSON.stringify(document.infrastructure)}`);
      assert.ok(snapshot.pages.length >= 2, `document ${index}: the fixture must span pages`);
      assert.equal(snapshot.blocks.filter((block) => block.authorId === "running-title").length, 1,
        `document ${index}: the running title was recorded from its margin-box clones`);
      const anchors = snapshot.pages.map((page) => page.firstSemanticBlockKey);
      assert.equal(new Set(anchors).size, anchors.length, `document ${index}: pages share an anchor: ${JSON.stringify(anchors)}`);
      assert.equal(anchors.includes("id:running-title"), false);
      if (wrapper) {
        assert.equal(snapshot.blocks.filter((block) => block.authorId === wrapper).length, snapshot.pages.length,
          "premise: the section has a fragment on every page");
        assert.deepEqual(anchors.filter((anchor) => anchor === `id:${wrapper}`), [`id:${wrapper}`],
          "a page other than the section's first was anchored to the section");
      }
      const outcome = withProfile(document);
      assert.deepEqual(outcome.report.findings.map((finding) => `${finding.ruleId}@${finding.page}`), []);
      assert.deepEqual(unplacedMarks(document), [], `document ${index}: the evidence overlay tried to mark a clone`);
    }
    // Needs a browser whose PDF carries the marks (CI's current Chrome).
    for (const index of [27, 28]) {
      const outcome = withProfile(result!.documents[index]!);
      assert.equal(exitCodeFor(outcome.report.verdict), 0, `document ${index}: ${outcome.report.exitReason}`);
    }
  });
});
