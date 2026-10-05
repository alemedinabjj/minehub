-- Which configuration revision the running container was built from (restart-required badge).
ALTER TABLE "server_configurations" ADD COLUMN "applied_revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "server_configurations" ADD CONSTRAINT "server_configurations_applied_revision_check" CHECK ("applied_revision" >= 0 AND "applied_revision" <= "revision");
