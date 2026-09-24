/**
 * docs/agent-contract.md, held against the code it describes.
 *
 * It is the documented entry point for an agent reading a report (README), and until 0.7.0 nothing
 * checked it. CHANGELOG 0.5.0 said `selfcheck:static` held its claims against the code; that script
 * scans it for emoji, first-person and marketing words only. Measured on the 0.6.0 text, it
 * recommended removing `break-inside: avoid` for the one gating rule whose advice calls that a false
 * repair, named an exit verdict (`usage-error`) and an exit-4 cause ("unmeasured RTL runs") the code
 * does not have, listed two research rules as released, and named a `finding.id` no finding carries.
 *
 * Every oracle here is the implementation: the verdict and exit enums, the rule registry and its
 * `remediation.advice`, and the JSON of a real `--demo` run in a child process. Nothing is a copy.
 */

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ENV_IDS, EXIT_CODE_BY_VERDICT, NON_APPLICABLE_ENV_IDS, RUN_VERDICTS, TOOL_CAPABILITY_ENV_IDS } from "../../src/core/enums.ts";
import { ALL_RULES } from "../../src/rules/index.ts";
import { leversIn, positiveLevers, proposes, sentencesOf } from "../tools/remediation-levers.ts";

const CLI = fileURLToPath(new URL("../../src/cli/index.ts", import.meta.url));
const TEXT = readFileSync(new URL("../../docs/agent-contract.md", import.meta.url), "utf8").replace(/\r\n/gu, "\n");
const RULE_IDS = new Set(ALL_RULES.map((rule) => rule.id));
const RULE_TOKEN = /^(layout|svg|type|artifact)\/[a-z0-9-]+$/u;

/** Runs the real CLI and returns its JSON report, whatever the exit code. */
function demoJson(args: readonly string[] = []): Record<string, unknown> {
  try {
    return JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", CLI, "--demo", "--format", "json", ...args], { encoding: "utf8", timeout: 60_000 }));
  } catch (error) {
    const e = error as { stdout?: string };
    return JSON.parse(e.stdout ?? "{}");
  }
}

function section(heading: string): string {
  const start = TEXT.indexOf(`\n${heading}\n`);
  assert.ok(start !== -1, `docs/agent-contract.md has no "${heading}"; this guard has lost its subject`);
  const next = TEXT.indexOf("\n## ", start + heading.length + 2);
  return TEXT.slice(start, next === -1 ? TEXT.length : next);
}

