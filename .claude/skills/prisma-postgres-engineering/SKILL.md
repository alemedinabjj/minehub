---
name: prisma-postgres-engineering
description: Use whenever writing, reviewing or changing HubMine's database layer on PostgreSQL with Prisma. This covers schema.prisma models, enums, relations, IDs, timestamps, indexes, unique and check constraints, migrations (creating, editing, deploying), soft delete, transactions, concurrency control (conditional status updates, the one-active-operation constraint, row and advisory locks, optimistic versioning), the transactional outbox for queue jobs, port allocation, secret columns, raw SQL, seeds, and repository query patterns. HTTP concerns are in nestjs-backend-standards, lifecycle rules in minecraft-server-orchestration.
---

# Prisma & PostgreSQL Engineering

## Purpose

The database is HubMine's **source of truth for intent** and its **main concurrency guard**. This skill makes the schema itself prevent the dangerous states (duplicate containers, double operations, port collisions, cross-tenant access), so application code doesn't have to be perfect for the system to stay correct.

Dependencies:
- `nestjs-backend-standards`: repositories are the only Prisma callers. Access is scoped through `ServerMember` memberships.
- `minecraft-server-orchestration`: the state machine whose transitions this layer enforces.
- `secure-docker-provisioning`: secrets stored here (the RCON password) are consumed there.

## When to use

- Editing `schema.prisma`, creating or editing migrations, or adding indexes or constraints.
- Writing repositories, transactions, or raw SQL.
- Anything involving concurrent requests, jobs, or "it must happen only once".
- Storing secrets or sensitive data.
- Seeding, data backfills, retention or purge jobs.

## Project status

