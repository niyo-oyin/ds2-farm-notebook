import { useId, useState } from 'react';
import type { FarmSettings as FarmPreferences, HorseNameAffix } from '../../store/model';
import { store } from '../../store/userdata';
import { useApp } from '../app-context';
import { SettingRow, SettingSwitch } from './SettingRow';

const EMPTY_AFFIX: HorseNameAffix = { text: '', position: 'prefix' };

export function FarmSettings() {
  const { data: { settings } } = useApp();
  const farm = settings.farm ?? {};
  const common = farm.commonAffix ?? EMPTY_AFFIX;
  const update = (patch: Partial<FarmPreferences>) => store.setSettings({ farm: { ...farm, ...patch } });
  const separate = (separateBySex: boolean) => update(separateBySex ? {
    separateBySex, maleAffix: farm.maleAffix ?? common, femaleAffix: farm.femaleAffix ?? common,
  } : { separateBySex });
  return <div className="farm-settings">
    <section className="settings-section">
      <SettingRow label="牧場名">{id => <input id={id} type="text" value={farm.name ?? ''} placeholder="牧場名を入力" onChange={e => update({ name: e.target.value })} />}</SettingRow>
    </section>
    <section className="settings-section">
      <div className="settings-section-heading"><h4>冠名</h4></div>
      <SettingSwitch label="牡馬と牝馬で別々に設定" checked={!!farm.separateBySex} onChange={separate} />
      <div className="farm-affixes">
        {farm.separateBySex ? <>
          <AffixEditor key="male" label="牡馬" value={farm.maleAffix ?? common} onChange={maleAffix => update({ maleAffix })} />
          <AffixEditor key="female" label="牝馬" value={farm.femaleAffix ?? common} onChange={femaleAffix => update({ femaleAffix })} />
        </> : <AffixEditor key="common" label="牡牝共通" value={common} onChange={commonAffix => update({ commonAffix })} />}
      </div>
    </section>
  </div>;
}

function AffixEditor({ label, value, onChange }: { label: string; value: HorseNameAffix; onChange: (value: HorseNameAffix) => void }) {
  const id = useId();
  const [text, setText] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const saveText = () => {
    const normalized = (text ?? value.text).trim().normalize('NFKC').replace(/[ぁ-ゖ]/g, character => String.fromCharCode(character.charCodeAt(0) + 0x60));
    if (!/^[ァ-ヺー]*$/u.test(normalized)) {
      setInvalid(true);
      return;
    }
    setText(null);
    setInvalid(false);
    if (normalized !== value.text) onChange({ ...value, text: normalized });
  };
  const affix = value.text.trim();
  return <fieldset className="farm-affix">
    <legend>{label}</legend>
    <div className="farm-affix-fields">
      <label className="field" htmlFor={`${id}-text`}>冠名
        <input id={`${id}-text`} type="text" value={text ?? value.text} placeholder="未設定" aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined} onChange={e => { setText(e.target.value); setInvalid(false); }} onBlur={saveText} />
        {invalid && <span id={`${id}-error`} className="farm-affix-error" role="alert">カタカナと「ー」のみ使用できます。変更は保存されていません。</span>}
      </label>
      <label className="field" htmlFor={`${id}-position`}>付ける位置<select id={`${id}-position`} value={value.position} onChange={e => onChange({ ...value, position: e.target.value as HorseNameAffix['position'] })}><option value="prefix">馬名の前</option><option value="suffix">馬名の後ろ</option></select></label>
    </div>
    <p className="farm-name-preview"><span>馬名の例</span><span>{value.position === 'prefix' && <b>{affix}</b>}キセキ{value.position === 'suffix' && <b>{affix}</b>}</span></p>
  </fieldset>;
}
