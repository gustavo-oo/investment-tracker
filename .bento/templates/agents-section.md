## Bento (small-prs)

- Sessions: the spec closes the roadmap (1 demonstrable deliverable + estimate; cut at ~3x the PR limit); each session has its own plan `docs/superpowers/plans/YYYY-MM-DD-<subject>-s<N>.md`, committed to trunk before the stack.
- Live stack: each task becomes a layer via `gh stack add`; after the task run `node scripts/pr-split-verify.mjs check <base> HEAD` (or `bento check`) and stop if it goes over; a fix on a lower layer = commit on that layer + a grouped `gh stack rebase --upstack`.
- Never open a PR without running `node scripts/pr-split-verify.mjs check` (or `bento check`).
- Before the check, refresh both branches involved with the remote: `git fetch origin <base> <head>` (stale refs = phantom diff).
- A diff over `.bento.yaml` blocks the PR: offer the split first.
- Chained splits are delivered with gh-stack (`gh stack init/add/push/submit`).
- Split equivalence is mandatory: `node scripts/pr-split-verify.mjs equivalence <base> <head> <layer1> ...`.
- Before finishing the branch/opening the PR, run the `self-review` gate: 2 reviewers (regression + adversarial), repro for High/Medium, and a ledger in `.superpowers/self-review/`. Nothing "residual" without an explicit decision.
- The pre-push hook is stack-aware: it validates each branch against its stack base (nearest ancestor in the same push).
- Artifacts (PR bodies, commit messages, docs, specs, plans) use the language set in `.bento.yaml` (`artifacts_language`); the default is English.

### Agents (bento)

- `flash` is the single primary (default): small steps, the full skills workflow when the task calls for it, and delegation.
- Delegate with `@explorer` (codegraph, read-only), `@verify` (independent verification/review), `@reviewer` (adversarial review), and `@browser` (web automation); the primary implements itself (no third level; `general` stays out).
- `.opencode/agents/*.md` are yours: edit `model`, `temperature`, and permissions freely; `bento update` does not overwrite them.
