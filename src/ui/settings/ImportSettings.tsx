import { store } from '../../store/userdata';
import { useApp } from '../app-context';
import { SettingRow, SettingSwitch } from './SettingRow';

export function ImportSettings() {
  const { data: { settings } } = useApp();
  return <>
    <section className="settings-section">
      <div className="settings-section-heading"><h4>写真の向き</h4></div>
      <SettingRow label="縦長の写真を自動回転" description="取り込み時に縦長の写真だけを90度回転します。送信前に手動でも向きを直せます。">{(id, descriptionId) =>
        <select id={id} aria-describedby={descriptionId} value={settings.importPortraitRotation ?? ''} onChange={e => store.setSettings({ importPortraitRotation: (e.target.value || undefined) as 'left' | 'right' | undefined })}>
          <option value="">回転しない</option><option value="left">左に90度</option><option value="right">右に90度</option>
        </select>
      }</SettingRow>
    </section>
    <section className="settings-section">
      <div className="settings-section-heading"><h4>解析後の確認</h4></div>
      <SettingSwitch label="確認画面を自動で開く" description="入力中や別のダイアログの表示中は待ちます。" checked={!!settings.importAutoOpen} onChange={(importAutoOpen) => store.setSettings({ importAutoOpen })} />
    </section>
    <section className="settings-section">
      <div className="settings-section-heading"><h4>所有馬</h4></div>
      <SettingSwitch label="所有馬に自動反映" description="反映先を特定できる場合のみ、確認を省略します。" checked={!!settings.importAutoApply} onChange={(importAutoApply) => store.setSettings({ importAutoApply })} />
      <details className="settings-details">
        <summary>対象となる条件</summary>
        <ul>
          <li>育成馬・入厩馬のカード：馬名が一致する所有馬を更新し、候補がなければ新規登録します。</li>
          <li>血統：仮名の母名が一致する馬が1頭だけで、父母とも登録済みの場合に反映します。</li>
          <li>反映先を指定して送った写真も対象です。</li>
          <li>血統画面から読んだ祖先の因子は、未登録の祖先だけをマスターに追加します。</li>
        </ul>
      </details>
    </section>
    <section className="settings-section">
      <div className="settings-section-heading"><h4>種牡馬・繁殖牝馬</h4></div>
      <SettingSwitch label="登録済みの馬を自動更新" description="同名の種牡馬・繁殖牝馬が登録されている場合。" checked={!!settings.importAutoMasterUpdate} onChange={(importAutoMasterUpdate) => store.setSettings({ importAutoMasterUpdate })} />
      <SettingSwitch label="未登録の馬を自動追加" checked={!!settings.importAutoMasterAdd} onChange={(importAutoMasterAdd) => store.setSettings({ importAutoMasterAdd })} />
      <details className="settings-details">
        <summary>対象となる条件</summary>
        <p>所有馬・計画馬と同名、仮名「母名の27」、父か母が所有馬の場合は、自動更新・追加の設定に関わらず種牡馬・繁殖牝馬データには登録しません。</p>
      </details>
    </section>
  </>;
}
