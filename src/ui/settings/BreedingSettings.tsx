import { DEFAULT_RULES, type RuleOptions } from '../../core/rules';
import { store } from '../../store/userdata';
import { useApp } from '../app-context';
import { SettingRow, SettingSwitch } from './SettingRow';

export function BreedingSettings() {
  const { rules, data } = useApp();
  const settings = data.settings;
  const setRule = <K extends keyof RuleOptions>(key: K, value: RuleOptions[K]) => store.setSettings({ rules: { ...settings.rules, [key]: value } });
  const changed = (key: keyof RuleOptions) => rules[key] !== DEFAULT_RULES[key];
  const hasChanges = (Object.keys(DEFAULT_RULES) as (keyof RuleOptions)[]).some(changed);
  return <>
    <section className="settings-section">
      <div className="settings-section-heading"><h4>探索の候補</h4></div>
      <SettingSwitch label="解禁条件のある種牡馬を除外" checked={!!settings.hideLocked} onChange={(hideLocked) => store.setSettings({ hideLocked })} />
      <SettingSwitch label="購入が必要な繁殖牝馬を除外" checked={!!settings.hidePurchase} onChange={(hidePurchase) => store.setSettings({ hidePurchase })} />
      <SettingSwitch label="計画馬を除外" checked={settings.excludePlannedFromSearch !== false} onChange={(excludePlannedFromSearch) => store.setSettings({ excludePlannedFromSearch })} />
      <p className="settings-note">個別の馬の除外は<a href="#/data">データ画面</a>で設定できます。</p>
    </section>
    <section className="settings-section">
      <div className="settings-section-heading">
        <h4>判定ルール</h4>
        <div className="settings-section-actions"><a href="#/data?tab=sources">成立条件・根拠を見る</a><button disabled={!hasChanges} onClick={() => store.setSettings({ rules: {} })}>判定ルールを既定に戻す</button></div>
      </div>
      <SettingRow label="面白い配合：大系統の種類数" changed={changed('omoshiroThreshold')}>
        {(id) => <input id={id} type="number" required min={1} max={8} value={rules.omoshiroThreshold} onChange={(e) => { if (e.currentTarget.validity.valid) setRule('omoshiroThreshold', e.target.valueAsNumber); }} />}
      </SettingRow>
      <SettingRow label="見事な配合：一致の判定" changed={changed('migotoMode')}>
        {(id) => <select id={id} value={rules.migotoMode} onChange={(e) => setRule('migotoMode', e.target.value as RuleOptions['migotoMode'])}><option value="set">種類のみ</option><option value="multiset">個数も比較</option></select>}
      </SettingRow>
      <SettingRow label="見事な配合：必要な系統数" description="0 は不問" changed={changed('migotoMinSystems')}>
        {(id, descriptionId) => <input id={id} aria-describedby={descriptionId} type="number" required min={0} max={4} value={rules.migotoMinSystems} onChange={(e) => { if (e.currentTarget.validity.valid) setRule('migotoMinSystems', e.target.valueAsNumber); }} />}
      </SettingRow>
      <SettingRow label="凝った配合：ペアの父母逆転" changed={changed('kottaSymmetric')}>
        {(id) => <select id={id} value={String(rules.kottaSymmetric)} onChange={(e) => setRule('kottaSymmetric', e.target.value === 'true')}><option value="true">成立させる</option><option value="false">成立させない</option></select>}
      </SettingRow>
      <SettingRow label="凝った配合：自家製馬のペア" changed={changed('kottaEstimateHomebred')}>
        {(id) => <select id={id} value={String(rules.kottaEstimateHomebred)} onChange={(e) => setRule('kottaEstimateHomebred', e.target.value === 'true')}><option value="true">前作の規則で推定する</option><option value="false">未確定にする</option></select>}
      </SettingRow>
      <SettingRow label="危険な配合：クロス本数" description="1×N・2×2 の近親は本数に関わらず危険。本数の条件は未確認です。" changed={changed('dangerousCrossCount')}>
        {(id, descriptionId) => <input id={id} aria-describedby={descriptionId} type="number" required min={1} max={31} value={rules.dangerousCrossCount} onChange={(e) => { if (e.currentTarget.validity.valid) setRule('dangerousCrossCount', e.target.valueAsNumber); }} />}
      </SettingRow>
      <SettingRow label="自家製馬の小系統" changed={changed('homebredSmallSystem')}>
        {(id) => <select id={id} value={rules.homebredSmallSystem} onChange={(e) => setRule('homebredSmallSystem', e.target.value as RuleOptions['homebredSmallSystem'])}><option value="sire">父から推定</option><option value="unknown">不明として扱う</option></select>}
      </SettingRow>
    </section>
  </>;
}
