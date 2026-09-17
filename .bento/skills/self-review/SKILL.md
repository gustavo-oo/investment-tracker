---
name: self-review
description: Internal review gate before finishing a branch/PR (or on demand) - two reviewers with complementary mandates (verify = regression; reviewer = adversarial), mandatory repro for High/Medium, cross-validation, automatic local fixes, guided decisions for Low/design, and a local ledger until the final state.
---

# self-review: internal review with 2 agents and severity-based correction

Use before `finishing-a-development-branch`/submit, or when the dev asks "review what I did". The goal is to catch what static internal reviews miss: false negatives at the edges, self-confirmation, and findings downgraded to "minor/residual".

## Actors

- **Primary agent (you)**: defines the unit, dispatches, writes the ledger, applies fixes, and decides with the dev.
- **R1 `@verify`**: regression/correction mandate: the diff fulfills the contract and does not break the existing.
- **R2 `@reviewer`**: adversarial mandate: edges, hostile inputs, platform, cross-cutting risks.

## 0. Unit and preparation

1. Define the unit: task, stack layer, or branch (default on demand: current branch). Record `base` and `head` with `git rev-parse`.
2. Check the size: `node scripts/pr-split-verify.mjs check <base> <head>` (or `bento check <base> <head>`). If it violates `.bento.yaml`, **stop**: the unit needs a split with the `small-prs` skill before review. Reviewing a giant diff is theater.
3. Create the unit directory, outside git:

```bash
slug=<unit-slug>   # e.g.: branch or layer name, with '/' -> '-'
dir=".superpowers/self-review/$slug"
mkdir -p "$dir"
printf '*\n' > "$dir/.gitignore"
```

4. Freeze the package (the reviewers' single view):

```bash
base_sha=$(git merge-base <base> <head>)
head_sha=$(git rev-parse <head>)
{
  echo "# Unit: $slug"; echo "# Base: $base_sha"; echo "# Head: $head_sha"; echo
  echo "## Commits"; git log --oneline "$base_sha..$head_sha"; echo
  echo "## Stat"; git diff --stat "$base_sha...$head_sha"; echo
  echo "## Diff"; git diff "$base_sha...$head_sha"
} > "$dir/package-$(git rev-parse --short "$base_sha")-$(git rev-parse --short "$head_sha").diff"
```

The package does NOT enter your context: pass only the path to the reviewers.

5. Open `$dir/ledger.md` with the header (unit, base/head, contract: spec/brief/PR description).

## 1. Round 1: dispatch R1 and R2 in parallel

In the same message, one `task` for `verify` (R1) and one for `reviewer` (R2), each with this contract (adapt the mandate):

> Read the package `<package path>`: it is your single view of what changed; its context is enough. If you need something outside it, name the risk before looking and say what you checked in the report. Contract: <spec/brief/description>.
> Mandate: <R1: regression/correction: the diff fulfills the contract and nothing breaks the existing> | <R2: adversarial: edges, hostile inputs, ESM/CJS, platform, symlink/worktree, snapshot/cache, legacy, interaction between files>.
> Project limits: `.bento.yaml`. Read-only: do not change the working tree, index, HEAD, or branches; you may run at most one focused test.
> For each finding: `file:line`, severity (High/Medium/Low), what is wrong, impact, and **repro** (focused test snippet that fails on behavior) when High/Medium. Without repro, classify Low.
> Severity per the Severity section of this skill (bands + anti-downgrade).
> Final format: verdict (approve | needs fixes), findings, and confidence.

The reviewers are read-only: the repro arrives as a snippet in the report; transcribe it verbatim to `$dir/repro-<id>.test.mjs`, confirm the RED, and only then dispatch cross-validation.

R1 and R2 do not see each other's report. If `verify` and `reviewer` use different `model`s, complementarity is greater.

## 2. Merge and cross-validation

- Deduplicate by `file:line` + type; a finding proposed by both is already confirmed.
- High/Medium proposed by one reviewer: dispatch **the other** to validate by running the already-materialized repro (focused test, never the whole suite) and emit `confirmed` or `disputed`.
- Divergence on existence/severity: focused round (both on the same repro). If it persists, ask the dev showing both pieces of evidence.

## 3. Ledger (source of truth)

`$dir/ledger.md`, append-only per round:

```markdown
# Self-review: <unit>
base: <sha> · head: <sha> · contract: <ref>
## Round 1 (R1=verify <model>, R2=reviewer <model>)
| id | file:line | severity | origin | evidence (repro) | validation | decision | status | commit |
|----|---------------|-----------|--------|-------------------|-----------|---------|--------|--------|
| SR-1 | lib/x.mjs:12 | High | R2 | `node --test .../repro-SR-1.test.mjs` (fails) | R1 confirmed | auto (local) | fixed | abc1234 |
```

Status: `open` -> `fixed` / `waived` / `discarded`. Nothing is deleted; a downgrade or discard records who validated it and why.

## Severity

- **High/Critical**: real bug (corruption, data loss, security, functional breakage) or confirmed regression.
- **Medium/Important**: incorrect/fragile behavior in a plausible scenario, contract error, or cross-cutting risk.
- **Low/Minor**: style, polish, docs, optimization with no proven impact.

## 4. Decision

- **High/Medium confirmed and local/unambiguous** (does not change public contract, schema/migration, dependencies, or files outside the diff) -> **auto-fix**.
- **High/Medium that changes design/contract/scope** -> `question` to the dev with 2-3 fix options.
- **Low** -> ONE batched `question` (multiple choice per item): fix now / defer (justify) / discard (validated false positive).
- Downgrading is forbidden because of "pre-existing" (if the diff touched it, it belongs to the PR), because "it was in the plan", or without evidence + validation.

## 5. Fix and re-review

- Fix with TDD: move the repro into the project test directory, watch it fail (RED), fix the minimum (GREEN), and run the full suite.
- Focused re-review of the pair: fixed items + regression, in the same format as round 1.
- The repro of a discarded finding is removed from the unit directory (the ledger keeps the record).
- Cap of **3 re-review rounds**; when exceeded, stop and present the summary with evidence to the dev.

## 6. Gate

- Exit condition: no `open` item and no `disputed` without a dev decision.
- Final summary to the dev: count by severity, what was automatic, what the dev decided, and what was discarded with validation.
- Only then proceed to `finishing-a-development-branch`/submit.

## Rules

- Never post to GitHub on your own; the ledger is local.
- Never edit vendored superpowers skills to "fix" a finding.
- If `verify`/`reviewer` do not exist as subagents (e.g. install with `--no-profile`), use generic subagents with the same mandates and read-only in the prompt.
- Never `git add -A`: scratch files in `.superpowers/self-review/` stay out of the commit.
- This gate runs when triggered (end of work or dev request); there is no automatic hook.
