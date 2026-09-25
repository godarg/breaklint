# `artifact/local-uri`

| | |
|---|---|
| severity | warn |
| threshold | occurrences: 0 permitted |
| proof source | — |
| calibrated | **no** |

## What is checked

A `file:` URI or an absolute build-machine path remains in the artefact.

The rule reads each value as authored and decides by its shape; the snapshot stores the authored
scheme, so an absolute path arrives with no scheme at all, exactly like a relative one. For a
document rendered from a local file:

| authored value | reported | why |
|---|---|---|
| `file:///srv/x.txt`, `file://host/share/x.pdf` | yes | a `file:` URI, with or without a host |
| `/var/share/x.pdf`, `/opt/…` | yes | an absolute path |
| `/docs/guide.html`, `/docs/guide.html?rev=2#part` | yes | a root-relative path is an absolute path. In a PDF printed from a local file it resolves to `file:///docs/…`; the rule has no notion of a distribution root, so it is reported inside the project or not |
| `C:\out\x.pdf`, `C:/out/x.pdf` | yes | a Windows drive path. The URL parser reads `C:` as a one-letter scheme, so the drive letter is tested first |
| `\\server\share\x.pdf`, `\docs\x.html` | yes | a Windows share path, and a backslash root path, which URL parsing treats as `/docs/…` |
| `notes/x.html`, `../x.html`, `./x.html`, `#part`, `?page=2` | no | a relative reference travels with the document |
| `~/notes.txt` | no | `~` is an ordinary path segment in a URL, not a home directory: this is a relative path |
| `//cdn.example.org/x.css` | no | a protocol-relative reference names a host, not a path on this machine (see the limits below) |
| `https:`, `mailto:` and other schemes | no | not a local file |
| `data:` | no | it carries its own content |
| `blob:`, `about:` | no | a browsing session's object and a browser-internal document; neither names a file |

**The document base decides for a value without a scheme.** HTML takes the first `<base>` with an
`href`, wherever it sits in the document, and resolves every scheme-less reference against it,
including those before it. Under an absolute `http:` or `https:` base, the browser, and every link a
PDF printed from it carries, resolves `/docs/guide.html` to a URL on that host, so the rule does not
report it — nor `/var/share/x.pdf`, which is then a URL on that host as well: a broken link there,
if it is wrong, not a local reference. An absolute URL ignores the base: a `file:` URI and a drive
path stay reported under any base. A relative, root-relative or `file:` base is not a published
origin: it leaves resolution against the local file in place, and the `<base href>` itself is
reported when it is a `file:` URI or an absolute path. A `<base>` inside SVG content is not the HTML
base element and changes nothing.

The rendering browser honours the same base. Measured on a patched Chromium 141 without evidence
binding: under `<base href="https://docs.example.org/manual/">` an `<img src="/logo.png">` was
requested from `https://docs.example.org/logo.png`, not from the document's directory, and with no
network allowlist the request was blocked and the run ended with exit 3. Resources behind such a
base come from its host or not at all.

breaklint itself serves the document from a loopback origin whose root is the document's
directory, so during its own run a root-relative value names a file under that directory. That is
a property of the measurement, not of the artefact, and the rule does not use it.

## Why

**Downgraded from `error`.** An earlier version claimed proof class A, which demands a *geometric* invariant between two measured quantities; a URI scheme is not one, and a local reference can be intentional. Proof class C — a resolution invariant — describes what this rule would need, and no spike supports it. A proof class that exists only on paper is not a proof.

## Limits and known false alarms

Reads `uriRefs`, which holds every URI-bearing attribute and every CSS `url()` from DOM and CSSOM **whether or not the browser fetched it**. Reading the loaded-resource list instead would miss a `srcset` candidate the browser never chose and a rule that never applied — precisely the references that survive to bite someone later.

`data:` URIs and relative paths are not local URIs.

Known misses, stated rather than guessed around:

- A protocol-relative `//host/x` is not reported, although a PDF printed from a local file
  resolves it to `file://host/x`. It names a host, and the same value is the ordinary way to reach
  that host once the document is served over http(s).
- Under a `file:` base (`<base href="file:///srv/site/">`) a relative reference resolves into
  that local directory. The rule reports the base element, not each relative reference it
  governs.
- A drive-relative Windows value without a slash (`C:x.pdf`) is read as a URI with scheme `c` and
  not reported.

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
A resource points to a local filesystem URI ('file:') or an absolute machine path. The rule has no notion of a distribution root: EVERY absolute path is reported, inside the project or not, a root-relative '/docs/...' and a Windows drive or share path included, because without an http(s) <base href> an absolute path resolves against the file system of the machine that rendered the document. Replace it with a relative URL, an absolute URL on the host the document is published from, or embed the asset directly (e.g. a data URI for a small image).
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

