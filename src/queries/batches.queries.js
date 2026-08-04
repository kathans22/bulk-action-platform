const { query } = require('../config/db');

// One INSERT for every batch of the action, so submitting is a single round trip.
async function insertBatches(bulkActionId, entityIdBatches) {
  const values = [];
  const rows = entityIdBatches.map((entityIds) => {
    values.push(bulkActionId, entityIds);
    return `($${values.length - 1}, $${values.length})`;
  });

  await query(
    `INSERT INTO bulk_action_batches (bulk_action_id, entity_ids) VALUES ${rows.join(', ')}`,
    values
  );
}

// A batch a worker is holding is not finished either, so it counts as pending.
// This is what tells us an action still has work left.
async function countPendingBatches(bulkActionId) {
  const result = await query(
    `SELECT COUNT(*) FROM bulk_action_batches
     WHERE bulk_action_id = $1 AND status IN ('pending', 'processing')`,
    [bulkActionId]
  );

  return Number(result.rows[0].count);
}

async function markBatchDone(batchId) {
  await query(
    `UPDATE bulk_action_batches SET status = 'done', processed_at = NOW() WHERE id = $1`,
    [batchId]
  );
}

async function markBatchFailed(batchId, errorMessage) {
  await query(
    `UPDATE bulk_action_batches
     SET status = 'failed', error_message = $2, processed_at = NOW()
     WHERE id = $1`,
    [batchId, errorMessage]
  );
}

module.exports = {
  insertBatches,
  countPendingBatches,
  markBatchDone,
  markBatchFailed
};
