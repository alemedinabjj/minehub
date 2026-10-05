-- Containers created before applied_revision existed were built from their current revision.
UPDATE "server_configurations" SET "applied_revision" = "revision" WHERE "applied_revision" = 0;
