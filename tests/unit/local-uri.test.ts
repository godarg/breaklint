/**
 * artifact/local-uri over what the collector actually stores.
 *
 * Until 0.7.0 the rule skipped every reference whose AUTHORED scheme was empty before it tested
 * for an absolute path, and the collector stores scheme "" for every value without one. So
 * `/var/share/…`, `/opt/…` and a root-relative `/docs/…` were never reported, although the rule's
 * own page says EVERY absolute path is. The trigger fixture of the corpus is a file: URI, which is
 * why no test saw it: every hand-written absolute-path snapshot carried a scheme the collector
 * never produces for one. These tests therefore start from HTML and go through the real collector
 * (`buildSourceModel`), the same uriRefs mapping `assembleSnapshot` applies, the real rule and the
 * engine, and read the consumer-visible `Finding.message`.
 *
 * Red condition: restore the `scheme === ""` skip in the rule, and the absolute-path, root-relative,
 * UNC and CSS cases go red; drop the drive-letter test and the Windows drive cases go red; derive
 * the scheme from the resolved URL again in the collector and the file: URI with a host goes red;
 * stop honouring an http(s) <base href> in the collector and the base cases go red; apply the base
 * to fetches before it and the late-base cases go red; key on `resolvedUri` again and the
 * two-checkout fingerprint case goes red; go back to `trim()` and the URL-whitespace cases go red;
 * move an element between the whole-document and the tree-order group and its per-element case
 * goes red.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { collisionSources, discoverLocalAssets } from "../../src/acquire/render-run.ts";
import { runDocument } from "../../src/core/engine.ts";
import type { Finding, Snapshot, UriRef } from "../../src/core/types.ts";
import { buildSourceModel } from "../../src/measure/snapshot.ts";
import { VALIDATION_RULES_BY_ID } from "../../src/rules/index.ts";
import { loadCorpus } from "../fixtures/corpus.ts";

const RULE_ID = "artifact/local-uri";
const rule = VALIDATION_RULES_BY_ID.get(RULE_ID)!;
const baseSnapshot = loadCorpus().find((entry) => entry.name === "local-uri-trigger")!.snapshot;
const fixture = (name: string): string => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

/** HTML -> real collector -> the uriRefs mapping of assembleSnapshot -> engine report. */
function check(
  html: string,
  path: string,
  additionalCss: readonly { origin: string; text: string }[] = [],
): { findings: Finding[]; refs: UriRef[]; candidates: number } {
  const model = buildSourceModel(html, path, additionalCss);
  // src/measure/snapshot.ts assembleSnapshot: nodeKey `uri:<index>`; nothing here is fetched.
  const refs: UriRef[] = model.uriRefs.map((ref, index) => ({ ...ref, nodeKey: `uri:${index}`, requested: false }));
  const snapshot: Snapshot = { ...structuredClone(baseSnapshot), uriRefs: refs };
  const { report } = runDocument(
    { path, snapshot, infrastructure: [] },
    { failOn: "never", activeRules: [rule], optionsByRule: {}, coverageFloors: {} },
  );
  return { findings: report.findings, refs, candidates: report.coverage[RULE_ID]?.candidates ?? -1 };
}

/** The `attribute="value"` pair every local-uri message carries (the corpus README matches on it). */
function reported(findings: readonly Finding[]): string[] {
  for (const finding of findings) {
    assert.equal(finding.ruleId, RULE_ID);
    assert.equal(finding.target.keyType, "resource");
  }
  return findings.map((finding) => {
    const pair = /^occurrences: \d+ \(permitted: 0\)\. ([a-z:-]+="[^"]*") resolves only on /u.exec(finding.message);
    assert.ok(pair, `message lost its attribute="value" pair: ${finding.message}`);
    return pair[1]!;
  });
}

