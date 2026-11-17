import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const file = process.env.DB_PATH || path.join(path.dirname(fileURLToPath(import.meta.url)), 'finance.db');
export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  institution TEXT DEFAULT '',
  type TEXT NOT NULL DEFAULT 'checking',   -- checking|savings|credit|investment|loan|cash
  opening_balance REAL NOT NULL DEFAULT 0  -- credit/loan accounts use negative numbers for debt
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'expense',    -- expense|income|transfer
  color TEXT NOT NULL DEFAULT '#888888'
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,                      -- YYYY-MM-DD
  description TEXT NOT NULL,
  amount REAL NOT NULL,                    -- negative = money out, positive = money in
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  notes TEXT DEFAULT '',
  hash TEXT UNIQUE                         -- dedupe key for imports
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);
CREATE TABLE IF NOT EXISTS budgets (
  category_id INTEGER PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
  amount REAL NOT NULL                     -- monthly limit
);
CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  amount REAL NOT NULL,                    -- positive; typical amount per occurrence
  frequency TEXT NOT NULL DEFAULT 'monthly', -- weekly|biweekly|monthly|quarterly|yearly
  due_date TEXT NOT NULL,                  -- any known due date; other occurrences are derived from it
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  pattern TEXT NOT NULL DEFAULT '',        -- transactions whose description contains this count as payments (defaults to name)
  autopay INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  target REAL NOT NULL,
  target_date TEXT,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL, -- if set, progress = that account's balance
  color TEXT NOT NULL DEFAULT '#2e9e5b'
);
CREATE TABLE IF NOT EXISTS goal_contributions (
  id INTEGER PRIMARY KEY,
  goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount REAL NOT NULL                     -- negative = withdrawal
);
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY,
  pattern TEXT NOT NULL,                   -- case-insensitive "contains" match on description
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE
);
`);

const DEFAULT_CATEGORIES = [
  ['Income', 'income', '#2e9e5b'], ['Paycheck', 'income', '#3dbb6e'], ['Interest', 'income', '#7fd39a'],
  ['Groceries', 'expense', '#f08a24'], ['Restaurants', 'expense', '#e5533d'], ['Coffee Shops', 'expense', '#a0522d'],
  ['Rent & Mortgage', 'expense', '#3b6fd4'], ['Utilities', 'expense', '#5a8fd9'], ['Internet & Phone', 'expense', '#7aa7e3'],
  ['Gas & Fuel', 'expense', '#c9a227'], ['Auto & Transport', 'expense', '#8e6bbf'], ['Shopping', 'expense', '#d6559b'],
  ['Entertainment', 'expense', '#9b59b6'], ['Subscriptions', 'expense', '#b07fd0'], ['Health & Fitness', 'expense', '#1aa6a6'],
  ['Travel', 'expense', '#2c8fbf'], ['Insurance', 'expense', '#6b7a8f'], ['Fees & Charges', 'expense', '#999999'],
  ['Other', 'expense', '#aaaaaa'], ['Transfer', 'transfer', '#bbbbbb'], ['Credit Card Payment', 'transfer', '#cccccc'],
];
if (db.prepare('SELECT COUNT(*) n FROM categories').get().n === 0) {
  const ins = db.prepare('INSERT INTO categories (name, kind, color) VALUES (?, ?, ?)');
  for (const c of DEFAULT_CATEGORIES) ins.run(...c);
}

export function applyRules(onlyUncategorized = true) {
  const rules = db.prepare('SELECT pattern, category_id FROM rules ORDER BY id').all();
  const rows = db.prepare(`SELECT id, description FROM transactions ${onlyUncategorized ? 'WHERE category_id IS NULL' : ''}`).all();
  const upd = db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?');
  let n = 0;
  db.exec('BEGIN');
  for (const r of rows) {
    const d = r.description.toLowerCase();
    const hit = rules.find((x) => d.includes(x.pattern.toLowerCase()));
    if (hit) { upd.run(hit.category_id, r.id); n++; }
  }
  db.exec('COMMIT');
  return n;
}
