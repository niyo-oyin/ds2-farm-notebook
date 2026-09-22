import type { ReactNode } from 'react';

/** 画面見出しと区画見出しの線画アイコン。24px 格子、線幅 1.7 */
export const ICONS = {
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  horse: 'M5 20v-7l-2-2 3-3 3-1 2-4 3 3 5 2 2 4-3 2-3-2-1 8 M6 13h8 M8 13v7 M17 7v2',
  check: 'M9 3h6v4H9z M9 5H5v16h14V5h-4 M8 14l3 3 5-6',
  dna: 'M6 3c0 9 12 9 12 18 M18 3c0 9-12 9-12 18 M7 5h10 M9 9h6 M9 15h6 M7 19h10',
  chart: 'M4 20v-6h3v6z M11 20V9h3v11z M18 20V3h3v17z',
  ancestors: 'M9 3h6v5H9z M3 16h6v5H3z M15 16h6v5h-6z M12 8v4 M6 16v-4h12v4',
  sliders: 'M3 6h4 M11 6h10 M3 12h10 M17 12h4 M3 18h4 M11 18h10 M7 3h4v6H7z M13 9h4v6h-4z M7 15h4v6H7z',
  reset: 'M3 10a9 9 0 1 1 2 8 M3 4v6h6',
  mating: 'M9 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M15 20a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12.5 8.5l2 2',
  plans: 'M4 5h4v4H4z M4 15h4v4H4z M10 7h10 M10 17h10 M6 9v6',
  database: 'M12 3c5 0 8 1.3 8 3s-3 3-8 3-8-1.3-8-3 3-3 8-3z M4 6v12c0 1.7 3 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3 3 8 3s8-1.3 8-3',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, className = 'search-icon' }: { name: IconName; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name]} /></svg>;
}

/** 各タブの画面の見出し。アイコン＋題名、任意の件数、右側に操作 */
export function PageHeading({ icon, title, count, actions }: { icon: IconName; title: string; count?: { value: number; unit: string }; actions?: ReactNode }) {
  return <div className="page-heading">
    <h2><Icon name={icon} />{title}{count && <span className="page-heading-count">{count.value}<small>{count.unit}</small></span>}</h2>
    {actions && <div className="page-heading-actions">{actions}</div>}
  </div>;
}
