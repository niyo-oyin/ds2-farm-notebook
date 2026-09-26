import sharp from 'sharp';

export interface AbilityBox { x0: number; y0: number; x1: number; y1: number }

/** 判別に使った画像の座標に余白を付け、印の中心が見えるよう縦横2倍で切り出す。 */
export async function abilityCloseup(image: Buffer, box: AbilityBox): Promise<Buffer> {
  if (!Object.values(box).every((v) => Number.isFinite(v) && v >= 0 && v <= 1) || box.x0 >= box.x1 || box.y0 >= box.y1) {
    throw new Error('能力欄の読み取り範囲が不正です。写真の読み取りを再試行してください。');
  }
  const source = sharp(image);
  const { width, height } = await source.metadata();
  if (!width || !height) throw new Error('写真のサイズを取得できません');
  const left = Math.floor(Math.max(0, box.x0 - 0.03) * width);
  const top = Math.floor(Math.max(0, box.y0 - 0.03) * height);
  const right = Math.ceil(Math.min(1, box.x1 + 0.03) * width);
  const bottom = Math.ceil(Math.min(1, box.y1 + 0.03) * height);
  return source.extract({ left, top, width: right - left, height: bottom - top })
    .resize((right - left) * 2, (bottom - top) * 2).png().toBuffer();
}
