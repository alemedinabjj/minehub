-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ServerStatus" AS ENUM ('CREATING', 'STARTING', 'ONLINE', 'STOPPING', 'STOPPED', 'SUSPENDED', 'CRASHED', 'ERROR', 'DELETING', 'DELETED');

-- CreateEnum
CREATE TYPE "ServerSoftware" AS ENUM ('VANILLA', 'PAPER', 'PURPUR', 'FABRIC', 'FORGE', 'NEOFORGE');

-- CreateEnum
CREATE TYPE "WorldType" AS ENUM ('SURVIVAL', 'PVP', 'CREATIVE', 'MODDED', 'SMP', 'HARDCORE');

-- CreateEnum
CREATE TYPE "PlayerBucket" AS ENUM ('SOLO', 'SMALL', 'MEDIUM', 'LARGE', 'HUGE');

-- CreateEnum
CREATE TYPE "ServerJobType" AS ENUM ('CREATE', 'START', 'STOP', 'RESTART', 'SUSPEND', 'RESUME', 'DELETE');

-- CreateEnum
CREATE TYPE "ServerJobStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NodeStatus" AS ENUM ('ONLINE', 'DRAINING', 'OFFLINE', 'ERROR');

-- CreateEnum
CREATE TYPE "ServerRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'MODERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM', 'ADMIN');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_by_id" UUID,
    "user_agent" VARCHAR(256),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_nodes" (
    "id" UUID NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "status" "NodeStatus" NOT NULL DEFAULT 'ONLINE',
    "public_host" VARCHAR(253) NOT NULL,
    "region" VARCHAR(32) NOT NULL DEFAULT 'local',
    "docker_endpoint" VARCHAR(255) NOT NULL,
    "total_cpu_millis" INTEGER NOT NULL,
    "total_memory_mb" INTEGER NOT NULL,
    "total_storage_mb" INTEGER NOT NULL,
    "last_heartbeat" JSONB,
    "last_heartbeat_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "server_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servers" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "slug" VARCHAR(40) NOT NULL,
    "status" "ServerStatus" NOT NULL DEFAULT 'CREATING',
    "status_reason" VARCHAR(64),
    "status_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "world_type" "WorldType" NOT NULL,
    "minecraft_version" VARCHAR(32) NOT NULL,
    "software" "ServerSoftware" NOT NULL,
    "loader_version" VARCHAR(32),
    "modpack_ref" JSONB,
    "players" "PlayerBucket" NOT NULL,
    "heap_mb" INTEGER NOT NULL,
    "cpu_millis" INTEGER NOT NULL,
    "storage_limit_mb" INTEGER NOT NULL DEFAULT 10240,
    "node_id" UUID,
    "container_id" VARCHAR(64),
    "port" INTEGER,
    "hostname" VARCHAR(253),
    "eula_accepted_at" TIMESTAMPTZ(3) NOT NULL,
    "crash_count" INTEGER NOT NULL DEFAULT 0,
    "last_seen_at" TIMESTAMPTZ(3),
    "last_started_at" TIMESTAMPTZ(3),
    "last_stopped_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_configurations" (
    "server_id" UUID NOT NULL,
    "properties" JSONB NOT NULL,
    "rcon_password_enc" BYTEA NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "server_configurations_pkey" PRIMARY KEY ("server_id")
);

-- CreateTable
CREATE TABLE "server_members" (
    "server_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "ServerRole" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "server_members_pkey" PRIMARY KEY ("server_id","user_id")
);

