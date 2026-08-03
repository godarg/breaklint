import type { Report } from "../core/types.ts";
import { LABELS, mandatoryFacts } from "./mandatory.ts";

const escape = (s: string) =>
  s.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");

/**
 * JUnit XML for CI systems that read it.
 *
 * The mandatory counters go in as `properties` rather than only into a summary line, because a
 * CI front-end that renders JUnit shows properties and drops free text. A format that carries
 * the honesty layer only where the reader's tool discards it has not carried it.
 */
export function renderJunit(report: Report): string {
  const f = mandatoryFacts(report);
  const failures = report.findings.length;
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  out.push(
    `<testsuites name="breaklint" tests="${report.rulesRun}" failures="${failures}" ` +
      `time="${(report.durationMs / 1000).toFixed(3)}">`,
  );
  out.push(`  <properties>`);
  for (const [key, label] of Object.entries(LABELS)) {
    out.push(`    <property name="${escape(label)}" value="${escape(String(f[key as keyof typeof f]))}"/>`);
  }
  out.push(`  </properties>`);

  for (const doc of report.documents) {
    out.push(
      `  <testsuite name="${escape(doc.path)}" tests="${Object.keys(doc.coverage).length}" ` +
        `failures="${doc.findings.length}">`,
    );
    for (const [ruleId, c] of Object.entries(doc.coverage)) {
      const ruleFindings = doc.findings.filter((x) => x.ruleId === ruleId);
      out.push(`    <testcase classname="${escape(doc.path)}" name="${escape(ruleId)}">`);
      for (const finding of ruleFindings) {
        out.push(
          `      <failure type="${escape(finding.severity)}" message="${escape(finding.message)}">` +
            `page ${finding.page}; measured ${finding.measurement.value} ${escape(finding.measurement.unit)}; ` +
            `threshold ${finding.measurement.threshold}</failure>`,
        );
      }
      // A rule that could not look is not a rule that passed. `skipped` is the only element in
      // this format that carries that difference, so it is used rather than omitted.
      if (!c.ok || (c.measured === 0 && c.candidates > 0)) {
        out.push(
          `      <skipped message="coverage ${c.coverage ?? 0} below floor ${c.floor}; ` +
            `${c.notMeasuredCount} candidate(s) not measured"/>`,
        );
      }
      out.push(`    </testcase>`);
    }
    out.push(`  </testsuite>`);
  }
  out.push(`</testsuites>`);
  return out.join("\n") + "\n";
}
