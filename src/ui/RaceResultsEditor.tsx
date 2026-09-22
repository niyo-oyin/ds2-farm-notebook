import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { raceSchedule, sortRaces, type Race } from '../core/races';
import type { RaceEntry } from '../core/types';
import { CENTRAL_RACE_VENUES } from '../data/race-venues';
import { ActionDialog } from './ActionDialog';
import { RaceFinishBadge, RaceGradeBadge } from './RaceBadges';
import { nameSearch } from './name-search';
import './RaceResultsEditor.css';

const COMMON_RACES = ['新馬戦', '未勝利戦', '1勝クラス', '2勝クラス', '3勝クラス', 'オープン'];

export function RaceResultsEditor({ value, races, onChange }: { value: RaceEntry[]; races: Race[]; onChange: (value: RaceEntry[]) => void }) {
  const [target, setTarget] = useState<number | 'new' | null>(null);
  return <>
    <div className="sheet-section-heading sheet-races-heading"><h4>競走成績</h4><button type="button" onClick={() => setTarget('new')}>＋ レースを選んで追加</button></div>
    {value.length ? <div className="table-wrap"><table className="sheet-races">
      <thead><tr><th>月.週</th><th>競馬場</th><th>レース名</th><th>距離</th><th>馬場</th><th>着順</th><th aria-label="操作" /></tr></thead>
      <tbody>{value.map((entry, i) => <tr key={i}>
        <td>{entry.date || '—'}</td><td>{entry.place || '—'}</td>
        <td className="sheet-race-name"><button type="button" onClick={() => setTarget(i)} aria-label={`${entry.race || '戦績'}を編集`}>{entry.grade && entry.grade === entry.race ? <RaceGradeBadge grade={entry.grade} /> : entry.race || '名称未入力'}</button>{entry.grade && entry.grade !== entry.race && <RaceGradeBadge grade={entry.grade} />}</td>
        <td>{[entry.surface, entry.distance == null ? '' : `${entry.distance.toLocaleString()}m`].filter(Boolean).join(' ') || '—'}</td>
        <td>{entry.going || '—'}</td><td><RaceFinishBadge finish={entry.finish} /></td>
        <td><button type="button" onClick={() => setTarget(i)}>編集</button><button type="button" aria-label={`${entry.race || 'この行'}を削除`} onClick={() => onChange(value.filter((_, j) => j !== i))}>削除</button></td>
      </tr>)}</tbody>
    </table></div> : <p className="small muted">競走成績はまだありません。</p>}
    {target !== null && <RaceResultDialog races={races} initial={target === 'new' ? undefined : value[target]} onClose={() => setTarget(null)} onSave={(entry) => {
      onChange(target === 'new' ? [entry, ...value] : value.map((row, i) => i === target ? entry : row));
      setTarget(null);
    }} />}
  </>;
}

function raceDetails(race: Race) {
  return [raceSchedule(race), race.venue, [race.surface, race.distance === null ? '' : `${race.distance.toLocaleString()}m`].filter(Boolean).join(' '), race.conditions].filter(Boolean).join(' · ');
}

