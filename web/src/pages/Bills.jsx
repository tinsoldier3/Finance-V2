import { useEffect, useState } from 'react';
import { api, fmt, fmt2 } from '../api.js';

const FREQS = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
const STATUS = { overdue: ['Overdue', 'neg'], due_soon: ['Due soon', 'warnc'], upcoming: ['Upcoming', 'muted'], paid: ['Paid', 'pos'] };
const dayLabel = (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : n < 0 ? `${-n}d ago` : `in ${n} days`);

export default function Bills() {
  const [data, setData] = useState(null);
  const [found, setFound] = useState([]);
  const [cats, setCats] = useState([]);
  const [form, setForm] = useState(null);
  const load = () => {
    api.get('/api/bills').then(setData);
    api.get('/api/bills/detect').then(setFound);
  };
  useEffect(() => { load(); api.get('/api/categories').then(setCats); }, []);
  if (!data) return <p className="muted">Loading…</p>;

  const track = async (d) => {
    await api.post('/api/bills', { name: d.name, pattern: d.pattern, amount: d.amount, frequency: d.frequency, due_date: d.due_date, category_id: d.category_id });
    load();
  };
  const remove = async (b) => { if (confirm(`Stop tracking ${b.name}?`)) { await api.del(`/api/bills/${b.id}`); load(); } };
  const toggleAuto = async (b) => { await api.patch(`/api/bills/${b.id}`, { autopay: !b.autopay }); load(); };

  return (
    <>
      <div className="pagehead"><h1>Recurring bills</h1><button className="btn" onClick={() => setForm({ name: '', amount: '', frequency: 'monthly', due_date: data.today, category_id: '', pattern: '', autopay: false })}>+ Add bill</button></div>

      <div className="grid stats">
        <div className="card stat"><label>Monthly total</label><div className="big">{fmt(data.monthlyTotal)}</div></div>
        <div className="card stat"><label>Bills tracked</label><div className="big">{data.bills.length}</div></div>
        <div className="card stat"><label>Next 7 days</label><div className="big">{fmt(data.bills.filter((b) => b.days_until <= 7).reduce((s, b) => s + b.amount, 0))}</div></div>
        <div className="card stat"><label>Overdue</label><div className={'big ' + (data.bills.some((b) => b.status === 'overdue') ? 'neg' : '')}>{data.bills.filter((b) => b.status === 'overdue').length}</div></div>
      </div>

      {found.length > 0 && (
        <div className="card callout">
          <h3>We found {found.length} recurring charge{found.length > 1 ? 's' : ''} in your transactions</h3>
          <table className="table"><tbody>
            {found.map((d) => (
              <tr key={d.pattern}>
                <td><strong>{d.name}</strong><div className="small muted">{d.occurrences} payments, last {d.last_date}</div></td>
                <td>{fmt2(d.amount)} {d.frequency}</td><td className="muted">next ≈ {d.due_date}</td>
                <td className="right"><button className="btn small" onClick={() => track(d)}>Track</button></td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}

      <div className="card">
        <table className="table">
          <thead><tr><th>Bill</th><th>Due</th><th>Status</th><th className="right">Amount</th><th className="right">Per month</th><th /></tr></thead>
          <tbody>
            {data.bills.map((b) => {
              const [label, cls] = STATUS[b.status];
              return (
                <tr key={b.id}>
                  <td><strong>{b.name}</strong><div className="small muted">{b.frequency}{b.category_name ? ' · ' + b.category_name : ''}{b.autopay ? ' · autopay' : ''}</div></td>
                  <td>{b.status === 'overdue' ? b.prev_due : b.next_due}
                    <div className="small muted">{b.status === 'overdue' ? 'was due ' + dayLabel(-Math.round((new Date(data.today) - new Date(b.prev_due)) / 86400000)) : dayLabel(b.days_until)}</div></td>
                  <td><span className={cls}>{label}</span>{b.last_paid && <div className="small muted">last paid {b.last_paid}</div>}</td>
                  <td className="right">{fmt2(b.amount)}</td><td className="right muted">{fmt2(b.monthly)}</td>
                  <td className="right nowrap">
                    <button className="link" onClick={() => toggleAuto(b)} title="Autopay bills don't flag overdue">{b.autopay ? 'autopay ✓' : 'autopay'}</button>
                    <button className="link" onClick={() => setForm({ ...b, category_id: b.category_id ?? '' })}>edit</button>
                    <button className="link danger" onClick={() => remove(b)}>✕</button>
                  </td>
                </tr>
              );
            })}
            {data.bills.length === 0 && <tr><td colSpan="6" className="muted center">No bills tracked yet. Import a few months of transactions and detected bills will appear above.</td></tr>}
          </tbody>
        </table>
        <p className="muted small">A bill counts as paid when a transaction whose description contains the bill's name (or its match text) posts near the due date.</p>
      </div>
      {form && <BillForm init={form} cats={cats} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </>
  );
}

function BillForm({ init, cats, onClose, onSaved }) {
  const [f, setF] = useState(init);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try {
      const body = { ...f, amount: Number(f.amount), category_id: f.category_id || null };
      f.id ? await api.patch(`/api/bills/${f.id}`, body) : await api.post('/api/bills', body);
      onSaved();
    } catch (e) { alert(e.message); }
  };
  return (
    <div className="modal" onClick={onClose}><div className="card modalbody" onClick={(e) => e.stopPropagation()}>
      <h3>{f.id ? 'Edit bill' : 'Add bill'}</h3>
      <div className="form">
        <input placeholder="Name (e.g. Netflix)" value={f.name} onChange={set('name')} />
        <div className="row gap"><input type="number" step="0.01" placeholder="Amount" value={f.amount} onChange={set('amount')} />
          <select value={f.frequency} onChange={set('frequency')}>{FREQS.map((x) => <option key={x}>{x}</option>)}</select></div>
        <label className="small muted">A due date (past or future; later ones are worked out)<input type="date" value={f.due_date} onChange={set('due_date')} /></label>
        <select value={f.category_id} onChange={set('category_id')}><option value="">No category</option>{cats.filter((c) => c.kind === 'expense').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input placeholder="Match text in bank description (optional, defaults to name)" value={f.pattern} onChange={set('pattern')} />
        <label><input type="checkbox" checked={!!f.autopay} onChange={(e) => setF({ ...f, autopay: e.target.checked })} /> Autopay (never flag as overdue)</label>
      </div>
      <div className="row gap end"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" onClick={save}>Save</button></div>
    </div></div>
  );
}
