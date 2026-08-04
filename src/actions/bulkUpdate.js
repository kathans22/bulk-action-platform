// Rejects a bulk update configuration before anything is queued, so a bad
// request fails at submit time instead of once per batch inside the worker.
function validateConfiguration(configuration, entityConfig) {
  const fields = configuration && configuration.fields;

  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new Error('configuration.fields is required and must be an object');
  }

  const names = Object.keys(fields);

  if (names.length === 0) {
    throw new Error('configuration.fields must contain at least one field');
  }

  const updatable = entityConfig.updatableFields;

  for (const name of names) {
    if (!updatable.includes(name)) {
      throw new Error(`Field "${name}" is not updatable. Updatable fields: ${updatable.join(', ')}`);
    }
  }
}

module.exports = { validateConfiguration };