function RaceResultDialog({ races, initial, onClose, onSave }: { races: Race[]; initial?: RaceEntry; onClose: () => void; onSave: (entry: RaceEntry) => void }) {
  const [query, setQuery] = useState('');
  const [month, setMonth] = useState('');
  const [selected, setSelected] = useState<Race | null>(null);
  const [entry, setEntry] = useState<RaceEntry | null>(initial ?? null);
  const [picking, setPicking] = useState(!initial);
  const rows = useMemo(() => sortRaces(nameSearch(query).filter(races.filter((r) => !month || r.month === Number(month)), (r) => [r.name, r.venue, r.grade, r.conditions]), 'schedule', 'asc'), [races, query, month]);
  const otherVenues = [...new Set([...races.map((race) => race.venue), entry?.place ?? ''])].filter((venue) => venue && !CENTRAL_RACE_VENUES.includes(venue)).sort((a, b) => a.localeCompare(b, 'ja'));
  const grades = [...new Set(['GⅠ', 'GⅡ', 'GⅢ', 'JpnⅠ', 'JpnⅡ', 'JpnⅢ', 'L', ...COMMON_RACES, ...races.map((race) => race.grade), entry?.grade ?? ''])].filter(Boolean);
  const choose = (race: Race | null, name = '') => {
    setSelected(race);
    setPicking(false);
    setEntry({
      race: race?.name ?? name, place: race?.venue ?? '', finish: entry?.finish ?? '',
      date: initial ? entry?.date ?? initial.date : race?.month == null ? entry?.date ?? '' : `${race.month}${race.week === null ? '' : `.${race.week}`}`,
      grade: race?.grade || (COMMON_RACES.includes(name) ? name : undefined),
      surface: race?.surface || undefined, distance: race?.distance ?? undefined, going: entry?.going,
    });
  };
  const change = (patch: Partial<RaceEntry>) => setEntry((current) => current ? { ...current, ...patch } : current);

  // 所有馬の編集フォームと、戦績の入力フォームを入れ子にしない。
  return createPortal(<ActionDialog title={initial ? '戦績を編集' : '戦績を追加'} className="race-result-dialog" onClose={onClose}>
    {entry && !picking ? <form onSubmit={(e) => {
      e.preventDefault(); e.stopPropagation();
      if (entry.race.trim()) onSave({ ...entry, date: entry.date.trim(), place: entry.place.trim(), race: entry.race.trim(), finish: entry.finish.trim() });
    }}>
      <div className="race-result-selection">
        <button type="button" onClick={() => setPicking(true)}>← レースを選び直す</button>
        {selected && <p className="small muted">{selected.conditions}</p>}
      </div>
      <div className="race-result-fields">
        <label className="field race-result-race">レース名<input value={entry.race} required autoFocus={!initial && !selected && !entry.race} onChange={(e) => change({ race: e.target.value })} /></label>
        <label className="field">月.週<input value={entry.date} placeholder="例：5.4" autoFocus={!initial && !selected && !!entry.race} onChange={(e) => change({ date: e.target.value })} /></label>
        <label className="field">競馬場<select aria-label="競馬場" value={entry.place} onChange={(e) => change({ place: e.target.value })}>
          <option value="">未入力</option><optgroup label="中央">{CENTRAL_RACE_VENUES.map((venue) => <option key={venue}>{venue}</option>)}</optgroup>
          {otherVenues.length > 0 && <optgroup label="その他の競馬場">{otherVenues.map((venue) => <option key={venue}>{venue}</option>)}</optgroup>}
        </select></label>
        <label className="field">格付け・クラス<select value={entry.grade ?? ''} onChange={(e) => change({ grade: e.target.value || undefined })}><option value="">未入力</option>{grades.map((grade) => <option key={grade}>{grade}</option>)}</select></label>
        <label className="field">芝・ダート<select value={entry.surface ?? ''} onChange={(e) => change({ surface: e.target.value as RaceEntry['surface'] || undefined })}><option value="">未入力</option><option>芝</option><option>ダート</option></select></label>
        <label className="field">距離（m）<input type="number" min="1" max="100000" step="1" value={entry.distance ?? ''} placeholder="例：1600" onChange={(e) => change({ distance: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
        <label className="field">馬場状態<select value={entry.going ?? ''} onChange={(e) => change({ going: e.target.value as RaceEntry['going'] || undefined })}><option value="">未入力</option>{['良', '稍重', '重', '不良'].map((going) => <option key={going}>{going}</option>)}</select></label>
        <label className="field">着順<input value={entry.finish} placeholder="1、取消 など" autoFocus={!!initial || !!selected} onChange={(e) => change({ finish: e.target.value })} /></label>
      </div>
      <div className="action-dialog-actions"><button type="button" onClick={onClose}>キャンセル</button><button type="submit" className="primary" disabled={!entry.race.trim()}>{initial ? '変更を反映' : '戦績に追加'}</button></div>
    </form> : <>
      <fieldset className="race-picker-common"><legend>よく使うレース</legend><div>{COMMON_RACES.map((name) => <button key={name} type="button" onClick={() => choose(null, name)}>{name}</button>)}</div></fieldset>
      <div className="race-picker-tools">
        <label className="field race-picker-search">レースを検索<input autoFocus type="search" placeholder="レース名・競馬場" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <label className="field">開催月<select value={month} onChange={(e) => setMonth(e.target.value)}><option value="">すべて</option>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}月</option>)}</select></label>
      </div>
      <div className="race-picker-heading"><span className="small muted" role="status">{rows.length}件</span><button type="button" onClick={() => choose(null)}>手入力で追加</button></div>
      <ul className="race-picker-list">{rows.map((race) => <li key={race.id}><button type="button" onClick={() => choose(race)}>
        <span className="race-picker-name"><strong>{race.name}</strong>{race.grade && <RaceGradeBadge grade={race.grade} />}</span>
        <span className="race-picker-details">{raceDetails(race)}</span>
      </button></li>)}</ul>
      {!rows.length && <p className="small muted">該当するレースがありません。</p>}
    </>}
  </ActionDialog>, document.body);
}
