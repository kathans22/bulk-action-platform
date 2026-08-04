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
