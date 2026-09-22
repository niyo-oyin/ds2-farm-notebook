import { useState } from 'react';

export function useResultPage<T>(results: readonly T[], pageSize: number) {
  const [requestedPage, setPage] = useState(0);
  const page = Math.min(requestedPage, Math.max(0, Math.ceil(results.length / pageSize) - 1));
  const offset = page * pageSize;
  return { rows: results.slice(offset, offset + pageSize), page, pageSize, offset, setPage, total: results.length };
}
