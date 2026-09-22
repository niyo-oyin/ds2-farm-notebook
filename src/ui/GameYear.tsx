import { useEffect, useRef, useState } from 'react';
import { useApp } from './app-context';
import { store } from '../store/userdata';
import './GameYear.css';

/** 年齢計算に使うゲーム内の年を、ヘッダーで表示・変更する。 */
export function GameYear() {
  const app = useApp();
  const year = app.data.settings.gameYear;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    setText(year !== undefined ? String(year) : '');
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open, year]);
  const setYear = (v: number | undefined) => store.setSettings({ gameYear: v !== undefined && Number.isInteger(v) && v >= 0 ? v : undefined });
  const commit = () => { const v = text.trim() === '' ? undefined : Number(text); setYear(v); setOpen(false); };
  return <div className="game-year" ref={root}>
    <button type="button" className={'game-year-button' + (year === undefined ? ' unset' : '')} aria-expanded={open} title="ゲーム内の年（年齢の表示に使う）" onClick={() => setOpen(!open)}>{year !== undefined ? `${year}年` : '年未設定'}</button>
    {open && <div className="game-year-panel" role="dialog" aria-label="ゲーム内の年">
      <div className="game-year-row">
        <button type="button" aria-label="1年戻す" disabled={year === undefined || year <= 0} onClick={() => setYear((year ?? 0) - 1)}>−</button>
        <input aria-label="ゲーム内の年" inputMode="numeric" value={text} placeholder="例 29" onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
        <span>年</span>
        <button type="button" aria-label="1年進める" onClick={() => setYear((year ?? 0) + 1)}>＋</button>
      </div>
      <p className="small muted">年齢は「年 − 生年」で表示します。カードの写真を反映すると、年齢から推定した年が進んでいれば自動で更新します。</p>
      <div className="game-year-actions"><button type="button" className="primary" onClick={commit}>決定</button></div>
    </div>}
  </div>;
}
