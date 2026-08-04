const bulkUpdate = require('./bulkUpdate');

const actionHandlers = {
  bulk_update: bulkUpdate
};

function getActionHandler(actionType) {
  const handler = actionHandlers[actionType];

  if (!handler) {
    const supported = Object.keys(actionHandlers).join(', ');
    throw new Error(`Unknown action type "${actionType}". Supported action types: ${supported}`);
  }

  return handler;
}

module.exports = { getActionHandler };
