import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, it } from "node:test";

import { collisionSources, discoverLocalAssets } from "../../src/acquire/render-run.ts";
import { PRIMITIVES_SOURCE } from "../../src/measure/primitives.ts";
import {
  buildSourceModel,
  compareControlSignatures,
  CONTROL_SIGNATURE_SOURCE,
  inputIdentity,
  validateInjectedProvenance,
  validateSnapshotInvariants,
} from "../../src/measure/snapshot.ts";
import { injectSourceIds } from "../../src/source/inject.ts";
import { detectCollision } from "../../src/source/collision.ts";
import { loadCorpus } from "../fixtures/corpus.ts";

describe("the live snapshot seam", () => {
  it("takes author identity and the whole signature from source text", () => {
    const source = '<!doctype html><section id="chapter"><p>whole <em>source</em> block</p></section>';
    const injected = injectSourceIds(source, "book.html");
    const model = buildSourceModel(injected.html, "book.html");
    const chapter = Object.values(model.blocks).find((block) => block.authorId === "chapter");
    assert.ok(chapter);
    assert.equal(chapter.blockSignature, "whole source block");
    assert.ok(model.runs.some((run) => run.text.includes("source") && run.ancestorTags.includes("em")));
  });

  it("binds blocked/loaded outcomes and redirect hops into input identity", () => {
    const base = {
      html: "<p>x</p>", browserVersion: "Browser/1", platform: "test", fontFamilies: [],
      resources: [{
        requestedUri: "https://example.invalid/a", resolvedUri: "https://example.invalid/b",
        scheme: "https", origin: "https://example.invalid", status: 200, bytes: 3, sha256: "abc",
        outcome: "loaded" as const,
      }],
      redirects: [{ from: "https://example.invalid/a", to: "https://example.invalid/b", status: 302 }],
    };
    const loaded = inputIdentity(base);
    const blocked = inputIdentity({ ...base, resources: [{ ...base.resources[0]!, status: null, bytes: 0, sha256: null, outcome: "blocked" as const }] });
    assert.notEqual(loaded.resourcesHash, blocked.resourcesHash);
    assert.equal(loaded.resources[0]!.outcome, "loaded");
    assert.deepEqual(loaded.redirects, base.redirects);
  });

  it("rejects a source-map offset that no longer points to the source opening tag", () => {
    const source = '<!doctype html><p id="target">text</p>';
    const injected = injectSourceIds(source, "book.html");
    injected.map.s0000!.offset += 1;
    const validation = validateInjectedProvenance(source, injected);
    assert.equal(validation.ok, false);
    assert.match(validation.issues.join("\n"), /does not point to a source opening tag/u);
  });

  it("treats HTML handlers and SVG scripts as script surfaces for the paired control", () => {
    for (const source of [
      '<!doctype html><img onerror="window.x=1">',
      '<!doctype html><svg><script>window.x=1</script></svg>',
    ]) {
      const injected = injectSourceIds(source, "active.html");
      assert.equal(buildSourceModel(injected.html, "active.html").scriptBearing, true);
    }
  });

  it("a style-only difference is a §10.5 failure even when every other quantity is equal", () => {
    const base = { pages: 1, geometry: "p:0,0,10,10", text: "same", style: "color:black", resources: "" };
    const changed = compareControlSignatures({ ...base, style: "color:red" }, base);
    assert.equal(changed.equal, false);
    assert.deepEqual(changed.changed, ["style"]);
  });

  it("the in-browser control payload reads every contract-required style field", () => {
    // This pins the production payload, not just compareControlSignatures(). Removing one read
    // must make the mutation red before a browser fixture has a chance to mask it.
    for (const field of ["s.color", "s.backgroundColor", "s.fontWeight", "s.textDecorationLine"]) {
      assert.ok(CONTROL_SIGNATURE_SOURCE.includes(field), `the control payload stopped reading ${field}`);
    }
  });

  it("the in-browser control payload reads DOM, inline and CSSOM resource URIs", () => {
    for (const seam of ["P.styleSheets()", "P.sheetRules(sheet)", '"srcset"', "addCssResources"]) {
      assert.ok(CONTROL_SIGNATURE_SOURCE.includes(seam), `the resource control stopped reading ${seam}`);
    }
  });

  it("the paired control signs the whole page, including generated margin boxes", () => {
    assert.equal(CONTROL_SIGNATURE_SOURCE.includes(".pagedjs_page_content"), false);
    assert.ok(CONTROL_SIGNATURE_SOURCE.includes('P.all(page, "*")'));
    assert.ok(CONTROL_SIGNATURE_SOURCE.includes("P.text(page)"));
  });

  it("captures the font/image barrier and CSSOM resource getters before author scripts", () => {
    for (const seam of [
      "fontsReady", "fontFaces", "fontStatus", "fontFamily", "imageUri",
      "styleSheets", "sheetHref", "sheetRules", "ruleCssText", "nestedRules",
    ]) {
      assert.ok(PRIMITIVES_SOURCE.includes(`${seam}:`), `${seam} is absent from the pristine boundary`);
    }
    for (const call of ["P.styleSheets()", "P.sheetHref(sheet)", "P.sheetRules(sheet)", "P.ruleCssText(rule)"]) {
      assert.ok(CONTROL_SIGNATURE_SOURCE.includes(call), `${call} is not used by the control signature`);
    }
    assert.equal(CONTROL_SIGNATURE_SOURCE.includes("document.styleSheets"), false);
    for (const getter of ["mutationTypeGet", "mutationAttributeNameGet", "mutationType:", "mutationAttributeName:"]) {
      assert.ok(PRIMITIVES_SOURCE.includes(getter), `runtime SID mutation reads an author-poisonable getter: ${getter}`);
    }
  });

  it("fails closed on mutated §9 cause, epoch, line, SVG, justify and blank invariants", () => {
    const corpus = loadCorpus();
    const base = structuredClone(corpus.find((item) => item.name === "widow-trigger")!.snapshot);
    const mutations: Array<{ name: string; snapshot: typeof base }> = [];

    const cause = structuredClone(base);
    cause.pages[0]!.incomingBreakCause = { kind: "unknown", determinedBy: "break-token", cascadeHint: null };
    mutations.push({ name: "cause", snapshot: cause });

    const invalidCauseEnum = structuredClone(base);
    (invalidCauseEnum.pages[0]!.incomingBreakCause as { kind: string }).kind = "invented";
    mutations.push({ name: "cause-enum", snapshot: invalidCauseEnum });

    const boundary = structuredClone(base);
    assert.ok(boundary.pages.length > 1);
    boundary.pages[0]!.outgoingBreakCause = {
      kind: "unknown", determinedBy: "undetermined", cascadeHint: null,
    };
    mutations.push({ name: "boundary-reconciliation", snapshot: boundary });

    const epoch = structuredClone(base);
    epoch.pages.push({ ...structuredClone(epoch.pages[0]!), epoch: epoch.pages[0]!.epoch + 1 });
    mutations.push({ name: "epoch", snapshot: epoch });

    const line = structuredClone(base);
    line.blocks[0]!.lines = null;
    delete line.blocks[0]!.notMeasuredReason;
    mutations.push({ name: "line", snapshot: line });

    const referencedLine = structuredClone(base);
    referencedLine.blocks[0]!.lines = [987_654];
    mutations.push({ name: "referenced-line", snapshot: referencedLine });

    const svg = structuredClone(corpus.find((item) => item.name === "svg-overflow-trigger")!.snapshot);
    svg.svg[0]!.measurable = false;
    delete svg.svg[0]!.reason;
    mutations.push({ name: "svg", snapshot: svg });

    const justify = structuredClone(corpus.find((item) => item.name === "word-spacing-trigger")!.snapshot);
    const justifiedBlock = justify.blocks.find((block) => block.effectiveStyle.textAlign === "justify")!;
    justify.textLines.find((item) => item.blockKey === justifiedBlock.nodeKey)!.wordBoxes = null;
    mutations.push({ name: "justify", snapshot: justify });

    const blank = structuredClone(base);
    blank.pages[0]!.blank = true;
    blank.pages[0]!.fill.net = 0.5;
    mutations.push({ name: "blank", snapshot: blank });

    for (const mutation of mutations) {
      const result = validateSnapshotInvariants(mutation.snapshot, { sourceMapInjection: true });
      assert.equal(result.ok, false, `${mutation.name} mutation escaped the runtime invariant gate`);
    }
  });

  it("distinguishes measured zero lines from an unmeasured null without a reason (V-M2-J)", () => {
    const base = structuredClone(loadCorpus().find((item) => item.name === "widow-trigger")!.snapshot);
    const baselineIssues = validateSnapshotInvariants(base, { sourceMapInjection: true }).issues;
    const measuredEmpty = structuredClone(base);
    measuredEmpty.blocks[0]!.lines = [];
    assert.deepEqual(validateSnapshotInvariants(measuredEmpty, { sourceMapInjection: true }).issues, baselineIssues);

    const silentlyAbsent = structuredClone(base);
    silentlyAbsent.blocks[0]!.lines = null;
    delete silentlyAbsent.blocks[0]!.notMeasuredReason;
    const absentIssues = validateSnapshotInvariants(silentlyAbsent, { sourceMapInjection: true }).issues;
    assert.ok(absentIssues.length > baselineIssues.length);
    assert.ok(absentIssues.some((issue) => issue.includes("lines absent without reason")));
  });

  it("serves only referenced local assets and rejects sibling and symlink escapes", () => {
    const root = mkdtempSync(join(tmpdir(), "breaklint-assets-"));
    const outside = mkdtempSync(join(tmpdir(), "breaklint-outside-"));
    try {
      mkdirSync(join(root, "images"));
      writeFileSync(join(root, "doc.html"), "fixture");
      writeFileSync(join(root, "images", "allowed.png"), "allowed");
      writeFileSync(join(root, "secret.txt"), "must not be served");
      writeFileSync(join(outside, "outside.txt"), "outside");
      symlinkSync(join(outside, "outside.txt"), join(root, "escape.txt"));

      const assets = discoverLocalAssets(
        '<!doctype html><img src="images/allowed.png"><a href="escape.txt">x</a>',
        join(root, "doc.html"),
      );
      assert.equal(assets.has("/images/allowed.png"), true);
      assert.equal(assets.has("/secret.txt"), false, "an unreferenced sibling became loopback-readable");
      assert.equal(assets.has("/escape.txt"), false, "a symlink escaped the real input root");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("discovers every local CSS syntax and resolves distribution-root membership semantically", () => {
    const root = mkdtempSync(join(tmpdir(), "breaklint-css-assets-"));
    const outside = mkdtempSync(join(tmpdir(), "breaklint-css-outside-"));
    try {
      mkdirSync(join(root, "css"));
      mkdirSync(join(root, "img"));
      writeFileSync(join(root, "doc.html"), "fixture");
      writeFileSync(join(root, "img", "safe.png"), "safe");
      writeFileSync(join(root, "img", "inline.png"), "inline");
      writeFileSync(join(root, "img", "attribute.png"), "attribute");
      writeFileSync(join(outside, "outside.png"), "outside");
      symlinkSync(join(outside, "outside.png"), join(root, "img", "escape.png"));
      writeFileSync(join(root, "css", "nested.css"), ".nested{background:url(../img/safe.png)}");
      writeFileSync(join(root, "css", "quoted.css"), ".quoted{color:black}");
      const css =
        `@import url(nested.css); @import 'quoted.css'; ` +
        `.safe{background:url(../img/safe.png)} ` +
        `.escape{background:url(../img/escape.png)} ` +
        `.outside{background:url(../../${basename(outside)}/outside.png)}`;
      writeFileSync(join(root, "css", "main.css"), css);
      const html =
        `<link href=css/main.css rel=stylesheet>` +
        `<style>.inline{background:url("img/inline.png")}</style>` +
        `<div style="background:url(img/attribute.png)"></div>`;

      const assets = discoverLocalAssets(html, join(root, "doc.html"));
      for (const route of [
        "/css/main.css", "/css/nested.css", "/css/quoted.css", "/img/safe.png",
        "/img/inline.png", "/img/attribute.png",
      ]) {
        assert.equal(assets.has(route), true, `${route} was a legitimate referenced asset but was denied`);
      }
      assert.equal(assets.has("/img/escape.png"), false);

      const model = buildSourceModel(html, join(root, "doc.html"), [{ origin: join(root, "css", "main.css"), text: css }]);
      const safe = model.uriRefs.find((ref) => ref.rawValue === "../img/safe.png");
      const lexicalEscape = model.uriRefs.find((ref) => ref.rawValue.includes(basename(outside)));
      const symlinkEscape = model.uriRefs.find((ref) => ref.rawValue === "../img/escape.png");
      assert.equal(safe?.insideDistributionRoot, true);
      assert.match(safe?.resolvedUri ?? "", /\/img\/safe\.png$/u);
      assert.equal(lexicalEscape?.insideDistributionRoot, false);
      assert.equal(symlinkEscape?.insideDistributionRoot, false);
      assert.ok(model.uriRefs.some((ref) => ref.rawValue === "img/inline.png"));
      assert.ok(model.uriRefs.some((ref) => ref.rawValue === "img/attribute.png"));
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("scans root-relative stylesheets through the same canonical resolver that serves them", () => {
    const root = mkdtempSync(join(tmpdir(), "breaklint-root-css-"));
    try {
      mkdirSync(join(root, "css"));
      writeFileSync(join(root, "doc.html"), "fixture");
      writeFileSync(join(root, "css", "book.css"), 'p[data-bl-sid]{color:red}');
      const html = '<link rel="stylesheet" href="/css/book.css"><p>x</p>';
      assert.equal(discoverLocalAssets(html, join(root, "doc.html")).has("/css/book.css"), true);
      const collision = detectCollision(collisionSources(html, join(root, "doc.html")));
      assert.equal(collision.collided, true);
      assert.ok(collision.occurrences.some((item) => item.origin.endsWith("/css/book.css")));
      const ref = buildSourceModel(html, join(root, "doc.html")).uriRefs.find((item) => item.rawValue === "/css/book.css");
      assert.equal(ref?.insideDistributionRoot, true);
      assert.match(ref?.resolvedUri ?? "", /\/css\/book\.css$/u);
      assert.equal(ref?.resolvedUri.startsWith("file:///css/"), false, "root-relative URI escaped the document root");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a reserved selector imported from an inline style", () => {
    const root = mkdtempSync(join(tmpdir(), "breaklint-inline-import-"));
    try {
      writeFileSync(join(root, "doc.html"), "fixture");
      writeFileSync(join(root, "theme.css"), "p[data-bl-sid]{color:red}");
      const html = '<style>@import "theme.css";</style><p>x</p>';
      const collision = detectCollision(collisionSources(html, join(root, "doc.html")));
      assert.equal(collision.collided, true, "an inline @import must enter the fail-closed collision scan");
      assert.ok(collision.occurrences.some((item) => item.origin.endsWith("/theme.css")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
