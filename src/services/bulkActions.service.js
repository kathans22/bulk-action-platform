const { getEntityConfig } = require('../entities');
const { getActionHandler } = require('../actions');
const { getContactIdsByAccount, getContactsByIds } = require('../queries/contacts.queries');
const {
  insertBulkAction,
  setTotalEntities,
  listBulkActions: selectBulkActions,
  countBulkActions,
  getBulkActionById
} = require('../queries/bulkActions.queries');
const { insertBatches } = require('../queries/batches.queries');
const { getStats, getLogs, countLogs, insertLogs } = require('../queries/logs.queries');
const { addEventsToCurrentWindow } = require('../queries/rateLimits.queries');

const BULK_ACTION_STATUSES = ['queued', 'scheduled', 'processing', 'completed', 'failed'];

const LOG_STATUSES = ['success', 'failed', 'skipped'];

const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 100;

const BATCH_ROWS_PER_INSERT = 500;

const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE) || 10000;

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

function fetchEntityIds(entityType, accountId) {
  if (entityType === 'contact') {
    return getContactIdsByAccount(accountId);
  }

  throw badRequest(`No id lookup for entity type "${entityType}"`);
}

function fetchEntities(entityType, entityIds) {
  if (entityType === 'contact') {
    return getContactsByIds(entityIds);
  }

  throw badRequest(`No entity lookup for entity type "${entityType}"`);
}

function findDuplicates(entities, dedupeField) {
  const seenValues = new Set();
  const duplicates = [];

  for (const entity of entities) {
    const value = entity[dedupeField];

    if (seenValues.has(value)) {
      duplicates.push({ entityId: entity.id, value });
    } else {
      seenValues.add(value);
    }
  }

  return duplicates;
}

async function findDuplicateEntities(entityType, entityIds, dedupeField) {
  const entities = await fetchEntities(entityType, entityIds);
  return findDuplicates(entities, dedupeField);
}

async function logDuplicatesAsSkipped(bulkActionId, duplicates, dedupeField) {
  const skippedLogs = duplicates.map((duplicate) => ({
    entityId: duplicate.entityId,
    status: 'skipped',
    message: `duplicate ${dedupeField}: ${duplicate.value}`
  }));

  for (const rows of chunkArray(skippedLogs, BATCH_ROWS_PER_INSERT)) {
    await insertLogs(bulkActionId, rows);
  }
}

function secondsLeftInCurrentMinute() {
  return 60 - new Date().getSeconds();
}

function rateLimitExceeded(accountId) {
  const error = new Error('Rate limit exceeded');
  error.statusCode = 429;
  error.body = {
    error: 'Rate limit exceeded',
    limit: RATE_LIMIT_PER_MINUTE,
    accountId,
    retryAfterSeconds: secondsLeftInCurrentMinute()
  };

  return error;
}

async function enforceEntityRateLimit(accountId, entityCount) {
  const eventsThisWindow = await addEventsToCurrentWindow(accountId, entityCount);

  if (eventsThisWindow > RATE_LIMIT_PER_MINUTE) {
    throw rateLimitExceeded(accountId);
  }
}

function validateScheduledAt(scheduledAt) {
  if (!scheduledAt) {
    return null;
  }

  const date = new Date(scheduledAt);

  if (Number.isNaN(date.getTime())) {
    throw badRequest(`scheduledAt must be a valid ISO timestamp, got "${scheduledAt}"`);
  }

  if (date <= new Date()) {
    throw badRequest('scheduledAt must be in the future');
  }

  return date;
}

async function createBulkAction(body) {
  const { entityConfig } = validateRequest(body);

  const { accountId, entityType, actionType, configuration } = body;
  const scheduledAt = validateScheduledAt(body.scheduledAt);
  const entityIds = await fetchEntityIds(entityType, accountId);

  await enforceEntityRateLimit(accountId, entityIds.length);

  const duplicates = configuration.skipDuplicates
    ? await findDuplicateEntities(entityType, entityIds, entityConfig.dedupeField)
    : [];

  const duplicateIds = new Set(duplicates.map((duplicate) => duplicate.entityId));
  const idsToProcess = entityIds.filter((entityId) => !duplicateIds.has(entityId));

  const bulkAction = await insertBulkAction({
    accountId,
    entityType,
    actionType,
    configuration,
    scheduledAt
  });

  if (duplicates.length > 0) {
    await logDuplicatesAsSkipped(bulkAction.id, duplicates, entityConfig.dedupeField);
  }

  const batches = chunkArray(idsToProcess, BATCH_SIZE);

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

  const processed = stats.reduce((sum, row) => sum + Number(row.count), 0);
  const total = bulkAction.total_entities;
  const percentage = total === 0 ? 0 : Math.round((processed / total) * 100);

  return { ...bulkAction, progress: { processed, total, percentage } };
}

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

async function getBulkActionLogs(id, params) {
  const bulkAction = await findBulkActionOr404(id);
  const status = params.status;

  if (status && !LOG_STATUSES.includes(status)) {
    throw badRequest(`Unknown log status "${status}". Supported statuses: ${LOG_STATUSES.join(', ')}`);
  }

  const limit = Number(params.limit) || 50;
  const offset = Number(params.offset) || 0;

  const data = await getLogs(bulkAction.id, { status, limit, offset });
  const total = await countLogs(bulkAction.id, status);

  return { total, limit, offset, data };
}

module.exports = {
  createBulkAction,
  listBulkActions,
  getBulkAction,
  getBulkActionStats,
  getBulkActionLogs,
  validateRequest,
  chunkArray,
  fetchEntityIds
};
