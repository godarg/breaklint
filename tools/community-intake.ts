#!/usr/bin/env node
import { readFileSync } from "node:fs";

type Issue = {
  number: number;
  title: string;
  body: string | null;
  html_url?: string;
  state?: string;
  pull_request?: unknown;
  labels?: Array<string | { name?: string }>;
};

type Classification = {
  state: "complete" | "needs-info" | "sensitive-warning";
  missing: string[];
  sensitivePatterns: string[];
  route: string;
  rule: string;
};

const MANAGED_LABELS = ["intake-complete", "intake-needs-info", "intake-sensitive-warning"];
const LABELS: Record<string, { color: string; description: string }> = {
  "community-test": { color: "1d76db", description: "Open voluntary community QA submission" },
  "intake-complete": { color: "2da44e", description: "Required public-intake fields and declarations are present" },
  "intake-needs-info": { color: "d4c5f9", description: "Community intake is missing required information" },
  "intake-sensitive-warning": { color: "b60205", description: "Public submission matched a sensitive-data tripwire; do not process content" },
  "community-dashboard": { color: "5319e7", description: "Automatically maintained community QA dashboard" }
};
const COMMENT_MARKER = "<!-- breaklint-community-intake-v1 -->";
const DASHBOARD_MARKER = "<!-- breaklint-community-dashboard-v1 -->";

function labelNames(issue: Issue): string[] {
  return (issue.labels ?? []).map((label) => typeof label === "string" ? label : label.name ?? "").filter(Boolean);
}

export function sections(body: string): Map<string, string> {
  const result = new Map<string, string>();
  const matches = [...body.matchAll(/^### ([^\n]+)\n\n/gmu)];
  for (const [index, match] of matches.entries()) {
    const heading = match[1];
    if (!heading) continue;
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? body.length;
    result.set(heading.trim(), body.slice(start, end).trim());
  }
  return result;
}

export function classifyIssue(issue: Issue): Classification {
  const body = issue.body ?? "";
  const values = sections(body);
  const required = ["Test route", "Rule or area", "Observed result", "Expected human judgement", "Reproduction or public source", "Environment", "Rights, privacy and public handling", "Volunteer terms"];
  const missing = required.filter((heading) => {
    const value = values.get(heading);
    return !value || value === "_No response_";
  });
  const declarations = `${values.get("Rights, privacy and public handling") ?? ""}\n${values.get("Volunteer terms") ?? ""}`;
  if ((declarations.match(/- \[[xX]\]/gu) ?? []).length < 5) missing.push("all five public-handling and volunteer declarations");
  const sensitiveChecks: Array<[string, RegExp]> = [
    ["absolute-user-path", /(?:\/Users\/[^/\s]+\/|[A-Za-z]:\\Users\\[^\\\s]+\\)/u],
    ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
    ["github-token", /\bgh[oprsu]_[A-Za-z0-9_]{20,}\b/u],
    ["secret-assignment", /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][^"'\n]{12,}["']/iu]
  ];
  const sensitivePatterns = sensitiveChecks.filter(([, pattern]) => pattern.test(body)).map(([name]) => name);
  return {
    state: sensitivePatterns.length ? "sensitive-warning" : missing.length ? "needs-info" : "complete",
    missing: [...new Set(missing)], sensitivePatterns,
    route: values.get("Test route") ?? "unknown", rule: values.get("Rule or area") ?? "unknown"
  };
}

async function api(repo: string, token: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "breaklint-community-intake-v1", ...(init.headers ?? {}) }
  });
  if (!response.ok) throw new Error(`GitHub API ${init.method ?? "GET"} ${path}: ${response.status} ${await response.text()}`);
  if (response.status === 204) return null;
  return response.json();
}

async function ensureLabels(repo: string, token: string) {
  const existing = new Set<string>();
  for (let page = 1; ; page += 1) {
    const values = await api(repo, token, `/labels?per_page=100&page=${page}`) as Array<{ name: string }>;
    for (const value of values) existing.add(value.name);
    if (values.length < 100) break;
  }
  for (const [name, metadata] of Object.entries(LABELS)) {
    if (!existing.has(name)) await api(repo, token, "/labels", { method: "POST", body: JSON.stringify({ name, ...metadata }) });
  }
}

function commentFor(classification: Classification): string {
  const detail = classification.state === "complete"
    ? "The structured intake is complete. This is a form-completeness result, not a validation of the finding."
    : classification.state === "needs-info"
      ? `The intake still needs: ${classification.missing.join(", ")}. Please edit the issue; do not open a duplicate.`
      : `A public-data tripwire matched (${classification.sensitivePatterns.join(", ")}). Remove the material from the issue immediately. If this is a security finding, use SECURITY.md instead. Automation will not process or execute the submission.`;
  return `${COMMENT_MARKER}\nAutomated community intake: **${classification.state}**.\n\n${detail}\n\nThis check never executes submitted HTML, commands, links, patches or attachments. Community QA is not blind annotation or calibration evidence.`;
}

