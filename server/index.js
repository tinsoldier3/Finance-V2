import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, applyRules } from './db.js';
import { normalizeCsv, hashRows } from './csv.js';
import { registerPlanning } from './planning.js';

const app = express();
app.use(express.json({ limit: '20mb' }));
const wrap = (fn) => (req, res) => {
  try { res.json(fn(req, res) ?? { ok: true }); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
};
const monthOf = (m) => (/^\d{4}-\d{2}$/.test(m || '') ? m : new Date().toISOString().slice(0, 7));
const monthRange = (m) => {
  const [y, mo] = m.split('-').map(Number);
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  return [`${m}-01`, `${next}-01`];
};

// ---------- accounts ----------
const ACCOUNT_SQL = `
  SELECT a.*, a.opening_balance + COALESCE(SUM(t.amount), 0) AS balance, COUNT(t.id) AS tx_count
  FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id`;
app.get('/api/accounts', wrap(() => db.prepare(`${ACCOUNT_SQL} GROUP BY a.id ORDER BY a.type, a.name`).all()));
app.post('/api/accounts', wrap((req) => {
  const { name, institution = '', type = 'checking', opening_balance = 0 } = req.body;
  if (!name) throw new Error('name required');
  const r = db.prepare('INSERT INTO accounts (name, institution, type, opening_balance) VALUES (?,?,?,?)')
    .run(name, institution, type, Number(opening_balance));
  return db.prepare(`${ACCOUNT_SQL} WHERE a.id = ? GROUP BY a.id`).get(r.lastInsertRowid);
}));
app.patch('/api/accounts/:id', wrap((req) => {
  let { name, institution, type, opening_balance, current_balance } = req.body;
  if (current_balance != null && current_balance !== '') {
    // set the starting balance so the account's computed balance equals what the bank shows today
    const sum = db.prepare('SELECT COALESCE(SUM(amount), 0) s FROM transactions WHERE account_id = ?').get(req.params.id).s;
    opening_balance = Math.round((Number(current_balance) - sum) * 100) / 100;
  }
  db.prepare(`UPDATE accounts SET name = COALESCE(?, name), institution = COALESCE(?, institution),
    type = COALESCE(?, type), opening_balance = COALESCE(?, opening_balance) WHERE id = ?`)
    .run(name ?? null, institution ?? null, type ?? null, opening_balance ?? null, req.params.id);
}));
app.delete('/api/accounts/:id', wrap((req) => { db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id); }));

// ---------- categories ----------
app.get('/api/categories', wrap(() => db.prepare('SELECT * FROM categories ORDER BY kind, name').all()));
app.post('/api/categories', wrap((req) => {
  const { name, kind = 'expense', color = '#888888' } = req.body;
  const r = db.prepare('INSERT INTO categories (name, kind, color) VALUES (?,?,?)').run(name, kind, color);
  return { id: Number(r.lastInsertRowid), name, kind, color };
}));

