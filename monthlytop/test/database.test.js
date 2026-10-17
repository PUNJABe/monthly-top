const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb, DataType } = require('pg-mem');
const { createPostgresDb, postgresSql, POSTGRES_SCHEMA } = require('../database');

test('Postgres SQL conversion numbers placeholders and preserves quoted question marks', () => {
  assert.equal(postgresSql("SELECT '?' AS mark, value FROM sample WHERE id=?"), "SELECT '?' AS mark, value FROM sample WHERE id=$1");
  assert.equal(postgresSql('INSERT OR IGNORE INTO sample (value) VALUES (?)'), 'INSERT INTO sample (value) VALUES ($1) ON CONFLICT DO NOTHING');
  assert.equal(postgresSql("DELETE FROM listings WHERE created_at < datetime('now','-3 day')"), "DELETE FROM listings WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '3 days'");
});

test('Postgres adapter returns generated IDs and commits transactions', async () => {
  const memory = newDb();
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  const database = createPostgresDb(pool, true);
  await database.exec(`CREATE TABLE boosts (
    id SERIAL PRIMARY KEY,
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
  )`);

  const inserted = await database.prepare('INSERT INTO boosts (amount_cents) VALUES (?)').run(2500);
  assert.equal(inserted.lastInsertRowid, 1);
  assert.deepEqual(await database.prepare('SELECT id,amount_cents,status FROM boosts WHERE id=?').get(1), {
    id: 1,
    amount_cents: 2500,
    status: 'pending',
  });

  await database.transaction(async (transaction) => {
    await transaction.prepare("UPDATE boosts SET status='paid' WHERE id=?").run(1);
  });
  assert.equal((await database.prepare('SELECT status FROM boosts WHERE id=?').get(1)).status, 'paid');

  await database.close();
});

test('Postgres adapter rolls back and releases its connection after failure', async () => {
  const statements = [];
  let released = false;
  const client = {
    async query(sql) { statements.push(sql); return { rows: [], rowCount: 0 }; },
    release() { released = true; },
  };
  const pool = { async connect() { return client; } };
  const database = createPostgresDb(pool);
  await assert.rejects(database.transaction(async () => { throw new Error('rollback'); }), /rollback/);
  assert.deepEqual(statements, ['BEGIN', 'ROLLBACK']);
  assert.equal(released, true);
});

test('Postgres schema migrations are repeatable', async () => {
  const memory = newDb({ noAstCoverageCheck: true });
  memory.public.registerFunction({
    name: 'nullif',
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: (value, comparison) => value === comparison ? null : value,
  });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  const database = createPostgresDb(pool, true);
  await database.exec(POSTGRES_SCHEMA);
  await database.exec(POSTGRES_SCHEMA);
  const columns = await database.prepare("SELECT column_name FROM information_schema.columns WHERE table_name='boosts'").all();
  assert.ok(columns.some((column) => column.column_name === 'payment_session'));
  assert.ok(columns.some((column) => column.column_name === 'payment_reference'));
  await database.prepare('INSERT INTO categories (slug,name) VALUES (?,?) ON CONFLICT(slug) DO NOTHING').run('other', 'Other');
  await database.prepare('INSERT INTO listings (id,key,url,platform,title,description) VALUES (?,?,?,?,?,?)').run('listing-test', 'test.example', 'https://test.example/', 'website', 'Test', 'Test listing');
  const boost = await database.prepare('INSERT INTO boosts (listing_id,amount_cents,currency,period,email) VALUES (?,?,?,?,?)').run('listing-test', 2500, 'inr', '2026-10', 'buyer@example.com');
  await database.prepare("UPDATE boosts SET status='paid', paid_at=datetime('now') WHERE id=?").run(boost.lastInsertRowid);
  const leaderboard = await database.prepare(`
    SELECT l.id, SUM(b.amount_cents) AS total_cents, COUNT(b.id) AS boosts
    FROM boosts b JOIN listings l ON l.id=b.listing_id
    WHERE b.status='paid' GROUP BY l.id`).get();
  const supporter = await database.prepare("SELECT COALESCE(NULLIF(b.email,''), CAST(b.id AS TEXT)) AS supporter FROM boosts b WHERE b.status='paid'").get();
  assert.deepEqual(leaderboard, { id: 'listing-test', total_cents: 2500, boosts: 1 });
  assert.equal(supporter.supporter, 'buyer@example.com');
  await database.close();
});
