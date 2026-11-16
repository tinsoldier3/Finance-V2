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

function ImportModal({ account, onClose, onDone }) {
  const [csv, setCsv] = useState('');
  const [invert, setInvert] = useState(account.type === 'credit');
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const onFile = async (e) => { const file = e.target.files[0]; if (file) setCsv(await file.text()); };
  const run = async () => {
    setErr('');
    try { setResult(await api.post('/api/import', { account_id: account.id, csv, invertSigns: invert })); }
    catch (e) { setErr(e.message); }
  };
  return (
    <div className="modal" onClick={onClose}><div className="card modalbody" onClick={(e) => e.stopPropagation()}>
      <h3>Import into {account.name}</h3>
      <p className="muted small">Export a CSV from your bank. Needs a date column, a description/payee column, and either an Amount column or Debit/Credit columns. Re-importing overlapping dates is safe: duplicates are skipped.</p>
      <input type="file" accept=".csv,text/csv" onChange={onFile} />
      <textarea rows="5" placeholder="…or paste CSV text here" value={csv} onChange={(e) => setCsv(e.target.value)} />
      <label><input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} /> Flip signs (use if purchases show as positive, common for credit cards)</label>
      {err && <p className="neg">{err}</p>}
      {result && <p className="pos">Parsed {result.parsed} · added {result.added} · duplicates {result.duplicates} · skipped {result.skipped} · auto-categorized {result.categorized}</p>}
      <div className="row gap end">
        <button className="btn ghost" onClick={result ? onDone : onClose}>{result ? 'Done' : 'Cancel'}</button>
        {!result && <button className="btn" disabled={!csv} onClick={run}>Import</button>}
      </div>
    </div></div>
  );
}
