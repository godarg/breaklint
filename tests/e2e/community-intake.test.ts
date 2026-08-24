import assert from "node:assert/strict";
import test from "node:test";
import {
  argument, classifyIssue, detectSensitiveInput, githubHeaders, managedComment, safeInline, sections,
} from "../../tools/community-intake.ts";

const completeBody = `### Test route

Real-page visual judgement

### Rule or area

svg/text-clipped

### Observed result

The tool fired and the page looks fine

### Expected human judgement

The glyph remains fully readable inside its intended visible boundary.

### Reproduction or public source

<svg><text>Public fixture</text></svg>

### Relevant JSON finding (optional)

_No response_

### Environment

breaklint 0.2.0; Node 22.13.0; macOS; Chrome 140

### What was surprising or especially useful? (optional)

_No response_

### Rights, privacy and public handling

- [x] I have the right to publish every submitted byte and public source.
- [x] I reviewed the submission and removed personal data, credentials, private URLs and confidential material.
- [x] I permit this project to reproduce, modify and redistribute my submitted report and reproduction under the repository's MIT licence.
- [x] I understand that my GitHub identity and this entire submission are public.

### Volunteer terms

- [x] I understand that participation is voluntary and unpaid, with no promised reward, support, response or product.
`;

test("complete public issue is classified without executing untrusted text", () => {
  const body = completeBody.replace("Public fixture", "$(touch /tmp/this-must-never-run)");
  const result = classifyIssue({ number: 1, title: "fixture", body });
  assert.equal(result.state, "complete");
  assert.deepEqual(result.missing, []);
  assert.equal(sections(body).find((section) => section.heading === "Rule or area")?.value, "svg/text-clipped");
});

test("CRLF issue bodies retain all headings and declarations", () => {
  const result = classifyIssue({ number: 4, title: "fixture", body: completeBody.replaceAll("\n", "\r\n") });
  assert.equal(result.state, "complete");
  assert.deepEqual(result.missing, []);
});

test("CLI flags cannot be consumed as missing argument values", () => {
  assert.equal(argument(["node", "tool", "--event", "--repo", "godarg/breaklint"], "event"), undefined);
  assert.equal(argument(["node", "tool", "--repo", "godarg/breaklint"], "repo"), "godarg/breaklint");
});

test("GitHub writes declare JSON while reads do not invent a content type", () => {
  assert.equal(githubHeaders("redacted", true)["Content-Type"], "application/json");
  assert.equal(githubHeaders("redacted", false)["Content-Type"], undefined);
});

test("untrusted dashboard text cannot create Markdown structure or control lines", () => {
  assert.equal(safeInline("route\n\n- [link](https://example.invalid)"), "route - \\[link\\](https:⁄⁄example.invalid)");
  assert.equal(safeInline("@reviewer #123"), "＠reviewer ＃123");
  assert.equal(safeInline("\u0000\u0007"), "unknown");
  assert.ok(safeInline("x".repeat(300)).length <= 160);
});

test("edited route and rule values must remain in the issue-form allowlists", () => {
  const result = classifyIssue({
    number: 6, title: "fixture",
    body: completeBody.replace("Real-page visual judgement", "@someone https://example.invalid").replace("svg/text-clipped", "#123")
  });
  assert.equal(result.state, "needs-info");
  assert.equal(result.route, "unknown");
  assert.equal(result.rule, "unknown");
  assert.match(result.missing.join(" "), /canonical Test route/u);
  assert.match(result.missing.join(" "), /canonical Rule or area/u);
});

test("five arbitrary checkboxes cannot substitute the five governed declarations", () => {
  const forged = completeBody
    .replace(/### Rights, privacy and public handling[\s\S]*?### Volunteer terms/u,
      "### Rights, privacy and public handling\n\n- [x] a\n- [x] b\n- [x] c\n- [x] d\n\n### Volunteer terms")
    .replace("- [x] I understand that participation is voluntary and unpaid, with no promised reward, support, response or product.", "- [x] e");
  const result = classifyIssue({ number: 5, title: "fixture", body: forged });
  assert.equal(result.state, "needs-info");
  assert.equal(result.missing.filter((value) => value.startsWith("declaration:")).length, 5);
});

test("a reporter cannot impersonate the managed workflow comment marker", () => {
  const comments = [
    { id: 1, body: "<!-- breaklint-community-intake-v1 -->", user: { login: "reporter", type: "User" } },
    { id: 2, body: "<!-- breaklint-community-intake-v1 -->", user: { login: "github-actions[bot]", type: "Bot" } }
  ];
  assert.equal(managedComment(comments)?.id, 2);
  assert.equal(managedComment(comments.slice(0, 1)), undefined);
});

