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
  main { width: min(100%, var(--bl-report-width)); margin-inline: auto; padding: var(--bl-space-5); }
  h1, h2, h3, p, dl, ol { margin-block-start: 0; }
  h1, h2, h3 { font-family: var(--bl-font-display); }
  h1 { max-width: 12ch; margin-block-end: var(--bl-space-4); font-size: var(--bl-font-size-2xl); line-height: var(--bl-line-tight); letter-spacing: -.035em; }
  h2 { margin-block-end: var(--bl-space-5); font-size: var(--bl-font-size-xl); line-height: 1.2; }
  h3 { margin-block-end: var(--bl-space-3); font-size: var(--bl-font-size-lg); line-height: 1.3; }
  code, .mono { font-family: var(--bl-font-mono); }
  code { font-size: .9em; }
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
  .summary-grid dt, .run-facts dt, .finding-facts dt, .coverage-record dt { color: var(--bl-color-fg-muted); font-size: var(--bl-font-size-xs); font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
  .summary-grid dd { margin: var(--bl-space-2) 0 0; font: 700 var(--bl-font-size-xl)/1.2 var(--bl-font-mono); }
  .summary-grid small { display: block; margin-block-start: var(--bl-space-2); color: var(--bl-color-fg-muted); font-size: var(--bl-font-size-sm); font-weight: 400; }
  .run-facts { display: grid; grid-template-columns: repeat(4, minmax(9rem, 1fr)); gap: var(--bl-space-4); margin-block: var(--bl-space-5) 0; padding-block: var(--bl-space-4); border-block: var(--bl-border-thin) solid var(--bl-color-divider); }
  .run-facts dd, .finding-facts dd, .coverage-record dd { margin: var(--bl-space-1) 0 0; }
  .state-alert { max-width: var(--bl-text-width); padding: var(--bl-space-5); border-inline-start: var(--bl-border-strong) solid var(--bl-color-accent-warn); background: var(--bl-color-soft); }
  .checker-list, .finding-list, .coverage-documents { padding: 0; list-style: none; }
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
  .finding-facts > div, .coverage-record > div { min-width: 0; }
  .evidence-state { margin-block: var(--bl-space-4) 0; color: var(--bl-color-fg-muted); font-size: var(--bl-font-size-sm); }
  .evidence-state strong { color: var(--bl-color-fg-primary); }
  .finding-remediation-untested { margin-block-start: var(--bl-space-2); color: var(--bl-color-fg-muted); font-size: var(--bl-font-size-sm); }
  .finding-remediation { margin-block: var(--bl-space-4) 0; padding: var(--bl-space-3); border-inline-start: var(--bl-border-strong) solid var(--bl-color-fg-primary); background: var(--bl-color-soft); font-size: var(--bl-font-size-sm); }
  .finding-remediation p, .finding-frequency-note p { margin: 0; }
  .finding-frequency-note { margin-block: var(--bl-space-3) 0; padding: var(--bl-space-3); border-inline-start: var(--bl-border-strong) solid var(--bl-color-divider); background: var(--bl-color-soft); font-size: var(--bl-font-size-sm); color: var(--bl-color-fg-muted); }
  .coverage-shortfall-list { margin: var(--bl-space-3) 0 0; padding-inline-start: var(--bl-space-4); display: grid; gap: var(--bl-space-4); }
  .coverage-shortfall-item { margin-block-end: var(--bl-space-3); }
  .coverage-shortfall-item p { margin: 0 0 var(--bl-space-1); }
  .coverage-shortfall-item ul { margin: var(--bl-space-1) 0 0; padding-inline-start: var(--bl-space-4); }
  .empty-state { max-width: var(--bl-text-width); padding: var(--bl-space-5); border: var(--bl-border-thin) solid var(--bl-color-divider); border-radius: var(--bl-radius-sm); background: var(--bl-color-paper); }
  .coverage-documents { display: grid; gap: var(--bl-space-6); }
  .coverage-document { padding-block-start: var(--bl-space-4); border-block-start: var(--bl-border-strong) solid var(--bl-color-fg-primary); }
  .document-verdict { color: var(--bl-color-fg-muted); font-family: var(--bl-font-mono); font-size: var(--bl-font-size-sm); }
  .coverage-list { display: grid; gap: var(--bl-space-3); margin-block-start: var(--bl-space-4); }
  /* The print-only pagination bracket around the last two records. On screen it must contribute no
     box at all: as a grid item it would collapse the two records into one cell and swallow the gap
     between them. */
  .coverage-tail { display: contents; }
  .coverage-record { display: grid; grid-template-columns: minmax(14rem, 2fr) repeat(5, minmax(5rem, 1fr)); gap: var(--bl-space-3); margin: 0; padding: var(--bl-space-3); border: var(--bl-border-thin) solid var(--bl-color-divider); background: var(--bl-color-paper); }
  .coverage-record.short { border-inline-start: var(--bl-border-strong) solid var(--bl-color-accent-warn); }
  .coverage-result { font-weight: 700; }
  .coverage-result.short { color: var(--bl-color-accent-warn); }
  .report-footer { margin-block-start: var(--bl-space-7); padding-block-start: var(--bl-space-4); border-block-start: var(--bl-border-thin) solid var(--bl-color-divider); color: var(--bl-color-fg-muted); font-size: var(--bl-font-size-sm); }
  @media (max-width: 64rem) {
    .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .run-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .coverage-record { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .coverage-record > div:first-child { grid-column: 1 / -1; }
  }
  @media (max-width: 30rem) {
    main { padding: var(--bl-space-3); }
    .report-header { min-height: 0; padding: var(--bl-space-4); }
    .tool-line { display: grid; margin-block-end: var(--bl-space-6); }
    .summary-grid, .run-facts, .finding-facts, .coverage-record { grid-template-columns: minmax(0, 1fr); }
    .coverage-record > div:first-child { grid-column: auto; }
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
    main { width: 100%; padding: 0; }
    .report-header { min-height: 0; padding: var(--bl-space-4); }
    .tool-line { margin-block-end: var(--bl-space-5); }
    section { margin-block-start: var(--bl-space-6); }
    .summary-grid { grid-template-columns: minmax(0, 1.7fr) repeat(3, minmax(0, 1fr)); }
    .summary-grid > div { min-height: 0; padding: var(--bl-space-3); }
    .summary-grid > div:first-child dd { overflow-wrap: normal; font-size: var(--bl-font-size-base); white-space: nowrap; word-break: normal; }
    .summary-grid > div:first-child small { white-space: normal; }
    .run-facts { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .finding-list, .coverage-documents { gap: var(--bl-space-4); }
    .finding { padding: var(--bl-space-4); }
    .finding-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    /* The heading explains why the first/only apparatus card is evidence rather than a failure.
       Keep the semantic unit together; a measured red control put the heading on page 1 and the
       positive card alone on page 2 when only the generic h2 break rule was present. */
    .apparatus-section { break-inside: avoid; page-break-inside: avoid; }
    .coverage-list { display: block; }
    .coverage-record { position: relative; display: flow-root; margin-block-end: var(--bl-space-3); padding: var(--bl-space-3); break-inside: avoid; page-break-inside: avoid; }
    /* Chrome can omit the physical inline-end border of a paged flow-root containing floats even
       though computed style reports it as 1px. Paint the same tokenized edge as a child border
       inside the box so it survives rasterization without depending on printed backgrounds. */
    .coverage-record::after { content: ""; position: absolute; inset-block: 0; inset-inline-end: 0; inline-size: 0; border-inline-end: var(--bl-border-thin) solid var(--bl-color-divider); }
    .coverage-record:last-child { margin-block-end: 0; }
    /* Records do not fragment, so the terminal page carries the remainder of the pack, and where
       the coverage section starts is decided by unrelated content above it. A remainder of one ends
       the report on a page holding a single record. Bracketing the last two keeps that remainder at
       two without changing any flow height. Two is enough at the measured four records per page,
       where the gate's minimum ceil(perPage/2) is two; at six or more per page the bracket would
       have to grow with it. A break-before: avoid on the last record is the direct
       expression and does not hold here — the same measured Blink limitation as the apparatus
       heading above; a non-breaking container is what worked. */
    .coverage-tail { display: block; break-inside: avoid; page-break-inside: avoid; }
    .coverage-record > div { float: left; width: 50%; min-height: var(--bl-space-6); padding-inline-end: var(--bl-space-3); }
    .coverage-record > div:first-child { float: none; width: 100%; margin-block-end: var(--bl-space-3); padding-inline-end: 0; }
    .report-header, .summary-grid > div, .checker-event, .state-alert, .empty-state, .coverage-record { break-inside: avoid; }
    /* Compact findings stay whole. A finding taller than the page still fragments by necessity. */
    .finding { break-inside: avoid-page; }
    .finding h3, .finding-facts > div, .evidence-state { break-inside: avoid; }
    .report-header.state-clean ~ .findings-empty { display: none; }
    .report-footer { display: none; }
    a { color: var(--bl-color-fg-primary); }
  }
`;
