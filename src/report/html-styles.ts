import { reportTokenDeclarations } from "./html-tokens.ts";

/**
 * Report Surface v2 layout. Every custom property is generated from the token table in
 * html-tokens.ts, and every colour lives there: components below consume token names, so light,
 * dark and print cannot drift through local exceptions. A stylesheet lint in
 * tests/e2e/report-surface.test.ts holds both properties.
 */
export const REPORT_HTML_STYLES = String.raw`
  :root {
    color-scheme: light dark;
    ${reportTokenDeclarations("light")}
  }
  @media (prefers-color-scheme: dark) {
    :root {
      ${reportTokenDeclarations("dark", "\n      ")}
    }
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; background: var(--bl-color-bg-primary); }
  body {
    margin: 0;
    color: var(--bl-color-fg-primary);
    background: var(--bl-color-bg-primary);
    font: 400 var(--bl-font-size-base)/var(--bl-line-body) var(--bl-font-body);
    overflow-wrap: anywhere;
  }
  /* Banner, contents, main and contentinfo are siblings in one column, so each is a landmark. */
  .report-shell { width: min(100%, var(--bl-report-width)); margin-inline: auto; padding: var(--bl-space-5); }
  .skip-link { position: absolute; inset-block-start: var(--bl-space-3); inset-inline-start: var(--bl-space-3); z-index: 1; padding: var(--bl-space-2) var(--bl-space-3); border: var(--bl-border-thin) solid var(--bl-color-fg-primary); background: var(--bl-color-paper); color: var(--bl-color-fg-primary); font-weight: 700; }
  .skip-link:not(:focus) { overflow: hidden; clip-path: inset(50%); inline-size: 1px; block-size: 1px; padding: 0; border: 0; white-space: nowrap; }
  .report-contents { margin-block-start: var(--bl-space-5); padding-block: var(--bl-space-3); border-block: var(--bl-border-thin) solid var(--bl-color-divider); font-size: var(--bl-font-size-sm); }
  .report-contents ol { display: flex; flex-wrap: wrap; gap: var(--bl-space-2) var(--bl-space-5); margin: 0; padding: 0; list-style: none; }
  .report-contents a { color: var(--bl-color-fg-primary); font-weight: 700; }
  h1, h2, h3, p, dl, ol { margin-block-start: 0; }
  /* Display role: h1 and h2 only. h3 carries identifiers (rule ids, paths) and reads as body. */
  h1, h2 { font-family: var(--bl-font-display); }
  h1 { max-width: 12ch; margin-block-end: var(--bl-space-4); font-size: var(--bl-font-size-2xl); line-height: var(--bl-line-tight); letter-spacing: -.02em; }
  h2 { margin-block-end: var(--bl-space-5); font-size: var(--bl-font-size-heading); line-height: 1.2; }
  h3 { margin-block-end: var(--bl-space-3); font-size: var(--bl-font-size-lg); line-height: 1.3; }
  code, .mono { font-family: var(--bl-font-mono); }
  code { font-size: .9em; }
  /* Identifiers and commands break only where a break cannot change what is copied: after a rule's
     namespace slash (a <wbr>), never at a hyphen inside the name or inside a flag. */
  .rule-id, .cli-flag { overflow-wrap: normal; word-break: normal; hyphens: manual; }
  .rule-id > span, .cli-flag > span { white-space: nowrap; }
  /* A path breaks after a slash, and inside a segment only when that segment alone is wider than
     its line: each segment is an atomic inline box, capped at the line, that wraps inside itself
     only when its own text cannot fit (real evidence names run to 52+ characters with no slash;
     as no-wrap spans they scrolled a phone sideways by 34-150 px). */
  .path-id { overflow-wrap: normal; word-break: normal; hyphens: manual; }
  .path-id > span { display: inline-block; max-inline-size: 100%; overflow-wrap: anywhere; vertical-align: baseline; }
  a { color: var(--bl-color-accent-info); text-underline-offset: .2em; text-decoration-thickness: var(--bl-border-thin); }
  a:hover { text-decoration-thickness: var(--bl-border-strong); }
  a:focus-visible, [tabindex]:focus-visible { outline: var(--bl-focus-width) solid var(--bl-color-focus); outline-offset: var(--bl-space-1); }
  .report-header { position: relative; min-height: 22rem; padding: var(--bl-space-5) var(--bl-space-5) var(--bl-space-6); border: var(--bl-border-strong) solid var(--bl-color-fg-primary); background: var(--bl-color-paper); }
  .report-header::before { content: ""; position: absolute; inset-block: 0; inset-inline-start: 0; width: var(--bl-space-2); background: var(--bl-color-divider); }
  .report-header.state-clean::before { background: var(--bl-color-accent-primary); }
  .report-header.state-findings::before, .report-header.state-infrastructure::before { background: var(--bl-color-accent-warn); }
  .report-header.state-insufficient-coverage::before { background: var(--bl-color-fg-primary); }
  .tool-line { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--bl-space-2); margin-block-end: var(--bl-space-7); font-family: var(--bl-font-mono); font-size: var(--bl-font-size-sm); }
  .state-marker { display: inline-block; margin-block-end: var(--bl-space-3); padding: var(--bl-space-1) var(--bl-space-2); border: var(--bl-border-thin) solid currentColor; border-radius: var(--bl-radius-sm); font-family: var(--bl-font-mono); font-size: var(--bl-font-size-xs); font-weight: 700; letter-spacing: .08em; }
  .status-sentence { max-width: var(--bl-text-width); margin-block-end: var(--bl-space-6); font-size: var(--bl-font-size-lg); }
  .gate-effect { display: inline-grid; gap: var(--bl-space-1); padding-block-start: var(--bl-space-3); border-block-start: var(--bl-border-strong) solid var(--bl-color-fg-primary); }
  .gate-effect span { color: var(--bl-color-fg-muted); font-size: var(--bl-font-size-xs); font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  section { margin-block-start: var(--bl-space-7); }
  section > h2 { break-after: avoid; }
  .summary-grid { display: grid; grid-template-columns: minmax(12rem, 1.5fr) repeat(3, minmax(7rem, 1fr)); gap: var(--bl-space-3); }
  .summary-grid > div { min-height: 7rem; padding: var(--bl-space-4); border-block-start: var(--bl-border-strong) solid var(--bl-color-divider); background: var(--bl-color-soft); }
  .summary-grid > div:first-child { border-block-start-color: var(--bl-color-fg-primary); background: var(--bl-color-paper); }
  .summary-grid dt, .run-facts dt, .finding-facts dt { color: var(--bl-color-fg-muted); font-size: var(--bl-font-size-xs); font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
  .summary-grid dd { margin: var(--bl-space-2) 0 0; font: 700 var(--bl-font-size-xl)/1.2 var(--bl-font-mono); }
  .summary-grid small { display: block; margin-block-start: var(--bl-space-2); color: var(--bl-color-fg-muted); font-size: var(--bl-font-size-sm); font-weight: 400; }
  .run-facts { display: grid; grid-template-columns: repeat(4, minmax(9rem, 1fr)); gap: var(--bl-space-4); margin-block: var(--bl-space-5) 0; padding-block: var(--bl-space-4); border-block: var(--bl-border-thin) solid var(--bl-color-divider); }
  .run-facts dd, .finding-facts dd { margin: var(--bl-space-1) 0 0; }
  /* Boxed blocks share the column's edges; the 72ch measure applies to the text inside them. An
     alert as wide as its text ended 62 px short of the card below it in print and 527 px on a
     desktop, and abutted that card with no gap. */
  .state-alert { margin-block-end: var(--bl-space-4); padding: var(--bl-space-5); border-inline-start: var(--bl-border-strong) solid var(--bl-color-accent-warn); background: var(--bl-color-soft); }
  .state-alert > p, .state-alert > ul, .empty-state > p { max-width: var(--bl-text-width); }
  .state-alert > :last-child, .empty-state > :last-child { margin-block-end: 0; }
  .checker-list, .finding-list { padding: 0; list-style: none; }
  .checker-list { display: grid; gap: var(--bl-space-4); }
  .checker-event { padding: var(--bl-space-4); border: var(--bl-border-thin) solid var(--bl-color-divider); border-radius: var(--bl-radius-sm); background: var(--bl-color-paper); }
  .checker-event p { margin-block-end: var(--bl-space-2); }
  .checker-event p:last-child { margin-block-end: 0; }
  .section-lead { max-width: var(--bl-text-width); margin-block-end: var(--bl-space-5); color: var(--bl-color-fg-muted); }
  .section-heading { break-inside: avoid; break-after: avoid; }
  .finding-list { display: grid; gap: var(--bl-space-5); counter-reset: finding; }
  .finding-list > li { counter-increment: finding; }
  .finding { position: relative; padding: var(--bl-space-5); border: var(--bl-border-thin) solid var(--bl-color-divider); border-radius: var(--bl-radius-md); background: var(--bl-color-paper); }
  .finding::before { content: counter(finding, decimal-leading-zero); position: absolute; inset-block-start: var(--bl-space-4); inset-inline-end: var(--bl-space-4); color: var(--bl-color-fg-muted); font: 700 var(--bl-font-size-sm)/1 var(--bl-font-mono); }
  .finding.error { border-block-start: var(--bl-border-strong) solid var(--bl-color-accent-warn); }
  .finding.warn { border-block-start: var(--bl-border-strong) solid var(--bl-color-fg-primary); }
  .finding.info { border-block-start: var(--bl-border-strong) solid var(--bl-color-accent-info); }
  .finding-kicker { display: flex; flex-wrap: wrap; align-items: center; gap: var(--bl-space-2); padding-inline-end: var(--bl-space-6); }
  .severity { font-weight: 800; text-transform: uppercase; }
  .severity.error { color: var(--bl-color-accent-warn); }
  .severity.info { color: var(--bl-color-accent-info); }
  .experimental { padding: var(--bl-space-1) var(--bl-space-2); border: var(--bl-border-thin) solid var(--bl-color-divider); border-radius: var(--bl-radius-sm); color: var(--bl-color-fg-muted); font-size: var(--bl-font-size-xs); text-transform: uppercase; }
  .finding h3 { margin-block-start: var(--bl-space-4); padding-inline-end: var(--bl-space-6); }
  .finding-message { max-width: var(--bl-text-width); font-size: var(--bl-font-size-lg); }
  .finding-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--bl-space-4) var(--bl-space-5); margin-block: var(--bl-space-5) 0; padding-block-start: var(--bl-space-4); border-block-start: var(--bl-border-thin) solid var(--bl-color-divider); }
  .finding-facts > div { min-width: 0; }
  .evidence-state { margin-block: var(--bl-space-4) 0; color: var(--bl-color-fg-muted); font-size: var(--bl-font-size-sm); }
  .evidence-state strong { color: var(--bl-color-fg-primary); }
  .remediation-caveat { max-width: var(--bl-text-width); margin-block: calc(-1 * var(--bl-space-2)) var(--bl-space-5); padding-inline-start: var(--bl-space-3); border-inline-start: var(--bl-border-strong) solid var(--bl-color-fg-primary); }
  /* The per-finding marker is set at the advice's own size and in body-text colour, not muted. */
  .untested-marker { display: inline-block; margin-inline: var(--bl-space-1); padding: 0 var(--bl-space-1); border: var(--bl-border-thin) solid currentColor; border-radius: var(--bl-radius-sm); color: var(--bl-color-fg-primary); font-size: 1em; font-weight: 700; line-height: 1.3; }
  /* Print only: names the finding at the top of its tail, which is where a split finding's second
     fragment begins (its head and facts never part; see the print rules below). */
  .finding-continued { display: none; }
  .finding-remediation { margin-block: var(--bl-space-4) 0; padding: var(--bl-space-3); border-inline-start: var(--bl-border-strong) solid var(--bl-color-fg-primary); background: var(--bl-color-soft); font-size: var(--bl-font-size-sm); }
  .finding-remediation p, .finding-frequency-note p { max-width: var(--bl-text-width); margin: 0; }
  .finding-frequency-note { margin-block: var(--bl-space-3) 0; padding: var(--bl-space-3); border-inline-start: var(--bl-border-strong) solid var(--bl-color-divider); background: var(--bl-color-soft); font-size: var(--bl-font-size-sm); color: var(--bl-color-fg-muted); }
  .coverage-shortfall-list { margin: var(--bl-space-3) 0 0; padding-inline-start: var(--bl-space-4); display: grid; gap: var(--bl-space-4); }
  .coverage-shortfall-item { margin-block-end: var(--bl-space-3); }
  .coverage-shortfall-item p { margin: 0 0 var(--bl-space-1); }
  .coverage-shortfall-item ul { margin: var(--bl-space-1) 0 0; padding-inline-start: var(--bl-space-4); }
  .empty-state { padding: var(--bl-space-5); border: var(--bl-border-thin) solid var(--bl-color-divider); border-radius: var(--bl-radius-sm); background: var(--bl-color-paper); }
  .coverage-documents { display: grid; gap: var(--bl-space-6); }
  /* Coverage is one aligned table per document: the rule id is the row header, counts, coverage and
     floor are right-aligned tabular numbers, the result is text. */
  .coverage-table { width: 100%; border-collapse: collapse; font-size: var(--bl-font-size-sm); font-variant-numeric: tabular-nums; }
  .coverage-table caption { padding-block: var(--bl-space-3); border-block-start: var(--bl-border-strong) solid var(--bl-color-fg-primary); text-align: start; }
  /* Path and verdict are wrapping flex items with a column gap: a gap sits only BETWEEN items on
     one line, never after the last, so a path that fills its line cannot be pushed past the edge.
     A trailing margin on the path did exactly that (a long path's last segment, capped at the line,
     plus the margin: 12 px of overflow, and Chrome shrank the whole printed document to 98.3 %). */
  .caption-line { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: var(--bl-space-3); row-gap: var(--bl-space-1); }
  .caption-line > * { min-inline-size: 0; max-inline-size: 100%; }
  .coverage-path { font-size: var(--bl-font-size-base); font-weight: 700; }
  .document-verdict { color: var(--bl-color-fg-muted); font-family: var(--bl-font-mono); font-size: var(--bl-font-size-sm); }
  .coverage-table th, .coverage-table td { padding: var(--bl-space-2) var(--bl-space-3); border-block-end: var(--bl-border-thin) solid var(--bl-color-divider); overflow-wrap: normal; text-align: start; vertical-align: baseline; }
  .coverage-table thead th { border-block-end: var(--bl-border-strong) solid var(--bl-color-fg-primary); color: var(--bl-color-fg-muted); font-size: var(--bl-font-size-xs); font-weight: 700; letter-spacing: .04em; text-transform: uppercase; vertical-align: bottom; }
  .coverage-table tbody th { position: relative; font-weight: 400; }
  .coverage-table .num { text-align: end; }
  .coverage-table td.num, .coverage-table td.result { white-space: nowrap; }
  .coverage-table abbr { text-decoration: none; }
  /* A below-floor row carries its state three ways: the words, weight and colour of its result, and
     a strong edge on its row header. The edge is a positioned border, not a cell border: in the
     collapsed-border model a wider border on one cell would shift that row's text off the column. */
  .coverage-table tr.short th[scope="row"]::before { content: ""; position: absolute; inset-block: 0; inset-inline-start: 0; border-inline-start: var(--bl-border-strong) solid var(--bl-color-accent-warn); }
  .coverage-result { font-weight: 700; }
  .coverage-result.short { color: var(--bl-color-accent-warn); }
  .report-footer { margin-block-start: var(--bl-space-7); padding-block-start: var(--bl-space-4); border-block-start: var(--bl-border-thin) solid var(--bl-color-divider); color: var(--bl-color-fg-muted); font-size: var(--bl-font-size-sm); }
  @media (max-width: 64rem) {
    .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .run-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    /* A 768 px tablet has 720 px for seven columns; the longest rule name alone needs 198 px. */
    .coverage-table th, .coverage-table td { padding-inline: var(--bl-space-2); }
    .coverage-table thead th { font-size: .6875rem; letter-spacing: .02em; }
  }
  @media (max-width: 30rem) {
    .report-shell { padding: var(--bl-space-3); }
    .report-header { min-height: 0; padding: var(--bl-space-4); }
    .tool-line { display: grid; margin-block-end: var(--bl-space-6); }
    .summary-grid, .run-facts, .finding-facts { grid-template-columns: minmax(0, 1fr); }
    /* The same table on a phone: each row becomes a two-line grid on one shared five-column
       template — rule and result on the first line, the five numbers below — so every column still
       aligns across rows and with its header, and nothing scrolls sideways. */
    .coverage-table, .coverage-table thead, .coverage-table tbody, .coverage-table caption { display: block; }
    .coverage-table tr { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); column-gap: var(--bl-space-2); row-gap: var(--bl-space-1); padding-block: var(--bl-space-2); border-block-end: var(--bl-border-thin) solid var(--bl-color-divider); }
    .coverage-table thead tr { border-block-end: var(--bl-border-strong) solid var(--bl-color-fg-primary); }
    .coverage-table th, .coverage-table td, .coverage-table thead th { padding: 0; border: 0; }
    /* Five value columns share 366 CSS px: header labels must fit a 67 px column, or a right-aligned
       label overflows past its column edge (measured: MEASURED at .75rem overran by 5.7 px, and
       CANDIDATES, whole since the soft hyphen went, by 6.7 px at .6875rem). */
    .coverage-table thead th { font-size: .625rem; letter-spacing: 0; }
    .coverage-table tbody th[scope="row"] { padding-inline-start: var(--bl-space-2); }
    .coverage-table thead .rule { padding-inline-start: var(--bl-space-2); }
    .coverage-table .rule { grid-column: 1 / 4; grid-row: 1; }
    .coverage-table .result { grid-column: 4 / 6; grid-row: 1; text-align: end; }
    .coverage-table .num { grid-row: 2; }
    .summary-grid > div { min-height: 0; }
    .finding { padding: var(--bl-space-4); }
    .finding::before { inset-block-start: var(--bl-space-3); inset-inline-end: var(--bl-space-3); }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0s !important; animation-duration: 0s !important; animation-iteration-count: 1 !important; }
  }
  @page { size: A4; margin: 12mm; }
  @media print {
    :root {
      color-scheme: light;
      ${reportTokenDeclarations("print", "\n      ")}
    }
    html, body { background: var(--bl-color-bg-primary); }
    .report-shell { width: 100%; padding: 0; }
    .skip-link, .report-contents { display: none; }
    .report-header { min-height: 0; padding: var(--bl-space-4); }
    .tool-line { margin-block-end: var(--bl-space-5); }
    section { margin-block-start: var(--bl-space-6); }
    .summary-grid { grid-template-columns: minmax(0, 1.7fr) repeat(3, minmax(0, 1fr)); }
    .summary-grid > div { min-height: 0; padding: var(--bl-space-3); }
    .summary-grid > div:first-child dd { overflow-wrap: normal; font-size: var(--bl-font-size-base); white-space: nowrap; word-break: normal; }
    .summary-grid > div:first-child small { white-space: normal; }
    .run-facts { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .finding-list { gap: var(--bl-space-4); }
    /* Block flow, not a grid: a grid item that fragments is stretched to its unfragmented grid
       area, and Blink handed the surplus a repeated table header creates to the continuation
       page's rows (measured: 21.7 pt rows on the first page, 24.8-26.3 pt on the next, and a
       second rule under the header). */
    .coverage-documents { display: block; }
    .coverage-documents > * + * { margin-block-start: var(--bl-space-4); }
    .finding { padding: var(--bl-space-4); }
    /* Three columns: the six facts take two rows, so head + facts (one keep-with-next run) stay
       under 40 % of a page. In two columns the run measured 427.7 px (41.5 %). */
    .finding-facts { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    /* The heading explains why the first/only apparatus card is evidence rather than a failure.
       Keep the semantic unit together; a measured red control put the heading on page 1 and the
       positive card alone on page 2 when only the generic h2 break rule was present. */
    .apparatus-section { break-inside: avoid; page-break-inside: avoid; }
    /* The table must fit the 703 px content box: wider content makes Chrome shrink the whole
       printed document to fit (measured 736.6 px -> every page scaled to 95 %). */
    .coverage-table { font-size: .8125rem; }
    .coverage-table th, .coverage-table td { padding: var(--bl-space-1) .375rem; }
    /* CANDIDATES is one word now (a soft hyphen printed it as CANDI- / DATES); at .6875rem with
       letter spacing the table grew 6.5 px past the content box. */
    .coverage-table thead th { font-size: .625rem; letter-spacing: 0; }
    .coverage-table thead { display: table-header-group; }
    /* Separate borders in print: with collapsed borders Blink painted the rule shared with the last
       row of the previous page again under the repeated header, a double rule on every
       continuation page. Each cell now owns its bottom rule; spacing 0 keeps the rules continuous. */
    .coverage-table { border-collapse: separate; border-spacing: 0; }
    .coverage-table tr { break-inside: avoid; }
    /* Caption and column header never end a page: they introduce the first rows. Measured without
       it: caption and header alone at the foot of page 7, every row on page 8 (infrastructure). */
    .coverage-table caption { break-inside: avoid; break-after: avoid; }
    .coverage-table thead { break-after: avoid; }
    /* Blink honours <wbr> even under nowrap (measured: the table rule id broke at the slash), so
       print removes the opportunity itself. */
    .rule-id, .cli-flag { white-space: nowrap; }
    .rule-id wbr, .cli-flag wbr { display: none; }
    /* The last two rows never part: see renderCoverageTable in html.ts. */
    .coverage-tail { break-inside: avoid; }
    .report-header, .summary-grid > div, .checker-event, .state-alert, .empty-state, .findings-intro { break-inside: avoid; }
    /* A finding is 60-73 % of an A4 content box, so whole findings meant one finding per page and
       pages filled to 29-45 % (measured on 0.6.0). A finding now fragments BETWEEN its units and
       never inside one: its head (severity, rule, message), its facts, and its tail (remediation,
       note, evidence) — the tail is one unit, because an evidence line alone in a cloned frame at
       the top of a page reads as a stray. A split card repeats its frame on both pages. */
    .finding-list { display: block; }
    .finding-list > li + li { margin-block-start: var(--bl-space-4); }
    .finding { break-inside: auto; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
    .finding-head, .finding-facts, .finding-tail { break-inside: avoid; }
    .finding-head { break-after: avoid; }
    /* A split finding continues at its tail, and the tail says whose it is: a fragment that began
       with a bare fact or remediation box in a cloned frame could not be told apart from the
       finding before it. The facts are one unit so their top rule never prints without them
       (measured on 0.6.0+: finding 02's rule alone at the foot of page 2, its facts on page 3). */
    .finding-continued { display: block; margin: var(--bl-space-4) 0 0; color: var(--bl-color-fg-muted); font-size: var(--bl-font-size-xs); font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    .finding-continued .rule-id { text-transform: none; letter-spacing: 0; }
    .finding-continued + .finding-remediation { margin-block-start: var(--bl-space-2); }
    /* The footer prints as the end mark and stays with the content before it. */
    /* The table above ends on its own row rule; a footer rule 28 px below it read as a double rule. */
    .report-footer { margin-block-start: var(--bl-space-5); padding-block-start: 0; border-block-start: 0; break-before: avoid; break-inside: avoid; }
    a { color: var(--bl-color-fg-primary); }
  }
`;
