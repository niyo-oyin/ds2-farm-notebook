import { useState } from 'react';
import { ActionDialog } from './ActionDialog';

export function SavePlanDialog({ defaultName, onSave, onClose }: { defaultName: string; onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState('');
  return <ActionDialog title="計画として保存" onClose={onClose}>
    <form onSubmit={(e) => {
      e.preventDefault();
      if (!name.trim()) return;
      try { onSave(name.trim()); } catch (error) { setError((error as Error).message); }
    }}>
      <label className="field">計画名<input required value={name} onChange={(e) => { setName(e.target.value); setError(''); }} onFocus={(e) => e.currentTarget.select()} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="action-dialog-actions"><button type="button" onClick={onClose}>キャンセル</button><button type="submit" className="primary" disabled={!name.trim()}>保存する</button></div>
    </form>
  </ActionDialog>;
}
