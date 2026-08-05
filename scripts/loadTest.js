require('dotenv').config();

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const ACCOUNT_ID = process.env.LOAD_TEST_ACCOUNT_ID || 'acc_1';
const POLL_INTERVAL_MS = 1000;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function createBulkAction() {
  const response = await fetch(`${BASE_URL}/bulk-actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountId: ACCOUNT_ID,
      entityType: 'contact',
      actionType: 'bulk_update',
      configuration: { fields: { status: 'load_tested' } }
    })
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(`Create failed with ${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

async function fetchStats(bulkActionId) {
  const response = await fetch(`${BASE_URL}/bulk-actions/${bulkActionId}/stats`);
  return response.json();
}

async function waitForCompletion(bulkActionId) {
  while (true) {
    const stats = await fetchStats(bulkActionId);
    console.log(
      `success=${stats.success} failed=${stats.failed} skipped=${stats.skipped} pending=${stats.pending}`
    );

    if (stats.pending <= 0) {
      return stats;
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

async function runLoadTest() {
  const bulkAction = await createBulkAction();
  console.log(`Created bulk action ${bulkAction.id} over ${bulkAction.totalEntities} entities`);

  const startedAt = Date.now();
  const stats = await waitForCompletion(bulkAction.id);
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  const entitiesPerMinute = Math.round((stats.total / elapsedSeconds) * 60);

  console.log(`Processed ${stats.total} entities in ${elapsedSeconds.toFixed(1)} seconds`);
  console.log(`Throughput: ${entitiesPerMinute} entities per minute`);
}

runLoadTest();
