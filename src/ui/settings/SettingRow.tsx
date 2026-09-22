import { useId, type ReactNode } from 'react';

export function SettingRow({ label, description, changed, children, toggle = false }: {
  label: string;
  description?: ReactNode;
  changed?: boolean;
  children: (id: string, descriptionId?: string) => ReactNode;
  toggle?: boolean;
}) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  return <div className={`setting-row${toggle ? ' setting-row-toggle' : ''}`}>
    <div className="setting-label">
      <label htmlFor={id}>{label}</label>
      {changed && <span className="setting-changed">変更済み</span>}
      {description && <div id={descriptionId} className="setting-description">{description}</div>}
    </div>
    <div className="setting-control">{children(id, descriptionId)}</div>
  </div>;
}

export function SettingSwitch({ label, description, checked, onChange }: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return <SettingRow label={label} description={description} toggle>
    {(id, descriptionId) => <label className="setting-switch">
      <input id={id} type="checkbox" role="switch" aria-describedby={descriptionId} checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>}
  </SettingRow>;
}
