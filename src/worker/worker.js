require('dotenv').config();

const { pool } = require('../config/db');
const { claimNextBatch } = require('../queries/batches.queries');
const { processBatch } = require('./processBatch');

const IDLE_SLEEP_MS = 2000;

let running = true;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function stopAfterCurrentBatch() {
  console.log('Shutdown requested, finishing current batch');
  running = false;
}

async function runWorker() {
  console.log('Worker started');

  while (running) {
    const batch = await claimNextBatch();

    if (!batch) {
      await sleep(IDLE_SLEEP_MS);
      continue;
    }

    await processBatch(batch);
  }

  await pool.end();
  console.log('Worker stopped');
}

process.on('SIGINT', stopAfterCurrentBatch);

runWorker();
