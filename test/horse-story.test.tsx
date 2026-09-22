import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { horseStoryRoutes } from '../server/horse-stories';
import { canReadHorseStory, storyFacts } from '../src/core/horse-story';
import { HorseResolver } from '../src/core/pedigree';
import { DEFAULT_RULES } from '../src/core/rules';
import { baseMaster } from '../src/data/base-master';
import { horseStoryHtml } from '../src/ui/horse-story-export';
import { HorseStoryArticle } from '../src/ui/HorseStoryArticle';
import { normalizeUserData, emptyUserData } from '../src/store/model';
import { toRecords } from '../src/store/sync';
import { userDataFromRecords } from '../server/user-data';
import { owned } from './horse-fixtures';
import type { HorseStory, StoryRequest } from '../src/shared/horse-story';

const horse = owned('u:story', { name: 'アオイキセキ', sireKey: baseMaster.stallions[0].id, damKey: baseMaster.broodmares[0].id,
  profile: { record: '12戦4勝', races: [{ date: '4.3', race: '皐月賞', place: '中山', grade: 'GⅠ', distance: 2000, surface: '芝', finish: '2' }], birthYear: 27 }, memo: '初勝利まで時間がかかった。' });
const resolver = new HorseResolver(baseMaster, [horse], DEFAULT_RULES);
const request: StoryRequest = { facts: storyFacts(horse, resolver, [horse]), tone: 'documentary', direction: '' };
const makeStory = (r: StoryRequest): HorseStory => ({ id: 'story:test', createdAt: '2026-09-22T00:00:00.000Z', model: 'test', request: r,
  content: { title: '勝利の、その先へ', subtitle: '蹄跡をたどる', lead: '一頭の歩み。', signature: '記録の先に、記憶がある。', palette: 'forest', closing: '物語は続く。', chapters: Array.from({ length: 3 }, () => ({ paragraphs: ['記録を読み返す。'] })) } });
const post = (body: unknown) => new Request('http://localhost/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('愛馬の一篇', () => {
  it('命名済み・出走済み・3歳以上の馬だけを対象にする', () => {
    expect(canReadHorseStory(horse, 30)).toBe(true);
    expect(canReadHorseStory(horse, 29)).toBe(false);
    expect(canReadHorseStory(horse)).toBe(false);
    for (const name of ['', 'アディクティドの27', 'アディクティドの２７']) expect(canReadHorseStory({ ...horse, name }, 30)).toBe(false);
    for (const category of ['現役', '引退', '繁殖牝馬', '種牡馬'] as const) {
      expect(canReadHorseStory({ ...horse, category }, 30)).toBe(true);
      expect(canReadHorseStory({ ...horse, category }, 29)).toBe(false);
    }
    const undebuted = { ...horse, profile: { birthYear: 27, record: '0戦0勝' } };
    expect(canReadHorseStory(undebuted, 30)).toBe(false);
    for (const finish of ['', '取消', '除外']) expect(canReadHorseStory({ ...undebuted, profile: { ...undebuted.profile, races: [{ date: '', place: '', race: '新馬', finish }] } }, 30)).toBe(false);
    expect(canReadHorseStory({ ...undebuted, profile: { birthYear: 27, races: [{ date: '', place: '', race: '新馬', finish: '中止' }] } }, 30)).toBe(true);
    expect(canReadHorseStory({ ...horse, profile: { record: '１戦０勝' }, observations: [{ at: '', screen: '入厩馬', source: 'photo', age: 3 }] })).toBe(true);
  });
  it('選択した馬と父母だけを資料にし、画像・過去の記事・他の所有馬を送らない', () => {
    const parent = owned('u:parent', { name: '母の馬', memo: '母の記憶', profile: { record: '8戦2勝' } });
    const child = { ...horse, damKey: parent.id, imageId: 'private-image', story: makeStory(request) };
    const unrelated = owned('u:other', { memo: '送信対象外のメモ' });
    const facts = storyFacts(child, new HorseResolver(baseMaster, [child, parent, unrelated], DEFAULT_RULES), [child, parent, unrelated]);
    expect(facts.parents[1]).toMatchObject({ name: '母の馬', memo: '母の記憶', record: '8戦2勝' });
    expect(facts.record).toBe('12戦4勝');
    expect(facts.races).toHaveLength(1);
    expect(JSON.stringify(facts)).not.toMatch(/private-image|送信対象外|story:test/);
  });
  it('入力を検証して生成し、記録のスナップショットを返す', async () => {
    let called = 0;
    const app = horseStoryRoutes(async r => { called++; return makeStory(r); }, () => true);
    const invalid = await app.fetch(post({ ...request, facts: { ...request.facts, name: '' } }));
    expect(invalid.status).toBe(400); expect(called).toBe(0);
    const response = await app.fetch(post(request));
    expect(response.status).toBe(200);
    expect((await response.json()).story.request.facts.races[0]).toMatchObject({ finish: '2', distance: 2000 });
    expect(called).toBe(1);
  });
  it('キー未設定とAPI失敗をユーザー向けのエラーにする', async () => {
    const disabled = horseStoryRoutes(async r => makeStory(r), () => false);
    expect((await disabled.fetch(post(request))).status).toBe(503);
    const failed = horseStoryRoutes(async () => { throw new Error('private upstream detail'); }, () => true);
    const response = await failed.fetch(post(request));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('private upstream detail');
  });
  it('生成中の同時リクエストを制限し、完了後は再び生成できる', async () => {
    const releases: (() => void)[] = [];
    const app = horseStoryRoutes(async r => { await new Promise<void>(resolve => releases.push(resolve)); return makeStory(r); }, () => true);
    const a = app.fetch(post(request)), b = app.fetch(post(request));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect((await app.fetch(post(request))).status).toBe(429);
    releases.forEach(r => r()); await Promise.all([a, b]);
    const c = app.fetch(post(request)); await new Promise(resolve => setTimeout(resolve, 10)); releases.at(-1)!();
    expect((await c).status).toBe(200);
  });
  it('記事を含む所有馬は同期・バックアップの変換で保存内容を保つ', () => {
    const saved = { ...emptyUserData(), horses: [{ ...horse, story: makeStory(request) }] };
    const restored = userDataFromRecords(toRecords(normalizeUserData(JSON.parse(JSON.stringify(saved)))));
    expect(restored.horses[0].story).toEqual(saved.horses[0].story);
  });
  it('本文のHTMLを実行せず、通算記録と登録戦績を区別して表示する', () => {
    const story = makeStory(request); story.content.title = '<script>alert(1)</script>';
    const html = renderToStaticMarkup(<HorseStoryArticle story={story} />);
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
    expect(html).toContain('12戦4勝'); expect(html).toContain('登録した戦績 1戦');
  });
  it('保存用HTMLは画像を内包し、馬名や本文をHTMLとして実行しない', () => {
    const story = makeStory(request);
    story.request = { ...request, facts: { ...request.facts, name: '<img src=x onerror=alert(1)>' } };
    const emblem = 'data:image/svg+xml;base64,PHN2Zy8+';
    const html = horseStoryHtml(story, emblem);
    expect(html).toContain(`<img class="story-emblem" src="${emblem}"`);
    expect(html).not.toMatch(/(?:src|href)="(?:\/|https?:)/);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
    const photo = 'data:image/png;base64,aW1hZ2U=';
    expect(horseStoryHtml(story, emblem, photo)).toContain(`src="${photo}"`);
  });
});
