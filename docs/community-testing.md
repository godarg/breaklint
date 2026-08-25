# Community testing: break the checker, politely

The most useful report is not “it installed.” It is a page where a competent reader and breaklint
disagree. Every current threshold is uncalibrated, so a false positive or false negative is
evidence, not an embarrassment.

Anyone may participate. There is no application, selection, NDA, payment or promised reward. The
public intake is deliberately a GitHub issue so its state, discussion and resolution remain
inspectable. A useful report may be acknowledged publicly, but submitting one creates no right to
compensation, a product, support or a response.

## Choose a route

### Ten-minute smoke test

Use a public or disposable HTML document. This checks installation, acquisition, reporting and
whether the result is understandable:

```bash
mkdir breaklint-community-test && cd breaklint-community-test
npm init -y
npm i -D breaklint@0.2.0 puppeteer-core@^25.8.0 pagedjs@0.4.3 pdfjs-dist@6.2.108
npx breaklint --format json --out breaklint-report.json YOUR-PUBLIC-DOCUMENT.html
```

Exit 0 means the requested checks ran and no enabled rule reached the configured gate. Exit 1
means findings. Exit 2 is invalid input or configuration, exit 3 is infrastructure, and exit 4
means too little was measured. A non-zero exit is therefore not automatically a broken install.

### Real-page judgement

Use HTML that you own, may publish, or can reduce to a public minimal reproduction. Read the page
yourself before reading the JSON finding. Then ask:

- Did breaklint point to a real visual defect?
- Did it miss one?
- Is the reported target the thing you judged?
- Is the measurement and the word `uncalibrated` understandable?
- Did a transform, mask, clip path, font, viewport, overlap or page boundary create a surprising
  edge case?

Do not submit a confidential customer document, personal data, credentials, private URLs, local
absolute paths or a report you have not read. JSON findings may quote document text and paths.
Reduce private material to a synthetic or redistributable reproduction first.

### Security finding

Do **not** use the public community form. Follow [`SECURITY.md`](../SECURITY.md) and report it
privately. The community workflow never executes submitted HTML, commands, links, patches or
attachments.

## Send the result

Open the [community test form](https://github.com/godarg/breaklint/issues/new?template=community-test.yml).
GitHub supplies the package, instructions and structured form without a separate hand-off. Your
GitHub identity and everything you enter are public.

The form asks for:

1. the route and rule or area;
2. what you observed and what a person should see;
3. a public minimal reproduction or public source;
4. the exact environment and breaklint version;
5. confirmation that the submission is rights-cleared and contains no private material.

An automated, data-only intake check labels the issue as complete, needing information, or carrying
a sensitive-data warning. It never runs the submission. A scheduled public dashboard issue counts
the states and links to the reports; it does not rank people or average away disagreements.

The intake contract is deliberately strict. Each of the ten governed form sections must appear
exactly once. Duplicate, case-folded, Unicode-confusable, whitespace-normalized, nested or unknown
governed headings are rejected rather than merged or treated as “last value wins”. The
sensitive-input tripwire covers quoted and unquoted assignments, common provider credentials,
authorization headers, private-key markers, URL credentials, contextual JWT/Base64-like tokens and
opaque credential locators. Its public labels and diagnostics never echo the matched payload.
Your issue TITLE is screened by the same detector as the body. A hit in either field marks the whole
report `sensitive-warning`, and the public dashboard then shows `Sensitive content withheld` in place
of your title — the issue number and link stay visible, the title text does not. Markdown escaping is
not redaction, so a title is withheld rather than escaped.
This is a last-resort tripwire, not a redaction service: remove secrets and private material before
submitting, even if a particular string does not match the detector. Two limits are worth naming
explicitly, because both are easy to trip over:

- **Length.** A candidate shorter than 12 characters is not treated as a credential, so short
  secrets pass unnoticed.
- **Character set.** A candidate is only considered if it consists entirely of
  `A-Z a-z 0-9 + / _ = . : % -`. A secret containing ordinary punctuation — `&`, `!`, `~`, `#`,
  `{`, `}` and anything else outside that set — does **not** match, no matter how long it is. This
  is the larger of the two gaps.

Neither limit is an oversight; both keep the false-positive rate low enough that the tripwire stays
usable. They do mean the detector must not be relied on as a safety net.

## What this can and cannot establish

Community testing can reveal usability defects, false positives, false negatives, renderer
boundaries, missing documentation and adversarial cases. It does not by itself establish a blind
annotation protocol, two independent human annotators, an externally frozen holdout, an external
trust root, population performance or calibration. Public participants can read this repository
and therefore are not blind to its implementation or existing findings.

All fifteen rules remain `calibrated: false`. No community issue authorizes a threshold change,
release, publish, deployment or calibrated claim.
