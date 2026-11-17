import { useEffect, useState } from 'react';
import { api, fmt, fmt2 } from '../api.js';

const STATUS = {
  complete: ['Complete 🎉', 'pos'], on_track: ['On track', 'pos'], behind: ['Behind pace', 'warnc'],
  overdue: ['Past target date', 'neg'], open: ['No target date', 'muted'],
};
const monthYear = (s) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export default function Goals() {
  const [goals, setGoals] = useState(null);
  const [accts, setAccts] = useState([]);
  const [form, setForm] = useState(null);
  const load = () => api.get('/api/goals').then(setGoals);
  useEffect(() => { load(); api.get('/api/accounts').then(setAccts); }, []);
  if (!goals) return <p className="muted">Loading…</p>;

  const contribute = async (g, sign) => {
    const v = prompt(sign > 0 ? `How much did you add to "${g.name}"?` : `How much did you take out of "${g.name}"?`);
    const n = Number(v);
    if (!v || !n || n < 0) return;
    await api.post(`/api/goals/${g.id}/contributions`, { amount: sign * n }); load();
  };
  const remove = async (g) => { if (confirm(`Delete goal "${g.name}"?`)) { await api.del(`/api/goals/${g.id}`); load(); } };
  const undo = async (g, c) => { await api.del(`/api/goals/${g.id}/contributions/${c.id}`); load(); };

  return (
    <>
      <div className="pagehead"><h1>Savings goals</h1><button className="btn" onClick={() => setForm({ name: '', target: '', target_date: '', account_id: '' })}>+ New goal</button></div>
      {goals.length === 0 && <div className="card muted">No goals yet. Create one, then either log contributions by hand or link it to a savings account so progress follows its balance.</div>}
      <div className="grid two">
        {goals.map((g) => {
          const [label, cls] = STATUS[g.status];
          return (
            <div className="card" key={g.id}>
              <div className="row"><h3 style={{ margin: 0 }}>{g.name}</h3><span className={'small ' + cls}>{label}</span></div>
              <div className="big">{fmt(g.current)} <span className="muted small">of {fmt(g.target)}</span></div>
              <div className="track tall"><div className="fill" style={{ width: g.pct + '%', background: g.color }} /></div>
              <div className="row small muted"><span>{Math.round(g.pct)}%</span><span>{fmt(g.remaining)} to go</span></div>
              <ul className="facts small">
                {g.target_date && <li>Target: {monthYear(g.target_date)}{g.needed_per_month != null && g.status !== 'complete' && <> — need <strong>{fmt(g.needed_per_month)}/mo</strong></>}</li>}
                {g.status !== 'complete' && (g.pace > 0
                  ? <li>Recent pace: {fmt(g.pace)}/mo{g.projected && <> → done around <strong>{monthYear(g.projected)}</strong></>}</li>
                  : <li className="muted">No progress in the last 90 days.</li>)}
                {g.account_name && <li>Linked to <strong>{g.account_name}</strong> (progress follows its balance)</li>}
              </ul>
              {!g.account_id && g.contributions.length > 0 && (
                <div className="small muted">Recent: {g.contributions.map((c) => (
                  <span key={c.id} className="chip" title="Click to undo" onClick={() => undo(g, c)}>{c.date.slice(5)} {c.amount > 0 ? '+' : '−'}{fmt2(Math.abs(c.amount))}</span>))}
                </div>
              )}
              <div className="row gap end">
                {!g.account_id && <><button className="btn small" onClick={() => contribute(g, 1)}>+ Add</button>
                  <button className="btn small ghost" onClick={() => contribute(g, -1)}>− Withdraw</button></>}
                <button className="link" onClick={() => setForm({ ...g, target_date: g.target_date ?? '', account_id: g.account_id ?? '' })}>edit</button>
                <button className="link danger" onClick={() => remove(g)}>✕</button>
              </div>
            </div>
          );
        })}
      </div>
      {form && <GoalForm init={form} accts={accts} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </>
  );
}

function GoalForm({ init, accts, onClose, onSaved }) {
  const [f, setF] = useState(init);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try {
      const body = { name: f.name, target: Number(f.target), target_date: f.target_date || null, account_id: f.account_id ? Number(f.account_id) : null, color: f.color };
      f.id ? await api.patch(`/api/goals/${f.id}`, body) : await api.post('/api/goals', body);
      onSaved();
    } catch (e) { alert(e.message); }
  };
  return (
    <div className="modal" onClick={onClose}><div className="card modalbody" onClick={(e) => e.stopPropagation()}>
      <h3>{f.id ? 'Edit goal' : 'New goal'}</h3>
      <div className="form">
        <input placeholder="Name (e.g. Emergency fund)" value={f.name} onChange={set('name')} />
        <input type="number" placeholder="Target amount" value={f.target} onChange={set('target')} />
        <label className="small muted">Target date (optional)<input type="date" value={f.target_date} onChange={set('target_date')} /></label>
        <label className="small muted">Track progress with<select value={f.account_id} onChange={set('account_id')}>
          <option value="">Manual contributions</option>
          {accts.map((a) => <option key={a.id} value={a.id}>{a.name} balance</option>)}</select></label>
        {f.account_id && <p className="small muted">Linking uses the account's whole balance. Don't link two goals to the same account unless you want both to count it.</p>}
      </div>
      <div className="row gap end"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" onClick={save}>Save</button></div>
    </div></div>
  );
}
