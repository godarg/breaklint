/**
 * The one design-token table for both HTML renderers: the report (`render(report, "html")`, the
 * reviewed 32-cell surface) and the bounded review bundle view (`renderReport` /
 * `writeReportBundle`, `report.html`). Every custom property either stylesheet declares is
 * generated from this module, under the breaklint prefix `--bl-`.
 *
 * Why a fork and not the parent design system's `ds` namespace: the report is a public, MIT
 * product surface, not an instance of that design system; no code links the two, and a shared
 * prefix would invite silent cascade collisions the day a host page embeds a report. The decision
 * is recorded in docs/reporting.md.
 *
 * The two renderers keep separate palettes. The bundle view is its own bounded projection with an
 * explicit `theme` option rather than the operating-system preference, and it is outside the
 * reviewed matrix; sharing a module and a generator keeps both under the same lint without claiming
 * they share a look.
 */

export const TOKEN_PREFIX = "--bl-";

export type ThemedValue = { readonly light: string; readonly dark: string; readonly print: string };

/**
 * Report colours per theme. Print forces a light palette tuned for paper; every colour token is
 * defined in all three themes, so no theme can fall back to another by omission.
 */
export const REPORT_COLOR_TOKENS = {
  "bg-primary": { light: "#F4F4EE", dark: "#0E0E0F", print: "#FFFFFF" },
  "fg-primary": { light: "#0E0E0F", dark: "#F5F5F2", print: "#0E0E0F" },
  "fg-muted": { light: "#4B4B46", dark: "#B8B8AE", print: "#3F3F3B" },
  "accent-primary": { light: "#D4FF3D", dark: "#D4FF3D", print: "#D4FF3D" },
  "accent-warn": { light: "#9A3008", dark: "#FF8A58", print: "#812500" },
  "accent-info": { light: "#07546A", dark: "#7FD3EF", print: "#074B5D" },
  divider: { light: "#77776F", dark: "#5B5B54", print: "#72726B" },
  soft: { light: "#E7E7DF", dark: "#242422", print: "#EFEFE8" },
  paper: { light: "#FFFFFF", dark: "#181818", print: "#FFFFFF" },
  focus: { light: "#0E0E0F", dark: "#D4FF3D", print: "#0E0E0F" },
} as const satisfies Record<string, ThemedValue>;

export type ReportColorToken = keyof typeof REPORT_COLOR_TOKENS;

/**
 * Every foreground/background pair the report actually sets text in. The surface renderer measures
 * each pair from computed style in every screen cell and in print, and the stylesheet test computes
 * them from this table per theme; both require WCAG AA (4.5:1). `soft` carries the alert, the
 * remediation box and the frequency note, so text on it is measured too.
 */
export const REPORT_TEXT_CONTRAST_PAIRS = [
  ["fg-primary", "bg-primary"],
  ["fg-primary", "paper"],
  ["fg-primary", "soft"],
  ["fg-muted", "bg-primary"],
  ["fg-muted", "paper"],
  ["fg-muted", "soft"],
  ["accent-warn", "paper"],
  ["accent-info", "paper"],
] as const satisfies readonly (readonly [ReportColorToken, ReportColorToken])[];

/**
 * The report's font strategy: system fonts only (no bundled face, no runtime dependency), in three
 * roles whose GENERIC FAMILIES differ, so the hierarchy cannot collapse silently when the named
 * faces are missing.
 *
 * - display — a serif, for h1/h2 and section titles. In a dense evidence report nearly everything
 *   is sans or mono text of similar size; a serif gives headings a second axis of contrast besides
 *   size and weight, which survives the compressed print scale where h2 and a large paragraph are
 *   only a few points apart.
 * - body — a sans-serif with a large x-height and open forms for 14–18 px running text on screen
 *   and in print.
 * - mono — identifiers, paths, measured values and rule ids.
 *
 * `resolvesOn` is the DECLARED expectation per platform: the faces the role may resolve to there.
 * The surface gate reads the resolved platform font of every role in every cell (CDP) and every
 * embedded PDF font (pdffonts) and fails when a role resolves outside its declaration — so two
 * roles falling back to the same face fails, and so does a display role falling back to a
 * DIFFERENT sans than the body, which a mere "display ≠ body" check would pass.
 */
export const REPORT_FONT_ROLES = {
  display: {
    generic: "serif",
    stack: ['"Iowan Old Style"', "Charter", "Georgia", "Cambria", '"Liberation Serif"', '"Times New Roman"', '"DejaVu Serif"'],
    resolvesOn: {
      linux: ["Liberation Serif", "DejaVu Serif"],
      darwin: ["Iowan Old Style", "Charter", "Georgia"],
      win32: ["Georgia", "Cambria"],
    },
  },
  body: {
    generic: "sans-serif",
    stack: ['"Helvetica Neue"', "Helvetica", "Arial", '"Liberation Sans"', '"DejaVu Sans"'],
    resolvesOn: {
      linux: ["Liberation Sans", "DejaVu Sans"],
      darwin: ["Helvetica Neue", "Helvetica", "Arial"],
      win32: ["Arial"],
    },
  },
  mono: {
    generic: "monospace",
    stack: ["SFMono-Regular", "Menlo", "Consolas", '"DejaVu Sans Mono"', '"Liberation Mono"'],
    resolvesOn: {
      linux: ["DejaVu Sans Mono", "Liberation Mono"],
      darwin: ["SF Mono", "Menlo"],
      win32: ["Consolas"],
    },
  },
} as const;

