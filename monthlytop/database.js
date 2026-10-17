const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');
const { Pool } = require('pg');

function normalizePgRow(row) {
  if (!row) return row;
  const numericFields = new Set(['id', 'n', 'c', 'amount_cents', 'total_cents', 'month_cents', 'all_cents', 'boosts', 'supporters', 'rank', 'category_rank', 'listings', 'boosts_month', 'amount_paise', 'sort', 'builtin', 'is_demo', 'hidden', 'live']);
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key] = value instanceof Date ? value.toISOString() : numericFields.has(key) && value !== null && (key !== 'id' || /^\d+$/.test(String(value))) ? Number(value) : value;
  }
  return normalized;
}

function postgresSql(sql) {
  const insertIgnore = /\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(sql);
  let output = '';
  let parameter = 0;
  let inSingleQuote = false;
  for (let index = 0; index < sql.length; index++) {
    const char = sql[index];
    if (char === "'" && sql[index + 1] === "'") {
      output += "''";
      index++;
      continue;
    }
    if (char === "'") inSingleQuote = !inSingleQuote;
    if (char === '?' && !inSingleQuote) output += `$${++parameter}`;
    else output += char;
  }
  output = output.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO');
  output = output.replace(/datetime\('now','-3 day'\)/gi, "CURRENT_TIMESTAMP - INTERVAL '3 days'");
  output = output.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
  output = output.replace(/\bLIKE\b/g, 'ILIKE');
  if (/^\s*INSERT\s+INTO\s+boosts\b/i.test(output) && !/\bRETURNING\b/i.test(output)) output += ' RETURNING id';
  if (insertIgnore && !/\bON\s+CONFLICT\b/i.test(output)) {
    const hasSemicolon = output.trimEnd().endsWith(';');
    output = output.trim().replace(/;$/, '') + ' ON CONFLICT DO NOTHING' + (hasSemicolon ? ';' : '');
  }
  return output;
}

function createPostgresDb(pool, ownsPool = false) {
  const query = (sql, values) => pool.query(postgresSql(sql), values);
  return {
    dialect: 'postgres',
    async exec(sql) { await pool.query(sql); },
    prepare(sql) {
      return {
        async get(...args) {
          const result = await query(sql, args);
          return normalizePgRow(result.rows[0]);
        },
        async all(...args) {
          const result = await query(sql, args);
          return result.rows.map(normalizePgRow);
        },
        async run(...args) {
          const result = await query(sql, args);
          return { changes: result.rowCount, lastInsertRowid: result.rows[0] ? Number(result.rows[0].id) : undefined };
        },
      };
    },
    async transaction(callback) {
      if (typeof pool.connect !== 'function') throw new Error('Postgres transaction requires a pool connection.');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await callback(createPostgresDb(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async close() { if (ownsPool) await pool.end(); },
  };
}

async function createSqliteDb(file) {
  const SQL = await initSqlJs();
  const raw = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
  let transactionDepth = 0;
  const persist = () => {
    const temporaryFile = file + '.tmp';
    fs.writeFileSync(temporaryFile, Buffer.from(raw.export()));
    fs.renameSync(temporaryFile, file);
  };
  const toBind = (args) => {
    if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      const values = {};
      for (const key of Object.keys(args[0])) values['@' + key] = args[0][key] === undefined ? null : args[0][key];
      return values;
    }
    return args.map((value) => value === undefined ? null : value);
  };
  const database = {
    dialect: 'sqlite',
    async exec(sql) { raw.exec(sql); if (!transactionDepth) persist(); },
    prepare(sql) {
      return {
        async get(...args) {
          const statement = raw.prepare(sql);
          try { if (args.length) statement.bind(toBind(args)); return statement.step() ? statement.getAsObject() : undefined; }
          finally { statement.free(); }
        },
        async all(...args) {
          const statement = raw.prepare(sql);
          try {
            if (args.length) statement.bind(toBind(args));
            const rows = [];
            while (statement.step()) rows.push(statement.getAsObject());
            return rows;
          } finally { statement.free(); }
        },
        async run(...args) {
          const statement = raw.prepare(sql);
          try { if (args.length) statement.bind(toBind(args)); statement.step(); }
          finally { statement.free(); }
          const changes = raw.getRowsModified();
          const lastInsertRowid = raw.exec('SELECT last_insert_rowid()')[0].values[0][0];
          if (!transactionDepth) persist();
          return { changes, lastInsertRowid };
        },
      };
    },
    async transaction(callback) {
      raw.exec('BEGIN');
      transactionDepth++;
      try {
        const result = await callback(database);
        raw.exec('COMMIT');
        transactionDepth--;
        if (!transactionDepth) persist();
        return result;
      } catch (error) {
        raw.exec('ROLLBACK');
        transactionDepth--;
        if (!transactionDepth) persist();
        throw error;
      }
    },
    async close() { raw.close(); },
  };
  return database;
}

const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  slug TEXT PRIMARY KEY, name TEXT NOT NULL, blurb TEXT, icon TEXT,
  builtin INTEGER NOT NULL DEFAULT 0, is_demo INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 1000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, url TEXT NOT NULL, platform TEXT NOT NULL,
  title TEXT NOT NULL, description TEXT NOT NULL, image TEXT,
  category TEXT, pending_category TEXT,
  hidden INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL DEFAULT 0, is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS boosts (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  listing_id TEXT NOT NULL, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL, period TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', stripe_session TEXT, stripe_payment_intent TEXT,
  payment_session TEXT, payment_reference TEXT,
  display_name TEXT, message TEXT, email TEXT, is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, paid_at TIMESTAMPTZ
);
ALTER TABLE boosts ADD COLUMN IF NOT EXISTS payment_session TEXT;
ALTER TABLE boosts ADD COLUMN IF NOT EXISTS payment_reference TEXT;
CREATE INDEX IF NOT EXISTS idx_boosts_period ON boosts(period, status);
CREATE INDEX IF NOT EXISTS idx_boosts_listing ON boosts(listing_id, status);
CREATE INDEX IF NOT EXISTS idx_listings_cat ON listings(category);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, name TEXT, email TEXT, body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
`;

async function openDatabase({ file, connectionString }) {
  if (connectionString) {
    const pool = new Pool({ connectionString, max: Number(process.env.PG_POOL_MAX || (process.env.VERCEL ? 3 : 10)), idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000 });
    const database = createPostgresDb(pool, true);
    await database.exec(POSTGRES_SCHEMA);
    return database;
  }
  return createSqliteDb(file);
}

module.exports = { openDatabase, createPostgresDb, postgresSql, POSTGRES_SCHEMA };
