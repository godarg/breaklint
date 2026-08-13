<!-- Keep this short. The checklist is what CI will check anyway; the two questions above it are
     the ones a reviewer cannot answer for you. -->

## What this changes, and why

## How you know it works

<!-- Not "the tests pass" — which test would have FAILED before this change, and did you watch it
     fail? A gate that was never seen red is a gate whose colour means nothing. -->

---

- [ ] `npm test` and `npm run typecheck` are green
- [ ] `npm run test:mutants` is green — and if a rule changed, its mutant asserts on count, rule id
      and target, not on the threshold alone
- [ ] A new rule brings its trigger fixture, at least one clean fixture, and `docs/rules/<id>.md`
- [ ] A new or changed threshold still says `uncalibrated`, unless a proof class from
      `docs/limitations.md` is named and argued
- [ ] Documentation that states a number was checked against the code, not against another document
