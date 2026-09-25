# `artifact/local-uri`

| | |
|---|---|
| severity | warn |
| threshold | occurrences: 0 permitted |
| proof source | — |
| calibrated | **no** |

## What is checked

A `file:` URI or an absolute build-machine path remains in the artefact.

The rule reads each value as the browser's URL parser reads it — leading and trailing control
characters and spaces stripped, tabs and line breaks removed (so `fi&#10;le:///x` is a `file:` URI
and a leading U+00A0 is not stripped) — and decides by its shape. The snapshot stores the authored
scheme, so an absolute path arrives with no scheme at all, exactly like a relative one. For a
document rendered from a local file:

| authored value | reported | why |
|---|---|---|
| `file:///srv/x.txt`, `file://host/share/x.pdf` | yes | a `file:` URI, with or without a host |
| `/var/share/x.pdf`, `/opt/…` | yes | an absolute path |
| `/docs/guide.html`, `/docs/guide.html?rev=2#part` | yes | a root-relative path is an absolute path. In a PDF printed from a local file it resolves to `file:///docs/…`; the rule has no notion of a distribution root, so it is reported inside the project or not |
| `C:\out\x.pdf`, `C:/out/x.pdf` | yes | a Windows drive path. The URL parser reads `C:` as a one-letter scheme, so the drive letter is tested first |
| `\\server\share\x.pdf`, `\docs\x.html` | yes | a Windows share path, and a backslash root path, which URL parsing treats as `/docs/…` |
| `//cdn.example.org/x.css` | yes | a protocol-relative reference takes the scheme of the document: from a local file it resolves to `file://cdn.example.org/x.css`, exactly like the share path above |
| `notes/x.html`, `../x.html`, `./x.html`, `#part`, `?page=2` | no | a relative reference travels with the document |
| `~/notes.txt` | no | `~` is an ordinary path segment in a URL, not a home directory: this is a relative path |
| `https:`, `mailto:` and other schemes | no | not a local file |
| `data:` | no | it carries its own content |
| `blob:`, `about:` | no | a browsing session's object and a browser-internal document; neither names a file |

**The document base decides for a value without a scheme — for a fetch only from where it
stands.** HTML takes the first `<base>` with an `href`, wherever it sits, as the document base.
Only an absolute `http:` or `https:` base is a published origin; under it `/docs/guide.html`,
`\\server\share\x`, `//host/x` and `/var/share/x.pdf` are URLs on that host — a broken link there,
if wrong, not a local reference — and are not reported. Which references it governs depends on
when the browser resolves them:

- A **hyperlink** (`<a href>`, `<area href>`, SVG `<a>` with `href` or `xlink:href`) is resolved
  when it is followed or printed, against the final document base. A base governs it wherever the
  link stands, before the base or after it. Measured in plain Chromium 141 on a `file://` document:
  an HTML `<a>` and both SVG `<a>` forms before a late https base were printed into the PDF with the
  base host (`<area>` is not printed as a PDF link at all).
- Every other reference is treated as a **fetch**, resolved when its element is parsed: an image,
  a `srcset` candidate, a `<link>`ed style sheet, a `<style>` or `style=""` `url()` (an
  `@font-face` source included), `poster`, `<object data>`, SVG `<image>` and `<use>`. A base
  governs it only when the base comes first in the source. Measured in plain Chromium 141 on
  `file://` documents: an `<img>`, a `<link rel=stylesheet>`, a `<style>` `url()`, a `style=""`
  `url()` and an `@font-face` source placed before a late `<base href="https://…">` were all
  fetched from the local file tree and rendered into the PDF. Such a fetch is reported.

An absolute URL ignores the base: a `file:` URI and a drive path stay reported under any base. A
relative, root-relative, protocol-relative or `file:` base is not a published origin and leaves
resolution against the local file in place (the browser also refuses a `data:` base); the
`<base href>` itself is reported when it is a `file:` URI or an absolute path. A `<base>` inside SVG
content is not the HTML base element and changes nothing.

breaklint applies the same rule when it gathers a document's local resources: a style sheet,
image or other fetch that follows an http(s) base is not captured from the document's directory,
not served on the loopback origin and not scanned, because the browser requests it from the base
host. Measured on a patched Chromium 141 without evidence binding: under
`<base href="https://docs.example.org/manual/">` an `<img src="/logo.png">` was requested from
`https://docs.example.org/logo.png`, and with no network allowlist the request was blocked and the
run ended with exit 3. Resources behind such a base come from its host or not at all; a style sheet
loaded from an allow-listed host is not scanned by this rule.

breaklint itself serves the document from a loopback origin whose root is the document's
directory, so during its own run a root-relative value names a file under that directory. That is
a property of the measurement, not of the artefact, and the rule does not use it.

**Fingerprints.** A reported value without a scheme is keyed on its own text resolved against
`file:///` (`/docs/a.html` becomes `file:///docs/a.html`, `\\srv\share\x` becomes
`file://srv/share/x`), not on where it resolved in this checkout, so the same document gives the
same fingerprint in any directory. A value with a scheme is keyed on its resolved URL, as before.
The same resource referenced twice — `src` and a `srcset` candidate naming one file, or one link
repeated — gives two findings, one per reference to fix, with their own node keys and one shared
fingerprint that groups them across runs. Neither claims a unique identity
(`stableIdentity.status` is never `unique`).

## Why

**Downgraded from `error`.** An earlier version claimed proof class A, which demands a *geometric* invariant between two measured quantities; a URI scheme is not one, and a local reference can be intentional. Proof class C — a resolution invariant — describes what this rule would need, and no spike supports it. A proof class that exists only on paper is not a proof.

## Limits and known false alarms

Reads `uriRefs`, which holds every URI-bearing attribute and every CSS `url()` from DOM and CSSOM **whether or not the browser fetched it**. Reading the loaded-resource list instead would miss a `srcset` candidate the browser never chose and a rule that never applied — precisely the references that survive to bite someone later.

`data:` URIs and relative paths are not local URIs.

Known misses and false alarms, stated rather than guessed around:

- Under a `file:` base (`<base href="file:///srv/site/">`) a relative reference resolves into
  that local directory. The rule reports the base element, not each relative reference it
  governs.
- A drive-relative Windows value without a slash (`C:x.pdf`) is read as a URI with scheme `c` and
  not reported.
- A `<base>` inserted by a script is invisible to the source the rule reads. References it would
  govern are judged as if there were no base, so a root-relative value under a script-inserted
  https base is reported although the browser resolves it on that host: a conservative false
  alarm, never a missed local reference.

A root-relative path in a document that is meant to be served from a web root is reported too; the
rule cannot tell a deployment route from a build-machine path. A deliberate local reference can be
permitted with `maxOccurrences`.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

## Remediation

<!-- begin generated remediation: artifact/local-uri -->
A resource points to a local filesystem URI ('file:') or an absolute machine path. The rule has no notion of a distribution root: EVERY absolute path is reported, inside the project or not, a root-relative '/docs/...', a protocol-relative '//host/...' and a Windows drive or share path included, because unless an http(s) <base href> governs it, an absolute path resolves against the file system of the machine that rendered the document. Replace it with a relative URL, an absolute URL on the host the document is published from, or embed the asset directly (e.g. a data URI for a small image).
<!-- end generated remediation: artifact/local-uri -->

## Examples

### Firing case (trigger)

```html
<p>
  <a href="file:///example/project/notes.txt">Local document notes</a>
</p>
```

### Non-firing case (remedied)

```html
<p>
  <a href="notes.txt">Relative document notes</a>
</p>
```

