---
name: testing-and-quality-gates
description: Use whenever writing or changing HubMine code that needs tests, whenever fixing a bug, and before declaring any task, feature or fix "done". Defines which test level to use (unit, integration, e2e), how to test NestJS services, controllers, authorization, validation, the server state machine, BullMQ jobs and Docker orchestration without real Docker in unit tests, how to test concurrency and failure or retry or recovery paths, coverage expectations, regression tests, and the mandatory quality gates (lint, typecheck, tests, build, e2e).
---

# Testing & Quality Gates

## Purpose

This skill defines how HubMine proves that code works, and the bar every change has to clear before it counts as finished. Infrastructure bugs here are expensive: duplicate containers, servers stuck in a state, cross-tenant access. So the tests focus on **state transitions, concurrency, failure and authorization**, not just happy paths.

The other skills say *what* must be true. This skill says *how to prove it*:
- `secure-docker-provisioning`: spec and policy tests, gated real-Docker security assertions.
- `minecraft-server-orchestration`: transition table, idempotency, retries, reconciliation.
- `nestjs-backend-standards`: validation, ownership, error format.
- `prisma-postgres-engineering`: constraints and concurrent transitions against real PostgreSQL.

## When to use

- Any code change that adds or changes behavior.
- Any bug fix: a regression test is mandatory.
- Before saying "done", "ready", "works" or "fixed".
- Setting up test infrastructure, CI or coverage config.

## Project status

Stack in use (no CI yet):
- **Vitest everywhere** (packages, web, api, worker). Specs live next to the code as `*.spec.ts`.
- The API runs Vitest through **`unplugin-swc`**, because Nest's DI needs decorator metadata and esbuild doesn't emit it.
- **API integration tests** (`*.int-spec.ts`, `vitest.integration.config.ts`) boot the **real `AppModule`** (via `src/test/test-app.ts`, with the same `configureApp` hardening as `main.ts`) against the **docker-compose** Postgres/Redis. Each test file gets a fresh Postgres schema (`?schema=test_<random>`, `prisma migrate deploy`), dropped afterwards. No Testcontainers.
- **supertest** for HTTP; **Playwright** for web E2E (Chromium needs system libraries, installed by `scripts/setup-wsl-docker.sh`).

Root scripts (read `package.json` before running): `pnpm setup` (env + install + build packages + `infra:up` + `db:migrate`), `pnpm infra:up`, `pnpm db:migrate`, `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`. Workspace packages compile to `dist/`, so `typecheck` and `test` build them first.

## Core principles

1. **Test behavior, not implementation.** Assert outcomes (state, responses, emitted jobs, Docker calls on a fake), not private method calls.
2. **The right level for the risk.** Pure logic → unit. Anything whose correctness depends on PostgreSQL, Redis or BullMQ semantics → integration with the real thing. User journeys → E2E.
3. **Don't mock what you don't own, past the boundary.** Mock *our* ports (`ContainerRuntime`, `Clock`), not Prisma internals or the BullMQ API.
4. **Deterministic.** No real sleeps, no wall-clock time, no test-order dependence, no shared mutable state between tests.
5. **Failure paths are first-class.** Every operation is tested under errors, timeouts, retries and duplicate delivery.
6. **Gates aren't negotiable.** Red means not done. Report failures honestly, with output.

## Mandatory rules

### Test levels: when to use each

| Level | Scope | Real dependencies | Use for | Speed target |
|---|---|---|---|---|
| **Unit** | A function or class | None (fakes for ports) | State machine, spec builder, policy check, env mapper, resource limits, reconciler diff, services with faked repos, schema validation (`ZodPipe`), mappers | < 10 ms each |
| **Integration** | A module plus its infra | PostgreSQL, Redis (docker-compose, schema per test file); **fake** `ContainerRuntime` | Repositories and constraints, concurrent transitions, outbox, HTTP endpoints through Nest (`supertest`), auth and ownership, BullMQ processors on real Redis | seconds |
| **Docker contract** (gated) | `DockerodeRuntime` adapter | Real Docker daemon | The adapter really applies the security options and limits; idempotency codes (304/404/409); log demuxing | slow; run with `HUBMINE_DOCKER_TESTS=1` |
| **E2E** | The whole system | Full stack (compose) | Critical user journeys through the web UI or public API | minutes |

