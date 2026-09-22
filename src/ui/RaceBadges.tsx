import './RaceBadges.css';

export function RaceGradeBadge({ grade }: { grade: string }) {
  const normalized = grade.normalize('NFKC').toUpperCase().replace(/\s/g, '');
  const graded = /^(?:G|JPN|J[・-]?G)(1|2|3|I|II|III)$/.exec(normalized);
  const level = graded ? ({ I: '1', II: '2', III: '3' }[graded[1]] ?? graded[1])
    : ['L', 'OP', 'オープン'].includes(normalized) ? 'open' : 'class';
  return <span className="race-grade" data-level={level}>{grade}</span>;
}

export function RaceFinishBadge({ finish }: { finish: string }) {
  const normalized = finish.normalize('NFKC').trim();
  const place = /^([123])(?:着)?(?:\s*\(同着\))?$/.exec(normalized)?.[1];
  return <span className="race-finish" data-place={place}>{finish || '—'}</span>;
}
