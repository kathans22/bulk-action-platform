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

`npm run seed` inserts 7000 contacts on account `acc_1`. Roughly 10 percent share an
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

## Adding a new bulk action

This is the extensibility point the system is built around. Adding `bulk_delete` is
exactly two changes.

**One: create `src/actions/bulkDelete.js`.** An action file exports two functions and
knows nothing about HTTP, batching or the worker.

```js
function validateConfiguration(configuration, entityConfig) {
  if (configuration.fields) {
    throw new Error('bulk_delete does not take fields');
  }
}

function buildStatement(entityConfig) {
  return {
    sql: `DELETE FROM ${entityConfig.table} WHERE id = $1`,
    values: []
  };
}

module.exports = { validateConfiguration, buildStatement };
```

`buildStatement` returns the statement for one row. The caller appends the entity id as
the last parameter, so a `DELETE` needs no values of its own and the id lands on `$1`.

**Two: register it in `src/actions/index.js`.**

```js
const bulkDelete = require('./bulkDelete');

const actionHandlers = {
  bulk_update: bulkUpdate,
  bulk_delete: bulkDelete
};
```

That is the whole change. No route, controller, service, query or worker file is
touched. The worker never names an action: it reads `action_type` off the
`bulk_actions` row, resolves the handler through the registry, and calls
`buildStatement`. The function is deliberately not called `buildUpdate` for this reason.

The one request-shape note: `configuration` must be present in the request body, so a
delete is submitted with `"configuration": {}`.

## Adding a new entity

Entity shape lives in one place, `src/entities/index.js`:

```js
const entities = {
  contact: {
    table: 'contacts',
    updatableFields: ['name', 'email', 'age', 'status'],
    dedupeField: 'email'
  },
  company: {
    table: 'companies',
    updatableFields: ['name', 'domain', 'status'],
    dedupeField: 'domain'
  }
};
```

That object drives validation, the SQL target table and de-duplication. Two further
pieces are needed because a new entity needs its own SQL:

1. A query file for it, `src/queries/companies.queries.js`, exporting an id lookup by
   account and a fetch by ids — mirroring `contacts.queries.js`.
2. Wiring those two queries in, at `fetchEntityIds` and `fetchEntities` in
   `src/services/bulkActions.service.js` and `fetchEntities` in
   `src/worker/processBatch.js`, each of which currently dispatches on the entity type
   with a single `if`.

Actions are the axis this system extends along cleanly; entities need three small edits
beyond the registry entry. Routing those lookups through the registry as well — a
`queries` key on each entity object — would close the gap and is the obvious next
refactor.

## Horizontal scaling

Run more worker processes:

```bash
npm run worker   # terminal 1
npm run worker   # terminal 2
npm run worker   # terminal 3
```

`claimNextBatch` selects one pending batch with `FOR UPDATE SKIP LOCKED`, so a row
another worker is already holding is skipped rather than waited on. Two workers can
never claim the same batch, and no coordination beyond Postgres is involved. Workers can
live on different machines; they share nothing but the database.

Throughput scales close to linearly until Postgres write throughput becomes the limit —
measured numbers are in the load test section below.

## Optional features

All three optional features are implemented.

**Rate limiting.** Enforced per account against `RATE_LIMIT_PER_MINUTE`, default 10000.
The counter is a row in `rate_limits` keyed on account and minute window, incremented
with an `INSERT ... ON CONFLICT DO UPDATE` that returns the new total. What is counted is
entities, not requests: one bulk action over 50,000 contacts is 50,000 events and is
rejected, rather than being waved through as a single event. That is why the check sits
in the service rather than in route middleware — the entity count is not known until the
ids have been fetched. Over the limit returns 429 with `limit`, `accountId` and
`retryAfterSeconds`.

**De-duplication.** Set `configuration.skipDuplicates` to true. Entities are compared on
the entity's `dedupeField` (`email` for contacts); the first entity for a value is kept
and every later one is logged as `skipped` with the message `duplicate email: <value>`
and left out of the batches entirely. This runs once at creation time rather than in the
worker: a bulk action spans many batches, so "have I seen this email before" would
otherwise have to be answered across every batch in the action. Doing it once is simpler
and gives the same result. `total_entities` still counts skipped entities, so
success + failed + skipped + pending always equals the total.

**Scheduling.** Pass an ISO timestamp as `scheduledAt`. A future time stores the action
as `scheduled`; a past or unparseable one is rejected with 400. There is no scheduler
process and no cron — `claimNextBatch` simply will not claim a batch whose action is not
yet due:

```sql
WHERE b.status = 'pending'
  AND (a.scheduled_at IS NULL OR a.scheduled_at <= NOW())
```

When the time passes, the next poll picks the batches up and the action moves through
`processing` to `completed` like any other.

## Load test results

`npm run loadtest` creates a bulk action over every seeded contact, polls the stats
endpoint every second, and reports elapsed time and throughput. Measured on a Windows
laptop with Postgres 18 running locally, `BATCH_SIZE=1000`:

| Entities | Batch size | Workers | Elapsed | Entities per minute |
| --- | --- | --- | --- | --- |
| 5000 | 1000 | 1 | 11.3 s | 26,652 |
| 5000 | 1000 | 3 | 5.1 s | 58,685 |

Three workers finished the same work 2.2 times faster. Scaling is not perfectly linear
here because 5000 entities is only five batches, so with three workers the split was
1/3/1 rather than an even share, and the last worker to finish sets the elapsed time.
Both figures are comfortably above the "thousands of entities per minute" the brief asks
for.

These are single runs on one machine, not an average, and throughput varies noticeably
between runs depending on what else Postgres is doing.

## Assumptions and trade-offs

- **A bulk action targets every entity on the account.** There is no filter or query
  selector in the request. Adding one is the obvious next step and would change only
  the id-fetching step at creation.
- **Rows are updated one at a time, not in a single bulk `UPDATE`.** One statement over
  the whole batch would be faster, but a single bad row would roll back the batch and
  there would be no way to say which entity failed. Per-row updates buy per-entity error
  attribution, which is what makes the logs useful.
- **Stats are aggregated from the logs table** with a `GROUP BY` on each request rather
  than kept as running counters on the `bulk_actions` row. At millions of log rows the
  counters would win; at this scale aggregation is simpler and cannot drift out of sync
  with reality.
- **Rate limiting uses a fixed window, not a sliding one.** A burst spanning a minute
  boundary can therefore briefly allow up to twice the limit. A sliding window fixes that
  and costs materially more complexity than this scope justifies.
- **Progress is polled** through `GET /bulk-actions/:id` rather than pushed over SSE or
  websockets. For an API-only scope, polling is sufficient and keeps the API stateless.
- **Entity ids are loaded into memory at creation time** to build the batches. At a
  million entities this would become an `INSERT ... SELECT` that builds the batch rows
  inside Postgres and never ships the ids to the application at all.
- **There is no authentication.** `accountId` is taken from the request body and trusted.
  Real deployment would derive it from an authenticated session, and every query is
  already scoped by it.
- **Creation is not wrapped in a transaction.** The action row, skipped logs, batch rows
  and entity total are four separate statements, so a crash mid-creation could leave an
  action with only some of its batches. Wrapping them in a single `BEGIN`/`COMMIT` on one
  pooled client is the correct fix and is not done yet.
