import type { HorseAbilities, HorseCategory, RaceAbilities } from '../core/types';
import { ABILITY_RANKS, DIRT_APTITUDES, GROWTH_TYPES, RACE_ABILITY_FIELDS, RACE_TRAIT_FIELDS } from '../core/owned-horse';

type Group = 'broodmare' | 'stallion';
type Field = { key: string; label: string; type?: 'number' | 'text'; options?: readonly string[] };
const rank = (key: string, label: string): Field => ({ key, label, options: ABILITY_RANKS });
const fields: Record<Group, Field[]> = {
  broodmare: [
    { key: 'speed', label: 'スピード', type: 'number' }, { key: 'stamina', label: 'スタミナ', type: 'number' },
    { key: 'power', label: 'パワー', type: 'number' }, rank('health', '体質'), rank('temperament', '気性'), { key: 'dirt', label: 'ダート', options: DIRT_APTITUDES },
  ],
  stallion: [
    { key: 'dirt', label: 'ダート', options: DIRT_APTITUDES }, { key: 'growth', label: '成長', options: GROWTH_TYPES }, rank('temperament', '気性'), rank('guts', '底力'), rank('health', '体質'),
    rank('achievement', '実績'), rank('stability', '安定'),
    { key: 'distanceMin', label: '距離下限（m）', type: 'number' }, { key: 'distanceMax', label: '距離上限（m）', type: 'number' },
  ],
};

/** 現役馬のカード。ゲーム画面と同じ並びで印を選ぶ。「-」は未判明として保存しない。 */
function RaceCard({ value, onChange }: { value: RaceAbilities; onChange: (value: RaceAbilities) => void }) {
  const update = (key: keyof RaceAbilities, input: string) => {
    const next = { ...value };
    if (input === '' || input === '-') delete next[key]; else next[key] = input;
    onChange(next);
  };
  const mark = (key: keyof RaceAbilities, label: string, marks: readonly string[]) => {
    const current = value[key] ?? '';
    return <label key={key} className={'race-mark' + (current ? ' known' : '')}><span>{label}</span>
      <select aria-label={label} value={current} onChange={(e) => update(key, e.target.value)}><option value="">-</option>{marks.map((m) => <option key={m}>{m}</option>)}</select>
    </label>;
  };
  return <div className="race-card">
    <label className="race-distance"><span>距離適性</span><input aria-label="距離適性" value={value.distance ?? ''} placeholder="例 1600-2400m" onChange={(e) => update('distance', e.target.value)} /></label>
    <div className="race-abilities">{RACE_ABILITY_FIELDS.map(({ key, label, marks }) => mark(key, label, marks))}</div>
    <div className="race-traits">{RACE_TRAIT_FIELDS.map(({ key, label, marks }) => mark(key, label, marks))}</div>
  </div>;
}

export function HorseAbilitiesEditor({ value, category, onChange }: { value: HorseAbilities; category: HorseCategory; onChange: (value: HorseAbilities) => void }) {
  const group: Group | 'race' | undefined = category === '繁殖牝馬' ? 'broodmare' : category === '種牡馬' ? 'stallion' : category === '現役' ? 'race' : undefined;
  const renderFields = (g: Group) => <div className="sheet-ability-fields">{fields[g].map(({ key, label, type, options }) => {
    const record = (value[g] ?? {}) as Record<string, string | number | undefined>;
    const update = (input: string) => {
      const next = { ...record };
      if (input === '') delete next[key]; else next[key] = type === 'number' ? Number(input) : input;
      onChange({ ...value, [g]: next });
    };
    return <label className="field" key={key}>{label}{options
      ? <select value={record[key] ?? ''} onChange={(e) => update(e.target.value)}><option value="">未確認</option>{options.map((option) => <option key={option}>{option}</option>)}</select>
      : <input type={type ?? 'text'} min={type === 'number' ? 0 : undefined} step={type === 'number' ? 1 : undefined} value={record[key] ?? ''} placeholder="未確認" onChange={(e) => update(e.target.value)} />}</label>;
  })}</div>;
  const raceCard = <RaceCard value={value.race ?? {}} onChange={(race) => onChange({ ...value, race })} />;
  const hasRace = Object.values(value.race ?? {}).some((v) => v !== undefined && v !== '');
  return <section className="sheet-section sheet-abilities">
    <div className="sheet-section-heading"><h3>能力・適性</h3><span className="small muted">{category}</span></div>
    {group === 'race' ? raceCard : group ? renderFields(group) : null}
    {group === 'race' && <p className="sheet-ability-hint">「-」は未判明</p>}
    {group !== 'race' && hasRace && <details className="sheet-past-abilities"><summary>現役時の記録</summary>{raceCard}</details>}
  </section>;
}
