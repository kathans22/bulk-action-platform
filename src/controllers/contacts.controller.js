const { listContacts } = require('../services/contacts.service');

async function list(req, res, next) {
  try {
    const contacts = await listContacts(req.query);
    res.json(contacts);
  } catch (error) {
    next(error);
  }
}

module.exports = { list };
