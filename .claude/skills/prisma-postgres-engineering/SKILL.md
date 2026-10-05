---
name: prisma-postgres-engineering
description: Use whenever writing, reviewing or changing HubMine's database layer on PostgreSQL with Prisma. This covers schema.prisma models, enums, relations, IDs, timestamps, indexes, unique and check constraints, migrations (creating, editing, deploying), soft delete, transactions, concurrency control (conditional status updates, the one-active-operation constraint, row and advisory locks, optimistic versioning), the transactional outbox for queue jobs, port allocation, secret columns, raw SQL, seeds, and repository query patterns. HTTP concerns are in nestjs-backend-standards, lifecycle rules in minecraft-server-orchestration.
---

# Prisma & PostgreSQL Engineering

## Purpose

The database is HubMine's **source of truth for intent** and its **main concurrency guard**. This skill makes the schema itself prevent the dangerous states (duplicate containers, double operations, port collisions, cross-tenant access), so application code doesn't have to be perfect for the system to stay correct.

Dependencies:
- `nestjs-backend-standards`: repositories are the only Prisma callers. Ownership is scoped by `userId`.
- `minecraft-server-orchestration`: the state machine whose transitions this layer enforces.
- `secure-docker-provisioning`: secrets stored here (the RCON password) are consumed there.

## When to use

- Editing `schema.prisma`, creating or editing migrations, or adding indexes or constraints.
- Writing repositories, transactions, or raw SQL.
- Anything involving concurrent requests, jobs, or "it must happen only once".
- Storing secrets or sensitive data.
- Seeding, data backfills, retention or purge jobs.

## Project status

Greenfield: there's no `schema.prisma` yet. The model below is the **recommended starting schema**. Check the installed Prisma major version before writing config. Prisma 7 changed configuration (`prisma.config.ts`, the new `prisma-client` generator, driver adapters such as `@prisma/adapter-pg`). Use Context7 to confirm the syntax for the installed version. Recommended location: `packages/db/prisma/schema.prisma`.

## Core principles

1. **Constraints over conventions.** If an invariant matters (uniqueness, one active operation, valid ranges), the database enforces it.
2. **Every state change is a conditional write.** Never read, check in JS, then write.
3. **Short transactions, no I/O inside.** No Docker, Redis or HTTP calls inside a DB transaction.
4. **Migrations are immutable history.** Once applied anywhere shared, fix forward with a new migration.
5. **Tenant scoping is in the `where` clause.** Every query on user-owned data includes `userId` (or comes from a row that was already scoped).

## Mandatory rules

### IDs, types and naming

- Primary keys: UUID, `String @id @default(uuid()) @db.Uuid`. If the installed Prisma version supports `uuid(7)`, prefer it for better index locality. Never expose sequential integer IDs.
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

1. **Conditional transition:** `updateMany({ where: { id, userId, deletedAt: null, status: { in: allowedFrom } }, data: { status: 'STARTING', version: { increment: 1 }, statusChangedAt: now } })`. Only one request sees `count === 1`.
2. **One-active-operation partial unique index:** the losing request's `serverJob.create` raises `P2002`, which maps to 409 `OPERATION_IN_PROGRESS`, even if step 1 were ever bypassed.
3. **BullMQ `jobId = ServerJob.id`:** duplicate dispatches of the same operation collapse.
4. **Docker:** the deterministic container name `hm-mc-<id>` makes a second create fail with 409 (see `secure-docker-provisioning`).

