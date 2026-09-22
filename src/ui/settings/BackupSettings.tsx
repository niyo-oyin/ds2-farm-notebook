import { useRef, useState } from 'react';
import { store } from '../../store/userdata';
import { useApp } from '../app-context';

const DATA_SCOPE = '所有馬・計画馬・計画・設定・マスターデータの追加や修正';

export function BackupSettings() {
  const { data } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const download = () => {
    const url = URL.createObjectURL(new Blob([store.exportJson()], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ds2-tool-userdata-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const upload = async (file: File) => {
    setMessage(undefined);
    try {
      const text = await file.text();
      if (!confirm(`「${file.name}」の内容で、${DATA_SCOPE}をすべて置き換えますか？`)) return;
      store.importJson(text);
      setMessage({ text: 'データを読み込みました。' });
    } catch (e) { setMessage({ text: '読み込みに失敗しました：' + (e as Error).message, error: true }); }
  };
  return <>
    <section className="settings-section">
      <div className="settings-section-heading"><h4>ファイルへの保存・復元</h4></div>
      <p className="settings-note">対象：{DATA_SCOPE}</p>
      <div className="settings-data-counts"><span>所有馬 <b>{data.horses.length}</b> 頭</span><span>計画馬 <b>{data.plannedHorses.length}</b> 頭</span><span>計画 <b>{data.plans.length}</b> 件</span></div>
      <div className="settings-backup-actions">
        <button onClick={download}>ファイルに書き出し</button>
        <button onClick={() => fileRef.current?.click()}>ファイルから読み込み</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload(file); }} />
      </div>
      <p className="settings-note">読み込みは現在のデータを上書きします。馬の画像とサーバのセーブデータは、このファイルには含まれません。</p>
      {message && <p className={message.error ? 'error' : 'settings-note'} role="status">{message.text}</p>}
    </section>
    <section className="settings-section settings-reset">
      <div className="settings-section-heading"><h4>初期化</h4></div>
      <p className="settings-note">{DATA_SCOPE}を削除します。マスターデータは初期状態に戻ります。サーバのセーブデータは残ります。</p>
      <button className="danger" onClick={() => {
        if (confirm(`${DATA_SCOPE}をすべて削除しますか？ この操作は取り消せません。`)) {
          store.reset(); setMessage({ text: 'データを初期化しました。' });
        }
      }}>データを初期化</button>
    </section>
  </>;
}
