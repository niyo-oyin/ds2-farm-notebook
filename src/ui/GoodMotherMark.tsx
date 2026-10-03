/** コメントの記録を示す。馬名そのものには含めない。 */
export function GoodMotherMark({ checked }: { checked?: boolean }) {
  return checked ? <span role="img" aria-label="「いい母」コメントあり" title="「いい母」コメントあり"> ⭐</span> : null;
}