test("missing declaration fails closed", () => {
  const result = classifyIssue({ number: 2, title: "fixture", body: completeBody.replace("- [x] I understand that participation", "- [ ] I understand that participation") });
  assert.equal(result.state, "needs-info");
  assert.match(result.missing.join(" "), /participation is voluntary/u);
});

test("sensitive patterns override structural completeness", () => {
  const absoluteHomeCanary = ["", "Users", "alice", "private", "customer.html"].join("/");
  const result = classifyIssue({ number: 3, title: "fixture", body: `${completeBody}\n${absoluteHomeCanary}\n-----BEGIN PRIVATE KEY-----` });
  assert.equal(result.state, "sensitive-warning");
  assert.deepEqual(result.sensitivePatterns, ["absolute-user-path", "private-key"]);
});

test("every governed section occurs exactly once and optional headings are structural", () => {
  const withoutOptionalHeading = completeBody.replace(
    /### What was surprising or especially useful\? \(optional\)\n\n_No response_\n\n/u,
    "",
  );
  const result = classifyIssue({ number: 7, title: "fixture", body: withoutOptionalHeading });
  assert.equal(result.state, "needs-info");
  assert.ok(result.missing.includes("section-count-invalid:surprising-or-useful"));
});

test("duplicate and semantically equivalent governed headings fail closed without last-wins values", () => {
  const duplicateHeadings = [
    "Rule or area",
    "RULE OR AREA",
    "Rule   or area",
    "Rule\u00a0or\u00a0area",
    "Rule\u200bor area",
    "Ｒｕｌｅ　ｏｒ　ａｒｅａ",
  ];
  for (const heading of duplicateHeadings) {
    const body = completeBody.replace(
      "### Observed result",
      `### ${heading}\n\nlayout/widow\n\n### Observed result`,
    );
    const result = classifyIssue({ number: 8, title: "fixture", body });
    assert.equal(result.state, "needs-info", heading);
    assert.ok(result.missing.includes("section-count-invalid:rule-or-area"), heading);
    assert.equal(result.rule, "unknown", heading);
    assert.ok(result.missing.every((code) => !code.includes(heading)), heading);
  }
});

test("empty-first and contradictory duplicate values are rejected independently of position", () => {
  const bodies = [
    completeBody.replace(
      "### Rule or area\n\nsvg/text-clipped",
      "### Rule or area\n\n\n\n### Rule or area\n\nlayout/widow",
    ),
    completeBody.replace(
      "### Observed result",
      "### Rule or area\n\nnot/a-rule\n\n### Observed result",
    ),
    completeBody.replace(
      "### Observed result\n\nThe tool fired and the page looks fine",
      "### Observed result\n\n\n\n### Observed result\n\nEverything worked; I am reporting an informative boundary case",
    ),
  ];
  for (const body of bodies) {
    const result = classifyIssue({ number: 9, title: "fixture", body });
    assert.equal(result.state, "needs-info");
    assert.ok(result.missing.some((code) => code.startsWith("section-count-invalid:")));
  }
});

test("unknown H3 sections and H4 lookalikes fail closed with payload-free codes", () => {
  const unknownHeading = "Custodian-selected outcome";
  const unknown = classifyIssue({
    number: 10,
    title: "fixture",
    body: `${completeBody}\n### ${unknownHeading}\n\npass\n`,
  });
  assert.equal(unknown.state, "needs-info");
  assert.ok(unknown.missing.includes("section-heading-unknown"));
  assert.ok(unknown.missing.every((code) => !code.includes(unknownHeading)));

  const h4 = classifyIssue({
    number: 11,
    title: "fixture",
    body: completeBody.replace(
      "### Environment",
      "#### Rule or area\n\nlayout/widow\n\n### Environment",
    ),
  });
  assert.equal(h4.state, "needs-info");
  assert.ok(h4.missing.includes("section-heading-level-invalid"));
});

test("a lone non-canonical governed heading is rejected instead of silently repaired", () => {
  const body = completeBody.replace("### Rule or area", "### Ｒｕｌｅ　ｏｒ　ａｒｅａ");
  const result = classifyIssue({ number: 12, title: "fixture", body });
  assert.equal(result.state, "needs-info");
  assert.ok(result.missing.includes("section-heading-noncanonical:rule-or-area"));
  assert.equal(result.rule, "unknown");
});

