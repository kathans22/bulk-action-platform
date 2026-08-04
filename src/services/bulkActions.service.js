const { getEntityConfig } = require('../entities');
const { getActionHandler } = require('../actions');
const { getContactIdsByAccount } = require('../queries/contacts.queries');
const {
  insertBulkAction,
  setTotalEntities,
  listBulkActions: selectBulkActions,
  countBulkActions,
  getBulkActionById
} = require('../queries/bulkActions.queries');
const { insertBatches } = require('../queries/batches.queries');
const { getStats } = require('../queries/logs.queries');

const BULK_ACTION_STATUSES = ['queued', 'scheduled', 'processing', 'completed', 'failed'];

const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 100;

// How many batch rows go into one INSERT. A single INSERT for every batch of a
// million entities would build a 10,000-row statement, so the rows are inserted
// 500 at a time instead.
const BATCH_ROWS_PER_INSERT = 500;

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

// Every :id endpoint needs the same two answers: is it a number, and does it
// exist. A non-numeric id would otherwise reach Postgres and fail as a 500.
async function findBulkActionOr404(id) {
  const bulkActionId = Number(id);

  if (!Number.isInteger(bulkActionId)) {
    throw badRequest(`Bulk action id must be an integer, got "${id}"`);
  }

  const bulkAction = await getBulkActionById(bulkActionId);

  if (!bulkAction) {
    throw notFound(`Bulk action ${bulkActionId} not found`);
  }

  return bulkAction;
}

// Everything the request needs to be valid before anything is written. The two
// registries and the action's own validator all raise client errors, so one
// catch turns the lot into a 400.
function validateRequest({ accountId, entityType, actionType, configuration }) {
  if (!accountId) throw badRequest('accountId is required');
  if (!entityType) throw badRequest('entityType is required');
  if (!actionType) throw badRequest('actionType is required');
  if (!configuration) throw badRequest('configuration is required');

  try {
    const entityConfig = getEntityConfig(entityType);
    const handler = getActionHandler(actionType);
    handler.validateConfiguration(configuration, entityConfig);
    return { entityConfig, handler };
  } catch (error) {
    throw badRequest(error.message);
  }
}

function chunkArray(array, size) {
  const chunks = [];

  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }

  return chunks;
}

// The ids the action will act on. Contacts are the only entity today, so a
// second entity means one more line here.
function fetchEntityIds(entityType, accountId) {
  if (entityType === 'contact') {
    return getContactIdsByAccount(accountId);
  }

  throw badRequest(`No id lookup for entity type "${entityType}"`);
}

// A time in the past means run now, so it is stored as no schedule at all and
// the action is queued. insertBulkAction reads the status off this value.
function futureScheduledAt(scheduledAt) {
  if (!scheduledAt) {
    return null;
  }

  const date = new Date(scheduledAt);

  if (Number.isNaN(date.getTime())) {
    throw badRequest('scheduledAt must be a valid timestamp');
  }

  return date > new Date() ? date : null;
}

async function createBulkAction(body) {
  validateRequest(body);

  const { accountId, entityType, actionType, configuration } = body;
  const scheduledAt = futureScheduledAt(body.scheduledAt);
  const entityIds = await fetchEntityIds(entityType, accountId);

  const bulkAction = await insertBulkAction({
    accountId,
    entityType,
    actionType,
    configuration,
    scheduledAt
  });

  const batches = chunkArray(entityIds, BATCH_SIZE);

  for (const rows of chunkArray(batches, BATCH_ROWS_PER_INSERT)) {
    await insertBatches(bulkAction.id, rows);
  }

  await setTotalEntities(bulkAction.id, entityIds.length);

  return {
    id: bulkAction.id,
    status: bulkAction.status,
    totalEntities: entityIds.length,
    createdAt: bulkAction.created_at
  };
}

// One listing filtered by status is what satisfies the assignment's "display
// ongoing, completed and queued actions": ?status=processing, ?status=completed
// and ?status=queued are the three views it asks for.
async function listBulkActions(params) {
  const status = params.status;

  if (status && !BULK_ACTION_STATUSES.includes(status)) {
    throw badRequest(`Unknown status "${status}". Supported statuses: ${BULK_ACTION_STATUSES.join(', ')}`);
  }

  const limit = Number(params.limit) || 20;
  const offset = Number(params.offset) || 0;
  const accountId = params.accountId;

  const data = await selectBulkActions({ limit, offset, accountId, status });
  const total = await countBulkActions({ accountId, status });

  return { total, limit, offset, data };
}

async function getBulkAction(id) {
  const bulkAction = await findBulkActionOr404(id);
  const stats = await getStats(bulkAction.id);

  // Every entity the worker touched wrote exactly one log row, whatever the
  // outcome, so the log count is how many have been processed.
  const processed = stats.reduce((sum, row) => sum + Number(row.count), 0);
  const total = bulkAction.total_entities;
  const percentage = total === 0 ? 0 : Math.round((processed / total) * 100);

  return { ...bulkAction, progress: { processed, total, percentage } };
}

// Counts are aggregated from the logs table. For millions of rows you would
// keep running counters on the bulk_actions row instead; aggregating is simpler
// and correct at this scale.
async function getBulkActionStats(id) {
  const bulkAction = await findBulkActionOr404(id);
  const rows = await getStats(bulkAction.id);

  const counts = { success: 0, failed: 0, skipped: 0 };

  for (const row of rows) {
    counts[row.status] = Number(row.count);
  }

  const total = bulkAction.total_entities;
  const pending = total - (counts.success + counts.failed + counts.skipped);

  return { bulkActionId: bulkAction.id, total, ...counts, pending };
}

module.exports = {
  createBulkAction,
  listBulkActions,
  getBulkAction,
  getBulkActionStats,
  validateRequest,
  chunkArray,
  fetchEntityIds
};
