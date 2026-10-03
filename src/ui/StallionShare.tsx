import { hasStallionShare } from '../core/master-horse';
import { store } from '../store/userdata';
import { useApp } from './app-context';

export function StallionShareBadge({ horseKey, showPurchased = false }: { horseKey: string; showPurchased?: boolean }) {
  const app = useApp();
  const horse = app.resolver.master(horseKey);
  if (!horse?.overseas) return null;
  const purchased = hasStallionShare(horse, app.data.settings.purchasedStallionShares);
  return !purchased || showPurchased ? <span className="pill">{purchased ? '株購入済み' : '株未購入'}</span> : null;
}

export function StallionShareCheckbox({ horseKey }: { horseKey: string }) {
  const app = useApp();
  return <label className="check"><input type="checkbox" checked={app.data.settings.purchasedStallionShares?.includes(horseKey) ?? false} onChange={e => store.setStallionShare(horseKey, e.target.checked)} />種牡馬株を購入済み</label>;
}