function syntheticCredential(length = 32): string {
  return "Ab3_".repeat(Math.ceil(length / 4)).slice(0, length);
}

function syntheticAlphanumeric(length = 32): string {
  return "Ab3".repeat(Math.ceil(length / 3)).slice(0, length);
}

test("sensitive-input assignments cover quoted and unquoted public-intake formats", () => {
  const value = syntheticCredential(40);
  const cases: Array<[string, string]> = [
    ["dotenv", `AWS_SECRET_ACCESS_KEY=${value}`],
    ["yaml", `client_secret: ${value}`],
    ["json", JSON.stringify({ client_secret: value })],
    ["shell", `export ACCESS_TOKEN=${value}`],
    ["markdown", `\`\`\`text\naccess-token=${value}\n\`\`\``],
    ["freestanding quoted", `api_key="${value}"`],
    ["free text", `password is ${value}`],
    ["unicode separators", `API\u200b_KEY\u00a0＝\u00a0${value}`],
  ];
  for (const [name, payload] of cases) {
    assert.ok(detectSensitiveInput(payload).includes("secret-assignment"), name);
  }
});

test("known provider prefixes are detected without embedding complete canaries in source", () => {
  const providers: Array<[string, string]> = [
    ["github", ["gh", "p_", syntheticCredential(32)].join("")],
    ["aws", [["AK", "IA"].join(""), "A1B2C3D4E5F6G7H8"].join("")],
    ["npm", ["np", "m_", syntheticAlphanumeric(32)].join("")],
    ["stripe", ["sk_", "live_", syntheticAlphanumeric(28)].join("")],
    ["openai", ["sk-", "proj-", syntheticCredential(28)].join("")],
    ["anthropic", ["sk-", "ant-", "api03-", syntheticCredential(28)].join("")],
    ["google", [["AI", "za"].join(""), syntheticCredential(36)].join("")],
    ["slack", [["xo", "xb-"].join(""), "123456789012-123456789012-", syntheticCredential(24)].join("")],
    ["gitlab", [["gl", "pat-"].join(""), syntheticCredential(28)].join("")],
  ];
  for (const [name, payload] of providers) {
    assert.ok(detectSensitiveInput(payload).includes("provider-token"), name);
  }
});

test("authorization, URL and contextual opaque credentials are detected", () => {
  const value = syntheticCredential(36);
  const jwt = [syntheticCredential(24), syntheticCredential(24), syntheticCredential(24)].join(".");
  const basic = Buffer.from(`fixture:${value}`, "utf8").toString("base64");
  const cases: Array<[string, string, string]> = [
    ["bearer", `authorization: bEaReR ${jwt}`, "authorization-header"],
    ["basic", `Authorization: Basic ${basic}`, "authorization-header"],
    ["userinfo", `https://fixture:${value}@example.invalid/path`, "url-credential"],
    ["query", `https://example.invalid/path?access_token=${value}`, "url-credential"],
    ["jwt context", `jwt: ${jwt}`, "opaque-credential"],
    ["base64 context", `opaque_token=${basic}`, "opaque-credential"],
    ["opaque locator", `urn:fixture:credential:${value}`, "opaque-credential"],
  ];
  for (const [name, payload, category] of cases) {
    assert.ok(detectSensitiveInput(payload).includes(category), name);
  }
});

test("private-key headers are caught while benign examples stay inside the false-positive budget", () => {
  const privateKeyHeader = ["-----BEGIN", "PRIVATE", "KEY-----"].join(" ");
  assert.ok(detectSensitiveInput(privateKeyHeader).includes("private-key"));
  for (const benign of [
    'api_key="YOUR_API_KEY_HERE"',
    'password: "replace-with-a-random-value"',
    "The password must contain at least twelve characters.",
    syntheticCredential(64),
    [syntheticCredential(24), syntheticCredential(24), syntheticCredential(24)].join("."),
    "sha256:" + "a".repeat(64),
  ]) {
    assert.deepEqual(detectSensitiveInput(benign), [], benign.slice(0, 24));
  }
});

test("sensitive classifications expose stable categories and never echo matched bytes", () => {
  const value = syntheticCredential(37);
  const result = classifyIssue({ number: 13, title: "fixture", body: `${completeBody}\naccess_token=${value}` });
  assert.equal(result.state, "sensitive-warning");
  assert.ok(result.sensitivePatterns.includes("secret-assignment"));
  assert.equal(JSON.stringify(result).includes(value), false);
  assert.ok(result.sensitivePatterns.every((category) => /^[a-z-]+$/u.test(category)));
});
