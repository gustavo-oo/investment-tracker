---
name: small-prs
description: Prevents, validates, fixes, and reviews oversized PRs in the opencode (superpowers) workflow. Use when planning (session roadmap + stack layers), when executing plans (live stack - gh stack add per task + check per layer; violation = stop), before opening a PR (pr-split-verify), when a standalone diff exceeds the .bento.yaml limits (chained split via gh-stack), and for independent per-layer review (clean subagents).
---

# small-prs: prevention, validation, correction, and review of oversized PRs

## Mode 1: Prevention (sessions, roadmap, and plan)

### Sessions (roadmap in the spec)

When brainstorming/spec'ing, close a session roadmap before any detailed plan:

| # | session | demonstrable deliverable | estimated layers | est. lines/files | depends on |
| - | ------ | ----------------------- | ----------------- | -------------------- | ---------- |

- 1 demonstrable deliverable per session; if it cannot be named, it is not a session.
- Total session estimate > ~3x the PR limit (default 400 -> ~1200 lines) -> split the session in the roadmap itself.
- Dependent sessions only start after the previous ones delivered (merge); declare the order.
- Progressive planning: the current session plan is detailed in `docs/superpowers/plans/YYYY-MM-DD-<subject>-s<N>.md`; future sessions get their own plan when they start.
- Spec/roadmap + session plan are committed to trunk before the stack (protected trunk -> docs in the first layer).

### Session plan (stack)

Each task in the plan is a layer of a gh-stack stack; declare the table:

| layer | branch | base | focus/planned files | acceptance | PR title | commit message |
| ------ | ------ | ---- | ----------------------- | ------ | ------------ | ------------------ |

- Branch pattern `split/<slug>/<nn>-<name>`; 1 acceptance criterion per layer.
- Tests travel with the code they validate; refactor separate from feature; migration together with the code it serves.
- Estimate files/lines per layer: a layer whose estimate already exceeds the limit is split **before** execution.
- Default limit: <=400 diff lines and <=10 files per PR (see .bento.yaml).
- Declare dependencies and delivery order between layers.

## Mode 1.5: Live-stack execution

Session setup: check the trunk (`git remote set-head origin <trunk>`; a wrong origin/HEAD makes the stack target the wrong branch) and run `gh stack init <branch1>`.

Per task, in this order:

