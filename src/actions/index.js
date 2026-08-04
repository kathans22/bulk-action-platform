const bulkUpdate = require('./bulkUpdate');

// To add a new bulk action (bulk_delete, bulk_assign), create one file in this
// folder exporting validateConfiguration and buildStatement, then add one line
// to actionHandlers. Nothing else in the codebase changes.
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
