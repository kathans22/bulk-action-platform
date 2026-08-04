require('dotenv').config();

const { claimNextBatch } = require('../queries/batches.queries');
const { processBatch } = require('./processBatch');

const IDLE_SLEEP_MS = 2000;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runWorker() {
  console.log('Worker started');

  while (true) {
    const batch = await claimNextBatch();

    if (!batch) {
      await sleep(IDLE_SLEEP_MS);
      continue;
    }

    await processBatch(batch);
  }
}

runWorker();
