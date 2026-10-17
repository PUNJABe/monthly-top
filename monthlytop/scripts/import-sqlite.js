const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();
const initSqlJs = require('sql.js');
const { openDatabase } = require('../database');

const TABLES = ['categories', 'listings', 'boosts', 'messages', 'meta'];
const sourceFile = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data', 'data.db'));

function readTable(database, table) {
  const exists = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!exists) return { columns: [], rows: [] };
  const statement = database.prepare(`SELECT * FROM "${table}"`);
  const columns = statement.getColumnNames();
  const rows = [];
  try {
    while (statement.step()) rows.push(statement.getAsObject());
  } finally {
    statement.free();
  }
  return { columns, rows };
}

function normalizeTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)) return value;
  return value.replace(' ', 'T') + 'Z';
}

async function main() {
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) throw new Error('Set DATABASE_URL to the managed Postgres connection string before importing.');
  if (!fs.existsSync(sourceFile)) throw new Error(`SQLite file not found: ${sourceFile}`);

  const SQL = await initSqlJs();
  const sqlite = new SQL.Database(fs.readFileSync(sourceFile));
  if (!readTable(sqlite, 'categories').columns.length || !readTable(sqlite, 'listings').columns.length) {
    sqlite.close();
    throw new Error('Source database does not contain the current Monthly Top listings schema.');
  }

  const postgres = await openDatabase({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL });
  try {
    await postgres.transaction(async (transaction) => {
      for (const table of TABLES) {
        const { columns, rows } = readTable(sqlite, table);
        if (!columns.length) continue;
        const quotedColumns = columns.map((column) => `"${column.replace(/"/g, '""')}"`).join(',');
        const placeholders = columns.map(() => '?').join(',');
        const statement = transaction.prepare(`INSERT INTO "${table}" (${quotedColumns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`);
        for (const row of rows) {
          const values = columns.map((column) => ['created_at', 'paid_at'].includes(column) ? normalizeTimestamp(row[column]) : row[column]);
          await statement.run(...values);
        }
        console.log(`${table}: ${rows.length} source rows processed`);
      }
      for (const table of ['boosts', 'messages']) {
        await transaction.prepare(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${table}`).get();
      }
    });
    console.log('SQLite import completed. Existing Postgres rows were left unchanged on conflicts.');
  } finally {
    sqlite.close();
    await postgres.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
