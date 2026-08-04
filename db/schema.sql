-- ============================================================================
-- Bulk Action Platform — database schema
--
-- There is no Redis and no external queue in this project. The job queue is a
-- Postgres table: bulk_action_batches. A bulk action is split into batches of
-- entity ids at submit time, each batch is inserted as a row with status
-- 'pending', and the worker claims rows with SELECT ... FOR UPDATE SKIP LOCKED.
--
-- Why a table instead of a real queue:
--   1. The batches and the entities they touch live in the same database, so a
--      batch can be claimed, applied and marked done inside one transaction.
--      Nothing can be processed twice after a crash, and nothing can be lost
--      between "queue says done" and "database says written".
--   2. SKIP LOCKED lets many workers pull disjoint batches concurrently without
--      any coordination beyond the database itself.
--   3. Progress and retries are plain columns, so status and failure reasons
--      are queryable with the same SQL as everything else.
-- The cost is polling instead of push, which is fine at this scale.
-- ============================================================================


-- CRM contacts. The entity that bulk actions read and write.
CREATE TABLE contacts (
  id SERIAL PRIMARY KEY,
  account_id VARCHAR(50) NOT NULL,
  name VARCHAR(255),
  -- email is deliberately NOT unique. Duplicate emails must be able to exist,
  -- otherwise the de-duplication feature would have nothing to skip.
  email VARCHAR(255),
  -- The assignment names "name, email, status" as example updatable fields and
  -- "name, email, age" as the sample schema, so the table carries all four.
  age INTEGER,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Every bulk action is scoped to one account, so every lookup filters on it.
CREATE INDEX idx_contacts_account_id ON contacts(account_id);


-- One row per submitted bulk action. Holds what to do and how far it has got.
CREATE TABLE bulk_actions (
  id SERIAL PRIMARY KEY,
  account_id VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  action_type VARCHAR(50) NOT NULL,
  -- status: queued, scheduled, processing, completed, failed
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  configuration JSONB NOT NULL,
  total_entities INTEGER DEFAULT 0,
  scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);


-- The job queue. One row per batch of entity ids waiting for a worker to claim.
CREATE TABLE bulk_action_batches (
  id SERIAL PRIMARY KEY,
  bulk_action_id INTEGER NOT NULL REFERENCES bulk_actions(id),
  entity_ids INTEGER[] NOT NULL,
  -- status: pending, processing, done, failed
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- The worker polls for pending batches, so status is the column it searches on.
CREATE INDEX idx_bulk_action_batches_status ON bulk_action_batches(status);
