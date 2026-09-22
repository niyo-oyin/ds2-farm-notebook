export function ResultPagination({ total, page, pageSize, onChange }: { total: number; page: number; pageSize: number; onChange: (page: number) => void }) {
  if (total <= pageSize) return null;
  const pages = Math.ceil(total / pageSize);
  return <nav className="result-pagination" aria-label="探索結果のページ">
    <span className="small muted">{(page * pageSize + 1).toLocaleString()}–{Math.min(total, (page + 1) * pageSize).toLocaleString()} / {total.toLocaleString()}件</span>
    <button type="button" disabled={page === 0} onClick={() => onChange(page - 1)}>前へ</button>
    <label>ページ<input aria-label="結果ページ" type="number" min={1} max={pages} value={page + 1} onChange={(e) => { if (e.target.value) onChange(Math.max(0, Math.min(pages - 1, Math.trunc(Number(e.target.value)) - 1))); }} /></label>
    <span>/ {pages.toLocaleString()}</span>
    <button type="button" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>次へ</button>
  </nav>;
}
