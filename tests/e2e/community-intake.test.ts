import assert from "node:assert/strict";
import test from "node:test";
import { argument, classifyIssue, githubHeaders, managedComment, safeInline, sections } from "../../tools/community-intake.ts";

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
  assert.equal(sections(body).get("Rule or area"), "svg/text-clipped");
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