export type FontRole = keyof typeof REPORT_FONT_ROLES;

const fontStack = (role: FontRole): string => [...REPORT_FONT_ROLES[role].stack, REPORT_FONT_ROLES[role].generic].join(", ");

/** Theme-independent report tokens: spacing, borders, measure, type scale and font stacks. */
export const REPORT_LAYOUT_TOKENS = {
  "space-1": ".25rem",
  "space-2": ".5rem",
  "space-3": ".75rem",
  "space-4": "1rem",
  "space-5": "1.5rem",
  "space-6": "2rem",
  "space-7": "3rem",
  "radius-sm": ".25rem",
  "radius-md": ".5rem",
  "border-thin": ".0625rem",
  "border-strong": ".1875rem",
  "focus-width": ".1875rem",
  "report-width": "76rem",
  "text-width": "72ch",
  "font-size-xs": ".75rem",
  "font-size-sm": ".875rem",
  "font-size-base": "1rem",
  "font-size-lg": "1.125rem",
  "font-size-xl": "1.375rem",
  "font-size-heading": "1.5rem",
  "font-size-2xl": "clamp(2rem, 7vw, 4.5rem)",
  "line-tight": "1.08",
  "line-body": "1.55",
  "font-body": fontStack("body"),
  "font-display": fontStack("display"),
  "font-mono": fontStack("mono"),
} as const satisfies Record<string, string>;

export type ReportLayoutToken = keyof typeof REPORT_LAYOUT_TOKENS;

/** Bundle-view colours. `print` keeps paper white and ink black whatever `theme` was chosen. */
export const BUNDLE_COLOR_TOKENS = {
  ink: { light: "#17231f", dark: "#edf2ec", print: "#000000" },
  paper: { light: "#f8f6f0", dark: "#16211d", print: "#ffffff" },
  muted: { light: "#53615b", dark: "#c1ccc4", print: "#53615b" },
  line: { light: "#bec8c0", dark: "#4d5a52", print: "#bec8c0" },
  accent: { light: "#b55b24", dark: "#ed9a61", print: "#b55b24" },
  warn: { light: "#936c00", dark: "#e8c163", print: "#936c00" },
  bad: { light: "#9e3030", dark: "#f18b8b", print: "#9e3030" },
  target: { light: "#bd3500", dark: "#bd3500", print: "#bd3500" },
  "target-halo": { light: "#ffffff", dark: "#ffffff", print: "#ffffff" },
  "evidence-ground": { light: "#ffffff", dark: "#ffffff", print: "#ffffff" },
} as const satisfies Record<string, ThemedValue>;

/** Text pairs in the bundle view; its accent, warn and bad colours are used for rules and borders only. */
export const BUNDLE_TEXT_CONTRAST_PAIRS = [
  ["ink", "paper"],
  ["muted", "paper"],
] as const satisfies readonly (readonly [keyof typeof BUNDLE_COLOR_TOKENS, keyof typeof BUNDLE_COLOR_TOKENS])[];

export const BUNDLE_LAYOUT_TOKENS = {
  space: "clamp(1rem,3vw,2.5rem)",
} as const satisfies Record<string, string>;

/** `var(--bl-color-…)` for a report colour token; a typo is a type error, not a silent fallback. */
export const reportColor = (name: ReportColorToken): string => `var(${TOKEN_PREFIX}color-${name})`;
export const reportToken = (name: ReportLayoutToken): string => `var(${TOKEN_PREFIX}${name})`;
export const bundleColor = (name: keyof typeof BUNDLE_COLOR_TOKENS): string => `var(${TOKEN_PREFIX}bundle-color-${name})`;
export const bundleToken = (name: keyof typeof BUNDLE_LAYOUT_TOKENS): string => `var(${TOKEN_PREFIX}bundle-${name})`;

type Theme = keyof ThemedValue;

function declarations(entries: readonly (readonly [string, string])[], separator: string, colon: string): string {
  return entries.map(([name, value]) => `${name}${colon}${value};`).join(separator);
}

/** The report's custom-property declarations for one theme (`light` includes the layout tokens). */
export function reportTokenDeclarations(theme: Theme, separator = "\n    "): string {
  const colors = Object.entries(REPORT_COLOR_TOKENS).map(([name, value]) => [`${TOKEN_PREFIX}color-${name}`, value[theme]] as const);
  const layout = theme === "light"
    ? Object.entries(REPORT_LAYOUT_TOKENS).map(([name, value]) => [`${TOKEN_PREFIX}${name}`, value] as const)
    : [];
  return declarations([...colors, ...layout], separator, ": ");
}

/** The bundle view's custom-property declarations for one theme, minified like its stylesheet. */
export function bundleTokenDeclarations(theme: Theme): string {
  const colors = Object.entries(BUNDLE_COLOR_TOKENS).map(([name, value]) => [`${TOKEN_PREFIX}bundle-color-${name}`, value[theme]] as const);
  const layout = theme === "light"
    ? Object.entries(BUNDLE_LAYOUT_TOKENS).map(([name, value]) => [`${TOKEN_PREFIX}bundle-${name}`, value] as const)
    : [];
  return declarations([...colors, ...layout], "", ":");
}