1. `gh stack add <branchN>` (creates the layer on top and checks it out; no commit).
2. Implement/test/commit on the layer (final message = PR title; multiple commits are ok: no interactive squash).
3. Run `node scripts/pr-split-verify.mjs check <baseN> HEAD` (or `bento check <baseN>`); base = the previous layer, trunk for the first.
4. Checkpoint: **full** test suite (not just the task's) + a short self-review of the layer diff.
5. **Violated -> STOP**: show the table (layer, lines, files, limit) and wait for a decision (subdivide the task, change scope, or override for docs). Do not start the next task.
6. Ok -> record the budget (lines/files vs limit) in the task report and, in the subagent-driven-development flow, in the ledger `.superpowers/sdd/progress.md`.

**Fix on a lower layer (policy A):** the layer freezes once it passes the checkpoint; new commits on it only for fixes. Fix on layer K: navigate to K (`gh stack bottom`/`down`), commit, **group all pending fixes** and run `gh stack rebase --upstack` ONCE (rerere already on). Rebase with a hard conflict -> `gh stack rebase --abort` and **stop and ask**. After the rebase: re-run `check` on the affected layers, the suite on top, and verify by content (`git show <top>:<file>` / `git merge-base --is-ancestor`), never by hash: rebase changes hashes.

End of session: Mode 4 (per-layer review) -> `gh stack submit --auto --open` -> `gh pr edit` per PR -> merge via `finishing-a-development-branch` (user gate).

## Mode 2: Validation (before opening a PR)

Before opening any PR (superpowers:finishing-a-development-branch):

1. Make sure BOTH branches involved (base and head) are up to date with the remote: `git fetch origin <base> <head>`. Stale local refs produce phantom diffs (commits from other merged PRs show up as changes in your PR).
2. Run `node scripts/pr-split-verify.mjs check` (or `bento check`).
3. If exit 0: proceed with gh-stack (`gh stack push`, `gh stack submit`; alias `gs` available via `gh stack alias`, optional).
4. If exit != 0 (OVERSIZED PR): do NOT open the PR. Present the report and offer the split (Mode 3).

## Mode 3: Correction (retroactive split)

Only run after explicit user approval:

1. Create a safeguard branch: `git branch backup/<current-branch>`.
2. **Before grouping, ask about the large SINGLE-file policy** (e.g. a 795-line doc): split the content into parts or leave it untouched even above the limit? (User default: docs untouched.) Never assume.
3. Analyze the diff (files and dependencies/imports) and group into coherent layers: same module, refactor != feature, CODEOWNERS if present. Ambiguous file -> ask the user. **GLOBAL invariant tests** (that validate several files, e.g. "no component embeds cost"): they go with the LAST group that satisfies the invariant (or with all files it validates), never with the first. Large single file allowed -> its own layer with the whole file.
4. Present the split plan (table: layer, files, dependencies) and wait for approval.
5. Execute: `gh stack init <layer1> <layer2> ...` (COMPLETE list in order; it adopts existing branches; do NOT use `gh stack add` for branches created before the init); on each layer apply `git diff <base>..<source> -- <paths> | git apply` and commit (1 clean commit per layer). **`git add <group files>`: never `git add -A`** (it can swallow scratch/validation artifacts). Before starting, make sure the trunk is correct: `git remote set-head origin <trunk>` (e.g. main); a wrong origin/HEAD makes the whole stack target the wrong branch.
6. If layer B uses a symbol renamed in A, include a backward-compatible shim/alias in A.
7. Verify: `node scripts/pr-split-verify.mjs equivalence <base> <head> <layer1> ...` must exit 0. If there was an allowed content transformation (split file), the tree equivalence will report DIVERGENT only on those paths: confirm they are the only ones, verify content preservation, and treat it as approved. **Run equivalence/check from ANY checkout that has the shim** (e.g. the working branch); layers created from `<base>` do not contain `scripts/` or `.bento/`; the refs resolve from any checkout.
8. Run lint, build, tests, **and `check` per layer**; stop and report if it fails. (`check` catches silent growth: fixes can exceed the ceiling.)
9. Layer naming: `split/<feature-slug>/<nn>-<short-semantic-name>` (e.g. `split/rls-sensitive-columns/01-foundation`, `02-hook-variations`).
10. Commit per layer: message = PR title, conventional and descriptive (e.g. `feat(rls): restrict sensitive columns - migration and utils`).
11. **Fixes during Mode 4 on layer N: cascading rebase of layers N+1..top onto the fixed layer** (a local fix does not propagate automatically; without this the mergeable branch loses the fix). Verify by CONTENT at the top of the chain (rebase changes hashes: `git show <top>:<file>`; do not trust old hashes).
12. Delivery: `gh stack submit --auto --open` (not draft; confirm in `--help`). Then, for EACH stack PR: `gh pr edit <n> --title "<title>" --body "<description>"` with a body containing: what it does, why, and the review focus (key files/risks). Orphan PRs from previous iterations (deleted/renamed branch): close them with a comment pointing to the replacement.
13. If you are not the author of the original PR, credit the author on the new PRs. Never force-push the original branch before final approval.

## Mode 4: Independent per-layer review (gate before submit)

Integrates with superpowers: it is the review phase of `subagent-driven-development`/`requesting-code-review` applied to the stack. Reuse the existing contracts (do not duplicate): `task-reviewer-prompt.md` (subagent-driven-development) for per-layer review; the final stack review is the `self-review` skill (2 reviewers + cross-validation + repro). Mode 3 stops at user approval, but the natural sequence is: Mode 3 steps 7-8 (equivalence + checks) -> **Mode 4** -> submit.

For EACH stack layer, BEFORE `gh stack submit`:

1. Per-layer worktree setup (reviewers are read-only, parallel): `git worktree add <path-wt-N> <layerN>` + `ln -s <clone>/node_modules <path-wt-N>/node_modules` (worktrees do not share node_modules).
2. Generate the layer review package (layer diff against its base, with context) and save it to a file: OUTSIDE the repo (e.g. temp dir).
3. Dispatch a CLEAN reviewer subagent (zero session context: no split history) with:
   - the diff file (single source of what changed),
   - the `.bento.yaml` limits,
   - the PR title/description as the contract,
   - the layer NAMED worktree (absolute path),
   - **the baseline of pre-existing lint per file** (e.g. "base had 5 no-explicit-any in X.ts: only the NEW ones are defects"), to avoid false positives from files touched by earlier layers,
   - the instruction to run the layer tests AND the layer `bento check`.
4. The reviewer emits TWO verdicts (task-reviewer contract): **spec compliance** ✅/❌ and **quality** Approved/Rejected, with findings by severity Critical/Important/Minor.
5. Critical/Important -> dispatch a CLEAN fix subagent -> re-review (same subagent-driven-development cycle: the fixer runs the coverage tests and reports command + output). **SINGLE report path** for fixer and reviewer (defined in the dispatch: e.g. `<temp-dir>/mode4/layerN-report.md`) so they never lose each other.
6. Minor -> record it in the self-review unit ledger (`.superpowers/self-review/<stack-slug>/ledger.md`); the final gate triages the Low (Minor) items with the dev.
7. **GATE: a layer without an approved review does NOT enter the submit.**

After all layers, run the `self-review` skill at the top of the chain (unit = stack) and, beyond the review, **verify the topology**: for each approved fix, confirm by content (not by hash: rebases change hashes) that it is an ANCESTOR at the top of the chain (`git merge-base --is-ancestor <fix> <top>` or `git show <top>:<file>`). After that, proceed to `finishing-a-development-branch` (cascading merge via `gh stack merge`).
