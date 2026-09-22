import type { HorseStory } from '../shared/horse-story';
import { storyRaceWins } from '../core/horse-story';
import './HorseStory.css';

export function HorseStoryArticle({ story, image, emblem = "/favicon.svg" }: { story: HorseStory; image?: string; emblem?: string }) {
  const { facts } = story.request;
  const { content } = story;
  const wins = storyRaceWins(facts);
  const parents = facts.parents.filter(p => p.name);
  return <article className={`horse-story story-${content.palette}`}>
    <div className="story-masthead"><span>STABLE JOURNAL</span><span>愛馬の一篇</span><span>{facts.birthYear !== null ? `${facts.birthYear}年生まれ` : 'ONE HORSE, ONE STORY'}</span></div>
    <section className="story-cover">
      <div className="story-cover-copy"><div className="story-kicker">{facts.category} / {facts.sex || '性別未登録'}{facts.color && ` / ${facts.color}`}</div><div className="story-horse-name">{facts.name}</div><h1>{content.title}</h1><p className="story-subtitle">{content.subtitle}</p><div className="story-parent-line">{parents.map(p => <span key={p.role}>{p.role} <b>{p.name}</b></span>)}</div></div>
      <div className={'story-cover-art' + (image ? ' has-photo' : '')}>{image ? <img src={image} alt={facts.name} /> : <><div className="story-track" aria-hidden="true" /><img className="story-emblem" src={emblem} alt="" /><span className="story-art-name">{facts.name}</span></>}<span className="story-art-caption">THE PORTRAIT OF A RACEHORSE</span></div>
    </section>
    <div className="story-statbar"><div><span>競走成績</span><strong>{facts.record || `記録したレース ${facts.races.length}戦`}</strong></div><div><span>総賞金</span><strong>{facts.earnings !== null ? `${facts.earnings.toLocaleString()}万円` : '—'}</strong></div><div><span>主な勝ち鞍</span><strong>{facts.wins || wins.slice(0, 3).map(r => r.race).join('・') || '—'}</strong></div></div>
    <div className="story-reading-layout">
      <div className="story-prose"><p>{content.lead}</p>{content.chapters.flatMap(chapter => chapter.paragraphs).map((p, i) => <p key={i}>{p}</p>)}<p>{content.closing}</p></div>
      <aside className="story-sidebar"><section className="story-signature">{content.signature}</section><section><h2>血をつなぐ</h2>{parents.map(p => <div className="story-parent" key={p.role}><span>{p.role}</span><h3>{p.name}</h3>{p.system && <p>{p.system}系</p>}{p.record && <p>{p.record}</p>}{p.wins && <p>{p.wins}</p>}</div>)}{!parents.length && <p>父母は未登録</p>}{facts.pedigree.length > 0 && <dl className="story-pedigree">{facts.pedigree.filter(p => p.position.length === 2).map(p => <div key={p.position}><dt>{p.position}</dt><dd>{p.name}</dd></div>)}</dl>}</section>{facts.factors.length > 0 && <section><h2>秘めた因子</h2><p>{facts.factors.join('・')}</p></section>}{facts.abilities.length > 0 && <section><h2>その個性</h2>{facts.abilities.map((a, i) => <p key={i}>{a}</p>)}</section>}{facts.stable && <section><h2>所属厩舎</h2><p>{facts.stable}</p></section>}</aside>
    </div>
    {facts.races.length > 0 && <section className="story-records"><div className="story-section-title"><span>RACING RECORD</span><h2>蹄跡</h2><small>登録した戦績 {facts.races.length}戦</small></div><div className="story-record-scroll"><table><thead><tr><th>日付</th><th>レース</th><th>競馬場</th><th>条件</th><th>着順</th></tr></thead><tbody>{facts.races.map((r, i) => <tr key={i} className={wins.includes(r) ? 'story-win' : ''}><td>{r.date || '—'}</td><td>{r.grade && <span className="story-grade">{r.grade}</span>}{r.race || '—'}</td><td>{r.place || '—'}</td><td>{[r.surface, r.distance ? `${r.distance}m` : '', r.going].filter(Boolean).join(' ') || '—'}</td><td>{r.finish || '—'}</td></tr>)}</tbody></table></div></section>}
    <footer className="story-colophon"><span>STABLE JOURNAL · {facts.name}</span><span>{new Date(story.createdAt).toLocaleDateString('ja-JP')} 編纂 · AIによる物語</span></footer>
  </article>;
}
