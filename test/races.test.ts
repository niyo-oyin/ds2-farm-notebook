import { describe, expect, it } from 'vitest';
import { applyRaceEdits, EMPTY_RACE_FIELDS, raceDiff, sortRaces, validateRace, type Race } from '../src/core/races';

const race = (id: string, patch: Partial<Race> = {}): Race => ({ ...EMPTY_RACE_FIELDS, id, name: 'レース', ...patch });

describe('レースの一覧と編集', () => {
  it('変更した項目だけを上書きし、空欄への変更も保持する', () => {
    const base = race('rc:1', { name: '登録済みレース', distance: 1600 });
    const changed = { ...base, distance: null, month: 5 };
    const data = raceDiff(base, changed);
    const edits = [{ id: base.id, added: false, data, updatedAt: '2026-09-21' }];
    expect(applyRaceEdits([{ ...base, grade: 'GⅠ' }], edits)).toEqual([{ ...changed, grade: 'GⅠ' }]);
    expect(applyRaceEdits([base], [])).toEqual([base]);
    expect(base.distance).toBe(1600);
  });

  it('同名の一般レースを条件別に追加しても既存のレースを変えない', () => {
    const base = race('rc:1', { name: '2歳未勝利', venue: '東京' });
    const added = { id: 'rc:u:1', added: true, data: { name: '2歳未勝利', venue: '京都', distance: 1800 }, updatedAt: '2026-09-21' };
    const rows = applyRaceEdits([base], [added]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.venue)).toEqual(['東京', '京都']);
    expect(rows[1].grade).toBe('');
  });

  it('距離と開催時期は数値順で、未入力は昇順・降順とも最後になる', () => {
    const rows = [race('unknown'), race('short', { distance: 900, month: 2, week: 4 }), race('long', { distance: 1600, month: 10, week: 1 })];
    for (const key of ['distance', 'schedule'] as const) {
      expect(sortRaces(rows, key, 'asc').map((r) => r.id)).toEqual(['short', 'long', 'unknown']);
      expect(sortRaces(rows, key, 'desc').map((r) => r.id)).toEqual(['long', 'short', 'unknown']);
    }
    expect(rows[0].id).toBe('unknown');
  });

  it('名前だけで登録できるが、不正な数値は保存しない', () => {
    expect(() => validateRace(race('rc:1'))).not.toThrow();
    for (const patch of [{ name: ' ' }, { distance: 0 }, { distance: NaN }, { month: 13 }, { week: 1.5 }]) {
      expect(() => validateRace(race('rc:1', patch))).toThrow();
    }
  });
});
