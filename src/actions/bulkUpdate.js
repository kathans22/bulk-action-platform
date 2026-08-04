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

// Builds the statement that applies this action to ONE row. Every action file
// exports a buildStatement, so the worker runs it without knowing which action
// it is. The caller appends the row id as the last parameter.
//
// Values are always placeholders. Field names are interpolated, which is only
// safe because validateConfiguration has already checked each one against the
// entity's updatableFields list.
function buildStatement(entityConfig, configuration) {
  const names = Object.keys(configuration.fields);
  const assignments = names.map((name, index) => `${name} = $${index + 1}`);
  const values = names.map((name) => configuration.fields[name]);
  const idPlaceholder = `$${names.length + 1}`;

  const sql = `UPDATE ${entityConfig.table}
     SET ${assignments.join(', ')}, updated_at = NOW()
     WHERE id = ${idPlaceholder}`;

  return { sql, values };
}

module.exports = { validateConfiguration, buildStatement };
