// Demo data: `npm run seed` (wipes transactions/accounts/budgets/rules and loads ~6 months of sample data).
import { db, applyRules } from './db.js';

db.exec('DELETE FROM transactions; DELETE FROM accounts; DELETE FROM budgets; DELETE FROM rules;');
const cat = Object.fromEntries(db.prepare('SELECT id, name FROM categories').all().map((c) => [c.name, c.id]));
const acct = (name, institution, type, bal) =>
  Number(db.prepare('INSERT INTO accounts (name, institution, type, opening_balance) VALUES (?,?,?,?)').run(name, institution, type, bal).lastInsertRowid);
const checking = acct('Everyday Checking', 'Demo Bank', 'checking', 2500);
const savings = acct('High-Yield Savings', 'Demo Bank', 'savings', 12000);
const card = acct('Rewards Visa', 'Demo Card', 'credit', -400);

const rules = [
  ['whole foods', 'Groceries'], ['trader joe', 'Groceries'], ['kroger', 'Groceries'],
  ['starbucks', 'Coffee Shops'], ['dunkin', 'Coffee Shops'], ['chipotle', 'Restaurants'], ['doordash', 'Restaurants'],
  ['shell', 'Gas & Fuel'], ['netflix', 'Subscriptions'], ['spotify', 'Subscriptions'], ['amazon', 'Shopping'],
  ['comcast', 'Internet & Phone'], ['electric', 'Utilities'], ['payroll', 'Paycheck'], ['landlord', 'Rent & Mortgage'],
  ['gym', 'Health & Fitness'], ['interest', 'Interest'], ['payment thank you', 'Credit Card Payment'],
];
for (const [p, c] of rules) db.prepare('INSERT INTO rules (pattern, category_id) VALUES (?,?)').run(p, cat[c]);
for (const [c, a] of [['Groceries', 500], ['Restaurants', 250], ['Coffee Shops', 60], ['Gas & Fuel', 150], ['Shopping', 200], ['Entertainment', 100], ['Subscriptions', 50], ['Utilities', 140]])
  db.prepare('INSERT INTO budgets (category_id, amount) VALUES (?,?)').run(cat[c], a);

let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const money = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;
const iso = (d) => d.toISOString().slice(0, 10);
const ins = db.prepare('INSERT INTO transactions (account_id, date, description, amount, category_id) VALUES (?,?,?,?,?)');
const add = (a, d, desc, amt) => ins.run(a, iso(d), desc, amt, null);

const today = new Date();
db.exec('BEGIN');
for (let m = 5; m >= 0; m--) {
  const y = new Date(today.getFullYear(), today.getMonth() - m, 1);
  const day = (n) => new Date(y.getFullYear(), y.getMonth(), n);
  const live = (d) => d <= today;
  for (const d of [day(1), day(15)]) if (live(d)) add(checking, d, 'ACME CORP PAYROLL', 2450);
  if (live(day(1))) add(checking, day(1), 'LANDLORD PROPERTIES RENT', -1450);
  if (live(day(5))) add(checking, day(5), 'COMCAST XFINITY', -79.99);
  if (live(day(8))) add(checking, day(8), 'CITY ELECTRIC UTILITY', money(70, 130));
  if (live(day(8))) db.prepare('UPDATE transactions SET amount = -amount WHERE rowid = last_insert_rowid()').run();
  if (live(day(3))) add(savings, day(3), 'INTEREST PAID', money(30, 45));
  if (live(day(10))) { add(checking, day(10), 'ONLINE PAYMENT THANK YOU', -900); add(card, day(10), 'PAYMENT THANK YOU', 900); }
  if (live(day(12))) add(card, day(12), 'NETFLIX.COM', -15.49);
  if (live(day(14))) add(card, day(14), 'SPOTIFY USA', -11.99);
  if (live(day(2))) add(card, day(2), 'PLANET FITNESS GYM', -24.99);
  for (let i = 0; i < 9; i++) { const d = day(1 + Math.floor(rnd() * 27)); if (live(d)) add(card, d, pick(['WHOLE FOODS MARKET', 'TRADER JOES #123', 'KROGER 456']), -money(25, 140)); }
  for (let i = 0; i < 9; i++) { const d = day(1 + Math.floor(rnd() * 27)); if (live(d)) add(card, d, pick(['STARBUCKS STORE 8812', 'DUNKIN #3341']), -money(4, 9)); }
  for (let i = 0; i < 6; i++) { const d = day(1 + Math.floor(rnd() * 27)); if (live(d)) add(card, d, pick(['CHIPOTLE 1234', 'DOORDASH*PIZZA PLACE', 'LOCAL BISTRO']), -money(12, 55)); }
  for (let i = 0; i < 4; i++) { const d = day(1 + Math.floor(rnd() * 27)); if (live(d)) add(card, d, 'SHELL OIL 5742', -money(30, 60)); }
  for (let i = 0; i < 4; i++) { const d = day(1 + Math.floor(rnd() * 27)); if (live(d)) add(card, d, pick(['AMAZON.COM*2K4', 'TARGET 0042', 'BEST BUY 118']), -money(15, 130)); }
}
db.exec('COMMIT');
console.log(`Seeded. Auto-categorized ${applyRules(true)} transactions (the rest stay uncategorized on purpose, so you can try rules).`);
