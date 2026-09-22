import { FarmSettings } from './settings/FarmSettings';
import { PageHeading } from './icons';
import { BreedingSettings } from './settings/BreedingSettings';
import { ImportSettings } from './settings/ImportSettings';
import { SyncSettings } from './settings/SyncSettings';
import { BackupSettings } from './settings/BackupSettings';
import { SaveSettings } from './settings/SaveSettings';
import './SettingsPage.css';

const SECTIONS = [
  { id: 'farm', label: '牧場設定', component: FarmSettings },
  { id: 'breeding', label: '配合・探索', component: BreedingSettings },
  { id: 'import', label: '写真の取り込み', component: ImportSettings },
  { id: 'sync', label: '同期・接続', component: SyncSettings },
  { id: 'saves', label: 'セーブ・ロード', component: SaveSettings },
  { id: 'backup', label: 'バックアップ・初期化', component: BackupSettings },
] as const;

export function SettingsPage({ params }: { params: URLSearchParams }) {
  const section = SECTIONS.find((s) => s.id === params.get('section')) ?? SECTIONS[0];
  const Content = section.component;
  return <div className="settings-page">
    <PageHeading icon="settings" title="設定" />
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="設定のカテゴリ">
        {SECTIONS.map((s) => <a key={s.id} href={`#/settings?section=${s.id}`} aria-current={s.id === section.id ? 'page' : undefined}>{s.label}</a>)}
      </nav>
      <section className="settings-content" aria-labelledby="settings-title">
        <div className="settings-heading">
          <h3 id="settings-title">{section.label}</h3>
          {(section.id === 'farm' || section.id === 'breeding' || section.id === 'import') && <span className="small muted">変更は自動保存</span>}
        </div>
        <Content />
      </section>
    </div>
  </div>;
}
