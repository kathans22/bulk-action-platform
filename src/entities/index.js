// Every entity the platform can run bulk actions on. To support Companies or
// Leads later, add one object here — no other file changes needed.
module.exports = {
  contact: {
    table: 'contacts',
    updatableFields: ['name', 'email', 'age', 'status'],
    dedupeField: 'email'
  }
};
