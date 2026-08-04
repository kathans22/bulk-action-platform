async function processBatch(batch) {
  console.log(`Claimed batch ${batch.id} of bulk action ${batch.bulk_action_id} with ${batch.entity_ids.length} entities`);
}

module.exports = { processBatch };
