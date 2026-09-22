import type { MasterData, MasterHorse } from '../core/types';
import type { MasterEdit } from '../core/master-edits';

export interface HorseColumn { key: string; label: string; numeric?: boolean }
export function horseColumns(kind: MasterHorse['kind']): HorseColumn[] {
  return [
    { key: 'name', label: '馬名' }, { key: 'price', label: kind === 'stallion' ? '種付料' : '購入価格', numeric: true },
    ...(kind === 'stallion' ? [
      { key: 'dist', label: '距離（m）' }, { key: 'grown', label: '成長' }, { key: 'dirt', label: 'ダート' },
      { key: 'kenko', label: '体質' }, { key: 'kisyo', label: '気性' },
      { key: 'jisseki', label: '実績' }, { key: 'konjo', label: '底力' }, { key: 'antei', label: '安定' },
    ] : [
      { key: 'speed', label: 'スピード', numeric: true }, { key: 'stamina', label: 'スタミナ', numeric: true },
      { key: 'power', label: 'パワー', numeric: true }, { key: 'dirt', label: 'ダート' },
      { key: 'kenko', label: '体質' }, { key: 'kisyo', label: '気性' },
    ]),
  ];
}

/** 非表示の馬も修正済みの値で管理できるように一覧へ戻す。 */
export function catalogHorses(master: MasterData, base: MasterData, edits: MasterEdit[], kind: MasterHorse['kind']): MasterHorse[] {
  const listKey = kind === 'stallion' ? 'stallions' : 'broodmares';
  return [...master[listKey], ...base[listKey].flatMap(h => {
    const edit = edits.find(e => e.id === h.id && e.hidden);
    return edit ? [{ ...h, ...edit.data }] : [];
  })];
}

function rawValue(h: MasterHorse, key: string): unknown {
  if (key === 'name') return h.name;
  if (key === 'price') return h.priceUnknown ? null : h.kind === 'stallion' ? h.price : h.purchasePrice ?? 0;
  return h.attrs[key];
}
const unknown = (v: unknown) => v == null || v === '' || v === '-';
export function horseCell(h: MasterHorse, key: string): string {
  const v = rawValue(h, key);
  if (unknown(v)) return '—';
  if (key === 'dist') return Array.isArray(v) && v[1] ? `${v[0]}–${v[1]}` : '—';
  if (key === 'price' && h.kind === 'broodmare' && !h.purchasePrice) return '初期から利用可';
  return typeof v === 'number' ? v.toLocaleString('ja-JP') : String(v);
}
function sortValue(h: MasterHorse, key: string): string | number | null {
  const v = rawValue(h, key);
  if (unknown(v)) return null;
  if (key === 'dist') return Array.isArray(v) && Number(v[1]) > 0 ? Number(v[1]) : null;
  if (['dirt', 'kenko', 'kisyo', 'jisseki', 'antei', 'konjo'].includes(key)) return ({ A: 3, B: 2, C: 1, '◎': 3, '○': 2, '△': 1 } as Record<string, number>)[String(v)] ?? null;
  if (['price', 'speed', 'stamina', 'power'].includes(key)) return Number.isFinite(Number(v)) ? Number(v) : null;
  return String(v);
}
export function sortHorses(horses: MasterHorse[], key: string, direction: 'asc' | 'desc'): MasterHorse[] {
  return [...horses].sort((a, b) => {
    const x = sortValue(a, key), y = sortValue(b, key);
    if (x === null) return y === null ? a.name.localeCompare(b.name, 'ja') : 1;
    if (y === null) return -1;
    const diff = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ja');
    return diff * (direction === 'asc' ? 1 : -1) || a.name.localeCompare(b.name, 'ja');
  });
}
