---
name: nestjs-backend-standards
description: Use whenever writing, reviewing or changing HubMine's NestJS backend (apps/api; the worker is a plain Node process and only shares the config, database and queue packages). This covers modules, controllers, services, repositories, DTOs and validation, guards, interceptors, pipes, exception filters, error and response format, REST conventions, pagination, authentication, authorization and ownership checks, rate limiting, CORS, security headers, logging, configuration and dependency injection, and the 202-Accepted pattern for long-running operations. Database specifics are in prisma-postgres-engineering, lifecycle and queue internals in minecraft-server-orchestration.
---

# NestJS Backend Standards

## Purpose

These are the conventions every HubMine backend change follows, so the API stays secure by default, predictable for the Next.js frontend, and easy to test. The key rule: **a user can only see or change resources they own**, and **long operations never block an HTTP request**.

Dependencies:
- `prisma-postgres-engineering`: repositories, transactions, constraints, the outbox.
- `minecraft-server-orchestration`: what happens after the API enqueues an operation.
- `testing-and-quality-gates`: how controllers, guards and services are tested.

## When to use

- Creating or changing any NestJS module, controller, service, repository, DTO, guard, interceptor, pipe or filter.
- Adding an endpoint, changing a response shape, or adding pagination, filtering or sorting.
- Touching authentication, authorization, sessions, rate limiting, CORS or headers.
- Adding configuration or environment variables.
- Reviewing backend PRs.

## Project status

`apps/api` exists: **NestJS 12, ESM** (`"type": "module"`, `module: nodenext`, relative imports end in `.js`), compiled with `tsc` and run with `node --watch` in dev. Installed and in use: `@nestjs/jwt`, `@nestjs/throttler`, `nestjs-pino`, `helmet`, `cookie-parser`, `argon2`, `ioredis`, `zod`. **Not used:** `class-validator`/`class-transformer` and `@nestjs/config` (see Validation and Configuration). Implemented: config, database and Redis modules, global exception filter, `ZodPipe`, auth (register/login/refresh/logout/me), audit service, `/health/live` and `/health/ready`. Not yet: servers, operations, catalog, SSE. Check `package.json` before importing anything new and say so in the PR. Nest 12 APIs are newer than most references: read the installed types/docs before using an unfamiliar API.

## Core principles

1. **Thin controllers, rich services, dumb repositories.** HTTP concerns, business rules and persistence stay separate.
2. **Deny by default.** Every route is authenticated unless it's marked `@Public()`. Every resource query is scoped to its owner.
3. **Never trust input.** Params, query, body, headers, cookies and job payloads are validated and typed before use.
4. **Explicit output.** Responses go through mappers to the shared response contracts, never raw Prisma models.
5. **Async for slow work.** Anything that touches Docker or takes more than about 1 s is a queued operation that returns `202`.
6. **One way to do each thing.** One error format, one response envelope, one pagination style, one config access path.

## Mandatory rules

### Validation

Input is validated with the **shared zod contracts** from `@hubmine/shared`, through `ZodPipe` (`src/common/validation/zod.pipe.ts`). The web client validates with the very same schemas, so there's one source of truth for every rule. `class-validator` DTOs are **not** used.

```ts
@Post()
@HttpCode(HttpStatus.ACCEPTED)
create(
  @CurrentUser() user: AuthenticatedUser,
  @Body(new ZodPipe(createServerRequestSchema)) body: CreateServerRequest,
  @Headers('idempotency-key', IdempotencyKeyPipe) idempotencyKey: string | undefined,
) { … }
```

