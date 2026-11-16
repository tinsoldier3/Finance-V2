import { NavLink, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import Transactions from './pages/Transactions.jsx';
import Budgets from './pages/Budgets.jsx';
import Accounts from './pages/Accounts.jsx';
import Rules from './pages/Rules.jsx';

const links = [
  ['/', 'Overview', '◎'], ['/transactions', 'Transactions', '☰'], ['/budgets', 'Budgets', '◔'],
  ['/accounts', 'Accounts', '▣'], ['/rules', 'Rules', '⚙'],
];

export default function App() {
  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">Finance<span>V2</span></div>
        {links.map(([to, label, icon]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => 'navlink' + (isActive ? ' active' : '')}>
            <span className="icon">{icon}</span>{label}
          </NavLink>
        ))}
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/budgets" element={<Budgets />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/rules" element={<Rules />} />
        </Routes>
      </main>
    </div>
  );
}