### What to test: backend

| Area | Must cover |
|---|---|
| Services | Business rules, plan limits, quota, correct errors for each failure branch |
| Controllers (integration) | Status codes, envelope and error format, `202` + `Location` for operations |
| **Authorization** | For **every** route with `:id`: owner → OK; another user → **404**; unauthenticated → 401. Admin paths audited |
| **Validation** | Missing fields, wrong types, out-of-range values, **unknown fields rejected (400)**, injection-like strings (`"; rm -rf /"`, `../../etc`, newlines) rejected or neutralized |
| **State transitions** | The **full** `from × to` matrix: every allowed pair succeeds, every other pair is rejected (generated from `ALLOWED_TRANSITIONS`, so it can't drift) |
| Queues | Producer: correct name, payload and `jobId = operationId`. Processor: idempotent on re-delivery, retryable versus `UnrecoverableError`, final-failure handler sets `ERROR` + `FAILED` + event |
| Provisioning | Spec built correctly per server type. Limits math. EULA requires consent |
| Failure scenarios | Docker errors, timeouts, worker crash mid-operation (simulate by running the handler from an intermediate state), Docker daemon unreachable during reconciliation |

### E2E minimum flows

Run against the composed stack, with the worker's Docker runtime faked or using a lightweight test image unless the job is the gated real-Docker E2E:

1. Register and log in (plus a failed login).
2. Create a server → appears with `CREATING`, then reaches `STOPPED` or `ONLINE`.
3. View the server details and status.
4. Start → `ONLINE`.
4b. A crash (container killed) → `CRASHED`, then auto-recovery back to `ONLINE`.
5. Stop → `STOPPED`.
6. Delete → disappears from the list.
7. Second user can't see or act on the first user's server.

### Coverage

- Coverage is a floor, not a goal. Recommended thresholds, enforced in CI once the code exists:
  - Overall `apps/api` and `apps/worker`: ≥ 80% lines and branches.
  - **100% branches** for: `state-machine.ts`, `container-policy.ts`, `container-spec.builder.ts`, `resource-limits.ts`, `env-mapper.ts`, ownership-scoped repository methods.
- Don't write meaningless tests to raise the number. Untested critical branches block the PR even if overall coverage passes.

### Regression tests for bugs

1. Reproduce the bug with a failing test **first**.
2. Fix it.
3. The test passes, and it's named after the behavior, optionally referencing the issue (`// regression: #123`).
No bug fix is complete without its regression test, unless that's technically impossible, in which case explain why in the PR.

### Quality gates

A change is **not ready** until all applicable gates pass locally (and in CI once CI exists):

```text
1. lint          pnpm lint
2. typecheck     pnpm typecheck            (tsc --noEmit across workspaces)
3. unit          pnpm test
4. integration   pnpm test:integration     (needs `pnpm infra:up`: compose Postgres + Redis)
5. build         pnpm build
6. e2e           pnpm test:e2e             (when the change touches a user flow)
7. docker        HUBMINE_DOCKER_TESTS=1 pnpm --filter <worker> test:docker   (when apps/worker/src/docker changes)
8. prisma        prisma validate + migrate on an empty DB (when the schema changes)
9. supply chain  pnpm install --frozen-lockfile; pnpm audit --prod (or osv-scanner); gitleaks (secrets);
                 Trivy on HubMine images (when Dockerfiles or dependencies change)
```

Supply-chain rules: the lockfile is committed and CI installs with `--frozen-lockfile`. High or critical advisories in production dependencies block the merge unless they're documented as not exploitable. Dockerfiles use digest-pinned base images and a non-root `USER`.

Not done if **any** of these is true:
- TypeScript has errors (including `// @ts-ignore` / `as any` added to silence them without justification).
- Any test fails or was skipped to get green.
- Lint fails, or rules were disabled inline without justification.
- The build fails.
- A new behavior has no test, or a fixed bug has no regression test.

When reporting results: state exactly which gates ran and their results. If a gate couldn't run (for example no Docker available), say so explicitly; never claim it passed.

## Architecture

```text
apps/api/
  src/**/*.spec.ts                 # unit (next to the code)
  src/**/*.int-spec.ts             # integration: real AppModule + compose Postgres/Redis
  src/test/test-app.ts             # boots the app in a fresh schema; drops it on close
apps/worker/
  src/**/*.spec.ts                 # unit (state machine, spec builder, reconciler diff…)
  test/integration/**/*.int-spec.ts  # processors + real Redis/Postgres + FakeContainerRuntime
  test/docker/**/*.docker-spec.ts  # gated real Docker contract + security assertions
  test/fakes/fake-container-runtime.ts
apps/web/
  e2e/**/*.e2e.ts                  # Playwright
packages/test-utils/               # (future) shared factories, fake clock
```

## Implementation guidelines

The rules in this section are as binding as the mandatory rules above. They describe how to implement them.

### Docker orchestration without real Docker

- The orchestration code depends on the `ContainerRuntime` port (see `secure-docker-provisioning`). Tests use an **in-memory `FakeContainerRuntime`** that models containers (exists, running, health), returns the same idempotent results as the real adapter (start on running = no-op, remove on missing = no-op, create on an existing name = conflict or reuse), and supports fault injection:

```ts
const runtime = new FakeContainerRuntime();
runtime.failNext('start', new DockerUnavailableError());   // inject one failure
runtime.setHealth(serverId, 'unhealthy');                   // drive health checks
runtime.crash(serverId, { exitCode: 137, oomKilled: true }); // simulate OOM kill
```

- Required orchestration scenarios: **create, start, stop, restart, delete, suspend, resume**, each with:
  - the happy path;
  - **duplicate delivery** (run the same job twice: same end state, one container);
  - **failure then retry** (first attempt fails, second succeeds);
  - **exhausted retries** (ends in `ERROR`, job `FAILED`, event written);
  - **timeout** (health never becomes healthy → `ERROR`);
  - **recovery** (reconciler fixes each row of the reconciliation table).
- Use fake timers or an injected `Clock` for timeouts, backoff and idle detection. Never `await sleep(30_000)`.
- The **Docker contract suite** (real daemon, gated) runs the adapter against a real container and **asserts security from `inspect`**: `Privileged === false`, `CapDrop` contains `ALL`, `SecurityOpt` includes `no-new-privileges:true`, `ReadonlyRootfs`, `Memory === MemorySwap`, `PidsLimit > 0`, non-root `User`, only `/data` mounted, no host network, only the game port published. These are **security regression tests**. Run them in CI on a runner with Docker, at least nightly and on any change under `apps/worker/src/docker/`.

### Concurrency tests (integration, real PostgreSQL)

- Two simultaneous `POST /servers/:id/start` (`Promise.all`): exactly one `202` and one `409`, exactly one active `ServerJob`, exactly one enqueued job.
- Two concurrent creates that grab ports: no duplicate port.
- Same `Idempotency-Key` twice: the same operation is returned, one job.
- Run each concurrency test several times in a loop (for example 20 iterations) to shake out races.

### Test hygiene

- Each test builds its own data (factories or builders); no reliance on seed data. Integration tests isolate by transaction rollback, truncation between tests, or a schema per worker.
- Name tests by behavior: `it('returns 404 when the server belongs to another user')`.
- One logical assertion per test; table-driven tests (`it.each`) for matrices.
- **No `.only`, no `.skip` without a linked issue, no retry-until-green.** Flaky tests are fixed or quarantined with an issue, never ignored.
- Secrets in tests are obviously fake. No real tokens or API keys in fixtures.

## Security considerations

- Authorization and validation tests are security tests. They're mandatory for every endpoint, not optional extras.
- Docker contract tests protect the isolation guarantees. A failing security assertion is a release blocker.
- Test containers and stacks must not reuse production credentials, and must not bind publicly (use `127.0.0.1`).
- `FakeContainerRuntime` (and any other test double) can't be enabled in production. If the worker can select it by env for E2E, the worker must refuse to boot with it when `NODE_ENV=production`, and a test covers that guard.
- Gated Docker tests only create and remove containers labeled for tests (for example `com.hubmine.test=true`) and clean up after themselves. They never prune globally.

## Anti-patterns

- Mocking Prisma to "test" a unique constraint or a transaction.
- Unit tests that start real Docker or need network access.
- `await new Promise(r => setTimeout(r, 5000))` to wait for a job.
- Testing only the happy path of a lifecycle operation.
- Snapshot tests of whole API responses that hide meaningful changes.
- Asserting `toHaveBeenCalled()` on internals instead of the observable outcome.
- Marking work done with "tests should pass" without running them.
- Disabling a failing test to merge.

## Examples

**Generated transition matrix:**

```ts
// Independent literal copied from the skill's transition table. It must NOT be derived from
// ALLOWED_TRANSITIONS, or the test could never catch drift between the code and the documented rules.
const EXPECTED_ALLOWED = new Set([
  'CREATING>STOPPED', 'CREATING>STARTING', 'CREATING>ERROR', 'CREATING>DELETING',
  'STARTING>ONLINE', 'STARTING>ERROR', 'STARTING>STOPPING', 'STARTING>DELETING',
  'ONLINE>STOPPING', 'ONLINE>CRASHED', 'ONLINE>DELETING',
  'CRASHED>STARTING', 'CRASHED>ERROR', 'CRASHED>STOPPED', 'CRASHED>DELETING',
  'STOPPING>STOPPED', 'STOPPING>SUSPENDED', 'STOPPING>ERROR', 'STOPPING>DELETING',
  'STOPPED>STARTING', 'STOPPED>DELETING',
  'SUSPENDED>STARTING', 'SUSPENDED>DELETING',
  'ERROR>STARTING', 'ERROR>STOPPED', 'ERROR>DELETING',
  'DELETING>DELETED', 'DELETING>ERROR',
]);
const ALL = Object.values(ServerStatus);
describe('server state machine', () => {
  it.each(ALL.flatMap((from) => ALL.map((to) => [from, to] as const)))('%s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(EXPECTED_ALLOWED.has(`${from}>${to}`));
  });
});
```

**Duplicate delivery idempotency:**

```ts
it('creates exactly one container when server.start is delivered twice', async () => {
  const { server, op } = await givenServerInStatus('STARTING');
  await processor.process(jobFor(op));
  await processor.process(jobFor(op));            // redelivery after stall
  expect(runtime.containersFor(server.id)).toHaveLength(1);
  expect(await statusOf(server.id)).toBe('ONLINE');
});
```

**Ownership:**

```ts
it('returns 404 when starting another user\'s server', async () => {
  const owner = await users.create(); const other = await users.create();
  const server = await servers.create({ userId: owner.id, status: 'STOPPED' });
  await request(app).post(`/servers/${server.id}/start`).set(authFor(other)).expect(404);
  expect(await jobsFor(server.id)).toHaveLength(0);
});
```

## Checklist

- [ ] Each new behavior has tests at the right level.
- [ ] Authorization (owner / other user / anonymous) tested for every new `:id` route.
- [ ] Validation negative cases, including unknown fields and injection-like input.
- [ ] State transition matrix asserted against an independent literal list matching the skill table.
- [ ] Lifecycle operations: happy path, duplicate delivery, retry, exhausted retries, timeout, recovery.
- [ ] Concurrency test for every "only once" invariant.
- [ ] No real Docker in unit tests. Contract tests gated and cleaning up.
- [ ] Regression test for each bug fixed.
- [ ] No `.only`, unjustified `.skip`, sleeps or real clocks.
- [ ] All applicable quality gates run and reported with real results.

## Definition of Done

- Lint, typecheck, unit, integration and build pass. E2E, Docker contract and Prisma gates pass when applicable.
- Critical modules meet their branch-coverage floor.
- Results are reported faithfully: what ran, what passed, what couldn't run and why.
