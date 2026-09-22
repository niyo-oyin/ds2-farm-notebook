import './DataMaintenanceFilters.css';

export function DataMaintenanceFilters({ options, selected, onChange }: {
  options: [string, string][];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  return <fieldset className="data-maintenance-filters">
    <legend>データ管理</legend>
    <div>{options.map(([value, label]) => <label key={value}>
      <input type="checkbox" checked={selected.includes(value)} onChange={(e) => onChange(e.target.checked ? [...selected, value] : selected.filter((item) => item !== value))} />{label}
    </label>)}{selected.length > 1 && <span className="small muted">いずれかに一致</span>}</div>
  </fieldset>;
}
