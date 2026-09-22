// ローカルサーバ: ユーザーデータの同期API、写真取り込みと探索のジョブキュー、馬の画像、ビルド済み画面の配信。
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLM, classifyScreen, isScreenType, llmReady, readScreenAs, type ScreenType } from './llm.js';
import { detectHorseBox, samReady } from './sam.js';
import { ImageStore } from './images.js';
import { JobQueue } from './jobs.js';
import { SearchJobQueue } from './search-jobs.js';
import { SaveDataStore, saveDataRoutes } from './save-data.js';
import { horseStoryRoutes } from './horse-stories.js';
import { horseNameRoutes } from './horse-names.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const PORT = Number(process.env.PORT ?? 8877);
const DB_PATH = process.env.DS2_DB ?? resolve(here, 'data', 'ds2.sqlite');
const TOKEN = process.env.DS2_TOKEN ?? '';

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
const images = new ImageStore(resolve(dirname(DB_PATH), 'images'));
// まず画面の種類を判別し（候補は送信元で決まる scope）、次に種類ごとの専用プロンプトで書き写す。
// 馬の切り出し矩形（SAM）はカードの画面でだけ要るので、判別後に書き写しと並列に呼ぶ。SAM の失敗は切り出しなしとして扱う
const jobs = new JobQueue(db, async (job) => {
  const img = images.read(job.imageId);
  if (!img) throw new Error('写真が見つかりません');
  const base64 = img.bytes.toString('base64');
  const cls = await classifyScreen(base64, img.mediaType, job.scope);
  const type = cls.result.screen_type;
  if (type === 'その他') return { result: { screen_type: 'その他', notes: cls.result.reason }, model: cls.model };
  const isCard = type === '育成馬' || type === '入厩馬';
  const [read, box] = await Promise.all([readScreenAs(type, base64, img.mediaType), isCard ? detectHorseBox(base64, img.mediaType).catch((e: Error) => { console.warn(`SAM: ${e.message}`); return null; }) : null]);
  const result = read.result.screen_type === '育成馬' || read.result.screen_type === '入厩馬'
    ? { ...read.result, card: { ...read.result.card, horse_box: box ?? { x0: 0, y0: 0, x1: 0, y1: 0 } } }
    : read.result;
  return { result, model: read.model };
});

// 探索ジョブは同期済みレコードから判定の材料を作る。ロードで世代が変わったら写真のジョブと一緒に捨てる
const savedData = new SaveDataStore(db, images, () => { searchJobs.clear(); return jobs.clear(); });
const searchJobs = new SearchJobQueue(db, () => savedData.records(savedData.generation).records, 2);

const app = new Hono();

// 認証（DS2_TOKEN が設定されている場合のみ）。画像の GET は img タグから読むため ?token= も受け付ける
app.use('/api/*', async (c, next) => {
  if (TOKEN) {
    const h = c.req.header('authorization') ?? '';
    const viaQuery = c.req.method === 'GET' && c.req.path.startsWith('/api/images/') && c.req.query('token') === TOKEN;
    if (h !== `Bearer ${TOKEN}` && !viaQuery) return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true, model: LLM.model, imageReading: llmReady(), horseCrop: samReady(), auth: !!TOKEN }));

app.route('/api', saveDataRoutes(savedData));
app.route('/api/horse-stories', horseStoryRoutes());
app.route('/api/horse-names', horseNameRoutes());

