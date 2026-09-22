import { useMemo, useState } from 'react';
import { PAIR_SOURCES, pairKey, type KottaEdit, type NicksEdit, type PairSource } from '../core/master-edits';
import { baseMaster } from '../data/base-master';
import { store } from '../store/userdata';
import { requestCapture } from '../store/jobs';
import { useApp } from './app-context';
import { nameSearch } from './name-search';
import { DataMaintenanceFilters } from './DataMaintenanceFilters';
import { matchesMaintenance } from './data-maintenance';
import './MasterHorsesPage.css';


// ---------------------------------------------------------------- 凝ったペア表

interface KottaRow { sire: string; dam: string; inBase: boolean; edit?: KottaEdit }
type KottaTarget = { row: KottaRow } | { sire: string } | 'new';

/**
 * 凝ったペア表（父側の馬 × 母側の馬）。父側の馬ごとの行に母側の馬をチップで並べる（向きは区別する。逆向きの組は別の行）。
 * マスターの組に確認・無効化を重ね、実機で確認した組を追加する
 */
export function KottaPairsPage() {
  const app = useApp();
  const [q, setQ] = useState('');
  const [pedigree, setPedigree] = useState('');
  const [maintenance, setMaintenance] = useState<string[]>([]);
  const [target, setTarget] = useState<KottaTarget | null>(null);
  const [message, setMessage] = useState('');
  const editsByKey = useMemo(() => new Map(app.data.kottaEdits.map((e) => [pairKey(e.sire, e.dam), e])), [app.data.kottaEdits]);
  // 収録馬の血統表に現れる名前。ここに両方ある組だけがマスターの馬同士の配合で効く
  const pedigreeNames = useMemo(() => {
    const s = new Set<string>();
    for (const h of [...app.master.stallions, ...app.master.broodmares]) { s.add(h.name); for (const n of h.ancestors) if (n) s.add(n); }
    return s;
  }, [app.master]);
  const rows = useMemo((): KottaRow[] => {
    const base = baseMaster.kotta.map(([sire, dam]): KottaRow => ({ sire, dam, inBase: true, edit: editsByKey.get(pairKey(sire, dam)) }));
    const known = new Set(base.map((r) => pairKey(r.sire, r.dam)));
    const added = app.data.kottaEdits.filter((e) => !known.has(pairKey(e.sire, e.dam))).map((e): KottaRow => ({ sire: e.sire, dam: e.dam, inBase: false, edit: e }));
    return [...base, ...added];
  }, [editsByKey, app.data.kottaEdits]);
  const inPedigree = (r: KottaRow) => pedigreeNames.has(r.sire) && pedigreeNames.has(r.dam);
  const passes = (r: KottaRow) => {
    if (pedigree && inPedigree(r) !== (pedigree === 'included')) return false;
    return matchesMaintenance(maintenance, [!r.inBase && 'added', r.inBase && !!r.edit && r.edit.active !== false && 'confirmed', r.edit?.active === false && 'disabled']);
  };
  // 父側の馬ごとにまとめる。検索語は父側に当たれば行ごと、母側に当たればそのチップだけを残す
  const search = nameSearch(q);
  const groups = useMemo(() => {
    const m = new Map<string, KottaRow[]>();
    for (const r of rows) { if (!m.has(r.sire)) m.set(r.sire, []); m.get(r.sire)!.push(r); }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b, 'ja')).map(([sire, list]) => ({ sire, rows: list.sort((a, b) => a.dam.localeCompare(b.dam, 'ja')) }));
  }, [rows]);
  const visible = search.filter(groups.map((g) => ({ ...g, rows: search.filter(g.rows.filter(passes), (r) => [g.sire, r.dam]) })).filter((g) => g.rows.length), (g) => [g.sire, ...g.rows.map((r) => r.dam)]);
  const shown = visible.reduce((n, g) => n + g.rows.length, 0);
  const isTarget = (r: KottaRow) => !!target && typeof target === 'object' && 'row' in target && target.row.sire === r.sire && target.row.dam === r.dam;
  const chipClass = (r: KottaRow) => r.edit?.active === false ? 'disabled' : !r.inBase ? 'added' : r.edit ? 'confirmed' : 'base';
  const done = (m: string) => { setTarget(null); setMessage(m); };
  return <div className="master-page pairs-page">
    {message && <div className="horse-feedback" role="status">{message}</div>}
    <div className="pairs-tools">
      <input aria-label="凝ったペアを検索" placeholder="馬名で検索（父側でも母側でも）" value={q} onChange={(e) => setQ(e.target.value)} />
      <select aria-label="血統への登場で絞り込み" value={pedigree} onChange={(e) => setPedigree(e.target.value)}><option value="">血統への登場：すべて</option><option value="included">両方が収録馬の血統に含まれる</option><option value="missing">収録馬の血統に含まれない馬がある</option></select>
      <span className="small muted" role="status">{shown}組</span>
      <button type="button" className="primary" onClick={() => { setTarget('new'); setMessage(''); }}>＋ 組を追加</button>
    </div>
    <DataMaintenanceFilters options={[['added', '追加した組'], ['confirmed', '確認済み'], ['disabled', '無効']]} selected={maintenance} onChange={setMaintenance} />
    {target && <KottaSheet key={target === 'new' ? 'new' : 'row' in target ? pairKey(target.row.sire, target.row.dam) + (target.row.edit?.updatedAt ?? '') : `sire:${target.sire}`}
      row={typeof target === 'object' && 'row' in target ? target.row : null} initialSire={typeof target === 'object' && 'sire' in target ? target.sire : ''}
      onDone={done} onCancel={() => setTarget(null)} />}
    {visible.length === 0 && <p className="small muted">該当する組がありません。</p>}
    <div className="pairs-groups">{visible.map((g) => <section key={g.sire} className="panel pairs-group">
      <h3>父側 {g.sire}<span className="small muted">{g.rows.length}組</span></h3>
      <div className="pairs-chips">
        {g.rows.map((r) => <button key={r.dam} type="button" className={['pairs-chip', chipClass(r), inPedigree(r) ? '' : 'faint', isTarget(r) ? 'selected' : ''].filter(Boolean).join(' ')} title={`${r.inBase ? (r.edit ? (r.edit.active === false ? 'マスター（無効化）' : `マスター（${r.edit.source}で確認）`) : 'マスター') : r.edit?.source}${r.edit?.note ? ` · ${r.edit.note}` : ''}${inPedigree(r) ? '' : ' · 収録馬の血統表には現れない'}`} onClick={() => { setTarget({ row: r }); setMessage(''); }}>
          <span className="pairs-chip-name">{r.dam}</span>
        </button>)}
        <button type="button" className="pairs-chip add" aria-label={`父側 ${g.sire} に組を追加`} onClick={() => { setTarget({ sire: g.sire }); setMessage(''); }}>＋</button>
      </div>
    </section>)}</div>
    <p className="small muted">チップ: 追加＝青、実機で確認＝緑枠、無効化＝取り消し線。薄い文字は収録馬の血統表に現れない組。チップを押すと確認・無効化・取り消し、＋でその父側の馬に組を追加。向きは区別し、逆向きの組は別の行に出る（判定は設定で対称に扱う）。</p>
  </div>;
}

