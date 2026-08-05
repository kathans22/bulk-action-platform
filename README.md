# Bulk Action Platform

## Overview

A CRM bulk action platform that applies an update to every entity on an account without
blocking the caller. A request is validated, split into batches of entity ids and queued;
a separate worker process claims those batches and applies the change one entity at a
time. Every entity produces a log row, so progress, per-entity failures and skipped
duplicates are all queryable while the action is still running.

## Tech stack and why

- **Express** for the HTTP layer. Nothing about this problem needs more than routing,
  JSON parsing and an error handler.
- **PostgreSQL with raw SQL through `pg`.** No ORM. The queries here are simple enough
  that SQL is the clearest way to express them, and the schema is small enough that
  migrations by hand are not a burden. All SQL lives in `src/queries/`, so there is
  exactly one place to look when a query needs changing.
- **The job queue is a Postgres table**, `bulk_action_batches`, claimed with
  `SELECT ... FOR UPDATE SKIP LOCKED` — not Redis, not BullMQ. Three reasons:
  it removes a moving part from the stack, the entire queue stays inspectable with
  ordinary SQL (`select status, count(*) from bulk_action_batches group by 1`), and a
  reviewer can run the whole project with nothing installed but Postgres.
- Swapping in BullMQ or SQS later would mean replacing `claimNextBatch()` and the worker
  loop. Nothing else in the codebase knows how a batch arrives.

The cost of this choice is polling instead of push: an idle worker sleeps two seconds
between claim attempts. At this scale that is not a meaningful delay.

## Setup

Prerequisites: Node.js 18 or newer (the load test script uses built-in `fetch`) and
PostgreSQL 12 or newer.

```bash
npm install

cp .env.example .env
# edit DATABASE_URL with your Postgres user and password

createdb bulk_action_platform
psql -d bulk_action_platform -f db/schema.sql

npm run seed
```

`npm run seed` inserts 5000 contacts on account `acc_1`. Roughly 10 percent share an
email with an earlier contact, which gives the de-duplication feature something to skip.

Then start the two processes, in separate terminals:

```bash
npm start        # API on http://localhost:3000
npm run worker   # batch worker
```

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | none | Postgres connection string |
| `PORT` | 3000 | API port |
| `BATCH_SIZE` | 100 | Entity ids per batch row |
| `RATE_LIMIT_PER_MINUTE` | 10000 | Entities an account may submit per minute |

## Architecture

```
   POST /bulk-actions
          |
          v
   +---------------+     writes      +----------------------+
   |  API process  | --------------> |  bulk_actions        |
   |  (Express)    |                 |  bulk_action_batches |
   +---------------+                 +----------------------+
          ^                                     |
          |                                     | claim one batch
   GET /bulk-actions/:id                        | FOR UPDATE SKIP LOCKED
   GET /bulk-actions/:id/stats                  v
   GET /bulk-actions/:id/logs          +-----------------+
          |                            |  worker process |
          |                            +-----------------+
          |                                     |
          |                                     | per entity
          |         reads                       v
   +----------------------+          +----------------------+
   |  bulk_action_logs    | <-------- |  contacts            |
   +----------------------+  writes   +----------------------+
```

Both processes talk only to Postgres. They never talk to each other, so any number of
either can run.

### Request lifecycle

1. `POST /bulk-actions` arrives. Required fields are checked, then the entity type and
   action type are resolved through their registries.
2. The action handler validates `configuration` — for `bulk_update`, that every field
   named is in the entity's `updatableFields`.
3. All entity ids for the account are fetched.
4. The rate limiter adds that entity count to the account's current minute window and
   rejects the request with 429 if the window is now over the limit.
5. If `skipDuplicates` is set, duplicate entities are found on the entity's
   `dedupeField`, logged as `skipped`, and excluded from the batches.
6. The `bulk_actions` row is inserted — `scheduled` if `scheduledAt` is in the future,
   otherwise `queued`.
7. Remaining ids are split into batches of `BATCH_SIZE` and inserted into
   `bulk_action_batches`, 500 rows per INSERT statement.
8. The API responds 201. Nothing has been processed yet.
9. A worker claims the oldest pending batch whose action is due, marking it `processing`
   and incrementing its attempt count in one statement.
10. On the first batch the action moves to `processing` and `started_at` is set.
11. Each entity in the batch is updated individually and produces one log row —
    `success`, or `failed` with the database error message.
12. The batch is marked `done`. If no pending batches remain for that action, the action
    is marked `completed` and `finished_at` is set.
13. A batch that throws goes back to `pending` for retry, up to three attempts, then is
    marked `failed` with the error stored.

## API reference

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness check, does not touch the database |
| GET | `/contacts` | List contacts, `limit` and `offset` |
| POST | `/bulk-actions` | Create a bulk action, returns 201 with its id and status |
| GET | `/bulk-actions` | List bulk actions, newest first, optional `accountId` and `status` |
| GET | `/bulk-actions/:id` | One bulk action with `progress` as processed, total and percentage |
| GET | `/bulk-actions/:id/stats` | Counts of success, failed, skipped and pending entities |
| GET | `/bulk-actions/:id/logs` | Per entity log rows, optional `status` filter |

All list endpoints accept `limit` and `offset` and return `{ total, limit, offset, data }`.
Errors return `{ error: message }` with the appropriate status code; the 429 response also
carries `limit`, `accountId` and `retryAfterSeconds`.
