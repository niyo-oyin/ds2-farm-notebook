import { useEffect, useRef, useState, type ReactNode } from 'react';

/** 見出しの横に置く「?」。押した時だけ、その欄で何を指定するかの説明を出す */
export function Tip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return <span className="help-wrap tip" ref={ref}>
    <button type="button" className="help-icon tip-icon" aria-label={`${label}の説明`} aria-expanded={open} onClick={() => setOpen(!open)}>?</button>
    {open && <span className="popover" role="note">{children}</span>}
  </span>;
}
