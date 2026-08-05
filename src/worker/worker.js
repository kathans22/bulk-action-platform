require('dotenv').config();

const { pool } = require('../config/db');
const {
  claimNextBatch,
  resetBatchToPending,
  markBatchFailed
} = require('../queries/batches.queries');
const { processBatch, completeBulkActionIfLastBatch } = require('./processBatch');

const IDLE_SLEEP_MS = 2000;
const MAX_ATTEMPTS = 3;

let running = true;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function stopAfterCurrentBatch() {
  console.log('Shutdown requested, finishing current batch');
  running = false;
}

async function handleBatchFailure(batch, error) {
  if (batch.attempts < MAX_ATTEMPTS) {
    console.log(`Batch ${batch.id} failed on attempt ${batch.attempts}, retrying: ${error.message}`);
    await resetBatchToPending(batch.id);
    return;
  }

  console.log(`Batch ${batch.id} failed after ${batch.attempts} attempts: ${error.message}`);
  await markBatchFailed(batch.id, error.message);
  await completeBulkActionIfLastBatch(batch.bulk_action_id);
}

async function runWorker() {
  console.log('Worker started');

  while (running) {
    const batch = await claimNextBatch();

    if (!batch) {
      await sleep(IDLE_SLEEP_MS);
      continue;
    }

    try {
      await processBatch(batch);
    } catch (error) {
      await handleBatchFailure(batch, error);
    }
  }

  await pool.end();
  console.log('Worker stopped');
}

process.on('SIGINT', stopAfterCurrentBatch);

runWorker();
