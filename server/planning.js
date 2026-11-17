// Recurring bills + savings goals.
import { db } from './db.js';

const FREQS = { weekly: 7, biweekly: 14, monthly: 30.44, quarterly: 91.3, yearly: 365.25 };
const MONTHLY_FACTOR = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };

const toDate = (s) => new Date(s + 'T00:00:00Z');
const iso = (d) => d.toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
const todayStr = (q) => (/^\d{4}-\d{2}-\d{2}$/.test(q || '') ? q : iso(new Date()));

// k-th occurrence after `anchor`. Months are computed from the anchor each time so "the 31st" stays sane.
export function addPeriod(anchor, freq, k = 1) {
  const d = toDate(anchor);
  if (freq === 'weekly' || freq === 'biweekly') { d.setUTCDate(d.getUTCDate() + k * FREQS[freq]); return iso(d); }
  const months = k * (freq === 'monthly' ? 1 : freq === 'quarterly' ? 3 : 12);
  const day = d.getUTCDate();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return iso(t);
}

// The occurrence just before `today` (or null) and the first on/after it.
export function surroundingDue(anchor, freq, today) {
  let k = 0, prev = null, cur = anchor;
  // walk backwards too, in case the anchor is in the future
  while (cur > today && k > -2000) { k--; cur = addPeriod(anchor, freq, k); }
  while (cur < today) { prev = cur; k++; cur = addPeriod(anchor, freq, k); }
  return { prev, next: cur };
}

function billStatus(b, today) {
  const { prev, next } = surroundingDue(b.due_date, b.frequency, today);
  const pat = (b.pattern || b.name).toLowerCase();
  const last = db.prepare(`SELECT MAX(date) d FROM transactions WHERE amount < 0 AND LOWER(description) LIKE ?`).get(`%${pat}%`).d;
  const paidEarly = last && daysBetween(last, next) <= 5;
  const paidPrev = prev && last && daysBetween(prev, last) >= -5;
  let status = 'upcoming';
  const until = daysBetween(today, next);
  if (paidEarly) status = 'paid';
  else if (prev && !paidPrev && !b.autopay && daysBetween(prev, today) <= 10) status = 'overdue';
  else if (until <= 7) status = 'due_soon';
  return { next_due: next, prev_due: prev, days_until: until, last_paid: last, status };
}

// "NETFLIX.COM 8812" and "Netflix.com 1234" are the same merchant.
const normKey = (d) => d.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function classify(gap) {
  if (gap >= 6 && gap <= 8) return 'weekly';
  if (gap >= 13 && gap <= 16) return 'biweekly';
  if (gap >= 27 && gap <= 34) return 'monthly';
  if (gap >= 85 && gap <= 97) return 'quarterly';
  if (gap >= 350 && gap <= 380) return 'yearly';
  return null;
}

