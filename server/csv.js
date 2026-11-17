import crypto from 'node:crypto';

// Pick the delimiter that appears most in the first few lines (outside of quotes is overkill here).
export function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 8).join('\n');
  const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  for (const d of Object.keys(counts)) counts[d] = sample.split(d).length - 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

// Minimal RFC-4180-ish parser (quotes, escaped quotes, CRLF).
export function parseCsv(text, delim = ',') {
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
    else if (c === delim) { row.push(cell); cell = ''; }
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

export function parseDate(s, dateFormat = 'mdy') {
  s = String(s).trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const [a, b] = dateFormat === 'dmy' ? [m[2], m[1]] : [m[1], m[2]];
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    if (+a < 1 || +a > 12 || +b < 1 || +b > 31) return null;
    return `${y}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
  }
  m = s.match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/); // "Nov 3, 2026"
  if (m) {
    const mo = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].toLowerCase());
    if (mo >= 0) return `${m[3]}-${String(mo + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

export function parseAmount(s) {
  if (s == null) return null;
  let t = String(s).trim();
  if (!t) return null;
  const neg = /^\(.*\)$/.test(t) || t.includes('-') || /\bCR\b|DR\b/i.test(t) && /DR/i.test(t);
  t = t.replace(/[^0-9.,]/g, '');
  // "1.234,56" (European) vs "1,234.56"
  if (/,\d{2}$/.test(t) && !/\.\d{2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  if (!t || isNaN(parseFloat(t))) return null;
  const n = parseFloat(t);
  return neg ? -n : n;
}

const HEADER_WORDS = /date|description|payee|merchant|amount|debit|credit|memo|details|name|withdrawal|deposit/i;

// Banks often put account info above the real header. Find the first row that looks like headers.
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const hits = rows[i].filter((c) => c.trim() && HEADER_WORDS.test(c)).length;
    if (hits >= 2 && rows[i].filter((c) => c.trim()).length >= 3) return i;
  }
  return 0;
}

export function detectMapping(headers) {
  const head = headers.map((h) => h.trim().toLowerCase());
  const find = (...res) => head.findIndex((h) => res.some((r) => r.test(h)));
  const date = find(/^(transaction |trans\.? |posting |posted )?date/, /date/);
  const description = find(/^description/, /payee/, /merchant/, /^name$/, /details/, /memo/);
  let amount = find(/^amount$/, /^amount/, /^transaction amount/);
  const debit = find(/debit|withdrawal|money out|paid out/);
  const credit = find(/credit|deposit|money in|paid in/);
  if (amount >= 0 && debit >= 0 && credit >= 0) amount = -1; // prefer split columns when both exist
  return { date, description, amount, debit, credit };
}

// Turns CSV text into normalized {date, description, amount} rows.
// `mapping` (column indexes, -1 = none) overrides auto-detection.
export function normalizeCsv(text, { invertSigns = false, dateFormat = 'mdy', mapping: override } = {}) {
  const delim = detectDelimiter(text);
  const all = parseCsv(text, delim);
  const hi = findHeaderRow(all);
  const headers = (all[hi] ?? []).map((h) => h.trim());
  const body = all.slice(hi + 1);
  if (!body.length) throw new Error('CSV has no data rows');
  const mapping = { ...detectMapping(headers), ...(override || {}) };
  for (const k of Object.keys(mapping)) mapping[k] = Number.isInteger(+mapping[k]) ? +mapping[k] : -1;
  if (mapping.date < 0 || mapping.description < 0 || (mapping.amount < 0 && mapping.debit < 0 && mapping.credit < 0)) {
    return { headers, mapping, rows: [], skipped: body.length, needsMapping: true };
  }
  const out = [];
  let skipped = 0;
  for (const r of body) {
    const date = parseDate(r[mapping.date] ?? '', dateFormat);
    let amount = mapping.amount >= 0 ? parseAmount(r[mapping.amount]) : null;
    if (amount == null) {
      const d = mapping.debit >= 0 ? parseAmount(r[mapping.debit]) : null;
      const c = mapping.credit >= 0 ? parseAmount(r[mapping.credit]) : null;
      if (d || c) amount = Math.abs(c ?? 0) - Math.abs(d ?? 0);
    }
    const description = (r[mapping.description] ?? '').trim().replace(/\s+/g, ' ');
    if (!date || amount == null || !description) { skipped++; continue; }
    out.push({ date, description, amount: invertSigns ? -amount : amount });
  }
  return { headers, mapping, rows: out, skipped, needsMapping: false };
}

export function txHash(accountId, t, occurrence) {
  return crypto.createHash('sha1')
    .update(`${accountId}|${t.date}|${t.description}|${t.amount.toFixed(2)}|${occurrence}`)
    .digest('hex');
}

// Hash each row; identical rows within one file are distinct (two $4 coffees same day),
// but re-importing the same file produces the same hashes, so it's a no-op.
export function hashRows(accountId, rows) {
  const seen = new Map();
  return rows.map((t) => {
    const key = `${t.date}|${t.description}|${t.amount}`;
    const occ = (seen.get(key) ?? 0) + 1; seen.set(key, occ);
    return { ...t, hash: txHash(accountId, t, occ) };
  });
}