```ts
async transitionWithOperation(args: {
  userId: string; serverId: string; from: ServerStatus[]; to: ServerStatus;
  jobType: ServerJobType; idempotencyKey?: string;
}) {
  return this.prisma.$transaction(async (tx) => {
    if (args.idempotencyKey) {
      const existing = await tx.serverJob.findUnique({
        where: { requestedById_idempotencyKey: { requestedById: args.userId, idempotencyKey: args.idempotencyKey } },
      });
      if (existing) {
        if (existing.serverId !== args.serverId || existing.type !== args.jobType) throw new IdempotencyKeyReuseError(); // 422
        return { server: await tx.server.findFirstOrThrow({ where: { id: args.serverId, userId: args.userId } }), operation: existing };
      }
    }
    const { count } = await tx.server.updateMany({
      where: { id: args.serverId, userId: args.userId, deletedAt: null, status: { in: args.from } },
      data: { status: args.to, statusChangedAt: new Date(), version: { increment: 1 } },
    });
    if (count === 0) {
      const exists = await tx.server.findFirst({ where: { id: args.serverId, userId: args.userId, deletedAt: null }, select: { status: true } });
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
packages/db/
  prisma/schema.prisma
  prisma/migrations/<timestamp>_<name>/migration.sql
  prisma/seed.ts                 # idempotent upserts, fake data only
  src/prisma.service.ts          # Nest provider: connect / shutdown hooks
  src/errors.ts                  # Prisma error → domain error helpers
  src/crypto/secret-box.ts       # AES-GCM encrypt/decrypt for secret columns
apps/api/src/**/**.repository.ts       # scoped, API-facing queries
apps/worker/src/**/**.repository.ts    # worker-facing queries (no userId scoping; system actor)
```

## Implementation guidelines

The rules in this section are as binding as the mandatory rules above. They describe how to implement them.

### Recommended schema

```prisma
enum ServerStatus { CREATING STARTING RUNNING STOPPING STOPPED SUSPENDED ERROR DELETING DELETED }
enum ServerType   { VANILLA PAPER PURPUR FABRIC FORGE NEOFORGE MODPACK }
enum ServerJobType   { CREATE START STOP RESTART SUSPEND RESUME DELETE }
enum ServerJobStatus { PENDING QUEUED RUNNING SUCCEEDED FAILED CANCELLED }

model User {
  id           String   @id @default(uuid()) @db.Uuid
  email        String   @unique @db.VarChar(254)        // stored lowercase; stays reserved after soft delete until purge/anonymization
  passwordHash String   @map("password_hash")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)
  deletedAt    DateTime? @map("deleted_at") @db.Timestamptz(3)
  servers      Server[]
  @@map("users")
}

model Server {
  id               String       @id @default(uuid()) @db.Uuid
  userId           String       @map("user_id") @db.Uuid
  name             String       @db.VarChar(32)
  slug             String       @db.VarChar(40)
  status           ServerStatus @default(CREATING)
  statusReason     String?      @map("status_reason") @db.VarChar(64)  // CRASH, OOM, IDLE... (sanitized)
  statusChangedAt  DateTime     @default(now()) @map("status_changed_at") @db.Timestamptz(3)
  minecraftVersion String       @map("minecraft_version") @db.VarChar(32)
  serverType       ServerType   @map("server_type")
  loaderVersion    String?      @map("loader_version") @db.VarChar(32)   // Fabric/Forge/NeoForge, from catalog
  modpackRef       Json?        @map("modpack_ref")    // MODPACK only: { source: "MODRINTH"|"CURSEFORGE", projectId, versionId }, schema-validated
  heapMb           Int          @map("heap_mb")        // JVM heap the user chose; container limit = heap + overhead (secure-docker-provisioning)
  cpuMillis        Int          @map("cpu_millis")
  containerId      String?      @unique @map("container_id") @db.VarChar(64)
  port             Int?
  eulaAcceptedAt   DateTime     @map("eula_accepted_at") @db.Timestamptz(3)
  lastSeenAt       DateTime?    @map("last_seen_at") @db.Timestamptz(3)
  version          Int          @default(0)                      // optimistic lock counter
  createdAt        DateTime     @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime     @updatedAt @map("updated_at") @db.Timestamptz(3)
  deletedAt        DateTime?    @map("deleted_at") @db.Timestamptz(3)

  user   User          @relation(fields: [userId], references: [id], onDelete: Restrict)
  config ServerConfig?
  events ServerEvent[]
  jobs   ServerJob[]

  @@index([userId, createdAt])
  @@index([status])
  // Partial unique (user_id, slug) and (port) WHERE deleted_at IS NULL: see migration SQL
  @@map("servers")
}

model ServerConfig {
  serverId        String   @id @map("server_id") @db.Uuid
  properties      Json                                   // allowlisted keys only, validated before write
  rconPasswordEnc Bytes    @map("rcon_password_enc")     // AES-256-GCM ciphertext (iv|tag|data)
  revision        Int      @default(1)
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)
  server          Server   @relation(fields: [serverId], references: [id], onDelete: Cascade)
  @@map("server_configs")
}

model ServerEvent {                                      // append-only audit/history
  id          String        @id @default(uuid()) @db.Uuid
  serverId    String        @map("server_id") @db.Uuid
  type        String        @db.VarChar(48)            // STATUS_CHANGED, CONFIG_UPDATED, CRASH_DETECTED...
  fromStatus  ServerStatus? @map("from_status")
  toStatus    ServerStatus? @map("to_status")
  actorType   String        @map("actor_type") @db.VarChar(16)   // USER | SYSTEM | ADMIN
  actorId     String?       @map("actor_id") @db.Uuid
  operationId String?       @map("operation_id") @db.Uuid
  message     String?       @db.VarChar(500)           // sanitized, user-safe
  metadata    Json?
  createdAt   DateTime      @default(now()) @map("created_at") @db.Timestamptz(3)
  server      Server        @relation(fields: [serverId], references: [id], onDelete: Cascade)
  @@index([serverId, createdAt(sort: Desc)])
  @@map("server_events")
}

model ServerJob {                                        // an "operation"; id == BullMQ jobId
  id             String          @id @default(uuid()) @db.Uuid
  serverId       String          @map("server_id") @db.Uuid
  type           ServerJobType
  status         ServerJobStatus @default(PENDING)
  requestedById  String?         @map("requested_by_id") @db.Uuid   // null = system
  idempotencyKey String?         @map("idempotency_key") @db.VarChar(64)
  attempts       Int             @default(0)
  lastError      String?         @map("last_error") @db.VarChar(1000) // sanitized
  correlationId  String?         @map("correlation_id") @db.VarChar(64)
  createdAt      DateTime        @default(now()) @map("created_at") @db.Timestamptz(3)
  startedAt      DateTime?       @map("started_at") @db.Timestamptz(3)
  finishedAt     DateTime?       @map("finished_at") @db.Timestamptz(3)
  updatedAt      DateTime        @updatedAt @map("updated_at") @db.Timestamptz(3)
  server         Server          @relation(fields: [serverId], references: [id], onDelete: Cascade)
  @@unique([requestedById, idempotencyKey])
  @@index([serverId, createdAt])
  @@index([status, createdAt])                           // outbox sweeper
  // Partial unique (server_id) WHERE status IN ('PENDING','QUEUED','RUNNING'): see migration SQL
  @@map("server_jobs")
}
```

