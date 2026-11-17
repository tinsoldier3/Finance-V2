# Finance-V2

A self-hosted, Mint-style personal finance tracker. No subscription, and your data stays in a local SQLite file.

- **Overview**: net worth, assets/debts, spending by category, income vs. spending, budget progress, recent activity
- **Transactions**: search/filter, inline category editing, add/rename/delete, one-click "make a rule"
- **Budgets**: monthly limit per category with progress bars (green → amber → red)
- **Bills**: finds recurring charges in your transactions (rent, subscriptions, utilities) and tracks them with due dates, paid/overdue status, and a monthly total
- **Goals**: savings targets with a target date, "need $X/mo", pace-based projections; track by manual contributions or link to a savings account
- **Accounts**: checking/savings/credit/investment/loan, with **CSV import** (dedupes on re-import)
- **Rules**: "description contains X → category Y", applied automatically on import

## Run it

Requires Node 22.13+ (uses the built-in `node:sqlite`, so there are no native modules to compile).

```bash
npm run setup      # install server + web deps
npm run seed       # optional: load demo data
npm run dev        # API on :3001, web on http://localhost:5173
```

Production-style (single process): `npm run build && npm start`, then open http://localhost:3001.

Data lives in `server/finance.db` (gitignored). Set `DB_PATH` to move it.

## Importing your real data

1. Add an account (Accounts page). Set the starting balance to the balance *before* your first imported transaction.
2. Download a CSV from your bank/card (most offer one under "Download transactions").
3. **Import CSV** on that account. Columns are auto-detected: a date, a description/payee, and either `Amount` or `Debit`/`Credit`.
4. Credit cards often export purchases as positive numbers. Tick **Flip signs** if so (on by default for credit accounts).
5. Add rules for the stragglers on the Transactions page; they apply to everything uncategorized.

Sign convention: negative = money out, positive = money in. Credit/loan accounts carry negative balances.

## Layout

```
server/  Express + node:sqlite  (db.js schema, csv.js parser, index.js API, seed.js demo data)
web/     React + Vite + Recharts (src/pages/*)
```

## Ideas for next

- Automatic bank sync via SimpleFIN Bridge (~$15/yr) or Plaid
- Category/merchant drill-downs, bill reminders (email/push)
- Split transactions, tags, investment holdings, login (if exposed beyond localhost)