// ---- 写真取り込みのジョブ ----
app.get('/api/jobs', (c) => c.json({ jobs: jobs.list() }));
app.post('/api/jobs', async (c) => {
  if (!llmReady()) return c.json({ error: 'サーバに LLM_API_KEY が設定されていません' }, 503);
  const body = (await c.req.json()) as { image: string; mediaType: string; scope: unknown; targetHorseId?: string; generation: number };
  if (body.generation !== savedData.generation) return c.json({ error: 'セーブデータがロードされました。同期してから写真を送ってください。' }, 409);
  const scope = Array.isArray(body.scope) ? body.scope.filter(isScreenType) : [];
  if (!scope.length) return c.json({ error: '判別する画面の種類（scope）が指定されていません' }, 400);
  const imageId = images.save(body?.image ?? '', body?.mediaType ?? '');
  if (!imageId) return c.json({ error: '画像が不正です（jpeg/png/webp、4MBまで）' }, 400);
  return c.json({ job: jobs.enqueue(imageId, scope as ScreenType[], body.targetHorseId?.trim() || null) });
});
app.post('/api/jobs/:id/retry', (c) => {
  const job = jobs.retry(c.req.param('id'));
  return job ? c.json({ job }) : c.json({ error: 'not found' }, 404);
});
app.delete('/api/jobs/:id', (c) => {
  const imageId = jobs.remove(c.req.param('id'));
  if (imageId) savedData.deleteUnusedImage(imageId);
  return c.json({ ok: true });
});

// ---- 探索ジョブ（数世代探索・ループ探索のバックグラウンド実行） ----
app.get('/api/search-jobs', (c) => c.json({ jobs: searchJobs.list() }));
app.get('/api/search-jobs/:id', (c) => {
  const job = searchJobs.get(c.req.param('id'));
  return job ? c.json({ job }) : c.json({ error: 'この探索は見つかりません' }, 404);
});
app.post('/api/search-jobs', async (c) => {
  const body = (await c.req.json()) as { kind: unknown; request: unknown; generation: number };
  if (body.generation !== savedData.generation) return c.json({ error: 'セーブデータがロードされました。同期してから探索してください。' }, 409);
  if ((body.kind !== 'lineage' && body.kind !== 'loop') || !body.request || typeof body.request !== 'object') return c.json({ error: '探索の指定が不正です' }, 400);
  return c.json({ job: searchJobs.enqueue(body.kind, body.request as never) });
});
app.post('/api/search-jobs/:id/cancel', (c) => {
  const job = searchJobs.cancel(c.req.param('id'));
  return job ? c.json({ job }) : c.json({ error: 'この探索は見つかりません' }, 404);
});
app.delete('/api/search-jobs/:id', (c) => { searchJobs.remove(c.req.param('id')); return c.json({ ok: true }); });

// ---- 画像（馬の画像・取り込み写真） ----
app.post('/api/images', async (c) => {
  const body = (await c.req.json()) as { image: string; mediaType: string };
  const id = images.save(body?.image ?? '', body?.mediaType ?? '');
  return id ? c.json({ id }) : c.json({ error: '画像が不正です（jpeg/png/webp、4MBまで）' }, 400);
});
app.get('/api/images/:id', (c) => {
  const img = images.read(c.req.param('id'));
  if (!img) return c.json({ error: 'not found' }, 404);
  return c.body(new Uint8Array(img.bytes), 200, { 'content-type': img.mediaType, 'cache-control': 'private, max-age=31536000, immutable' });
});
app.delete('/api/images/:id', (c) => { savedData.deleteUnusedImage(c.req.param('id')); return c.json({ ok: true }); });

// 未知の API パスを画面配信に渡さず、JSON の 404 を返す。
app.all('/api/*', (c) => c.json({ error: `API がありません: ${c.req.method} ${c.req.path}` }, 404));

// ---- 画面（dist）の配信 ----
const dist = resolve(root, 'dist');
if (existsSync(dist)) {
  app.use('/*', serveStatic({ root: 'dist' }));
  app.get('*', (c) => c.html(readFileSync(resolve(dist, 'index.html'), 'utf8')));
} else {
  app.get('/', (c) => c.text('dist/ がありません。npm run build を実行するか、開発時は npm run dev の画面から接続してください。'));
}

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`ds2-tool server: http://localhost:${info.port}  (LAN からは http://<このMacのIP>:${info.port})`);
  console.log(`DB: ${DB_PATH} / 認証: ${TOKEN ? 'あり' : 'なし'} / 写真読み取り: ${llmReady() ? `${LLM.model} @ ${LLM.baseUrl}` : '無効（LLM_API_KEY 未設定）'} / 未処理ジョブ: ${jobs.list().filter((j) => j.status !== 'done').length}`);
});
