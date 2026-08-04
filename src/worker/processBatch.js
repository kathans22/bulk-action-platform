const { query } = require('../config/db');
const { getEntityConfig } = require('../entities');
const { getActionHandler } = require('../actions');
const { getBulkActionById } = require('../queries/bulkActions.queries');
const { getContactsByIds } = require('../queries/contacts.queries');

function fetchEntities(entityType, entityIds) {
  if (entityType === 'contact') {
    return getContactsByIds(entityIds);
  }

  throw new Error(`No entity lookup for entity type "${entityType}"`);
}

async function processBatch(batch) {
  const bulkAction = await getBulkActionById(batch.bulk_action_id);
  const entityConfig = getEntityConfig(bulkAction.entity_type);
  const handler = getActionHandler(bulkAction.action_type);
  const entities = await fetchEntities(bulkAction.entity_type, batch.entity_ids);

  const statement = handler.buildStatement(entityConfig, bulkAction.configuration);

  for (const entity of entities) {
    await query(statement.sql, [...statement.values, entity.id]);
  }

  console.log(`Batch ${batch.id} applied ${bulkAction.action_type} to ${entities.length} entities`);
}

module.exports = { processBatch };
