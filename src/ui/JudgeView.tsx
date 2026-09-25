import { useState } from 'react';
import type { Judgement, TheoryResult } from '../core/types';
import { RULE_LEDGER } from '../core/rules';
import { EffectChips, EffectCountChips } from './Pedigree';

export const Badge = ({ v, text }: { v: string; text?: string }) => <span className={'badge ' + v}>{text ?? v}</span>;

/** 理論の成立条件を表示するポップオーバー。 */
export function RuleHelp({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const rule = RULE_LEDGER.find((x) => x.id === id);
  if (!rule) return null;
  return (
    <span className="help-wrap">
      <button type="button" className="help-icon" aria-label={`${rule.title}の成立条件`} title={`${rule.title}の条件を表示`} onClick={() => setOpen(!open)}>
        条件
      </button>
      {open && (
        <span className="popover" onMouseLeave={() => setOpen(false)}>
          <b>{rule.title}</b> <span className="tag">{rule.status}</span>
          <div style={{ marginTop: 6, lineHeight: 1.4 }}>{rule.condition}</div>
          {rule.note && <div className="small muted" style={{ marginTop: 4 }}>{rule.note}</div>}
          <div className="small muted" style={{ marginTop: 6, borderTop: '1px solid var(--rule)', paddingTop: 4 }}>出典: {rule.source}</div>
        </span>
      )}
    </span>
  );
}

function Card({ id, title, r, extra }: { id: string; title: string; r: TheoryResult; extra?: React.ReactNode }) {
  return (
    <div className={'card' + (r.verdict === '成立' ? ' ok-card' : '')}>
      <h3>
        <span>{title}{r.estimated && <span className="tag warn" title="前作由来の規則からの推定">推定</span>}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <RuleHelp id={id} />
          <Badge v={r.verdict} />
        </span>
      </h3>
      <ul className="small">
        {r.reasons.map((x, i) => <li key={i}>{x}</li>)}
        {r.missing.map((x, i) => <li key={'m' + i} className="muted">不足: {x}</li>)}
      </ul>
      {extra}
    </div>
  );
}

function theoryCards(j: Judgement): { id: string; title: string; label: string; r: TheoryResult; extra?: React.ReactNode }[] {
  return [
    { id: 'perfectKotta', title: '完璧／凝った配合', label: '完璧／凝った', r: j.perfectKotta },
    { id: 'perfect', title: '完璧な配合', label: '完璧', r: j.perfect },
    { id: 'omoshiro', title: '面白い配合', label: '面白', r: j.omoshiro, extra: <div className="small">系統: {j.omoshiro.systems.join(' ')}</div> },
    { id: 'migoto', title: '見事な配合', label: '見事', r: j.migoto },
    { id: 'kotta', title: '凝った配合', label: '凝った', r: j.kotta },
    { id: 'nicks', title: 'ニックス', label: j.nicks.level > 0 ? `ニックス${j.nicks.level}` : 'ニックス', r: j.nicks, extra: j.nicks.level > 0 ? <div className="small">段階 {j.nicks.level}</div> : undefined },
    { id: 'dangerous', title: '危険な配合', label: '危険', r: j.dangerous },
    { id: 'outbreed', title: 'アウトブリード', label: 'アウトブリード', r: j.outbreed },
  ];
}

/** 先頭に置く結論: 因子・ニトロ、成立配合、クロス、種付料 */
export function SummaryStrip({ j, showCost = true }: { j: Judgement; showCost?: boolean }) {
  const danger = j.dangerous.verdict === '成立';
  const counts = j.crosses.reduce<Record<string, number>>((m, c) => { for (const e of c.effects) m[e] = (m[e] ?? 0) + 1; return m; }, {});
  const unknownEffects = j.crosses.filter((c) => !c.effectsKnown).length;
  const n = j.nitroReference;
  const lead = danger ? '危険な配合' : j.perfectKotta.verdict === '成立' ? '完璧／凝った配合' : j.perfect.verdict === '成立' ? '完璧な配合' : j.omoshiro.verdict === '成立' && j.migoto.verdict === '成立' ? '面白い配合・見事な配合' : j.omoshiro.verdict === '成立' ? '面白い配合' : j.migoto.verdict === '成立' ? '見事な配合' : j.kotta.verdict === '成立' ? '凝った配合' : j.nicks.level > 0 ? `ニックス${j.nicks.level}` : j.outbreed.verdict === '成立' ? 'アウトブリード' : '特殊配合なし';

  const highlights = theoryCards(j).filter((t) => t.r.verdict === '成立' || t.r.verdict === '未確定');

  return (
    <div className={'summary-strip' + (danger ? ' danger' : '')}>
      <div className="result-line">
        <span className="lead">{lead}</span>
        {highlights.length > 0 && (
          <span className="indicators">
            {highlights.map((h) => (
              <span key={h.id} className={'ind ' + (h.r.verdict === '未確定' ? 'unk' : h.id === 'dangerous' ? 'danger' : 'ok')} title={`${h.title}: ${h.r.verdict}${h.r.estimated ? '（推定）' : ''}`}>
                {h.label}{h.r.verdict === '未確定' || h.r.estimated ? '?' : ''}
              </span>
            ))}
          </span>
        )}
        {showCost && <span className="cost-tag">種付料 <b>{j.costUnknown ? '未確認' : j.cost.toLocaleString()}</b>{!j.costUnknown && '万円'}</span>}
      </div>
      <div className="result-line">
        <span className="label">クロス</span>
        <span className="tag count">{j.crosses.length}本</span>
        {j.crosses.slice(0, 4).map((c) => <span key={c.key} className="tag">{c.name} {[...c.sireGens, ...c.damGens].join('×')}</span>)}
        {j.crosses.length > 4 && <span className="tag">他{j.crosses.length - 4}</span>}
        {j.hasUnknownSlots && <span className="badge 未確定">血統に不明欄</span>}
        {j.constraints.map((c) => <span key={c} className="tag warn">{c}</span>)}
        <span className="label" style={{ marginLeft: 12 }}>因子効果</span>
        <EffectCountChips counts={counts} emptyText={j.crosses.length ? '効果なし' : 'なし'} />
        {unknownEffects > 0 && <span className="small muted" title="祖先マスターに載っていない共通祖先">（効果不明 {unknownEffects}）</span>}
      </div>
      <div className="result-line">
        <span className="label">ニトロ参考値</span>
        <span className="nitro">
          <span>速 <b>{n.speed}</b></span>
          <span>短 <b>{n.stamina}</b></span>
          <span>力 <b>{n.power}</b></span>
        </span>
      </div>
    </div>
  );
}

export function JudgeView({ j, showSummary = true, section = 'all' }: { j: Judgement; showSummary?: boolean; section?: 'all' | 'theories' | 'crosses' }) {
  const [showNg, setShowNg] = useState(false);
  const theories = theoryCards(j);
  const shown = theories.filter((t) => t.r.verdict !== '不成立');
  const hidden = theories.filter((t) => t.r.verdict === '不成立');
  return (
    <div>
      {showSummary && <SummaryStrip j={j} />}
      {section === 'theories' && !shown.length && !showNg && <p className="empty small">成立した配合理論はありません。</p>}
      <div className="cards">
        {section !== 'crosses' && shown.map((t) => <Card key={t.id} id={t.id} title={t.title} r={t.r} extra={t.extra} />)}
        {section !== 'crosses' && (showNg ? hidden : []).map((t) => <Card key={t.id} id={t.id} title={t.title} r={t.r} extra={t.extra} />)}
        {section !== 'theories' && <><div className="card">
          <h3>
            <span>父似・母似</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <RuleHelp id="inheritance" />
            </span>
          </h3>
          {j.inheritance.mode === 'temperament' && <div className="small">クロスがあるため、父似なら父、母似なら母の気性を継ぐ</div>}
          {j.inheritance.mode === 'unknown' && <div className="small muted">血統に不明欄があり判断できません</div>}
          {j.inheritance.mode === 'outbreedEffect' && (
            <div className="small">
              アウトブリードのため、似た側の4代内から因子効果が1つ発動
              <div>父似なら: {j.inheritance.sireEffects.length ? <EffectChips effects={j.inheritance.sireEffects} /> : 'なし'}</div>
              <div>母似なら: {j.inheritance.damEffects.length ? <EffectChips effects={j.inheritance.damEffects} /> : 'なし'}</div>
            </div>
          )}
        </div>
        <div className="card">
          <h3>
            <span>クロス</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <RuleHelp id="cross" />
              <Badge v={j.crossStatus.verdict} text={`${j.crosses.length}本`} />
            </span>
          </h3>
          {j.crosses.length === 0 && <div className="small muted">クロスなし</div>}
          <ul className="small">
            {j.crosses.map((c) => (
              <li key={c.key}>
                {c.name} {c.sireGens.join('・')}×{c.damGens.join('・')}
                {c.sex === 'F' && <span className="tag">牝馬</span>}
                {c.effectsKnown ? (c.effects.length ? <EffectChips effects={c.effects} /> : <span className="tag">因子なし</span>) : <span className="tag muted" title="祖先マスターに載っていないため因子が不明">効果不明</span>}
              </li>
            ))}
          </ul>
          {j.mareCrossCount > 0 && <div className="small">牝馬クロス {j.mareCrossCount}本<RuleHelp id="mareCross" /></div>}
          {j.crossStatus.reasons.map((x, i) => <div key={i} className="small muted">{x}</div>)}
        </div></>}
      </div>
      {section !== 'crosses' && hidden.length > 0 && (
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <button type="button" className="text-toggle" onClick={() => setShowNg(!showNg)}>
            {showNg ? '▲ 不成立の理論を閉じる' : `▼ 不成立の理論を表示（${hidden.length}件）`}
          </button>
        </div>
      )}
    </div>
  );
}
