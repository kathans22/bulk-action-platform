const { getEntityConfig } = require('../entities');
const { getActionHandler } = require('../actions');
const { getContactIdsByAccount } = require('../queries/contacts.queries');
const { insertBulkAction, setTotalEntities } = require('../queries/bulkActions.queries');
const { insertBatches } = require('../queries/batches.queries');

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

module.exports = { createBulkAction, validateRequest, chunkArray, fetchEntityIds };
