import { useEffect, useState } from 'react';
import { api, fmt2 } from '../api.js';

const TYPES = ['checking', 'savings', 'credit', 'investment', 'loan', 'cash'];

export default function Accounts() {
  const [accts, setAccts] = useState([]);
  const [f, setF] = useState({ name: '', institution: '', type: 'checking', opening_balance: '' });
  const [imp, setImp] = useState(null); // account being imported into
  const load = () => api.get('/api/accounts').then(setAccts);
  useEffect(() => { load(); }, []);
  const add = async () => {
    try { await api.post('/api/accounts', { ...f, opening_balance: Number(f.opening_balance || 0) }); setF({ ...f, name: '', opening_balance: '' }); load(); }
    catch (e) { alert(e.message); }
  };
  const matchBalance = async (a) => {
    const v = prompt(`What does your bank show as the current balance for ${a.name}?\n(Debts like credit cards are negative, e.g. -1234.56)`, a.balance.toFixed(2));
    if (v == null || v.trim() === '' || isNaN(Number(v))) return;
    await api.patch(`/api/accounts/${a.id}`, { current_balance: Number(v) }); load();
  };
  const remove = async (a) => { if (confirm(`Delete ${a.name} and its ${a.tx_count} transactions?`)) { await api.del(`/api/accounts/${a.id}`); load(); } };

  return (
    <>
      <div className="pagehead"><h1>Accounts</h1></div>
      <div className="card">
        <table className="table"><thead><tr><th>Account</th><th>Type</th><th className="right">Balance</th><th /></tr></thead>
          <tbody>
            {accts.map((a) => (
              <tr key={a.id}>
                <td><strong>{a.name}</strong><div className="muted small">{a.institution} · {a.tx_count} transactions</div></td>
                <td className="muted">{a.type}</td>
                <td className={'right ' + (a.balance < 0 ? 'neg' : '')}>{fmt2(a.balance)}</td>
                <td className="right nowrap"><button className="btn small" onClick={() => setImp(a)}>Import CSV</button>
                  <button className="btn small ghost" onClick={() => matchBalance(a)} title="Set starting balance so this matches your bank">Match balance</button>
                  <button className="link danger" onClick={() => remove(a)}>✕</button></td>
              </tr>
            ))}
            {accts.length === 0 && <tr><td colSpan="4" className="muted center">No accounts yet.</td></tr>}
          </tbody></table>
      </div>
      <div className="card">
        <h3>Add account</h3>
        <div className="row gap wrap">
          <input placeholder="Name (e.g. Chase Checking)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input placeholder="Institution" value={f.institution} onChange={(e) => setF({ ...f, institution: e.target.value })} />
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          <input type="number" step="0.01" placeholder="Starting balance (debts negative)" value={f.opening_balance} onChange={(e) => setF({ ...f, opening_balance: e.target.value })} />
          <button className="btn" onClick={add}>Add</button>
        </div>
        <p className="muted small">Starting balance is the balance <em>before</em> your first imported transaction. Check your statement and adjust so the total matches your bank.</p>
      </div>
      {imp && <ImportModal account={imp} onClose={() => setImp(null)} onDone={() => { setImp(null); load(); }} />}
    </>
  );
}

const FIELDS = [['date', 'Date'], ['description', 'Description'], ['amount', 'Amount'], ['debit', 'Debit (out)'], ['credit', 'Credit (in)']];

function ImportModal({ account, onClose, onDone }) {
  const [csv, setCsv] = useState('');
  const [invert, setInvert] = useState(account.type === 'credit');
  const [dateFormat, setDateFormat] = useState('mdy');
  const [mapping, setMapping] = useState(null); // null = auto-detect
  const [prev, setPrev] = useState(null);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!csv) { setPrev(null); return; }
    const t = setTimeout(() => {
      api.post('/api/import/preview', { account_id: account.id, csv, invertSigns: invert, dateFormat, mapping })
        .then((p) => { setPrev(p); setErr(''); }).catch((e) => setErr(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [csv, invert, dateFormat, mapping, account.id]);

  const onFile = async (e) => { const file = e.target.files[0]; if (file) { setMapping(null); setCsv(await file.text()); } };
  const setCol = (k, v) => setMapping({ ...(mapping ?? prev.mapping), [k]: Number(v) });
  const run = async () => {
    setErr('');
    try { setResult(await api.post('/api/import', { account_id: account.id, csv, invertSigns: invert, dateFormat, mapping })); }
    catch (e) { setErr(e.message); }
  };

  return (
    <div className="modal" onClick={onClose}><div className="card modalbody wide" onClick={(e) => e.stopPropagation()}>
      <h3>Import into {account.name}</h3>
      {!result && <>
        <p className="muted small">Export a CSV from your bank and choose it here. Columns are detected automatically; fix them below if the preview looks wrong. Re-importing overlapping dates is safe: duplicates are skipped.</p>
        <input type="file" accept=".csv,.txt,text/csv" onChange={onFile} />
        <textarea rows="3" placeholder="…or paste CSV text here" value={csv} onChange={(e) => { setMapping(null); setCsv(e.target.value); }} />
        {prev && <>
          <div className="mapgrid">
            {FIELDS.map(([k, label]) => (
              <label key={k}>{label}
                <select value={prev.mapping[k]} onChange={(e) => setCol(k, e.target.value)}>
                  <option value={-1}>—</option>
                  {prev.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="row gap wrap opts">
            <label><input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} /> Flip signs (purchases show as positive, common for credit cards)</label>
            <label>Dates are <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>
              <option value="mdy">MM/DD/YYYY</option><option value="dmy">DD/MM/YYYY</option></select></label>
          </div>
          {prev.needsMapping
            ? <p className="neg">Couldn't tell which columns are which. Pick at least Date, Description, and Amount (or Debit/Credit).</p>
            : <>
              <p className="small"><strong>{prev.fresh} new</strong> · {prev.duplicates} already imported · {prev.skipped} skipped{prev.range && <> · {prev.range[0]} → {prev.range[1]}</>}</p>
              <table className="table small"><tbody>
                {prev.sample.map((r, i) => (
                  <tr key={i}><td className="muted w100">{r.date}</td><td>{r.description}</td><td className={'right ' + (r.amount > 0 ? 'pos' : '')}>{fmt2(r.amount)}</td></tr>
                ))}
              </tbody></table>
              <p className="muted small">Check the signs: money you spent should be negative and income positive.</p>
            </>}
        </>}
      </>}
      {err && <p className="neg">{err}</p>}
      {result && <p className="pos">Added {result.added} · duplicates {result.duplicates} · skipped {result.skipped} · auto-categorized {result.categorized}.
        Tip: use <em>Match balance</em> so this account's total agrees with your bank.</p>}
      <div className="row gap end">
        <button className="btn ghost" onClick={result ? onDone : onClose}>{result ? 'Done' : 'Cancel'}</button>
        {!result && <button className="btn" disabled={!prev || prev.needsMapping || prev.fresh === 0} onClick={run}>Import {prev && !prev.needsMapping ? prev.fresh : ''} transactions</button>}
      </div>
    </div></div>
  );
}
