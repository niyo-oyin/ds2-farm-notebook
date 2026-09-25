import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HorseOffspring } from '../src/ui/HorseOffspring';
import { owned } from './horse-fixtures';

it('母のIDで産駒を集め、引退馬も生年の新しい順に表示し、最新の戦績と賞金を反映する', () => {
  const horses = [
    owned('u:old', { name: '引退した産駒', damKey: 'u:dam', sireKey: 'st:sire', category: '引退', profile: { birthYear: 30, record: '10戦3勝', earnings: 7450 } }),
    owned('u:unknown', { name: '生年未入力の産駒', damKey: 'u:dam' }),
    owned('u:young', { name: '今年の産駒', damKey: 'u:dam', profile: { birthYear: 32, earnings: 0 } }),
    owned('u:other', { name: '別の母の産駒', damKey: 'u:other-dam', sireKey: 'u:dam' }),
  ];
  const render = () => renderToStaticMarkup(<HorseOffspring damId="u:dam" horses={horses} label={() => '父の種牡馬'} />);
  const html = render();
  expect(html).not.toContain('別の母の産駒');
  expect(html.indexOf('今年の産駒')).toBeLessThan(html.indexOf('引退した産駒'));
  expect(html.indexOf('引退した産駒')).toBeLessThan(html.indexOf('生年未入力の産駒'));
  expect(html).toContain('#/horses?id=u%3Aold');
  expect(html).toContain('父の種牡馬');
  expect(html).toContain('10戦3勝');
  expect(html).toContain('7,450');
  expect(html).toContain('class="numeric">0</td>');
  expect(html).toContain('class="numeric">—</td>');
  horses[0].profile = { ...horses[0].profile, record: '11戦4勝', earnings: 10000 };
  expect(render()).toContain('11戦4勝');
  expect(render()).toContain('10,000');
  horses.forEach(h => { h.damKey = ''; });
  expect(render()).toContain('登録済みの産駒はありません');
});