async function upsertComment(repo: string, token: string, issueNumber: number, body: string) {
  const comments = await api(repo, token, `/issues/${issueNumber}/comments?per_page=100`) as Array<{ id: number; body?: string }>;
  const existing = comments.find((comment) => comment.body?.includes(COMMENT_MARKER));
  if (existing) await api(repo, token, `/issues/comments/${existing.id}`, { method: "PATCH", body: JSON.stringify({ body }) });
  else await api(repo, token, `/issues/${issueNumber}/comments`, { method: "POST", body: JSON.stringify({ body }) });
}

async function applyClassification(repo: string, token: string, issue: Issue, classification: Classification) {
  const preserved = labelNames(issue).filter((name) => !MANAGED_LABELS.includes(name));
  const labels = [...new Set([...preserved, "community-test", `intake-${classification.state}`])];
  await api(repo, token, `/issues/${issue.number}/labels`, { method: "PUT", body: JSON.stringify({ labels }) });
  await upsertComment(repo, token, issue.number, commentFor(classification));
}

async function listIssues(repo: string, token: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (let page = 1; ; page += 1) {
    const values = await api(repo, token, `/issues?state=all&labels=community-test&per_page=100&page=${page}&sort=created&direction=asc`) as Issue[];
    issues.push(...values.filter((issue) => !issue.pull_request));
    if (values.length < 100) break;
  }
  return issues;
}

function dashboardBody(issues: Array<{ issue: Issue; classification: Classification }>): string {
  const count = (state: Classification["state"]) => issues.filter(({ classification }) => classification.state === state).length;
  const byRoute = new Map<string, number>();
  for (const { classification } of issues) byRoute.set(classification.route, (byRoute.get(classification.route) ?? 0) + 1);
  const lines = [
    DASHBOARD_MARKER,
    "# Community testing dashboard",
    "",
    "This issue is maintained automatically from structured public reports. Counts describe intake state, not finding validity, human agreement or calibration.",
    "",
    `- Total submissions: ${issues.length}`,
    `- Intake complete: ${count("complete")}`,
    `- Needs information: ${count("needs-info")}`,
    `- Sensitive-data warning: ${count("sensitive-warning")}`,
    "",
    "## Routes",
    ""
  ];
  if (!byRoute.size) lines.push("No submissions yet.");
  else for (const [route, total] of [...byRoute].sort(([a], [b]) => a.localeCompare(b))) lines.push(`- ${route}: ${total}`);
  lines.push("", "## Reports", "");
  for (const { issue, classification } of issues) lines.push(`- [#${issue.number} ${issue.title}](${issue.html_url}) — ${classification.state}; ${classification.rule}`);
  lines.push("", "Submitted content is untrusted data and is never executed by this workflow. All breaklint rules remain `calibrated: false`.", "");
  return lines.join("\n");
}

async function syncDashboard(repo: string, token: string) {
  await ensureLabels(repo, token);
  const issues = await listIssues(repo, token);
  const records = [];
  for (const issue of issues) {
    const classification = classifyIssue(issue);
    await applyClassification(repo, token, issue, classification);
    records.push({ issue, classification });
  }
  const allIssues = await api(repo, token, "/issues?state=open&labels=community-dashboard&per_page=10") as Issue[];
  const current = allIssues.find((issue) => !issue.pull_request && issue.body?.includes(DASHBOARD_MARKER));
  const body = dashboardBody(records);
  if (current) await api(repo, token, `/issues/${current.number}`, { method: "PATCH", body: JSON.stringify({ title: "Community testing dashboard", body }) });
  else await api(repo, token, "/issues", { method: "POST", body: JSON.stringify({ title: "Community testing dashboard", body, labels: ["community-dashboard"] }) });
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const repo = arg("repo") ?? process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo) throw new Error("missing --repo or GITHUB_REPOSITORY");
  if (process.argv.includes("--sync")) {
    if (!token) throw new Error("missing GITHUB_TOKEN for --sync");
    await syncDashboard(repo, token);
    return;
  }
  const eventPath = arg("event");
  if (!eventPath) throw new Error("missing --event");
  const event = JSON.parse(readFileSync(eventPath, "utf8")) as { issue?: Issue };
  if (!event.issue || !labelNames(event.issue).includes("community-test")) return;
  const classification = classifyIssue(event.issue);
  process.stdout.write(`${JSON.stringify(classification, null, 2)}\n`);
  if (process.argv.includes("--apply")) {
    if (!token) throw new Error("missing GITHUB_TOKEN for --apply");
    await ensureLabels(repo, token);
    await applyClassification(repo, token, event.issue, classification);
  }
}

if (process.argv[1]?.endsWith("community-intake.ts")) await main();
