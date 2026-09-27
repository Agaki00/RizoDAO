-- Issue #47 (P0): idempotency + audit states on Stellar payments.
--
-- 1. A purchase is now recorded as PENDING before the Stellar payment is
--    submitted, so `stellarTxHash` must be nullable.
-- 2. The hash becomes UNIQUE so a blockchain payment can credit an order at
--    most once. Legacy duplicates are collapsed first (keep the earliest row
--    per hash) so this migration cannot fail on existing data.
-- 3. Status now uses the traceable PENDING/COMPLETED/FAILED lifecycle.

ALTER TABLE "Purchase" ALTER COLUMN "stellarTxHash" DROP NOT NULL;

-- Collapse pre-existing duplicate hashes (keep the earliest credit per hash).
DELETE FROM "Purchase" p
USING "Purchase" q
WHERE p."stellarTxHash" = q."stellarTxHash"
  AND (
    p."createdAt" > q."createdAt"
    OR (p."createdAt" = q."createdAt" AND p."ctid" > q."ctid")
  );

CREATE UNIQUE INDEX "Purchase_stellarTxHash_key" ON "Purchase"("stellarTxHash");

ALTER TABLE "Purchase" ALTER COLUMN "status" SET DEFAULT 'PENDING';

UPDATE "Purchase" SET "status" = 'COMPLETED' WHERE "status" = 'completed';

CREATE INDEX "Purchase_status_idx" ON "Purchase"("status");