function KottaSheet({ row, initialSire, onDone, onCancel }: { row: KottaRow | null; initialSire: string; onDone: (message: string) => void; onCancel: () => void }) {
  const app = useApp();
  const names = useMemo(() => {
    const s = new Set<string>(app.master.ancestors.map((a) => a.name));
    for (const h of [...app.master.stallions, ...app.master.broodmares]) { s.add(h.name); for (const n of h.ancestors) if (n) s.add(n); }
    return [...s].sort((a, b) => a.localeCompare(b, 'ja'));
  }, [app.master]);
  const [sire, setSire] = useState(row?.sire ?? initialSire);
  const [dam, setDam] = useState(row?.dam ?? '');
  const [active, setActive] = useState(row?.edit?.active ?? true);
  const [source, setSource] = useState<PairSource>(row?.edit?.source ?? '実機確認');
  const [note, setNote] = useState(row?.edit?.note ?? '');
  const [error, setError] = useState('');
  const save = () => {
    const s = sire.trim(), d = dam.trim();
    if (!s || !d) { setError('父側と母側の名前を入力してください'); return; }
    if (s === d) { setError('同じ馬同士は登録できません'); return; }
    if (!row && app.master.kotta.some(([a, b]) => a === s && b === d)) { setError('同じ組が登録済みです'); return; }
    store.saveKottaEdit({ sire: s, dam: d, active: row?.inBase ? active : true, source, note: note.trim() });
    onDone(row ? '保存しました' : '組を追加しました');
  };
  const revert = () => {
    if (!row?.edit || !confirm(row.inBase ? 'この組の確認・無効化を取り消して元の状態に戻しますか？' : 'この組を削除しますか？')) return;
    store.deleteKottaEdit(row.sire, row.dam); onDone('取り消しました');
  };
  const unknown = [sire, dam].filter((n) => n.trim() && !names.includes(n.trim()));
  return <form className="panel pairs-sheet" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
    <div className="pairs-sheet-head">
      <div><span className="small muted">{row ? (row.inBase ? (row.edit ? (row.edit.active === false ? 'マスター（無効化）' : `マスター（${row.edit.source}で確認）`) : 'マスター') : `追加した組 · ${row.edit?.source}`) : '新しい組'}</span><h3>{row ? `${row.sire} × ${row.dam}` : `${sire.trim() || '？'} × ${dam.trim() || '？'}`}</h3></div>
      <div className="master-sheet-actions">
        {row?.edit && <button type="button" className="danger" onClick={revert}>{row.inBase ? '取り消す' : 'この組を削除'}</button>}
        <button type="button" onClick={onCancel}>{row ? '閉じる' : 'キャンセル'}</button>
        <button type="submit" className="primary">{row ? '保存' : '追加'}</button>
      </div>
    </div>
    <div className="master-fields pairs-fields">
      <label className="field">父側の馬<input list="kotta-names" value={sire} disabled={!!row} onChange={(e) => setSire(e.target.value)} /></label>
      <label className="field">母側の馬<input list="kotta-names" value={dam} disabled={!!row} onChange={(e) => setDam(e.target.value)} /></label>
      <label className="field">出典<select value={source} onChange={(e) => setSource(e.target.value as PairSource)}>{PAIR_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
      {row?.inBase ? <label className="master-hidden"><input type="checkbox" checked={!active} onChange={(e) => setActive(!e.target.checked)} />この組を無効にする（判定に使わない）</label> : <span />}
      <label className="field pairs-note">備考<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例: 種付け画面で凝った配合を確認（父名×母名）。他に該当する組なし" /></label>
    </div>
    {!row && <datalist id="kotta-names">{names.map((n) => <option key={n} value={n} />)}</datalist>}
    {unknown.length > 0 && <p className="small muted">{unknown.join('、')} は祖先マスターにも血統表にもない名前です。表記を確かめてください。</p>}
    <p className="small muted">父側4代以内と母側4代以内にこの2頭がいると凝った配合。種付け画面のアイコンは父×母の成立しか示さず、どの祖先の組が原因かは分からないので、実機確認はその配合で他に該当する組がない時だけ記録する。</p>
    <div role={error ? 'alert' : 'status'} className={error ? 'sheet-error' : 'sheet-save-status'}>{error}</div>
  </form>;
}

// ---------------------------------------------------------------- ニックス相性表

interface NicksRow { sire: string; dam: string; level: number; inBase: boolean; edit?: NicksEdit }
const stars = (level: number) => (level > 0 ? '★'.repeat(level) : '0');
type NicksTarget = { row: NicksRow } | { sire: string } | 'new';

/**
 * ニックス相性表。父の小系統ごとに、相性のある母の小系統を★付きのチップで並べる（向きが構造に含まれるので逆向きの空欄が出ない）。
 * マスターの行に訂正を重ね、種付け画面の★で確認した組を追加する。段階0は「ニックスなしを確認した」記録
 */
export function NicksPage() {
  const app = useApp();
  const [q, setQ] = useState('');
  const [target, setTarget] = useState<NicksTarget | null>(null);
  const [level, setLevel] = useState('');
  const [maintenance, setMaintenance] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const editsByKey = useMemo(() => new Map(app.data.nicksEdits.map((e) => [pairKey(e.sire, e.dam), e])), [app.data.nicksEdits]);
  const baseLevel = (r: NicksRow) => baseMaster.nicks.find((n) => n.sire === r.sire && n.dam === r.dam)?.level;
  const rows = useMemo((): NicksRow[] => {
    const base = baseMaster.nicks.map((n): NicksRow => { const edit = editsByKey.get(pairKey(n.sire, n.dam)); return { sire: n.sire, dam: n.dam, level: edit?.level ?? n.level, inBase: true, edit }; });
    const known = new Set(base.map((r) => pairKey(r.sire, r.dam)));
    const added = app.data.nicksEdits.filter((e) => !known.has(pairKey(e.sire, e.dam))).map((e): NicksRow => ({ sire: e.sire, dam: e.dam, level: e.level, inBase: false, edit: e }));
    return [...base, ...added];
  }, [editsByKey, app.data.nicksEdits]);
  // 父小系統ごとにまとめる。検索語は父に当たれば行ごと、母に当たればそのチップだけを残す
  const search = nameSearch(q);
  const groups = useMemo(() => {
    const m = new Map<string, NicksRow[]>();
    for (const r of rows) { if (!m.has(r.sire)) m.set(r.sire, []); m.get(r.sire)!.push(r); }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b, 'ja')).map(([sire, list]) => ({ sire, rows: list.sort((a, b) => b.level - a.level || a.dam.localeCompare(b.dam, 'ja')) }));
  }, [rows]);
  const passes = (r: NicksRow) => (!level || (level === '0' ? r.level === 0 : r.level >= Number(level)))
    && matchesMaintenance(maintenance, [!r.inBase && 'added', r.inBase && !!r.edit && r.level !== baseLevel(r) && 'edited', r.inBase && !!r.edit && r.level === baseLevel(r) && 'confirmed']);
  const visible = search.filter(groups.map((g) => ({ ...g, rows: search.filter(g.rows.filter(passes), (r) => [g.sire, r.dam]) })).filter((g) => g.rows.length), (g) => [g.sire, ...g.rows.map((r) => r.dam)]);
  const shown = visible.reduce((n, g) => n + g.rows.length, 0);
  const isTarget = (r: NicksRow) => !!target && typeof target === 'object' && 'row' in target && target.row.sire === r.sire && target.row.dam === r.dam;
  const done = (m: string) => { setTarget(null); setMessage(m); };
  return <div className="master-page pairs-page">
    {message && <div className="horse-feedback" role="status">{message}</div>}
    <div className="pairs-tools">
      <input aria-label="ニックスを検索" placeholder="小系統で検索（父でも母でも）" value={q} onChange={(e) => setQ(e.target.value)} />
      <select aria-label="ニックスの段階で絞り込み" value={level} onChange={(e) => setLevel(e.target.value)}><option value="">段階：すべて</option><option value="1">★以上</option><option value="2">★★以上</option><option value="3">★★★</option><option value="0">なし（0）</option></select>
      <span className="small muted" role="status">{shown}組</span>
      <div className="pairs-actions">
        <button type="button" onClick={() => requestCapture(['種付け'])}>種付け画面から登録</button>
        <button type="button" className="primary" onClick={() => { setTarget('new'); setMessage(''); }}>＋ 組を追加</button>
      </div>
    </div>
    <DataMaintenanceFilters options={[['added', '追加した組'], ['edited', '訂正あり'], ['confirmed', '確認済み']]} selected={maintenance} onChange={setMaintenance} />
    {target && <NicksSheet key={target === 'new' ? 'new' : 'row' in target ? pairKey(target.row.sire, target.row.dam) + (target.row.edit?.updatedAt ?? '') : `sire:${target.sire}`}
      row={typeof target === 'object' && 'row' in target ? target.row : null} initialSire={typeof target === 'object' && 'sire' in target ? target.sire : ''}
      onDone={done} onCancel={() => setTarget(null)} />}
    {visible.length === 0 && <p className="small muted">該当する組がありません。</p>}
    <div className="pairs-groups">{visible.map((g) => <section key={g.sire} className="panel pairs-group">
      <h3>父 {g.sire}系<span className="small muted">{g.rows.length}組</span></h3>
      <div className="pairs-chips">
        {g.rows.map((r) => <button key={r.dam} type="button" className={['pairs-chip', !r.inBase ? 'added' : r.edit ? (r.edit.level === baseLevel(r) ? 'confirmed' : 'edited') : 'base', r.level === 0 ? 'zero' : '', isTarget(r) ? 'selected' : ''].filter(Boolean).join(' ')} title={`${r.inBase ? (r.edit ? (r.edit.level === baseLevel(r) ? `マスター（${r.edit.source}で確認）` : `マスター（訂正 ${r.edit.source}）`) : 'マスター') : r.edit?.source}${r.edit?.note ? ` · ${r.edit.note}` : ''}`} onClick={() => { setTarget({ row: r }); setMessage(''); }}>
          <span className="pairs-chip-name">{r.dam}</span><span className="pairs-chip-level">{stars(r.level)}</span>
        </button>)}
        <button type="button" className="pairs-chip add" aria-label={`父 ${g.sire}系 に組を追加`} onClick={() => { setTarget({ sire: g.sire }); setMessage(''); }}>＋</button>
      </div>
    </section>)}</div>
    <p className="small muted">チップ: 追加＝青、訂正あり＝桃、同じ段階を実機で確認＝緑枠。0 はニックスなしを確認した組で、表にない（未確認）と区別する。チップを押すと訂正・取り消し、＋でその父系に組を追加。「種付け画面から登録」は、繁殖牝馬を選んで種付け画面を送ると、種牡馬ごとの★を父小系統の組として記録する。</p>
  </div>;
}

