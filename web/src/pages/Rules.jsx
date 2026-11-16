import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Rules() {
  const [rules, setRules] = useState([]);
  const [cats, setCats] = useState([]);
  const [pattern, setPattern] = useState('');
  const [category, setCategory] = useState('');
  const [msg, setMsg] = useState('');
  const load = () => api.get('/api/rules').then(setRules);
  useEffect(() => { load(); api.get('/api/categories').then(setCats); }, []);

  const add = async () => {
    if (!pattern || !category) return;
    const r = await api.post('/api/rules', { pattern, category_id: Number(category) });
    setMsg(`Rule added. Categorized ${r.applied} existing transaction(s).`); setPattern(''); load();
  };
  const reapply = async () => {
    if (!confirm('Re-run all rules on EVERY transaction, overwriting categories you set by hand?')) return;
    const r = await api.post('/api/rules/apply', { overwrite: true }); setMsg(`Re-categorized ${r.applied} transaction(s).`);
  };

  return (
    <>
      <div className="pagehead"><h1>Rules</h1></div>
      <div className="card">
        <p className="muted">When a description <em>contains</em> the text, it gets that category. Rules run on every import and only touch uncategorized transactions. First matching rule wins.</p>
        <div className="row gap wrap">
          <input placeholder='Text to match, e.g. "starbucks"' value={pattern} onChange={(e) => setPattern(e.target.value)} />
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Category…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="btn" onClick={add}>Add rule</button>
          <button className="btn ghost" onClick={reapply}>Re-apply to all</button>
        </div>
        {msg && <p className="pos">{msg}</p>}
      </div>
      <div className="card">
        <table className="table"><thead><tr><th>If description contains</th><th>Category</th><th /></tr></thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}><td><code>{r.pattern}</code></td><td>{r.category_name}</td>
                <td className="right"><button className="link danger" onClick={async () => { await api.del(`/api/rules/${r.id}`); load(); }}>✕</button></td></tr>
            ))}
            {rules.length === 0 && <tr><td colSpan="3" className="muted center">No rules yet.</td></tr>}
          </tbody></table>
      </div>
    </>
  );
}