- `ZodPipe` applies `.strict()`: **unknown keys are rejected with 400** (mass-assignment protection), never silently dropped.
- Failures become `400 VALIDATION_FAILED` with `details: [{ field, code }]`. Schemas use **error codes as messages** (`'NAME_TOO_SHORT'`), so clients map them to copy. Details never include the submitted value.
- Every body and query gets a schema. No `@Body() body: any`, no untyped `@Query()`. Query numbers use `z.coerce.number().int().min().max()`.
- Strings always have length bounds and a format. Arrays have `.max()`. Enums come from the shared constants. Resource bounds come from `RESOURCE_LIMITS`.
- Route IDs use `new ParseUUIDPipe()`. It accepts any UUID version (the schema generates `uuid(7)`).
- Headers you rely on are validated: `Idempotency-Key` through an `IdempotencyKeyPipe` (`/^[A-Za-z0-9_-]{8,64}$/`), `X-Request-Id` in the logger's `genReqId` (same pattern; otherwise a new id is minted).
- The JSON body limit is 100 KB (`app.useBodyParser('json', { limit: '100kb' })`). Uploads (mods, worlds) are a separate design with streaming, size limits, type checks and scanning, and must be designed before they're implemented.
- The schema checks shape. The service checks meaning (version exists in the catalog, memory within plan, quota not exceeded).

### Authentication and authorization

- Global `JwtAuthGuard` registered with `APP_GUARD`. Routes opt out explicitly with `@Public()`.
- Implemented strategy (`src/auth/`):
  - Passwords: **argon2id** (19 MiB, t=2, p=1). Login against an unknown email still runs a verify against a dummy hash, so timing doesn't reveal registered emails; wrong email and wrong password return the same `401 INVALID_CREDENTIALS`.
  - Access token: **HS256 JWT**, `iss=hubmine-api`, `aud=hubmine-web`, default 15 min (`JWT_ACCESS_TTL_SECONDS`), sent as `Authorization: Bearer`. The web keeps it **in memory only**.
  - Refresh token: opaque 32 random bytes; only its **SHA-256** is stored (`RefreshToken`). Sent only as cookie **`hm_rt`, `HttpOnly`, `SameSite=Strict`, `Path=/auth`**, `Secure` per `COOKIE_SECURE`.
  - Rotation on every `/auth/refresh`, atomic (`updateMany where revokedAt IS NULL`). **Reuse detection:** a rotated token presented again within 15 s is a benign race (two tabs) → `401` only; later reuse → revoke the whole token family and audit `session.reuse_detected`.
  - Cookie-authenticated routes (`/auth/refresh`, `/auth/logout`) also require `Origin` to equal `WEB_ORIGIN` (`403 FORBIDDEN_ORIGIN`).
  - Rate limits: register 5/min, login 10/min, refresh 30/min per client IP; global default 120/min.
  - Audit (`AuditLog`): `user.registered`, `user.login`, `user.login_failed`, `user.logout`, `session.reuse_detected`.
- `@CurrentUser()` provides the authenticated user ID. **Never** read `userId` from the body, query or params for ownership.
- **Access is part of the query, through memberships.** `ServerMember` (roles `OWNER`, `ADMIN`, `MANAGER`, `MODERATOR`, `VIEWER`) is the single authorization path; the owner also has an `OWNER` membership, so sharing needs no special case. No membership (or an insufficient role) → **404**, never 403, so ids can't be probed.

```ts
// repository
findAccessible(userId: string, id: string, roles: ServerRole[] = ALL_ROLES) {
  return this.prisma.server.findFirst({
    where: { id, deletedAt: null, members: { some: { userId, role: { in: roles } } } },
  });
}
// service
const server = await this.repo.findAccessible(user.id, id, ['OWNER', 'ADMIN', 'MANAGER']);
if (!server) throw new ServerNotFoundError();   // 404, even if it exists for another user
```

  Looking up by ID and then comparing `server.userId !== user.id` is acceptable only when you can't avoid it. Scoping the query is preferred, because a forgotten comparison can't leak data. Writes are scoped the same way (`updateMany({ where: { id, members: { some: { userId, role: { in: roles } } }, status: { in: … } } })`).
- Admin and support access uses a role guard plus an audit event. It never bypasses ownership silently.
- Quotas (servers per user, total memory) are checked in the service inside the same transaction as the create.

### Security middleware

- `helmet()` on, with defaults. The API sends JSON only.
- CORS: an explicit allowlist from config (the web origin), `credentials: true` only with explicit origins. Never `origin: '*'` together with credentials.
- Rate limiting (`@nestjs/throttler`): a global default (for example 100 req/min per IP or user), stricter on auth routes (for example 5/min on login, keyed on IP + email) and on lifecycle actions (for example 10/min per user). With a reverse proxy in front, configure `trust proxy` so the limiter sees the real client IP.
- Disable `x-powered-by`. Enable `app.enableShutdownHooks()`.

