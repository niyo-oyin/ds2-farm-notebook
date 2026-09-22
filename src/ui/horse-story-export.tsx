import { renderToStaticMarkup } from 'react-dom/server';
import type { HorseStory } from '../shared/horse-story';
import { HorseStoryArticle } from './HorseStoryArticle';
import styles from './HorseStory.css?inline';

const asDataUrl = async (url: string): Promise<string> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error('画像を保存できませんでした。もう一度お試しください。');
  const blob = await response.blob();
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
};

export function horseStoryHtml(story: HorseStory, emblem: string, photo?: string) {
  const article = renderToStaticMarkup(<HorseStoryArticle story={story} image={photo} emblem={emblem} />);
  const title = story.request.facts.name.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — 愛馬の一篇</title><style>body{margin:0;background:#eeeae2}*{box-sizing:border-box}${styles}</style></head><body>${article}</body></html>`;
}

export async function downloadHorseStory(story: HorseStory, image?: string) {
  const [photo, emblem] = await Promise.all([image ? asDataUrl(image) : undefined, asDataUrl('/favicon.svg')]);
  const url = URL.createObjectURL(new Blob([horseStoryHtml(story, emblem, photo)], { type: 'text/html;charset=utf-8' }));
  const name = Array.from(story.request.facts.name.replace(/[\\/:*?"<>|]/g, '_')).slice(0, 50).join('');
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const link = document.createElement('a'); link.href = url; link.download = `${name}-愛馬の一篇-${timestamp}.html`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
