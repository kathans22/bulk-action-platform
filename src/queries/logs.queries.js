const { query } = require('../config/db');

async function insertLogs(bulkActionId, logs) {
  const values = [];
  const rows = logs.map((log) => {
    const start = values.length;
    values.push(bulkActionId, log.entityId, log.status, log.message);
    return `($${start + 1}, $${start + 2}, $${start + 3}, $${start + 4})`;
  });

  await query(
    `INSERT INTO bulk_action_logs (bulk_action_id, entity_id, status, message)
     VALUES ${rows.join(', ')}`,
    values
  );
}

async function getLogs(bulkActionId, { status, limit, offset }) {
  const values = [bulkActionId];
  let statusFilter = '';

  if (status) {
    values.push(status);
    statusFilter = `AND status = $${values.length}`;
  }

  values.push(limit, offset);

  const result = await query(
    `SELECT * FROM bulk_action_logs
     WHERE bulk_action_id = $1 ${statusFilter}
     ORDER BY id
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return result.rows;
}

async function countLogs(bulkActionId, status) {
  const values = [bulkActionId];
  let statusFilter = '';

  if (status) {
    values.push(status);
    statusFilter = `AND status = $${values.length}`;
  }

  const result = await query(
    `SELECT COUNT(*) FROM bulk_action_logs WHERE bulk_action_id = $1 ${statusFilter}`,
    values
  );

  return Number(result.rows[0].count);
}

async function getStats(bulkActionId) {
  const result = await query(
    `SELECT status, COUNT(*) FROM bulk_action_logs
     WHERE bulk_action_id = $1
     GROUP BY status`,
    [bulkActionId]
  );

  return result.rows;
}

module.exports = {
  insertLogs,
  getLogs,
  countLogs,
  getStats
};
