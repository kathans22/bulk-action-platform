// Every entity the platform can run bulk actions on. To support Companies or
// Leads later, add one object here — no other file changes needed.
const entities = {
  contact: {
    table: 'contacts',
    updatableFields: ['name', 'email', 'age', 'status'],
    dedupeField: 'email'
  }
};

function getEntityConfig(entityType) {
  const config = entities[entityType];

  if (!config) {
    const supported = Object.keys(entities).join(', ');
    throw new Error(`Unknown entity type "${entityType}". Supported entity types: ${supported}`);
  }

  return config;
}

module.exports = { getEntityConfig };
