const {
  createBulkAction,
  listBulkActions,
  getBulkAction,
  getBulkActionStats,
  getBulkActionLogs
} = require('../services/bulkActions.service');

async function create(req, res, next) {
  try {
    const bulkAction = await createBulkAction(req.body);
    res.status(201).json(bulkAction);
  } catch (error) {
    next(error);
  }
}

async function list(req, res, next) {
  try {
    const bulkActions = await listBulkActions(req.query);
    res.json(bulkActions);
  } catch (error) {
    next(error);
  }
}

async function detail(req, res, next) {
  try {
    const bulkAction = await getBulkAction(req.params.id);
    res.json(bulkAction);
  } catch (error) {
    next(error);
  }
}

async function stats(req, res, next) {
  try {
    const bulkActionStats = await getBulkActionStats(req.params.id);
    res.json(bulkActionStats);
  } catch (error) {
    next(error);
  }
}

async function logs(req, res, next) {
  try {
    const bulkActionLogs = await getBulkActionLogs(req.params.id, req.query);
    res.json(bulkActionLogs);
  } catch (error) {
    next(error);
  }
}

module.exports = { create, list, detail, stats, logs };
