---
name: conventional-commits
description: Use whenever creating, proposing, reviewing or rewording a git commit message in HubMine, and when splitting work into commits. Defines the Conventional Commits format (type(scope) description), when to use each type, HubMine's scopes, breaking-change notation, body and footer rules, the inspect-diff-first workflow, and the generic messages that must never be used. Never commit unless the user asked for a commit.
---

# Conventional Commits

## Purpose

This skill keeps HubMine's history readable, searchable and usable for changelogs and release automation. A commit message says **what changed and why**, in a fixed format, based on the **actual diff**, not on what the task was supposed to be.

## When to use

- The user asks you to commit, or to suggest or review a commit message.
- Splitting a working tree into several logical commits.
- Writing a revert or describing a breaking change.
- Reviewing PRs whose commits don't follow the format.

Don't commit on your own initiative. Committing (and pushing) happens only when the user asks. When a task ends without that request, you may *suggest* a message.

## Project status

The repository isn't yet a git repository and has no commitlint or hooks. If commitlint, husky or lefthook is added later, its config wins over this skill wherever they differ. Update this skill to match.

## Core principles

1. **The diff is the truth.** Read the staged changes before writing a single word.
2. **One logical change per commit.** A reviewer should be able to revert it on its own.
3. **The type describes the effect on the product**, not the activity you did.
4. **Short header, meaningful body.** The header says *what*; the body (when needed) says *why* and any important *how*.
5. **No noise.** Generic messages are forbidden.

## Mandatory rules

### Format

```text
<type>(<scope>)!: <description>

[optional body]

[optional footer(s)]
```

- `type`: lowercase, from the list below.
- `scope`: lowercase, from HubMine's scope list. Optional only for truly repo-wide changes.
- `!`: only for breaking changes (and add a `BREAKING CHANGE:` footer).
- `description`: **English, imperative mood** ("add", not "added" or "adds"), starts lowercase, no trailing period, the whole header ≤ 72 characters (aim for ≤ 50).
- Body: wrap at 72 characters, separated by a blank line, explains motivation and contrast with previous behavior. No narration of the editing session.
- Footers: `BREAKING CHANGE: <what and migration path>`, `Refs: #123`, `Closes: #123`, plus any attribution trailers required by the session or repository instructions.

### Types