Hand-written migration SQL that goes with it:

```sql
CREATE UNIQUE INDEX servers_user_slug_live_key ON servers (user_id, slug) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX servers_port_live_key      ON servers (port) WHERE deleted_at IS NULL AND port IS NOT NULL;
CREATE UNIQUE INDEX server_jobs_one_active_key ON server_jobs (server_id)
  WHERE status IN ('PENDING', 'QUEUED', 'RUNNING');
ALTER TABLE servers ADD CONSTRAINT servers_heap_mb_check    CHECK (heap_mb BETWEEN 1024 AND 32768);   -- = RESOURCE_LIMITS.heapMb
ALTER TABLE servers ADD CONSTRAINT servers_cpu_millis_check CHECK (cpu_millis BETWEEN 500 AND 16000); -- = RESOURCE_LIMITS.cpuMillis
ALTER TABLE servers ADD CONSTRAINT servers_port_check       CHECK (port IS NULL OR port BETWEEN 1024 AND 65535);
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
pnpm --filter @hubmine/db exec prisma migrate dev --name add_server_jobs          # local only
pnpm --filter @hubmine/db exec prisma migrate dev --create-only --name partial_indexes
pnpm --filter @hubmine/db exec prisma migrate deploy                              # CI/CD
pnpm --filter @hubmine/db exec prisma generate
pnpm --filter @hubmine/db exec prisma validate && pnpm --filter @hubmine/db exec prisma format
```

The package name `@hubmine/db` and `pnpm` are assumptions. Use the real workspace names and package manager once they exist.

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
