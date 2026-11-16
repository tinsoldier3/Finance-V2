import { monthLabel, shiftMonth } from '../api.js';

export default function MonthPicker({ month, onChange }) {
  return (
    <div className="monthpicker">
      <button onClick={() => onChange(shiftMonth(month, -1))}>‹</button>
      <strong>{monthLabel(month)}</strong>
      <button onClick={() => onChange(shiftMonth(month, 1))}>›</button>
    </div>
  );
}
