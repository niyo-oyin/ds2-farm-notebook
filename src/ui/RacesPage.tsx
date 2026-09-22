import { useId, useMemo, useState } from 'react';
import { applyRaceEdits, EMPTY_RACE_FIELDS, raceDiff, raceSchedule, sortRaces, validateRace, type Race, type RaceFields, type RaceSort } from '../core/races';
import { baseRaces } from '../data/races';
import { store, uid } from '../store/userdata';
import { useApp } from './app-context';
import { ActionDialog } from './ActionDialog';
import { RaceGradeBadge } from './RaceBadges';
import { nameSearch } from './name-search';
import { DataMaintenanceFilters } from './DataMaintenanceFilters';
import { matchesMaintenance } from './data-maintenance';
import './RacesPage.css';

const COLUMNS: { key: RaceSort; label: string }[] = [
  { key: 'name', label: 'レース名' }, { key: 'schedule', label: '開催時期' }, { key: 'venue', label: '競馬場' },
  { key: 'surface', label: '馬場' }, { key: 'distance', label: '距離（m）' }, { key: 'grade', label: '格付け・クラス' },
];

export function RacesPage() {
  const app = useApp();
  const races = useMemo(() => applyRaceEdits(baseRaces, app.data.raceEdits), [app.data.raceEdits]);
  const [query, setQuery] = useState('');
  const [conditions, setConditions] = useState('');
  const [maintenance, setMaintenance] = useState<string[]>([]);
  const [sort, setSort] = useState<RaceSort>('name');
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const [target, setTarget] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const edits = useMemo(() => new Map(app.data.raceEdits.map((e) => [e.id, e])), [app.data.raceEdits]);
  const conditionOptions = useMemo(() => [...new Set(races.map((r) => r.conditions).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja', { numeric: true })), [races]);
  const rows = useMemo(() => sortRaces(nameSearch(query).filter(races.filter((r) => (!conditions || r.conditions === conditions)
    && matchesMaintenance(maintenance, [edits.has(r.id) && 'edited'])), (r) => [r.name, r.venue, r.grade, r.conditions]), sort, direction), [races, query, conditions, maintenance, edits, sort, direction]);
  const selected = races.find((r) => r.id === target);
  const changeSort = (key: RaceSort) => { setSort(key); setDirection(sort === key && direction === 'asc' ? 'desc' : 'asc'); };

  return <div className="races-page">
    <div className="race-tools">
      <input aria-label="レースを検索" placeholder="レース名・競馬場で検索" value={query} onChange={(e) => setQuery(e.target.value)} />
      <select aria-label="出走条件で絞り込み" value={conditions} onChange={(e) => setConditions(e.target.value)}><option value="">出走条件：すべて</option>{conditionOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      <span className="small muted" role="status">{rows.length}件</span>
      <button type="button" className="primary" onClick={() => setTarget('new')}>＋ レースを追加</button>
    </div>
    <DataMaintenanceFilters options={[['edited', '追加・修正あり']]} selected={maintenance} onChange={setMaintenance} />
    {message && <p className="small" role="status">{message}</p>}
    <div className="table-wrap"><table className="race-table">
      <thead><tr>{COLUMNS.map(({ key, label }) => <th key={key} aria-sort={sort === key ? direction === 'asc' ? 'ascending' : 'descending' : 'none'} className={key === 'distance' ? 'num' : ''}>
        <button type="button" onClick={() => changeSort(key)}>{label}<span aria-hidden="true">{sort === key ? direction === 'asc' ? ' ↑' : ' ↓' : ' ↕'}</span></button>
      </th>)}<th className="wrap">出走条件</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id} className="clickable" onClick={() => setTarget(r.id)}>
        <td className="name"><button type="button" className="result-name-button" onClick={() => setTarget(r.id)}>{r.name}</button>{edits.has(r.id) && <span className="tag">{edits.get(r.id)?.added ? '追加' : '修正あり'}</span>}</td>
        <td>{raceSchedule(r)}</td><td>{r.venue || '—'}</td><td>{r.surface || '—'}</td><td className="num">{r.distance?.toLocaleString() ?? '—'}</td><td>{r.grade ? <RaceGradeBadge grade={r.grade} /> : '—'}</td><td className="wrap">{r.conditions || '—'}</td>
      </tr>)}</tbody>
    </table></div>
    {!rows.length && <div className="empty">該当するレースがありません。</div>}
    {(target === 'new' || selected) && <RaceDialog key={target} race={selected ?? null} edited={!!selected && edits.has(selected.id)}
      onClose={() => setTarget(null)} onSaved={(id) => { setTarget(id); setMessage('レースを保存しました'); }}
      onRemoved={() => { setTarget(null); setMessage(selected && baseRaces.some((r) => r.id === selected.id) ? '元のデータに戻しました' : 'レースを削除しました'); }} />}
  </div>;
}

type RaceForm = Record<keyof RaceFields, string>;
const toForm = (r: RaceFields): RaceForm => Object.fromEntries(Object.keys(EMPTY_RACE_FIELDS).map((key) => [key, String(r[key as keyof RaceFields] ?? '')])) as RaceForm;

function RaceDialog({ race, edited, onClose, onSaved, onRemoved }: { race: Race | null; edited: boolean; onClose: () => void; onSaved: (id: string) => void; onRemoved: () => void }) {
  const formId = useId();
  const initial = toForm(race ?? EMPTY_RACE_FIELDS);
  const [draft, setDraft] = useState<RaceForm | null>(null);
  const form = draft ?? initial;
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const base = race ? baseRaces.find((r) => r.id === race.id) : undefined;
  const change = (key: keyof RaceFields, value: string) => { setDraft({ ...form, [key]: value }); setError(''); setSaved(false); };
  const close = () => { if (!dirty || confirm('保存していない変更を破棄して閉じますか？')) onClose(); };
  const save = () => {
    try {
      const value: RaceFields = {
        name: form.name.trim(), month: form.month.trim() ? Number(form.month) : null, week: form.week.trim() ? Number(form.week) : null,
        venue: form.venue.trim(), surface: form.surface as RaceFields['surface'], distance: form.distance.trim() ? Number(form.distance) : null,
        grade: form.grade.trim(), conditions: form.conditions.trim(), memo: form.memo.trim(),
      };
      validateRace(value);
      const id = race?.id ?? uid('rc:u');
      const data = base ? raceDiff(base, value) : value;
      if (base && !Object.keys(data).length) store.deleteRaceEdit(id);
      else store.saveRaceEdit({ id, added: !base, data });
      setDraft(null); setSaved(true); onSaved(id);
    } catch (e) { setError((e as Error).message); }
  };
  const remove = () => {
    if (!race || !confirm(base ? 'このレースの保存済みの修正を取り消しますか？' : `「${race.name}」をレース一覧から削除しますか？ 所有馬の戦績は残ります。`)) return;
    store.deleteRaceEdit(race.id); onRemoved();
  };
  return <ActionDialog wide className="race-dialog" title={race?.name ?? 'レースを追加'} onClose={close} actions={<div className="race-dialog-actions">
    {edited && <button type="button" className="danger" onClick={remove}>{base ? '修正を取り消す' : '削除'}</button>}
    {dirty && <button type="button" onClick={() => { setDraft(null); setError(''); setSaved(false); }}>変更を戻す</button>}
    {(!race || dirty) && <button type="submit" form={formId} className="primary">{race ? '保存' : '追加'}</button>}
  </div>}>
    <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="race-fields">
        <label className="field race-full">レース名<input value={form.name} onChange={(e) => change('name', e.target.value)} required /></label>
        <label className="field">開催月<input type="number" min={1} max={12} value={form.month} onChange={(e) => change('month', e.target.value)} /></label>
        <label className="field">開催週<input type="number" min={1} max={5} value={form.week} onChange={(e) => change('week', e.target.value)} /></label>
        <label className="field">競馬場<input value={form.venue} onChange={(e) => change('venue', e.target.value)} /></label>
        <label className="field">馬場<select value={form.surface} onChange={(e) => change('surface', e.target.value)}><option value="">—</option><option>芝</option><option>ダート</option></select></label>
        <label className="field">距離（m）<input type="number" min={1} value={form.distance} onChange={(e) => change('distance', e.target.value)} /></label>
        <label className="field">格付け・クラス<input value={form.grade} onChange={(e) => change('grade', e.target.value)} /></label>
        <label className="field race-full">出走条件<input value={form.conditions} onChange={(e) => change('conditions', e.target.value)} /></label>
        <label className="field race-full">メモ<textarea rows={3} value={form.memo} onChange={(e) => change('memo', e.target.value)} /></label>
      </div>
      {error && <div role="alert" className="error">{error}</div>}
      {saved && !dirty && <div className="small" role="status">保存しました</div>}
    </form>
  </ActionDialog>;
}
