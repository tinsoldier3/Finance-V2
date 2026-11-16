import { useEffect, useState } from 'react';
import { api, fmt, thisMonth } from '../api.js';
import MonthPicker from '../components/MonthPicker.jsx';
import { BudgetBar } from './Dashboard.jsx';

export default function Budgets() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState(null);
  const load = () => api.get(`/api/budgets?month=${month}`).then(setData);
  useEffect(() => { load(); }, [month]);
  if (!data) return <p className="muted">Loading…</p>;

  const budgeted = data.rows.filter((r) => r.budget > 0);
  const totalB = budgeted.reduce((s, r) => s + r.budget, 0);
  const totalS = budgeted.reduce((s, r) => s + r.spent, 0);
  const unbudgeted = data.rows.filter((r) => !r.budget && r.spent > 0);
  const save = async (r, v) => { await api.put(`/api/budgets/${r.category_id}`, { amount: v }); load(); };

  return (
    <>
      <div className="pagehead"><h1>Budgets</h1><MonthPicker month={month} onChange={setMonth} /></div>
      <div className="card">
        <h3>{fmt(totalS)} spent of {fmt(totalB)} budgeted — {totalB - totalS >= 0 ? fmt(totalB - totalS) + ' left' : fmt(totalS - totalB) + ' over'}</h3>
        <BudgetBar name="Total" spent={totalS} budget={totalB} />
      </div>
      <div className="card">
        <h3>Monthly limits</h3>
        <table className="table"><thead><tr><th>Category</th><th style={{ width: '45%' }}>Progress</th><th className="right">Budget / mo</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.category_id}>
                <td><span className="dot" style={{ background: r.color }} />{r.name}</td>
                <td>{r.budget > 0 ? <BudgetBar name="" spent={r.spent} budget={r.budget} /> : <span className="muted">{r.spent > 0 ? `${fmt(r.spent)} spent, no budget` : '—'}</span>}</td>
                <td className="right"><input className="amt" type="number" min="0" defaultValue={r.budget || ''} placeholder="0"
                  key={r.category_id + ':' + r.budget} onBlur={(e) => Number(e.target.value || 0) !== r.budget && save(r, e.target.value)} /></td>
              </tr>
            ))}
          </tbody></table>
        {unbudgeted.length > 0 && <p className="muted small">Tip: you spent in {unbudgeted.length} categories with no budget this month.</p>}
      </div>
    </>
  );
}