Implemented in **`packages/database`** with **Prisma 7.10** (8.x is still RC; don't upgrade without a decision):

- `prisma/schema.prisma` with `generator client { provider = "prisma-client", output = "../src/generated/prisma" }` (generated code is gitignored; `pnpm build` runs `prisma generate`).
- `prisma.config.ts` (schema, migrations path, `DATABASE_URL`; loads the repo-root `.env` locally via `process.loadEnvFile`).
- `src/client.ts` → `createPrismaClient({ connectionString })` using the **`@prisma/adapter-pg`** driver adapter. The `?schema=` URL parameter (understood by the Prisma CLI, not by `pg`) is stripped from the URL and passed as `PrismaPg(..., { schema })`. One client per process.
- `src/errors.ts` (`uniqueViolationTarget`, `isUniqueViolation`, `isNotFound`, `isRetryableTransactionError`), `src/crypto/secret-box.ts` (`SecretBox`, `randomSecret`).
- Migration `20261004000000_init` was generated with `prisma migrate diff --from-empty --to-schema ... --script` and the hand-written invariants appended. A test (`src/constraints.spec.ts`) asserts the CHECKs equal `RESOURCE_LIMITS` and the partial unique indexes exist.

## Core principles

1. **Constraints over conventions.** If an invariant matters (uniqueness, one active operation, valid ranges), the database enforces it.
2. **Every state change is a conditional write.** Never read, check in JS, then write.
3. **Short transactions, no I/O inside.** No Docker, Redis or HTTP calls inside a DB transaction.
4. **Migrations are immutable history.** Once applied anywhere shared, fix forward with a new migration.
5. **Tenant scoping is in the `where` clause.** Every query on user-owned data filters by the caller's membership (`members: { some: { userId, role: { in: roles } } }`), or comes from a row that was already scoped.

## Mandatory rules

### IDs, types and naming

- Primary keys: UUIDv7, `String @id @default(uuid(7)) @db.Uuid` (time-ordered: good index locality, and event ids double as a cursor). Never expose sequential integer IDs.
- Models in PascalCase, fields in camelCase, mapped to snake_case tables and columns with `@@map` / `@map`.
- Timestamps: `createdAt DateTime @default(now()) @db.Timestamptz(3)` and `updatedAt DateTime @updatedAt @db.Timestamptz(3)` on every mutable model. Always `timestamptz`, always UTC.
- Bounded strings get `@db.VarChar(n)`. Store resources as integers (`heapMb`, `cpuMillis`), never floats. Their bounds come from `RESOURCE_LIMITS` in `packages/shared`.
- Use Prisma `enum` for closed sets that are part of the domain (`ServerStatus`, `ServerType`, `ServerJobType`, `ServerJobStatus`). Adding an enum value takes a migration, which is intentional. Use a lookup table only for sets that admins edit at runtime (for example the version catalog).

### Relations and foreign keys

- Every relation has an explicit FK and `onDelete` behavior:
  - `Server.user`: `onDelete: Restrict`. Users can't be hard-deleted while they have servers; account deletion goes through the server-deletion lifecycle first.
  - `ServerConfig`, `ServerEvent`, `ServerJob` → `Server`: `onDelete: Cascade`. Only used by the final purge of an already soft-deleted server.
- **Index every FK column.** Prisma doesn't create FK indexes automatically on PostgreSQL. Add `@@index([userId])` and so on, or a composite index whose first column is the FK.

### Constraints

Put these constraints in the schema or migration SQL:

| Invariant | Mechanism |
|---|---|
| Email unique (case-insensitive) | Store normalized lowercase plus `@unique`, or `citext` |
| Server slug unique per user among live servers | Partial unique index: `(user_id, slug) WHERE deleted_at IS NULL` |
| Host port unique among live servers (per node, later) | Partial unique index: `(port) WHERE deleted_at IS NULL AND port IS NOT NULL` |
| One container per server | `containerId @unique` (nullable) plus a deterministic container name on the Docker side |
| **At most one active operation per server** | Partial unique index on `server_jobs(server_id) WHERE status IN ('PENDING','QUEUED','RUNNING')` |
| Idempotency key unique per user | `@@unique([requestedById, idempotencyKey])` |
| Resource ranges | `CHECK (heap_mb BETWEEN 1024 AND 32768)`, `CHECK (cpu_millis BETWEEN 500 AND 16000)`, `CHECK (port BETWEEN 1024 AND 65535)`. Equal to `RESOURCE_LIMITS`; a test compares them. Changing a limit means a migration plus a constant change in the same PR. |

Prisma's schema language can't express partial unique indexes or `CHECK` constraints portably. Create the migration with `--create-only`, add the SQL by hand, then apply it. Comment in `schema.prisma` where each one lives, so nobody drops it by accident. After any later `migrate dev`, check that these hand-written objects survive (Prisma may report drift for objects it doesn't model; never "fix" drift by deleting them).

### Soft delete

- `Server` and `User` use `deletedAt` (plus `DELETED` status for servers). A later purge job hard-deletes after the retention period.
- Every repository read on these models filters `deletedAt: null`, unless it's explicitly an admin or purge query. Prefer a Prisma Client extension or repository helper that applies the filter, so nobody forgets it.
- Unique constraints on soft-deleted tables are **partial** (`WHERE deleted_at IS NULL`), so names, slugs and ports can be reused.
- Events and jobs are append-only history. Don't soft-delete them; they're purged with the server.

### Transactions and concurrency

**Scenario: two START requests at the same moment.** Neither may create a second operation or container. Layered defense:

1. **Conditional transition:** `updateMany({ where: { id, deletedAt: null, members: { some: { userId, role: { in: roles } } }, status: { in: allowedFrom } }, data: { status: 'STARTING', version: { increment: 1 }, statusChangedAt: now } })`. Only one request sees `count === 1`.
2. **One-active-operation partial unique index:** the losing request's `serverJob.create` raises `P2002`, which maps to 409 `OPERATION_IN_PROGRESS`, even if step 1 were ever bypassed.
3. **BullMQ `jobId = ServerJob.id`:** duplicate dispatches of the same operation collapse.
4. **Docker:** the deterministic container name `hm-mc-<id>` makes a second create fail with 409 (see `secure-docker-provisioning`).

```ts
async transitionWithOperation(args: {
  userId: string; roles: ServerRole[]; serverId: string; from: ServerStatus[]; to: ServerStatus;
  jobType: ServerJobType; idempotencyKey?: string;
}) {
  const access = { deletedAt: null, members: { some: { userId: args.userId, role: { in: args.roles } } } };
  return this.prisma.$transaction(async (tx) => {
    if (args.idempotencyKey) {
      const existing = await tx.serverJob.findUnique({
        where: { requestedById_idempotencyKey: { requestedById: args.userId, idempotencyKey: args.idempotencyKey } },
      });
      if (existing) {
        if (existing.serverId !== args.serverId || existing.type !== args.jobType) throw new IdempotencyKeyReuseError(); // 422
        return { server: await tx.server.findFirstOrThrow({ where: { id: args.serverId, ...access } }), operation: existing };
      }
    }
    const { count } = await tx.server.updateMany({
      where: { id: args.serverId, ...access, status: { in: args.from } },
      data: { status: args.to, statusChangedAt: new Date(), version: { increment: 1 } },
    });
    if (count === 0) {
      const exists = await tx.server.findFirst({ where: { id: args.serverId, ...access }, select: { status: true } });
      throw exists ? new InvalidTransitionError(exists.status, args.to) : new ServerNotFoundError();
    }
    const operation = await tx.serverJob.create({
      data: { serverId: args.serverId, type: args.jobType, requestedById: args.userId, idempotencyKey: args.idempotencyKey },
    }); // P2002: map by constraint name, see below
    await tx.serverEvent.create({ data: { serverId: args.serverId, type: 'STATUS_CHANGED', toStatus: args.to, actorType: 'USER', actorId: args.userId, operationId: operation.id } });
    const server = await tx.server.findUniqueOrThrow({ where: { id: args.serverId } });
    return { server, operation };
  });
}
```

**P2002 means different things depending on the constraint.** Map it by constraint name (`err.meta.target`; with Prisma 7 driver adapters, check `err.meta.driverAdapterError.cause.constraint` too; verify against the installed version):
- `server_jobs_one_active_key` → `OperationInProgressError` (409).
- The `(requested_by_id, idempotency_key)` unique → a concurrent request with the same key won the race. **Re-read and return the original operation** (or 422 if it targets another server or type), never 409.
- Anything else → generic conflict.

**Supersession:** `delete` supersedes any active operation; `stop` supersedes an active `START`, `RESUME` or `RESTART` (rules in `minecraft-server-orchestration`). The superseding variant first runs `tx.serverJob.updateMany({ where: { serverId, status: { in: ['PENDING','QUEUED','RUNNING'] }, type: { in: supersedable } }, data: { status: 'CANCELLED', finishedAt: now } })` in the same transaction, then makes its conditional transition and inserts its own job. After commit it publishes the cancellation signal for the cancelled operation. No other operation may cancel another one.

Other tools, in order of preference:

| Need | Tool |
|---|---|
| A state change that depends on the current state | Conditional `updateMany` (above) |
| "Only one X" | Unique or partial unique index, catch `P2002` |
| A read-modify-write over several columns or rows | Optimistic `version` check (`where: { id, version }`) and retry, or `SELECT … FOR UPDATE` through `$queryRaw` inside an interactive transaction |
| Serializing a logical resource that has no row (for example per-user quota check + insert) | ``tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'quota:' + userId}))` `` inside the transaction (use `$executeRaw`: `$queryRaw` fails to deserialize the `void` result), or `Serializable` isolation with retry on `P2034` |
| Port allocation | Choose a candidate free port, insert or update, catch `P2002` on the partial unique index, retry with the next candidate (bounded, for example 5 attempts) |

Transaction rules:
- No network I/O (Docker, Redis, HTTP) inside a transaction. Enqueue **after** commit (outbox).
- Keep interactive transactions short; set `timeout` / `maxWait` explicitly when the defaults don't fit.
- Retry only on retryable errors (`P2034` serialization or deadlock), with a bound and jitter.

### Secrets and sensitive data

- Password hashes only (argon2id). Never store reversible passwords.
- Per-server secrets (RCON password) are encrypted at the application level (AES-256-GCM, random 96-bit IV per value, key from config or a secret manager, key ID stored for rotation). They're never logged, never returned by the API, and never shown in Prisma Studio screenshots or seed files.
- Select only what you need (`select` / `omit`). Repositories that serve the API never select secret columns.

### Raw SQL

- Only the tagged-template `$queryRaw` / `$executeRaw` (parameterized). **Never** `$queryRawUnsafe` / `$executeRawUnsafe` with any non-constant input.
- Identifiers (table and column names) are never dynamic from input.

### Migrations

- Change the schema, then run `prisma migrate dev --name <snake_case_description>`, then review the generated SQL **before** committing. Commit `schema.prisma` and the migration directory together.
- Use `--create-only` when you need to hand-edit (partial indexes, CHECKs, data backfills, `CREATE INDEX CONCURRENTLY` for big tables, which must run outside a transaction, so put it in its own migration).
- Deploy environments run `prisma migrate deploy` only. Never run `migrate dev`, `db push` or `migrate reset` against shared, staging or production databases.
- Never edit or delete a migration that has been applied outside your machine.
- Breaking changes use expand/contract: add the nullable column, deploy code that writes both, backfill, switch reads, then drop in a later migration.
- Destructive commands (`migrate reset`, `DROP`, `TRUNCATE`, deleting data) need the user's explicit confirmation, even locally.

## Architecture

```text
packages/database/
  prisma.config.ts
  prisma/schema.prisma
  prisma/migrations/<timestamp>_<name>/migration.sql
  prisma/seed.ts                 # (future) idempotent upserts, fake data only
  src/client.ts                  # createPrismaClient (adapter-pg, schema param)
  src/errors.ts                  # Prisma error helpers (constraint-name aware)
  src/crypto/secret-box.ts       # AES-GCM encrypt/decrypt for secret columns
  src/generated/prisma/          # generated client (gitignored)
