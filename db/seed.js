const { pool, query } = require('../src/config/db');

const ACCOUNT_ID = 'acc_1';
const TOTAL_CONTACTS = 5000;
const ROWS_PER_INSERT = 500;
const DUPLICATE_EVERY = 10;

function randomAge() {
  return 18 + Math.floor(Math.random() * 48);
}

function buildEmail(number) {
  const owner = number % DUPLICATE_EVERY === 0 ? number - DUPLICATE_EVERY + 1 : number;
  return `contact${owner}@example.com`;
}

function buildContact(number) {
  const status = number % 2 === 0 ? 'inactive' : 'active';
  return [ACCOUNT_ID, `Contact ${number}`, buildEmail(number), randomAge(), status];
}

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
