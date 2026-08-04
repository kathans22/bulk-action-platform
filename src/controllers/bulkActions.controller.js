const { createBulkAction } = require('../services/bulkActions.service');

async function create(req, res) {
  try {
    const bulkAction = await createBulkAction(req.body);
    res.status(201).json(bulkAction);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
}

module.exports = { create };