### Configuration

- `packages/config` (`apiConfigSchema`, `loadConfig`) validates the environment with zod. The app **fails at boot** listing the invalid variable **names** (never values).
- Inject it with `@Inject(API_CONFIG)` (`src/config/config.module.ts`). Use `process.env` only inside the config package. Local dev reads the repo-root `.env` generated by `scripts/dev-env.sh` (`node --env-file-if-exists`).
- Secrets come from env or a secret manager, never from committed files. Keep `.env.example` current, with placeholder values.

### Logging and audit

- Structured JSON logs (recommended: `nestjs-pino`), one request ID per request (from a validated `X-Request-Id` or generated), passed to jobs as `correlationId`.
- Redact `authorization`, `cookie`, `set-cookie`, `password`, `token`, `rconPassword` and any `*Secret` or `*Key` fields.
- Don't log request bodies on auth routes. Log at `warn` for 4xx that indicate abuse (repeated 401s, 429s) and at `error` for 5xx.
- Audit trail: lifecycle actions, deletes, role changes and logins write audit records (`ServerEvent` for server actions; an auth or audit table when auth exists) with actor, action, target, timestamp and result.

## Architecture

```text
HTTP ─► Guard(Auth) ─► Pipe(Validation) ─► Controller ─► Service ─► Repository ─► Prisma ─► PostgreSQL
                                                          │
                                                          └─► Queue producer (BullMQ) ─► Redis ─► Worker
Errors ─► Domain error ─► Global exception filter ─► { error, requestId }
```

The worker is **not** a Nest app: it's a plain Node ESM process with an explicit composition root (`apps/worker/src/main.ts`). It reuses `packages/config`, `packages/database` and `packages/queue`, but has no HTTP layer.

### Monorepo layout (as implemented)

```text
apps/
  web/        Next.js 16 frontend
  api/        NestJS 12 HTTP API (ESM): no Docker access, produces queue jobs only
  worker/     plain Node ESM process: BullMQ processors, schedulers, node agent (Docker later)
packages/     (all ESM, compiled to dist/ with tsc; build them before the apps)
  shared/     zod API contracts, enums, presets, RESOURCE_LIMITS, recommendation
  config/     zod env schemas: apiConfigSchema, workerConfigSchema, loadConfig
  database/   Prisma 7.10 schema + migrations, generated client, createPrismaClient, SecretBox
  queue/      QUEUES, SERVER_JOB_NAMES, serverJobPayloadSchema, jobOptionsFor
```

No `apps/scheduler` or `apps/agent` yet (see `minecraft-server-orchestration`).

`apps/api` must never depend on Docker SDKs or `apps/worker` internals. Shared contracts live in `packages/shared`.

### Module structure

```text
apps/api/src/
  main.ts
  app.module.ts
  config/            # typed config + env validation schema
  common/            # filters, interceptors, guards, decorators, pipes (cross-cutting only)
  auth/
  users/
  servers/
    servers.module.ts
    servers.controller.ts
    servers.service.ts
    servers.repository.ts
    servers.mapper.ts  # model -> response (no secrets/internal fields)
  audit/             # AuditService (append-only)
  database/, redis/  # PRISMA and REDIS providers with shutdown hooks
  operations/        # read-only status of ServerJob operations
  health/            # liveness/readiness
```

- One feature per module. Export only what other modules need (usually the service).
- **Controllers:** routing, schema binding (`ZodPipe`), `@CurrentUser()`, calling one service method, setting the status code. No Prisma, no business rules, no `try/catch` used to map errors.
- **Services:** business rules, ownership, plan limits, transitions, transactions (through repositories), enqueueing. No `Request` or `Response` objects.
- **Repositories:** the only layer that calls Prisma. Methods that read or write user-owned data **take `userId`** as a required argument and scope through `ServerMember`.
- **DI:** constructor injection only. External dependencies (queue, clock, ID generator, crypto) are injected through tokens or classes so tests can replace them. No `new SomeService()` inside providers. No module-level singletons with state.

## Implementation guidelines

