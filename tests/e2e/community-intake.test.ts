import assert from "node:assert/strict";
import test from "node:test";
import { classifyIssue, sections } from "../../tools/community-intake.ts";

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

- [x] rights
- [x] reviewed
- [x] licence
- [x] public

### Volunteer terms

- [x] voluntary
`;

test("complete public issue is classified without executing untrusted text", () => {
  const body = completeBody.replace("Public fixture", "$(touch /tmp/this-must-never-run)");
  const result = classifyIssue({ number: 1, title: "fixture", body });
  assert.equal(result.state, "complete");
  assert.deepEqual(result.missing, []);
  assert.equal(sections(body).get("Rule or area"), "svg/text-clipped");
});

test("missing declaration fails closed", () => {
  const result = classifyIssue({ number: 2, title: "fixture", body: completeBody.replace("- [x] voluntary", "- [ ] voluntary") });
  assert.equal(result.state, "needs-info");
  assert.match(result.missing.join(" "), /five public-handling/u);
});

test("sensitive patterns override structural completeness", () => {
  const absoluteHomeCanary = ["", "Users", "alice", "private", "customer.html"].join("/");
  const result = classifyIssue({ number: 3, title: "fixture", body: `${completeBody}\n${absoluteHomeCanary}\n-----BEGIN PRIVATE KEY-----` });
  assert.equal(result.state, "sensitive-warning");
  assert.deepEqual(result.sensitivePatterns, ["absolute-user-path", "private-key"]);
});