apps/api/src/database/database.module.ts  # PRISMA + SecretBox providers, disconnect on shutdown
apps/api/src/**/**.repository.ts       # scoped, API-facing queries
apps/worker/src/**/**.repository.ts    # worker-facing queries (no userId scoping; system actor)
```

## Implementation guidelines

The rules in this section are as binding as the mandatory rules above. They describe how to implement them.

### Schema (as implemented)

The source of truth is `packages/database/prisma/schema.prisma`; read it instead of copying models from here. Summary:

| Model | Purpose / key rules |
|---|---|
| `User` | email unique (lowercase), argon2id `passwordHash`, soft delete |
| `RefreshToken` | SHA-256 `tokenHash` unique, `familyId` for reuse detection, `revokedAt`, `replacedById`, `expiresAt` |
| `ServerNode` | data-plane machine: `name` unique, `status` (ONLINE/DRAINING/OFFLINE/ERROR), capacity (`totalCpuMillis`, `totalMemoryMb`, `totalStorageMb`), `lastHeartbeat` JSON + `lastHeartbeatAt` |
| `Server` | `ownerId`, `status` (`ServerStatus`: CREATING, STARTING, ONLINE, STOPPING, STOPPED, SUSPENDED, CRASHED, ERROR, DELETING, DELETED), `statusReason`, `worldType`, `software`, `minecraftVersion`, `loaderVersion`, `modpackRef` JSON, `players`, `heapMb`, `cpuMillis`, `storageLimitMb`, `nodeId`, `containerId` unique, `port`, `hostname`, `eulaAcceptedAt`, `crashCount`, `version`, soft delete |
| `ServerConfiguration` | 1:1, allowlisted `properties` JSON, `rconPasswordEnc` (AES-256-GCM via `SecretBox`), `revision` |
| `ServerMember` | `(serverId, userId)` PK, `role` (OWNER/ADMIN/MANAGER/MODERATOR/VIEWER): **the** authorization path |
| `ServerJob` | operation = BullMQ job id; `type`, `status` (PENDING/QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED), `stage` (latest milestone), sanitized `errorCode`/`errorMessage`, `idempotencyKey`, `correlationId` |
| `ServerEvent` | append-only timeline; index `(serverId, id)` (UUIDv7 id = cursor) |
| `AuditLog` | append-only platform audit: actor, action, target, serverId, metadata, ip, requestId |

Hand-written migration SQL that goes with it (in `20261004000000_init`):

```sql
CREATE UNIQUE INDEX "servers_owner_slug_live_key" ON "servers" ("owner_id", "slug") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "servers_node_port_live_key"  ON "servers" ("node_id", "port") WHERE "deleted_at" IS NULL AND "port" IS NOT NULL;
CREATE UNIQUE INDEX "server_jobs_one_active_key"  ON "server_jobs" ("server_id") WHERE "status" IN ('PENDING', 'QUEUED', 'RUNNING');
-- CHECKs: heap_mb 1024..32768, cpu_millis 500..16000 (= RESOURCE_LIMITS), storage_limit_mb, port 1024..65535, crash_count >= 0, node capacity > 0
```

Note: in PostgreSQL, `NULL`s are distinct in unique constraints, so `@@unique([requestedById, idempotencyKey])` doesn't constrain rows without a key, which is what we want.

### Transactional outbox (DB ↔ queue consistency)

The DB commit and `queue.add` can't be atomic. The pattern:
1. The transaction inserts `ServerJob(status=PENDING)`.
2. After commit: `queue.add(name, payload, { jobId: serverJob.id })`, then `status = QUEUED`.
3. A sweeper (in the worker, every ~15 s) re-dispatches `PENDING` jobs older than ~30 s. Since `jobId` is the same, this is safe even if step 2 actually succeeded.
4. The worker sets `RUNNING`, then `SUCCEEDED` / `FAILED` / `CANCELLED` in the same transaction as the server's status transition.

### Query patterns

- Paginate with a cursor on `(createdAt, id)` with an index that matches the sort.
- Avoid N+1: use `include` / `select` relations or batch queries. Never query inside loops over unbounded lists.
- Every list query has a `take` limit.
- Prisma error mapping (in the repository or the global filter): `P2002` → conflict, `P2025` → not found, `P2034` → retry, `P2003` → FK violation (bug or conflict).

## Security considerations

- Tenant isolation lives in the `where` clause. Code review checks every `findUnique({ where: { id } })` on user-owned models.
- No secrets in seeds, migrations, fixtures or logs.
- The DB user the app runs as shouldn't be a superuser. Migrations may use a separate, more privileged role.
- Backups are encrypted, and restoring them is tested (future ops task).
- `lastError` and `message` fields hold sanitized, user-safe text only.

## Anti-patterns

```ts
// ❌ check-then-act race
const s = await prisma.server.findUnique({ where: { id } });
if (s.status === 'STOPPED') await prisma.server.update({ where: { id }, data: { status: 'STARTING' } });

