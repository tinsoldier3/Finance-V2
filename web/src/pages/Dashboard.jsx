import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, fmt, fmt2, shortMonth, thisMonth } from '../api.js';
import MonthPicker from '../components/MonthPicker.jsx';

export default function Dashboard() {
  const [month, setMonth] = useState(thisMonth());
  const [d, setD] = useState(null);
  useEffect(() => { api.get(`/api/summary?month=${month}`).then(setD); }, [month]);
  if (!d) return <p className="muted">Loading…</p>;
  const spent = d.spendingByCategory.reduce((s, x) => s + x.value, 0);

  return (
    <>
      <div className="pagehead"><h1>Overview</h1><MonthPicker month={month} onChange={setMonth} /></div>

      {d.accounts.length === 0 && (
        <div className="card callout">No accounts yet. <Link to="/accounts">Add an account and import a CSV</Link> to get started
          (or run <code>npm run seed</code> for demo data).</div>
      )}
      {d.uncategorized > 0 && (
        <div className="card callout">{d.uncategorized} uncategorized transactions. <Link to="/transactions?uncategorized=1">Review them</Link> or <Link to="/rules">add rules</Link>.</div>
      )}

      <div className="grid stats">
        <div className="card stat"><label>Net worth</label><div className="big">{fmt(d.netWorth)}</div></div>
        <div className="card stat"><label>Assets</label><div className="big pos">{fmt(d.assets)}</div></div>
        <div className="card stat"><label>Debts</label><div className="big neg">{fmt(d.debts)}</div></div>
        <div className="card stat"><label>Spent in {shortMonth(month)}</label><div className="big">{fmt(spent)}</div></div>
      </div>

      <div className="grid two">
        <div className="card">
          <h3>Net worth</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={d.netWorthHistory.map((x) => ({ ...x, label: shortMonth(x.month) }))}>
              <defs><linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2e9e5b" stopOpacity={0.35} /><stop offset="100%" stopColor="#2e9e5b" stopOpacity={0} />
              </linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" /><YAxis tickFormatter={(v) => '$' + Math.round(v / 1000) + 'k'} width={48} domain={['auto', 'auto']} />
              <Tooltip formatter={(v) => fmt(v)} />
              <Area type="monotone" dataKey="netWorth" name="Net worth" stroke="#2e9e5b" strokeWidth={2} fill="url(#nw)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <h3>Spending by category</h3>
          {d.spendingByCategory.length === 0 ? <p className="muted">No spending this month.</p> : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={d.spendingByCategory} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={1}>
                  {d.spendingByCategory.map((c) => <Cell key={c.name} fill={c.color} />)}
                </Pie>
                <Tooltip formatter={(v) => fmt2(v)} />
                <Legend layout="vertical" align="right" verticalAlign="middle" iconSize={9} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="card">
          <h3>Income vs. spending</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={d.cash.map((x) => ({ ...x, label: shortMonth(x.month) }))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" /><YAxis tickFormatter={(v) => '$' + v / 1000 + 'k'} width={44} />
              <Tooltip formatter={(v) => fmt(v)} /><Legend />
              <Bar dataKey="income" name="Income" fill="#2e9e5b" radius={[3, 3, 0, 0]} />
              <Bar dataKey="spending" name="Spending" fill="#e5533d" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <h3>Budgets <Link className="more" to="/budgets">manage</Link></h3>
          {d.budgets.length === 0 && <p className="muted">No budgets set yet.</p>}
          {d.budgets.map((b) => <BudgetBar key={b.name} name={b.name} spent={b.spent} budget={b.budget} />)}
        </div>
      </div>

      <div className="card">
        <h3>Recent transactions <Link className="more" to="/transactions">view all</Link></h3>
        <table className="table"><tbody>
          {d.recent.map((t) => (
            <tr key={t.id}><td className="muted w100">{t.date}</td><td>{t.description}</td>
              <td><CatPill name={t.category_name} color={t.category_color} /></td>
              <td className={'right ' + (t.amount > 0 ? 'pos' : '')}>{fmt2(t.amount)}</td></tr>
          ))}
        </tbody></table>
      </div>
    </>
  );
}

export function BudgetBar({ name, spent, budget }) {
  const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;
  const over = spent > budget;
  return (
    <div className="bbar">
      <div className="row"><span>{name}</span><span className={over ? 'neg' : 'muted'}>{fmt(spent)} of {fmt(budget)}</span></div>
      <div className="track"><div className={'fill' + (over ? ' over' : pct > 85 ? ' warn' : '')} style={{ width: pct + '%' }} /></div>
    </div>
  );
}

export function CatPill({ name, color }) {
  if (!name) return <span className="pill none">Uncategorized</span>;
  return <span className="pill" style={{ background: color + '22', color }}>{name}</span>;
}
