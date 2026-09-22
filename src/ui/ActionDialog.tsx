import { useEffect, useId, useRef, type ReactNode } from 'react';
import './ActionDialog.css';

export function ActionDialog({ title, onClose, children, wide = false, actions, className = '' }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; actions?: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); dialog.querySelector<HTMLElement>('input, select, textarea')?.focus(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className={'action-dialog' + (wide ? ' wide' : '') + ' ' + className} aria-labelledby={id} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
    <div className="action-dialog-heading"><h3 id={id}>{title}</h3>{actions}<button type="button" className="action-dialog-close" aria-label="閉じる" onClick={onClose}>×</button></div>
    {children}
  </dialog>;
}