function NicksSheet({ row, initialSire, onDone, onCancel }: { row: NicksRow | null; initialSire: string; onDone: (message: string) => void; onCancel: () => void }) {
  const app = useApp();
  const systems = useMemo(() => {
    const s = new Set<string>();
    for (const h of [...app.master.stallions, ...app.master.broodmares]) if (h.smallSystem) s.add(h.smallSystem);
    for (const n of app.master.nicks) { s.add(n.sire); s.add(n.dam); }
    return [...s].sort((a, b) => a.localeCompare(b, 'ja'));
  }, [app.master]);
  const base = row?.inBase ? baseMaster.nicks.find((n) => n.sire === row.sire && n.dam === row.dam)?.level : undefined;
  const [sire, setSire] = useState(row?.sire ?? initialSire);
  const [dam, setDam] = useState(row?.dam ?? '');
  const [level, setLevel] = useState<number>(row?.level ?? 1);
  const [source, setSource] = useState<PairSource>(row?.edit?.source ?? '実機確認');
  const [note, setNote] = useState(row?.edit?.note ?? '');
  const [error, setError] = useState('');
  const save = () => {
    const s = sire.trim(), d = dam.trim();
    if (!s || !d) { setError('父側と母側の小系統を入力してください'); return; }
    if (!row && app.master.nicks.some((n) => n.sire === s && n.dam === d)) { setError('同じ組が登録済みです'); return; }
    store.saveNicksEdit({ sire: s, dam: d, level, source, note: note.trim() });
    onDone(`${s} × ${d} を段階${level}で保存しました`);
  };
  const revert = () => {
    if (!row?.edit || !confirm(row.inBase ? 'この組の訂正を取り消して元の段階に戻しますか？' : 'この組を削除しますか？')) return;
    store.deleteNicksEdit(row.sire, row.dam); onDone('取り消しました');
  };
  const unknown = [sire, dam].filter((n) => n.trim() && !systems.includes(n.trim()));
  return <form className="panel pairs-sheet" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
    <div className="pairs-sheet-head">
      <div><span className="small muted">{row ? (row.inBase ? (row.edit ? `マスター（訂正あり · 元の段階 ${base}）` : 'マスター') : `追加した組 · ${row.edit?.source}`) : '新しい組'}</span><h3>{row ? `父 ${row.sire}系 × 母 ${row.dam}系` : `父 ${sire.trim() || '？'}系 × 母 ${dam.trim() || '？'}系`}</h3></div>
      <div className="master-sheet-actions">
        {row?.edit && <button type="button" className="danger" onClick={revert}>{row.inBase ? '訂正を取り消す' : 'この組を削除'}</button>}
        <button type="button" onClick={onCancel}>{row ? '閉じる' : 'キャンセル'}</button>
        <button type="submit" className="primary">{row ? '保存' : '追加'}</button>
      </div>
    </div>
    <div className="master-fields pairs-fields">
      <label className="field">父の小系統<input list="nicks-systems" value={sire} disabled={!!row} onChange={(e) => setSire(e.target.value)} /></label>
      <label className="field">母の小系統<input list="nicks-systems" value={dam} disabled={!!row} onChange={(e) => setDam(e.target.value)} /></label>
      <div className="field"><span>段階</span><div className="segmented nicks-levels" role="radiogroup" aria-label="段階">{[0, 1, 2, 3].map((l) => <button key={l} type="button" role="radio" aria-checked={level === l} className={level === l ? 'primary' : ''} onClick={() => setLevel(l)}>{l === 0 ? '0（なし）' : '★'.repeat(l)}</button>)}</div></div>
      <label className="field">出典<select value={source} onChange={(e) => setSource(e.target.value as PairSource)}>{PAIR_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
      <label className="field pairs-note">備考<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例: 種付け画面で ★★ を確認（父名×母名）" /></label>
    </div>
    {!row && <datalist id="nicks-systems">{systems.map((n) => <option key={n} value={n} />)}</datalist>}
    {unknown.length > 0 && <p className="small muted">{unknown.join('、')} は収録馬の小系統にない名前です。表記を確かめてください。</p>}
    <div role={error ? 'alert' : 'status'} className={error ? 'sheet-error' : 'sheet-save-status'}>{error}</div>
  </form>;
}
