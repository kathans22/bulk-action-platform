const { pool, query } = require('../src/config/db');

const ACCOUNT_ID = 'acc_1';
const TOTAL_CONTACTS = 5000;
const ROWS_PER_INSERT = 500;

function randomAge() {
  return 18 + Math.floor(Math.random() * 48);
}

// Every 10th contact reuses an earlier email, so roughly 10% of the rows are
// duplicates for the de-duplication feature to skip.
function buildEmail(number) {
  const owner = number % 10 === 0 ? number - 9 : number;
  return `contact${owner}@example.com`;
}

function buildContact(number) {
  const status = number % 2 === 0 ? 'inactive' : 'active';
  return [ACCOUNT_ID, `Contact ${number}`, buildEmail(number), randomAge(), status];
}

// One INSERT with many VALUES rows is far fewer round trips than one per contact.
async function insertContacts(contacts) {
  const values = [];
  const rows = contacts.map((contact) => {
    const start = values.length;
    values.push(...contact);
    return `($${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5})`;
  });

  await query(
    `INSERT INTO contacts (account_id, name, email, age, status) VALUES ${rows.join(', ')}`,
    values
  );
}

async function seed() {
  let inserted = 0;

  while (inserted < TOTAL_CONTACTS) {
    const contacts = [];
    for (let i = 0; i < ROWS_PER_INSERT; i++) {
      contacts.push(buildContact(inserted + i + 1));
    }

    await insertContacts(contacts);
    inserted += contacts.length;
  }

  console.log(`Inserted ${inserted} contacts`);
  await pool.end();
}

seed();
