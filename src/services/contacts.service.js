const { listContacts: selectContacts, countContacts } = require('../queries/contacts.queries');

async function listContacts(params) {
  const limit = Number(params.limit) || 20;
  const offset = Number(params.offset) || 0;

  const data = await selectContacts({ limit, offset });
  const total = await countContacts();

  return { total, limit, offset, data };
}

module.exports = { listContacts };
