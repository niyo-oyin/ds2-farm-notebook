import type { HorseCategory, Sex } from '../core/types';

/** ファビコンと同じ馬の横顔（右向き） */
const HEAD = 'M15 52C14 39 18 27 29 21L28 11L36 18L42 16L42 23L51 33C54 37 51 41 47 40L43 39L38 33C33 37 32 44 35 52H15Z';
const MANE = 'M29 21C22 28 20 39 22 52';

function Head({ transform, className }: { transform?: string; className?: string }) {
  return <g transform={transform} className={className}>
    <path className="hp-head" d={HEAD} />
    <path className="hp-line" d={MANE} />
    <circle className="hp-eye" cx="39" cy="25.5" r="1.6" />
  </g>;
}

/** 区分ごとの添え物。現役は頭絡、種牡馬は星、繁殖牝馬は仔馬、引退は牧草。写真枠の下の帯に隠れないよう y=52 より上に収める */
function Motif({ category }: { category?: HorseCategory }) {
  switch (category) {
    case '現役': return <><path className="hp-line" d="M33 19.5L42 35.5M47.5 29L42 35.5" /><circle className="hp-line" cx="42" cy="35.5" r="1.4" /></>;
    case '種牡馬': return <path className="hp-mark" d="M12 8l1.9 3.9 4.3.6-3.1 3 .7 4.3L12 17.8l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />;
    case '繁殖牝馬': return <Head className="hp-foal" transform="translate(36 27) scale(.42)" />;
    case '引退': return <path className="hp-line" d="M6 52h52M9 52l2-6 2 6M14 52l1.5-4 1.5 4M44 52l2-6 2 6M49 52l1.5-4 1.5 4" />;
    default: return null;
  }
}

/** 写真がない馬の絵。区分を絵柄で、性別を地色（牡は藍、牝は紅）で示す */
export function HorsePlaceholder({ category, sex }: { category?: HorseCategory; sex: Sex | null }) {
  return <svg className={`horse-placeholder sex-${sex ?? 'none'}`} viewBox="0 0 64 64" aria-hidden="true">
    <rect className="hp-bg" width="64" height="64" />
    <Head />
    <Motif category={category} />
  </svg>;
}
