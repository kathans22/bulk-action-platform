const { query } = require('../config/db');

async function addEventsToCurrentWindow(accountId, eventCount) {
  const result = await query(
    `INSERT INTO rate_limits (account_id, window_start, event_count)
     VALUES ($1, date_trunc('minute', NOW()), $2)
     ON CONFLICT (account_id, window_start)
     DO UPDATE SET event_count = rate_limits.event_count + $2
     RETURNING event_count`,
    [accountId, eventCount]
  );

  return Number(result.rows[0].event_count);
}

module.exports = { addEventsToCurrentWindow };
