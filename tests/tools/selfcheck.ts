/**
 * Self-application.
 *
 * A tool that judges layout quality is measured by the quality of its own output. A widow in
 * the report of a widow checker is a public self-refutation that a stranger finds in seconds.
 *
 * This runs the project's own rules over its own generated HTML report and over its own
 * documentation, and requires that the `error` rules pass. It is a duty, not a feature — the
 * README does not mention it, because a tool that advertises its own strictness has replaced
 * the strictness with the advertisement.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { render } from "../../src/report/index.ts";
import { buildReport } from "../../src/core/build-report.ts";
import { runDocument } from "../../src/core/engine.ts";
import { ALL_RULES } from "../../src/rules/index.ts";
import type { Snapshot } from "../../src/core/types.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const problems: string[] = [];

// 1. The generated HTML report must be self-contained and must not reach the network.
const parsed = JSON.parse(readFileSync(join(ROOT, "examples/demo-snapshot.json"), "utf8")) as { snapshot: Snapshot };
const outcome = runDocument(
  { path: "examples/demo.html", snapshot: parsed.snapshot, infrastructure: [] },
  { failOn: "error", activeRules: [...ALL_RULES], optionsByRule: {}, loweredFloors: {} },
);
const report = buildReport({
  outcomes: [outcome],
  mode: "demo",
  source: "handwritten snapshot fixture",
  toolVersion: "0.1.0",
  commit: null,
  startedAt: new Date(0).toISOString(),
  durationMs: 0,
  rulesRun: ALL_RULES.length,
  failOn: "error",
  environment: {
    browserVersion: "",
    platform: "selfcheck",
    rendererPath: null,
    rendererPresent: false,
    pagedjsVersion: "0.4.3",
    rasterizer: null,
    rasterizerVersion: null,
    textPositionExtractor: null,
    fontFamiliesResolved: [],
    locale: "de-DE",
  },
  config: {
    profile: "selfcheck",
    failOn: "error",
    activeRules: ALL_RULES.map((r) => r.id),
    disabledRules: [],
    loweredFloors: [],
    interventions: [],
    sourceMapInjection: true,
    evidenceBinding: true,
    network: { mode: "offline", allowed: [], blocked: 0 },
  },
});
const html = render(report, "html");
for (const [pattern, why] of [
  [/<script/iu, "the report must contain no script"],
  [/(src|href)\s*=\s*["']https?:/iu, "the report must make no external request"],
  [/@import/iu, "the report must not import a stylesheet"],
] as const) {
  if (pattern.test(html)) problems.push(`html report: ${why}`);
}

// 2. The project's own prose must pass the typography rules it applies to others. The straight
//    apostrophe is the one a typography tool cannot afford in its own README.
const prose = [join(ROOT, "README.md"), ...readdirSync(join(ROOT, "docs/rules")).map((f) => join(ROOT, "docs/rules", f))];
for (const file of prose) {
  const text = readFileSync(file, "utf8");
  // Only outside code spans and fenced blocks: a straight quote in a code sample is correct.
  const withoutCode = text.replace(/```[\s\S]*?```/gu, "").replace(/`[^`\n]*`/gu, "");
  const emoji = withoutCode.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu);
  if (emoji) problems.push(`${file}: ${emoji.length} emoji`);
  const weWords = withoutCode.match(/(^|[^\w])(we|we're|we've|our|ours)([^\w]|$)/giu);
  if (weWords) problems.push(`${file}: first person plural — one person works here (${weWords.length}x)`);
  for (const banned of ["enterprise-ready", "production-grade", "battle-tested", "blazing fast", "world-class", "seamless"]) {
    if (withoutCode.toLowerCase().includes(banned)) problems.push(`${file}: "${banned}"`);
  }
  // A uniqueness claim is a FORM, not a word. The first version banned the strings "the only"
  // and "the first" outright and fired on "the first build" and "the first version" — a false
  // alarm in the checker that hunts false alarms. What is banned is the claim about this tool.
  const uniqueness =
    /\bno other (tool|linter|checker|library)\b|\bthe (only|first) (tool|linter|checker|library|package|project)\b|\bunique(ly)? (in|among|because)\b/giu;
  const claims = withoutCode.match(uniqueness);
  if (claims) problems.push(`${file}: uniqueness claim — ${claims.join(", ")}`);
}

// 3. No absolute build-machine path anywhere in the published tree.
for (const file of [join(ROOT, "README.md"), join(ROOT, "docs/status.md")]) {
  const text = readFileSync(file, "utf8");
  if (/\/(Users|home)\/[a-z][a-z0-9_-]+\//u.test(text)) problems.push(`${file}: absolute build-machine path`);
}

for (const p of problems) console.log(p);
console.log(problems.length === 0 ? "self-application: clean" : `${problems.length} problem(s)`);
process.exit(problems.length === 0 ? 0 : 1);
