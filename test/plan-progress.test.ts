import { describe, expect, it } from 'vitest';
import { planProgress } from '../src/store/plan-progress';
import { emptyUserData } from '../src/store/model';
import { owned, planned, plan } from './horse-fixtures';

describe('計画で次に進める手順', () => {
  it('生産・希望の性別・同じ個体の繁殖入りが揃ってから次の配合へ進む', () => {
    const data = { ...emptyUserData(), horses: [owned('u:colt', { sex: 'M', category: '種牡馬' })], plannedHorses: [planned('p:1', { realizedIds: ['u:colt'] }), planned('p:2')] };
    const p = plan('plan:1', ['p:1', 'p:2']);
    expect(planProgress(p, data)).toMatchObject({ nextIndex: 0, completed: 0, steps: [{ status: '希望の性別待ち' }, { status: '未生産' }] });
    data.horses.push(owned('u:filly'));
    data.plannedHorses[0].realizedIds.push('u:filly');
    // 兄が種牡馬でも、希望する牝馬自身が繁殖入りするまで進めない。
    expect(planProgress(p, data)).toMatchObject({ nextIndex: 0, completed: 0, steps: [{ status: '繁殖入り待ち' }, { status: '未生産' }] });
    data.horses[1].category = '繁殖牝馬';
    expect(planProgress(p, data)).toMatchObject({ nextIndex: 1, completed: 1, complete: false });
  });
  it('競走馬が最終目標なら繁殖入りを要求せず、手動の進捗も反映する', () => {
    const data = { ...emptyUserData(), plannedHorses: [planned('p:1', { role: undefined, desiredSex: undefined, achieved: { born: true, sexOk: false, bred: false } })] };
    expect(planProgress(plan('plan:1', ['p:1']), data)).toMatchObject({ complete: true, completed: 1, nextIndex: -1 });
  });
  it('計画馬の欠落や空の計画を完了扱いしない', () => {
    expect(planProgress(plan('plan:1', ['p:missing']), emptyUserData())).toMatchObject({ complete: false, nextIndex: 0 });
    expect(planProgress(plan('plan:empty', []), emptyUserData()).complete).toBe(false);
  });
});
