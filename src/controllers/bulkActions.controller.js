const {
  createBulkAction,
  listBulkActions,
  getBulkAction,
  getBulkActionStats
} = require('../services/bulkActions.service');

async function create(req, res) {
  try {
    const bulkAction = await createBulkAction(req.body);
    res.status(201).json(bulkAction);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
}

async function list(req, res) {
  try {
    const bulkActions = await listBulkActions(req.query);
    res.json(bulkActions);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
}

async function detail(req, res) {
  try {
    const bulkAction = await getBulkAction(req.params.id);
    res.json(bulkAction);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
}

async function stats(req, res) {
  try {
    const bulkActionStats = await getBulkActionStats(req.params.id);
    res.json(bulkActionStats);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
}

module.exports = { create, list, detail, stats };
