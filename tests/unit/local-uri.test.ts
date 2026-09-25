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
 * stop honouring an http(s) <base href> in the collector and the base cases go red.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

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
function check(html: string, path: string): { findings: Finding[]; refs: UriRef[]; candidates: number } {
  const model = buildSourceModel(html, path);
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
    ]);
    // Ten targets, ten distinct fingerprints: no two shapes collapse into one finding.
    assert.equal(new Set(findings.map((finding) => finding.fingerprint)).size, 10);
  });

  it("under an https <base href> a scheme-less path is a URL on that host; absolute URLs stay reported", () => {
    const path = fixture("local-uri-base-href.html");
    const { findings, refs, candidates } = check(readFileSync(path, "utf8"), path);
    assert.equal(candidates, 7);
    assert.deepEqual(reported(findings), [
      'href="file:///srv/build/notes.txt"',
      'href="C:\\build\\out\\report.pdf"',
    ]);
    // The <base> sits after the <style>; it still governs the CSS url() before it.
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
    { html: '<a href="//cdn.example.org/a.css">x</a>', expected: [], complication: "protocol-relative: it names a host" },
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
  const cases: { html: string; expected: string[]; complication: string }[] = [
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
      complication: "the base governs references that precede it in the source",
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
