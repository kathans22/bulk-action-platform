const { query } = require('../config/db');

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

async function claimNextBatch() {
  const result = await query(
    `UPDATE bulk_action_batches
     SET status = 'processing', attempts = attempts + 1
     WHERE id = (
       SELECT b.id
       FROM bulk_action_batches b
       JOIN bulk_actions a ON a.id = b.bulk_action_id
       WHERE b.status = 'pending'
         AND (a.scheduled_at IS NULL OR a.scheduled_at <= NOW())
       ORDER BY b.id
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`
  );

  return result.rows[0];
}

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
  claimNextBatch,
  countPendingBatches,
  markBatchDone,
  markBatchFailed
};
