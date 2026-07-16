-- Bind an external idempotency key to immutable file metadata before Blob writes.
-- Nullable columns preserve rollout safety for rows created before the import API ships;
-- the use case atomically binds an all-null legacy fingerprint on its first retry.
ALTER TABLE "ExternalMaterialImport"
  ADD COLUMN "filename" TEXT,
  ADD COLUMN "mimeType" TEXT,
  ADD COLUMN "size" INTEGER,
  ADD COLUMN "contentSha256" TEXT;
