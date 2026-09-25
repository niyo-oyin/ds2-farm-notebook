import type { OwnedHorse } from '../core/types';

export function HorseOffspring({ damId, horses, label }: {
  damId: string; horses: OwnedHorse[]; label: (key: string) => string;
}) {
  const foals = horses.filter(h => h.damKey === damId && h.id !== damId).sort((a, b) =>
    (b.profile?.birthYear ?? -Infinity) - (a.profile?.birthYear ?? -Infinity) || a.name.localeCompare(b.name, 'ja'));
  return <section className="sheet-section">
    <div className="sheet-section-heading"><h3>産駒 <span>{foals.length}頭</span></h3></div>
    {foals.length ? <div className="table-wrap"><table className="sheet-offspring">
      <thead><tr><th scope="col">生年</th><th scope="col">馬名</th><th scope="col">性別</th><th scope="col">区分</th><th scope="col">父（種牡馬）</th><th scope="col">戦績</th><th scope="col" className="numeric">総賞金（万円）</th></tr></thead>
      <tbody>{foals.map(h => <tr key={h.id}>
        <td>{h.profile?.birthYear == null ? '—' : `${h.profile.birthYear}年`}</td>
        <td><a href={`#/horses?id=${encodeURIComponent(h.id)}`}>{h.name}</a></td>
        <td>{h.sex === 'F' ? '牝' : h.sex === 'M' ? '牡' : '—'}</td>
        <td>{h.category}</td><td>{h.sireKey ? label(h.sireKey) : '—'}</td>
        <td>{h.profile?.record || '—'}</td><td className="numeric">{h.profile?.earnings?.toLocaleString('ja-JP') ?? '—'}</td>
      </tr>)}</tbody>
    </table></div> : <p className="sheet-card-empty">登録済みの産駒はありません。所有馬の血統で、この馬を母に設定すると表示されます。</p>}
  </section>;
}