| Type | Use when | Not when |
|---|---|---|
| `feat` | New user-visible or API-visible capability | Internal restructuring with no new behavior |
| `fix` | Corrects wrong behavior (bug, security flaw, race) | Changing behavior that worked as designed (that's `feat` or `refactor`) |
| `refactor` | Code change with **no behavior change** | Anything that changes outputs, APIs or performance characteristics on purpose |
| `perf` | Behavior unchanged but faster or leaner (measurably) | Speculative micro-optimizations without evidence |
| `test` | Adding or fixing tests only | Tests that come with a feature or fix (they go in that commit) |
| `docs` | Docs, READMEs, ADRs, comments only, `.claude/skills` content | Code changes |
| `build` | Build system, dependencies, Dockerfiles for HubMine services, package manager, tsconfig | CI pipelines |
| `ci` | CI configuration and scripts | Local build config |
| `chore` | Maintenance that fits nowhere else (repo housekeeping, tooling config like editorconfig) | As a catch-all to avoid choosing the right type |
| `revert` | Reverting a previous commit | Manually undoing part of a change (that's `fix` or `refactor`) |

Security fixes are `fix`. Mention the security impact in the body without publishing exploit details.

### HubMine scopes

| Scope | Covers |
|---|---|
| `server` | Server domain: lifecycle rules, server endpoints and services |
| `docker` | Container runtime adapter, spec builder, container security policy |
| `queue` | BullMQ queues, job contracts, producers, outbox dispatcher |
| `worker` | Worker app wiring, processors, reconciler, health monitor |
| `minecraft` | itzg env mapping, version catalog, server types, modpacks |
| `api` | Cross-cutting API concerns (filters, interceptors, envelope, config) |
| `auth` | Authentication, sessions, guards, roles |
| `db` | Prisma schema, migrations, repositories' shared helpers |
| `web` | Next.js app |
| `ui` | Shared UI components or design system |
| `world-creation` | Next.js server creation experience (`apps/web/src/features/world-creation`) |
| `shared` | `packages/shared` contracts |
| `infra` | compose files, host setup, deployment |
| `deps` | Dependency bumps (usually with `build`) |
| `skills` | `.claude/skills` content (usually with `docs`) |
| `architecture` | Architecture docs and ADRs |

If a change spans several scopes, either split it into separate commits, or use the scope of the **primary** change. Never list several scopes (`feat(api,db,web)`). Add a new scope only if it'll be reused, and add it to this table in the same change.

### Breaking changes

A change is breaking if existing clients, stored data, job payloads in flight, or operators must act. Examples: renamed or removed API fields, changed status codes, an enum value removed, a migration requiring a backfill, a job payload shape change.

```text
feat(api)!: return operations as 202 for server lifecycle actions

Lifecycle endpoints no longer block until Docker finishes. Clients
must poll the operation or subscribe to status updates.

BREAKING CHANGE: POST /servers/:id/start|stop|restart now return 202
with { data: { server, operation } } instead of 200 with the server.
```

### Forbidden messages

Never write: `update`, `updates`, `changes`, `fix`, `fix stuff`, `fixes`, `misc`, `WIP`, `wip`, `final`, `final version`, `test`, `testing`, `asdf`, `.`, `alterações`, `ajustes`, `correções`, `mudanças`, `commit`, `save`, or any header that doesn't say what changed. Also forbidden: past tense, trailing periods, emoji-only headers, ticket-number-only headers, and headers that just repeat the file name (`update servers.service.ts`).

## Architecture

The commit workflow:

```text
git status ─► git diff --staged (or git diff) ─► understand the change ─► split if needed
    ─► pick type ─► pick scope ─► write header (+ body/footer) ─► show the user ─► commit only if asked
```

## Implementation guidelines

Follow these steps every time:

1. **Inspect:** `git status`, `git diff --staged`. If nothing is staged, `git diff` and ask the user (or follow their instructions) about what to stage. Look at `git log --oneline -10` to match the existing style.
2. **Understand:** what behavior changed, and why? Read enough of the code to say it in one sentence.
3. **Check hygiene before committing:** no secrets (`.env`, keys, tokens, passwords), no build artifacts, no `node_modules`, no unrelated files, no debug leftovers. If you find a secret, stop and tell the user.
4. **Split** unrelated changes into separate commits (for example a refactor plus a fix becomes two commits). Stage specific files with `git add <paths>`. Interactive staging (`-p` / `-i`) isn't available in this environment, so split by file, or ask the user.
5. **Choose the type**, using the table. If torn between `feat` and `fix`: did it ever work as intended? If yes, `fix`.
6. **Choose the scope**, using the table.
7. **Write the header:** imperative, specific, ≤ 72 characters.
8. **Add a body** when the *why* isn't obvious, for security fixes, behavior changes, migrations, or anything a future reader might question.
9. **Commit** with a heredoc to keep the formatting:

```bash
git commit -F- <<'EOF'
fix(server): prevent duplicate container creation on concurrent start

Two simultaneous start requests could both pass the status check and
enqueue separate jobs. Status changes are now conditional updates and a
partial unique index allows only one active operation per server.

Refs: #42
EOF
```

Never use `--no-verify` to skip hooks, never `--amend` or rebase commits that have already been pushed, and never force-push, unless the user explicitly asks. If a hook fails, fix the cause and create a **new** commit attempt.

## Security considerations

- Scan the diff for secrets before every commit. A committed secret counts as leaked even if it's removed later: tell the user it needs rotating.
- Security fix messages describe the fix and impact at a high level ("prevent path traversal in server data paths"). No step-by-step exploit in public history.
- Don't put customer data, emails, IPs or tokens in commit messages.

## Anti-patterns

| Bad | Why | Good |
|---|---|---|
| `update` | Says nothing | `feat(server): add server restart endpoint` |
| `fix stuff` | Vague | `fix(docker): treat 304 on start as already running` |
| `WIP` | Unfinished work in history | Commit when it's a coherent step, with a real message |
| `alterações no backend` | Generic, not English | `refactor(api): extract ownership check into repository` |
| `feat: Added new feature for servers.` | Past tense, capitalized, period, vague, no scope | `feat(server): add idle suspension after 15 minutes` |
| `fix(server): fix bug` | Repeats the type, no information | `fix(server): return 404 for servers owned by other users` |
| `chore: lots of changes` | Mixed changes, catch-all type | Split into typed commits |
| `feat(api,db,web): servers` | Multiple scopes, no description | Separate commits per scope or the primary scope |
| `refactor(queue): increase retry attempts to 5` | Behavior change isn't a refactor | `fix(queue): retry stop jobs up to 5 times` or `feat(...)` |

## Examples

```text
feat(server): add minecraft server provisioning
fix(server): prevent duplicate container creation
refactor(queue): isolate provisioning worker
test(server): add lifecycle transition tests
docs(architecture): document docker orchestration
feat(docker): drop all capabilities for minecraft containers
fix(docker): reject symlinks when reading server.properties
perf(worker): batch container inspection in reconciler
build(deps): add dockerode to worker
ci: run docker contract tests nightly
feat(db): add one-active-operation constraint to server jobs
docs(skills): add secure docker provisioning skill
revert: feat(server): add idle suspension after 15 minutes
```

Revert body: `This reverts commit <sha>.` plus the reason.

## Checklist

- [ ] The user asked for a commit (otherwise only suggest the message).
- [ ] Diff inspected. Changes understood. Unrelated changes split.
- [ ] No secrets, artifacts or debug leftovers staged.
- [ ] Correct type from the table. Single scope from the scope table.
- [ ] Header in English, imperative, lowercase, no period, ≤ 72 characters.
- [ ] Body explains *why* when it isn't obvious. `BREAKING CHANGE:` footer when applicable.
- [ ] Not a forbidden generic message.
- [ ] Hooks not bypassed. Pushed history not rewritten.

## Definition of Done

- Each commit is one coherent, revertable change, with a message that someone reading only `git log --oneline` can understand.
- Any breaking change is marked with `!` and explained in a `BREAKING CHANGE:` footer.
- The commit was created only at the user's request, and its result (hash, or hook failure) was reported faithfully.