-- CreateTable
CREATE TABLE "server_jobs" (
    "id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "type" "ServerJobType" NOT NULL,
    "status" "ServerJobStatus" NOT NULL DEFAULT 'PENDING',
    "stage" VARCHAR(64),
    "requested_by_id" UUID,
    "idempotency_key" VARCHAR(64),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_code" VARCHAR(64),
    "error_message" VARCHAR(500),
    "correlation_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "server_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_events" (
    "id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "from_status" "ServerStatus",
    "to_status" "ServerStatus",
    "actor_type" "ActorType" NOT NULL,
    "actor_id" UUID,
    "operation_id" UUID,
    "message" VARCHAR(500),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "server_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(32) NOT NULL,
    "target_id" UUID,
    "server_id" UUID,
    "metadata" JSONB,
    "ip" VARCHAR(45),
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "server_nodes_name_key" ON "server_nodes"("name");

-- CreateIndex
CREATE UNIQUE INDEX "servers_container_id_key" ON "servers"("container_id");

-- CreateIndex
CREATE INDEX "servers_owner_id_created_at_idx" ON "servers"("owner_id", "created_at");

-- CreateIndex
CREATE INDEX "servers_node_id_idx" ON "servers"("node_id");

-- CreateIndex
CREATE INDEX "servers_status_idx" ON "servers"("status");

-- CreateIndex
CREATE INDEX "server_members_user_id_idx" ON "server_members"("user_id");

-- CreateIndex
CREATE INDEX "server_jobs_server_id_created_at_idx" ON "server_jobs"("server_id", "created_at");

-- CreateIndex
CREATE INDEX "server_jobs_status_created_at_idx" ON "server_jobs"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "server_jobs_requested_by_id_idempotency_key_key" ON "server_jobs"("requested_by_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "server_events_server_id_id_idx" ON "server_events"("server_id", "id");

-- CreateIndex
CREATE INDEX "audit_logs_server_id_created_at_idx" ON "audit_logs"("server_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servers" ADD CONSTRAINT "servers_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servers" ADD CONSTRAINT "servers_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "server_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_configurations" ADD CONSTRAINT "server_configurations_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_members" ADD CONSTRAINT "server_members_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_members" ADD CONSTRAINT "server_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_jobs" ADD CONSTRAINT "server_jobs_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_events" ADD CONSTRAINT "server_events_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written invariants (not expressible in the Prisma schema language).
-- ---------------------------------------------------------------------------

-- A slug is unique per owner among live servers; deleted servers free it.
CREATE UNIQUE INDEX "servers_owner_slug_live_key" ON "servers" ("owner_id", "slug") WHERE "deleted_at" IS NULL;

-- A host port is unique per node among live servers.
CREATE UNIQUE INDEX "servers_node_port_live_key" ON "servers" ("node_id", "port")
  WHERE "deleted_at" IS NULL AND "port" IS NOT NULL;

-- At most one active operation per server: the core guard against double start/create.
CREATE UNIQUE INDEX "server_jobs_one_active_key" ON "server_jobs" ("server_id")
  WHERE "status" IN ('PENDING', 'QUEUED', 'RUNNING');

-- Resource bounds. Must equal RESOURCE_LIMITS in @hubmine/shared (a test enforces it).
ALTER TABLE "servers" ADD CONSTRAINT "servers_heap_mb_check" CHECK ("heap_mb" BETWEEN 1024 AND 32768);
ALTER TABLE "servers" ADD CONSTRAINT "servers_cpu_millis_check" CHECK ("cpu_millis" BETWEEN 500 AND 16000);
ALTER TABLE "servers" ADD CONSTRAINT "servers_storage_limit_mb_check" CHECK ("storage_limit_mb" BETWEEN 1024 AND 512000);
ALTER TABLE "servers" ADD CONSTRAINT "servers_port_check" CHECK ("port" IS NULL OR "port" BETWEEN 1024 AND 65535);
ALTER TABLE "servers" ADD CONSTRAINT "servers_crash_count_check" CHECK ("crash_count" >= 0);

ALTER TABLE "server_nodes" ADD CONSTRAINT "server_nodes_capacity_check"
  CHECK ("total_cpu_millis" > 0 AND "total_memory_mb" > 0 AND "total_storage_mb" > 0);