The rules in this section are as binding as the mandatory rules above. They describe how to implement them.

### REST conventions

| Action | Method & path | Success |
|---|---|---|
| List own servers | `GET /servers` | 200 |
| Get one | `GET /servers/:id` | 200 |
| Create | `POST /servers` | **202** (async provisioning) |
| Update settings | `PATCH /servers/:id` | 200 (or 202 if it needs an operation) |
| Start / stop / restart / suspend / resume | `POST /servers/:id/start` (etc.) | **202** |
| Delete | `DELETE /servers/:id` | **202** |
| Operation status | `GET /servers/:id/operations/:operationId` | 200 (scoped: `findFirst({ where: { id: operationId, serverId: id, server: { deletedAt: null, members: { some: { userId } } } } })`, else 404) |
| Logs (stream) | `GET /servers/:id/logs/stream` (SSE) | 200 |
| Liveness / readiness | `GET /health/live`, `GET /health/ready` | 200 / 503 |

- Plural nouns, kebab-case paths, camelCase JSON, ISO-8601 UTC timestamps, UUID ids.
- Version the API with a global prefix (`/api/v1`) once there are external clients.

Status codes:

| Code | Use |
|---|---|
| 200 / 201 | Synchronous success / synchronous creation |
| 202 | Operation accepted. Body contains the operation; `Location` points to it |
| 204 | Success with no body |
| 400 | Malformed or invalid input (validation) |
| 401 | Not authenticated |
| 403 | Authenticated but forbidden **for a reason the user is allowed to know** (for example plan limit or role) |
| 404 | Not found **or not owned by the caller** (don't reveal that it exists) |
| 409 | Invalid state transition, operation in progress, unique conflict |
| 422 | Semantically invalid (for example version not available for that type) |
| 429 | Rate limited |
| 500 | Unexpected. Generic message only |
| 503 | Dependency unavailable (DB, Redis) on readiness |

### Response and error format

```jsonc
// success (single)
{ "data": { "id": "…", "name": "…", "status": "STARTING" } }
// success (list)
{ "data": [ … ], "meta": { "nextCursor": "…", "limit": 20 } }
// 202
{ "data": { "server": { … }, "operation": { "id": "…", "type": "START", "status": "QUEUED" } } }
// error
{ "error": { "code": "SERVER_INVALID_TRANSITION", "message": "Server is already running.", "details": [] }, "requestId": "…" }
```

- Error `code` values are stable UPPER_SNAKE_CASE strings that the frontend can depend on. `message` is safe to show to users.
- A single global exception filter maps domain errors, `HttpException`, validation errors and known Prisma errors (`P2002` → 409, `P2025` → 404) to this format. Unknown errors become a 500 with a generic message, and the full detail goes only to logs.
- Never return stack traces, SQL, Prisma messages, container IDs, host paths or internal hostnames.

### Pagination, filtering, sorting

- Cursor pagination: `?limit=20&cursor=<opaque>`, default 20, max 100. The cursor is an opaque, encoded `(createdAt, id)` pair.
- Filters and sort fields come from an **allowlist** query schema (`status`, `serverType`; `sort=createdAt:desc|name:asc`). Never pass a client field name into a Prisma `orderBy` or `where` dynamically.

### Async operations (202 pattern)

```text
POST /servers/:id/start
  → validate body schema + headers + auth
  → service: one transaction (conditional transition + ServerJob + ServerEvent)
  → dispatch through the outbox (details: prisma-postgres-engineering, Transactional outbox)
  → 202 { data: { server, operation } }, Location: /servers/:id/operations/:operationId
```

- Never `await` the Docker work in the request. Never wait for the job to finish.
- Support `Idempotency-Key` on `POST /servers` and lifecycle actions. The same key from the same user returns the original operation (see the unique constraint in `prisma-postgres-engineering`).
- Invalid transition → 409 `SERVER_INVALID_TRANSITION`. Active operation → 409 `OPERATION_IN_PROGRESS` (except supersession: delete, or stop over start; see `minecraft-server-orchestration`). Idempotency key reused for a different server or operation type → 422 `IDEMPOTENCY_KEY_REUSED`.

### Interceptors, pipes, filters, guards: when to use each

| Tool | Use for | Not for |
|---|---|---|
| Guard | AuthN, roles, feature flags | Ownership of a specific row (do that in the service or repository query) |
| Pipe | Validation and transformation of input | Business rules that need the DB |
| Interceptor | Request logging, timing, response envelope, timeouts | Error mapping |
| Filter | Mapping exceptions to the error format | Business logic |

## Security considerations

- Insecure direct object reference (IDOR) is the main risk in a multi-tenant hosting platform. Every route with `:id` needs an ownership test (see `testing-and-quality-gates`).
- Mass assignment: strict schemas (`ZodPipe` rejects unknown keys) plus explicit input-to-data mapping. Never `prisma.server.update({ data: body })` when the schema could grow fields like `status` or `userId`.
- Response leaks: mappers expose only public fields. `containerId`, RCON secrets and internal IPs are never serialized.
- Enumeration: 404 for both "missing" and "not yours". Uniform login error messages.
- DoS: body size limits, pagination caps, rate limits, and no unbounded log or file reads.
- Every new dependency gets checked: actively maintained, no known CVEs.

## Anti-patterns

```ts
// ❌ IDOR
@Get(':id') get(@Param('id') id: string) { return this.prisma.server.findUnique({ where: { id } }); }

// ❌ Trusting client ownership
@Post() create(@Body() body: CreateServerRequest & { userId: string }) { … }

// ❌ Blocking request on infrastructure
@Post(':id/start') async start(…) { await this.docker.getContainer(c).start(); return { ok: true }; }

// ❌ Returning the DB model
return this.prisma.server.findMany();   // leaks containerId, secrets, internal fields

// ❌ Dynamic orderBy from client
orderBy: { [query.sortField]: query.dir }

// ❌ Ad-hoc error shapes
throw new HttpException({ msg: 'nope' }, 400);

// ❌ process.env scattered across services
```

## Examples

```ts
@Controller('servers')
export class ServersController {
  constructor(private readonly servers: ServersService) {}

  @Post(':id/start')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  start(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key', new IdempotencyKeyPipe()) idempotencyKey?: string, // optional; /^[A-Za-z0-9_-]{8,64}$/ else 400
  ) {
    return this.servers.requestStart(user.id, id, idempotencyKey);
  }
}
```

```ts
@Injectable()
export class ServersService {
  constructor(
    private readonly repo: ServersRepository,
    private readonly operations: OperationsDispatcher, // enqueue after commit (outbox)
  ) {}

  async requestStart(userId: string, serverId: string, idempotencyKey?: string) {
    const { server, operation } = await this.repo.transitionWithOperation({
      userId, serverId, from: ['STOPPED', 'SUSPENDED', 'ERROR'], to: 'STARTING',
      jobType: 'START', idempotencyKey,
    }); // throws ServerNotFound / InvalidTransition / OperationInProgress
    await this.operations.dispatch(operation);
    return { data: { server: toServerResponse(server), operation: toOperationResponse(operation) } };
  }
}
```

## Checklist

- [ ] Controller is thin. Service holds the rules. Only the repository touches Prisma.
- [ ] Every input goes through `ZodPipe` with a shared schema (bounds, strict). UUID params use `ParseUUIDPipe`.
- [ ] Route is authenticated (or explicitly `@Public()` with a reason).
- [ ] Ownership is enforced in the query. "Not yours" returns 404. There's a test for it.
- [ ] Response goes through a mapper. No secrets or internal fields.
- [ ] Errors use domain errors and the global filter, with stable codes.
- [ ] Long work returns 202 plus an operation. Idempotency key supported where relevant.
- [ ] Rate limit appropriate to the route's cost.
- [ ] New config validated at boot and added to `.env.example`.
- [ ] Logs are structured, carry the request ID, and redact sensitive fields.
- [ ] Unit and integration tests per `testing-and-quality-gates`.

## Definition of Done

- The endpoint follows the REST, status-code, envelope and error conventions above.
- Authentication, ownership, validation and rate limiting are covered by tests, including negative cases (other user's server, invalid input, unknown fields).
- No Docker or long-running work runs in the request path.
- Lint, typecheck, tests and build pass.