// ---------- transactions ----------
const TX_SQL = `
  SELECT t.id, t.account_id, t.date, t.description, t.amount, t.category_id, t.notes,
         a.name AS account_name, c.name AS category_name, c.color AS category_color, c.kind AS category_kind
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN categories c ON c.id = t.category_id`;
app.get('/api/transactions', wrap((req) => {
  const { month, account, category, q, uncategorized, limit = 500 } = req.query;
  const where = [], p = [];
  if (month) { const [a, b] = monthRange(month); where.push('t.date >= ? AND t.date < ?'); p.push(a, b); }
  if (account) { where.push('t.account_id = ?'); p.push(account); }
  if (category) { where.push('t.category_id = ?'); p.push(category); }
  if (uncategorized) where.push('t.category_id IS NULL');
  if (q) { where.push('t.description LIKE ?'); p.push(`%${q}%`); }
  return db.prepare(`${TX_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.date DESC, t.id DESC LIMIT ?`).all(...p, Number(limit));
}));
app.post('/api/transactions', wrap((req) => {
  const { account_id, date, description, amount, category_id = null, notes = '' } = req.body;
  if (!account_id || !date || !description || amount == null) throw new Error('account_id, date, description, amount required');
  const r = db.prepare('INSERT INTO transactions (account_id, date, description, amount, category_id, notes) VALUES (?,?,?,?,?,?)')
    .run(account_id, date, description, Number(amount), category_id, notes);
  return { id: Number(r.lastInsertRowid) };
}));
app.patch('/api/transactions/:id', wrap((req) => {
  const b = req.body, sets = [], p = [];
  for (const k of ['date', 'description', 'amount', 'category_id', 'notes', 'account_id']) {
    if (k in b) { sets.push(`${k} = ?`); p.push(b[k]); }
  }
  if (sets.length) db.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`).run(...p, req.params.id);
}));
app.delete('/api/transactions/:id', wrap((req) => { db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id); }));

// ---------- CSV import ----------
const importOpts = (b) => ({ invertSigns: !!b.invertSigns, dateFormat: b.dateFormat === 'dmy' ? 'dmy' : 'mdy', mapping: b.mapping });
app.post('/api/import/preview', wrap((req) => {
  const { account_id, csv } = req.body;
  if (!csv) throw new Error('csv required');
  const n = normalizeCsv(csv, importOpts(req.body));
  const hashed = account_id ? hashRows(account_id, n.rows) : [];
  const exists = db.prepare('SELECT 1 FROM transactions WHERE hash = ?');
  const dupes = hashed.filter((r) => exists.get(r.hash)).length;
  const dates = n.rows.map((r) => r.date).sort();
  return {
    headers: n.headers, mapping: n.mapping, needsMapping: n.needsMapping, skipped: n.skipped,
    total: n.rows.length, duplicates: dupes, fresh: n.rows.length - dupes,
    range: dates.length ? [dates[0], dates[dates.length - 1]] : null,
    sample: n.rows.slice(0, 8),
  };
}));
app.post('/api/import', wrap((req) => {
  const { account_id, csv } = req.body;
  if (!account_id || !csv) throw new Error('account_id and csv required');
  const n = normalizeCsv(csv, importOpts(req.body));
  if (n.needsMapping) throw new Error('Could not detect columns; choose them in the import dialog');
  const ins = db.prepare('INSERT OR IGNORE INTO transactions (account_id, date, description, amount, hash) VALUES (?,?,?,?,?)');
  let added = 0;
  db.exec('BEGIN');
  for (const t of hashRows(account_id, n.rows)) added += Number(ins.run(account_id, t.date, t.description, t.amount, t.hash).changes);
  db.exec('COMMIT');
  const categorized = applyRules(true);
  return { parsed: n.rows.length, added, duplicates: n.rows.length - added, skipped: n.skipped, categorized };
}));

// ---------- budgets ----------
app.get('/api/budgets', wrap((req) => {
  const month = monthOf(req.query.month), [a, b] = monthRange(month);
  const rows = db.prepare(`
    SELECT c.id AS category_id, c.name, c.color, COALESCE(b.amount, 0) AS budget,
           COALESCE(-SUM(t.amount), 0) AS spent
    FROM categories c
    LEFT JOIN budgets b ON b.category_id = c.id
    LEFT JOIN transactions t ON t.category_id = c.id AND t.date >= ? AND t.date < ?
    WHERE c.kind = 'expense'
    GROUP BY c.id ORDER BY (b.amount IS NULL), c.name`).all(a, b);
  return { month, rows };
}));
app.put('/api/budgets/:categoryId', wrap((req) => {
  const amount = Number(req.body.amount);
  if (!(amount > 0)) db.prepare('DELETE FROM budgets WHERE category_id = ?').run(req.params.categoryId);
  else db.prepare('INSERT INTO budgets (category_id, amount) VALUES (?, ?) ON CONFLICT(category_id) DO UPDATE SET amount = excluded.amount')
    .run(req.params.categoryId, amount);
}));

// ---------- rules ----------
app.get('/api/rules', wrap(() => db.prepare(`SELECT r.*, c.name AS category_name FROM rules r JOIN categories c ON c.id = r.category_id ORDER BY r.id`).all()));
app.post('/api/rules', wrap((req) => {
  const { pattern, category_id, apply = true } = req.body;
  if (!pattern || !category_id) throw new Error('pattern and category_id required');
  db.prepare('INSERT INTO rules (pattern, category_id) VALUES (?, ?)').run(pattern.trim(), category_id);
  return { applied: apply ? applyRules(true) : 0 };
}));
app.delete('/api/rules/:id', wrap((req) => { db.prepare('DELETE FROM rules WHERE id = ?').run(req.params.id); }));
app.post('/api/rules/apply', wrap((req) => ({ applied: applyRules(!req.body?.overwrite) })));

registerPlanning(app, wrap);

// ---------- dashboard summary ----------
app.get('/api/summary', wrap((req) => {
  const month = monthOf(req.query.month), [a, b] = monthRange(month);
  const accounts = db.prepare(`${ACCOUNT_SQL} GROUP BY a.id`).all();
  const assets = accounts.filter((x) => x.balance > 0).reduce((s, x) => s + x.balance, 0);
  const debts = accounts.filter((x) => x.balance < 0).reduce((s, x) => s + x.balance, 0);

  const spendingByCategory = db.prepare(`
    SELECT COALESCE(c.name, 'Uncategorized') AS name, COALESCE(c.color, '#cccccc') AS color, -SUM(t.amount) AS value
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.date >= ? AND t.date < ? AND t.amount < 0 AND COALESCE(c.kind, 'expense') = 'expense'
    GROUP BY c.id ORDER BY value DESC`).all(a, b);

  const cash = db.prepare(`
    SELECT substr(t.date, 1, 7) AS month,
           SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS income,
           -SUM(CASE WHEN t.amount < 0 THEN t.amount ELSE 0 END) AS spending
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    WHERE COALESCE(c.kind, CASE WHEN t.amount > 0 THEN 'income' ELSE 'expense' END) != 'transfer'
    GROUP BY month ORDER BY month DESC LIMIT 12`).all().reverse();

  // net worth history: balance at the end of each month
  const flows = db.prepare(`SELECT substr(date,1,7) AS month, SUM(amount) AS net FROM transactions GROUP BY month ORDER BY month`).all();
  const opening = accounts.reduce((s, x) => s + x.opening_balance, 0);
  let run = opening;
  const netWorthHistory = flows.map((f) => ({ month: f.month, netWorth: (run += f.net) })).slice(-12);

  const recent = db.prepare(`${TX_SQL} ORDER BY t.date DESC, t.id DESC LIMIT 8`).all();
  const budgetRows = db.prepare(`
    SELECT c.name, c.color, b.amount AS budget,
           COALESCE((SELECT -SUM(amount) FROM transactions WHERE category_id = c.id AND date >= ? AND date < ?), 0) AS spent
    FROM budgets b JOIN categories c ON c.id = b.category_id`).all(a, b);
  const uncategorized = db.prepare('SELECT COUNT(*) n FROM transactions WHERE category_id IS NULL').get().n;

  return { month, netWorth: assets + debts, assets, debts, accounts, spendingByCategory, cash, netWorthHistory, recent, budgets: budgetRows, uncategorized };
}));

// ---------- static (production build) ----------
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../web/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API on http://localhost:${port}`));
