const { query } = require('../config/db');

// The ids a bulk action will act on. Ordered so batches are built the same way
// every time.
async function getContactIdsByAccount(accountId) {
  const result = await query(
    'SELECT id FROM contacts WHERE account_id = $1 ORDER BY id',
    [accountId]
  );

  return result.rows.map((row) => row.id);
}

async function getContactsByIds(ids) {
  const result = await query('SELECT * FROM contacts WHERE id = ANY($1) ORDER BY id', [ids]);
  return result.rows;
}

async function listContacts({ limit, offset }) {
  const result = await query(
    'SELECT * FROM contacts ORDER BY id LIMIT $1 OFFSET $2',
    [limit, offset]
  );

  return result.rows;
}

async function countContacts() {
  const result = await query('SELECT COUNT(*) FROM contacts');
  return Number(result.rows[0].count);
}

module.exports = {
  getContactIdsByAccount,
  getContactsByIds,
  listContacts,
  countContacts
};
