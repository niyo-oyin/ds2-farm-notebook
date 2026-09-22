import { useState, useSyncExternalStore } from 'react';
import { syncNow } from '../../store/userdata';
import { getSyncState, subscribeSync } from '../../store/sync';
import { getToken, setToken } from '../../api';

const SYNC_LABEL = { idle: '未接続', syncing: '同期中', ok: '同期済み', offline: 'オフライン', unauthorized: '要認証', error: '同期エラー' } as const;

export function SyncSettings() {
  const sync = useSyncExternalStore(subscribeSync, getSyncState);
  const [token, setTokenInput] = useState(getToken());
  const tone = sync.status === 'ok' ? 'ok' : sync.status === 'syncing' || sync.status === 'idle' ? '' : 'warn';
  return <>
    <section className="settings-section">
      <div className="settings-sync-summary">
        <div>
          <div className="sync-status"><span className={'pill sync-' + tone}>{SYNC_LABEL[sync.status]}</span></div>
          <div className="small muted">最終同期：{sync.lastSync ? new Date(sync.lastSync).toLocaleString('ja-JP') : 'まだありません'}</div>
        </div>
        <button disabled={sync.status === 'syncing'} onClick={() => { void syncNow(); }}>今すぐ同期</button>
      </div>
      {sync.message && <p className="settings-note" role="status">{sync.message}</p>}
    </section>
    <details className="settings-details settings-connection" open={sync.status === 'unauthorized' ? true : undefined}>
      <summary>接続設定を変更</summary>
      <form onSubmit={(e) => { e.preventDefault(); setToken(token); location.reload(); }}>
        <label className="field">認証トークン<input type="password" autoComplete="off" value={token} placeholder="未設定" onChange={(e) => setTokenInput(e.target.value)} /></label>
        <p className="settings-note">サーバが認証を求める場合に入力します。この端末に保存されます。</p>
        <button disabled={token === getToken()} type="submit">保存して再接続</button>
      </form>
    </details>
  </>;
}
