const { getEntityConfig } = require('../entities');
const { getActionHandler } = require('../actions');
const { getContactIdsByAccount } = require('../queries/contacts.queries');

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

module.exports = { validateRequest, chunkArray, fetchEntityIds };
