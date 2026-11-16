import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmt2, thisMonth } from '../api.js';
import MonthPicker from '../components/MonthPicker.jsx';
import { CatPill } from './Dashboard.jsx';

export default function Transactions() {
  const [sp] = useSearchParams();
  const [month, setMonth] = useState(thisMonth());
  const [all, setAll] = useState(sp.get('uncategorized') === '1');
  const [q, setQ] = useState('');
  const [account, setAccount] = useState('');
  const [category, setCategory] = useState('');
  const [onlyUncat, setOnlyUncat] = useState(sp.get('uncategorized') === '1');
  const [rows, setRows] = useState([]);
  const [cats, setCats] = useState([]);
  const [accts, setAccts] = useState([]);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => { api.get('/api/categories').then(setCats); api.get('/api/accounts').then(setAccts); }, []);
  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (!all) p.set('month', month);
    if (q) p.set('q', q);
    if (account) p.set('account', account);
    if (category) p.set('category', category);
    if (onlyUncat) p.set('uncategorized', '1');
    api.get('/api/transactions?' + p).then(setRows);
  }, [month, all, q, account, category, onlyUncat]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);

  const setCat = async (t, category_id) => {
    await api.patch(`/api/transactions/${t.id}`, { category_id: category_id || null });
    load();
  };
  const remove = async (t) => { if (confirm(`Delete "${t.description}"?`)) { await api.del(`/api/transactions/${t.id}`); load(); } };
  const makeRule = async (t) => {
    const pattern = prompt('Auto-categorize any transaction whose description contains:', t.description.split(' ').slice(0, 2).join(' '));
    if (!pattern || !t.category_id) return pattern && alert('Set a category on this transaction first.');
    const r = await api.post('/api/rules', { pattern, category_id: t.category_id });
    alert(`Rule saved. Categorized ${r.applied} other transaction(s).`);
    load();
  };

  const total = rows.reduce((s, t) => s + (t.category_kind === 'transfer' ? 0 : t.amount), 0);

  return (
    <>
      <div className="pagehead"><h1>Transactions</h1>
        <div className="row gap">
          {!all && <MonthPicker month={month} onChange={setMonth} />}
          <button className="btn" onClick={() => setAdding(true)}>+ Add</button>
        </div>
      </div>
      <div className="card filters">
        <input placeholder="Search description…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={account} onChange={(e) => setAccount(e.target.value)}>
          <option value="">All accounts</option>{accts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> All time</label>
        <label><input type="checkbox" checked={onlyUncat} onChange={(e) => setOnlyUncat(e.target.checked)} /> Uncategorized only</label>
      </div>
      <div className="card">
        <div className="muted small">{rows.length} transactions · net {fmt2(total)} (transfers excluded)</div>
        <table className="table">
          <thead><tr><th>Date</th><th>Description</th><th>Account</th><th>Category</th><th className="right">Amount</th><th /></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td className="muted w100">{t.date}</td>
                <td>{editing === t.id
                  ? <input autoFocus defaultValue={t.description}
                      onBlur={async (e) => { await api.patch(`/api/transactions/${t.id}`, { description: e.target.value }); setEditing(null); load(); }}
                      onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                  : <span onDoubleClick={() => setEditing(t.id)} title="Double-click to rename">{t.description}</span>}</td>
                <td className="muted">{t.account_name}</td>
                <td>
                  <select className="catsel" value={t.category_id ?? ''} onChange={(e) => setCat(t, e.target.value)}
                          style={t.category_color ? { color: t.category_color } : undefined}>
                    <option value="">Uncategorized</option>
                    {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </td>
                <td className={'right ' + (t.amount > 0 ? 'pos' : '')}>{fmt2(t.amount)}</td>
                <td className="right nowrap">
                  {t.category_id && <button className="link" onClick={() => makeRule(t)} title="Create a rule from this">rule</button>}
                  <button className="link danger" onClick={() => remove(t)}>✕</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan="6" className="muted center">Nothing here.</td></tr>}
          </tbody>
        </table>
      </div>
      {adding && <AddTx accts={accts} cats={cats} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </>
  );
}

function AddTx({ accts, cats, onClose, onSaved }) {
  const [f, setF] = useState({ account_id: accts[0]?.id ?? '', date: new Date().toISOString().slice(0, 10), description: '', amount: '', category_id: '', type: 'expense' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try {
      const amt = Math.abs(Number(f.amount)) * (f.type === 'expense' ? -1 : 1);
      await api.post('/api/transactions', { ...f, amount: amt, category_id: f.category_id || null });
      onSaved();
    } catch (e) { alert(e.message); }
  };
  return (
    <div className="modal" onClick={onClose}><div className="card modalbody" onClick={(e) => e.stopPropagation()}>
      <h3>Add transaction</h3>
      <div className="form">
        <select value={f.account_id} onChange={set('account_id')}>{accts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <input type="date" value={f.date} onChange={set('date')} />
        <input placeholder="Description" value={f.description} onChange={set('description')} />
        <div className="row gap">
          <select value={f.type} onChange={set('type')}><option value="expense">Expense</option><option value="income">Income</option></select>
          <input type="number" step="0.01" placeholder="Amount" value={f.amount} onChange={set('amount')} />
        </div>
        <select value={f.category_id} onChange={set('category_id')}><option value="">Uncategorized</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>
      <div className="row gap end"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" onClick={save}>Save</button></div>
    </div></div>
  );
}
