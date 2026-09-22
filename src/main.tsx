import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { api } from './api';
import { initializeCatalog } from './data/catalog';
import type { MasterCatalog } from './shared/master-catalog';

const root = createRoot(document.getElementById('root')!);
root.render(<main><p role="status">データを読み込んでいます…</p></main>);

async function start() {
  try {
    initializeCatalog(await api<MasterCatalog>('/api/master', { cache: 'no-store' }));
    const { default: App } = await import('./App.tsx');
    root.render(<StrictMode><App /></StrictMode>);
  } catch (error) {
    root.render(<main>
      <h1>データを読み込めませんでした</h1>
      <p role="alert">{error instanceof Error ? error.message : 'サーバーへの接続を確認してください。'}</p>
      <button onClick={() => location.reload()}>再読み込み</button>
    </main>);
  }
}
void start();
