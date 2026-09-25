import type { ReactNode } from 'react';
import type { Judgement } from '../core/types';
import type { JudgementSummary } from '../core/search';
import { horseCell, horseColumns, type HorseValues } from './master-horse-catalog';
import type { OneGenSort } from './onegen-results';
import { Summary } from './SearchPage';

export const oneGenAbilityColumns = horseColumns('stallion').slice(2);
export const oneGenColumns = (fromStallion = false, showOrigin = true) => [
  { key: fromStallion ? 'dam' : 'sire', label: fromStallion ? '母（繁殖牝馬）' : '父（種牡馬）', numeric: false },
  ...(showOrigin ? [{ key: fromStallion ? 'sire' : 'dam', label: fromStallion ? '父（起点）' : '母（起点）', numeric: false }] : []),
  { key: 'price', label: '種付料（万）', numeric: true }, ...oneGenAbilityColumns,
  { key: 'judgement', label: '判定', numeric: false },
];
export interface OneGenResultRow {
  sire: string; dam: string; judgement: Judgement; s: JudgementSummary; stallion: HorseValues;
}
export const oneGenRowKey = (r: OneGenResultRow) => `${r.sire}:${r.dam}`;

export function OneGenResultList<T extends OneGenResultRow>({ rows, mobile, sort, changeSort, open, toggle, nameButton, constraints, expanded, fromStallion = false, showOrigin = true, label }: {
  rows: T[]; mobile: boolean; sort: OneGenSort; changeSort: (key: string) => void;
  open: string | null; toggle: (key: string) => void; fromStallion?: boolean; showOrigin?: boolean; label: string;
  nameButton: (key: string) => ReactNode; constraints: (key: string) => ReactNode;
  expanded: (r: T) => ReactNode;
}) {
  const columns = oneGenColumns(fromStallion, showOrigin);
  const partnerKey = (r: T) => fromStallion ? r.dam : r.sire;
  const originKey = (r: T) => fromStallion ? r.sire : r.dam;
  if (mobile) return <div className="result-cards" aria-label={label}>{rows.map(r => <div key={oneGenRowKey(r)} className={'result-card clickable' + (open === oneGenRowKey(r) ? ' selected' : '')} onClick={() => toggle(oneGenRowKey(r))}>
    <div className="result-head"><b>{nameButton(partnerKey(r))} {constraints(partnerKey(r))}</b><span className="num muted">{r.judgement.costUnknown ? '未確認' : `${r.judgement.cost.toLocaleString()}万`}</span></div>
    {showOrigin && <div className="small muted">{fromStallion ? '父' : '母'}：{nameButton(originKey(r))} {constraints(originKey(r))}</div>}
    <dl className="onegen-card-abilities" aria-label="種牡馬の能力">{oneGenAbilityColumns.map(c => <div key={c.key}><dt>{c.label}</dt><dd>{horseCell(r.stallion, c.key)}</dd></div>)}</dl>
    <Summary s={r.s} />
    {open === oneGenRowKey(r) && expanded(r)}
  </div>)}</div>;
  return <div className="table-wrap"><table className="onegen-table" aria-label={label}>
    <thead><tr>{columns.map(c => <th key={c.key} className={c.numeric ? 'num' : undefined} aria-sort={sort.column === c.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => changeSort(c.key)} title={c.key === 'dist' ? '距離上限で並べ替え' : c.key === 'judgement' ? 'おすすめ順で並べ替え' : `${c.label}で並べ替え`}>{c.label}<span aria-hidden="true">{sort.column === c.key ? sort.direction === 'asc' ? ' ↑' : ' ↓' : ' ↕'}</span></button></th>)}</tr></thead>
    <tbody>{rows.map(r => [
      <tr key={oneGenRowKey(r)} className={'clickable' + (open === oneGenRowKey(r) ? ' selected' : '')} onClick={() => toggle(oneGenRowKey(r))}>
        <td className="name">{nameButton(partnerKey(r))} {constraints(partnerKey(r))}</td>{showOrigin && <td className="name">{nameButton(originKey(r))} {constraints(originKey(r))}</td>}<td className="num">{r.judgement.costUnknown ? '—' : r.judgement.cost.toLocaleString()}</td>
        {oneGenAbilityColumns.map(c => <td key={c.key} className={c.key === 'dist' ? 'onegen-distance' : 'onegen-rating'}><span className={horseCell(r.stallion, c.key) === '—' ? 'muted' : undefined}>{horseCell(r.stallion, c.key)}</span></td>)}
        <td className="wrap onegen-judgement"><Summary s={r.s} /></td>
      </tr>,
      open === oneGenRowKey(r) && <tr key={'d' + oneGenRowKey(r)} className="result-expanded-row"><td colSpan={columns.length} className="wrap">{expanded(r)}</td></tr>,
    ])}</tbody>
  </table></div>;
}