// ❌ I/O inside a transaction
await prisma.$transaction(async (tx) => { await tx.server.update(…); await docker.start(…); });

// ❌ enqueue before commit (job may run against uncommitted/rolled-back data)
await queue.add('server.start', …); await prisma.server.update(…);

// ❌ unsafe raw SQL
prisma.$queryRawUnsafe(`SELECT * FROM servers WHERE name = '${name}'`);

// ❌ unscoped tenant query
prisma.server.findUnique({ where: { id: params.id } });

// ❌ editing an applied migration / using db push in staging
```

## Examples

```bash
pnpm --filter @hubmine/database exec prisma migrate dev --name add_server_jobs          # local only
pnpm --filter @hubmine/database exec prisma migrate dev --create-only --name partial_indexes
pnpm --filter @hubmine/database exec prisma migrate deploy                              # CI/CD
pnpm --filter @hubmine/database exec prisma generate
pnpm --filter @hubmine/database exec prisma validate && pnpm --filter @hubmine/database exec prisma format
```

Root shortcuts: `pnpm db:migrate` (deploy), `pnpm db:migrate:dev`, `pnpm db:studio`. Without a running database, generate SQL with `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` (or `--from-migrations` for later changes) and review it before committing.

## Checklist

- [ ] UUID PKs, `timestamptz` timestamps, snake_case mapping, bounded VarChars, integer resources.
- [ ] Every FK has an index and an explicit `onDelete`.
- [ ] Invariants enforced by unique, partial-unique or CHECK constraints, with comments in the schema.
- [ ] Status changes are conditional writes. `count === 0` is handled.
- [ ] No I/O inside transactions. Queue dispatch goes through the outbox.
- [ ] Soft-delete filter applied. Partial uniques ignore deleted rows.
- [ ] Secret columns encrypted, never selected for API responses.
- [ ] Only parameterized raw SQL.
- [ ] Migration SQL reviewed, named descriptively, committed with the schema. No edited history.
- [ ] Concurrency test exists for any new "only once" invariant (see `testing-and-quality-gates`).

## Definition of Done

- `prisma validate` and `prisma format` are clean, the migration applies cleanly to an empty DB **and** to the previous schema, and generated types compile.
- Integration tests against real PostgreSQL (not mocks) cover constraints and concurrent transitions.
- No query on user-owned data lacks owner scoping.
- Quality gates in `testing-and-quality-gates` pass.
