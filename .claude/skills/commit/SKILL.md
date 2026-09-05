---
name: commit
description: Draft and create a git commit for this repo. Use when asked to commit, create a commit, save changes, or write a commit message. Matches this repo's Conventional Commits style (feat(scope)/fix(scope)/chore/docs/refactor/test) and its module scopes.
---

# Commit

Draft a commit message in this repo's established style, confirm it with the
user, then create the commit. This does not push, and does not touch
`docs/PLAN.md` or `docs/IMPLEMENTATION-LOG.md` — only the commit itself.

## Gather context (run in parallel)

- `git status` — see what's staged and unstaged (never use `-uall`)
- `git diff --cached` and `git diff` — see what would be committed vs. what's
  still unstaged
- `git log --format='%s' -n 20` — recent subject lines, to match tone/style

## This repo's commit style

Subjects follow **Conventional Commits**, lowercase, imperative, no trailing
period:

```
feat(users): add User entity with TypeORM and initial migration
chore: initial project setup with the adjusted filtering and swagger config
```

- **Type** — pick the one that matches the change: `feat` (new capability),
  `fix` (bug fix), `chore` (tooling/config/deps, no source behavior change),
  `refactor`, `docs`, `test`.
- **Scope** — the module or area touched, matching folder names under
  `src/modules/*` or `src/core/*` (e.g. `users`, `auth`, `config`, `health`,
  `database`, `throttler`). Omit the scope (bare `chore:`, `feat:`) for
  changes that cut across modules or are pure setup/infra, as the existing
  history already does.
- **Body** — only add one if the *why* isn't obvious from the subject and
  diff (e.g. a workaround for a specific bug, a deliberate tradeoff). Skip it
  for straightforward changes; don't restate the diff.
- If the staged changes span clearly unrelated concerns (e.g. an unrelated
  formatting pass plus a real feature), say so and suggest splitting into
  separate commits rather than writing one mixed-purpose message.

## Process

1. Run the parallel gather-context step above.
2. If nothing is staged but there are unstaged/untracked changes relevant to
   the request, stage the specific files by name (never `git add -A`/`.`) —
   confirm with the user which files if it's ambiguous which changes belong
   in this commit.
3. Draft the subject (and body, if warranted) following the style above.
4. Show the drafted message and get the user's go-ahead before committing —
   don't commit silently.
5. Create the commit via heredoc:
   ```bash
   git commit -m "$(cat <<'EOF'
   <type>(<scope>): <subject>

   Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
   EOF
   )"
   ```
6. Run `git status` after to confirm success. If a pre-commit hook fails, fix
   the underlying issue and create a **new** commit — never `--amend` past a
   failed hook, and never `--no-verify`.
7. Stop there. **Do not run `git push`** (or force-push, or touch the
   remote in any way) as part of this skill, even if the branch tracks one —
   pushing is a separate, explicit ask the user has to make on its own.
