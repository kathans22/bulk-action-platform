const { query } = require('../config/db');

async function insertBulkAction({ accountId, entityType, actionType, configuration, scheduledAt }) {
  // An action with a future run time waits as 'scheduled'; everything else is
  // ready for the worker immediately.
  const status = scheduledAt ? 'scheduled' : 'queued';

  const result = await query(
    `INSERT INTO bulk_actions (account_id, entity_type, action_type, configuration, scheduled_at, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [accountId, entityType, actionType, configuration, scheduledAt || null, status]
  );

  return result.rows[0];
}

async function getBulkActionById(id) {
  const result = await query('SELECT * FROM bulk_actions WHERE id = $1', [id]);
  return result.rows[0];
}

async function listBulkActions({ limit, offset, accountId, status }) {
  const conditions = [];
  const values = [];

  if (accountId) {
    values.push(accountId);
    conditions.push(`account_id = $${values.length}`);
  }

  if (status) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  values.push(limit, offset);

  const result = await query(
    // Newest first. Id breaks ties so paging cannot show the same row twice
    // when several actions share a created_at.
    `SELECT * FROM bulk_actions
     ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return result.rows;
}

async function countBulkActions({ accountId, status }) {
  const conditions = [];
  const values = [];

  if (accountId) {
    values.push(accountId);
    conditions.push(`account_id = $${values.length}`);
  }

  if (status) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(`SELECT COUNT(*) FROM bulk_actions ${where}`, values);
  return Number(result.rows[0].count);
}

async function updateBulkActionStatus(id, status) {
  await query('UPDATE bulk_actions SET status = $2 WHERE id = $1', [id, status]);
}

async function setTotalEntities(id, total) {
  await query('UPDATE bulk_actions SET total_entities = $2 WHERE id = $1', [id, total]);
}

async function markStarted(id) {
  await query(
    `UPDATE bulk_actions SET status = 'processing', started_at = NOW() WHERE id = $1`,
    [id]
  );
}

async function markFinished(id, status) {
  await query(
    'UPDATE bulk_actions SET status = $2, finished_at = NOW() WHERE id = $1',
    [id, status]
  );
}

module.exports = {
  insertBulkAction,
  getBulkActionById,
  listBulkActions,
  countBulkActions,
  updateBulkActionStatus,
  setTotalEntities,
  markStarted,
  markFinished
};
