/**
 * Report Surface v2 tokens and layout. All colour and layout constants live in the token blocks;
 * components below consume names, so light, dark and print cannot drift through local exceptions.
 */
export const REPORT_HTML_STYLES = String.raw`
  :root {
    color-scheme: light dark;
    --ds-color-bg-primary: #F4F4EE;
    --ds-color-bg-elevated: #FFFFFF;
    --ds-color-fg-primary: #0E0E0F;
    --ds-color-fg-muted: #4B4B46;
    --ds-color-accent-primary: #D4FF3D;
    --ds-color-accent-ink: #173500;
    --ds-color-accent-warn: #9A3008;
    --ds-color-accent-info: #07546A;
    --ds-color-divider: #77776F;
    --ds-color-soft: #E7E7DF;
    --ds-color-paper: #FFFFFF;
    --ds-color-focus: #0E0E0F;
    --ds-space-1: .25rem;
    --ds-space-2: .5rem;
    --ds-space-3: .75rem;
    --ds-space-4: 1rem;
    --ds-space-5: 1.5rem;
    --ds-space-6: 2rem;
    --ds-space-7: 3rem;
    --ds-radius-sm: .25rem;
    --ds-radius-md: .5rem;
    --ds-border-thin: .0625rem;
    --ds-border-strong: .1875rem;
    --ds-focus-width: .1875rem;
    --ds-report-width: 76rem;
    --ds-text-width: 72ch;
    --ds-font-size-xs: .75rem;
    --ds-font-size-sm: .875rem;
    --ds-font-size-base: 1rem;
    --ds-font-size-lg: 1.125rem;
    --ds-font-size-xl: 1.375rem;
    --ds-font-size-2xl: clamp(2rem, 7vw, 4.5rem);
    --ds-line-tight: 1.08;
    --ds-line-body: 1.55;
    --ds-font-body: "Helvetica Neue", Arial, system-ui, sans-serif;
    --ds-font-display: "Arial Narrow", "Helvetica Neue", Arial, system-ui, sans-serif;
    --ds-font-mono: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ds-color-bg-primary: #0E0E0F;
      --ds-color-bg-elevated: #181818;
      --ds-color-fg-primary: #F5F5F2;
      --ds-color-fg-muted: #B8B8AE;
      --ds-color-accent-ink: #D4FF3D;
      --ds-color-accent-warn: #FF8A58;
      --ds-color-accent-info: #7FD3EF;
      --ds-color-divider: #5B5B54;
      --ds-color-soft: #242422;
      --ds-color-paper: #181818;
      --ds-color-focus: #D4FF3D;
    }
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; background: var(--ds-color-bg-primary); }
  body {
    margin: 0;
    color: var(--ds-color-fg-primary);
    background: var(--ds-color-bg-primary);
    font: 400 var(--ds-font-size-base)/var(--ds-line-body) var(--ds-font-body);
    overflow-wrap: anywhere;
  }
  main { width: min(100%, var(--ds-report-width)); margin-inline: auto; padding: var(--ds-space-5); }
  h1, h2, h3, p, dl, ol { margin-block-start: 0; }
  h1, h2, h3 { font-family: var(--ds-font-display); }
  h1 { max-width: 12ch; margin-block-end: var(--ds-space-4); font-size: var(--ds-font-size-2xl); line-height: var(--ds-line-tight); letter-spacing: -.035em; }
  h2 { margin-block-end: var(--ds-space-5); font-size: var(--ds-font-size-xl); line-height: 1.2; }
  h3 { margin-block-end: var(--ds-space-3); font-size: var(--ds-font-size-lg); line-height: 1.3; }
  code, .mono { font-family: var(--ds-font-mono); }
  code { font-size: .9em; }
  a { color: var(--ds-color-accent-info); text-underline-offset: .2em; text-decoration-thickness: var(--ds-border-thin); }
  a:hover { text-decoration-thickness: var(--ds-border-strong); }
  a:focus-visible, [tabindex]:focus-visible { outline: var(--ds-focus-width) solid var(--ds-color-focus); outline-offset: var(--ds-space-1); }
  .report-header { position: relative; min-height: 22rem; padding: var(--ds-space-5) var(--ds-space-5) var(--ds-space-6); border: var(--ds-border-strong) solid var(--ds-color-fg-primary); background: var(--ds-color-paper); }
  .report-header::before { content: ""; position: absolute; inset-block: 0; inset-inline-start: 0; width: var(--ds-space-2); background: var(--ds-color-divider); }
  .report-header.state-clean::before { background: var(--ds-color-accent-primary); }
  .report-header.state-findings::before, .report-header.state-infrastructure::before { background: var(--ds-color-accent-warn); }
  .report-header.state-insufficient-coverage::before { background: var(--ds-color-fg-primary); }
  .tool-line { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--ds-space-2); margin-block-end: var(--ds-space-7); font-family: var(--ds-font-mono); font-size: var(--ds-font-size-sm); }
  .state-marker { display: inline-block; margin-block-end: var(--ds-space-3); padding: var(--ds-space-1) var(--ds-space-2); border: var(--ds-border-thin) solid currentColor; border-radius: var(--ds-radius-sm); font-family: var(--ds-font-mono); font-size: var(--ds-font-size-xs); font-weight: 700; letter-spacing: .08em; }
  .status-sentence { max-width: var(--ds-text-width); margin-block-end: var(--ds-space-6); font-size: var(--ds-font-size-lg); }
  .gate-effect { display: inline-grid; gap: var(--ds-space-1); padding-block-start: var(--ds-space-3); border-block-start: var(--ds-border-strong) solid var(--ds-color-fg-primary); }
  .gate-effect span { color: var(--ds-color-fg-muted); font-size: var(--ds-font-size-xs); font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  section { margin-block-start: var(--ds-space-7); }
  section > h2 { break-after: avoid; }
  .summary-grid { display: grid; grid-template-columns: minmax(12rem, 1.5fr) repeat(3, minmax(7rem, 1fr)); gap: var(--ds-space-3); }
  .summary-grid > div { min-height: 7rem; padding: var(--ds-space-4); border-block-start: var(--ds-border-strong) solid var(--ds-color-divider); background: var(--ds-color-soft); }
  .summary-grid > div:first-child { border-block-start-color: var(--ds-color-fg-primary); background: var(--ds-color-paper); }
  .summary-grid dt, .run-facts dt, .finding-facts dt, .coverage-record dt { color: var(--ds-color-fg-muted); font-size: var(--ds-font-size-xs); font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
  .summary-grid dd { margin: var(--ds-space-2) 0 0; font: 700 var(--ds-font-size-xl)/1.2 var(--ds-font-mono); }
  .summary-grid small { display: block; margin-block-start: var(--ds-space-2); color: var(--ds-color-fg-muted); font-size: var(--ds-font-size-sm); font-weight: 400; }
  .run-facts { display: grid; grid-template-columns: repeat(4, minmax(9rem, 1fr)); gap: var(--ds-space-4); margin-block: var(--ds-space-5) 0; padding-block: var(--ds-space-4); border-block: var(--ds-border-thin) solid var(--ds-color-divider); }
  .run-facts dd, .finding-facts dd, .coverage-record dd { margin: var(--ds-space-1) 0 0; }
  .state-alert { max-width: var(--ds-text-width); padding: var(--ds-space-5); border-inline-start: var(--ds-border-strong) solid var(--ds-color-accent-warn); background: var(--ds-color-soft); }
  .checker-list, .finding-list, .coverage-documents { padding: 0; list-style: none; }
  .checker-list { display: grid; gap: var(--ds-space-4); }
  .checker-event { padding: var(--ds-space-4); border: var(--ds-border-thin) solid var(--ds-color-divider); border-radius: var(--ds-radius-sm); background: var(--ds-color-paper); }
  .checker-event p { margin-block-end: var(--ds-space-2); }
  .checker-event p:last-child { margin-block-end: 0; }
  .section-lead { max-width: var(--ds-text-width); margin-block-end: var(--ds-space-5); color: var(--ds-color-fg-muted); }
  .section-heading { break-inside: avoid; break-after: avoid; }
  .finding-list { display: grid; gap: var(--ds-space-5); counter-reset: finding; }
  .finding-list > li { counter-increment: finding; }
  .finding { position: relative; padding: var(--ds-space-5); border: var(--ds-border-thin) solid var(--ds-color-divider); border-radius: var(--ds-radius-md); background: var(--ds-color-paper); }
  .finding::before { content: counter(finding, decimal-leading-zero); position: absolute; inset-block-start: var(--ds-space-4); inset-inline-end: var(--ds-space-4); color: var(--ds-color-fg-muted); font: 700 var(--ds-font-size-sm)/1 var(--ds-font-mono); }
  .finding.error { border-block-start: var(--ds-border-strong) solid var(--ds-color-accent-warn); }
  .finding.warn { border-block-start: var(--ds-border-strong) solid var(--ds-color-fg-primary); }
  .finding.info { border-block-start: var(--ds-border-strong) solid var(--ds-color-accent-info); }
  .finding-kicker { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ds-space-2); padding-inline-end: var(--ds-space-6); }
  .severity { font-weight: 800; text-transform: uppercase; }
  .severity.error { color: var(--ds-color-accent-warn); }
  .severity.info { color: var(--ds-color-accent-info); }
  .experimental { padding: var(--ds-space-1) var(--ds-space-2); border: var(--ds-border-thin) solid var(--ds-color-divider); border-radius: var(--ds-radius-sm); color: var(--ds-color-fg-muted); font-size: var(--ds-font-size-xs); text-transform: uppercase; }
  .finding h3 { margin-block-start: var(--ds-space-4); padding-inline-end: var(--ds-space-6); }
  .finding-message { max-width: var(--ds-text-width); font-size: var(--ds-font-size-lg); }
  .finding-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ds-space-4) var(--ds-space-5); margin-block: var(--ds-space-5) 0; padding-block-start: var(--ds-space-4); border-block-start: var(--ds-border-thin) solid var(--ds-color-divider); }
  .finding-facts > div, .coverage-record > div { min-width: 0; }
  .evidence-state { margin-block: var(--ds-space-4) 0; color: var(--ds-color-fg-muted); font-size: var(--ds-font-size-sm); }
  .evidence-state strong { color: var(--ds-color-fg-primary); }
  .empty-state { max-width: var(--ds-text-width); padding: var(--ds-space-5); border: var(--ds-border-thin) solid var(--ds-color-divider); border-radius: var(--ds-radius-sm); background: var(--ds-color-paper); }
  .coverage-documents { display: grid; gap: var(--ds-space-6); }
  .coverage-document { padding-block-start: var(--ds-space-4); border-block-start: var(--ds-border-strong) solid var(--ds-color-fg-primary); }
  .document-verdict { color: var(--ds-color-fg-muted); font-family: var(--ds-font-mono); font-size: var(--ds-font-size-sm); }
  .coverage-list { display: grid; gap: var(--ds-space-3); margin-block-start: var(--ds-space-4); }
  .coverage-record { display: grid; grid-template-columns: minmax(14rem, 2fr) repeat(5, minmax(5rem, 1fr)); gap: var(--ds-space-3); margin: 0; padding: var(--ds-space-3); border: var(--ds-border-thin) solid var(--ds-color-divider); background: var(--ds-color-paper); }
  .coverage-record.short { border-inline-start: var(--ds-border-strong) solid var(--ds-color-accent-warn); }
  .coverage-result { font-weight: 700; }
  .coverage-result.short { color: var(--ds-color-accent-warn); }
  .report-footer { margin-block-start: var(--ds-space-7); padding-block-start: var(--ds-space-4); border-block-start: var(--ds-border-thin) solid var(--ds-color-divider); color: var(--ds-color-fg-muted); font-size: var(--ds-font-size-sm); }
  @media (max-width: 64rem) {
    .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .run-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .coverage-record { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .coverage-record > div:first-child { grid-column: 1 / -1; }
  }
  @media (max-width: 30rem) {
    main { padding: var(--ds-space-3); }
    .report-header { min-height: 0; padding: var(--ds-space-4); }
    .tool-line { display: grid; margin-block-end: var(--ds-space-6); }
    .summary-grid, .run-facts, .finding-facts, .coverage-record { grid-template-columns: minmax(0, 1fr); }
    .coverage-record > div:first-child { grid-column: auto; }
    .summary-grid > div { min-height: 0; }
    .finding { padding: var(--ds-space-4); }
    .finding::before { inset-block-start: var(--ds-space-3); inset-inline-end: var(--ds-space-3); }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0s !important; animation-duration: 0s !important; animation-iteration-count: 1 !important; }
  }
  @page { size: A4; margin: 12mm; }
  @media print {
    :root {
      color-scheme: light;
      --ds-color-bg-primary: #FFFFFF;
      --ds-color-bg-elevated: #FFFFFF;
      --ds-color-fg-primary: #0E0E0F;
      --ds-color-fg-muted: #3F3F3B;
      --ds-color-accent-ink: #173500;
      --ds-color-accent-warn: #812500;
      --ds-color-accent-info: #074B5D;
      --ds-color-divider: #72726B;
      --ds-color-soft: #EFEFE8;
      --ds-color-paper: #FFFFFF;
      --ds-color-focus: #0E0E0F;
    }
    html, body { background: var(--ds-color-bg-primary); }
    main { width: 100%; padding: 0; }
    .report-header { min-height: 0; padding: var(--ds-space-4); }
    .tool-line { margin-block-end: var(--ds-space-5); }
    section { margin-block-start: var(--ds-space-6); }
    .summary-grid { grid-template-columns: minmax(0, 1.7fr) repeat(3, minmax(0, 1fr)); }
    .summary-grid > div { min-height: 0; padding: var(--ds-space-3); }
    .summary-grid > div:first-child dd { overflow-wrap: normal; font-size: var(--ds-font-size-base); white-space: nowrap; word-break: normal; }
    .summary-grid > div:first-child small { white-space: normal; }
    .run-facts { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .finding-list, .coverage-documents { gap: var(--ds-space-4); }
    .finding { padding: var(--ds-space-4); }
    .finding-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    /* The heading explains why the first/only apparatus card is evidence rather than a failure.
       Keep the semantic unit together; a measured red control put the heading on page 1 and the
       positive card alone on page 2 when only the generic h2 break rule was present. */
    .apparatus-section { break-inside: avoid; page-break-inside: avoid; }
    .coverage-list { display: block; }
    .coverage-record { position: relative; display: flow-root; margin-block-end: var(--ds-space-3); padding: var(--ds-space-3); break-inside: avoid; page-break-inside: avoid; }
    /* Chrome can omit the physical inline-end border of a paged flow-root containing floats even
       though computed style reports it as 1px. Paint the same tokenized edge as a child border
       inside the box so it survives rasterization without depending on printed backgrounds. */
    .coverage-record::after { content: ""; position: absolute; inset-block: 0; inset-inline-end: 0; inline-size: 0; border-inline-end: var(--ds-border-thin) solid var(--ds-color-divider); }
    .coverage-record:last-child { margin-block-end: 0; }
    .coverage-record > div { float: left; width: 50%; min-height: var(--ds-space-6); padding-inline-end: var(--ds-space-3); }
    .coverage-record > div:first-child { float: none; width: 100%; margin-block-end: var(--ds-space-3); padding-inline-end: 0; }
    .report-header, .summary-grid > div, .checker-event, .state-alert, .empty-state, .coverage-record { break-inside: avoid; }
    /* Compact findings stay whole. A finding taller than the page still fragments by necessity. */
    .finding { break-inside: avoid-page; }
    .finding h3, .finding-facts > div, .evidence-state { break-inside: avoid; }
    .report-header.state-clean ~ .findings-empty { display: none; }
    .report-footer { display: none; }
    a { color: var(--ds-color-fg-primary); }
  }
`;
