import { useMemo, useState } from 'react';
import type { Judgement, AncestorInfo } from '../core/types';
import { gen, nodePath, nameOfKey, sideOf } from '../core/pedigree';
import { useApp } from './app-context';

const COLORS = ['#d97706', '#059669', '#2563eb', '#dc2626', '#7c3aed', '#db2777', '#0d9488', '#ea580c', '#4f46e5', '#65a30d'];
/** 15大系統の色（タグの枠と文字にだけ使う） */
const SYSTEM_HUES: Record<string, number> = { Ec: 20, Ph: 40, Ns: 60, Ro: 210, Ne: 340, Na: 100, Fa: 130, To: 160, Te: 190, Sw: 250, Ha: 280, Hi: 300, St: 0, Ma: 80, He: 230 };
export function SystemTag({ system, role }: { system: string | null; role: '面白' | '見事' }) {
  const hue = system ? SYSTEM_HUES[system] ?? 0 : 0;
  const style = system ? { borderColor: `hsl(${hue} 45% 45%)`, color: `hsl(${hue} 55% 32%)`, background: `hsl(${hue} 60% 96%)` } : undefined;
  return <span className={'systag ' + (role === '見事' ? 'migoto' : 'omoshiro')} style={style} title={`${role}判定の参照枠${system ? `: ${system}系` : '（系統不明）'}`}>{role === '見事' ? '見' : '面'}{system ?? '?'}</span>;
}

/** クロス効果の短縮表記と色分け（速さ系＝藍、スタミナ系＝緑、パワー＝橙、適性＝茶、成長＝紫、気性＝朱） */
export const EFFECT_CHIP: Record<string, { label: string; cls: string; note: string }> = {
  '短距離': { label: '短', cls: 'fx-speed', note: 'スピード大幅アップ、スタミナダウン' },
  '速力': { label: '速', cls: 'fx-speed', note: 'スピードアップ' },
  'パワー': { label: 'パ', cls: 'fx-power', note: 'パワーアップ' },
  '底力': { label: '底', cls: 'fx-stamina', note: '勝負根性アップ' },
  '長距離': { label: '長', cls: 'fx-stamina', note: 'スタミナアップ' },
  'ダート': { label: 'ダ', cls: 'fx-dirt', note: 'ダート適性アップ' },
  '丈夫さ': { label: '丈', cls: 'fx-body', note: '脚元の強さアップ' },
  '早熟型': { label: '早', cls: 'fx-growth', note: '成長型の早熟化' },
  '晩成型': { label: '晩', cls: 'fx-growth', note: '成長型の晩成化' },
  '堅実さ': { label: '堅', cls: 'fx-steady', note: '気性アップ、勝負根性少しダウン' },
  '気性難': { label: '気', cls: 'fx-temper', note: '気性難' },
};

/** 祖先の大系統の札。血統表の右端に、最後の世代の父側（牡）の祖先ごとに出す。不明なら空の枠 */
export function SystemBadge({ system }: { system: string | null }) {
  return <span className={'sys-badge' + (system ? '' : ' unknown')} title={system ? `${system}系` : '大系統は未登録'}>{system ?? ''}</span>;
}

export function EffectChips({ effects, size }: { effects: string[]; size?: 'sm' }) {
  return (
    <span className={'fx-group' + (size ? ' ' + size : '')}>
      {effects.map((e) => { const c = EFFECT_CHIP[e]; return c ? <span key={e} className={'fx ' + c.cls} title={`${e}: ${c.note}`}>{c.label}</span> : null; })}
    </span>
  );
}

/** 効果ごとの本数つきチップ（クロス効果の集計） */
export function EffectCountChips({ counts, emptyText = '因子なし' }: { counts: Record<string, number>; emptyText?: string }) {
  const keys = Object.keys(EFFECT_CHIP).filter((k) => counts[k]);
  if (!keys.length) return <span className="muted small">{emptyText}</span>;
  return (
    <span className="fx-group">
      {keys.map((k) => { const c = EFFECT_CHIP[k]; return <span key={k} className={'fx ' + c.cls + ' wide'} title={`${k}: ${c.note}`}>{k}{counts[k] > 1 ? <b>×{counts[k]}</b> : ''}</span>; })}
    </span>
  );
}

export function EffectLegend() {
  return (
    <div className="small muted fx-legend">
      因子: {Object.entries(EFFECT_CHIP).map(([k, c]) => <span key={k} title={c.note}><span className={'fx ' + c.cls}>{c.label}</span>{k}（{c.note}） </span>)}
    </div>
  );
}