const scratch = mkdtempSync(join(tmpdir(), "breaklint-local-uri-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
const scratchDoc = join(scratch, "doc.html");
writeFileSync(scratchDoc, "fixture");

describe("artifact/local-uri through the real collector", () => {
  it("reports every file: URI and absolute path of a document rendered from a local file, and nothing else", () => {
    const path = fixture("local-uri-shapes.html");
    const { findings, candidates } = check(readFileSync(path, "utf8"), path);
    assert.equal(candidates, 20, "every URI-bearing value is a candidate");
    assert.deepEqual(reported(findings), [
      'style-sheet="/opt/build/assets/unused-texture.png"',
      'href="file:///srv/build/notes.txt"',
      'href="file://build-host/share/spec.pdf"',
      'href="/var/share/handbook.pdf"',
      'href="/docs/migration/guide.html"',
      'href="/docs/guide.html?rev=2#part"',
      'href="C:\\build\\out\\report.pdf"',
      'href="C:/build/out/report.pdf"',
      'href="\\\\fileserver\\share\\plan.pdf"',
      'href="\\docs\\winroot.html"',
      'href="//cdn.example.org/lib/guide.html"',
    ]);
    // Eleven targets, eleven distinct fingerprints: no two shapes collapse into one finding.
    assert.equal(new Set(findings.map((finding) => finding.fingerprint)).size, 11);
  });

  it("under an https <base href> a scheme-less path is a URL on that host; absolute URLs stay reported", () => {
    const path = fixture("local-uri-base-href.html");
    const { findings, refs, candidates } = check(readFileSync(path, "utf8"), path);
    assert.equal(candidates, 7);
    assert.deepEqual(reported(findings), [
      'href="file:///srv/build/notes.txt"',
      'href="C:\\build\\out\\report.pdf"',
    ]);
    // The <style> follows the base, so its url() resolves on the base host too.
    const css = refs.find((ref) => ref.attribute === "style-sheet")!;
    assert.equal(css.resolvedUri, "https://docs.example.org/assets/unused-texture.png");
    assert.equal(refs.find((ref) => ref.rawValue === "notes/appendix.html")!.resolvedUri, "https://docs.example.org/manual/notes/appendix.html");
  });

  it("keeps the authored file: scheme when the resolver cannot turn the URL into a path", () => {
    // fileURLToPath refuses a file: URL with a host on POSIX. The collector used to take the
    // scheme from the resolved URL, so this value arrived with scheme "" and was never reported.
    const { findings, refs } = check('<a href="file://build-host/share/spec.pdf">x</a>', scratchDoc);
    assert.equal(refs[0]!.scheme, "file");
    assert.deepEqual(reported(findings), ['href="file://build-host/share/spec.pdf"']);
  });
});

describe("artifact/local-uri, one authored shape at a time", () => {
  const shapes: { html: string; expected: string[]; complication: string }[] = [
    { html: '<a href="file:///srv/x.txt">x</a>', expected: ['href="file:///srv/x.txt"'], complication: "file: URI" },
    { html: '<a href="FILE:///SRV/X.TXT">x</a>', expected: ['href="FILE:///SRV/X.TXT"'], complication: "a scheme is case-insensitive" },
    { html: '<a href="/var/share/a.pdf">x</a>', expected: ['href="/var/share/a.pdf"'], complication: "absolute POSIX path, scheme \"\" like a relative path" },
    { html: '<a href="/docs/a.html">x</a>', expected: ['href="/docs/a.html"'], complication: "root-relative path inside the project: there is no distribution root" },
    { html: '<a href="/">x</a>', expected: ['href="/"'], complication: "the root itself" },
    { html: '<img alt="" srcset="/img/a.png 1x, img/b.png 2x">', expected: ['srcset="/img/a.png"'], complication: "only the absolute srcset candidate, never the relative one" },
    { html: '<div style="background:url(/img/bg.png)">x</div>', expected: ['style="/img/bg.png"'], complication: "CSS url() in a style attribute" },
    { html: '<style>@import "/css/print.css";</style>', expected: ['style-sheet="/css/print.css"'], complication: "a quoted @import without url()" },
    { html: '<style>@import"/css/print.css";</style>', expected: ['style-sheet="/css/print.css"'], complication: "an @import with no space before its string" },
    { html: "<style>@import'/css/print.css';</style>", expected: ['style-sheet="/css/print.css"'], complication: "an @import with no space before a single-quoted string" },
    { html: '<style>@import url("/css/print.css");</style>', expected: ['style-sheet="/css/print.css"'], complication: "an @import url() with a quoted argument" },
    { html: '<a href="C:\\out\\a.pdf">x</a>', expected: ['href="C:\\out\\a.pdf"'], complication: "the URL parser reads C: as scheme \"c\"" },
    { html: '<a href="d:/out/a.pdf">x</a>', expected: ['href="d:/out/a.pdf"'], complication: "lower-case drive letter with a slash" },
    { html: '<a href="\\\\server\\share\\a.pdf">x</a>', expected: ['href="\\\\server\\share\\a.pdf"'], complication: "UNC share path, two leading backslashes" },
    { html: '<a href="/\\server/a.pdf">x</a>', expected: ['href="/\\server/a.pdf"'], complication: "a backslash in the leading pair is the Windows form, not //host" },
    { html: '<a href="\\docs\\a.html">x</a>', expected: ['href="\\docs\\a.html"'], complication: "one leading backslash, which URL parsing treats as /docs/…" },
    { html: '<a href="  /var/share/a.pdf  ">x</a>', expected: ['href="/var/share/a.pdf"'], complication: "surrounding whitespace, which the browser strips too" },
    { html: '<a href="docs/a.html">x</a>', expected: [], complication: "relative path" },
    { html: '<a href="./a.html">x</a>', expected: [], complication: "dot-relative path" },
    { html: '<a href="../a.html">x</a>', expected: [], complication: "parent-relative path" },
    { html: '<a href="#top">x</a>', expected: [], complication: "fragment only" },
    { html: '<a href="?page=2">x</a>', expected: [], complication: "query only" },
    { html: '<a href="~/notes.txt">x</a>', expected: [], complication: "~ is a path segment in a URL, not a home directory" },
    { html: '<a href="//cdn.example.org/a.css">x</a>', expected: ['href="//cdn.example.org/a.css"'], complication: "protocol-relative: from a local file it resolves to file://host/…" },
    { html: '<a href="fi\nle:///srv/x.txt">x</a>', expected: ['href="file:///srv/x.txt"'], complication: "a newline inside the scheme, which the URL parser removes" },
    { html: '<a href="fi\tle:///srv/x.txt">x</a>', expected: ['href="file:///srv/x.txt"'], complication: "a tab inside the scheme, which the URL parser removes" },
    { html: '<a href="&#1;/var/share/a.pdf">x</a>', expected: ['href="/var/share/a.pdf"'], complication: "a leading C0 control, which the URL parser strips and trim() keeps" },
    { html: '<a href="\n/var/share/a.pdf">x</a>', expected: ['href="/var/share/a.pdf"'], complication: "a leading newline" },
    { html: '<a href="/var/sh\tare/a.pdf">x</a>', expected: ['href="/var/share/a.pdf"'], complication: "a tab inside the path" },
    { html: '<a href="&#xA0;/var/share/a.pdf">x</a>', expected: [], complication: "a leading U+00A0, which the URL parser keeps: a relative path" },
    { html: '<a href="https://example.org/a">x</a>', expected: [], complication: "https URL" },
    { html: '<a href="mailto:a@example.org">x</a>', expected: [], complication: "mailto: URL" },
    { html: '<img alt="" src="data:image/png;base64,iVBORw0K">', expected: [], complication: "data: carries its own content" },
    { html: '<a href="blob:https://example.org/5d1c">x</a>', expected: [], complication: "blob: names a session object, no file" },
    { html: '<a href="about:blank">x</a>', expected: [], complication: "about: names a browser-internal document" },
  ];
  for (const shape of shapes) {
    it(`${shape.expected.length ? "reports" : "does not report"} ${shape.complication}`, () => {
      const { findings, candidates } = check(shape.html, scratchDoc);
      assert.ok(candidates >= 1, "the shape must reach the rule as a candidate");
      assert.deepEqual(reported(findings), shape.expected);
    });
  }
});

describe("artifact/local-uri and the document base", () => {
  const LATE = '<base href="https://docs.example.org/m/">';
  const cases: { html: string; expected: string[]; complication: string }[] = [
    // Before a late base, per element, as plain Chromium 141 resolved each (the whole-document
    // group went to the base host; every other one was fetched from the local tree).
    { html: `<object data="/x.svg"></object>${LATE}`, expected: [], complication: "<object data> before a late base resolves on the base host" },
    { html: `<embed src="/x.svg">${LATE}`, expected: [], complication: "<embed src> before a late base resolves on the base host" },
    { html: `<video src="/x.mp4"></video>${LATE}`, expected: [], complication: "<video src> before a late base resolves on the base host" },
    { html: `<audio src="/x.mp3"></audio>${LATE}`, expected: [], complication: "<audio src> before a late base resolves on the base host" },
    { html: `<video><source src="/x.mp4"></video>${LATE}`, expected: [], complication: "<video><source src> before a late base resolves on the base host" },
    { html: `<audio><source src="/x.mp3"></audio>${LATE}`, expected: [], complication: "<audio><source src> before a late base resolves on the base host" },
    { html: `<video src="/x.mp4"><track kind="captions" src="/x.vtt"></video>${LATE}`, expected: [], complication: "<track src> before a late base resolves on the base host" },
    { html: `<svg><image href="/x.png"/></svg>${LATE}`, expected: [], complication: "SVG <image href> before a late base resolves on the base host" },
    { html: `<svg xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="/x.png"/></svg>${LATE}`, expected: [], complication: "SVG <image xlink:href> before a late base resolves on the base host" },
    { html: `<link rel="icon" href="/x.png">${LATE}`, expected: [], complication: "<link rel=icon> before a late base resolves on the base host" },
    { html: `<link rel="shortcut icon" href="/x.png">${LATE}`, expected: [], complication: "rel is a token list: shortcut icon is an icon" },
    { html: `<link rel="stylesheet" href="/x.css">${LATE}`, expected: ['href="/x.css"'], complication: "<link rel=stylesheet> before a late base is fetched locally: a link element is no hyperlink" },
    { html: `<link rel="preload" as="image" href="/x.png">${LATE}`, expected: ['href="/x.png"'], complication: "<link rel=preload> before a late base is fetched locally" },
    { html: `<img alt="" srcset="/x.png 1x">${LATE}`, expected: ['srcset="/x.png"'], complication: "srcset before a late base is fetched locally" },
    { html: `<picture><source srcset="/x.png"><img alt="" src="/y.png"></picture>${LATE}`, expected: ['srcset="/x.png"', 'src="/y.png"'], complication: "<picture><source> before a late base is fetched locally" },
    { html: `<video poster="/x.png"></video>${LATE}`, expected: ['poster="/x.png"'], complication: "poster before a late base is fetched locally, unlike the video's src" },
    { html: `<iframe src="/x.html"></iframe>${LATE}`, expected: ['src="/x.html"'], complication: "<iframe src> before a late base is fetched locally" },
    { html: `<script src="/x.js"></script>${LATE}`, expected: ['src="/x.js"'], complication: "<script src> before a late base is fetched locally" },
    { html: `<svg><use href="/x.svg#r"/></svg>${LATE}`, expected: ['href="/x.svg#r"'], complication: "SVG <use> before a late base is fetched locally, unlike SVG <image>" },
    { html: `<input type="image" alt="" src="/x.png">${LATE}`, expected: ['src="/x.png"'], complication: "<input type=image> is fetched locally AND from the base: its local fetch is reported" },
    {
      html: `${LATE}<img alt="" src="/1.png"><img alt="" src="/2.png"><img alt="" src="/3.png"><img alt="" src="/4.png">` +
        `<div style="background:url(/5.png)"></div><style>.x{background:url(/6.png)}</style><img alt="" srcset="/7.png 2x"><a href="/8.html">x</a>`,
      expected: [],
      complication: "an early base governs every later reference, not only the first few",
    },
    {
      html: '<base href="https://docs.example.org/"><a href="/docs/a.html">x</a><a href="\\\\server\\share\\a.pdf">y</a>',
      expected: [],
      complication: "an https base turns root-relative and UNC-shaped values into URLs on that host",
    },
    {
      html: '<base href="http://docs.example.org/m/"><div style="background:url(/img/bg.png)">x</div>',
      expected: [],
      complication: "an http base governs a CSS url() in a style attribute as well",
    },
    {
      html: '<a href="/docs/a.html">x</a><base href="https://docs.example.org/">',
      expected: [],
      complication: "a hyperlink before the base is printed against the final base",
    },
    {
      html: '<svg><a href="/docs/a.html"><text>x</text></a></svg><map name="m"><area href="/docs/b.html" alt="b"></map><base href="https://docs.example.org/">',
      expected: [],
      complication: "SVG <a> and <area> are hyperlinks too",
    },
    {
      html: '<img alt="" src="/img/a.png"><base href="https://docs.example.org/">',
      expected: ['src="/img/a.png"'],
      complication: "an image before a late base is fetched from the local tree",
    },
    {
      html: '<style>.x{background:url(/img/a.png)}</style><base href="https://docs.example.org/">',
      expected: ['style-sheet="/img/a.png"'],
      complication: "a <style> url() before a late base is fetched from the local tree",
    },
    {
      html: '<div style="background:url(/img/a.png)">x</div><base href="https://docs.example.org/">',
      expected: ['style="/img/a.png"'],
      complication: "a style attribute before a late base is fetched from the local tree",
    },
    {
      html: '<p>x</p><div><base href="https://docs.example.org/"></div><img alt="" src="/img/a.png"><a href="//cdn.example.org/a">y</a>',
      expected: [],
      complication: "a base in the body governs what follows it, protocol-relative included",
    },
    {
      html: '<base href=" ht\ntps://docs.example.org/ "><a href="/docs/a.html">x</a>',
      expected: [],
      complication: "the base href is URL text too: spaces stripped, a newline removed",
    },
    {
      html: '<base href="data:text/html,x"><a href="/docs/a.html">x</a>',
      expected: ['href="/docs/a.html"'],
      complication: "a data: base is refused by the browser and applied by nobody",
    },
    {
      html: '<base target="_blank"><base href="https://docs.example.org/"><a href="/docs/a.html">x</a>',
      expected: [],
      complication: "the first <base> WITH an href is the document base",
    },
    {
      html: '<base href="https://docs.example.org/"><a href="file:///srv/x.txt">x</a><a href="C:\\out\\a.pdf">y</a>',
      expected: ['href="file:///srv/x.txt"', 'href="C:\\out\\a.pdf"'],
      complication: "an absolute URL ignores the base, so a file: URI and a drive path stay reported",
    },
    {
      html: '<base href="file:///srv/site/"><a href="/docs/a.html">x</a>',
      expected: ['href="file:///srv/site/"', 'href="/docs/a.html"'],
      complication: "a file: base is not a published origin: it is reported, and so is the path",
    },
    {
      html: '<base href="/site/"><a href="/docs/a.html">x</a>',
      expected: ['href="/site/"', 'href="/docs/a.html"'],
      complication: "a root-relative base is itself an absolute path",
    },
    {
      html: '<base href="file:///srv/a/"><base href="https://docs.example.org/"><a href="/docs/a.html">x</a>',
      expected: ['href="file:///srv/a/"', 'href="/docs/a.html"'],
      complication: "only the first base counts; a later https base does not rescue the path",
    },
    {
      html: '<svg><base href="https://docs.example.org/"></base></svg><a href="/docs/a.html">x</a>',
      expected: ['href="/docs/a.html"'],
      complication: "a <base> in SVG content is not the HTML base element",
    },
  ];
  for (const item of cases) {
    it(item.complication, () => {
      assert.deepEqual(reported(check(item.html, scratchDoc).findings), item.expected);
    });
  }
});

describe("artifact/local-uri, linked style sheets, fingerprints and repeated resources", () => {
  const fingerprintsAt = (html: string): string[] => {
    const root = mkdtempSync(join(tmpdir(), "breaklint-local-uri-checkout-"));
    try {
      const doc = join(root, "deep", "checkout", "doc.html");
      mkdirSync(join(root, "deep", "checkout"), { recursive: true });
      writeFileSync(doc, html);
      return check(html, doc).findings.map((finding) => finding.fingerprint);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  it("gives the same fingerprints for the same document in two checkout directories", () => {
    const html = '<a href="/docs/a.html">a</a><a href="\\\\srv\\share\\b.pdf">b</a><a href="//host/c">c</a>' +
      '<a href="\\docs\\d.html">d</a><a href="C:\\out\\e.pdf">e</a><a href="file:///srv/f.txt">f</a>';
    const first = fingerprintsAt(html);
    const second = fingerprintsAt(html);
    assert.equal(first.length, 6);
    assert.deepEqual(first, second, "a fingerprint moved with the checkout directory");
  });

  it("keys a scheme-less value on its URL-normalised text, not on the text as written", () => {
    // `\\docs\\a.html` and `/docs/./a.html` are the same URL as `/docs/a.html` (URL parsing
    // treats a backslash as a slash and removes dot segments): one resource, one fingerprint.
    const one = check('<a href="/docs/a.html">a</a>', scratchDoc).findings;
    const two = check('<a href="\\docs\\a.html">a</a><a href="/docs/./a.html">b</a>', scratchDoc).findings;
    assert.equal(one.length, 1);
    assert.equal(two.length, 2);
    assert.deepEqual(two.map((finding) => finding.fingerprint), [one[0]!.fingerprint, one[0]!.fingerprint]);
  });

  it("keeps an internal space: URL preprocessing strips only the ends", () => {
    const { findings } = check('<a href=" /var/my share/a b.pdf ">x</a>', scratchDoc);
    assert.deepEqual(reported(findings), ['href="/var/my share/a b.pdf"']);
  });

  it("reports the same resource in src and srcset twice, under one fingerprint", () => {
    // Two references to fix, one resource: two findings with their own node keys, and the one
    // fingerprint that groups them across runs. stableIdentity stays "unavailable", never unique.
    const { findings } = check('<img alt="" src="/img/a.png" srcset="/img/a.png 2x">', scratchDoc);
    assert.deepEqual(reported(findings), ['src="/img/a.png"', 'srcset="/img/a.png"']);
    assert.equal(new Set(findings.map((finding) => finding.fingerprint)).size, 1);
    assert.deepEqual(findings.map((finding) => finding.target.nodeKey), ["uri:0", "uri:1"]);
    assert.ok(findings.every((finding) => finding.stableIdentity.status !== "unique"));
  });

  /** HTML with a linked sheet, through the real discovery the render path uses (render-run.ts). */
  const linked = (html: string) => {
    const root = mkdtempSync(join(tmpdir(), "breaklint-local-uri-css-"));
    try {
      mkdirSync(join(root, "css"));
      const doc = join(root, "doc.html");
      writeFileSync(doc, html);
      writeFileSync(join(root, "css", "print.css"), ".x{background:url(/img/root.png)} .y{background:url(../img/rel.png)}");
      const assets = discoverLocalAssets(html, doc);
      const additionalCss = collisionSources(html, assets).slice(1).map((source) => ({ origin: source.origin, text: source.text }));
      return { captured: assets.has("/css/print.css"), findings: check(html, doc, additionalCss).findings };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  it("reports a root-relative url() inside a linked local style sheet, and not its relative one", () => {
    const { captured, findings } = linked('<link rel="stylesheet" href="css/print.css"><p>x</p>');
    assert.equal(captured, true);
    assert.deepEqual(reported(findings), ['style-sheet="/img/root.png"']);
  });

  it("still captures a linked sheet under an https base: the documented over-capture (G-88 open)", () => {
    // Discovery does not read <base>. Capturing and serving a sheet the browser takes from the base
    // host is harmless; NOT serving what the paginator then requests from the loopback origin is
    // not (Paged.js 0.4.3 resolves <style> @import against the document URL). The local copy is
    // scanned, so its root-relative url() is reported: a conservative false alarm, documented in
    // docs/rules/artifact-local-uri.md. Change this expectation only together with G-88.
    const { captured, findings } = linked('<base href="https://docs.example.org/"><link rel="stylesheet" href="css/print.css"><p>x</p>');
    assert.equal(captured, true);
    assert.deepEqual(reported(findings), ['style-sheet="/img/root.png"']);
  });

  it("captures a <style> @import under an early https base: breaklint's paginator requests it locally", () => {
    // Paged.js 0.4.3 rewrites a head <style>'s @import against the document URL and ignores <base>,
    // so it asks the loopback origin for this file (tests/live/local-uri.test.ts observes it).
    const root = mkdtempSync(join(tmpdir(), "breaklint-local-uri-import-"));
    try {
      const doc = join(root, "doc.html");
      const html = '<base href="https://docs.example.org/manual/"><style>@import "/imp.css";</style><p>x</p>';
      writeFileSync(doc, html);
      writeFileSync(join(root, "imp.css"), ".big{height:200px}");
      assert.equal(discoverLocalAssets(html, doc).has("/imp.css"), true, "the paginator's @import would be answered with 403");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("discovers a no-space @import in <style> and inside a captured sheet", () => {
    const root = mkdtempSync(join(tmpdir(), "breaklint-local-uri-nospace-"));
    try {
      const doc = join(root, "doc.html");
      const html = '<style>@import"/a.css";</style><p>x</p>';
      writeFileSync(doc, html);
      writeFileSync(join(root, "a.css"), "@import'b.css';.a{background:url(/img/in-a.png)}");
      writeFileSync(join(root, "b.css"), ".b{background:url(/img/in-b.png)}");
      const assets = discoverLocalAssets(html, doc);
      assert.deepEqual([...assets.keys()].sort(), ["/a.css", "/b.css"]);
      const additionalCss = collisionSources(html, assets).slice(1).map((source) => ({ origin: source.origin, text: source.text }));
      assert.deepEqual(reported(check(html, doc, additionalCss).findings),
        ['style-sheet="/a.css"', 'style-sheet="/img/in-a.png"', 'style-sheet="/img/in-b.png"']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("still captures and scans a linked sheet that precedes a late base", () => {
    const { captured, findings } = linked('<link rel="stylesheet" href="css/print.css"><base href="https://docs.example.org/"><p>x</p>');
    assert.equal(captured, true);
    assert.deepEqual(reported(findings), ['style-sheet="/img/root.png"']);
  });

  it("reports what the late-base fixture fetches locally, and neither of its links", () => {
    const path = fixture("local-uri-late-base.html");
    const { findings } = check(readFileSync(path, "utf8"), path);
    assert.deepEqual(reported(findings), ['style-sheet="/changed.svg"', 'src="/baseline.svg"']);
  });
});
