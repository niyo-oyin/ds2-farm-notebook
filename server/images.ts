// 馬の画像・取り込み写真をファイルとして保存する（DS2_DB と同じディレクトリの images/）
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

export const IMAGE_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const MAX_IMAGE_BYTES = 4_000_000;

export class ImageStore {
  constructor(private dir: string) { mkdirSync(dir, { recursive: true }); }
  private path(id: string) { return /^[a-z0-9]+\.(jpg|png|webp)$/.test(id) ? resolve(this.dir, id) : null; }
  /** base64 を保存して ID を返す。形式が不正なら null */
  save(base64: string, mediaType: string): string | null {
    const ext = IMAGE_EXT[mediaType];
    if (!ext) return null;
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null;
    const id = `${randomBytes(8).toString('hex')}.${ext}`;
    writeFileSync(this.path(id)!, bytes);
    return id;
  }
  read(id: string): { bytes: Buffer; mediaType: string } | null {
    const path = this.path(id);
    if (!path || !existsSync(path)) return null;
    const mediaType = Object.entries(IMAGE_EXT).find(([, ext]) => path.endsWith('.' + ext))![0];
    return { bytes: readFileSync(path), mediaType };
  }
  mediaType(id: string) { return Object.entries(IMAGE_EXT).find(([, ext]) => id.endsWith('.' + ext))?.[0] ?? 'image/jpeg'; }
  delete(id: string) { const path = this.path(id); if (path && existsSync(path)) unlinkSync(path); }
}