export function detectRecurring(today) {
  const rows = db.prepare(`
    SELECT t.date, t.description, t.amount, t.category_id, c.name AS category_name
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.amount < 0 AND COALESCE(c.kind, 'expense') = 'expense' ORDER BY t.date`).all();
  const groups = new Map();
  for (const r of rows) {
    const k = normKey(r.description);
    if (k.length < 3) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const tracked = db.prepare('SELECT name, pattern FROM bills').all().map((b) => (b.pattern || b.name).toLowerCase());
  const out = [];
  for (const [key, g] of groups) {
    if (g.length < 3) continue;
    // collapse same-day duplicates
    const dates = [...new Set(g.map((x) => x.date))];
    if (dates.length < 3) continue;
    const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
    const med = median(gaps), freq = classify(med);
    if (!freq) continue;
    const tol = freq === 'weekly' || freq === 'biweekly' ? 1 : Math.max(3, med * 0.12); // short cycles must be near-exact, or daily coffee looks like a bill
    const consistent = gaps.filter((x) => Math.abs(x - med) <= tol).length / gaps.length;
    if (consistent < 0.7) continue;
    const amounts = g.map((x) => -x.amount), amt = median(amounts);
    const spread = amounts.filter((a) => Math.abs(a - amt) <= Math.max(1, amt * 0.35)).length / amounts.length;
    if (spread < 0.7) continue; // wildly varying amounts: probably groceries, not a bill
    const last = dates[dates.length - 1];
    if (daysBetween(last, today) > FREQS[freq] * 2) continue; // stopped recurring
    const sample = g[g.length - 1];
    if (tracked.some((t) => key.includes(t) || t.includes(key) || sample.description.toLowerCase().includes(t))) continue;
    const { next } = surroundingDue(last, freq, today);
    out.push({
      name: sample.description.replace(/\s*[#*]?\d+.*$/, '').trim() || sample.description,
      pattern: key, amount: Math.round(amt * 100) / 100, frequency: freq, due_date: next, last_date: last,
      occurrences: dates.length, category_id: sample.category_id, category_name: sample.category_name,
    });
  }
  return out.sort((a, b) => b.amount * MONTHLY_FACTOR[b.frequency] - a.amount * MONTHLY_FACTOR[a.frequency]);
}

export function registerPlanning(app, wrap) {
  // ---------- bills ----------
  const listBills = (today) => db.prepare(`
    SELECT b.*, c.name AS category_name, c.color AS category_color FROM bills b LEFT JOIN categories c ON c.id = b.category_id`).all()
    .map((b) => ({ ...b, monthly: Math.round(b.amount * MONTHLY_FACTOR[b.frequency] * 100) / 100, ...billStatus(b, today) }))
    .sort((a, b) => a.next_due.localeCompare(b.next_due));

  app.get('/api/bills', wrap((req) => {
    const today = todayStr(req.query.today), bills = listBills(today);
    return { bills, monthlyTotal: bills.reduce((s, b) => s + b.monthly, 0), today };
  }));
  app.get('/api/bills/detect', wrap((req) => detectRecurring(todayStr(req.query.today))));
  const billFields = (b) => {
    if (!b.name || !(Number(b.amount) > 0) || !b.due_date) throw new Error('name, a positive amount, and due_date are required');
    if (!(b.frequency in FREQS)) throw new Error('frequency must be one of ' + Object.keys(FREQS).join(', '));
    return [b.name, Number(b.amount), b.frequency, b.due_date, b.category_id || null, (b.pattern || '').trim(), b.autopay ? 1 : 0];
  };
  app.post('/api/bills', wrap((req) => {
    const r = db.prepare('INSERT INTO bills (name, amount, frequency, due_date, category_id, pattern, autopay) VALUES (?,?,?,?,?,?,?)').run(...billFields(req.body));
    return { id: Number(r.lastInsertRowid) };
  }));
  app.patch('/api/bills/:id', wrap((req) => {
    const cur = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
    if (!cur) throw new Error('not found');
    db.prepare('UPDATE bills SET name=?, amount=?, frequency=?, due_date=?, category_id=?, pattern=?, autopay=? WHERE id=?')
      .run(...billFields({ ...cur, ...req.body }), req.params.id);
  }));
  app.delete('/api/bills/:id', wrap((req) => { db.prepare('DELETE FROM bills WHERE id = ?').run(req.params.id); }));

  // ---------- goals ----------
  const goalView = (g, today) => {
    const contribs = db.prepare('SELECT * FROM goal_contributions WHERE goal_id = ? ORDER BY date DESC, id DESC').all(g.id);
    let current, recent;
    const since = iso(new Date(toDate(today).getTime() - 90 * 86400000));
    if (g.account_id) {
      current = db.prepare('SELECT a.opening_balance + COALESCE(SUM(t.amount),0) b FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id WHERE a.id = ?').get(g.account_id).b ?? 0;
      recent = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE account_id = ? AND date >= ? AND date <= ?').get(g.account_id, since, today).s;
    } else {
      current = contribs.reduce((s, c) => s + c.amount, 0);
      recent = contribs.filter((c) => c.date >= since && c.date <= today).reduce((s, c) => s + c.amount, 0);
    }
    const remaining = Math.max(0, g.target - current);
    const pace = recent / 3; // average monthly progress over the last 90 days
    const out = { ...g, current, remaining, pct: g.target ? Math.min(100, (current / g.target) * 100) : 0, pace, contributions: contribs.slice(0, 5) };
    if (remaining === 0) return { ...out, status: 'complete' };
    if (pace > 0) out.projected = iso(new Date(toDate(today).getTime() + (remaining / pace) * 30.44 * 86400000));
    if (g.target_date) {
      const monthsLeft = daysBetween(today, g.target_date) / 30.44;
      out.needed_per_month = monthsLeft > 0 ? remaining / monthsLeft : remaining;
      out.status = monthsLeft <= 0 ? 'overdue' : pace >= out.needed_per_month * 0.95 ? 'on_track' : 'behind';
    } else out.status = 'open';
    return out;
  };
  app.get('/api/goals', wrap((req) => {
    const today = todayStr(req.query.today);
    return db.prepare('SELECT g.*, a.name AS account_name FROM goals g LEFT JOIN accounts a ON a.id = g.account_id ORDER BY g.id').all().map((g) => goalView(g, today));
  }));
  const goalFields = (b) => {
    if (!b.name || !(Number(b.target) > 0)) throw new Error('name and a positive target are required');
    return [b.name, Number(b.target), b.target_date || null, b.account_id || null, b.color || '#2e9e5b'];
  };
  app.post('/api/goals', wrap((req) => {
    const r = db.prepare('INSERT INTO goals (name, target, target_date, account_id, color) VALUES (?,?,?,?,?)').run(...goalFields(req.body));
    return { id: Number(r.lastInsertRowid) };
  }));
  app.patch('/api/goals/:id', wrap((req) => {
    const cur = db.prepare('SELECT * FROM goals WHERE id = ?').get(req.params.id);
    if (!cur) throw new Error('not found');
    db.prepare('UPDATE goals SET name=?, target=?, target_date=?, account_id=?, color=? WHERE id=?').run(...goalFields({ ...cur, ...req.body }), req.params.id);
  }));
  app.delete('/api/goals/:id', wrap((req) => { db.prepare('DELETE FROM goals WHERE id = ?').run(req.params.id); }));
  app.post('/api/goals/:id/contributions', wrap((req) => {
    const amount = Number(req.body.amount);
    if (!amount) throw new Error('amount required (negative to withdraw)');
    db.prepare('INSERT INTO goal_contributions (goal_id, date, amount) VALUES (?,?,?)').run(req.params.id, req.body.date || iso(new Date()), amount);
  }));
  app.delete('/api/goals/:id/contributions/:cid', wrap((req) => { db.prepare('DELETE FROM goal_contributions WHERE id = ? AND goal_id = ?').run(req.params.cid, req.params.id); }));
}
