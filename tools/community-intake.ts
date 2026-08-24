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

export type IntakeSection = {
  level: 3 | 4;
  heading: string;
  normalizedHeading: string;
  value: string;
};

type SectionDefinition = {
  id: string;
  heading: string;
  responseRequired: boolean;
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
const REQUIRED_DECLARATIONS = [
  "I have the right to publish every submitted byte and public source.",
  "I reviewed the submission and removed personal data, credentials, private URLs and confidential material.",
  "I permit this project to reproduce, modify and redistribute my submitted report and reproduction under the repository's MIT licence.",
  "I understand that my GitHub identity and this entire submission are public.",
  "I understand that participation is voluntary and unpaid, with no promised reward, support, response or product."
];
const SECTION_DEFINITIONS: readonly SectionDefinition[] = [
  { id: "test-route", heading: "Test route", responseRequired: true },
  { id: "rule-or-area", heading: "Rule or area", responseRequired: true },
  { id: "observed-result", heading: "Observed result", responseRequired: true },
  { id: "expected-human-judgement", heading: "Expected human judgement", responseRequired: true },
  { id: "reproduction-or-public-source", heading: "Reproduction or public source", responseRequired: true },
  { id: "relevant-json-finding", heading: "Relevant JSON finding (optional)", responseRequired: false },
  { id: "environment", heading: "Environment", responseRequired: true },
  { id: "surprising-or-useful", heading: "What was surprising or especially useful? (optional)", responseRequired: false },
  { id: "rights-privacy-public-handling", heading: "Rights, privacy and public handling", responseRequired: true },
  { id: "volunteer-terms", heading: "Volunteer terms", responseRequired: true },
];
const ROUTES = new Set(["Ten-minute smoke test", "Real-page visual judgement", "Documentation or setup review", "Adversarial or boundary test"]);
const RULES = new Set([
  "General installation or report", "svg/text-clipped", "svg/text-ink-collision", "svg/text-overflows-viewport",
  "layout/widow", "layout/orphan", "layout/unbreakable-block-too-tall", "layout/heading-at-page-bottom",
  "layout/half-empty-page", "layout/orphaned-continuation-page", "layout/hyphen-across-page", "type/spaced-hyphen",
  "type/straight-quotes", "type/short-last-line", "type/excessive-word-spacing", "artifact/local-uri"
]);

function labelNames(issue: Issue): string[] {
  return (issue.labels ?? []).map((label) => typeof label === "string" ? label : label.name ?? "").filter(Boolean);
}

function withoutDefaultIgnorables(value: string): string {
  return value.replace(/\p{Default_Ignorable_Code_Point}/gu, "");
}

function normalizedHeading(value: string): string {
  return withoutDefaultIgnorables(value.normalize("NFKC"))
    .replace(/\p{White_Space}+/gu, "")
    .toLowerCase();
}

function normalizedSensitiveText(value: string): string {
  return withoutDefaultIgnorables(value.replaceAll("\r\n", "\n").normalize("NFKC"))
    .replace(/[^\S\n]+/gu, " ");
}

function credentialCandidate(value: string | undefined): boolean {
  if (!value) return false;
  const candidate = value.trim().replace(/^["']|["']$/gu, "");
  if (candidate.length < 12 || /\s/u.test(candidate)) return false;
  if (/^(?:redacted|masked|none|null|undefined|example|sample|dummy|changeme|replace(?:[-_].*)?|your(?:[-_].*)?|<[^>]+>|\$\{[^}]+\})$/iu.test(candidate)) return false;
  return /^[A-Za-z0-9+/_=.:%-]+$/u.test(candidate);
}

function hasCredentialMatch(text: string, pattern: RegExp): boolean {
  for (const match of text.matchAll(pattern)) {
    if (credentialCandidate(match.groups?.candidate)) return true;
  }
  return false;
}

/**
 * A deliberately redacted tripwire. It returns stable category identifiers only: neither the
 * matching bytes nor a substring offset crosses into comments, logs or workflow output.
 */
export function detectSensitiveInput(body: string): string[] {
  const text = normalizedSensitiveText(body);
  const patterns = new Set<string>();
  if (/(?:\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/|[A-Za-z]:\\Users\\[^\\\s]+\\)/u.test(text)) {
    patterns.add("absolute-user-path");
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/iu.test(text)) {
    patterns.add("private-key");
  }
  if (/(?:\bgh[oprsu]_[A-Za-z0-9_]{20,}\b|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bnpm_[A-Za-z0-9]{20,}\b|\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b|\bsk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,}\b|\bAIza[0-9A-Za-z_-]{30,}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}\b|\bglpat-[A-Za-z0-9_-]{20,}\b)/iu.test(text)) {
    patterns.add("provider-token");
  }
  if (hasCredentialMatch(
    text,
    /\bauthorization\s*:\s*(?:bearer|basic)\s+(?<candidate>[^\s,;]{12,})/giu,
  )) {
    patterns.add("authorization-header");
  }
  if (hasCredentialMatch(
    text,
    /\bhttps?:\/\/[^\s/:@]+:(?<candidate>[^\s/@]{8,})@[^\s/]+/giu,
  ) || hasCredentialMatch(
    text,
    /[?&](?:api[-_ ]?key|access[-_ ]?token|auth[-_ ]?token|client[-_ ]?secret|password|x-amz-(?:credential|signature))=(?<candidate>[^&#\s]{12,})/giu,
  )) {
    patterns.add("url-credential");
  }
  const secretName = String.raw`(?:api[-_ ]?key|access[-_ ]?token|auth[-_ ]?token|client[-_ ]?secret|(?:aws[-_ ]?)?secret[-_ ]?access[-_ ]?key|(?:aws[-_ ]?)?access[-_ ]?key[-_ ]?id|private[-_ ]?key|password|passwd|credential|id[-_ ]?token|refresh[-_ ]?token)`;
  const assignment = new RegExp(
    String.raw`(?:["']?\b${secretName}\b["']?)\s*(?::|=|\bis\b)\s*(?:["'](?<quoted>[^"'\n]{12,})["']|(?<bare>[^\s,;#}\]]{12,}))`,
    "giu",
  );
  for (const match of text.matchAll(assignment)) {
    if (credentialCandidate(match.groups?.quoted ?? match.groups?.bare)) {
      patterns.add("secret-assignment");
      break;
    }
  }
  if (hasCredentialMatch(
    text,
    /\b(?:jwt|json[-_ ]?web[-_ ]?token|opaque[-_ ]?locator|opaque[-_ ]?token)\s*(?::|=|\bis\b)\s*(?<candidate>[A-Za-z0-9+/_=.:-]{20,})/giu,
  ) || hasCredentialMatch(
    text,
    /\b(?:urn|opaque):[^\s]{0,80}(?:secret|token|credential)[:/=](?<candidate>[A-Za-z0-9+/_=.:-]{12,})/giu,
  )) {
    patterns.add("opaque-credential");
  }
  return [...patterns].sort();
}

export function safeInline(value: string | undefined): string {
  return (value ?? "unknown")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 160)
    .replace(/([\\`*_[\]<>])/gu, "\\$1")
    .replaceAll("@", "＠")
    .replaceAll("://", ":⁄⁄")
    .replace(/#(?=\d)/gu, "＃") || "unknown";
}

export function sections(body: string): IntakeSection[] {
  body = body.replaceAll("\r\n", "\n");
  const result: IntakeSection[] = [];
  const matches = [...body.matchAll(/^(#{3,4})[^\S\n]+([^\n]+?)[^\S\n]*$/gmu)];
  for (const [index, match] of matches.entries()) {
    const marker = match[1];
    const heading = match[2]?.trim();
    if (!marker || !heading) continue;
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? body.length;
    result.push({
      level: marker.length as 3 | 4,
      heading,
      normalizedHeading: normalizedHeading(heading),
      value: body.slice(start, end).trim(),
    });
  }
  return result;
}

export function classifyIssue(issue: Issue): Classification {
  const body = issue.body ?? "";
  const parsed = sections(body);
  const definitions = new Map(SECTION_DEFINITIONS.map((definition) => [normalizedHeading(definition.heading), definition]));
  const grouped = new Map<string, IntakeSection[]>();
  const missing: string[] = [];
  for (const section of parsed) {
    const definition = definitions.get(section.normalizedHeading);
    if (section.level !== 3) {
      missing.push("section-heading-level-invalid");
      continue;
    }
    if (!definition) {
      missing.push("section-heading-unknown");
      continue;
    }
    const matches = grouped.get(definition.id) ?? [];
    matches.push(section);
    grouped.set(definition.id, matches);
  }
  const values = new Map<string, string>();
  for (const definition of SECTION_DEFINITIONS) {
    const matches = grouped.get(definition.id) ?? [];
    if (matches.length !== 1) {
      missing.push(`section-count-invalid:${definition.id}`);
      continue;
    }
    const section = matches[0]!;
    if (section.heading !== definition.heading) {
      missing.push(`section-heading-noncanonical:${definition.id}`);
      continue;
    }
    values.set(definition.heading, section.value);
    if (definition.responseRequired && (!section.value || section.value === "_No response_")) {
      missing.push(`section-response-missing:${definition.id}`);
    }
  }
  const declarations = `${values.get("Rights, privacy and public handling") ?? ""}\n${values.get("Volunteer terms") ?? ""}`;
  for (const declaration of REQUIRED_DECLARATIONS) {
    if (!declarations.includes(`- [x] ${declaration}`) && !declarations.includes(`- [X] ${declaration}`)) {
      missing.push(`declaration: ${declaration}`);
    }
  }
  const sensitivePatterns = [...new Set([
    ...detectSensitiveInput(issue.title),
    ...detectSensitiveInput(body),
  ])].sort();
  const route = values.get("Test route");
  const rule = values.get("Rule or area");
  if (route && !ROUTES.has(route)) missing.push("canonical Test route");
  if (rule && !RULES.has(rule)) missing.push("canonical Rule or area");
  return {
    state: sensitivePatterns.length ? "sensitive-warning" : missing.length ? "needs-info" : "complete",
    missing: [...new Set(missing)], sensitivePatterns,
    route: route && ROUTES.has(route) ? route : "unknown", rule: rule && RULES.has(rule) ? rule : "unknown"
  };
}

export function githubHeaders(token: string, hasBody: boolean): Record<string, string> {
  return {
    Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "breaklint-community-intake-v1",
    ...(hasBody ? { "Content-Type": "application/json" } : {})
  };
}

async function api(repo: string, token: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: { ...githubHeaders(token, init.body !== undefined && init.body !== null), ...(init.headers ?? {}) }
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

type IssueComment = { id: number; body?: string; user?: { login?: string; type?: string } };

export function managedComment(comments: IssueComment[]): IssueComment | undefined {
  return comments.find((comment) => comment.user?.login === "github-actions[bot]" && comment.user.type === "Bot" && comment.body?.includes(COMMENT_MARKER));
}

async function upsertComment(repo: string, token: string, issueNumber: number, body: string) {
  const comments = await api(repo, token, `/issues/${issueNumber}/comments?per_page=100`) as IssueComment[];
  const existing = managedComment(comments);
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

export function dashboardBody(issues: Array<{ issue: Issue; classification: Classification }>): string {
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
  for (const { issue, classification } of issues) {
    const url = issue.html_url?.startsWith("https://github.com/") ? issue.html_url : "#";
    const title = classification.state === "sensitive-warning"
      ? "Sensitive content withheld"
      : safeInline(issue.title);
    lines.push(`- [#${issue.number} ${title}](${url}) — ${classification.state}; ${classification.rule}`);
  }
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

export function argument(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

async function main() {
  const repo = argument(process.argv, "repo") ?? process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo) throw new Error("missing --repo or GITHUB_REPOSITORY");
  if (process.argv.includes("--sync")) {
    if (!token) throw new Error("missing GITHUB_TOKEN for --sync");
    await syncDashboard(repo, token);
    return;
  }
  const eventPath = argument(process.argv, "event");
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
