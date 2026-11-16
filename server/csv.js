import crypto from 'node:crypto';

// Minimal RFC-4180-ish parser (quotes, escaped quotes, CRLF).
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

export function parseDate(s) {
  s = String(s).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

export function parseAmount(s) {
  if (s == null) return null;
  let t = String(s).trim();
  if (!t) return null;
  const neg = /^\(.*\)$/.test(t) || t.includes('-');
  t = t.replace(/[^0-9.]/g, '');
  if (!t) return null;
  const n = parseFloat(t);
  return neg ? -n : n;
}

// Turns CSV text into normalized {date, description, amount} rows.
// Handles single "Amount" column or separate Debit/Credit columns.
export function normalizeCsv(text, { invertSigns = false } = {}) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV has no data rows');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const find = (...res) => head.findIndex((h) => res.some((r) => r.test(h)));
  const iDate = find(/^(transaction |posting |posted )?date/, /date/);
  const iDesc = find(/^description/, /payee/, /merchant/, /^name$/, /memo/, /details/);
  const iAmt = find(/^amount$/, /^amount/);
  const iDebit = find(/debit|withdrawal/);
  const iCredit = find(/credit|deposit/);
  if (iDate < 0 || iDesc < 0 || (iAmt < 0 && iDebit < 0 && iCredit < 0)) {
    throw new Error(`Could not detect columns. Found headers: ${rows[0].join(', ')}`);
  }
  const out = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const date = parseDate(r[iDate] ?? '');
    let amount = iAmt >= 0 ? parseAmount(r[iAmt]) : null;
    if (amount == null) {
      const d = parseAmount(r[iDebit]) ?? 0, c = parseAmount(r[iCredit]) ?? 0;
      amount = Math.abs(c) - Math.abs(d);
      if (!d && !c) amount = null;
    }
    const description = (r[iDesc] ?? '').trim().replace(/\s+/g, ' ');
    if (!date || amount == null || !description) { skipped++; continue; }
    out.push({ date, description, amount: invertSigns ? -amount : amount });
  }
  return { rows: out, skipped };
}

export function txHash(accountId, t, occurrence) {
  return crypto.createHash('sha1')
    .update(`${accountId}|${t.date}|${t.description}|${t.amount.toFixed(2)}|${occurrence}`)
    .digest('hex');
}