/** 産駒の5代血統表。因子チップ、クロス、凝った配合ペアを示し、祖先をタップすると詳細を表示する */
export function Pedigree({ j }: { j: Judgement }) {
  const app = useApp();
  const [selected, setSelected] = useState<number | null>(null);
  const [gens, setGens] = useState<4 | 5>(() => (typeof matchMedia !== 'undefined' && matchMedia('(max-width: 720px)').matches ? 4 : 5));
  const crossColor = new Map<string, string>();
  j.crosses.forEach((c, i) => crossColor.set(c.key, COLORS[i % COLORS.length]));
  const kottaNames = new Set(j.kotta.pairs.flat());
  const occurrences = useMemo(() => {
    const m = new Map<string, number[]>();
    for (let n = 2; n < 64; n++) if (j.nodes[n]) m.set(j.nodes[n], [...(m.get(j.nodes[n]) ?? []), n]);
    return m;
  }, [j]);
  const infoOf = (key: string): AncestorInfo | undefined => { const nm = nameOfKey(key); return nm ? app.ctx.ancestors.get(nm) : app.ctx.userAncestors.get(key); };

  const rows = [];
  const total = 1 << gens;
  for (let r = 0; r < total; r++) {
    const cells = [];
    for (let g = 1; g <= gens; g++) {
      const span = 1 << (gens - g);
      if (r % span !== 0) continue;
      const n = (1 << g) + (r >> (gens - g));
      const key = j.nodes[n];
      const label = key ? (j.labels[key] ?? key.replace(/^n:/, '')) : '（不明）';
      const info = key ? infoOf(key) : undefined;
      const isKotta = key && kottaNames.has(label);
      const color = key ? crossColor.get(key) : undefined;
      const cls = [key ? ((n & 1) ? 'female' : 'male') : 'unknown', color ? 'cross' : '', selected === n ? 'selected' : '', key ? 'tappable' : ''].join(' ');
      cells.push(
        <td key={g} rowSpan={span} className={cls} style={color ? { ['--cross-color' as string]: color } : undefined} title={nodePath(n)}
          onClick={() => key && setSelected(selected === n ? null : n)}>
          <span className={'ped-name' + (isKotta ? ' kotta' : '')}>{label}</span>
          {info && info.effects.length > 0 && <EffectChips effects={info.effects} size="sm" />}
          {j.slotSystems[n] && <SystemTag system={j.slotSystems[n].system} role={j.slotSystems[n].role} />}
          {g <= 2 && <span className="pos">{nodePath(n)}</span>}
        </td>,
      );
      // 最後の世代の父側（牡）の祖先には大系統の札を右に出す（2行分）
      if (g === gens && n % 2 === 0) cells.push(<td key="sys" rowSpan={2} className="ped-sys"><SystemBadge system={info?.system ? app.master.meta.bigSystems[info.system - 1] : null} /></td>);
    }
    rows.push(<tr key={r}>{cells}</tr>);
  }

  const sel = selected != null ? j.nodes[selected] : '';
  const selInfo = sel ? infoOf(sel) : undefined;
  const selCross = sel ? j.crosses.find((c) => c.key === sel) : undefined;
  const selOcc = sel ? occurrences.get(sel) ?? [] : [];
  const selName = sel ? (j.labels[sel] ?? sel.replace(/^n:/, '')) : '';

  return (
    <div>
      <div className="inline-row" style={{ marginBottom: 6 }}>
        <div className="segmented">
          <button className={gens === 4 ? 'primary' : ''} onClick={() => setGens(4)}>4代</button>
          <button className={gens === 5 ? 'primary' : ''} onClick={() => setGens(5)}>5代</button>
        </div>
        {gens === 4 && <span className="small muted">（クロス判定は5代まで。5代目は表示外）</span>}
      </div>
      <div className="scroll">
        <table className={'pedigree gens-' + gens}>
          <thead><tr>{Array.from({ length: gens }, (_, i) => i + 1).map((g) => <th key={g}>{g}代</th>)}<th>系統</th></tr></thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
      {selected != null && sel && (
        <div className="panel ped-detail">
          <div className="row" style={{ alignItems: 'center' }}>
            <b>{selName}</b>
            <span className="tag">{nodePath(selected)}</span>
            {selInfo?.sex && <span className="tag">{selInfo.sex === 'F' ? '牝馬' : '牡馬'}</span>}
            {selInfo?.system && <span className="tag">{app.master.meta.bigSystems[selInfo.system - 1]}系</span>}
            <button className="small" onClick={() => setSelected(null)}>閉じる</button>
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            因子: {selInfo ? (selInfo.effects.length ? <EffectChips effects={selInfo.effects} /> : 'なし') : <span className="muted">不明（祖先マスター未登録）</span>}
          </div>
          <div className="small">
            出現位置: {selOcc.map((n) => `${nodePath(n)}（${gen(n)}代・${sideOf(n) === 2 ? '父側' : '母側'}）`).join('、')}
          </div>
          {selCross ? (
            <div className="small">クロス: {selCross.sireGens.join('・')}×{selCross.damGens.join('・')}
              {selCross.effects.length ? <> → {selCross.effects.join('・')} に効果の可能性</> : ''}</div>
          ) : selOcc.length > 1 ? <div className="small muted">同じ側に複数回現れていますが、父側と母側にまたがらないためクロスにはなりません</div> : null}
          {kottaNames.has(selName) && <div className="small">凝った配合のペア対象です</div>}
          {j.slotSystems[selected] && <div className="small">{j.slotSystems[selected].side}側の{j.slotSystems[selected].role}判定の参照枠（{j.slotSystems[selected].system ?? '系統不明'}）</div>}
        </div>
      )}
      {j.crosses.length > 0 && (
        <div className="inline-row small" style={{ marginTop: 6 }}>
          <span className="muted">共通祖先:</span>
          {j.crosses.map((c) => <span key={c.key} className="tag" style={{ borderLeft: `4px solid ${crossColor.get(c.key)}` }}>{c.name} {[...c.sireGens, ...c.damGens].join('×')}</span>)}
        </div>
      )}
    </div>
  );
}
