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
