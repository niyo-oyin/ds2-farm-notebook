import { useEffect, useRef, useState } from 'react';
import { api, imageUrl } from '../api';
import { canReadHorseStory, storyFacts } from '../core/horse-story';
import { StoryContentSchema, StoryRequestSchema, normalizeStoryContent, type HorseStory, type StoryContent, type StoryRequest } from '../shared/horse-story';
import { store } from '../store/userdata';
import { checkWorkspace, workspaceGeneration } from '../store/workspace';
import { useApp } from './app-context';
import { navigate } from './router';
import { HorseStoryArticle } from './HorseStoryArticle';
import './HorseStory.css';

const TONES: { id: StoryRequest['tone']; title: string; description: string }[] = [
  { id: 'documentary', title: '名馬の評伝', description: '歩みをたどる、競馬雑誌の一篇' },
  { id: 'lyrical', title: '余韻のある物語', description: '勝敗の先にある、愛馬の記憶' },
  { id: 'bloodline', title: '血をつなぐ物語', description: '父と母から続く、その馬だけの系譜' },
];
export function HorseStoryPage({ params }: { params: URLSearchParams }) {
  const app = useApp();
  const horse = app.data.horses.find(h => h.id === params.get('id'));
  const story = horse?.story;
  const [composing, setComposing] = useState(false);
  const [direction, setDirection] = useState(story?.request.direction ?? '');
  const [tone, setTone] = useState<StoryRequest['tone']>(story?.request.tone ?? 'documentary');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<StoryContent | null>(null);
  const controller = useRef<AbortController | null>(null);
  const horseName = horse?.name;
  useEffect(() => {
    if (!horseName) return;
    const previous = document.title;
    document.title = `${horseName} — 愛馬の一篇`;
    return () => { document.title = previous; };
  }, [horseName]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!busy) return;
    const unload = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', unload); return () => removeEventListener('beforeunload', unload);
  }, [busy]);
  if (!horse) return <div className="empty">所有馬が見つかりません。<button onClick={() => navigate('/horses')}>所有馬へ</button></div>;
  if (!canReadHorseStory(horse, app.data.settings.gameYear)) return <div className="empty">愛馬の一篇は、命名済み・デビュー済みの3歳以上の馬で利用できます。<button onClick={() => navigate('/horses', { id: horse.id })}>所有馬へ</button></div>;
  const showComposer = composing || !story;
  const picture = horse.imageId ? imageUrl(horse.imageId) : undefined;
  const generate = async () => {
    setError(''); setBusy(true);
    const generation = workspaceGeneration();
    const abort = new AbortController(); controller.current = abort;
    try {
      const request = StoryRequestSchema.parse({ facts: storyFacts(horse, app.resolver, app.data.horses), direction, tone });
      const result = await api<{ story: HorseStory }>('/api/horse-stories', { method: 'POST', body: JSON.stringify(request), signal: abort.signal });
      checkWorkspace(generation);
      if (abort.signal.aborted) return;
      store.updateHorse(horse.id, { story: result.story }); setComposing(false); setDraft(null);
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error && e.name === 'ZodError' ? '馬のメモや戦績が長すぎるか、入力内容に問題があります。所有馬の情報を確認してください。' : (e as Error).message); }
    finally { if (controller.current === abort) { controller.current = null; setBusy(false); } }
  };
  const exportHtml = async () => {
    if (!story) return;
    setExporting(true); setError('');
    try { const { downloadHorseStory } = await import('./horse-story-export'); await downloadHorseStory(story, picture); } catch (e) { setError((e as Error).message); } finally { setExporting(false); }
  };
  const saveDraft = () => {
    if (!story || !draft) return;
    const parsed = StoryContentSchema.safeParse(draft);
    if (!parsed.success) { setError('空欄や長すぎる文章があります。見出しと本文を確認してください。'); return; }
    store.updateHorse(horse.id, { story: { ...story, content: normalizeStoryContent(parsed.data) } }); setDraft(null); setError('');
  };
  return <div className="story-page">
    <div className="story-toolbar"><button disabled={busy} onClick={() => navigate('/horses', { id: horse.id })}>← 所有馬へ</button><span>{horse.name}の一篇</span>{story && !busy && !draft && <div><button onClick={() => { setDirection(story.request.direction); setTone(story.request.tone); setComposing(!showComposer); setError(''); }}>{showComposer ? '記事に戻る' : '書き直す'}</button><button onClick={() => { setDraft(normalizeStoryContent(structuredClone(story.content))); setComposing(false); }}>文章を編集</button><button disabled={exporting} onClick={() => void exportHtml()}>{exporting ? '保存中…' : 'HTMLを保存'}</button><button className="primary" disabled={showComposer} onClick={() => window.print()}>印刷・PDF</button></div>}</div>
    {error && <div className="error" role="alert">{error}</div>}
    {showComposer && !draft && <section className="story-composer">
      <div className="story-composer-heading"><span>STABLE JOURNAL</span><h2>記録を、一篇の物語に。</h2><p>{horse.name}の戦績と血統から、愛馬だけの読み物を綴ります。</p></div>
      <div className="story-compose-grid"><div className="story-source-card">{picture ? <img src={picture} alt={horse.name} /> : <img className="story-source-emblem" src="/favicon.svg" alt="" />}<h3>{horse.name}</h3><p>{[horse.profile?.record, horse.profile?.color, horse.category].filter(Boolean).join(' · ')}</p><dl>{(['父', '母'] as const).map((role, i) => <div key={role}><dt>{role}</dt><dd>{app.resolver.label(i ? horse.damKey : horse.sireKey) || '未登録'}</dd></div>)}</dl><small>戦績 {horse.profile?.races?.length ?? 0}件{horse.memo && ' · メモあり'}</small></div>
      <div className="story-compose-options"><fieldset disabled={busy}><legend>読み味を選ぶ</legend><div className="story-tone-options">{TONES.map(t => <label key={t.id} className={tone === t.id ? 'selected' : ''}><input type="radio" name="story-tone" value={t.id} checked={tone === t.id} onChange={() => setTone(t.id)} /><span><b>{t.title}</b><small>{t.description}</small></span></label>)}</div><label className="field">残したい思い出・テーマ<textarea value={direction} onChange={e => setDirection(e.target.value)} maxLength={1500} rows={4} placeholder="例：何度も惜敗した末の初勝利を中心に。母から受け継いだ血統への思いも。" /></label></fieldset><p className="story-generation-note">登録した記録とメモを使い、AIが執筆します。記事はこの馬に保存されます。</p><div className="story-generate-actions">{busy ? <><span role="status" className="story-writing"><span />愛馬の記録を読み、物語を綴っています…</span><button onClick={() => controller.current?.abort()}>中止</button></> : <button className="primary" onClick={() => void generate()}>{story ? '新しい一篇を生成' : 'この馬の物語を綴る'} →</button>}</div></div></div>
    </section>}
    {draft && <section className="story-editor panel"><div className="story-editor-actions"><h2>文章を編集</h2><button onClick={() => { setDraft(null); setError(''); }}>変更を戻す</button><button className="primary" onClick={saveDraft}>保存</button></div>{(['title', 'subtitle', 'lead', 'signature'] as const).map((key, i) => <label className="field" key={key}>{['見出し', '紹介文', '導入', '一行コピー'][i]}<textarea rows={key === 'lead' ? 4 : 2} value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}{draft.chapters.map((c, i) => c.paragraphs.map((p, k) => <label className="field" key={`${i}-${k}`}>第{2 + draft.chapters.slice(0, i).reduce((n, x) => n + x.paragraphs.length, 0) + k}段落<textarea rows={5} value={p} onChange={e => setDraft({ ...draft, chapters: draft.chapters.map((x, j) => j === i ? { ...x, paragraphs: x.paragraphs.map((v, n) => n === k ? e.target.value : v) } : x) })} /></label>))}<label className="field">結び<textarea rows={4} value={draft.closing} onChange={e => setDraft({ ...draft, closing: e.target.value })} /></label></section>}
    {story && !draft && !showComposer && <HorseStoryArticle story={story} image={picture} />}
  </div>;
}
