const { query } = require('../config/db');
const { getEntityConfig } = require('../entities');
const { getActionHandler } = require('../actions');
const { getBulkActionById } = require('../queries/bulkActions.queries');
const { getContactsByIds } = require('../queries/contacts.queries');
const { insertLogs } = require('../queries/logs.queries');
const { markBatchDone } = require('../queries/batches.queries');

function fetchEntities(entityType, entityIds) {
  if (entityType === 'contact') {
    return getContactsByIds(entityIds);
  }

  throw new Error(`No entity lookup for entity type "${entityType}"`);
}

async function applyToEntity(statement, entity) {
  try {
    await query(statement.sql, [...statement.values, entity.id]);
    return { entityId: entity.id, status: 'success', message: null };
  } catch (error) {
    return { entityId: entity.id, status: 'failed', message: error.message };
  }
}

async function processBatch(batch) {
  const bulkAction = await getBulkActionById(batch.bulk_action_id);
  const entityConfig = getEntityConfig(bulkAction.entity_type);
  const handler = getActionHandler(bulkAction.action_type);
  const entities = await fetchEntities(bulkAction.entity_type, batch.entity_ids);

  const statement = handler.buildStatement(entityConfig, bulkAction.configuration);
  const results = [];

  for (const entity of entities) {
    results.push(await applyToEntity(statement, entity));
  }

  if (results.length > 0) {
    await insertLogs(bulkAction.id, results);
  }

  await markBatchDone(batch.id);

  console.log(`Batch ${batch.id} applied ${bulkAction.action_type} to ${results.length} entities`);
}

module.exports = { processBatch };