/** Paragraphs and list items, each joined into one line, outside fenced code. */
function blocks(text: string): string[] {
  const out: string[] = [];
  let current: string[] = [];
  const flush = () => { if (current.length) out.push(current.join(" ")); current = []; };
  for (const line of text.split("\n")) {
    if (!line.trim()) { flush(); continue; }
    if (/^\s*(\d+\.|-)\s/u.test(line) || /^\s*\|/u.test(line) || /^#/u.test(line)) flush();
    current.push(line.trim());
  }
  flush();
  return out;
}

const backticked = (text: string): string[] => [...text.matchAll(/`([^`\n]+)`/gu)].map((match) => match[1]!);

/** Resolves `finding.x.y`, `measurement.x`, `documents[].x[].y` against a real report. */
function resolves(report: Record<string, unknown>, path: string): boolean {
  const documents = report.documents as Record<string, unknown>[];
  const findings = documents.flatMap((document) => document.findings as Record<string, unknown>[]);
  const [head, ...rest] = path.replace(/\[\]/gu, ".[]").split(".");
  const roots: unknown[] = head === "documents" ? [documents]
    : head === "finding" ? findings
    : ["measurement", "stableIdentity", "remediation", "target", "evidence"].includes(head!) ? findings.map((finding) => finding[head!])
    : [];
  const walk = (value: unknown, segments: string[]): boolean => {
    if (segments.length === 0) return true;
    const [segment, ...more] = segments;
    if (segment === "[]") return Array.isArray(value) && value.some((item) => walk(item, more));
    return value !== null && typeof value === "object" && Object.hasOwn(value, segment!) && walk((value as Record<string, unknown>)[segment!], more);
  };
  return roots.some((root) => walk(root, rest.filter(Boolean)));
}

let demo: Record<string, unknown>;
before(() => {
  demo = demoJson();
});

describe("docs/agent-contract.md", () => {
  it("its exit table is the verdict enum, code for code, and says that exit 2 writes no report", () => {
    const rows = [...section("## 1. Exit Code Semantics").matchAll(/^\|\s*\*\*(\d)\*\*\s*\|\s*`([^`]+)`\s*\|(.*)$/gmu)];
    assert.deepEqual(
      rows.map((row) => [row[2], Number(row[1])]).sort(),
      RUN_VERDICTS.map((verdict) => [verdict, EXIT_CODE_BY_VERDICT[verdict]]).sort(),
      "the exit table and EXIT_CODE_BY_VERDICT disagree",
    );
    const usage = rows.find((row) => row[2] === "usage");
    assert.match(usage![3]!, /No report is written/u, "the exit-2 row must say that no report is written");
  });

  it("names the exit-4 reason a run without any decline actually gives", () => {
    const run = demoJson(["--only", "layout/widow", "--disable", "layout/widow"]);
    assert.equal(run.exitCode, 4);
    const reason = (run.documents as { exitReason: string }[])[0]!.exitReason;
    assert.ok(section("## 1. Exit Code Semantics").includes(reason), `the exit-4 explanation never names "${reason}"`);
  });

  it("gives no example in the exit section that is not an id the code carries", () => {
    const exits = section("## 1. Exit Code Semantics");
    for (const match of exits.matchAll(/\be\.g\.,?([^).]*)/gu)) {
      assert.match(match[1]!, /^(\s*(`[^`]+`|,|or|and)\s*)+$/u, `an example in the exit section is prose, not ids: "e.g.${match[1]}"`);
    }
  });

  it("names only released rule ids", () => {
    const named = backticked(TEXT).filter((token) => RULE_TOKEN.test(token));
    assert.ok(named.length >= 10, "the contract names almost no rule; this guard has lost its subject");
    assert.deepEqual(named.filter((id) => !RULE_IDS.has(id)), [], "the contract names a rule id the released registry does not have");
  });

  it("names only env/ reasons a released rule declares, and attributes each to a rule that declares it", () => {
    const declared = new Set<string>(ALL_RULES.flatMap((rule) => [...rule.declines]));
    const outOfCoverage = new Set<string>([...NON_APPLICABLE_ENV_IDS, ...TOOL_CAPABILITY_ENV_IDS]);
    let seen = 0;
    for (const sentence of blocks(TEXT).flatMap(sentencesOf)) {
      let owner: string | null = null;
      for (const token of backticked(sentence)) {
        if (RULE_IDS.has(token)) { owner = token; continue; }
        if (!/^env\/[a-z0-9-]+$/u.test(token)) continue;
        seen += 1;
        assert.ok((ENV_IDS as readonly string[]).includes(token), `${token} is not in ENV_IDS: ${sentence}`);
        assert.ok(declared.has(token), `${token} is declared by no released rule: ${sentence}`);
        if (owner) {
          const rule = ALL_RULES.find((candidate) => candidate.id === owner)!;
          assert.ok((rule.declines as readonly string[]).includes(token), `${owner} does not decline with ${token}: ${sentence}`);
        }
        if (/does not count against coverage/u.test(sentence)) assert.ok(outOfCoverage.has(token), `${token} does count against coverage: ${sentence}`);
      }
    }
    assert.ok(seen >= 3, "the contract names almost no env/ reason; this guard has lost its subject");
  });

  it("names only report fields a real --demo report carries", () => {
    const paths = backticked(TEXT).filter((token) => /^(finding|measurement|stableIdentity|remediation|documents\[\])\.[\w.[\]]+$/u.test(token));
    assert.ok(paths.length >= 8, `only ${paths.length} field paths were found; this guard has lost its subject`);
    assert.deepEqual(paths.filter((path) => !resolves(demo, path)), [], "the contract names a field the report does not carry");
  });

  it("proposes a lever only for a rule whose own advice proposes it", () => {
    let proposals = 0;
    for (const block of blocks(TEXT)) {
      const rules = backticked(block).filter((token) => RULE_IDS.has(token));
      for (const sentence of sentencesOf(block)) {
        if (!proposes(sentence)) continue;
        const levers = leversIn(sentence);
        if (levers.length === 0) continue;
        proposals += 1;
        assert.ok(rules.length > 0, `a repair lever (${levers.join(", ")}) is proposed without naming the rule it is for: ${sentence}`);
        for (const id of rules) {
          const positive = positiveLevers(ALL_RULES.find((rule) => rule.id === id)!.remediation!.advice);
          const foreign = levers.filter((lever) => !positive.has(lever));
          assert.deepEqual(foreign, [], `the contract proposes ${foreign.join(", ")} for ${id}, which its advice does not propose: ${sentence}`);
        }
      }
    }
    assert.ok(proposals >= 3, "the contract proposes almost no lever; this guard has lost its subject");
  });
});
